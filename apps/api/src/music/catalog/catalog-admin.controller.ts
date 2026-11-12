import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { Needs, StaffGuard } from '../../staff/staff.guard';
import { MusicCatalogService } from './catalog.service';
import { STYLE_IDS, type MusicStyleId } from './track';

type AuthedReq = Request & { userId?: string };

const listSchema = z.object({
  sort: z.enum(['uses', 'dislikes', 'quality', 'recent']).default('uses'),
  status: z.enum(['all', 'featured', 'hidden', 'downranked']).default('all'),
  style: z.enum(STYLE_IDS as [MusicStyleId, ...MusicStyleId[]]).optional(),
  q: z.string().trim().max(60).optional(),
});
const statusSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._:\-]{1,80}$/, 'Faixa inválida'),
  status: z.enum(['active', 'hidden', 'featured']),
  reason: z.string().trim().min(3, 'Escreve o motivo').max(300),
});
const refreshSchema = z.object({ reason: z.string().trim().max(300).optional() });

/** Backoffice › Música: o catálogo curado, as mais usadas e as mais rejeitadas; esconder e destacar (auditado). */
@Controller('admin/music')
@UseGuards(StaffGuard)
export class MusicCatalogAdminController {
  constructor(private readonly catalog: MusicCatalogService) {}

  @Get()
  @Needs('catalog.manage')
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.catalog.adminList(q);
  }

  @Post('status')
  @Needs('catalog.manage')
  @HttpCode(204)
  async status(@Req() req: AuthedReq, @Body(new ZodPipe(statusSchema)) b: z.infer<typeof statusSchema>) {
    await this.catalog.setStatus(req.userId!, b.id, b.status, b.reason);
  }

  @Post('refresh')
  @Needs('catalog.manage')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 3_600_000 } })
  refresh(@Req() req: AuthedReq, @Body(new ZodPipe(refreshSchema)) b: z.infer<typeof refreshSchema>) {
    return this.catalog.adminRefresh(req.userId!, b.reason);
  }
}
