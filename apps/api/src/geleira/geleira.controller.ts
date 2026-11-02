import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { AdminGuard } from '../moderation/moderation.controller';
import { GeleiraService, KINDS } from './geleira.service';

type AuthedReq = Request & { userId?: string };

const catalogSchema = z.object({ q: z.string().trim().max(60).optional(), kind: z.enum(KINDS).optional() });
const putSchema = z.object({
  rating: z.number().int().min(1).max(5).nullable().optional(),
  favorite: z.boolean().optional(),
});
const suggestSchema = z.object({
  name: z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N}][\p{L}\p{N} '&.\-]*$/u, 'Só letras, números e espaços'),
  kind: z.enum(KINDS),
  category: z.string().trim().min(2).max(30).regex(/^[a-z0-9-]+$/),
  alcoholic: z.boolean().optional(),
});
const settingsSchema = z.object({ matching: z.boolean().optional(), visibility: z.enum(['everyone', 'followers', 'close_friends', 'me']).optional() });
const decideSchema = z.object({ approve: z.boolean() });

@Controller()
@UseGuards(JwtAuthGuard)
export class GeleiraController {
  constructor(private readonly geleira: GeleiraService) {}

  @Get('geleira/catalog')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  catalog(@Req() req: AuthedReq, @Query(new ZodPipe(catalogSchema)) q: z.infer<typeof catalogSchema>) {
    return this.geleira.catalog(req.userId!, q);
  }

  @Get('geleira/me')
  mine(@Req() req: AuthedReq) {
    return this.geleira.mine(req.userId!);
  }

  @Put('geleira/me/items/:itemId')
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  put(@Req() req: AuthedReq, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodPipe(putSchema)) b: z.infer<typeof putSchema>) {
    return this.geleira.put(req.userId!, itemId, b);
  }

  @Delete('geleira/me/items/:itemId')
  @HttpCode(204)
  remove(@Req() req: AuthedReq, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.geleira.remove(req.userId!, itemId);
  }

  @Post('geleira/items')
  @Throttle({ default: { limit: 15, ttl: 3_600_000 } })
  suggest(@Req() req: AuthedReq, @Body(new ZodPipe(suggestSchema)) b: z.infer<typeof suggestSchema>) {
    return this.geleira.suggest(req.userId!, b);
  }

  @Get('geleira/me/settings')
  settings(@Req() req: AuthedReq) {
    return this.geleira.settings(req.userId!);
  }

  @Put('geleira/me/settings')
  setSettings(@Req() req: AuthedReq, @Body(new ZodPipe(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.geleira.setSettings(req.userId!, b);
  }

  @Get('users/:username/geleira')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  of(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.geleira.of(req.userId!, username);
  }

  @Get('admin/geleira')
  @UseGuards(AdminGuard)
  pending() {
    return this.geleira.pending();
  }

  @Post('admin/geleira/:itemId')
  @UseGuards(AdminGuard)
  @HttpCode(204)
  decide(@Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodPipe(decideSchema)) b: z.infer<typeof decideSchema>) {
    return this.geleira.decide(itemId, b.approve);
  }
}
