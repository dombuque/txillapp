import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { InvitesService } from './invites.service';

type AuthedReq = Request & { userId?: string };

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /** O meu código, a ligação e os números. */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: AuthedReq) {
    return this.invites.me(req.userId!);
  }

  /** «Convite de …» no registo (público; só devolve nome e @). */
  @Get('preview/:code')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  preview(@Param('code') code: string) {
    return this.invites.preview(code);
  }
}
