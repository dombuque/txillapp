import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Liveness: o processo responde. */
  @Get()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependências críticas acessíveis. */
  @Get('ready')
  async ready() {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ready', db: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready', db: 'down' });
    }
  }
}
