import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { GeleiraAdminService } from './geleira-admin.service';
import { KINDS } from './geleira.service';

type AuthedReq = Request & { userId?: string };

const name = z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N}][\p{L}\p{N} '&.\-]*$/u, 'Só letras, números e espaços');
const category = z.string().trim().min(2).max(30).regex(/^[a-z0-9-]+$/, 'Grupo: minúsculas, números e hífens');
const countries = z.array(z.string().regex(/^[A-Z]{2}$/, 'País: código de duas letras (MZ, PT…)')).max(30).nullable();
const reason = z.string().trim().min(3, 'Escreve o motivo').max(300);
const listSchema = z.object({
  status: z.enum(['pending', 'curated', 'rejected', 'all']).default('pending'),
  kind: z.enum(KINDS).optional(),
  q: z.string().trim().max(60).optional(),
  country: z.string().regex(/^([A-Z]{2}|global)$/).optional(),
});
const decideSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100), approve: z.boolean(), reason: z.string().trim().max(300).optional() });
const editSchema = z.object({ name: name.optional(), kind: z.enum(KINDS).optional(), category: category.optional(), alcoholic: z.boolean().optional(), countries: countries.optional(), reason });
const createSchema = z.object({ name, kind: z.enum(KINDS), category, alcoholic: z.boolean().default(false), countries: countries.default(null), reason });

/** O catálogo da Geleira (sugestões, edição, países). Só quem gere o catálogo. */
@Controller('admin/catalog')
@UseGuards(StaffGuard)
export class GeleiraAdminController {
  constructor(private readonly catalog: GeleiraAdminService) {}

  @Get()
  @Needs('catalog.manage')
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.catalog.list(q);
  }

  @Post('decide')
  @Needs('catalog.manage')
  @HttpCode(200)
  decide(@Req() req: AuthedReq, @Body(new ZodPipe(decideSchema)) b: z.infer<typeof decideSchema>) {
    return this.catalog.decide(req.userId!, b.ids, b.approve, b.reason);
  }

  @Post()
  @Needs('catalog.manage')
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    const { reason: why, ...item } = b;
    return this.catalog.create(req.userId!, item, why);
  }

  @Patch(':id')
  @Needs('catalog.manage')
  @HttpCode(204)
  edit(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(editSchema)) b: z.infer<typeof editSchema>) {
    const { reason: why, ...changes } = b;
    return this.catalog.edit(req.userId!, id, changes, why);
  }
}
