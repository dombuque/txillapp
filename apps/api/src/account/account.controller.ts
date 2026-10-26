import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ExportService } from './export.service';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly exporter: ExportService) {}

  /** Descarregar os meus dados (JSON). Poucas vezes por hora: é uma consulta pesada. */
  @Get('export')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async export(@Req() req: Request & { userId?: string }, @Res() res: Response) {
    const data = await this.exporter.build(req.userId!);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="txillapp-dados-${(data.profile as { username: string }).username}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(JSON.stringify(data, null, 2));
  }
}
