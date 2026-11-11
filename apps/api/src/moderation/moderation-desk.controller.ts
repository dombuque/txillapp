import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { REMOVABLE_TYPES, type RemovableType } from './content-removal';
import { DESK_ACTIONS, ModerationDeskService, QUEUE_SORTS } from './moderation-desk.service';
import { REPORT_REASONS, REPORT_TYPES } from './moderation.service';

type AuthedReq = Request & { userId?: string };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD)');
const queueSchema = z.object({
  status: z.enum(['open', 'actioned', 'dismissed']).default('open'),
  // Vários tipos separados por vírgulas: post,comment,story,message,user,venue,media.
  type: z.string().max(80).optional().transform((v) => (v ? v.split(',').filter(Boolean) : undefined)).pipe(z.array(z.enum(REPORT_TYPES)).optional()),
  reason: z.enum(REPORT_REASONS).optional(),
  sort: z.enum(QUEUE_SORTS).default('severity'),
  q: z.string().trim().max(60).optional(),
});
const decideSchema = z.object({
  items: z.array(z.object({ type: z.enum(REPORT_TYPES), id: z.string().uuid() })).min(1).max(50),
  action: z.enum(DESK_ACTIONS),
  note: z.string().trim().max(300).optional(),
  // Avisar o autor (remover e avisar). Por omissão, sim.
  notify: z.boolean().default(true),
});
const contentSchema = z.object({
  type: z.enum(['all', 'post', 'tcheka', 'story', 'comment']).default('all'),
  q: z.string().trim().max(100).optional(),
  author: z.string().trim().max(40).optional(),
  tag: z.string().trim().max(40).optional(),
  from: day.optional(),
  to: day.optional(),
  state: z.enum(['visible', 'removed', 'all']).default('all'),
  flag: z.enum(['nsfw', 'text']).optional(),
  cursor: z.string().datetime({ offset: true }).optional(),
});
const actSchema = z.object({ reason: z.string().trim().min(3, 'Escreve o motivo').max(300), notify: z.boolean().default(true) });

/** A mesa da moderação: fila de queixas (com filtros, gravidade e lote) e a página «Conteúdo». */
@Controller('admin')
@UseGuards(StaffGuard)
export class ModerationDeskController {
  constructor(private readonly desk: ModerationDeskService) {}

  @Get('mod/queue')
  @Needs('reports.read')
  queue(@Query(new ZodPipe(queueSchema)) q: z.infer<typeof queueSchema>) {
    return this.desk.queue({ status: q.status, types: q.type, reason: q.reason, sort: q.sort, q: q.q });
  }

  @Get('mod/queue/:type/:id')
  @Needs('reports.read')
  detail(@Param('type', new ZodPipe(z.enum(REPORT_TYPES))) type: (typeof REPORT_TYPES)[number], @Param('id', ParseUUIDPipe) id: string) {
    return this.desk.queueItemDetail(type, id);
  }

  @Post('mod/queue/decide')
  @Needs('reports.decide')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  decide(@Req() req: AuthedReq, @Body(new ZodPipe(decideSchema)) b: z.infer<typeof decideSchema>) {
    return this.desk.decide(req.userId!, b.items, b.action, b.note, b.notify);
  }

  @Get('mod/content')
  @Needs('content.moderate')
  content(@Query(new ZodPipe(contentSchema)) q: z.infer<typeof contentSchema>) {
    return this.desk.content(q);
  }

  @Post('mod/content/:type/:id/remove')
  @Needs('content.moderate')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  remove(@Req() req: AuthedReq, @Param('type', new ZodPipe(z.enum(REMOVABLE_TYPES))) type: RemovableType, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(actSchema)) b: z.infer<typeof actSchema>) {
    return this.desk.removeOne(req.userId!, type, id, b.reason, b.notify);
  }

  @Post('mod/content/:type/:id/restore')
  @Needs('content.moderate')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  restore(@Req() req: AuthedReq, @Param('type', new ZodPipe(z.enum(REMOVABLE_TYPES))) type: RemovableType, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(actSchema)) b: z.infer<typeof actSchema>) {
    return this.desk.restoreOne(req.userId!, type, id, b.reason, b.notify);
  }
}
