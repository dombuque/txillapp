import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { RiskCheck } from '../security/risk.guard';
import { Body, Controller, Delete, Get, HttpCode, MessageEvent, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Observable, finalize, interval, map, merge } from 'rxjs';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { ZodPipe } from '../common/zod.pipe';
import { gifSchema } from '../gifs/gif';
import { MediaService, parseIdParam } from '../media/media.service';
import { ChatEvents } from './chat.events';
import { GROUP_KINDS, GroupsService } from './groups.service';
import { ChatService } from './chat.service';
import { NotesService } from './notes.service';

type AuthedReq = Request & { userId?: string };
// TxillGroups: nome 2-40, tipo (por omissão 'outro'), descrição e capa opcionais.
const groupSchema = z.object({
  name: z.string().trim().min(2).max(40),
  kind: z.enum(GROUP_KINDS).default('outro'),
  description: z.string().trim().max(300).optional(),
  coverMediaId: z.string().uuid().optional(),
  // Foto de perfil do grupo: como a capa (carregada antes em /media/uploads).
  avatarMediaId: z.string().uuid().optional(),
  members: z.array(z.string().trim().min(1).max(40)).min(2).max(49),
});
const renameSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  kind: z.enum(GROUP_KINDS).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  coverMediaId: z.string().uuid().nullable().optional(),
  avatarMediaId: z.string().uuid().nullable().optional(),
  // Privado oculto / privado no mapa (pedem para entrar) / público (entram logo). Só admins.
  visibility: z.enum(['private', 'public']).optional(),
  showOnMap: z.boolean().optional(),
  // O sítio no mapa quando o plano não tem um local aprovado (0104). O servidor arredonda; null limpa. Só admins.
  mapPlace: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), label: z.string().trim().max(80).nullable().optional() })
    .nullable()
    .optional(),
});
const membersSchema = z.object({ members: z.array(z.string().trim().min(1).max(40)).min(1).max(49) });
const roleSchema = z.object({ role: z.enum(['admin', 'member']) });

const liveSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const sendSchema = z.object({
  body: z.string().trim().max(2000).default(''),
  kind: z.enum(['text', 'image', 'voice', 'video', 'sticker', 'location', 'post', 'gift', 'zas_reply', 'gif']).default('text'),
  // GIF do GIPHY (kind 'gif'): { id, w, h, url, still?, title? }; o url tem de ser https de media*.giphy.com (src/gifs/gif.ts).
  gif: gifSchema.optional(),
  instantId: z.string().uuid().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  once: z.boolean().optional(),
  liveMinutes: z.union([z.literal(15), z.literal(60), z.literal(480)]).optional(),
  // Localização de um sítio escolhido ("Sítios perto" ou a pesquisa): o nome e a morada vão com o ponto. Opcionais.
  name: z.string().trim().max(80).optional(),
  address: z.string().trim().max(160).optional(),
  mediaId: z.string().uuid().optional(),
  durationMs: z.number().int().min(0).max(300_000).optional(),
  waveform: z.string().regex(/^[0-9]{8,96}$/).optional(),
  replyTo: z.string().uuid().optional(),
});
const activeSchema = z.object({ key: z.string().regex(/^(u:[A-Za-z0-9_.]{1,40}|g:[0-9a-f-]{36})$/).nullable() });
const reactSchema = z.object({ reaction: z.string().regex(/^:[a-z]{2,12}:$/) });
/** Editar uma mensagem de texto (o texto novo; o resto das regras está no serviço). */
const editSchema = z.object({ body: z.string().max(2000) });
/** Mensagens temporárias: 24 horas, 7 dias ou 90 dias (em segundos), ou null (desligadas). */
const ttlSchema = z.object({ ttl: z.union([z.literal(86_400), z.literal(604_800), z.literal(7_776_000), z.null()]) });

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly groups: GroupsService,
    private readonly events: ChatEvents,
    private readonly media: MediaService,
    private readonly notes: NotesService,
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

  /** A app diz que conversa tem aberta e à vista (ou `null` ao sair): quem está a ver não recebe aviso no telemóvel. */
  @Put('active')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @SkipThrottle()
  active(@Req() req: AuthedReq, @Body(new ZodPipe(activeSchema)) b: z.infer<typeof activeSchema>) {
    this.events.setActive(req.userId!, b.key);
  }

  /** Fotos e voz do chat: URL assinado e temporário (não público). */
  @Get('media/:id')
  @SkipThrottle()
  async file(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Query('w') w: string | undefined, @Res() res: Response) {
    // ?w=: a largura leve de uma foto (o visor do Zás); sem ela, o original.
    const found = await this.media.locateChat(parseIdParam(id), Number(exp), sig, w ? Number(w) : undefined);
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
    return this.groups.create(req.userId!, b.name, b.members, { kind: b.kind, description: b.description, coverMediaId: b.coverMediaId, avatarMediaId: b.avatarMediaId });
  }

  @Get('groups')
  @UseGuards(JwtAuthGuard)
  listGroups(@Req() req: AuthedReq) {
    return this.groups.list(req.userId!);
  }

  @Get('groups/:id')
  @UseGuards(JwtAuthGuard)
  groupThread(@Req() req: AuthedReq, @Param('id') id: string, @Query('cursor') cursor?: string, @Query('read') read?: string) {
    return this.groups.thread(req.userId!, id, cursor, read !== '0');
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
    return this.groups.update(req.userId!, id, b);
  }

  @Post('groups/:id/members')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  addGroupMembers(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(membersSchema)) b: z.infer<typeof membersSchema>) {
    return this.groups.addMembers(req.userId!, id, b.members);
  }

  /** Dar ou tirar o papel de admin (só admins): 200 { username, role }. Regras em groups.service.ts. */
  @Patch('groups/:id/members/:username')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  setGroupRole(@Req() req: AuthedReq, @Param('id') id: string, @Param('username') username: string, @Body(new ZodPipe(roleSchema)) b: z.infer<typeof roleSchema>) {
    return this.groups.setRole(req.userId!, id, username, b.role);
  }

  /** Mensagens temporárias no grupo (só admins): { ttl } -> 200 { ttl }. Deixa o aviso na conversa. */
  @Put('groups/:id/ttl')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  setGroupTtl(@Req() req: AuthedReq, @Param('id') id: string, @Body(new ZodPipe(ttlSchema)) b: z.infer<typeof ttlSchema>) {
    return this.groups.setTtl(req.userId!, id, b.ttl);
  }

  /** Limpar a conversa do grupo só para mim: 200 { ok }. */
  @Post('groups/:id/clear')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  clearGroup(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.groups.clear(req.userId!, id);
  }

  @Delete('groups/:id/members/:username')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  removeGroupMember(@Req() req: AuthedReq, @Param('id') id: string, @Param('username') username: string) {
    return this.groups.removeMember(req.userId!, id, username);
  }

  @Get('with/:username')
  @UseGuards(JwtAuthGuard)
  async thread(@Req() req: AuthedReq, @Param('username') username: string, @Query('cursor') cursor?: string, @Query('read') read?: string) {
    // `read=0`: só ler os dados (pré-carregar, atualizar com a conversa por trás) sem marcar como lida.
    const t = await this.chat.thread(req.userId!, username, cursor, read !== '0');
    if (cursor) return t;
    // A nota ativa da pessoa, por baixo da foto do cabeçalho (só na 1.ª página e só se eu a puder ver). Junta-se aqui e
    // não no ChatService porque o NotesService já depende do ChatService (as respostas às notas vão como mensagem).
    // Sem nota, vai a bio do perfil no mesmo sítio (a nota ganha sempre; regras em NotesService.peerBio).
    const peerNote = await this.notes.peerNote(req.userId!, t.person.username);
    const peerBio = peerNote ? null : await this.notes.peerBio(req.userId!, t.person.username);
    return { ...t, peerNote, peerBio };
  }

  // A segurança por cima de tudo (corre depois da sessão): rajadas das contas novas e «sem mensagens a desconhecidos» nas suspeitas.
  @RiskCheck('dm')
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

  /** Marcar como por ler (swipe na lista). */
  @Post('with/:username/unread')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  markUnread(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.chat.markUnread(req.userId!, username);
  }

  /** Apagar a conversa só do meu lado (sai da lista até chegar outra mensagem). */
  @Delete('with/:username')
  @UseGuards(JwtAuthGuard)
  clear(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.chat.clearForMe(req.userId!, username);
  }

  /** Limpar a conversa só para mim (fica na lista, vazia, até chegar outra mensagem): 200 { ok }. */
  @Post('with/:username/clear')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  clearKeep(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.chat.clearForMe(req.userId!, username, true);
  }

  /** Mensagens temporárias na conversa (qualquer um dos dois): { ttl } -> 200 { ttl }. Deixa o aviso na conversa. */
  @Put('with/:username/ttl')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  setTtl(@Req() req: AuthedReq, @Param('username') username: string, @Body(new ZodPipe(ttlSchema)) b: z.infer<typeof ttlSchema>) {
    return this.chat.setTtl(req.userId!, username, b.ttl);
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

  /** Reagir a uma mensagem (uma reação por pessoa; muda se escolher outra). */
  @Put('messages/:id/reaction')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  react(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reactSchema)) b: z.infer<typeof reactSchema>) {
    return this.chat.react(req.userId!, id, b.reaction);
  }

  @Delete('messages/:id/reaction')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  unreact(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.react(req.userId!, id, null);
  }

  /** Apagar para todos (só as minhas): fica o aviso "Esta mensagem foi apagada". */
  @Delete('messages/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  remove(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.remove(req.userId!, id);
  }

  /** Editar a minha mensagem de texto (nos primeiros 15 minutos). */
  @Patch('messages/:id')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  edit(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(editSchema)) b: z.infer<typeof editSchema>) {
    return this.chat.edit(req.userId!, id, b.body);
  }

  /** Apagar para mim (qualquer mensagem de uma conversa ou grupo em que estou): só deixa de me aparecer a mim. */
  @Post('messages/:id/hide')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  hide(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.hideForMe(req.userId!, id);
  }
}
