import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { GifsService } from './gifs.service';

type AuthedReq = Request & { userId?: string };
const offsetOf = (v?: string) => Math.max(0, parseInt(v ?? '0', 10) || 0);

/**
 * GIFs do GIPHY (pelo nosso servidor; ver gifs.service.ts).
 *  - GET /gifs/config → { enabled, channel: string | null }
 *  - GET /gifs/trending?offset= · GET /gifs/search?q=&offset= · GET /gifs/channel?offset=
 *    → { items: { id, title, w, h, preview, full, still?, mp4? }[], next: number | null } (sem chave: { enabled: false, items: [], next: null })
 */
@Controller('gifs')
export class GifsController {
  constructor(private readonly gifs: GifsService) {}

  @Get('config')
  config() {
    return this.gifs.config();
  }

  @Get('trending')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  trending(@Req() req: AuthedReq, @Query('offset') offset?: string) {
    return this.gifs.trending(req.userId!, offsetOf(offset));
  }

  @Get('search')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  search(@Req() req: AuthedReq, @Query('q') q = '', @Query('offset') offset?: string) {
    return this.gifs.search(req.userId!, typeof q === 'string' ? q : '', offsetOf(offset));
  }

  @Get('channel')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  channel(@Req() req: AuthedReq, @Query('offset') offset?: string) {
    return this.gifs.channelGifs(req.userId!, offsetOf(offset));
  }
}
