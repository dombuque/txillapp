import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { AuditDeskService } from './audit-desk.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD)');
const filterSchema = z.object({
  actor: z.string().trim().max(80).optional(),
  action: z.string().trim().max(60).regex(/^[a-z_.]*$/, 'Ação inválida').optional(),
  target: z.string().trim().max(80).optional(),
  from: day.optional(),
  to: day.optional(),
  cursor: z.string().uuid().optional(),
});

/** O registo de auditoria com filtros e exportação (só quem tem «audit.read»). */
@Controller('admin/audit')
@UseGuards(StaffGuard)
export class AuditDeskController {
  constructor(private readonly audit: AuditDeskService) {}

  @Get('search')
  @Needs('audit.read')
  search(@Query(new ZodPipe(filterSchema)) f: z.infer<typeof filterSchema>) {
    return this.audit.search(f);
  }

  @Get('facets')
  @Needs('audit.read')
  facets() {
    return this.audit.facets();
  }

  @Get('export')
  @Needs('audit.read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async export(@Req() req: Request & { userId?: string }, @Query(new ZodPipe(filterSchema)) f: z.infer<typeof filterSchema>, @Res() res: Response) {
    const csv = await this.audit.exportCsv(req.userId!, f);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="auditoria-txillapp-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }
}
