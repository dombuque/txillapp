import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { MixarAvisosService } from './mixar-avisos.service';

type AuthedReq = Request & { userId?: string };

/**
 * Mixar: avisos e descoberta (0170, docs/mixar-contrato.md «Avisos e descoberta»).
 * GET    /mixar/suggestions                     → { items: MixarSuggestion[] }   (até 3: «Faz um Mixar com…»)
 * POST   /mixar/suggestions/:username/dismiss   → 204                            («Agora não»: 30 dias)
 * POST   /mixar/:id/open                        → 200 { openedAt }               (idempotente; 404 não é meu; 403 bloqueio)
 * Registado antes do MixarController (mixar.module.ts): `GET /mixar/suggestions` não pode cair no `GET /mixar/:id`.
 */
@Controller('mixar')
@UseGuards(JwtAuthGuard)
export class MixarAvisosController {
  constructor(private readonly avisos: MixarAvisosService) {}

  @Get('suggestions')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  suggestions(@Req() req: AuthedReq) {
    return this.avisos.suggestions(req.userId!);
  }

  @Post('suggestions/:username/dismiss')
  @HttpCode(204)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async dismiss(@Req() req: AuthedReq, @Param('username') username: string) {
    await this.avisos.dismiss(req.userId!, username);
  }

  @Post(':id/open')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  open(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.avisos.open(req.userId!, id);
  }
}
