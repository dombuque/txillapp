import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { InsightsService, PERIODS, type Period } from './insights.service';

type AuthedReq = Request & { userId?: string };

/** As estatísticas do próprio perfil: só o dono as vê. */
@Controller('insights')
@UseGuards(JwtAuthGuard)
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  get(@Req() req: AuthedReq, @Query('days') days?: string, @Query('tz') tz?: string) {
    const d = Number(days);
    const period = (PERIODS as readonly number[]).includes(d) ? (d as Period) : 30;
    return this.insights.get(req.userId!, period, Number(tz) || 0);
  }
}
