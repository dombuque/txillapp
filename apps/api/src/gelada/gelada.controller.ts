import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { GeladaService } from './gelada.service';

type AuthedReq = Request & { userId?: string };

const handle = z.string().trim().min(1).max(40);
/** Os ids do catálogo vêm de md5 (sem versão de UUID): só se confirma o feitio. */
const itemId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Bebida inválida');
const askSchema = z.object({
  to: z.array(handle).min(1).max(10),
  itemId,
  /** No chat (um cartão em cada conversa) ou publicado (uma publicação com cada pessoa identificada). */
  channel: z.enum(['chat', 'post']).default('chat'),
  /** Legenda da publicação (opcional). */
  caption: z.string().max(300).optional(),
});
const answerSchema = z.object({ answer: z.enum(['accept', 'decline', 'owe']) });
const oweSchema = z.object({ to: handle, itemId });
const paidSchema = z
  .object({
    mediaId: z.string().uuid().optional(),
    venueSlug: z.string().trim().min(1).max(80).optional(),
    /** A posição do telemóvel agora (só com o local): para o selo «✓ estiveram lá». Não se guarda. */
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .refine((b) => (b.lat === undefined) === (b.lng === undefined), { message: 'Manda a latitude e a longitude juntas' });
const entrySchema = z.object({ itemId });
const closeSchema = z.object({ bill: z.boolean().optional() });
const drinksSchema = z.object({ to: z.string().max(440).optional() });

/**
 * «Paga-me uma» (0145). Contrato:
 * GET  /gelada/drinks?to=ana,rui -> { soft, drinks: [{ id, slug, name, category, alcoholic, mine, favorite }], suggested: id | null, left, max }
 * POST /gelada/requests { to: [username] (1..10), itemId, channel: 'chat' | 'post', caption? } -> { requests: [Request], post: Post | null } (201)
 *      403 { message } (bloqueio, mensagens, menções, não mútuo), 404 (pessoa ou bebida), 429 (10 por dia / 3 ao mesmo amigo)
 * GET  /gelada/requests/:id -> Request
 * POST /gelada/requests/:id/answer { answer: 'accept' | 'decline' | 'owe' } -> { request, debt: Debt | null, chatWith: username | null }
 *      (só quem recebeu; 409 se já respondeu)
 * GET  /gelada/book -> { scope: 'all', public, owe, owed, items: [Debt] }   (o meu livro)
 * GET  /users/:username/gelada/book -> { scope: 'all' | 'between', owe, owed, items }
 * POST /gelada/debts { to, itemId } -> Debt (201)   «Fico a dever-te uma»
 * POST /gelada/debts/:id/paid { mediaId?, venueSlug?, lat?, lng? } -> Debt   «Já paguei» (o devedor). Com o local e a posição:
 *      `venue.there` (dentro de 150 m, ou check-in com QR na mesma hora). A posição não se guarda.
 * POST /gelada/debts/:id/confirm | /reject | /forgive -> Debt   (quem recebe)
 * POST /chat/groups/:id/rodadas -> Round (201)   «Abrir rodada» (409 se já há uma aberta)
 * GET  /gelada/rounds/:id -> Round
 * PUT  /gelada/rounds/:id/entry { itemId } -> Round   «Eu entro»;  DELETE -> Round (sair)
 * PUT  /gelada/rounds/:id/payer -> Round   «Esta pago eu»;  DELETE -> Round
 * POST /gelada/rounds/:id/close { bill? } -> Round
 * Request, Round: ver gelada-cards.ts (RequestDto, RoundDto). Debt: DebtDto em gelada.service.ts.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class GeladaController {
  constructor(private readonly gelada: GeladaService) {}

  @Get('gelada/drinks')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  drinks(@Req() req: AuthedReq, @Query(new ZodPipe(drinksSchema)) q: z.infer<typeof drinksSchema>) {
    return this.gelada.drinks(req.userId!, (q.to ?? '').split(',').filter(Boolean));
  }

  // Como mandar mensagens: só com o email confirmado.
  @NeedsVerifiedEmail()
  @Post('gelada/requests')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  ask(@Req() req: AuthedReq, @Body(new ZodPipe(askSchema)) b: z.infer<typeof askSchema>) {
    return this.gelada.ask(req.userId!, b);
  }

  @Get('gelada/requests/:id')
  request(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.gelada.request(req.userId!, id);
  }

  @Post('gelada/requests/:id/answer')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  answer(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(answerSchema)) b: z.infer<typeof answerSchema>) {
    return this.gelada.answer(req.userId!, id, b.answer);
  }

  @Get('gelada/book')
  myBook(@Req() req: AuthedReq) {
    return this.gelada.book(req.userId!);
  }

  @Get('users/:username/gelada/book')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  book(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.gelada.book(req.userId!, username);
  }

  // Como mandar mensagens: só com o email confirmado.
  @NeedsVerifiedEmail()
  @Post('gelada/debts')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  owe(@Req() req: AuthedReq, @Body(new ZodPipe(oweSchema)) b: z.infer<typeof oweSchema>) {
    return this.gelada.oweManual(req.userId!, b.to, b.itemId);
  }

  @Post('gelada/debts/:id/paid')
  @HttpCode(200)
  paid(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(paidSchema)) b: z.infer<typeof paidSchema>) {
    const at = b.venueSlug && b.lat !== undefined && b.lng !== undefined ? { lat: b.lat, lng: b.lng } : undefined;
    return this.gelada.claimPaid(req.userId!, id, { mediaId: b.mediaId, venueSlug: b.venueSlug, at });
  }

  @Post('gelada/debts/:id/confirm')
  @HttpCode(200)
  confirm(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.gelada.confirmPaid(req.userId!, id);
  }

  @Post('gelada/debts/:id/reject')
  @HttpCode(200)
  reject(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.gelada.rejectPaid(req.userId!, id);
  }

  @Post('gelada/debts/:id/forgive')
  @HttpCode(200)
  forgive(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.gelada.forgive(req.userId!, id);
  }

  // Como mandar mensagens: só com o email confirmado.
  @NeedsVerifiedEmail()
  @Post('chat/groups/:id/rodadas')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  openRound(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.gelada.openRound(req.userId!, id);
  }

  @Get('gelada/rounds/:id')
  round(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.gelada.round(req.userId!, id);
  }

  @Put('gelada/rounds/:id/entry')
  join(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(entrySchema)) b: z.infer<typeof entrySchema>) {
    return this.gelada.joinRound(req.userId!, id, b.itemId);
  }

  @Delete('gelada/rounds/:id/entry')
  leave(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.gelada.leaveRound(req.userId!, id);
  }

  @Put('gelada/rounds/:id/payer')
  pay(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.gelada.payRound(req.userId!, id, true);
  }

  @Delete('gelada/rounds/:id/payer')
  unpay(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.gelada.payRound(req.userId!, id, false);
  }

  @Post('gelada/rounds/:id/close')
  @HttpCode(200)
  close(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(closeSchema)) b: z.infer<typeof closeSchema>) {
    return this.gelada.closeRound(req.userId!, id, !!b.bill);
  }
}
