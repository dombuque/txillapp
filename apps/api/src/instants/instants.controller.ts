import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { InstantsService } from './instants.service';

type AuthedReq = Request & { userId?: string };
export const createSchema = z.object({ mediaId: z.string().uuid(), caption: z.string().trim().max(80).default(''), audience: z.enum(['friends', 'close']).default('friends') });

const reactSchema = z.object({ reaction: z.string().regex(/^:[a-z]{2,12}:$/) });

@Controller('instants')
@UseGuards(JwtAuthGuard)
export class InstantsController {
  constructor(private readonly instants: InstantsService) {}

  @NeedsVerifiedEmail()
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.instants.create(req.userId!, b.mediaId, b.caption, b.audience);
  }

  @Get()
  tray(@Req() req: AuthedReq) {
    return this.instants.tray(req.userId!);
  }

  /** Todos os Zás por ver, numa lista só (o visor em pilha). */
  @Get('feed')
  feed(@Req() req: AuthedReq) {
    return this.instants.feed(req.userId!);
  }

  @Get('of/:username')
  of(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.instants.of(req.userId!, username);
  }

  @Post(':id/view')
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async view(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    await this.instants.view(req.userId!, id);
  }

  @Put(':id/reaction')
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async react(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reactSchema)) b: z.infer<typeof reactSchema>) {
    await this.instants.react(req.userId!, id, b.reaction);
  }

  @Get(':id/viewers')
  viewers(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.instants.viewers(req.userId!, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.instants.remove(req.userId!, id);
  }
}
