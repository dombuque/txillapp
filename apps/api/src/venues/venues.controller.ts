import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
import { VENUE_KINDS, VenuesService } from './venues.service';

type AuthedReq = Request & { userId?: string };

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(VENUE_KINDS),
  city: z.string().trim().max(60).optional(),
  about: z.string().trim().max(300).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

/** Locais: bares, restaurantes, discotecas… com página, dono, selo e check-in por QR. */
@Controller('venues')
@UseGuards(JwtAuthGuard)
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.venues.create(req.userId!, b);
  }

  @Get('mine')
  mine(@Req() req: AuthedReq) {
    return this.venues.mine(req.userId!);
  }

  @Get('find')
  find(@Req() req: AuthedReq, @Query('name') name = '') {
    return this.venues.findByName(req.userId!, name);
  }

  @Get(':slug')
  get(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.venues.get(req.userId!, slug);
  }

  @Post(':slug/checkin')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  checkin(@Req() req: AuthedReq, @Param('slug') slug: string, @Body(new ZodPipe(z.object({ token: z.string().min(8).max(64) }))) b: { token: string }) {
    return this.venues.checkin(req.userId!, slug, b.token);
  }

  @Post(':slug/qr/rotate')
  rotate(@Req() req: AuthedReq, @Param('slug') slug: string) {
    return this.venues.rotateToken(req.userId!, slug);
  }

  /** A equipa verifica o local (selo). */
  @Put(':slug/verified')
  @UseGuards(StaffGuard)
  @Needs('catalog.manage')
  verify(@Param('slug') slug: string, @Body(new ZodPipe(z.object({ verified: z.boolean() }))) b: { verified: boolean }) {
    return this.venues.setVerified(slug, b.verified);
  }
}
