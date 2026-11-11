import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { ContasService } from './contas.service';

type AuthedReq = Request & { userId?: string };
type Q = Record<string, string | undefined>;

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Escreve o motivo').max(300) });

/** Backoffice › Contas: lista com filtros, CSV, ficha da conta e sessões. */
@Controller('admin/users')
@UseGuards(StaffGuard)
export class ContasController {
  constructor(private readonly contas: ContasService) {}

  /** Lista: q, status, verified (email|unconfirmed|badge), country, from, to, reports=1, minors=1, sort e cursor. */
  @Get()
  @Needs('users.view')
  list(@Query() q: Q) {
    return this.contas.list(ContasService.filters(q), typeof q.cursor === 'string' ? q.cursor : undefined);
  }

  /** CSV com os mesmos filtros, só com campos não sensíveis. Fica na auditoria. */
  @Get('export.csv')
  @Needs('users.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async export(@Req() req: AuthedReq, @Query() q: Q, @Res({ passthrough: true }) res: Response) {
    const { csv, rows } = await this.contas.exportCsv(req.userId!, ContasService.filters(q));
    res.setHeader('Content-Disposition', `attachment; filename="contas-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('X-Rows', String(rows));
    return csv;
  }

  @Get(':id')
  @Needs('users.view')
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.contas.user(id);
  }

  /** Sessões e aparelhos (uma linha por login). Cada consulta fica na auditoria. */
  @Get(':id/sessions')
  @Needs('users.view', 'users.sessions')
  sessions(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.contas.sessions(req.userId!, id);
  }

  @Post(':id/sessions/revoke-all')
  @Needs('users.view', 'users.sessions')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  revokeAll(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.contas.revokeAll(req.userId!, id, b.reason);
  }

  @Post(':id/sessions/:family/revoke')
  @Needs('users.view', 'users.sessions')
  @HttpCode(204)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  revoke(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('family', ParseUUIDPipe) family: string, @Body(new ZodPipe(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.contas.revokeSession(req.userId!, id, family, b.reason);
  }
}
