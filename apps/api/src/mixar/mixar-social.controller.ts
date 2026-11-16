import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { COMMENT_MAX, MixarSocialService } from './mixar-social.service';

type AuthedReq = Request & { userId?: string };

const commentSchema = z.object({ body: z.string().trim().min(1, 'Escreve alguma coisa').max(COMMENT_MAX, `No máximo ${COMMENT_MAX} caracteres`) });
const presenceSchema = z.object({ postId: z.string().uuid().nullable().optional(), leave: z.boolean().optional() });

/**
 * Mixar, social e guardados (0171, docs/mixar-contrato.md, «Social e guardados»):
 * GET    /mixar/:id/items/:postId/comments?cursor=&limit= → { items: MixarComment[], nextCursor }  (só os dois)
 * POST   /mixar/:id/items/:postId/comments { body } → 201 MixarComment;  DELETE /mixar/:id/comments/:commentId → { ok } (só o meu)
 * GET    /mixar/:id/social?posts=a,b,c → { items: { postId, comments, saved }[] }
 * POST   /mixar/:id/saved/:postId → { saved: true };  DELETE /mixar/:id/saved/:postId → { saved: false }
 * GET    /mixar/:id/saved?cursor=&limit= → { items: MixarSavedItem[], nextCursor }
 * GET    /mixar/:id/more → { left };  POST /mixar/:id/more → { added, left }  (429 depois de 3 vezes no dia)
 * POST   /mixar/:id/presence { postId?, leave? } → { partner: { here, postId } }
 */
@Controller('mixar')
@UseGuards(JwtAuthGuard)
export class MixarSocialController {
  constructor(private readonly social: MixarSocialService) {}

  @Get(':id/items/:postId/comments')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  comments(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 30, 1), 50);
    return this.social.comments(req.userId!, id, postId, cursor, n);
  }

  // Como os outros comentários: só com o email confirmado.
  @NeedsVerifiedEmail()
  @Post(':id/items/:postId/comments')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  comment(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string, @Body(new ZodPipe(commentSchema)) b: z.infer<typeof commentSchema>) {
    return this.social.comment(req.userId!, id, postId, b.body);
  }

  @Delete(':id/comments/:commentId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  deleteComment(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('commentId', ParseUUIDPipe) commentId: string) {
    return this.social.deleteComment(req.userId!, id, commentId);
  }

  @Get(':id/social')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  socialOf(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Query('posts') posts?: string) {
    return this.social.social(req.userId!, id, (posts ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  }

  @Get(':id/saved')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  saved(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 10, 1), 24);
    return this.social.saved(req.userId!, id, cursor, n);
  }

  @Post(':id/saved/:postId')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  save(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.social.save(req.userId!, id, postId);
  }

  @Delete(':id/saved/:postId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  unsave(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string) {
    return this.social.unsave(req.userId!, id, postId);
  }

  @Get(':id/more')
  moreLeft(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.moreLeft(req.userId!, id);
  }

  @Post(':id/more')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  more(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.more(req.userId!, id);
  }

  @Post(':id/presence')
  @HttpCode(200)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  presence(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(presenceSchema)) b: z.infer<typeof presenceSchema>) {
    return this.social.presence(req.userId!, id, b.postId ?? null, !!b.leave);
  }
}
