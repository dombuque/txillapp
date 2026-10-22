import { Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.controller';
import { NotificationsService } from './notifications.service';

type AuthedReq = Request & { userId?: string };

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

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
