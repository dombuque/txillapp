import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { Body, Controller, Delete, Get, HttpCode, MessageEvent, Param, ParseUUIDPipe, Post, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Observable, interval, map, merge } from 'rxjs';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { MediaService, parseIdParam } from '../media/media.service';
import { ChatEvents } from './chat.events';
import { ChatService } from './chat.service';

type AuthedReq = Request & { userId?: string };
const sendSchema = z.object({
  body: z.string().trim().max(2000).default(''),
  kind: z.enum(['text', 'image', 'voice']).default('text'),
  mediaId: z.string().uuid().optional(),
  durationMs: z.number().int().min(0).max(300_000).optional(),
});

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly events: ChatEvents,
    private readonly media: MediaService,
  ) {}

  /** Tempo real: o servidor avisa quando chega mensagem, alguém escreve, lê ou apaga. O cliente volta a pedir os dados. */
  @Sse('stream')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  stream(@Req() req: AuthedReq): Observable<MessageEvent> {
    const events = this.events.forUser(req.userId!).pipe(map((e): MessageEvent => ({ data: e })));
    // Batimento: mantém a ligação viva através de proxies.
    const ping = interval(25_000).pipe(map((): MessageEvent => ({ data: { type: 'ping' } })));
    return merge(events, ping);
  }

  /** Fotos e voz do chat: URL assinado e temporário (não público). */
  @Get('media/:id')
  @SkipThrottle()
  async file(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const found = await this.media.locateChat(parseIdParam(id), Number(exp), sig);
    if ('url' in found) return res.setHeader('Cache-Control', 'private, max-age=240').redirect(302, found.url);
    res.setHeader('Content-Type', found.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(found.path);
  }

  @Get('conversations')
  @UseGuards(JwtAuthGuard)
  list(@Req() req: AuthedReq) {
    return this.chat.list(req.userId!);
  }

  @Get('unread')
  @UseGuards(JwtAuthGuard)
  unread(@Req() req: AuthedReq) {
    return this.chat.unread(req.userId!);
  }

  @Get('with/:username')
  @UseGuards(JwtAuthGuard)
  thread(@Req() req: AuthedReq, @Param('username') username: string, @Query('cursor') cursor?: string) {
    return this.chat.thread(req.userId!, username, cursor);
  }

  @NeedsVerifiedEmail()
  @Post('with/:username')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  send(@Req() req: AuthedReq, @Param('username') username: string, @Body(new ZodPipe(sendSchema)) b: z.infer<typeof sendSchema>) {
    return this.chat.send(req.userId!, username, b);
  }

  @Post('with/:username/typing')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  typing(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.chat.typing(req.userId!, username);
  }

  @Delete('messages/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  remove(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.remove(req.userId!, id);
  }
}
