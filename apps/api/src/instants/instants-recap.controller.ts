import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { InstantsRecapService } from './instants-recap.service';

type AuthedReq = Request & { userId?: string };
const settingsSchema = z.object({ keepForRecap: z.boolean() });
const publishSchema = z.object({ audience: z.enum(['all', 'close_friends']).default('all') });

/**
 * O resumo semanal dos Zás (0164): a definição «Guardar os meus Zás para o resumo semanal», o arquivo dos meus Zás (os 7
 * dias em que os guardo, só para mim) e os resumos (ver, guardar, publicar nos mimos, descartar). Tudo só do próprio.
 */
@Controller('instants')
@UseGuards(JwtAuthGuard)
export class InstantsRecapController {
  constructor(private readonly recaps: InstantsRecapService) {}

  @Get('settings')
  settings(@Req() req: AuthedReq) {
    return this.recaps.settings(req.userId!);
  }

  @Put('settings')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  setSettings(@Req() req: AuthedReq, @Body(new ZodPipe(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.recaps.setSettings(req.userId!, b.keepForRecap);
  }

  /** Os meus Zás dos últimos 7 dias: os ativos (24 h) e os guardados (só eu os vejo). */
  @Get('archive')
  archive(@Req() req: AuthedReq) {
    return this.recaps.archive(req.userId!);
  }

  @Get('recaps')
  list(@Req() req: AuthedReq) {
    return this.recaps.list(req.userId!);
  }

  @Get('recaps/:id')
  get(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.recaps.get(req.userId!, id);
  }

  @Get('recaps/:id/download')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async download(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.recaps.download(req.userId!, id);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(f.bytes);
  }

  /** Publicar o resumo nos mimos (para os amigos ou só os amigos próximos). */
  @NeedsVerifiedEmail()
  @Post('recaps/:id/publish')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  publish(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(publishSchema)) b: z.infer<typeof publishSchema>) {
    return this.recaps.publish(req.userId!, id, b.audience);
  }

  @Delete('recaps/:id')
  @HttpCode(204)
  remove(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.recaps.remove(req.userId!, id);
  }
}
