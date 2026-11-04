import { Body, Controller, Get, HttpCode, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { NOTIFY_CATEGORIES, PushService } from '../push/push.service';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { NotificationsService } from './notifications.service';

type AuthedReq = Request & { userId?: string };

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService, private readonly push: PushService) {}

  /** O que me pode notificar: as categorias desligadas. */
  @Get('settings')
  async settings(@Req() req: AuthedReq) {
    return { categories: NOTIFY_CATEGORIES, off: await this.push.off(req.userId!) };
  }

  @Put('settings')
  @HttpCode(204)
  async saveSettings(@Req() req: AuthedReq, @Body(new ZodPipe(z.object({ off: z.array(z.enum(NOTIFY_CATEGORIES)).max(20) }))) b: { off: (typeof NOTIFY_CATEGORIES)[number][] }) {
    await this.push.setOff(req.userId!, b.off);
  }

  @Get()
  list(@Req() req: AuthedReq, @Query('cursor') cursor?: string) {
    return this.notifications.list(req.userId!, cursor);
  }

  /** O cliente consulta isto de tempos a tempos para o contador do sino. */
  @Get('unread-count')
  @SkipThrottle()
  unread(@Req() req: AuthedReq) {
    return this.notifications.unreadCount(req.userId!);
  }

  @Post('read')
  @HttpCode(204)
  read(@Req() req: AuthedReq) {
    return this.notifications.markAllRead(req.userId!);
  }
}
