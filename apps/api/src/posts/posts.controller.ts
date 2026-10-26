import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { Throttle } from '@nestjs/throttler';
import { ZodPipe } from '../common/zod.pipe';
import { requireIdempotencyKey } from '../wallet/wallet.controller';
import { visibilitySchema } from './gifts.controller';
import { MAX_PHOTOS, PostsService } from './posts.service';

type AuthedReq = Request & { userId?: string };

const createSchema = z.object({
  body: z.string().trim().max(2000).default(''),
  locationLabel: z.string().trim().max(80).optional(),
  mediaIds: z.array(z.string().uuid()).max(MAX_PHOTOS).default([]),
  tags: z.array(z.object({ index: z.number().int().min(0).max(MAX_PHOTOS - 1), username: z.string().min(3).max(30), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(30).default([]),
});
const repostSchema = z.object({ body: z.string().trim().max(500).default('') });
const giftSchema = z.object({
  amount: z.number().int().positive(),
  note: z.string().trim().max(280).default(''),
  visibility: visibilitySchema,
});

const seenSchema = z.object({ ids: z.array(z.string().uuid()).max(40) });
const hideSchema = z.object({ postId: z.string().uuid() });

/** Feed por relevância: o que aparece primeiro depende de ti, não só da hora. */
@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  feed(@Req() req: AuthedReq, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 10, 1), 30);
    return this.posts.rankedFeed(req.userId!, cursor, n);
  }

  /** Vídeos curtos (Reels): os que mais te vão interessar, sem repetir os que já viste. */
  @Get('reels')
  reels(@Req() req: AuthedReq, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 6, 1), 15);
    return this.posts.rankedFeed(req.userId!, cursor, n, 'reels');
  }

  @Post('seen')
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  seen(@Req() req: AuthedReq, @Body(new ZodPipe(seenSchema)) b: z.infer<typeof seenSchema>) {
    return this.posts.markSeen(req.userId!, b.ids);
  }

  @Post('hide')
  @HttpCode(204)
  hide(@Req() req: AuthedReq, @Body(new ZodPipe(hideSchema)) b: z.infer<typeof hideSchema>) {
    return this.posts.hideFromFeed(req.userId!, b.postId);
  }
}

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.posts.create(req.userId!, b.body, b.locationLabel, b.mediaIds, b.tags);
  }

  @Get()
  feed(@Req() req: AuthedReq, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 50);
    return this.posts.feed(req.userId!, cursor, n);
  }

  @Get(':id/people/:kind')
  people(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string) {
    if (kind !== 'reposts' && kind !== 'cheers' && kind !== 'gifts') throw new BadRequestException('Lista inválida');
    return this.posts.people(req.userId!, id, kind);
  }

  @Delete(':id')
  @HttpCode(204)
  removeOwn(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.removeOwn(req.userId!, id);
  }

  @Delete(':id/tags/me')
  untagMe(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.untagMe(req.userId!, id);
  }

  @Post(':id/cheers')
  @HttpCode(200)
  cheer(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.toggleCheer(req.userId!, id);
  }

  /** Repostar (sozinho ou com comentário). */
  @Post(':id/repost')
  @HttpCode(201)
  repost(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(repostSchema)) b: z.infer<typeof repostSchema>) {
    return this.posts.repost(req.userId!, id, b.body);
  }

  @Delete(':id/repost')
  unrepost(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.unrepost(req.userId!, id);
  }

  @Post(':id/gifts')
  @HttpCode(201)
  gift(
    @Req() req: AuthedReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(giftSchema)) b: z.infer<typeof giftSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.posts.gift(req.userId!, id, b.amount, requireIdempotencyKey(key), b.note, b.visibility);
  }

  /** Uma publicação (para abrir a partir de notificações e ligações). Última rota: não esconde as outras. */
  @Get(':id')
  one(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.getOne(req.userId!, id);
  }
}
