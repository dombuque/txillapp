import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import client from 'prom-client';
import { registry } from '../observability/metrics';
import type { RateStore } from './rate-store';

const once = <T>(name: string, make: () => T): T => (registry.getSingleMetric(name) as T | undefined) ?? make();

/** Operações da segurança feitas no PostgreSQL porque o Redis falhou (como o `throttler_redis_fallback_total`). */
export const rateStoreFallbacks = once('security_rate_redis_fallback_total', () => new client.Counter({
  name: 'security_rate_redis_fallback_total',
  help: 'Contadores e bloqueios da segurança feitos no PostgreSQL porque o Redis falhou',
  labelNames: ['op'] as const,
  registers: [registry],
}));

/** Prefixos das chaves no Redis: contadores, bloqueios (o valor é o fim, em ms) e o número de bloqueios seguidos. */
const C = (k: string) => `sec:c:${k}`;
const L = (k: string) => `sec:l:${k}`;
const S = (k: string) => `sec:s:${k}`;

/**
 * Soma 1 e, no primeiro toque, abre a janela (PEXPIRE). Num só passo: nunca fica um contador sem validade.
 * Uma chave antiga sem validade (não devia haver) também a ganha aqui.
 */
const HIT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n`;

/**
 * Bloqueio com espera progressiva, igual ao do PostgreSQL: o bloqueio n (enquanto a conta dos bloqueios não for esquecida,
 * 24 horas depois do último acabar) dura base × 2^(n-1), até ao máximo. KEYS: o bloqueio e a conta; ARGV: base, máximo.
 * O relógio é o do Redis (o mesmo para todas as réplicas). Devolve { fim em ms, n }.
 */
const LOCK = `local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local prev = tonumber(redis.call('GET', KEYS[2]) or '0')
local dur = math.min(tonumber(ARGV[2]), tonumber(ARGV[1]) * (2 ^ prev))
dur = math.max(1, math.floor(dur))
local untilMs = now + dur
redis.call('SET', KEYS[1], tostring(untilMs), 'PX', dur)
redis.call('SET', KEYS[2], tostring(prev + 1), 'PX', dur + 86400000)
return { tostring(untilMs), prev + 1 }`;

/**
 * Os contadores e os bloqueios da segurança no Redis (docs/escala.md): os mesmos em todas as réplicas, sem escrever na
 * base de dados a cada login falhado. Usa a ligação de comandos da escala (REDIS), sem abrir outra.
 *   contadores  INCR + PEXPIRE (janela fixa que começa no primeiro toque), `sec:c:<chave>`
 *   bloqueios   SET PX (o valor é o fim em ms), `sec:l:<chave>`, e a conta dos bloqueios seguidos em `sec:s:<chave>`
 * Se o Redis falhar, essa operação faz-se no PostgreSQL (o `PgRateStore`) e conta em `security_rate_redis_fallback_total`:
 * o pedido nunca falha por causa do Redis. Durante a falha as contagens ficam repartidas (menos apertadas), como no
 * throttler; quando o Redis volta, os bloqueios que ficaram na base de dados continuam a ser respeitados.
 */
export class RedisRateStore implements RateStore {
  private readonly log = new Logger('Segurança');
  private lastWarn = 0;

  constructor(
    private readonly redis: Redis,
    private readonly fallback: RateStore,
  ) {}

  private async safe<T>(op: string, viaRedis: () => Promise<T>, viaFallback: () => Promise<T>): Promise<T> {
    try {
      return await viaRedis();
    } catch (e) {
      rateStoreFallbacks.inc({ op });
      const now = Date.now();
      if (now - this.lastWarn > 60_000) {
        this.lastWarn = now;
        this.log.warn(`Redis indisponível para os travões da segurança: ${(e as Error).message}. A contar no PostgreSQL.`);
      }
      return viaFallback();
    }
  }

  hit(key: string, windowMs: number): Promise<number> {
    return this.safe(
      'hit',
      async () => Number(await this.redis.eval(HIT, 1, C(key), Math.max(1, Math.round(windowMs)))),
      () => this.fallback.hit(key, windowMs),
    );
  }

  async peek(key: string): Promise<number> {
    return (await this.peekMany([key]))[0];
  }

  peekMany(keys: string[]): Promise<number[]> {
    // As chaves vazias (sem IP) valem 0, como no PostgreSQL.
    if (!keys.length) return Promise.resolve([]);
    return this.safe(
      'peek',
      async () => (await this.redis.mget(...keys.map(C))).map((v) => (v ? Number(v) || 0 : 0)),
      () => this.fallback.peekMany(keys),
    );
  }

  async clearCounters(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    // Os contadores do PostgreSQL só se leem durante uma falha do Redis: só aí se apagam (sem escrever a cada login certo).
    await this.safe('clear', async () => void (await this.redis.del(...keys.map(C))), () => this.fallback.clearCounters(...keys));
  }

  async reset(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    // Também no PostgreSQL: um bloqueio feito lá durante uma falha do Redis tem de acabar aqui (recuperar a senha).
    await this.safe('reset', async () => void (await this.redis.del(...keys.flatMap((k) => [C(k), L(k), S(k)]))), async () => undefined);
    await this.fallback.reset(...keys).catch(() => undefined);
  }

  lock(key: string, baseMs: number, maxMs: number): Promise<{ until: Date; strikes: number }> {
    return this.safe(
      'lock',
      async () => {
        const [until, strikes] = (await this.redis.eval(LOCK, 2, L(key), S(key), Math.round(baseMs), Math.round(maxMs))) as [string, number];
        return { until: new Date(Number(until)), strikes: Number(strikes) };
      },
      () => this.fallback.lock(key, baseMs, maxMs),
    );
  }

  async lockedUntil(...keys: string[]): Promise<Date | null> {
    if (!keys.length) return null;
    const viaRedis = await this.safe<Date | null | undefined>(
      'locked',
      async () => {
        const now = Date.now();
        const ends = (await this.redis.mget(...keys.map(L))).map((v) => Number(v ?? 0)).filter((ms) => ms > now);
        return ends.length ? new Date(Math.max(...ends)) : null;
      },
      async () => undefined,
    );
    // Os bloqueios feitos no PostgreSQL durante uma falha do Redis também contam (consulta só por chave primária).
    const viaPg = await this.fallback.lockedUntil(...keys).catch(() => null);
    if (viaRedis === undefined) return viaPg;
    if (!viaRedis) return viaPg;
    if (!viaPg) return viaRedis;
    return viaRedis > viaPg ? viaRedis : viaPg;
  }
}
