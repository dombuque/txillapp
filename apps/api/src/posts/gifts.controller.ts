import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { requireIdempotencyKey } from '../wallet/wallet.controller';
import { PostsService } from './posts.service';

const schema = z.object({
  toUsername: z.string().trim().min(1).max(30),
  amount: z.number().int().positive(),
  note: z.string().trim().max(280).default(''),
  publish: z.boolean().default(false),
});

@Controller('gifts')
@UseGuards(JwtAuthGuard)
export class GiftsController {
  constructor(private readonly posts: PostsService) {}

  /** Presentear alguém com Txills (demonstração), opcionalmente anunciando no feed. */
  @Post()
  @HttpCode(201)
  gift(@Req() req: Request & { userId?: string }, @Body(new ZodPipe(schema)) b: z.infer<typeof schema>, @Headers('idempotency-key') key?: string) {
    return this.posts.giftUser(req.userId!, b.toUsername.replace(/^@/, ''), b.amount, requireIdempotencyKey(key), b.note, b.publish);
  }
}
