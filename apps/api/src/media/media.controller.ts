import { Body, Controller, HttpCode, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { MediaService, parseIdParam } from './media.service';

const requestSchema = z.object({ mime: z.string().max(50), size: z.number().int().positive(), purpose: z.enum(['public', 'chat']).default('public') });

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  @UseGuards(JwtAuthGuard)
  request(
    @Req() req: Request & { userId?: string },
    @Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>,
  ) {
    return this.media.requestUpload(req.userId!, body.mime, body.size, body.purpose);
  }

  /** Autorizado pela assinatura do URL (como um URL pré-assinado de S3). */
  @Put(':id/upload')
  upload(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Req() req: Request) {
    return this.media.receive(parseIdParam(id), Number(exp), sig, req);
  }

  /** Chamado pelo cliente depois de enviar o ficheiro (no S3 valida o tipo e o tamanho reais). */
  @Post(':id/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  complete(@Req() req: Request & { userId?: string }, @Param('id') id: string) {
    return this.media.complete(req.userId!, parseIdParam(id));
  }

  /** Estado do ficheiro (vídeos demoram a converter). */
  @Get(':id/status')
  @UseGuards(JwtAuthGuard)
  status(@Req() req: Request & { userId?: string }, @Param('id') id: string) {
    return this.media.status(req.userId!, parseIdParam(id));
  }

  // Imagens públicas e imutáveis: não contam para o limite de pedidos (um feed carrega dezenas).
  @Get(':id')
  @SkipThrottle()
  async get(@Param('id') id: string, @Query('w') w: string | undefined, @Query('poster') poster: string | undefined, @Res() res: Response) {
    const width = Number(w);
    const found = poster ? await this.media.locatePoster(parseIdParam(id)) : await this.media.locate(parseIdParam(id), Number.isFinite(width) && width > 0 ? Math.min(width, 4000) : undefined);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if ('url' in found) {
      res.setHeader('Cache-Control', 'public, max-age=600');
      return res.redirect(302, found.url);
    }
    res.setHeader('Content-Type', found.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(found.path);
  }
}

/**
 * Foto de perfil por @utilizador. Sem foto responde 204 (a app mostra as iniciais).
 * `no-cache` + ETag: o browser revalida e a foto nova aparece logo, sem descarregar de novo se não mudou.
 */
@Controller('avatars')
export class AvatarsController {
  constructor(private readonly media: MediaService) {}

  @Get(':username')
  @SkipThrottle()
  async avatar(@Param('username') username: string, @Res() res: Response) {
    const found = await this.media.avatarOf(username.slice(0, 40));
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!found) return res.status(204).setHeader('Cache-Control', 'no-cache').end();
    if ('url' in found) return res.setHeader('Cache-Control', 'no-cache').redirect(302, found.url);
    res.setHeader('Content-Type', found.mime);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(found.path);
  }
}
