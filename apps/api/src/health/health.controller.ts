import { Controller, Get, Inject, Optional, Req, ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Pool } from 'pg';
import { countryOf } from '../common/geo';
import { PG_POOL } from '../db/db.module';
import { REDIS } from '../realtime/redis';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Optional() @Inject(REDIS) private readonly redis: Redis | null,
  ) {}

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

  /**
   * Readiness: a base de dados acessível. O Redis aparece no estado mas não tira a instância do ar: sem ele, o tempo real
   * e os limites ficam só nesta instância até voltar (docs/escala.md).
   */
  @Get('ready')
  async ready() {
    const redis = !this.redis ? 'off' : this.redis.status === 'ready' ? 'up' : 'down';
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ready', db: 'up', redis };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready', db: 'down' });
    }
  }
}
