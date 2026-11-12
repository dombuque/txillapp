import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { parseIdParam } from '../media/media.service';
import { PostsService } from '../posts/posts.service';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { SoundsService } from './sounds.service';

type AuthedReq = Request & { userId?: string };

const reportSchema = z.object({ reason: z.enum(['copyright', 'other']).default('copyright'), note: z.string().trim().max(500).optional() });
const settingsSchema = z.object({ reuse: z.boolean() });
const decisionSchema = z.object({ action: z.enum(['uphold', 'dismiss', 'restore']), reason: z.string().trim().min(3, 'Escreve o motivo').max(300) });

/**
 * Os sons das tchekas (docs/sons.md). Fica no PostsModule porque a grelha das tchekas de um som usa o formato das publicações.
 * As rotas fixas (trending, me) vêm antes de `:id`.
 */
@Controller('sounds')
@UseGuards(JwtAuthGuard)
export class SoundsController {
  constructor(private readonly sounds: SoundsService, private readonly posts: PostsService) {}

  /** «Sons em alta»: os mais usados em tchekas nos últimos 7 dias (só números agregados). */
  @Get('trending')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  trending(@Req() req: AuthedReq, @Query('limit') limit?: string) {
    return this.sounds.trending(req.userId!, Math.min(Math.max(Number(limit) || 20, 1), 40));
  }

  /** Definições → Conteúdo → «Deixar usar o meu som». */
  @Get('me/settings')
  settings(@Req() req: AuthedReq) {
    return this.sounds.settings(req.userId!);
  }

  @Put('me/settings')
  setSettings(@Req() req: AuthedReq, @Body(new ZodPipe(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.sounds.setSettings(req.userId!, b.reuse);
  }

  /** Os meus sons originais. */
  @Get('me')
  mine(@Req() req: AuthedReq) {
    return this.sounds.mine(req.userId!);
  }

  @Get(':id')
  one(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.sounds.get(req.userId!, id);
  }

  /** As tchekas que usam este som: `sort=top` (mais vistas, depois as recentes; por omissão) ou `recent`. */
  @Get(':id/tchekas')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async tchekas(@Req() req: AuthedReq, @Param('id') id: string, @Query('cursor') cursor?: string, @Query('sort') sort?: string, @Query('limit') limit?: string) {
    await this.sounds.assertVisible(req.userId!, id);
    const n = Math.min(Math.max(Number(limit) || 18, 1), 30);
    return this.posts.bySound(req.userId!, id, sort === 'recent' ? 'recent' : 'top', cursor, n);
  }

  /** «Este som tem música protegida» (ou outro motivo): fica escondido para novos usos enquanto a equipa analisa. */
  @Post(':id/report')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async report(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(reportSchema)) b: z.infer<typeof reportSchema>) {
    await this.sounds.report(req.userId!, id, b.reason, b.note);
  }

  /** «Retirar o som» (só o autor, só sons originais): deixa de tocar em todo o lado e o áudio é apagado. Não se desfaz. */
  @Post(':id/retire')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async retire(@Req() req: AuthedReq, @Param('id') id: string) {
    await this.sounds.retireOwn(req.userId!, id);
  }
}

/** O áudio de um som original: URL assinado e temporário (como os trechos das músicas). */
@Controller('sounds/audio')
export class SoundAudioController {
  constructor(private readonly sounds: SoundsService) {}

  @Get(':id')
  @SkipThrottle()
  async audio(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const found = await this.sounds.audio(parseIdParam(id), Number(exp), sig);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if ('url' in found) return res.setHeader('Cache-Control', 'private, max-age=240').redirect(302, found.url);
    res.setHeader('Content-Type', found.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(found.path);
  }
}

/** Backoffice › Música › Sons originais (e a Moderação, que tem `music.manage`): as denúncias de direitos dos sons. */
@Controller('admin/sounds')
@UseGuards(StaffGuard)
export class SoundsAdminController {
  constructor(private readonly sounds: SoundsService) {}

  @Get()
  @Needs('music.manage')
  list(@Query('status') status?: string) {
    const s = status === 'upheld' || status === 'dismissed' || status === 'all' ? status : 'open';
    return this.sounds.adminList(s);
  }

  @Post(':id/decision')
  @Needs('music.manage')
  @HttpCode(204)
  async decide(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(decisionSchema)) b: z.infer<typeof decisionSchema>) {
    await this.sounds.decide(req.userId!, parseIdParam(id), b.action, b.reason);
  }
}
