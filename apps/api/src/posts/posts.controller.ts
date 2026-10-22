import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { requireIdempotencyKey } from '../wallet/wallet.controller';
import { visibilitySchema } from './gifts.controller';
import { MAX_PHOTOS, PostsService } from './posts.service';

type AuthedReq = Request & { userId?: string };

const createSchema = z.object({
  body: z.string().trim().max(2000).default(''),
  locationLabel: z.string().trim().max(80).optional(),
  mediaIds: z.array(z.string().uuid()).max(MAX_PHOTOS).default([]),
});
const repostSchema = z.object({ body: z.string().trim().max(500).default('') });
const giftSchema = z.object({
  amount: z.number().int().positive(),
  note: z.string().trim().max(280).default(''),
  visibility: visibilitySchema,
});

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.posts.create(req.userId!, b.body, b.locationLabel, b.mediaIds);
  }

  @Get()
  feed(@Req() req: AuthedReq, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 50);
    return this.posts.feed(req.userId!, cursor, n);
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
}
