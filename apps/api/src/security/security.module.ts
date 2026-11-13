import { Global, Module } from '@nestjs/common';
import { PgRateStore, RATE_STORE } from './rate-store';
import { RiskGuard } from './risk.guard';
import { RiskService } from './risk.service';
import { SecurityService } from './security.service';
import { TurnstileService } from './turnstile.service';

/**
 * Segurança das contas (global). Para os contadores irem para o Redis, troca só o RATE_STORE:
 * `{ provide: RATE_STORE, useClass: RedisRateStore }` (ver rate-store.ts).
 */
@Global()
@Module({
  providers: [{ provide: RATE_STORE, useClass: PgRateStore }, TurnstileService, SecurityService, RiskService, RiskGuard],
  exports: [RATE_STORE, TurnstileService, SecurityService, RiskService, RiskGuard],
})
export class SecurityModule {}
