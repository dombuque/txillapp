import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { SuperTxillService } from './supertxill.service';

type AuthedReq = Request & { userId?: string };
const askSchema = z.object({ text: z.string().trim().min(1).max(1000) });

/** O SuperTxill, na barra de pesquisa: perguntar, ver o histórico e apagá-lo. */
@Controller('supertxill')
@UseGuards(JwtAuthGuard)
export class SuperTxillController {
  constructor(private readonly bot: SuperTxillService) {}

  @Get()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  thread(@Req() req: AuthedReq) {
    return this.bot.thread(req.userId!);
  }

  /** O modelo próprio: pessoas para ti, a partir dos dados do Txillapp. */
  @Get('for-you')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  forYou(@Req() req: AuthedReq) {
    return this.bot.forYou(req.userId!);
  }

  @Post('ask')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  ask(@Req() req: AuthedReq, @Body(new ZodPipe(askSchema)) b: z.infer<typeof askSchema>) {
    return this.bot.ask(req.userId!, b.text);
  }

  @Post('clear')
  @HttpCode(204)
  clear(@Req() req: AuthedReq) {
    return this.bot.clear(req.userId!);
  }
}
