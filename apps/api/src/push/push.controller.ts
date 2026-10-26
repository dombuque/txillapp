import { Throttle } from '@nestjs/throttler';
import { Body, Controller, Delete, Get, HttpCode, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { PushService } from './push.service';

type AuthedReq = Request & { userId?: string };
const subSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
});
const unsubSchema = z.object({ endpoint: z.string().url().max(1000) });

@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('key')
  key() {
    return this.push.publicKey();
  }

  @Post('subscribe')
  @HttpCode(204)
  subscribe(@Req() req: AuthedReq, @Body(new ZodPipe(subSchema)) b: z.infer<typeof subSchema>) {
    if (!this.push.enabled) throw new ServiceUnavailableException('Notificações push não estão ativas neste servidor');
    return this.push.subscribe(req.userId!, b);
  }

  /** "Enviar notificação de teste" (Definições): chega a todos os aparelhos desta conta. */
  @Post('test')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async test(@Req() req: AuthedReq) {
    if (!this.push.enabled) throw new ServiceUnavailableException('Notificações push não estão ativas neste servidor');
    await this.push.send(req.userId!, { title: 'Txillapp', body: 'Funciona! As notificações chegam a este telemóvel 🎉', url: '/settings', tag: 'test' });
  }

  @Delete('subscribe')
  @HttpCode(204)
  unsubscribe(@Req() req: AuthedReq, @Body(new ZodPipe(unsubSchema)) b: z.infer<typeof unsubSchema>) {
    return this.push.unsubscribe(req.userId!, b.endpoint);
  }
}
