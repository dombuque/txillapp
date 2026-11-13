import { Global, Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { REDIS } from '../realtime/redis';
import { PgRateStore, RATE_STORE } from './rate-store';
import { RedisRateStore } from './redis-rate-store';
import { RiskGuard } from './risk.guard';
import { RiskService } from './risk.service';
import { SecurityService } from './security.service';
import { TurnstileService } from './turnstile.service';

/**
 * Segurança das contas (global). Os contadores e os bloqueios ficam no Redis quando há REDIS_URL (a ligação da escala,
 * partilhada por todas as réplicas) e no PostgreSQL sem ele; se o Redis falhar, cada operação cai para o PostgreSQL
 * (ver redis-rate-store.ts). As regras não mudam.
 */
@Global()
@Module({
  providers: [
    {
      provide: RATE_STORE,
      inject: [REDIS, PG_POOL],
      useFactory: (redis: Redis | null, pool: Pool) => {
        const pg = new PgRateStore(pool);
        return redis ? new RedisRateStore(redis, pg) : pg;
      },
    },
    TurnstileService,
    SecurityService,
    RiskService,
    RiskGuard,
  ],
  exports: [RATE_STORE, TurnstileService, SecurityService, RiskService, RiskGuard],
})
export class SecurityModule {}
