import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { MAX_PRIVATE } from './mixar-controlo';
import { MixarControloService } from './mixar-controlo.service';

type AuthedReq = Request & { userId?: string };

const topicSchema = z.object({ topic: z.string().trim().min(1).max(40), mode: z.enum(['less', 'off']).nullable() });
const privateSchema = z.object({ topics: z.array(z.string().trim().min(1).max(40)).max(MAX_PRIVATE) });
const shareSchema = z.object({ to: z.enum(['zas', 'story']), audience: z.enum(['all', 'close']).default('all') });

/**
 * Controlo e resumo do Mixar (0172, docs/mixar-contrato.md, «Controlo e resumo»):
 * GET  /mixar/:id/topics → MixarTopics;  PUT /mixar/:id/topics { topic, mode: 'less' | 'off' | null } → MixarTopics
 * POST /mixar/:id/items/:postId/less → { topic, author, topics }  («Menos disto»: o tema e o autor pesam menos neste Mixar)
 * GET  /mixar/:id/week → MixarWeek;  GET /mixar/:id/week/image → JPEG
 * POST /mixar/:id/week/share { to: 'zas' | 'story', audience? } → 201 { to, id }
 */
@Controller('mixar')
@UseGuards(JwtAuthGuard)
export class MixarControloController {
  constructor(private readonly ctl: MixarControloService) {}

  @Get(':id/topics')
  topics(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.ctl.topics(req.userId!, id);
  }

  @Put(':id/topics')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  setTopic(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(topicSchema)) b: z.infer<typeof topicSchema>) {
    return this.ctl.setTopic(req.userId!, id, b.topic, b.mode);
  }

  @Post(':id/items/:postId/less')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  less(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.ctl.less(req.userId!, id, postId);
  }

  @Get(':id/week')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  week(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.ctl.week(req.userId!, id);
  }

  @Get(':id/week/image')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async weekImage(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const jpg = await this.ctl.weekImage(req.userId!, id);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', 'inline; filename="txillapp-mixar-semana.jpg"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(jpg);
  }

  @NeedsVerifiedEmail()
  @Post(':id/week/share')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  share(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(shareSchema)) b: z.infer<typeof shareSchema>) {
    return this.ctl.shareWeek(req.userId!, id, b.to, b.audience);
  }
}

/** Temas privados (0172): por pessoa, valem para todos os meus Mixar. GET/PUT /me/mixar/private-topics. */
@Controller('me/mixar')
@UseGuards(JwtAuthGuard)
export class MixarPrivateTopicsController {
  constructor(private readonly ctl: MixarControloService) {}

  @Get('private-topics')
  get(@Req() req: AuthedReq) {
    return this.ctl.privateTopics(req.userId!);
  }

  @Put('private-topics')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  put(@Req() req: AuthedReq, @Body(new ZodPipe(privateSchema)) b: z.infer<typeof privateSchema>) {
    return this.ctl.setPrivateTopics(req.userId!, b.topics);
  }
}
