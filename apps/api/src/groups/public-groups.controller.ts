import { Controller, Delete, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { PublicGroupsService } from './public-groups.service';

type AuthedReq = Request & { userId?: string };

/** TxillGroups vistos de fora: ver o grupo, entrar ou pedir para entrar, e os admins respondem. Formatos em public-groups.service.ts. */
@Controller('chat/groups/:id')
@UseGuards(JwtAuthGuard)
export class PublicGroupsController {
  constructor(private readonly svc: PublicGroupsService) {}

  @Get('public')
  view(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.svc.view(req.userId!, id);
  }

  /** Público: entra logo (200 { status: 'member' }). Privado no mapa: 201 { status: 'pending' } (200 se já estava à espera). */
  @Post('join-requests')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async request(@Req() req: AuthedReq, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.svc.request(req.userId!, id);
    res.status(r.created ? 201 : 200);
    return { status: r.status };
  }

  @Delete('join-requests/me')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  cancel(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.svc.cancel(req.userId!, id);
  }

  @Get('join-requests')
  list(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.svc.list(req.userId!, id);
  }

  @Post('join-requests/:username/accept')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  accept(@Req() req: AuthedReq, @Param('id') id: string, @Param('username') username: string) {
    return this.svc.accept(req.userId!, id, username);
  }

  @Post('join-requests/:username/decline')
  @HttpCode(204)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  decline(@Req() req: AuthedReq, @Param('id') id: string, @Param('username') username: string) {
    return this.svc.decline(req.userId!, id, username);
  }
}
