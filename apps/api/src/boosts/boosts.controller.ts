import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { BOOST_PACKAGE_IDS, BOOST_PAYMENT_IDS, BOOST_RADIUS } from './boost-config';
import { BoostsService } from './boosts.service';

type AuthedReq = Request & { userId?: string };

const createSchema = z.object({
  target: z.object({ kind: z.enum(['event', 'post']), id: z.string().uuid() }),
  package: z.enum(BOOST_PACKAGE_IDS),
  /** Obrigatório com Txills; nas compras pela loja (`source: 'iap'`) não conta: o raio é o fixo do pacote. */
  radiusKm: z.number().int().min(BOOST_RADIUS.min).max(BOOST_RADIUS.max).optional(),
  /** 'iap': a campanha fica em rascunho até a compra na App Store ou no Google Play ser verificada (POST /iap/…/verify). */
  source: z.enum(['txills', 'iap']).optional(),
  /** Com 'iap': o id do produto da loja (tem de ser o deste pacote, ex.: txillapp.bombar.3d). */
  pack: z.string().trim().min(1).max(150).optional(),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  /** Preparado para os meticais; por agora só 'txills' está ligado (os outros dão 422). */
  payment: z.enum(BOOST_PAYMENT_IDS).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});
const tapSchema = z.object({ surface: z.enum(['feed', 'map']).default('feed') });
const suspendSchema = z.object({ note: z.string().trim().max(300).optional(), refund: z.boolean().default(false) });

/** A chave de idempotência vem no corpo (`idempotencyKey`) ou no cabeçalho Idempotency-Key. */
function idemKey(body?: string, header?: string): string {
  const k = body ?? header;
  if (!k || k.length < 8 || k.length > 100) throw new BadRequestException('Falta a chave de idempotência (idempotencyKey, 8 a 100 caracteres)');
  return k;
}

/**
 * Bombar (destaques pagos dos locais).
 * - GET  /boosts/venue/:slug/options  -> pacotes, preços por raio, pagamentos, saldo, eventos e publicações que se podem bombar.
 * - GET  /boosts/venue/:slug          -> { balance, active: Campaign[], past: Campaign[] } com o relatório (só totais).
 * - POST /boosts/venue/:slug          { target: { kind, id }, package, radiusKm, startsAt?, payment?, idempotencyKey } -> 201 { campaign, balance, replayed }
 *   Com `source: 'iap'` (compra pela loja): sem radiusKm (é o fixo do pacote) e com a chave opcional; a campanha fica em
 *   `state: 'draft'` (não aparece a ninguém) até a compra ser verificada em POST /iap/apple/verify ou /iap/google/verify.
 * - POST /boosts/:id/stop             -> { campaign, refunded }
 * - POST /boosts/:id/tap              { surface: 'feed' | 'map' } -> 204 (quem vê tocou no destaque)
 * - POST /boosts/:id/hide             -> 204 (quem vê não quer mais destaques deste local)
 * Só o dono e os administradores do local veem, criam e param campanhas.
 */
@Controller('boosts')
@UseGuards(JwtAuthGuard)
export class BoostsController {
  constructor(private readonly boosts: BoostsService) {}

  @Get('venue/:slug/options')
  options(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.boosts.options(req.userId!, slug);
  }

  @Get('venue/:slug')
  list(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.boosts.list(req.userId!, slug);
  }

  @Post('venue/:slug')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  create(@Req() req: AuthedReq, @Param('slug') slug: string, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>, @Headers('idempotency-key') key?: string) {
    if (b.source === 'iap') return this.boosts.createIapDraft(req.userId!, slug, b, b.idempotencyKey ?? key ?? null);
    if (b.radiusKm === undefined) throw new BadRequestException('Falta o raio (radiusKm)');
    return this.boosts.create(req.userId!, slug, { ...b, radiusKm: b.radiusKm }, idemKey(b.idempotencyKey, key));
  }

  @Post(':id/stop')
  @HttpCode(200)
  stop(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.boosts.stop(req.userId!, id);
  }

  @Post(':id/tap')
  @HttpCode(204)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async tap(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(tapSchema)) b: z.infer<typeof tapSchema>) {
    await this.boosts.tap(req.userId!, id, b.surface);
  }

  @Post(':id/hide')
  @HttpCode(204)
  async hide(@Req() req: AuthedReq, @Param('id') id: string) {
    await this.boosts.hideVenue(req.userId!, id);
  }
}

/** Para a equipa (backoffice "Locais"): ver as campanhas, suspender (com ou sem devolução) e repor. Fica na auditoria. */
@Controller('venues/admin/boosts')
@UseGuards(JwtAuthGuard)
export class BoostsAdminController {
  constructor(private readonly boosts: BoostsService) {}

  @Get()
  @UseGuards(StaffGuard)
  @Needs('catalog.manage')
  list(@Query('filter') filter?: string) {
    return this.boosts.adminList(filter === 'all' ? 'all' : 'live');
  }

  @Put(':id/suspend')
  @UseGuards(StaffGuard)
  @Needs('catalog.manage')
  suspend(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(suspendSchema)) b: z.infer<typeof suspendSchema>) {
    return this.boosts.suspend(req.userId!, id, b.note?.trim() || null, b.refund);
  }

  @Put(':id/reinstate')
  @UseGuards(StaffGuard)
  @Needs('catalog.manage')
  reinstate(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.boosts.reinstate(req.userId!, id);
  }
}
