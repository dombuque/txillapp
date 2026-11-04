import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { AdminGuard } from '../moderation/moderation.controller';
import { BackofficeService } from './backoffice.service';

type AuthedReq = Request & { userId?: string };

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Escreve o motivo').max(300) });
const noteSchema = z.object({ body: z.string().trim().min(1).max(1000) });

/** Backoffice (computador): só contas de moderação. */
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BackofficeController {
  constructor(private readonly bo: BackofficeService) {}

  @Get('overview')
  overview() {
    return this.bo.overview();
  }

  @Get('users')
  users(@Query('q') q?: string, @Query('status') status?: string, @Query('cursor') cursor?: string) {
    return this.bo.users(q, status, cursor && /^[0-9a-f-]{36}$/.test(cursor) ? cursor : undefined);
  }

  @Get('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.bo.user(id);
  }

  @Post('users/:id/verify-email')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verify(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.bo.verifyEmail(req.userId!, id, b.reason);
  }

  @Post('users/:id/suspend')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  suspend(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.bo.suspend(req.userId!, id, b.reason);
  }

  @Post('users/:id/reactivate')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reactivate(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.bo.reactivate(req.userId!, id, b.reason);
  }

  @Post('users/:id/notes')
  @HttpCode(204)
  addNote(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(noteSchema)) b: z.infer<typeof noteSchema>) {
    return this.bo.addNote(req.userId!, id, b.body);
  }

  @Get('reports/decided')
  decided(@Query('status') status?: string, @Query('cursor') cursor?: string) {
    return this.bo.decided(status === 'dismissed' ? 'dismissed' : 'actioned', cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : undefined);
  }

  @Get('audit')
  audit(@Query('action') action?: string, @Query('actor') actor?: string, @Query('cursor') cursor?: string) {
    return this.bo.audit_list(action?.slice(0, 60), actor?.slice(0, 60), cursor && /^[0-9a-f-]{36}$/.test(cursor) ? cursor : undefined);
  }
}
