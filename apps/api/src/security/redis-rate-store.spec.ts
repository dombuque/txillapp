import Redis from 'ioredis';
import { registry } from '../observability/metrics';
import type { RateStore } from './rate-store';
import { RedisRateStore } from './redis-rate-store';

/**
 * O RedisRateStore: as mesmas regras do PgRateStore (janela fixa, bloqueios com espera progressiva) e a reserva no
 * PostgreSQL quando o Redis falha. A parte com Redis a sério só corre com TEST_REDIS_URL
 * (ex.: redis://localhost:6380 com `docker run -d --rm --name t-redis2 -p 6380:6379 redis:7-alpine`).
 */
const REDIS = process.env.TEST_REDIS_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = () => `t:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;

/** Uma reserva na memória, com a mesma interface (no lugar do PgRateStore nos testes sem base de dados). */
class MemoryStore implements RateStore {
  calls: string[] = [];
  counters = new Map<string, { hits: number; exp: number }>();
  locks = new Map<string, { until: number; strikes: number }>();
  async hit(key: string, windowMs: number) {
    this.calls.push('hit');
    const c = this.counters.get(key);
    if (!c || c.exp <= Date.now()) {
      this.counters.set(key, { hits: 1, exp: Date.now() + windowMs });
      return 1;
    }
    return ++c.hits;
  }
  async peek(key: string) {
    return (await this.peekMany([key]))[0];
  }
  async peekMany(keys: string[]) {
    this.calls.push('peek');
    return keys.map((k) => {
      const c = this.counters.get(k);
      return c && c.exp > Date.now() ? c.hits : 0;
    });
  }
  async clearCounters(...keys: string[]) {
    this.calls.push('clear');
    keys.forEach((k) => this.counters.delete(k));
  }
  async reset(...keys: string[]) {
    this.calls.push('reset');
    keys.forEach((k) => (this.counters.delete(k), this.locks.delete(k)));
  }
  async lock(key: string, baseMs: number, maxMs: number) {
    this.calls.push('lock');
    const prev = this.locks.get(key)?.strikes ?? 0;
    const until = Date.now() + Math.min(maxMs, baseMs * 2 ** prev);
    this.locks.set(key, { until, strikes: prev + 1 });
    return { until: new Date(until), strikes: prev + 1 };
  }
  async lockedUntil(...keys: string[]) {
    this.calls.push('locked');
    const ends = keys.map((k) => this.locks.get(k)?.until ?? 0).filter((t) => t > Date.now());
    return ends.length ? new Date(Math.max(...ends)) : null;
  }
}

const fallbacks = async (op?: string) => {
  const m = (await registry.getSingleMetric('security_rate_redis_fallback_total')?.get()) as { values: { value: number; labels: Record<string, string> }[] };
  return m.values.filter((v) => !op || v.labels.op === op).reduce((s, v) => s + v.value, 0);
};

describe('RedisRateStore: o Redis falha, o PostgreSQL responde', () => {
  /** Um cliente que falha sempre, como o ioredis sem ligação (sem fila: falha logo). */
  const broken = () => {
    const fail = () => Promise.reject(new Error("Stream isn't writeable and enableOfflineQueue options is false"));
    return { eval: fail, mget: fail, del: fail } as unknown as Redis;
  };

  it('cada operação cai para a reserva, conta na métrica e o pedido nunca falha', async () => {
    const mem = new MemoryStore();
    const s = new RedisRateStore(broken(), mem);
    const before = await fallbacks();
    const k = uid();
    expect(await s.hit(k, 60_000)).toBe(1);
    expect(await s.hit(k, 60_000)).toBe(2);
    expect(await s.peekMany([k, uid()])).toEqual([2, 0]);
    const l = await s.lock(k, 1000, 4000);
    expect(l.strikes).toBe(1);
    expect((await s.lockedUntil(k))?.getTime()).toBe(l.until.getTime());
    await s.clearCounters(k);
    expect(await s.peek(k)).toBe(0);
    await s.reset(k);
    expect(await s.lockedUntil(k)).toBeNull();
    expect(mem.calls).toEqual(expect.arrayContaining(['hit', 'peek', 'lock', 'locked', 'clear', 'reset']));
    expect(await fallbacks()).toBeGreaterThanOrEqual(before + 8);
    expect(await fallbacks('lock')).toBeGreaterThanOrEqual(1);
  });

  it('sem chaves não faz pedidos a ninguém', async () => {
    const mem = new MemoryStore();
    const s = new RedisRateStore(broken(), mem);
    expect(await s.peekMany([])).toEqual([]);
    expect(await s.lockedUntil()).toBeNull();
    await s.clearCounters();
    await s.reset();
    expect(mem.calls).toEqual([]);
  });
});

(REDIS ? describe : describe.skip)('RedisRateStore com Redis', () => {
  let redis: Redis;
  let mem: MemoryStore;
  let s: RedisRateStore;

  beforeAll(async () => {
    redis = new Redis(REDIS!, { maxRetriesPerRequest: 1 });
    await redis.ping();
  });
  beforeEach(() => {
    mem = new MemoryStore();
    s = new RedisRateStore(redis, mem);
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('contadores: INCR com a janela a começar no primeiro toque (PEXPIRE), e a janela acaba', async () => {
    const k = uid();
    expect(await s.hit(k, 300)).toBe(1);
    expect(await s.hit(k, 300)).toBe(2);
    expect(await s.hit(k, 60_000)).toBe(3); // a janela não se estende a cada toque
    const ttl = await redis.pttl(`sec:c:${k}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);
    expect(await s.peekMany([k, uid(), ''])).toEqual([3, 0, 0]);
    await sleep(350);
    expect(await s.peek(k)).toBe(0);
    expect(await s.hit(k, 300)).toBe(1);
    expect(mem.calls).toEqual([]); // nada foi à reserva
  });

  it('um contador antigo sem validade ganha uma no toque seguinte', async () => {
    const k = uid();
    await redis.set(`sec:c:${k}`, '4');
    expect(await s.hit(k, 5_000)).toBe(5);
    expect(await redis.pttl(`sec:c:${k}`)).toBeGreaterThan(0);
  });

  it('apagar os contadores não tira o bloqueio; o reset tira tudo (também a espera progressiva)', async () => {
    const k = uid();
    await s.hit(k, 60_000);
    await s.lock(k, 60_000, 600_000);
    await s.clearCounters(k);
    expect(await s.peek(k)).toBe(0);
    expect(await s.lockedUntil(k)).not.toBeNull();
    await s.reset(k);
    expect(await s.lockedUntil(k)).toBeNull();
    expect((await s.lock(k, 60_000, 600_000)).strikes).toBe(1);
    expect(mem.calls).toContain('reset'); // o reset também limpa a reserva (bloqueios de uma falha do Redis)
  });

  it('bloqueios: SET PX com espera progressiva até ao máximo, e o fim mais tarde de várias chaves', async () => {
    const k = uid();
    const t0 = Date.now();
    const a = await s.lock(k, 1_000, 3_000);
    const b = await s.lock(k, 1_000, 3_000);
    const c = await s.lock(k, 1_000, 3_000);
    expect([a.strikes, b.strikes, c.strikes]).toEqual([1, 2, 3]);
    expect(a.until.getTime() - t0).toBeGreaterThanOrEqual(900);
    expect(a.until.getTime() - t0).toBeLessThan(1_500);
    expect(b.until.getTime() - t0).toBeGreaterThanOrEqual(1_900);
    expect(c.until.getTime() - t0).toBeLessThan(3_500); // o máximo
    const ttl = await redis.pttl(`sec:l:${k}`);
    expect(ttl).toBeGreaterThan(2_000);
    expect(ttl).toBeLessThanOrEqual(3_000);
    // A conta dos bloqueios dura 24 horas depois do fim.
    expect(await redis.pttl(`sec:s:${k}`)).toBeGreaterThan(86_000_000);

    const other = uid();
    await s.lock(other, 500, 500);
    expect((await s.lockedUntil(other, k, uid()))?.getTime()).toBe(c.until.getTime());
  });

  it('o bloqueio acaba sozinho (a chave expira) e o seguinte dura o dobro', async () => {
    const k = uid();
    await s.lock(k, 200, 10_000);
    expect(await s.lockedUntil(k)).not.toBeNull();
    await sleep(260);
    expect(await s.lockedUntil(k)).toBeNull();
    const next = await s.lock(k, 200, 10_000);
    expect(next.strikes).toBe(2);
    expect(next.until.getTime() - Date.now()).toBeGreaterThan(300);
  });

  it('um bloqueio que ficou na reserva (durante uma falha do Redis) continua a valer', async () => {
    const k = uid();
    const fromPg = await mem.lock(k, 60_000, 60_000);
    expect((await s.lockedUntil(k))?.getTime()).toBe(fromPg.until.getTime());
    const fromRedis = await s.lock(k, 120_000, 120_000);
    expect((await s.lockedUntil(k))?.getTime()).toBe(fromRedis.until.getTime());
  });
});
