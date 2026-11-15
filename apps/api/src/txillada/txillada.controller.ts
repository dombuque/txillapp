import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { REPORT_REASONS } from '../moderation/moderation.service';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { TxilladaService } from './txillada.service';

type AuthedReq = Request & { userId?: string };

const createSchema = z.object({
  title: z.string().trim().max(80).optional().default(''),
  audience: z.enum(['everyone', 'followers', 'close']).default('everyone'),
});
const commentSchema = z.object({ body: z.string().trim().min(1).max(300) });
const reportSchema = z.object({ reason: z.enum(REPORT_REASONS), note: z.string().trim().max(500).optional() });
const afterSchema = z.object({ after: z.string().uuid().optional() });
const cutSchema = z.object({ reason: z.string().trim().min(3, 'Escreve o motivo').max(300) });

/**
 * Txillada (os lives), fase 1 — as rotas do contrato (docs/txillada-contrato.md). Todas com sessão, menos o webhook do
 * LiveKit (TxilladaWebhookController) e as do backoffice (TxilladaAdminController).
 */
@Controller('txilladas')
@UseGuards(JwtAuthGuard)
export class TxilladaController {
  constructor(private readonly tx: TxilladaService) {}

  @Get('config')
  config() {
    return this.tx.publicConfig();
  }

  @Get('live')
  live(@Req() req: AuthedReq) {
    return this.tx.live(req.userId!);
  }

  @NeedsVerifiedEmail()
  @Post()
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.tx.create(req.userId!, b.title, b.audience);
  }

  @Get(':id')
  get(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.get(req.userId!, id);
  }

  @Post(':id/join')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  join(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.join(req.userId!, id);
  }

  @Post(':id/end')
  @HttpCode(200)
  end(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.end(req.userId!, id);
  }

  @Get(':id/comments')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  comments(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(afterSchema)) q: z.infer<typeof afterSchema>) {
    return this.tx.comments(req.userId!, id, q.after);
  }

  @NeedsVerifiedEmail()
  @Post(':id/comments')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  comment(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(commentSchema)) b: z.infer<typeof commentSchema>) {
    return this.tx.comment(req.userId!, id, b.body);
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(204)
  async deleteComment(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('commentId', ParseUUIDPipe) commentId: string) {
    await this.tx.deleteComment(req.userId!, id, commentId);
  }

  /** No máximo 5 por segundo por pessoa (no serviço); aqui só o teto por minuto, acima do geral. */
  @Post(':id/cheer')
  @HttpCode(200)
  @Throttle({ default: { limit: 400, ttl: 60_000 } })
  cheer(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx.cheer(req.userId!, id);
  }

  @Post(':id/ban/:username')
  @HttpCode(204)
  async ban(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('username') username: string) {
    await this.tx.ban(req.userId!, id, username.slice(0, 40));
  }

  @Post(':id/report')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async report(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reportSchema)) b: z.infer<typeof reportSchema>) {
    await this.tx.report(req.userId!, id, b.reason, b.note);
  }
}

/**
 * O webhook do LiveKit (sem sessão: assinado com as chaves do LiveKit, validado com o WebhookReceiver). O corpo chega como
 * texto (Content-Type application/webhook+json; ver main.ts) para a assinatura bater certo com os bytes recebidos.
 */
@Controller('txilladas')
@SkipThrottle()
export class TxilladaWebhookController {
  constructor(private readonly tx: TxilladaService) {}

  @Post('livekit-webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request, @Headers('authorization') auth: string | undefined) {
    const body = typeof req.body === 'string' ? req.body : req.body && typeof req.body === 'object' && Object.keys(req.body).length ? JSON.stringify(req.body) : '';
    await this.tx.webhook(body, auth);
    return { ok: true };
  }
}

/** Backoffice: as Txilladas a decorrer (com denúncias) e o «Cortar». */
@Controller('admin/txilladas')
@UseGuards(StaffGuard)
export class TxilladaAdminController {
  constructor(private readonly tx: TxilladaService) {}

  @Get()
  @Needs('reports.read')
  list() {
    return this.tx.adminList();
  }

  @Post(':id/cut')
  @HttpCode(204)
  @Needs('reports.decide')
  async cut(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cutSchema)) b: z.infer<typeof cutSchema>) {
    await this.tx.adminCut(req.userId!, id, b.reason);
  }
}
