import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { ANALYSIS_DAYS, AnalysesService, PAGES, type AnalysisDays, type AnalysisPage } from './analyses.service';

type AuthedReq = Request & { userId?: string };

/** Análises do backoffice: só agregados, com k ≥ 20, e cada consulta fica na auditoria. Precisa de `insights.view`. */
@Controller('admin/insights')
@UseGuards(StaffGuard)
@Needs('insights.view')
export class AnalysesController {
  constructor(private readonly analyses: AnalysesService) {}

  /** Os países que se podem escolher (com 20 contas ou mais). */
  @Get('countries')
  countries(@Req() req: AuthedReq) {
    return this.analyses.countries(req.userId!);
  }

  @Get(':page')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  page(@Req() req: AuthedReq, @Param('page') page: string, @Query('days') days?: string, @Query('country') country?: string) {
    if (!(PAGES as readonly string[]).includes(page)) throw new NotFoundException();
    const d = Number(days);
    const c = (country ?? '').toUpperCase();
    return this.analyses.page(req.userId!, page as AnalysisPage, {
      days: ((ANALYSIS_DAYS as readonly number[]).includes(d) ? d : 30) as AnalysisDays,
      country: /^[A-Z]{2}$/.test(c) ? c : null,
    });
  }
}
