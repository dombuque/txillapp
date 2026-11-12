import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ComposeService } from './compose.service';

/** Montagem das tchekas no servidor (docs/montagem.md). */
@Controller('tchekas/compose')
@UseGuards(JwtAuthGuard)
export class ComposeController {
  constructor(private readonly compose: ComposeService) {}

  /** Pede a montagem: 202 { jobId }. O corpo valida-se no serviço (para a dica sair em português, como no estúdio). */
  @Post()
  @HttpCode(202)
  create(@Req() req: Request & { userId?: string }, @Body() body: unknown) {
    return this.compose.create(req.userId!, body);
  }

  /** O estado da montagem (a app pergunta de tempos a tempos): { status, progress, mediaId?, error? }. */
  @Get(':jobId')
  @SkipThrottle()
  status(@Req() req: Request & { userId?: string }, @Param('jobId') jobId: string) {
    return this.compose.status(req.userId!, jobId);
  }
}
