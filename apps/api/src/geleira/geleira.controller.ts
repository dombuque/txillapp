import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { Needs, StaffGuard } from '../staff/staff.guard';
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
const settingsSchema = z.object({
  matching: z.boolean().optional(),
  visibility: z.enum(['everyone', 'followers', 'close_friends', 'me']).optional(),
  // Mostrar quem brindou a minha geleira a quem a pode ver.
  cheersPublic: z.boolean().optional(),
});
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

  @Get('users/:username/geleira/level')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  level(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.geleira.level(req.userId!, username);
  }

  /** Brindar a geleira de alguém (só quem a pode ver; a própria não); DELETE tira o brinde. Devolve { cheered, cheers }. */
  @Put('users/:username/geleira/cheer')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  cheer(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.geleira.cheer(req.userId!, username, true);
  }

  @Delete('users/:username/geleira/cheer')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  uncheer(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.geleira.cheer(req.userId!, username, false);
  }

  /**
   * Brindar um gosto da geleira de alguém, no perfil (PUT; DELETE tira o brinde). É o mesmo brinde que no cartão do post da
   * geleira: uma vez por pessoa e item. Devolve { itemId, cheered, cheers }.
   */
  @Put('users/:username/geleira/items/:itemId/cheer')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  cheerItem(@Req() req: AuthedReq, @Param('username') username: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.geleira.cheerItem(req.userId!, { username }, itemId, true);
  }

  @Delete('users/:username/geleira/items/:itemId/cheer')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  uncheerItem(@Req() req: AuthedReq, @Param('username') username: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.geleira.cheerItem(req.userId!, { username }, itemId, false);
  }

  /** Brindar um gosto no cartão de um post da geleira (tocar num item). Conta no perfil como os brindes feitos lá. */
  @Put('posts/:postId/geleira/items/:itemId/cheer')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  cheerPostItem(@Req() req: AuthedReq, @Param('postId', ParseUUIDPipe) postId: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.geleira.cheerItem(req.userId!, { postId }, itemId, true);
  }

  @Delete('posts/:postId/geleira/items/:itemId/cheer')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  uncheerPostItem(@Req() req: AuthedReq, @Param('postId', ParseUUIDPipe) postId: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.geleira.cheerItem(req.userId!, { postId }, itemId, false);
  }

  /** Quem brindou a geleira: o dono sempre; os outros se o dono mostra a lista e podem ver a geleira (senão 403/404). */
  @Get('users/:username/geleira/cheers')
  cheers(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.geleira.cheers(req.userId!, username);
  }

  @Get('users/:username/geleira')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  of(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.geleira.of(req.userId!, username);
  }

  @Get('admin/geleira')
  @UseGuards(StaffGuard)
  @Needs('catalog.manage')
  pending() {
    return this.geleira.pending();
  }

  @Post('admin/geleira/:itemId')
  @UseGuards(StaffGuard)
  @Needs('catalog.manage')
  @HttpCode(204)
  decide(@Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodPipe(decideSchema)) b: z.infer<typeof decideSchema>) {
    return this.geleira.decide(itemId, b.approve);
  }
}
