import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { Body, Controller, Delete, Get, HttpCode, MessageEvent, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Observable, finalize, interval, map, merge } from 'rxjs';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { MediaService, parseIdParam } from '../media/media.service';
import { ChatEvents } from './chat.events';
import { GroupsService } from './groups.service';
import { ChatService } from './chat.service';

type AuthedReq = Request & { userId?: string };
const groupSchema = z.object({ name: z.string().trim().min(1).max(40), members: z.array(z.string().trim().min(1).max(40)).min(2).max(49) });
const renameSchema = z.object({ name: z.string().trim().min(1).max(40) });
const membersSchema = z.object({ members: z.array(z.string().trim().min(1).max(40)).min(1).max(49) });

const liveSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const sendSchema = z.object({
  body: z.string().trim().max(2000).default(''),
  kind: z.enum(['text', 'image', 'voice', 'sticker', 'location', 'post', 'gift']).default('text'),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  once: z.boolean().optional(),
  liveMinutes: z.union([z.literal(15), z.literal(60), z.literal(480)]).optional(),
  mediaId: z.string().uuid().optional(),
  durationMs: z.number().int().min(0).max(300_000).optional(),
  waveform: z.string().regex(/^[0-9]{8,96}$/).optional(),
});

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly groups: GroupsService,
    private readonly events: ChatEvents,
    private readonly media: MediaService,
  ) {}

  /** Tempo real: o servidor avisa quando chega mensagem, alguém escreve, lê ou apaga. O cliente volta a pedir os dados. */
  @Sse('stream')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  stream(@Req() req: AuthedReq): Observable<MessageEvent> {
    const uid = req.userId!;
    this.events.connect(uid);
    void this.chat.touchSeen(uid);
    const events = this.events.forUser(uid).pipe(map((e): MessageEvent => ({ data: e })));
    // Batimento: mantém a ligação viva através de proxies.
    const ping = interval(25_000).pipe(map((): MessageEvent => ({ data: { type: 'ping' } })));
    // Ao fechar a ligação, guarda a hora a que a pessoa esteve online pela última vez.
    return merge(events, ping).pipe(finalize(() => { if (this.events.disconnect(uid)) void this.chat.touchSeen(uid); }));
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
  async unread(@Req() req: AuthedReq) {
    const [direct, groups] = await Promise.all([this.chat.unread(req.userId!), this.groups.list(req.userId!)]);
    return { conversations: direct.conversations + groups.filter((g) => g.unread > 0).length, requests: direct.requests };
  }

  /* ───────────── grupos ───────────── */

  @NeedsVerifiedEmail()
  @Post('groups')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  createGroup(@Req() req: AuthedReq, @Body(new ZodPipe(groupSchema)) b: z.infer<typeof groupSchema>) {
    return this.groups.create(req.userId!, b.name, b.members);
  }

  @Get('groups')
  @UseGuards(JwtAuthGuard)
  listGroups(@Req() req: AuthedReq) {
    return this.groups.list(req.userId!);
  }

  @Get('groups/:id')
  @UseGuards(JwtAuthGuard)
  groupThread(@Req() req: AuthedReq, @Param('id') id: string, @Query('cursor') cursor?: string) {
    return this.groups.thread(req.userId!, id, cursor);
  }

  @NeedsVerifiedEmail()
  @Post('groups/:id/messages')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  sendToGroup(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(sendSchema)) b: z.infer<typeof sendSchema>) {
    return this.groups.send(req.userId!, id, b);
  }

  @Patch('groups/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  renameGroup(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(renameSchema)) b: z.infer<typeof renameSchema>) {
    return this.groups.rename(req.userId!, id, b.name);
  }

  @Post('groups/:id/members')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  addGroupMembers(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(membersSchema)) b: z.infer<typeof membersSchema>) {
    return this.groups.addMembers(req.userId!, id, b.members);
  }

  @Delete('groups/:id/members/:username')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  removeGroupMember(@Req() req: AuthedReq, @Param('id') id: string, @Param('username') username: string) {
    return this.groups.removeMember(req.userId!, id, username);
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

  /** Pedidos de mensagem (de quem não sigo): aceitar passa a conversa para a lista normal; recusar esconde-a. */
  @Post('with/:username/accept')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  accept(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.chat.accept(req.userId!, username);
  }

  @Post('with/:username/decline')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  decline(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.chat.decline(req.userId!, username);
  }

  @Post('with/:username/typing')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  typing(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.chat.typing(req.userId!, username);
  }

  /** Abrir uma mensagem de visualização única: devolve o conteúdo uma vez e apaga-o. */
  @Post('messages/:id/open')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  open(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.open(req.userId!, id);
  }

  /** Localização em direto: atualizar a posição, ou parar a partilha. */
  @Put('messages/:id/location')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  live(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(liveSchema)) b: z.infer<typeof liveSchema>) {
    return this.chat.updateLive(req.userId!, id, b.lat, b.lng);
  }

  @Delete('messages/:id/live')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  stopLive(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.stopLive(req.userId!, id);
  }

  @Delete('messages/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  remove(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.remove(req.userId!, id);
  }
}
