import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { REPORT_REASONS } from '../moderation/moderation.service';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { TXILLADA_REACTIONS } from '../chat/chat.events';
import { GIFT_MAX, GOAL_MAX, GOAL_MIN, PRICE_MAX, PRICE_MIN, PURPOSE_MAX, TxilladaService } from './txillada.service';

type AuthedReq = Request & { userId?: string };

/**
 * Os três tipos (0167): 'everyone' (Pública), 'friends' (Para amigos; 'close' com «Só amigos próximos») e 'paid' (Privada,
 * com `price`). 'followers' continua a valer para as apps antigas. A Angariação: `goal` (e `purpose`), em qualquer tipo.
 */
const createSchema = z.object({
  title: z.string().trim().max(80).optional().default(''),
  audience: z.enum(['everyone', 'friends', 'close', 'paid', 'followers']).default('everyone'),
  price: z.number().int().min(PRICE_MIN, `A entrada vai de ${PRICE_MIN} a ${PRICE_MAX} vibes.`).max(PRICE_MAX, `A entrada vai de ${PRICE_MIN} a ${PRICE_MAX} vibes.`).nullable().optional(),
  goal: z.number().int().min(GOAL_MIN, `A meta vai de ${GOAL_MIN} a ${GOAL_MAX} vibes.`).max(GOAL_MAX, `A meta vai de ${GOAL_MIN} a ${GOAL_MAX} vibes.`).nullable().optional(),
  purpose: z.string().trim().max(PURPOSE_MAX).optional().default(''),
});
/** Uma oferta: o valor e a chave de idempotência da app (repetir o pedido não cobra outra vez). */
const giftSchema = z.object({
  amount: z.number().int().min(1).max(GIFT_MAX, `Podes oferecer até ${GIFT_MAX} vibes de cada vez.`),
  key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Chave inválida'),
});
const commentSchema = z.object({ body: z.string().trim().min(1).max(300) });
const reportSchema = z.object({ reason: z.enum(REPORT_REASONS), note: z.string().trim().max(500).optional() });
const afterSchema = z.object({ after: z.string().uuid().optional() });
const pinSchema = z.object({ commentId: z.string().uuid().nullable() });
const cutSchema = z.object({ reason: z.string().trim().min(3, 'Escreve o motivo').max(300) });
const inviteSchema = z.object({ username: z.string().trim().min(1).max(40) });
const reactSchema = z.object({
  kind: z.enum(TXILLADA_REACTIONS),
  /** O @ de quem entrou (só o anfitrião, só com 'hello'). */
  to: z.string().trim().min(1).max(40).optional(),
});

/**
 * Txillada (os lives), fase 1 — as rotas do contrato (docs/txillada-contrato.md). Todas com sessão, menos o webhook do
 * LiveKit (TxilladaWebhookController) e as do backoffice (TxilladaAdminController).
 */
@Controller('txilladas')
@UseGuards(JwtAuthGuard)
export class TxilladaController {
  constructor(private readonly tx: TxilladaService) {}

  @Get('config')
  config() {
    return this.tx.publicConfig();
  }

  @Get('live')
  live(@Req() req: AuthedReq) {
    return this.tx.live(req.userId!);
  }

  @NeedsVerifiedEmail()
  @Post()
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.tx.create(req.userId!, b.title, b.audience, { price: b.price ?? null, goal: b.goal ?? null, purpose: b.purpose });
  }

  @Get(':id')
  get(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.get(req.userId!, id);
  }

  @Post(':id/join')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  join(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.join(req.userId!, id);
  }

  /** Pagar a entrada de uma Txillada privada (0167): uma vez só; pagar outra vez não cobra. */
  @NeedsVerifiedEmail()
  @Post(':id/ticket')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  pay(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.pay(req.userId!, id);
  }

  /** Oferecer Txills durante o live (0167). No máximo 5 a cada 10 s por pessoa (no serviço); aqui o teto por minuto. */
  @NeedsVerifiedEmail()
  @Post(':id/gifts')
  @HttpCode(200)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  gift(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(giftSchema)) b: z.infer<typeof giftSchema>) {
    return this.tx.gift(req.userId!, id, b.amount, b.key);
  }

  @Post(':id/end')
  @HttpCode(200)
  end(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.end(req.userId!, id);
  }

  @Get(':id/comments')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  comments(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(afterSchema)) q: z.infer<typeof afterSchema>) {
    return this.tx.comments(req.userId!, id, q.after);
  }

  @NeedsVerifiedEmail()
  @Post(':id/comments')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  comment(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(commentSchema)) b: z.infer<typeof commentSchema>) {
    return this.tx.comment(req.userId!, id, b.body);
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(204)
  async deleteComment(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('commentId', ParseUUIDPipe) commentId: string) {
    await this.tx.deleteComment(req.userId!, id, commentId);
  }

  /** Brindar um comentário (outra vez tira). No máximo 5 por segundo por pessoa (no serviço); aqui o teto por minuto. */
  @Post(':id/comments/:commentId/cheer')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  cheerComment(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('commentId', ParseUUIDPipe) commentId: string) {
    return this.tx.cheerComment(req.userId!, id, commentId);
  }

  /** Denunciar um comentário (a fila da moderação, tipo 'txillada_comment'): deixa de aparecer a quem denunciou. */
  @Post(':id/comments/:commentId/report')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async reportComment(
    @Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body(new ZodPipe(reportSchema)) b: z.infer<typeof reportSchema>,
  ) {
    await this.tx.reportComment(req.userId!, id, commentId, b.reason, b.note);
  }

  /** Fixar um comentário (`commentId`) ou tirar o fixado (null): só o anfitrião. */
  @Post(':id/pin')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  pin(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(pinSchema)) b: z.infer<typeof pinSchema>) {
    return this.tx.pin(req.userId!, id, b.commentId);
  }

  /** No máximo 5 por segundo por pessoa (no serviço); aqui só o teto por minuto, acima do geral. */
  @Post(':id/cheer')
  @HttpCode(200)
  @Throttle({ default: { limit: 400, ttl: 60_000 } })
  cheer(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.cheer(req.userId!, id);
  }

  /** Reações (não se guardam): no máximo 8 por segundo por pessoa (no serviço); aqui só o teto por minuto. */
  @Post(':id/react')
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  react(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reactSchema)) b: z.infer<typeof reactSchema>) {
    return this.tx.react(req.userId!, id, b.kind, b.to);
  }

  /** Quem está a ver agora. */
  @Get(':id/viewers')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  viewers(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.viewers(req.userId!, id);
  }

  @Post(':id/ban/:username')
  @HttpCode(204)
  async ban(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('username') username: string) {
    await this.tx.ban(req.userId!, id, username.slice(0, 40));
  }

  @Post(':id/report')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async report(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reportSchema)) b: z.infer<typeof reportSchema>) {
    await this.tx.report(req.userId!, id, b.reason, b.note);
  }

  /* Convidados (0165): até 3 a transmitir com o anfitrião. */

  /** Quem vê pede para entrar (1 pedido a cada 20 s, no serviço). Com um convite à espera, aceita-o. */
  @NeedsVerifiedEmail()
  @Post(':id/guests/request')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  requestToJoin(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.requestToJoin(req.userId!, id);
  }

  /** O anfitrião convida alguém que está a ver (`{ username }`). */
  @Post(':id/guests/invite')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  invite(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(inviteSchema)) b: z.infer<typeof inviteSchema>) {
    return this.tx.invite(req.userId!, id, b.username);
  }

  /** Quem foi convidado aceita (passa a transmitir) ou recusa. */
  @Post(':id/guests/accept')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  acceptInvite(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.acceptInvite(req.userId!, id);
  }

  @Post(':id/guests/decline')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  declineInvite(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.declineInvite(req.userId!, id);
  }

  /** Deixar de transmitir (volta a só ver), desistir do pedido ou recusar o convite. */
  @Post(':id/guests/leave')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  leaveGuest(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.leaveGuest(req.userId!, id);
  }

  /** O anfitrião aceita ou recusa um pedido, ou tira alguém de transmitir (também retira um convite). */
  @Post(':id/guests/:username/accept')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  acceptRequest(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('username') username: string) {
    return this.tx.acceptRequest(req.userId!, id, username.slice(0, 40));
  }

  @Post(':id/guests/:username/decline')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  declineRequest(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('username') username: string) {
    return this.tx.declineRequest(req.userId!, id, username.slice(0, 40));
  }

  @Post(':id/guests/:username/remove')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  removeGuest(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('username') username: string) {
    return this.tx.removeGuest(req.userId!, id, username.slice(0, 40));
  }
}

/**
 * O webhook do LiveKit (sem sessão: assinado com as chaves do LiveKit, validado com o WebhookReceiver). O corpo chega como
 * texto (Content-Type application/webhook+json; ver main.ts) para a assinatura bater certo com os bytes recebidos.
 */
@Controller('txilladas')
@SkipThrottle()
export class TxilladaWebhookController {
  constructor(private readonly tx: TxilladaService) {}

  @Post('livekit-webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request, @Headers('authorization') auth: string | undefined) {
    const body = typeof req.body === 'string' ? req.body : req.body && typeof req.body === 'object' && Object.keys(req.body).length ? JSON.stringify(req.body) : '';
    await this.tx.webhook(body, auth);
    return { ok: true };
  }
}

/** Backoffice: as Txilladas a decorrer (com denúncias) e o «Cortar». */
@Controller('admin/txilladas')
@UseGuards(StaffGuard)
export class TxilladaAdminController {
  constructor(private readonly tx: TxilladaService) {}

  @Get()
  @Needs('reports.read')
  list() {
    return this.tx.adminList();
  }

  @Post(':id/cut')
  @HttpCode(204)
  @Needs('reports.decide')
  async cut(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cutSchema)) b: z.infer<typeof cutSchema>) {
    await this.tx.adminCut(req.userId!, id, b.reason);
  }
}
