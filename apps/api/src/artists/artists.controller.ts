import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { parseIdParam } from '../media/media.service';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { ArtistsService, LINK_KINDS, TRACK_LIMITS } from './artists.service';

type AuthedReq = Request & { userId?: string };

const httpsUrl = z.string().trim().url().max(300).refine((u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
}, 'Só ligações https');

const applySchema = z.object({
  stageName: z.string().trim().min(2).max(60),
  styles: z.array(z.string().max(30)).min(1).max(5),
  links: z.array(z.object({ kind: z.enum(LINK_KINDS), url: httpsUrl })).max(8).default([]),
  rightsKind: z.enum(['label', 'self']),
  labelName: z.string().trim().max(80).optional(),
  // A declaração: «sou o autor e intérprete e tenho os direitos…», ou a editora que representa o artista.
  rightsStatement: z.string().trim().min(20).max(1000),
  proofMediaId: z.string().uuid().optional(),
});

const trackSchema = z.object({
  title: z.string().trim().min(1).max(100),
  audioMediaId: z.string().uuid(),
  coverMediaId: z.string().uuid().optional(),
  styles: z.array(z.string().max(30)).min(1).max(5),
  previewStartMs: z.number().int().min(0).max(TRACK_LIMITS.maxTrackMs),
  previewMs: z.number().int().min(TRACK_LIMITS.minPreviewMs).max(TRACK_LIMITS.maxPreviewMs).default(30_000),
  explicit: z.boolean().default(false),
  licenseVersion: z.string().max(40),
  acceptLicense: z.literal(true, { message: 'Tens de aceitar a licença' }),
});

const claimSchema = z.object({
  claimantName: z.string().trim().min(2).max(80),
  contactEmail: z.string().trim().email().max(160),
  relation: z.enum(['owner', 'label', 'representative', 'other']),
  details: z.string().trim().min(10).max(1000),
});

/** O programa de artistas, do lado de quem usa a app: o pedido, as faixas e o seletor «Artistas de Moçambique». */
@Controller()
export class ArtistsController {
  constructor(private readonly artists: ArtistsService) {}

  @Get('artists/me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthedReq) {
    return this.artists.me(req.userId!);
  }

  @Post('artists/apply')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  apply(@Req() req: AuthedReq, @Body(new ZodPipe(applySchema)) b: z.infer<typeof applySchema>) {
    return this.artists.apply(req.userId!, b);
  }

  @Delete('artists/apply')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  withdraw(@Req() req: AuthedReq) {
    return this.artists.withdrawApplication(req.userId!);
  }

  @Get('artists/tracks')
  @UseGuards(JwtAuthGuard)
  tracks(@Req() req: AuthedReq) {
    return this.artists.myTracks(req.userId!);
  }

  @Post('artists/tracks')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  create(@Req() req: AuthedReq, @Body(new ZodPipe(trackSchema)) b: z.infer<typeof trackSchema>) {
    return this.artists.createTrack(req.userId!, b);
  }

  @Post('artists/tracks/:id/withdraw')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  withdrawTrack(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.artists.withdrawTrack(req.userId!, parseIdParam(id));
  }

  /** A etiqueta «Artista» e as ligações de um perfil. */
  @Get('artists/u/:username')
  @UseGuards(JwtAuthGuard)
  artist(@Param('username') username: string) {
    return this.artists.publicArtist(username.slice(0, 40));
  }

  /** «Artistas de Moçambique» no seletor de música (faixas aprovadas, pela interface comum, `source: 'local'`). */
  @Get('music/local')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  catalog(@Req() req: AuthedReq, @Query('q') q?: string, @Query('style') style?: string, @Query('artist') artist?: string) {
    return this.artists.catalog(req.userId!, { q, style, artist });
  }

  /** Denunciar uma faixa por violação de direitos de autor (fica escondida enquanto a equipa analisa). */
  @Post('music/local/:id/report')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  report(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(claimSchema)) b: z.infer<typeof claimSchema>) {
    return this.artists.reportTrack(req.userId!, id.slice(0, 50), b);
  }

  /** O trecho de uma faixa: URL assinado e temporário (como as mensagens de voz). */
  @Get('music/local/audio/:id')
  @SkipThrottle()
  async audio(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Query('r') r: string | undefined, @Res() res: Response) {
    const found = await this.artists.audio(parseIdParam(id), Number(exp), sig, r === '1');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if ('url' in found) return res.setHeader('Cache-Control', 'private, max-age=240').redirect(302, found.url);
    res.setHeader('Content-Type', found.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(found.path);
  }
}

const artistDecision = z.object({ action: z.enum(['approve', 'reject', 'revoke']), reason: z.string().trim().max(300).optional() });
const trackDecision = z.object({ action: z.enum(['approve', 'reject', 'remove', 'restore']), reason: z.string().trim().max(300).optional() });
const claimDecision = z.object({ action: z.enum(['uphold', 'dismiss']), reason: z.string().trim().min(3).max(300) });

/** Backoffice › Música: pedidos de artista, moderação das faixas e denúncias de direitos de autor. Tudo fica na auditoria. */
@Controller('admin/music')
@UseGuards(StaffGuard)
export class ArtistsDeskController {
  constructor(private readonly artists: ArtistsService) {}

  @Get('summary')
  @Needs('music.manage')
  summary() {
    return this.artists.pending();
  }

  @Get('artists')
  @Needs('music.manage')
  queueArtists(@Query('status') status?: string) {
    return this.artists.queueArtists(status === 'approved' || status === 'rejected' || status === 'revoked' ? status : 'pending');
  }

  @Post('artists/:userId/decide')
  @Needs('music.manage')
  @HttpCode(204)
  decideArtist(@Req() req: AuthedReq, @Param('userId') userId: string, @Body(new ZodPipe(artistDecision)) b: z.infer<typeof artistDecision>) {
    return this.artists.decideArtist(req.userId!, parseIdParam(userId), b.action, b.reason);
  }

  @Get('tracks')
  @Needs('music.manage')
  queueTracks(@Query('status') status?: string) {
    const ok = ['approved', 'rejected', 'withdrawn', 'removed', 'held'] as const;
    return this.artists.queueTracks((ok as readonly string[]).includes(status ?? '') ? (status as (typeof ok)[number]) : 'pending');
  }

  @Post('tracks/:id/decide')
  @Needs('music.manage')
  @HttpCode(204)
  decideTrack(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(trackDecision)) b: z.infer<typeof trackDecision>) {
    return this.artists.decideTrack(req.userId!, parseIdParam(id), b.action, b.reason);
  }

  @Get('claims')
  @Needs('music.manage')
  queueClaims(@Query('status') status?: string) {
    return this.artists.queueClaims(status === 'upheld' || status === 'dismissed' ? status : 'open');
  }

  @Post('claims/:id/decide')
  @Needs('music.manage')
  @HttpCode(204)
  decideClaim(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(claimDecision)) b: z.infer<typeof claimDecision>) {
    return this.artists.decideClaim(req.userId!, parseIdParam(id), b.action, b.reason);
  }
}
