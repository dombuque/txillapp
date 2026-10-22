import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { WalletService } from './wallet.service';

const transferSchema = z.object({
  toUsername: z.string().min(1).max(30),
  amount: z.number().int().positive(),
  note: z.string().max(140).optional(),
});

export function requireIdempotencyKey(key?: string): string {
  if (!key || key.length < 8 || key.length > 100) {
    throw new BadRequestException('Cabeçalho Idempotency-Key (8-100 caracteres) é obrigatório');
  }
  return key;
}

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  get(@Req() req: Request & { userId?: string }) {
    return this.wallet.getWallet(req.userId!);
  }

  @Post('transfers')
  @HttpCode(201)
  transfer(
    @Req() req: Request & { userId?: string },
    @Body(new ZodPipe(transferSchema)) body: z.infer<typeof transferSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.wallet.transferToUsername(req.userId!, body.toUsername, body.amount, requireIdempotencyKey(key), body.note);
  }
}
