import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { PostsService } from '../posts/posts.service';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { MANAGER_ROLES, VENUE_KINDS, VenuesService } from './venues.service';

type AuthedReq = Request & { userId?: string };

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const profileFields = {
  city: text(60),
  about: text(1000),
  address: text(160),
  hours: text(300),
  phone: text(30),
  whatsapp: text(30),
  website: text(200),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  /** Aparecer no mapa e em "perto de mim" (por omissão sim). Desligado, o local continua na pesquisa por nome e na página. */
  showOnMap: z.boolean().optional(),
};
const createSchema = z.object({ name: z.string().trim().min(2).max(80), kind: z.enum(VENUE_KINDS), ...profileFields });
const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  kind: z.enum(VENUE_KINDS).optional(),
  ...profileFields,
  avatarMediaId: z.string().uuid().nullable().optional(),
  coverMediaId: z.string().uuid().nullable().optional(),
  acceptsTxills: z.boolean().optional(),
});
const paySchema = z.object({
  amount: z.number().int().min(1).max(100_000),
  note: z.string().trim().max(120).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

/** A chave de idempotência vem no corpo (`idempotencyKey`) ou no cabeçalho Idempotency-Key. */
export function idemKey(body?: string, header?: string): string {
  const k = body ?? header;
  if (!k || k.length < 8 || k.length > 100) throw new BadRequestException('Falta a chave de idempotência (idempotencyKey, 8 a 100 caracteres)');
  return k;
}
const inviteSchema = z.object({ username: z.string().trim().min(3).max(31), role: z.enum(MANAGER_ROLES) });
const roleSchema = z.object({ role: z.enum(MANAGER_ROLES) });
const reviewSchema = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).optional() });

/** Locais: páginas com dono e gestores, perfil, seguidores, publicações como o local, selo e check-in por QR. */
@Controller('venues')
@UseGuards(JwtAuthGuard)
export class VenuesController {
  constructor(private readonly venues: VenuesService, private readonly posts: PostsService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.venues.create(req.userId!, b);
  }

  /** Para a equipa: os locais (por verificar, ou todos). */
  @Get('admin/list')
  @UseGuards(StaffGuard)
  @Needs('catalog.manage')
  adminList(@Query('filter') filter?: string) {
    return this.venues.adminList(filter === 'all' ? 'all' : filter === 'unverified' ? 'unverified' : 'pending');
  }

  /** As minhas páginas (que criei ou giro). */
  @Get('mine')
  mine(@Req() req: AuthedReq) {
    return this.venues.mine(req.userId!);
  }

  /** Convites por aceitar para gerir páginas. */
  @Get('invites')
  invites(@Req() req: AuthedReq) {
    return this.venues.invites(req.userId!);
  }

  @Get('find')
  find(@Req() req: AuthedReq, @Query('name') name = '') {
    return this.venues.findByName(req.userId!, name);
  }

  @Get('search')
  search(@Req() req: AuthedReq, @Query('q') q = '') {
    return this.venues.search(req.userId!, q);
  }

  /** Descobrir locais: perto de mim (com lat/lng) e os mais movimentados. */
  @Get('discover')
  discover(@Req() req: AuthedReq, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    const la = Number(lat), ln = Number(lng);
    const at = lat && lng && Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 ? { lat: la, lng: ln } : null;
    return this.venues.discover(req.userId!, at);
  }

  @Get(':slug')
  get(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.venues.get(req.userId!, slug);
  }

  /** Editar o perfil da página (dono e administradores). */
  @Patch(':slug')
  update(@Req() req: AuthedReq, @Param('slug') slug: string, @Body(new ZodPipe(updateSchema)) b: z.infer<typeof updateSchema>) {
    return this.venues.update(req.userId!, slug, b);
  }

  /** Pagar ao local com Txills da minha carteira (só se o local aceitar Txills). */
  @Post(':slug/pay')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  pay(@Req() req: AuthedReq, @Param('slug') slug: string, @Body(new ZodPipe(paySchema)) b: z.infer<typeof paySchema>, @Headers('idempotency-key') key?: string) {
    return this.venues.pay(req.userId!, slug, b.amount, b.note, idemKey(b.idempotencyKey, key));
  }

  /** Os pagamentos em Txills recebidos (só quem gere o local). */
  @Get(':slug/payments')
  payments(@Req() req: AuthedReq, @Param('slug') slug: string, @Query('cursor') cursor?: string) {
    return this.venues.payments(req.userId!, slug, cursor);
  }

  /** As publicações feitas como este local. */
  @Get(':slug/posts')
  async posts_(@Req() req: AuthedReq, @Param('slug') slug: string, @Query('cursor') cursor?: string) {
    const v = await this.venues.get(req.userId!, slug);
    return this.posts.byVenue(req.userId!, v.id, cursor, 12);
  }

  @Put(':slug/follow')
  follow(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.venues.follow(req.userId!, slug, true);
  }

  @Delete(':slug/follow')
  unfollow(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.venues.follow(req.userId!, slug, false);
  }

  @Get(':slug/managers')
  managers(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.venues.managers(req.userId!, slug);
  }

  /** Convidar @alguém para gerir a página (administrador ou editor). */
  @Post(':slug/managers')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  invite(@Req() req: AuthedReq, @Param('slug') slug: string, @Body(new ZodPipe(inviteSchema)) b: z.infer<typeof inviteSchema>) {
    return this.venues.invite(req.userId!, slug, b.username, b.role);
  }

  /** Aceitar ou recusar o convite (quem foi convidado). */
  @Post(':slug/managers/accept')
  @HttpCode(200)
  accept(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.venues.answerInvite(req.userId!, slug, true);
  }

  @Post(':slug/managers/decline')
  @HttpCode(200)
  decline(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.venues.answerInvite(req.userId!, slug, false);
  }

  @Patch(':slug/managers/:username')
  setRole(@Req() req: AuthedReq, @Param('slug') slug: string, @Param('username') username: string, @Body(new ZodPipe(roleSchema)) b: z.infer<typeof roleSchema>) {
    return this.venues.setRole(req.userId!, slug, username, b.role);
  }

  @Delete(':slug/managers/:username')
  remove(@Req() req: AuthedReq, @Param('slug') slug: string, @Param('username') username: string) {
    return this.venues.removeManager(req.userId!, slug, username);
  }

  /** Painel do gestor. */
  @Get(':slug/insights')
  insights(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.venues.insights(req.userId!, slug);
  }

  @Post(':slug/checkin')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  checkin(@Req() req: AuthedReq, @Param('slug') slug: string, @Body(new ZodPipe(z.object({ token: z.string().min(8).max(64) }))) b: { token: string }) {
    return this.venues.checkin(req.userId!, slug, b.token);
  }

  @Post(':slug/qr/rotate')
  rotate(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.venues.rotateToken(req.userId!, slug);
  }

  /** A equipa aprova ou recusa o local (com motivo). */
  @Put(':slug/review')
  @UseGuards(StaffGuard)
  @Needs('catalog.manage')
  review(@Req() req: AuthedReq, @Param('slug') slug: string, @Body(new ZodPipe(reviewSchema)) b: z.infer<typeof reviewSchema>) {
    return this.venues.review(req.userId!, slug, b.decision, b.note);
  }

  /** A equipa verifica o local (selo). */
  @Put(':slug/verified')
  @UseGuards(StaffGuard)
  @Needs('catalog.manage')
  verify(@Req() req: AuthedReq, @Param('slug') slug: string, @Body(new ZodPipe(z.object({ verified: z.boolean() }))) b: { verified: boolean }) {
    return this.venues.setVerified(req.userId!, slug, b.verified);
  }
}
