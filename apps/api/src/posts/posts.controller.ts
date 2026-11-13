import { NeedsVerifiedEmail } from '../mail/verified-email.guard';
import { musicSchema } from '../music/music.service';
import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/auth.controller';
import { Throttle } from '@nestjs/throttler';
import { ZodPipe } from '../common/zod.pipe';
import { requireIdempotencyKey } from '../wallet/wallet.controller';
import { visibilitySchema } from './gifts.controller';
import { MAX_PHOTOS, PostsService } from './posts.service';
import { BoostsService } from '../boosts/boosts.service';
import { EventsService } from '../nearby/events.service';
import { coarse } from '../nearby/geo-sql';
import { decodeCursor } from './feed';
import { remixSchema } from './remix';

type AuthedReq = Request & { userId?: string };

const createSchema = z.object({
  body: z.string().trim().max(2000).default(''),
  music: musicSchema.nullable().optional(),
  locationLabel: z.string().trim().max(80).optional(),
  locationLat: z.number().min(-90).max(90).optional(),
  locationLng: z.number().min(-180).max(180).optional(),
  locationCoarse: z.boolean().optional(),
  mediaIds: z.array(z.string().uuid()).max(MAX_PHOTOS).default([]),
  tags: z.array(z.object({ index: z.number().int().min(0).max(MAX_PHOTOS - 1), username: z.string().min(3).max(30), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(30).default([]),
  /** Publicar como um local (página) que a pessoa gere. */
  venueId: z.string().uuid().nullable().optional(),
  /** «Usar este som» (docs/sons.md): o id de um som (original, `cat:…` ou `local:…`). Só em tchekas; o servidor valida-o. */
  soundId: z.string().trim().min(3).max(90).nullable().optional(),
  /** Dueto com uma tcheka, ou resposta com tcheka a um comentário (ver posts/remix.ts). */
  remixOf: remixSchema.nullable().optional(),
  /** Partilhar a minha geleira (0143): o servidor tira o retrato dos gostos agora; a legenda é opcional. */
  geleira: z.literal(true).optional(),
});
const updateSchema = z.object({ body: z.string().max(2000).optional(), commentsOff: z.boolean().optional(), clearLocation: z.boolean().optional() });
const repostSchema = z.object({ body: z.string().trim().max(500).default('') });
const giftSchema = z.object({
  amount: z.number().int().positive(),
  note: z.string().trim().max(280).default(''),
  visibility: visibilitySchema,
});

const seenSchema = z.object({ ids: z.array(z.string().uuid()).max(40) });
const hideSchema = z.object({ postId: z.string().uuid() });

/** Feed por relevância: o que aparece primeiro depende de ti, não só da hora. */
@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private readonly posts: PostsService, private readonly boosts: BoostsService, private readonly events: EventsService) {}

  /**
   * `lat`/`lng` (opcionais): a posição aproximada que a app já usa no "À tua volta" (ou o centro da cidade escolhida).
   * Arredonda-se aqui a 2 casas (~1 km) e só serve para escolher os destaques do Bombar; nunca se guarda.
   * Com posição, a página traz `sponsored`: os destaques (etiqueta "Bombado · Patrocinado") e depois de que publicação entram.
   */
  @Get()
  async feed(@Req() req: AuthedReq, @Query('cursor') cursor?: string, @Query('limit') limit?: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    const n = Math.min(Math.max(Number(limit) || 10, 1), 30);
    const page = await this.posts.rankedFeed(req.userId!, cursor, n);
    const la = Number(lat), ln = Number(lng);
    if (!lat || !lng || !Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return page;
    const me = req.userId!;
    const sponsored = await this.boosts.feedSlots(
      me,
      { lat: coarse(la), lng: coarse(ln) },
      { start: decodeCursor(cursor)?.n ?? 0, items: page.items, last: !page.nextCursor },
      {
        post: async (id) => ({ ...(await this.posts.getOne(me, id)), sponsored: true as const }),
        event: (id) => this.events.get(me, id),
      },
    );
    return { ...page, sponsored };
  }

  /** Vídeos curtos (Reels): os que mais te vão interessar, sem repetir os que já viste. */
  /** O Explorar: o 'Para ti' (nosso algoritmo) ou um tema. */
  @Get('explore')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  explore(@Req() req: AuthedReq, @Query('topic') topic?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 18, 1), 30);
    return this.posts.explore(req.userId!, topic ?? null, cursor, n);
  }

  /** O que o algoritmo aprendeu com a tua atividade. */
  @Get('algorithm')
  algorithm(@Req() req: AuthedReq) {
    return this.posts.activityTopics(req.userId!);
  }

  @Get('prefs')
  prefs(@Req() req: AuthedReq) {
    return this.posts.prefs(req.userId!);
  }

  @Put('prefs')
  setPref(@Req() req: AuthedReq, @Body(new ZodPipe(z.object({ topic: z.string().min(2).max(30), pref: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }))) b: { topic: string; pref: -1 | 0 | 1 }) {
    return this.posts.setPref(req.userId!, b.topic, b.pref);
  }

  /** Construir o algoritmo: origem, recente/popular, tipo de média, variedade, esconder o já visto e modo tranquilo. */
  @Get('settings')
  feedSettings(@Req() req: AuthedReq) {
    return this.posts.feedSettings(req.userId!);
  }

  @Put('settings')
  setFeedSettings(
    @Req() req: AuthedReq,
    @Body(
      new ZodPipe(
        z.object({
          following: z.enum(['less', 'balanced', 'more']).optional(),
          freshness: z.enum(['recent', 'balanced', 'popular']).optional(),
          media: z.enum(['all', 'photos', 'videos']).optional(),
          variety: z.enum(['low', 'normal', 'high']).optional(),
          hideSeen: z.boolean().optional(),
          calm: z.boolean().optional(),
        }),
      ),
    )
    b: Record<string, unknown>,
  ) {
    return this.posts.setFeedSettings(req.userId!, b);
  }

  /** Contas de que quero ver mais ou menos. */
  @Get('people')
  explorePeople(@Req() req: AuthedReq) {
    return this.posts.explorePeople(req.userId!);
  }

  @Put('people')
  setPerson(@Req() req: AuthedReq, @Body(new ZodPipe(z.object({ username: z.string().trim().min(2).max(40), pref: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }))) b: { username: string; pref: -1 | 0 | 1 }) {
    return this.posts.setPerson(req.userId!, b.username, b.pref);
  }

  @Delete('prefs')
  @HttpCode(204)
  resetPrefs(@Req() req: AuthedReq) {
    return this.posts.resetAlgorithm(req.userId!);
  }

  @Get('explore/topics')
  exploreTopics(@Req() req: AuthedReq, @Query('all') all?: string) {
    return this.posts.exploreTopics(req.userId!, all === '1');
  }

  /** Publicações de um sítio: ?label=...&mode=at|near. */
  @Get('place')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  place(@Req() req: AuthedReq, @Query('label') label = '', @Query('mode') mode = 'at', @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 10, 1), 30);
    return this.posts.byPlace(req.userId!, label, mode === 'near' ? 'near' : 'at', cursor, n);
  }

  /** Os meus guardados (privado). */
  @Get('saved')
  saved(@Req() req: AuthedReq, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 12, 1), 30);
    return this.posts.listSaved(req.userId!, cursor, n);
  }

  /** Tchekas: «Para ti» (o algoritmo) ou, com `?following=1`, «A seguir» (só de quem segues, com o mesmo algoritmo). */
  @Get('reels')
  reels(@Req() req: AuthedReq, @Query('cursor') cursor?: string, @Query('limit') limit?: string, @Query('following') following?: string) {
    const n = Math.min(Math.max(Number(limit) || 6, 1), 15);
    return this.posts.explore(req.userId!, null, cursor, n, true, following === '1' || following === 'true');
  }

  @Post('seen')
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  seen(@Req() req: AuthedReq, @Body(new ZodPipe(seenSchema)) b: z.infer<typeof seenSchema>) {
    return this.posts.markSeen(req.userId!, b.ids);
  }

  @Post('hide')
  @HttpCode(204)
  hide(@Req() req: AuthedReq, @Body(new ZodPipe(hideSchema)) b: z.infer<typeof hideSchema>) {
    return this.posts.hideFromFeed(req.userId!, b.postId);
  }
}

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @NeedsVerifiedEmail()
  @Post()
  create(@Req() req: AuthedReq, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return this.posts.create(req.userId!, b.body, b.locationLabel, b.mediaIds, b.tags, b.music ?? null, b.locationLat != null && b.locationLng != null ? { lat: b.locationLat, lng: b.locationLng, coarse: b.locationCoarse } : null, b.venueId ?? null, b.soundId ?? null, b.remixOf ?? null, b.music !== undefined, b.geleira === true);
  }

  /** «Duetos e respostas» desta publicação (?kind=duet|reply para só uns). */
  @Get(':id/remixes')
  remixes(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Query('kind') kind?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? '18', 10) || 18, 1), 50);
    return this.posts.remixes(req.userId!, id, kind === 'duet' || kind === 'reply' ? kind : null, cursor, n);
  }

  @Get()
  feed(@Req() req: AuthedReq, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 50);
    return this.posts.feed(req.userId!, cursor, n);
  }

  @Get(':id/people/:kind')
  people(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string) {
    if (kind !== 'reposts' && kind !== 'cheers' && kind !== 'gifts') throw new BadRequestException('Lista inválida');
    return this.posts.people(req.userId!, id, kind);
  }

  /** Interessado (1) ou não interessado (-1): ensina o algoritmo. */
  @Put(':id/interest')
  interest(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ value: z.union([z.literal(-1), z.literal(1)]) }))) b: { value: -1 | 1 }) {
    return this.posts.setInterest(req.userId!, id, b.value);
  }

  @Put(':id/save')
  @HttpCode(200)
  save(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.setSaved(req.userId!, id, true);
  }

  @Delete(':id/save')
  @HttpCode(200)
  unsave(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.setSaved(req.userId!, id, false);
  }

  @Patch(':id')
  update(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSchema)) b: z.infer<typeof updateSchema>) {
    return this.posts.update(req.userId!, id, b);
  }

  @Delete(':id')
  @HttpCode(204)
  removeOwn(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.removeOwn(req.userId!, id);
  }

  /** O autor da tcheka original retira um dueto feito com ela (o dueto fica escondido para todos e o dono é avisado). */
  @Post(':id/duet-takedown')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async takeDownDuet(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    await this.posts.takeDownDuet(req.userId!, id);
  }

  @Delete(':id/tags/me')
  untagMe(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.untagMe(req.userId!, id);
  }

  @Post(':id/cheers')
  @HttpCode(200)
  cheer(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.toggleCheer(req.userId!, id);
  }

  /** Repostar (sozinho ou com comentário). */
  @NeedsVerifiedEmail()
  @Post(':id/repost')
  @HttpCode(201)
  repost(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(repostSchema)) b: z.infer<typeof repostSchema>) {
    return this.posts.repost(req.userId!, id, b.body);
  }

  @Delete(':id/repost')
  unrepost(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.unrepost(req.userId!, id);
  }

  @NeedsVerifiedEmail()
  @Post(':id/gifts')
  @HttpCode(201)
  gift(
    @Req() req: AuthedReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(giftSchema)) b: z.infer<typeof giftSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.posts.gift(req.userId!, id, b.amount, requireIdempotencyKey(key), b.note, b.visibility);
  }

  /** Uma publicação pelo código curto do link (txillapp.com/p/Ab3xK9q). */
  @Get('code/:code')
  byCode(@Req() req: AuthedReq, @Param('code') code: string) {
    return this.posts.getByCode(req.userId!, code);
  }

  /** Uma publicação (para abrir a partir de notificações e ligações). Última rota: não esconde as outras. */
  @Get(':id')
  one(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.getOne(req.userId!, id);
  }
}
