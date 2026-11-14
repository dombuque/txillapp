import { Controller, Get, Param, ParseUUIDPipe, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { PostDownloadService } from './post-download.service';

/**
 * `GET /posts/:id/download` (com sessão): a tcheka para guardar na galeria ou partilhar noutra app, com a assinatura e o
 * cartão do fim (PostDownloadService). MP4; `X-Cache: hit` quando a cópia já estava feita. 404 se não se pode ver, 422 sem
 * vídeo, 503 se não deu para a preparar (ou há muitas a preparar).
 */
@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostDownloadController {
  constructor(private readonly downloads: PostDownloadService) {}

  @Get(':id/download')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async download(@Req() req: Request & { userId?: string }, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.downloads.download(req.userId!, id);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Cache', f.cache);
    if ('bytes' in f.body) {
      res.setHeader('Content-Length', String(f.body.bytes.length));
      res.end(f.body.bytes);
      return;
    }
    res.setHeader('Content-Length', String(f.body.size));
    f.body.stream.on('error', () => res.destroy());
    f.body.stream.pipe(res);
  }
}
