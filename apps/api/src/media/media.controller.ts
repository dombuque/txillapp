import { Body, Controller, HttpCode, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { MediaService, parseIdParam } from './media.service';

/** `signed`: o ficheiro já traz a assinatura do Txillapp (gravada pela câmara da app); ao guardar um mimo não se volta a pôr. */
const requestSchema = z.object({ mime: z.string().max(50), size: z.number().int().positive(), purpose: z.enum(['public', 'chat', 'music']).default('public'), signed: z.boolean().optional() });

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  @UseGuards(JwtAuthGuard)
  request(
    @Req() req: Request & { userId?: string },
    @Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>,
  ) {
    return this.media.requestUpload(req.userId!, body.mime, body.size, body.purpose, body.signed ?? false);
  }

  /** Autorizado pela assinatura do URL (como um URL pré-assinado de S3). */
  @Put(':id/upload')
  upload(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Req() req: Request) {
    return this.media.receive(parseIdParam(id), Number(exp), sig, req);
  }

  /**
   * Chamado pelo cliente depois de enviar o ficheiro (no S3 valida o tipo e o tamanho reais). Num vídeo pode levar
   * `{ posterMs }`: o instante da capa escolhido no estúdio de tchekas (0 a 60 000 ms; fora disso ignora-se).
   */
  @Post(':id/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  complete(@Req() req: Request & { userId?: string }, @Param('id') id: string, @Body() body?: { posterMs?: unknown }) {
    return this.media.complete(req.userId!, parseIdParam(id), posterMsOf(body?.posterMs));
  }

  /**
   * «Pedir revisão» de uma foto recusada pela verificação automática: só o dono; uma vez por foto, até 7 dias depois, no
   * máximo 10 por dia (e 10 pedidos por minuto). A foto vai para a fila da moderação; aprovada, fica pronta a publicar.
   */
  @Post(':id/appeal')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  appeal(@Req() req: Request & { userId?: string }, @Param('id') id: string) {
    return this.media.appeal(req.userId!, parseIdParam(id));
  }

  /** Estado do ficheiro (vídeos demoram a converter). */
  @Get(':id/status')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  status(@Req() req: Request & { userId?: string }, @Param('id') id: string) {
    return this.media.status(req.userId!, parseIdParam(id));
  }

  /** Só a equipa: a foto de uma queixa por decidir (mesmo que seja de uma conversa privada). Cada visualização fica na auditoria. */
  @Get('review/:id')
  @UseGuards(StaffGuard)
  @Needs('reports.read')
  @SkipThrottle()
  async review(@Req() req: Request & { userId?: string }, @Param('id') id: string, @Res() res: Response) {
    const r = await this.media.reviewImage(parseIdParam(id), req.userId!);
    res.setHeader('Content-Type', r.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(r.bytes);
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
/** A largura pedida para o avatar: 256 por omissão, no máximo 1080 (nunca o original). */
/** O instante da capa pedido pelo cliente, se for um número válido (0 a 60 s); senão, nada. */
export function posterMsOf(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 60_000 ? Math.round(n) : undefined;
}

export function avatarWidth(w: string | undefined): number {
  const n = Math.trunc(Number(w));
  return Number.isFinite(n) && n > 256 ? Math.min(n, 1080) : 256;
}

@Controller('avatars')
export class AvatarsController {
  constructor(private readonly media: MediaService) {}

  @Get(':username')
  @SkipThrottle()
  async avatar(@Param('username') username: string, @Query('w') w: string | undefined, @Res() res: Response) {
    // `?w=1080`: a foto em grande (ao abrir a foto de perfil). Sem `w`, a pequena de 256 (as bolinhas da app).
    const found = await this.media.avatarOf(username.slice(0, 40), avatarWidth(w));
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!found) return res.status(204).setHeader('Cache-Control', 'no-cache').end();
    if ('url' in found) return res.setHeader('Cache-Control', 'no-cache').redirect(302, found.url);
    res.setHeader('Content-Type', found.mime);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(found.path);
  }
}
