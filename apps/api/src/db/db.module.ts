import { Global, Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
import client from 'prom-client';
import { AppConfig, CONFIG } from '../config';
import { registry } from '../observability/metrics';

export const PG_POOL = Symbol('PG_POOL');

/**
 * As opções do pool de cada processo (docs/escala.md, «Ligações ao PostgreSQL»): PG_POOL_MAX ligações (20 por omissão),
 * cada consulta no máximo PG_STATEMENT_TIMEOUT_MS e uma transação parada no máximo PG_IDLE_TX_TIMEOUT_MS (0 = sem limite).
 * O papel (txillapp-web, txillapp-worker, txillapp-api) aparece em pg_stat_activity.application_name.
 */
export function poolOptions(config: AppConfig): PoolConfig {
  return {
    connectionString: config.DATABASE_URL,
    max: config.PG_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: `txillapp-${config.ROLE ?? 'api'}`,
    ...(config.PG_STATEMENT_TIMEOUT_MS ? { statement_timeout: config.PG_STATEMENT_TIMEOUT_MS } : {}),
    ...(config.PG_IDLE_TX_TIMEOUT_MS ? { idle_in_transaction_session_timeout: config.PG_IDLE_TX_TIMEOUT_MS } : {}),
  };
}

/** O pool deste processo, para as métricas (nos testes há várias apps no mesmo processo: conta a última). */
let watched: Pool | null = null;
new client.Gauge({ name: 'pg_pool_connections', help: 'Ligações abertas no pool do PostgreSQL deste processo', registers: [registry], collect() { this.set(watched?.totalCount ?? 0); } });
new client.Gauge({ name: 'pg_pool_idle', help: 'Ligações livres no pool deste processo', registers: [registry], collect() { this.set(watched?.idleCount ?? 0); } });
new client.Gauge({ name: 'pg_pool_waiting', help: 'Pedidos à espera de uma ligação do pool deste processo', registers: [registry], collect() { this.set(watched?.waitingCount ?? 0); } });

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => (watched = new Pool(poolOptions(config))),
    },
  ],
  exports: [PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
