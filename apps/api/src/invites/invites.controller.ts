import { Controller, Get, NotFoundException, Param, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { InvitesService } from './invites.service';

type AuthedReq = Request & { userId?: string };

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /** O meu código, a ligação, os números e o que a app precisa para desenhar o cartão. */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: AuthedReq) {
    return this.invites.me(req.userId!);
  }

  /** «{Nome} convidou-te» na página de entrada e no registo (público; só nome, @, se há foto e a geleira que já é pública). */
  @Get('preview/:code')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  preview(@Param('code') code: string) {
    return this.invites.preview(code);
  }

  /** A página com as meta tags (og) para os robôs das redes: o nginx manda para aqui os robôs que abrem /c/CÓDIGO. */
  @Get('share/:code')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async share(@Param('code') code: string, @Req() req: Request, @Res() res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('html').send(await this.invites.sharePage(code, req.headers.host));
  }

  /** O cartão do convite em PNG (1200×630), feito no servidor para a pré-visualização. */
  @Get('card/:file')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async card(@Param('file') file: string, @Res() res: Response) {
    const png = await this.invites.ogImage(file.replace(/\.png$/i, ''));
    if (!png) throw new NotFoundException();
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.type('png').send(png);
  }
}
