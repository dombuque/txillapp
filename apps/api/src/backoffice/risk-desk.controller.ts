import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { RISK_QUEUE_STATES, RiskDeskService, type RiskQueueState } from './risk-desk.service';

type AuthedReq = Request & { userId?: string };
const decideSchema = z.object({ decision: z.enum(['clear', 'limit', 'suspend']), reason: z.string().trim().min(3, 'Escreve o motivo').max(300) });

/**
 * Backoffice › Contas suspeitas.
 *   GET  /admin/risk?state=flagged|limited|cleared|suspended&cursor=…   (users.view)
 *   POST /admin/risk/:userId/decide { decision: clear|limit|suspend, reason }  (users.suspend)
 */
@Controller('admin/risk')
@UseGuards(StaffGuard)
export class RiskDeskController {
  constructor(private readonly desk: RiskDeskService) {}

  @Get()
  @Needs('users.view')
  queue(@Query('state') state?: string, @Query('cursor') cursor?: string) {
    const s = (RISK_QUEUE_STATES as readonly string[]).includes(state ?? '') ? (state as RiskQueueState) : 'flagged';
    return this.desk.queue(s, cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : undefined);
  }

  @Post(':userId/decide')
  @Needs('users.view', 'users.suspend')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  decide(@Req() req: AuthedReq, @Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodPipe(decideSchema)) b: z.infer<typeof decideSchema>) {
    return this.desk.decide(req.userId!, userId, b.decision, b.reason);
  }
}
