import { Controller, Get, Headers, NotFoundException, Res, UnauthorizedException, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import client from 'prom-client';
import { AppConfig, CONFIG } from '../config';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração dos pedidos HTTP',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.03, 0.1, 0.3, 1, 3, 10],
  registers: [registry],
});

/** Mede cada pedido, com a rota em forma de padrão (/posts/:id), nunca com ids reais. */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = (req.route?.path as string | undefined) ?? 'nao_encontrada';
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
}

/** /api/v1/metrics para o Prometheus. Só existe se METRICS_TOKEN estiver definido; exige esse token. */
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  @Get()
  @SkipThrottle()
  async metrics(@Headers('authorization') auth: string | undefined, @Res() res: Response) {
    const token = this.config.METRICS_TOKEN;
    if (!token) throw new NotFoundException();
    const given = Buffer.from((auth ?? '').replace(/^Bearer /, ''));
    const expected = Buffer.from(token);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException();
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }
}
