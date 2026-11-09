import { Body, Controller, Delete, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { MusicService, trackSchema } from './music.service';

type AuthedReq = Request & { userId?: string };

@Controller('music')
@UseGuards(JwtAuthGuard)
export class MusicController {
  constructor(private readonly music: MusicService) {}

  /** Pesquisa de faixas de licença aberta (Creative Commons) para pôr em notas, posts e mimos. */
  @Get('search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  search(@Query('q') q = '') {
    return this.music.search(q);
  }

  /** Sugestões: as faixas que a malta mais está a usar e as que eu usei há pouco. */
  @Get('suggested')
  suggested(@Req() req: AuthedReq) {
    return this.music.suggested(req.userId!);
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
