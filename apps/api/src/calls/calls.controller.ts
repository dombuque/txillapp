import { BadRequestException, Body, Controller, Delete, ExecutionContext, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { CallsService } from './calls.service';

type AuthedReq = Request & { userId?: string };
const createSchema = z.object({ username: z.string().trim().min(1).max(40), video: z.boolean() });
const declineSchema = z.object({ message: z.string().trim().max(200).optional() }).optional();
const signalSchema = z.object({ type: z.enum(['offer', 'answer', 'ice']), data: z.any() });

/** Chamadas de voz e vídeo 1:1. Os eventos em tempo real e as regras estão descritos no topo de calls.service.ts. */
@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @NeedsVerifiedEmail()
  @Post()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.calls.create(req.userId!, b.username, b.video);
  }

  /** Servidores ICE (STUN e, se houver, TURN com credenciais temporárias de 6 horas). */
  @Get('ice')
  ice(@Req() req: AuthedReq) {
    return this.calls.iceFor(req.userId!);
  }

  @Get()
  history(@Req() req: AuthedReq, @Query('cursor') cursor?: string) {
    return this.calls.history(req.userId!, cursor);
  }

  /** Apagar todo o meu histórico de chamadas (o do outro lado fica). */
  @Delete()
  hideAll(@Req() req: AuthedReq) {
    return this.calls.hideAll(req.userId!);
  }

  /** Apagar uma chamada do meu histórico. */
  @Delete(':id')
  hide(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.hide(req.userId!, id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.accept(req.userId!, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(declineSchema)) b: z.infer<typeof declineSchema>) {
    return this.calls.decline(req.userId!, id, b?.message);
  }

  @Post(':id/end')
  @HttpCode(200)
  end(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.end(req.userId!, id);
  }

  /** Oferta, resposta ou candidato ICE: passa tal e qual para o outro lado. Muitos candidatos de seguida, por isso o limite é largo. */
  @Post(':id/signal')
  @HttpCode(204)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async signal(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(signalSchema)) b: z.infer<typeof signalSchema>) {
    await this.calls.signal(req.userId!, id, b.type, b.data);
  }
}

const declinePushSchema = z.object({ token: z.string().min(16).max(200) });

/** Com `?ack=` não pede sessão (o código é verificado no serviço); sem ele, é a sessão normal. */
@Injectable()
class SessionOrAckGuard extends JwtAuthGuard {
  async canActivate(ctx: ExecutionContext) {
    const ack = ctx.switchToHttp().getRequest<Request>().query.ack;
    if (typeof ack === 'string' && ack) return true;
    return super.canActivate(ctx);
  }
}

/**
 * Recusar pelo botão da notificação do browser. O service worker não tem a sessão (cookie HttpOnly e token na memória da
 * página), por isso não usa a conta: só o código que veio no aviso Web Push desta chamada (vale só para recusar esta).
 */
@Controller('calls')
export class CallsPushController {
  constructor(private readonly calls: CallsService) {}

  /**
   * «A chamada chegou a este aparelho» (quem liga passa a ver «A tocar…»). Com sessão: a app aberta, quando recebe o
   * `ring`. Sem sessão, com `?ack=<ackToken>` do aviso push: o service worker do browser e a app Android fechada.
   */
  @Post(':id/ringing')
  @HttpCode(200)
  @UseGuards(SessionOrAckGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  ringing(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Query('ack') ack?: string | string[]) {
    if (Array.isArray(ack)) throw new BadRequestException('ack inválido');
    return this.calls.ringing(req.userId ?? null, id, ack || undefined);
  }

  @Post(':id/decline-push')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  declinePush(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(declinePushSchema)) b: z.infer<typeof declinePushSchema>) {
    return this.calls.declineFromPush(id, b.token);
  }
}
