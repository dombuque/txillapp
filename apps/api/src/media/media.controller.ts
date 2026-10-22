import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { MediaService, parseIdParam } from './media.service';

const requestSchema = z.object({ mime: z.string().max(50), size: z.number().int().positive() });

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  @UseGuards(JwtAuthGuard)
  request(
    @Req() req: Request & { userId?: string },
    @Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>,
  ) {
    return this.media.requestUpload(req.userId!, body.mime, body.size);
  }

  /** Autorizado pela assinatura do URL (como um URL pré-assinado de S3). */
  @Put(':id/upload')
  upload(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Req() req: Request) {
    return this.media.receive(parseIdParam(id), Number(exp), sig, req);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Res() res: Response) {
    const { path, mime } = await this.media.locate(parseIdParam(id));
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(path);
  }
}
