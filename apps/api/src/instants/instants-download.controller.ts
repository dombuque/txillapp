import { Controller, Get, Param, ParseUUIDPipe, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { InstantsDownloadService } from './instants-download.service';

/** `GET /instants/:id/download`: o meu Zás com a assinatura, para guardar na galeria ou descarregar. */
@Controller('instants')
@UseGuards(JwtAuthGuard)
export class InstantsDownloadController {
  constructor(private readonly zas: InstantsDownloadService) {}

  @Get(':id/download')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async download(@Req() req: Request & { userId?: string }, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.zas.download(req.userId!, id);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(f.bytes);
  }
}
