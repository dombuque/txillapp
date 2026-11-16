import { Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { MixarGrupoService } from './mixar-grupo.service';

type AuthedReq = Request & { userId?: string };

/**
 * Mixar de grupo (0173, docs/mixar-contrato.md «Mixar de grupo»):
 * POST   /mixar/grupo/:groupId → 201 Mixar   (propor; 404 não sou do grupo; 409 tamanho errado ou já há, com { id }; 429)
 * GET    /mixar/grupo/:groupId → Mixar | 404 (o Mixar aberto do grupo, para o cabeçalho do grupo)
 * O resto (aceitar, «Agora não», sair, feed, reações, desafio, conversa, Guardados, «Mais 5», temas, abrir) usa as rotas de
 * sempre, /mixar/:id/…, com o id do Mixar do grupo. Registado antes do MixarController (mixar.module.ts).
 */
@Controller('mixar/grupo')
@UseGuards(JwtAuthGuard)
export class MixarGrupoController {
  constructor(private readonly grupo: MixarGrupoService) {}

  // Como o convite a dois (que é um cartão no chat): só com o email confirmado.
  @NeedsVerifiedEmail()
  @Post(':groupId')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  propose(@Req() req: AuthedReq, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.grupo.propose(req.userId!, groupId);
  }

  @Get(':groupId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  forGroup(@Req() req: AuthedReq, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.grupo.forGroup(req.userId!, groupId);
  }
}
