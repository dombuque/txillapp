import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { AdminGuard } from '../moderation/moderation.controller';
import { AnalyticsService, EVENT_NAMES } from './analytics.service';

type AuthedReq = Request & { userId?: string };
const eventsSchema = z.object({
  sessionId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  platform: z.enum(['browser', 'pwa']).default('browser'),
  events: z
    .array(z.object({ name: z.enum(EVENT_NAMES), props: z.record(z.unknown()).optional(), ago: z.number().int().min(0).max(3_600_000).optional() }))
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
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async events(@Req() req: AuthedReq, @Body(new ZodPipe(eventsSchema)) b: z.infer<typeof eventsSchema>) {
    await this.analytics.record(req.userId!, b.sessionId, b.platform, b.events);
  }

  @Get('admin/stats')
  @UseGuards(AdminGuard)
  stats(@Query('days') days?: string) {
    return this.analytics.stats(Math.min(Math.max(Number(days) || 14, 3), 90));
  }
}
