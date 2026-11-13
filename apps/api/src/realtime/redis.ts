import Redis, { type RedisOptions } from 'ioredis';
import type { AppConfig } from '../config';

/** O cliente do Redis (comandos) deste processo, ou null sem REDIS_URL. */
export const REDIS = Symbol('REDIS');

/**
 * Uma ligação ao Redis. As falhas não ficam penduradas: sem ligação, os comandos falham logo (quem chama cai para a
 * memória) e o cliente volta a tentar de 0,5 em 0,5 s até 10 s. A ligação de subscrição guarda os pedidos até ligar
 * (e volta a subscrever sozinha depois de cair).
 */
export function connectRedis(config: Pick<AppConfig, 'REDIS_URL' | 'REDIS_PASSWORD' | 'ROLE'>, purpose: 'cmd' | 'sub'): Redis {
  const opts: RedisOptions = {
    connectionName: `txillapp-${config.ROLE ?? 'api'}-${purpose}`,
    maxRetriesPerRequest: purpose === 'cmd' ? 1 : null,
    enableOfflineQueue: purpose === 'sub',
    retryStrategy: (n) => Math.min(n * 500, 10_000),
    ...(config.REDIS_PASSWORD ? { password: config.REDIS_PASSWORD } : {}),
  };
  const r = new Redis(config.REDIS_URL!, opts);
  // Os erros de ligação já aparecem no RealtimeBus (com limite de avisos); sem isto o ioredis escreve cada tentativa.
  r.on('error', () => undefined);
  return r;
}

/** Espera pela ligação (até `ms`); não falha: o arranque continua e as operações caem para a memória até o Redis voltar. */
export async function waitReady(r: Redis, ms = 5_000): Promise<boolean> {
  if (r.status === 'ready') return true;
  return new Promise((ok) => {
    const done = (v: boolean) => {
      clearTimeout(t);
      r.off('ready', onReady);
      ok(v);
    };
    const onReady = () => done(true);
    const t = setTimeout(() => done(false), ms);
    r.once('ready', onReady);
  });
}
