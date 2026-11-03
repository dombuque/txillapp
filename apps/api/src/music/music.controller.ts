import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/auth.controller';
import { MusicService } from './music.service';

@Controller('music')
@UseGuards(JwtAuthGuard)
export class MusicController {
  constructor(private readonly music: MusicService) {}

  /** Pesquisa de faixas de licença aberta (Creative Commons) para pôr em notas. */
  @Get('search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  search(@Query('q') q = '') {
    return this.music.search(q);
  }
}
