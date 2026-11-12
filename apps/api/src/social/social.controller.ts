import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { birthDateSchema, genderSchema } from '@txillapp/shared';
import { ZodPipe } from '../common/zod.pipe';
import { PROFILE_TABS, PostsService, type ProfileTab } from '../posts/posts.service';
import { SocialService } from './social.service';
import { MentionSuggestService } from './mention-suggest.service';

type AuthedReq = Request & { userId?: string };

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  bio: z.string().trim().max(150).optional(),
  isPrivate: z.boolean().optional(),
  /** Ligação do perfil (só http/https) e cidade; vazio apaga. */
  // Sem "https://" também serve: acrescenta-se aqui, para a app e o site não obrigarem a escrevê-lo.
  website: z
    .string()
    .trim()
    .max(100)
    .transform((v) => (v !== '' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? `https://${v}` : v))
    .refine((v) => v === '' || /^https?:\/\/[^\s]+\.[^\s]{2,}$/i.test(v), 'Escreve um link válido (por exemplo, o-teu-site.com)')
    .optional(),
  city: z.string().trim().max(40).optional(),
});

const consentSchema = z.object({ birthDate: birthDateSchema, acceptTerms: z.literal(true) });
const avatarSchema = z.object({ mediaId: z.string().uuid() });
const who = z.enum(['everyone', 'following', 'off']);
const viewers = z.enum(['everyone', 'followers', 'off']);
const contactsSchema = z.object({ hashes: z.array(z.string().regex(/^[0-9a-fA-F]{64}$/)).max(500) });
const privacySchema = z.object({
  repostsVisible: viewers.optional(),
  cheersVisible: viewers.optional(),
  giftsVisible: viewers.optional(),
  isPrivate: z.boolean().optional(),
  commentsAllowed: who.optional(),
  giftsAllowed: who.optional(),
  mentionsAllowed: who.optional(),
  dmsAllowed: who.optional(),
  callsAllowed: z.enum(['everyone', 'following', 'mutual', 'off']).optional(),
  callsRelayOnly: z.boolean().optional(),
  shareAnalytics: z.boolean().optional(),
  showConnections: z.enum(['everyone', 'followers', 'me']).optional(),
  suggestable: z.boolean().optional(),
  gender: genderSchema.optional(),
  showGender: z.boolean().optional(),
  showPresence: z.boolean().optional(),
  findByContacts: z.boolean().optional(),
  /** «Deixar fazer duetos e respostas com as minhas tchekas» (numa conta privada não vale). */
  remixAllowed: z.boolean().optional(),
});

/** Sugestões de @menções: o que se escreveu depois do @ e onde se está a escrever (para subir quem lá está). */
const mentionSuggestSchema = z.object({
  q: z.string().max(60).default(''),
  context: z.enum(['post', 'group', 'story', 'zas', 'chat']).optional(),
  id: z.string().uuid().optional(),
});

@Controller()
@UseGuards(JwtAuthGuard)
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly posts: PostsService,
    private readonly mentions: MentionSuggestService,
  ) {}

  @Patch('users/me')
  updateMe(@Req() req: AuthedReq, @Body(new ZodPipe(updateSchema)) b: z.infer<typeof updateSchema>) {
    return this.social.updateMe(req.userId!, b);
  }

  /** Aceitar os Termos e a Política de Privacidade em vigor (depois de uma atualização). */
  @Put('users/me/terms')
  acceptTerms(@Req() req: AuthedReq, @Body(new ZodPipe(z.object({ acceptTerms: z.literal(true) }))) _b: { acceptTerms: true }) {
    return this.social.acceptTerms(req.userId!);
  }

  /** Contas antigas: completar a data de nascimento e aceitar os termos em vigor. */
  @Put('users/me/consent')
  consent(@Req() req: AuthedReq, @Body(new ZodPipe(consentSchema)) b: z.infer<typeof consentSchema>) {
    return this.social.setConsent(req.userId!, b.birthDate);
  }

  /** O que falta para o perfil estar a 100%. */
  @Get('users/me/completeness')
  completeness(@Req() req: AuthedReq) {
    return this.social.completeness(req.userId!);
  }

  @Put('users/me/welcomed')
  welcomed(@Req() req: AuthedReq) {
    return this.social.setWelcomed(req.userId!);
  }

  @Put('users/me/avatar')
  setAvatar(@Req() req: AuthedReq, @Body(new ZodPipe(avatarSchema)) b: z.infer<typeof avatarSchema>) {
    return this.social.setAvatar(req.userId!, b.mediaId);
  }

  @Delete('users/me/avatar')
  clearAvatar(@Req() req: AuthedReq) {
    return this.social.clearAvatar(req.userId!);
  }

  /** Definições de privacidade (quem pode comentar, presentear, ver listas, ser sugerido…). */
  @Get('settings/privacy')
  privacy(@Req() req: AuthedReq) {
    return this.social.privacy(req.userId!);
  }

  @Patch('settings/privacy')
  setPrivacy(@Req() req: AuthedReq, @Body(new ZodPipe(privacySchema)) b: z.infer<typeof privacySchema>) {
    return this.social.setPrivacy(req.userId!, b);
  }

  @Get('blocks')
  blocked(@Req() req: AuthedReq) {
    return this.social.blocked(req.userId!);
  }

  @Put('blocks/:username')
  block(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.block(req.userId!, username);
  }

  @Delete('blocks/:username')
  unblock(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.unblock(req.userId!, username);
  }

  @Post('contacts/match')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  matchContacts(@Req() req: AuthedReq, @Body(new ZodPipe(contactsSchema)) b: z.infer<typeof contactsSchema>) {
    return this.social.matchContacts(req.userId!, b.hashes);
  }

  @Get('users/:username')
  profile(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.profile(req.userId!, username);
  }

  @Get('users/:username/posts')
  async userPosts(@Req() req: AuthedReq, @Param('username') username: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string, @Query('tab') tab?: string) {
    await this.social.assertVisible(req.userId!, username);
    const n = Math.min(Math.max(parseInt(limit ?? '18', 10) || 18, 1), 50);
    return this.posts.byAuthor(req.userId!, username, cursor, n, (PROFILE_TABS as readonly string[]).includes(tab ?? '') ? (tab as ProfileTab) : 'all');
  }

  @Post('users/:username/follow')
  @HttpCode(200)
  follow(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.follow(req.userId!, username);
  }

  /** O mesmo que o DELETE, por POST: há redes e aparelhos que não deixam passar DELETE. */
  @Post('users/:username/unfollow')
  @HttpCode(200)
  unfollowPost(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.unfollow(req.userId!, username);
  }

  @Delete('users/:username/follow')
  unfollow(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.unfollow(req.userId!, username);
  }

  @Get('users/:username/followers')
  followers(@Req() req: AuthedReq, @Param('username') username: string, @Query('cursor') cursor?: string, @Query('q') q?: string) {
    return this.social.followers(req.userId!, username, cursor, q);
  }

  @Get('users/:username/following')
  following(@Req() req: AuthedReq, @Param('username') username: string, @Query('cursor') cursor?: string, @Query('q') q?: string) {
    return this.social.following(req.userId!, username, cursor, q);
  }

  @Get('follow-requests')
  requests(@Req() req: AuthedReq) {
    return this.social.requests(req.userId!);
  }

  @Post('follow-requests/:username/accept')
  @HttpCode(204)
  accept(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.acceptRequest(req.userId!, username);
  }

  @Post('follow-requests/:username/decline')
  @HttpCode(204)
  decline(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.declineRequest(req.userId!, username);
  }

  /** Autocompletar de @menções: primeiro quem sigo, depois contas públicas que aceitam menções de todos. */
  /** Dos nomes pedidos (até 20, separados por vírgula), quais são contas ativas: só esses ganham link nas menções. */
  @Get('mentions/exist')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  mentionsExist(@Query('names') names?: string) {
    return this.social.existing((names ?? '').split(',').slice(0, 20));
  }

  /**
   * Quem sugerir ao escrever @: as pessoas mais próximas (conversas, amigos próximos, seguir, interações), filtradas
   * pelo início do @ ou de uma palavra do nome; completa com a pesquisa geral. Chama-se a cada tecla (com debounce).
   */
  @Get('mentions/suggest')
  @Throttle({ default: { limit: 180, ttl: 60_000 } })
  mentionSuggest(@Req() req: AuthedReq, @Query(new ZodPipe(mentionSuggestSchema)) q: z.infer<typeof mentionSuggestSchema>) {
    return this.mentions.suggest(req.userId!, q.q, q.context, q.id);
  }

  @Get('mentionable')
  mentionable(@Req() req: AuthedReq, @Query('q') q?: string) {
    return this.social.mentionable(req.userId!, (q ?? '').slice(0, 30));
  }

  @Get('suggestions/people')
  suggestions(@Req() req: AuthedReq) {
    return this.social.suggestions(req.userId!);
  }

  @Post('suggestions/people/:username/dismiss')
  @HttpCode(204)
  dismiss(@Req() req: AuthedReq, @Param('username') username: string) {
    return this.social.dismiss(req.userId!, username);
  }
}
