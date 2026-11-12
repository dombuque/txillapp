import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { LicensedMusicService } from './licensed-music.service';

type AuthedReq = Request & { userId?: string };
const trackId = (id: string) => id.slice(0, 80);
const listenSchema = z.object({ event: z.enum(['preview', 'play']).default('preview') });
const sourceSchema = z.string().regex(/^[a-z0-9_-]{1,30}$/);
const takedownSchema = z.object({ trackId: z.string().min(1).max(80), reason: z.string().trim().min(3).max(300) });

/**
 * Música licenciada para a app (ver docs/musica-licenciada.md).
 *  - GET  /music/licensed/status → { enabled: false } ou { enabled: true, source, clipSeconds }
 *  - GET  /music/licensed/search?q= · GET /music/licensed/trending · GET /music/licensed/tracks/:id → MusicTrack (previewUrl a null)
 *  - POST /music/licensed/tracks/:id/listen { event: 'preview' | 'play' } → { url, expiresAt, clipSeconds } (cada pedido conta)
 * Desligada, ou fora dos países do contrato, só o status responde; o resto dá 404.
 * Para pôr numa publicação: `music: { kind: 'licensed', source, id }` (o servidor vai buscar o resto ao fornecedor).
 */
@Controller('music/licensed')
@UseGuards(JwtAuthGuard)
export class LicensedMusicController {
  constructor(private readonly music: LicensedMusicService) {}

  @Get('status')
  status(@Req() req: AuthedReq) {
    return this.music.status(req.userId!);
  }

  @Get('search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  search(@Req() req: AuthedReq, @Query('q') q = '') {
    return this.music.search(req.userId!, typeof q === 'string' ? q : '');
  }

  @Get('trending')
  trending(@Req() req: AuthedReq) {
    return this.music.trending(req.userId!);
  }

  @Get('tracks/:id')
  track(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.music.track(req.userId!, trackId(id));
  }

  @Post('tracks/:id/listen')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  listen(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(listenSchema)) b: z.infer<typeof listenSchema>) {
    return this.music.listen(req.userId!, trackId(id), b.event);
  }
}

/**
 * Backoffice: o uso agregado (por faixa e por país) e as remoções.
 *  - GET  /admin/music/:source/usage?from=AAAA-MM-DD&to=AAAA-MM-DD (stats.view)
 *  - POST /admin/music/:source/report · POST /admin/music/:source/takedowns/sync (catalog.manage)
 *  - POST /admin/music/:source/takedowns { trackId, reason } (catalog.manage): retira já, mesmo com o fornecedor desligado
 */
@Controller('admin/music')
@UseGuards(StaffGuard)
export class LicensedMusicAdminController {
  constructor(private readonly music: LicensedMusicService) {}

  @Get(':source/usage')
  @Needs('stats.view')
  usage(@Param('source', new ZodPipe(sourceSchema)) source: string, @Query('from') from = '', @Query('to') to = '') {
    return this.music.usage(source, String(from), String(to));
  }

  @Post(':source/report')
  @HttpCode(200)
  @Needs('catalog.manage')
  report(@Param('source', new ZodPipe(sourceSchema)) source: string) {
    return this.music.report(source);
  }

  @Post(':source/takedowns/sync')
  @HttpCode(200)
  @Needs('catalog.manage')
  sync(@Param('source', new ZodPipe(sourceSchema)) source: string) {
    return this.music.syncTakedowns(source);
  }

  @Post(':source/takedowns')
  @HttpCode(200)
  @Needs('catalog.manage')
  takedown(@Req() req: AuthedReq, @Param('source', new ZodPipe(sourceSchema)) source: string, @Body(new ZodPipe(takedownSchema)) b: z.infer<typeof takedownSchema>) {
    return this.music.takedown(source, b.trackId, b.reason, 'staff', req.userId!);
  }
}
