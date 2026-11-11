import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { AnalyticsService, EVENT_NAMES, MAX_AGO_MS, PLATFORMS } from './analytics.service';

type AuthedReq = Request & { userId?: string };
const eventsSchema = z.object({
  sessionId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  /** browser/pwa: o site antigo (apps/web). web/ios/android: a app (apps/mobile), que também é o site. */
  platform: z.enum(PLATFORMS).default('browser'),
  /** Versão da app que enviou (ex.: 1.25.3). Opcional: o site antigo não a manda. */
  appVersion: z.string().min(1).max(32).regex(/^[0-9A-Za-z._+-]+$/).optional(),
  events: z
    // `ago` até 3 dias: a app guarda os eventos no aparelho quando está sem rede e envia-os depois.
    .array(z.object({ name: z.enum(EVENT_NAMES), props: z.record(z.string(), z.unknown()).optional(), ago: z.number().int().min(0).max(MAX_AGO_MS).optional() }))
    .min(1)
    .max(40),
});

@Controller()
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** O telemóvel envia lotes de eventos (aberturas, ecrãs, desempenho, erros). Ignorado se a pessoa os desligou. */
  @Post('analytics/events')
  @HttpCode(204)
  // Conta por IP: cada aparelho manda uns 4 lotes por minuto; 120 deixa folga para várias pessoas atrás do mesmo IP (redes móveis).
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async events(@Req() req: AuthedReq, @Body(new ZodPipe(eventsSchema)) b: z.infer<typeof eventsSchema>) {
    await this.analytics.record(req.userId!, b.sessionId, b.platform, b.events, b.appVersion);
  }

  @Get('admin/stats')
  @UseGuards(StaffGuard)
  @Needs('stats.view')
  stats(@Query('days') days?: string) {
    return this.analytics.stats(Math.min(Math.max(Number(days) || 14, 3), 90));
  }
}
