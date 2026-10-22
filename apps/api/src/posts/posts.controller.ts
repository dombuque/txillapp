import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { requireIdempotencyKey } from '../wallet/wallet.controller';
import { PostsService } from './posts.service';

type AuthedReq = Request & { userId?: string };

const createSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  locationLabel: z.string().trim().max(80).optional(),
  mediaId: z.string().uuid().optional(),
});
const commentSchema = z.object({ body: z.string().trim().min(1).max(1000) });
const giftSchema = z.object({ amount: z.number().int().positive() });

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.posts.create(req.userId!, b.body, b.locationLabel, b.mediaId);
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

  @Get(':id/comments')
  comments(@Param('id', ParseUUIDPipe) id: string) {
    return this.posts.listComments(id);
  }

  @Post(':id/comments')
  comment(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(commentSchema)) b: z.infer<typeof commentSchema>) {
    return this.posts.addComment(req.userId!, id, b.body);
  }

  @Post(':id/gifts')
  @HttpCode(201)
  gift(
    @Req() req: AuthedReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(giftSchema)) b: z.infer<typeof giftSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.posts.gift(req.userId!, id, b.amount, requireIdempotencyKey(key));
  }
}
