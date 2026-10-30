import { Controller, Get, Inject, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Pool } from 'pg';
import { countryOf } from '../common/geo';
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

  /** País detetado para quem pede (pelo IP, via Cloudflare). A interface mostra "Estás em ...". */
  @Get('geo')
  geo(@Req() req: Request) {
    return { country: countryOf(req) };
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
