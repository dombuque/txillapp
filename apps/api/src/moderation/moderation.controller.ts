import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, Injectable, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { ModerationService, REPORT_REASONS, REPORT_TYPES, USER_REPORT_TYPES } from './moderation.service';

type AuthedReq = Request & { userId?: string };

/** Só contas de moderação (is_admin). Corre depois do JwtAuthGuard. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly moderation: ModerationService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedReq>();
    if (!req.userId || !(await this.moderation.isAdmin(req.userId))) throw new ForbiddenException();
    return true;
  }
}

const reportSchema = z.object({
  type: z.enum(USER_REPORT_TYPES),
  id: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(500).optional(),
});
const resolveSchema = z.object({ type: z.enum(REPORT_TYPES), id: z.string().uuid(), action: z.enum(['dismiss', 'remove', 'suspend']) });

@Controller()
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Post('reports')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  report(@Req() req: AuthedReq, @Body(new ZodPipe(reportSchema)) b: z.infer<typeof reportSchema>) {
    return this.moderation.report(req.userId!, b.type, b.id, b.reason, b.note);
  }

  @Get('admin/reports')
  @UseGuards(AdminGuard)
  queue(@Query('status') status?: string) {
    return this.moderation.queue(status === 'dismissed' || status === 'actioned' ? status : 'open');
  }

  @Post('admin/reports/resolve')
  @UseGuards(AdminGuard)
  @HttpCode(204)
  resolve(@Req() req: AuthedReq, @Body(new ZodPipe(resolveSchema)) b: z.infer<typeof resolveSchema>) {
    return this.moderation.resolve(req.userId!, b.type, b.id, b.action);
  }
}
