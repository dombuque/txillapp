import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ComposeService } from './compose.service';
import { VoicePreviewService } from './voice-preview.service';

/** Montagem das tchekas no servidor (docs/montagem.md). */
@Controller('tchekas/compose')
@UseGuards(JwtAuthGuard)
export class ComposeController {
  constructor(private readonly compose: ComposeService, private readonly voice: VoicePreviewService) {}

  /** Pede a montagem: 202 { jobId }. O corpo valida-se no serviço (para a dica sair em português, como no estúdio). */
  @Post()
  @HttpCode(202)
  create(@Req() req: Request & { userId?: string }, @Body() body: unknown) {
    return this.compose.create(req.userId!, body);
  }

  /**
   * Ouvir um efeito de voz no estúdio antes de montar: { mediaId (um áudio meu ou um clipe de vídeo meu), effect } →
   * 200 { mediaId, url, durationMs, cached }. `url` é relativo e assinado (como os áudios do chat; vale de 1 a 2 horas).
   */
  @Post('voice-preview')
  @HttpCode(200)
  voicePreview(@Req() req: Request & { userId?: string }, @Body() body: unknown) {
    return this.voice.preview(req.userId!, body);
  }

  /** O estado da montagem (a app pergunta de tempos a tempos): { status, progress, mediaId?, error? }. */
  @Get(':jobId')
  @SkipThrottle()
  status(@Req() req: Request & { userId?: string }, @Param('jobId') jobId: string) {
    return this.compose.status(req.userId!, jobId);
  }
}
