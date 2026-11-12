import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { MusicCatalogService } from './catalog/catalog.service';
import { isStyle } from './catalog/track';
import { MusicService, trackSchema } from './music.service';

type AuthedReq = Request & { userId?: string };

/** Ids de faixas: `<fonte>:<id>` (e os antigos do Openverse, sem prefixo). */
const trackId = (raw: string) => {
  const id = (raw ?? '').slice(0, 80);
  if (!/^[A-Za-z0-9._:\-]{1,80}$/.test(id)) throw new BadRequestException('Faixa inválida');
  return id;
};

@Controller('music')
@UseGuards(JwtAuthGuard)
export class MusicController {
  constructor(private readonly music: MusicService, private readonly catalog: MusicCatalogService) {}

  /** O seletor ao abrir: estilos com faixas, «Em alta no Txillapp», «Artistas de Moçambique» (se houver), se há «Sons», as que usei. */
  @Get('home')
  home(@Req() req: AuthedReq) {
    return this.catalog.home(req.userId!);
  }

  @Get('styles/:id')
  style(@Req() req: AuthedReq, @Param('id') id: string) {
    if (!isStyle(id)) throw new NotFoundException('Estilo desconhecido');
    return this.catalog.style(req.userId!, id);
  }

  /** «Artistas de Moçambique» (a fonte local); vazio enquanto ela não existir. */
  @Get('local')
  local(@Req() req: AuthedReq, @Query('style') style?: string) {
    return this.catalog.local(req.userId!, isStyle(style) ? style : undefined);
  }

  @Get('sounds')
  sounds(@Req() req: AuthedReq) {
    return this.catalog.sounds(req.userId!);
  }

  /** Pesquisa no catálogo curado (título, artista ou estilo). */
  @Get('search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  search(@Req() req: AuthedReq, @Query('q') q = '') {
    return this.music.search(req.userId!, String(q));
  }

  /** Para as versões antigas da app: as faixas em alta e as que eu usei há pouco. */
  @Get('suggested')
  suggested(@Req() req: AuthedReq) {
    return this.music.suggested(req.userId!);
  }

  /** «Não gosto desta»: sai já para mim; quando muitas pessoas marcam, desce para todos. */
  @Put('dislikes/:id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  dislike(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.catalog.dislike(req.userId!, trackId(id));
  }

  @Delete('dislikes/:id')
  undislike(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.catalog.undislike(req.userId!, trackId(id));
  }

  @Get('favorites')
  favorites(@Req() req: AuthedReq) {
    return this.music.favorites(req.userId!);
  }

  /** Marcar uma faixa como favorita (o corpo é a faixa, validada como nas publicações). */
  @Put('favorites')
  addFavorite(@Req() req: AuthedReq, @Body(new ZodPipe(trackSchema)) t: z.infer<typeof trackSchema>) {
    return this.music.addFavorite(req.userId!, t);
  }

  @Delete('favorites/:id')
  removeFavorite(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.music.removeFavorite(req.userId!, id.slice(0, 80));
  }
}
