import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { REACTIONS, MixarService } from './mixar.service';

type AuthedReq = Request & { userId?: string };

const inviteSchema = z.object({ username: z.string().trim().min(1).max(40) });
const reactSchema = z.object({ reaction: z.enum(REACTIONS).nullable() });
const seenSchema = z.object({ watchedMs: z.number().int().min(0).max(3_600_000).optional(), done: z.boolean().optional() });
const pickSchema = z.object({ postId: z.string().uuid() });

/**
 * Mixar (0150): o contrato completo está em docs/mixar-contrato.md.
 * POST   /mixar/invite { username } → 201 Mixar          (403 bloqueio/regras do chat; 409 { id } se já há; 429 limites)
 * POST   /mixar/:id/accept → Mixar;  POST /mixar/:id/decline → { ok };  DELETE /mixar/:id → { ok } (sair)
 * GET    /mixar → { items: MixarSummary[] };  GET /mixar/with/:username → Mixar | 404;  GET /mixar/:id → Mixar
 * GET    /mixar/:id/feed?cursor=&limit= → { items: MixarItem[], nextCursor, day }
 * POST   /mixar/:id/items/:postId/react { reaction | null } → { mine, theirs }
 * POST   /mixar/:id/items/:postId/seen { watchedMs?, done? } → 204;  POST /mixar/:id/items/:postId/shared → 204
 * GET    /mixar/:id/challenge → Challenge | null;  POST /mixar/:id/challenge/:challengeId/pick { postId } → Challenge
 * Num Mixar pendente, o feed, as reações e o desafio dão 409 («ainda não foi aceite»).
 */
@Controller('mixar')
@UseGuards(JwtAuthGuard)
export class MixarController {
  constructor(private readonly mixar: MixarService) {}

  // Como mandar mensagens (o convite é um cartão no chat): só com o email confirmado.
  @NeedsVerifiedEmail()
  @Post('invite')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  invite(@Req() req: AuthedReq, @Body(new ZodPipe(inviteSchema)) b: z.infer<typeof inviteSchema>) {
    return this.mixar.invite(req.userId!, b.username);
  }

  @Get()
  list(@Req() req: AuthedReq) {
    return this.mixar.list(req.userId!);
  }

  @Get('with/:username')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  withUser(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.mixar.withUser(req.userId!, username);
  }

  @Get(':id')
  get(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.mixar.get(req.userId!, id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  accept(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.mixar.accept(req.userId!, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  decline(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.mixar.decline(req.userId!, id);
  }

  @Delete(':id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  leave(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.mixar.leave(req.userId!, id);
  }

  @Get(':id/feed')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  feed(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 10, 1), 24);
    return this.mixar.feed(req.userId!, id, cursor, n);
  }

  @Post(':id/items/:postId/react')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  react(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string, @Body(new ZodPipe(reactSchema)) b: z.infer<typeof reactSchema>) {
    return this.mixar.react(req.userId!, id, postId, b.reaction);
  }

  @Post(':id/items/:postId/seen')
  @HttpCode(204)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async seen(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string, @Body(new ZodPipe(seenSchema)) b: z.infer<typeof seenSchema>) {
    await this.mixar.seen(req.userId!, id, postId, b.watchedMs, b.done);
  }

  @Post(':id/items/:postId/shared')
  @HttpCode(204)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async shared(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string) {
    await this.mixar.shared(req.userId!, id, postId);
  }

  /** O desafio de hoje, ou `null` em JSON (com `return null` o Nest mandaria a resposta vazia). */
  @Get(':id/challenge')
  async challenge(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res.status(200).json(await this.mixar.challenge(req.userId!, id));
  }

  @Post(':id/challenge/:challengeId/pick')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  pick(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('challengeId', ParseUUIDPipe) challengeId: string, @Body(new ZodPipe(pickSchema)) b: z.infer<typeof pickSchema>) {
    return this.mixar.pick(req.userId!, id, challengeId, b.postId);
  }
}
