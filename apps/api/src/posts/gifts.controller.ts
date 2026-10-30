import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { Body, Controller, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { requireIdempotencyKey } from '../wallet/wallet.controller';
import { PostsService } from './posts.service';

/** discreto = só o presente · private = mensagem só para o destinatário · public = post no feed */
export const visibilitySchema = z.enum(['silent', 'private', 'public']).default('silent');

const schema = z.object({
  toUsername: z.string().trim().min(1).max(30),
  amount: z.number().int().positive(),
  note: z.string().trim().max(280).default(''),
  visibility: visibilitySchema,
});
const publishSchema = z.object({ note: z.string().trim().max(280).optional() });

@Controller('gifts')
@UseGuards(JwtAuthGuard)
export class GiftsController {
  constructor(private readonly posts: PostsService) {}

  /** Presentear alguém com Txills (demonstração), de onde quer que seja. */
  @NeedsVerifiedEmail()
  @Post()
  @HttpCode(201)
  gift(@Req() req: Request & { userId?: string }, @Body(new ZodPipe(schema)) b: z.infer<typeof schema>, @Headers('idempotency-key') key?: string) {
    return this.posts.giftUser(req.userId!, b.toUsername.replace(/^@/, ''), b.amount, requireIdempotencyKey(key), b.note, b.visibility);
  }

  /** Decidir publicar DEPOIS de ter enviado o presente. */
  @Post(':transactionId/publish')
  @HttpCode(201)
  publish(@Req() req: Request & { userId?: string }, @Param('transactionId') id: string, @Body(new ZodPipe(publishSchema)) b: z.infer<typeof publishSchema>) {
    return this.posts.publishGift(req.userId!, id, b.note);
  }
}
