import {
  BadRequestException, ConflictException, ForbiddenException, GoneException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException,
  OnModuleInit, ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { badge } from '../common/badge';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { ModerationService, type ReportReason } from '../moderation/moderation.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import { Scheduler } from '../realtime/scheduler';
import { TextFilter } from '../safety/text-filter.service';
import { RATE_STORE, type RateStore } from '../security/rate-store';
import { allowedBy, blockedBetween, notReportedBy, sameCountry } from '../social/visibility';
import type { TxilladaEvent, TxilladaReaction } from '../chat/chat.events';
import { LIVEKIT_ROOMS, TrackType, livekitEnabled, roomToken, webhookReceiver, type LiveKitRooms, type WebhookEvent } from './livekit';
import type { TxilladaHooks } from './txillada-tokens';
import { txilladaBanned, txilladaTicket, txilladaVisible } from './txillada-visibility';
import { ISSUANCE_ACCOUNT, WalletService } from '../wallet/wallet.service';

/**
 * A Txillada (os lives), fase 1 — docs/txillada-contrato.md. O vídeo passa só pelo LiveKit (nada se grava); aqui ficam os
 * acessos (tokens LiveKit), o estado, os comentários, os brindes, as expulsões e a moderação, e os eventos em tempo real
 * pelo canal da app (RealtimeBus.publish → o SSE do chat).
 *
 * Quem está a ver (para lhe mandar os eventos): um conjunto no RealtimeBus (`tx:to:<id>`, Redis com REDIS_URL) com quem fez
 * `join` ou entrou na sala (webhook), e de onde sai quem saiu da sala (webhook participant_left). Quantos estão na sala
 * (`viewers`): outro conjunto (`tx:in:<id>`), só com o que o webhook diz.
 */
export type TxAudience = 'everyone' | 'followers' | 'close' | 'friends' | 'paid';
/** Os três tipos (0167): Pública ('everyone' e o antigo 'followers'), Para amigos ('friends' e 'close') e Privada paga ('paid'). */
export type TxKind = 'public' | 'friends' | 'paid';
export const txKind = (a: string): TxKind => (a === 'paid' ? 'paid' : a === 'friends' || a === 'close' ? 'friends' : 'public');

/** A entrada de uma Txillada paga (0167), em Txills inteiros. */
export const PRICE_MIN = 5;
export const PRICE_MAX = 5000;
/** A meta da Angariação (0167) e o motivo. */
export const GOAL_MIN = 10;
export const GOAL_MAX = 1_000_000;
export const PURPOSE_MAX = 80;
/** Uma oferta de Txills durante o live (0167): de 1 a 5000; no máximo 5 ofertas a cada 10 s por pessoa. */
export const GIFT_MAX = 5000;
const GIFTS_PER_10S = 5;
/** Quantos aparecem em «quem mais ofereceu». */
export const TOP_GIVERS = 3;
const TICKET_REQUIRED = 'Esta Txillada é privada: paga a entrada para entrar.';
export type TxStatus = 'live' | 'ended' | 'cut';

/** Uma Txillada dura no máximo isto (limite de segurança; a tarefa acaba as mais antigas). */
export const MAX_LIVE_MS = 4 * 3_600_000;
/** Sem vídeo do anfitrião há tanto tempo, acaba. */
export const NO_VIDEO_MS = 60_000;
/** Comentários e brindes de uma Txillada acabada apagam-se ao fim destes dias (menos com denúncia por decidir). */
export const TX_KEEP_DAYS = 7;
const SET_MS = MAX_LIVE_MS + 3_600_000;
const toKey = (id: string) => `tx:to:${id}`;
const inKey = (id: string) => `tx:in:${id}`;
const UNAVAILABLE = 'A Txillada ainda não está disponível.';

const avatarUrl = (username: string, has: unknown) => (has ? `/api/v1/avatars/${encodeURIComponent(username)}` : null);
const person = (r: Record<string, any>, p = '') => ({
  id: r[`${p}id`] as string,
  username: r[`${p}username`] as string,
  displayName: r[`${p}display_name`] as string,
  avatarUrl: avatarUrl(r[`${p}username`], r[`${p}has_avatar`]),
  ...badge(r[`${p}verified`], r[`${p}verified_tier`]),
});
/** Como `person`, sem o id interno (o que se mostra de quem está a ver e de quem entrou). */
const publicPerson = (r: Record<string, any>, p = '') => ({
  username: r[`${p}username`] as string,
  displayName: r[`${p}display_name`] as string,
  avatarUrl: avatarUrl(r[`${p}username`], r[`${p}has_avatar`]),
  ...badge(r[`${p}verified`], r[`${p}verified_tier`]),
});
/** Reações: no máximo 8 por segundo por pessoa; acima de 40 por segundo na sala, já não se difundem. */
const REACT_PER_SEC = 8;
const REACT_ROOM_PER_SEC = 40;
/** Brindes (à Txillada e aos comentários, cada um com a sua conta): no máximo 5 por segundo por pessoa. */
const CHEERS_PER_SEC = 5;
/** O «olá» de quem vê: 1 a cada 4 s por pessoa. */
const HELLO_MS = 4_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Convidados (0165): no máximo 3 a transmitir ao mesmo tempo com o anfitrião (4 pessoas no ecrã). */
export const GUESTS_MAX = 3;
/** Pedir para entrar outra vez (depois de recusado ou de desistir): 1 pedido a cada 20 s por pessoa e Txillada. */
const REQUEST_GAP_MS = 20_000;
/** Convites do anfitrião: no máximo 20 por minuto. */
const INVITES_PER_MIN = 20;
const GUESTS_FULL = `Já há ${GUESTS_MAX} convidados a transmitir. Tira um para entrar outro.`;
/** O meu lugar numa Txillada (0165): só a ver, pedi para entrar, fui convidado, ou estou a transmitir. */
export type GuestState = 'none' | 'requested' | 'invited' | 'guest';
type GuestReason = 'left' | 'removed';
/** As colunas de uma pessoa (`gu` = identity.users) em JSON, para o `person()`. */
const GUEST_JSON = `'id', gu.id, 'username', gu.username, 'display_name', gu.display_name, 'has_avatar', gu.avatar_media_id IS NOT NULL,
                    'verified', gu.verified, 'verified_tier', gu.verified_tier`;
/**
 * Os convidados a transmitir agora em `t` (0165), por ordem de entrada, como o espectador `v` os vê: só contas ativas e sem
 * bloqueio com ele (quem tem um bloqueio com um convidado não o vê no ecrã; a app não recebe as faixas dele). `v` null: todos.
 */
const guestsSql = (t = 't', v: string | null = '$1') =>
  `(SELECT COALESCE(json_agg(json_build_object(${GUEST_JSON}, 'since', g.since) ORDER BY g.since, gu.id), '[]'::json)
      FROM content.txillada_guests g JOIN identity.users gu ON gu.id = g.user_id AND gu.status = 'active'
     WHERE g.txillada_id = ${t}.id AND g.status = 'accepted'${v ? ` AND NOT ${blockedBetween('gu.id', v)}` : ''})`;
/** Os pedidos (`request`) ou os convites (`invite`) à espera em `t`, só para o anfitrião `v` (os outros: null). */
const pendingSql = (t: string, v: string, kind: 'request' | 'invite') =>
  `CASE WHEN ${t}.host_id = ${v} THEN (SELECT COALESCE(json_agg(json_build_object(${GUEST_JSON}, 'at', g.updated_at) ORDER BY g.updated_at, gu.id), '[]'::json)
      FROM content.txillada_guests g JOIN identity.users gu ON gu.id = g.user_id AND gu.status = 'active'
     WHERE g.txillada_id = ${t}.id AND g.status = 'pending' AND g.kind = '${kind}' AND NOT ${blockedBetween('gu.id', v)}) END`;
/** O meu lugar (GuestState) em `t`. */
const myGuestSql = (t = 't', v = '$1') =>
  `(SELECT CASE WHEN g.status = 'accepted' THEN 'guest' WHEN g.kind = 'request' THEN 'requested' ELSE 'invited' END
      FROM content.txillada_guests g WHERE g.txillada_id = ${t}.id AND g.user_id = ${v} AND g.status IN ('pending', 'accepted'))`;
const iso = (v: unknown) => new Date(v as string).toISOString();
/** Um convidado a transmitir (0165): a pessoa (com o id, que é o identity no LiveKit) e desde quando. */
type GuestDto = { user: ReturnType<typeof person>; since: string };

/** As colunas do anfitrião (`h`) com o prefixo h_. */
const HOST_COLS = `h.id AS h_id, h.username AS h_username, h.display_name AS h_display_name, (h.avatar_media_id IS NOT NULL) AS h_has_avatar,
                   h.verified AS h_verified, h.verified_tier AS h_verified_tier`;
const TX_COLS = `t.id, t.host_id, t.title, t.audience, t.status, t.room, t.started_at, t.ended_at, t.viewers, t.peak_viewers, t.cheers, t.comments, t.pinned_comment_id,
                 t.price, t.goal, t.goal_purpose, t.raised, t.tickets`;
/** As colunas de um comentário com o autor (`c` = txillada_comments, `a` = identity.users) para o commentDto. */
const COMMENT_COLS = `c.id, c.body, c.created_at, a.id AS a_id, a.username AS a_username, a.display_name AS a_display_name,
                      (a.avatar_media_id IS NOT NULL) AS a_has_avatar, a.verified AS a_verified, a.verified_tier AS a_verified_tier`;
/**
 * O comentário fixado de `t` como o espectador `v` o vê (0162), em JSON com as colunas do commentDto, ou null: apagado,
 * de uma conta que já não está ativa, com um bloqueio entre o autor e o espectador, ou denunciado por ele não se mostra.
 */
const pinnedSql = (t = 't', v = '$1') =>
  `(SELECT json_build_object('id', pc.id, 'body', pc.body, 'created_at', pc.created_at, 'a_id', pa.id, 'a_username', pa.username,
            'a_display_name', pa.display_name, 'a_has_avatar', pa.avatar_media_id IS NOT NULL, 'a_verified', pa.verified,
            'a_verified_tier', pa.verified_tier,
            'cheers', (SELECT count(*) FROM content.txillada_comment_cheers px WHERE px.comment_id = pc.id),
            'cheered', EXISTS (SELECT 1 FROM content.txillada_comment_cheers px WHERE px.comment_id = pc.id AND px.user_id = ${v}))
      FROM content.txillada_comments pc JOIN identity.users pa ON pa.id = pc.author_id AND pa.status = 'active'
     WHERE pc.id = ${t}.pinned_comment_id AND pc.removed_at IS NULL AND NOT ${blockedBetween('pa.id', v)}
       AND ${notReportedBy('txillada_comment', 'pc.id', v)})`;

/** As colunas de quem ofereceu (`gu` = identity.users) para o publicPerson. */
const GIVER_COLS = `gu.id, gu.username, gu.display_name, (gu.avatar_media_id IS NOT NULL) AS has_avatar, gu.verified, gu.verified_tier`;
/**
 * Quem mais ofereceu em `t` (0167), como o espectador `v` o vê: só contas ativas e sem bloqueio com ele; o maior total
 * primeiro (empate: quem ofereceu primeiro). No máximo `n`. `v` null: todos (com o id, para filtrar a cada pessoa).
 */
const topGiversSql = (t = 't', v: string | null = '$1', n = TOP_GIVERS) =>
  `(SELECT COALESCE(json_agg(x ORDER BY x.total DESC, x.first_at, x.id), '[]'::json) FROM (
      SELECT ${GIVER_COLS}, sum(gg.amount)::int AS total, min(gg.created_at) AS first_at
        FROM content.txillada_gifts gg JOIN identity.users gu ON gu.id = gg.giver_id AND gu.status = 'active'
       WHERE gg.txillada_id = ${t}.id${v ? ` AND NOT ${blockedBetween('gu.id', v)}` : ''}
       GROUP BY gu.id ORDER BY total DESC, first_at, gu.id LIMIT ${n}) x)`;
/** Um de «quem mais ofereceu» (sem o id interno; com o selo, como em todo o lado). */
export type Giver = { username: string; displayName: string; avatarUrl: string | null; verified: boolean; verifiedTier: string | null; total: number };
const giverDto = (g: Record<string, any>): Giver => ({ ...publicPerson(g), total: Number(g.total) });

@Injectable()
export class TxilladaService implements OnModuleInit, TxilladaHooks {
  private readonly log = new Logger('Txillada');
  private readonly receive: ReturnType<typeof webhookReceiver>;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(LIVEKIT_ROOMS) private readonly rooms: LiveKitRooms | null,
    @Inject(RATE_STORE) private readonly rates: RateStore,
    private readonly bus: RealtimeBus,
    private readonly scheduler: Scheduler,
    private readonly filter: TextFilter,
    private readonly notifications: NotificationsService,
    private readonly moderation: ModerationService,
    private readonly wallet: WalletService,
  ) {
    this.receive = webhookReceiver(config);
  }

  /** De 20 em 20 s acaba as que ficaram sem vídeo (ou passaram das 4 h); de hora a hora apaga o que já não se guarda. */
  onModuleInit() {
    this.scheduler.every('txillada.sweep', 20_000, () => this.sweep());
    this.scheduler.every('txillada.purge', 3_600_000, () => this.purge(), { firstAfterMs: 60_000 });
  }

  get enabled() {
    return livekitEnabled(this.config);
  }

  private assertEnabled() {
    if (!this.enabled) throw new ServiceUnavailableException(UNAVAILABLE);
  }

  /* ───────────── leitura ───────────── */

  /**
   * A Txillada como `me` a vê. Numa paga (0167) sem a entrada (`locked`), só o anfitrião, o título, o preço e o estado:
   * os números, o fixado, os convidados e a Angariação ficam a zero/vazios até pagar.
   */
  private dto(r: Record<string, any>, me: string) {
    const isHost = r.host_id === me;
    const kind = txKind(r.audience);
    const hasTicket = isHost || r.has_ticket !== false;
    const locked = kind === 'paid' && !hasTicket;
    const goal = r.goal == null ? null : Number(r.goal);
    return {
      id: r.id as string,
      host: person(r, 'h_'),
      title: r.title as string,
      audience: r.audience as TxAudience,
      /** Pública, Para amigos ou Privada (paga), 0167. */
      kind,
      /** Para amigos com «Só amigos próximos» (o antigo 'close'). */
      closeOnly: r.audience === 'close',
      /** O preço da entrada (só nas pagas). */
      price: kind === 'paid' ? Number(r.price) : null,
      /** Posso entrar (anfitrião, entrada paga, convidado; nas outras, sempre). */
      hasTicket,
      /** Paga e sem entrada: só se vê o cartão com o cadeado e o preço. */
      locked,
      /** Nas pagas, quem está a ver não aparece aos outros (só ao anfitrião). */
      viewersHidden: kind === 'paid' && !isHost,
      status: r.status as TxStatus,
      startedAt: r.started_at as string,
      endedAt: (r.ended_at as string | null) ?? null,
      viewers: locked ? 0 : (r.viewers as number),
      peakViewers: locked ? 0 : (r.peak_viewers as number),
      cheers: locked ? 0 : (r.cheers as number),
      comments: locked ? 0 : (r.comments as number),
      /** A Angariação (0167): a meta (null sem Angariação), o motivo, quanto já se ofereceu e quem mais ofereceu (top 3). */
      goal: locked ? null : goal,
      goalPurpose: locked || goal == null ? '' : ((r.goal_purpose as string | null) ?? ''),
      raised: locked ? 0 : Number(r.raised ?? 0),
      topGivers: locked ? [] : ((r.top_givers as Record<string, any>[] | null) ?? []).map(giverDto),
      /** Só o anfitrião: quantas entradas se pagaram. */
      ...(isHost && kind === 'paid' ? { tickets: Number(r.tickets ?? 0) } : {}),
      isHost,
      canComment: !locked && r.status === 'live' && (isHost || (!!r.comment_ok && !r.banned)),
      /** O comentário fixado pelo anfitrião (0162), como eu o vejo; null sem nenhum (ou se não o posso ver). */
      pinned: r.pinned && !locked ? this.commentDto(r.pinned) : null,
      /** Quem está a transmitir com o anfitrião (0165), por ordem de entrada, como eu os vejo. */
      guests: locked ? [] : this.guestList(r.guests),
      guestsMax: GUESTS_MAX,
      /** O meu lugar: só a ver, pedi para entrar, fui convidado, ou estou a transmitir. */
      guestState: (isHost ? 'none' : (r.my_guest ?? 'none')) as GuestState,
      // Os pedidos e os convites à espera: só o anfitrião os vê.
      ...(isHost ? { requests: this.pendingList(r.requests), invites: this.pendingList(r.invites) } : {}),
    };
  }

  private guestList(v: unknown): GuestDto[] {
    return ((v as Record<string, any>[] | null) ?? []).map((g) => ({ user: person(g), since: iso(g.since) }));
  }

  private pendingList(v: unknown) {
    return ((v as Record<string, any>[] | null) ?? []).map((g) => ({ user: person(g), at: iso(g.at) }));
  }

  /**
   * A Txillada como `me` a vê: 404 se não a pode ver, 403 se foi expulso e, numa paga sem a entrada (0167), 402 com o
   * preço (`ticket: false`: o cartão com o cadeado, o pagar e o denunciar, que não precisam dela).
   */
  private async access(me: string, id: string, opts: { ticket?: boolean } = {}) {
    const { rows } = await this.pool.query(
      `SELECT ${TX_COLS}, ${HOST_COLS}, ${txilladaVisible('t', 'h', '$1')} AS visible, ${txilladaBanned('t', '$1')} AS banned,
              ${txilladaTicket('t', '$1')} AS has_ticket, ${topGiversSql('t', '$1')} AS top_givers,
              ${allowedBy('h', 'comments_allowed', '$1')} AS comment_ok, ${pinnedSql('t', '$1')} AS pinned,
              ${guestsSql('t', '$1')} AS guests, ${myGuestSql('t', '$1')} AS my_guest,
              ${pendingSql('t', '$1', 'request')} AS requests, ${pendingSql('t', '$1', 'invite')} AS invites
         FROM content.txilladas t JOIN identity.users h ON h.id = t.host_id WHERE t.id = $2`,
      [me, id],
    );
    const r = rows[0];
    if (!r || !r.visible) throw new NotFoundException('Txillada não encontrada');
    if (r.banned && r.host_id !== me) throw new ForbiddenException('O anfitrião tirou-te desta Txillada.');
    if (opts.ticket !== false && !r.has_ticket) {
      throw new HttpException({ message: TICKET_REQUIRED, code: 'ticket_required', price: Number(r.price) }, HttpStatus.PAYMENT_REQUIRED);
    }
    return r;
  }

  publicConfig() {
    return { enabled: this.enabled };
  }

  async get(me: string, id: string) {
    return this.dto(await this.access(me, id, { ticket: false }), me);
  }

  /** As que estão a decorrer e posso ver: de quem sigo primeiro, depois as mais vistas do meu país (máx. 30). */
  async live(me: string) {
    const { rows } = await this.pool.query(
      `SELECT ${TX_COLS}, ${HOST_COLS}, false AS banned, ${allowedBy('h', 'comments_allowed', '$1')} AS comment_ok, ${pinnedSql('t', '$1')} AS pinned,
              ${guestsSql('t', '$1')} AS guests, ${myGuestSql('t', '$1')} AS my_guest,
              ${txilladaTicket('t', '$1')} AS has_ticket, ${topGiversSql('t', '$1')} AS top_givers,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = t.host_id) AS followed
         FROM content.txilladas t JOIN identity.users h ON h.id = t.host_id
        WHERE t.status = 'live' AND t.host_id <> $1 AND ${txilladaVisible('t', 'h', '$1')} AND NOT ${txilladaBanned('t', '$1')}
          AND ${notReportedBy('txillada', 't.id')}
          AND (EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = t.host_id) OR ${sameCountry('h.country')})
        ORDER BY followed DESC, t.viewers DESC, t.started_at DESC
        LIMIT 30`,
      [me],
    );
    return { items: rows.map((r) => this.dto(r, me)) };
  }

  /* ───────────── abrir, entrar e terminar ───────────── */

  /**
   * Abrir uma Txillada. `price`: a entrada de uma paga (obrigatória com 'paid', ignorada nas outras). `goal`/`purpose`: a
   * Angariação (opcional em qualquer tipo; o motivo passa pelo filtro de palavras, como o título). O tipo fica fixo.
   */
  async create(me: string, title: string, audience: TxAudience, opts: { price?: number | null; goal?: number | null; purpose?: string } = {}) {
    this.assertEnabled();
    const price = audience === 'paid' ? (opts.price ?? null) : null;
    if (audience === 'paid' && (price == null || !Number.isInteger(price) || price < PRICE_MIN || price > PRICE_MAX)) {
      throw new BadRequestException(`Numa Txillada privada, a entrada vai de ${PRICE_MIN} a ${PRICE_MAX} Txills.`);
    }
    const goal = opts.goal ?? null;
    if (goal != null && (!Number.isInteger(goal) || goal < GOAL_MIN || goal > GOAL_MAX)) {
      throw new BadRequestException(`A meta da angariação vai de ${GOAL_MIN} a ${GOAL_MAX} Txills.`);
    }
    const purpose = goal == null ? '' : (opts.purpose ?? '').replace(/\s+/g, ' ').trim().slice(0, PURPOSE_MAX);
    const u = (
      await this.pool.query(
        `SELECT status, username, display_name, birth_date IS NOT NULL AS has_birth,
                COALESCE(birth_date <= (current_date - interval '18 years'), false) AS adult
           FROM identity.users WHERE id = $1`,
        [me],
      )
    ).rows[0];
    if (!u || u.status !== 'active') throw new ForbiddenException('A tua conta não pode abrir uma Txillada.');
    if (!u.has_birth) throw new ForbiddenException('A Txillada é só para maiores de 18 anos e a tua conta não tem a data de nascimento. Escreve para suporte@txillapp.com para a acrescentares.');
    if (!u.adult) throw new ForbiddenException('A Txillada é só para maiores de 18 anos.');
    this.filter.assertClean(title);
    if (purpose) this.filter.assertClean(purpose);
    const running = (await this.pool.query(`SELECT id FROM content.txilladas WHERE host_id = $1 AND status = 'live'`, [me])).rows[0];
    if (running) throw new ConflictException({ message: 'Já tens uma Txillada a decorrer.', id: running.id });
    const id = uuidv7();
    try {
      await this.pool.query(
        `INSERT INTO content.txilladas (id, host_id, title, audience, room, video_at, price, goal, goal_purpose) VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8)`,
        [id, me, title, audience, `tx-${id}`, price, goal, purpose],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException({ message: 'Já tens uma Txillada a decorrer.' });
      throw e;
    }
    const token = await roomToken(this.config, { room: `tx-${id}`, identity: me, name: u.display_name, username: u.username, host: true });
    void this.announce(me, id, title).catch((e) => this.log.warn(`não consegui avisar os seguidores da Txillada ${id}: ${(e as Error).message}`));
    return { txillada: await this.get(me, id), token, url: this.config.LIVEKIT_URL! };
  }

  /** Avisa os seguidores (lista e telemóvel), no máximo uma vez por anfitrião por hora. */
  private async announce(me: string, id: string, title: string) {
    const ok = await this.pool.query(
      `UPDATE content.txilladas t SET notified = true
        WHERE t.id = $1 AND NOT EXISTS (
          SELECT 1 FROM content.txilladas p WHERE p.host_id = t.host_id AND p.id <> t.id AND p.notified AND p.started_at > now() - interval '1 hour')`,
      [id],
    );
    if (ok.rowCount) await this.notifications.notifyTxilladaLive(me, id, title);
  }

  async join(me: string, id: string) {
    this.assertEnabled();
    const r = await this.access(me, id);
    if (r.status !== 'live') throw new GoneException('A Txillada já acabou.');
    const isHost = r.host_id === me;
    const u = (
      await this.pool.query(
        'SELECT id, username, display_name, (avatar_media_id IS NOT NULL) AS has_avatar, verified, verified_tier FROM identity.users WHERE id = $1',
        [me],
      )
    ).rows[0];
    // O nome e o @ só no token do anfitrião: o de quem vê chega a todos na sala (também a quem tem bloqueio com essa pessoa).
    // Um convidado aceite (0165) que volta a entrar já pode publicar.
    // Numa paga (0167), quem vê entra escondido (os outros na sala não o veem; o anfitrião vê-o na lista da API).
    const paid = r.audience === 'paid';
    const token = await roomToken(this.config, isHost
      ? { room: r.room, identity: me, name: u.display_name, username: u.username, host: true }
      : { room: r.room, identity: me, host: false, publish: r.my_guest === 'guest', hidden: paid && r.my_guest !== 'guest' });
    if (!isHost) {
      await this.bus.touch(toKey(id), me, SET_MS);
      // «@fulano entrou»: daqui (o webhook pode não estar ligado), uma vez por pessoa a cada 60 s (as religações não repetem).
      if (await this.bus.claimOnce(`tx:joined:${id}:${me}`, 60_000)) {
        const user = publicPerson(u);
        // Numa paga, só o anfitrião sabe quem entrou.
        const to = paid
          ? (await this.withoutBlocks(me, [r.host_id as string]))
          : (await this.withoutBlocks(me, await this.audience(id, r.host_id))).filter((x) => x !== me);
        this.emit(to, { type: 'txillada.joined', txilladaId: id, user });
      }
    }
    return { token, url: this.config.LIVEKIT_URL! };
  }

  async end(me: string, id: string) {
    const r = await this.access(me, id);
    if (r.host_id !== me) throw new ForbiddenException('Só o anfitrião pode terminar a Txillada.');
    await this.finish(id, 'ended');
    return this.get(me, id);
  }

  /** Acaba uma Txillada que está a decorrer (o anfitrião, o webhook, a tarefa ou a moderação). Devolve true se acabou agora. */
  private async finish(id: string, status: 'ended' | 'cut', reason: string | null = null, by: string | null = null) {
    const { rows } = await this.pool.query(
      `UPDATE content.txilladas SET status = $2, ended_at = now(), viewers = 0, video_on = false, cut_reason = $3, cut_by = $4
        WHERE id = $1 AND status = 'live' RETURNING id, room, host_id, status`,
      [id, status, reason, by],
    );
    if (!rows[0]) return false;
    await this.afterEnd(rows[0]);
    return true;
  }

  /** Todos os que estavam a ver (e o anfitrião) recebem `txillada.ended`; a sala no LiveKit fecha. */
  private async afterEnd(r: { id: string; room: string; host_id: string; status: 'ended' | 'cut' }) {
    // Acaba para todos: os convidados deixam de transmitir e os pedidos e convites à espera caem (0165).
    await this.pool.query(
      `UPDATE content.txillada_guests SET status = CASE WHEN status = 'accepted' THEN 'left' ELSE 'cancelled' END, updated_at = now()
        WHERE txillada_id = $1 AND status IN ('pending', 'accepted')`,
      [r.id],
    );
    const to = await this.audience(r.id, r.host_id);
    this.emit(to, { type: 'txillada.ended', txilladaId: r.id, status: r.status });
    for (const k of [toKey(r.id), inKey(r.id)]) for (const m of await this.bus.recent(k, SET_MS)) await this.bus.untouch(k, m);
    if (this.rooms) await this.rooms.deleteRoom(r.room).catch((e) => this.log.warn(`não consegui fechar a sala ${r.room}: ${(e as Error).message}`));
    // Cortada pela moderação (0167): as entradas pagas voltam a quem pagou (a tarefa volta a tentar as que falharem).
    if (r.status === 'cut') await this.refundTickets(r.id).catch((e) => this.log.warn(`não consegui devolver as entradas da Txillada ${r.id}: ${(e as Error).message}`));
  }

  /** Gancho da moderação (TXILLADA_HOOKS): a linha já está 'cut'. */
  async afterCut(id: string) {
    const r = (await this.pool.query(`SELECT id, room, host_id, status FROM content.txilladas WHERE id = $1 AND status = 'cut'`, [id])).rows[0];
    if (r) await this.afterEnd(r);
  }

  /* ───────────── tempo real ───────────── */

  /** Quem recebe os eventos: quem está a ver (menos quem tem um bloqueio com o anfitrião) e o anfitrião. */
  private async audience(id: string, hostId: string) {
    const viewers = (await this.bus.recent(toKey(id), SET_MS)).filter((v) => v !== hostId);
    return [hostId, ...(await this.withoutBlocks(hostId, viewers))];
  }

  /**
   * Gancho do SocialService.block: um bloqueio entre `a` e `b`. Quem estava a ver a Txillada do outro sai da sala no
   * LiveKit e deixa de receber os eventos (se voltar a entrar com o token antigo, o webhook tira-o outra vez).
   */
  async afterBlock(a: string, b: string) {
    const { rows } = await this.pool.query(`SELECT id, room, host_id, status FROM content.txilladas WHERE status = 'live' AND host_id = ANY($1::uuid[])`, [[a, b]]);
    for (const t of rows) {
      const other = t.host_id === a ? b : a;
      // Um convidado (ou um pedido, ou um convite) com o anfitrião deixa de o ser (0165).
      await this.dropGuest(t, other, 'removed');
      for (const k of [toKey(t.id), inKey(t.id)]) await this.bus.untouch(k, other);
      if (this.rooms) await this.rooms.removeParticipant(t.room, other).catch(() => undefined);
      await this.recount(t.id, t.host_id);
    }
  }

  private emit(to: string[], e: TxilladaEvent) {
    for (const u of to) this.bus.publish(u, e);
  }

  /** Dos `to`, tira quem tem um bloqueio com `author` (não recebe os comentários dele, como na lista). */
  private async withoutBlocks(author: string, to: string[]) {
    if (!to.length) return to;
    const { rows } = await this.pool.query(
      `SELECT CASE WHEN blocker_id = $1 THEN blocked_id ELSE blocker_id END AS id FROM social.blocks
        WHERE (blocker_id = $1 AND blocked_id = ANY($2::uuid[])) OR (blocked_id = $1 AND blocker_id = ANY($2::uuid[]))`,
      [author, to],
    );
    const out = new Set(rows.map((r) => r.id as string));
    return to.filter((u) => !out.has(u));
  }

  /** Quantos estão na sala (sem o anfitrião e sem os convidados, que contam à parte), pelo que o webhook disse; avisa se mudou. */
  private async recount(id: string, hostId: string) {
    const guests = new Set(
      (await this.pool.query(`SELECT user_id FROM content.txillada_guests WHERE txillada_id = $1 AND status = 'accepted'`, [id])).rows.map((x) => x.user_id as string),
    );
    const n = (await this.bus.recent(inKey(id), SET_MS)).filter((u) => u !== hostId && !guests.has(u)).length;
    const r = await this.pool.query(
      `UPDATE content.txilladas SET viewers = $2, peak_viewers = GREATEST(peak_viewers, $2)
        WHERE id = $1 AND status = 'live' AND viewers IS DISTINCT FROM $2 RETURNING viewers`,
      [id, n],
    );
    if (r.rowCount) this.emit(await this.audience(id, hostId), { type: 'txillada.viewers', txilladaId: id, viewers: n });
  }

  /* ───────────── comentários e brindes ───────────── */

  /** `cheers`: quantos brindaram o comentário; `cheered`: se eu brindei (um comentário novo vai com 0 e false para todos). */
  private commentDto(r: Record<string, any>) {
    return {
      id: r.id as string, author: person(r, 'a_'), body: r.body as string, createdAt: new Date(r.created_at as string).toISOString(),
      cheers: Number(r.cheers ?? 0), cheered: r.cheered === true,
    };
  }

  async comments(me: string, id: string, after?: string) {
    await this.access(me, id);
    const { rows } = await this.pool.query(
      `SELECT c.id, c.body, c.created_at, a.id AS a_id, a.username AS a_username, a.display_name AS a_display_name,
              (a.avatar_media_id IS NOT NULL) AS a_has_avatar, a.verified AS a_verified, a.verified_tier AS a_verified_tier,
              (SELECT count(*) FROM content.txillada_comment_cheers x WHERE x.comment_id = c.id)::int AS cheers,
              EXISTS (SELECT 1 FROM content.txillada_comment_cheers x WHERE x.comment_id = c.id AND x.user_id = $3) AS cheered
         FROM content.txillada_comments c JOIN identity.users a ON a.id = c.author_id AND a.status = 'active'
        WHERE c.txillada_id = $1 AND c.removed_at IS NULL AND ($2::uuid IS NULL OR c.id > $2) AND NOT ${blockedBetween('a.id', '$3')}
          AND ${notReportedBy('txillada_comment', 'c.id', '$3')}
        ORDER BY c.id DESC LIMIT 50`,
      [id, after ?? null, me],
    );
    return { items: rows.reverse().map((r) => this.commentDto(r)) };
  }

  async comment(me: string, id: string, body: string) {
    const r = await this.access(me, id);
    if (r.status !== 'live') throw new ConflictException('A Txillada já acabou.');
    if (!this.dto(r, me).canComment) throw new ForbiddenException('O anfitrião não deixa comentar.');
    this.filter.assertClean(body);
    if (!(await this.bus.claimOnce(`tx:cmt:${me}`, 2_000))) throw new HttpException('Calma! Espera um bocadinho antes de comentar outra vez.', HttpStatus.TOO_MANY_REQUESTS);
    const cid = uuidv7();
    const row = (
      await this.pool.query(
        `WITH c AS (INSERT INTO content.txillada_comments (id, txillada_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING id, body, created_at)
         SELECT ${COMMENT_COLS} FROM c, identity.users a WHERE a.id = $3`,
        [cid, id, me, body],
      )
    ).rows[0];
    await this.pool.query('UPDATE content.txilladas SET comments = comments + 1 WHERE id = $1', [id]);
    const comment = this.commentDto(row);
    this.emit(await this.withoutBlocks(me, await this.audience(id, r.host_id)), { type: 'txillada.comment', txilladaId: id, comment });
    return comment;
  }

  /** O anfitrião (qualquer comentário) ou o autor (o seu) apaga um comentário. */
  async deleteComment(me: string, id: string, commentId: string) {
    const c = (
      await this.pool.query(
        `SELECT c.author_id, t.host_id FROM content.txillada_comments c JOIN content.txilladas t ON t.id = c.txillada_id
          WHERE c.id = $2 AND c.txillada_id = $1 AND c.removed_at IS NULL`,
        [id, commentId],
      )
    ).rows[0];
    if (!c) throw new NotFoundException('Comentário não encontrado');
    if (c.author_id !== me && c.host_id !== me) throw new ForbiddenException('Só o anfitrião ou quem escreveu pode apagar este comentário.');
    const r = await this.pool.query('UPDATE content.txillada_comments SET removed_at = now() WHERE id = $1 AND removed_at IS NULL', [commentId]);
    if (!r.rowCount) return;
    await this.pool.query('UPDATE content.txilladas SET comments = GREATEST(comments - 1, 0) WHERE id = $1', [id]);
    // Apagar o comentário fixado tira-o (0162).
    const unpinned = await this.pool.query('UPDATE content.txilladas SET pinned_comment_id = NULL WHERE id = $1 AND pinned_comment_id = $2', [id, commentId]);
    const to = await this.audience(id, c.host_id);
    this.emit(to, { type: 'txillada.comment_removed', txilladaId: id, commentId });
    if (unpinned.rowCount) this.emit(to, { type: 'txillada.pinned', txilladaId: id, comment: null });
  }

  /**
   * Gancho da moderação (TXILLADA_HOOKS): um comentário denunciado foi removido (já gravado, e já sem estar fixado). Quem
   * está na sala recebe `txillada.comment_removed` (a app tira-o dos balões e, se era o fixado, da pílula).
   */
  async afterCommentRemoved(commentId: string) {
    const r = (
      await this.pool.query(
        `SELECT t.id, t.host_id FROM content.txillada_comments c JOIN content.txilladas t ON t.id = c.txillada_id WHERE c.id = $1 AND t.status = 'live'`,
        [commentId],
      )
    ).rows[0];
    if (r) this.emit(await this.audience(r.id, r.host_id), { type: 'txillada.comment_removed', txilladaId: r.id, commentId });
  }

  /**
   * Fixar um comentário (ou tirar o fixado, com null): só o anfitrião, só enquanto está a decorrer, e só um comentário desta
   * Txillada que ainda se vê (no máximo um fixado: fixar outro troca). Quem está na sala recebe `txillada.pinned` com o
   * comentário completo (autor e selo), menos quem tem um bloqueio com o autor ou o denunciou, que recebe null (não o vê).
   */
  async pin(me: string, id: string, commentId: string | null) {
    const r = await this.access(me, id);
    if (r.host_id !== me) throw new ForbiddenException('Só o anfitrião pode fixar um comentário.');
    if (r.status !== 'live') throw new ConflictException('A Txillada já acabou.');
    let row: Record<string, any> | null = null;
    if (commentId) {
      row = (
        await this.pool.query(
          `SELECT ${COMMENT_COLS}, (SELECT count(*) FROM content.txillada_comment_cheers x WHERE x.comment_id = c.id)::int AS cheers
             FROM content.txillada_comments c JOIN identity.users a ON a.id = c.author_id AND a.status = 'active'
            WHERE c.id = $2 AND c.txillada_id = $1 AND c.removed_at IS NULL AND NOT ${blockedBetween('a.id', '$3')}`,
          [id, commentId, me],
        )
      ).rows[0] ?? null;
      if (!row) throw new NotFoundException('Comentário não encontrado');
    }
    const upd = await this.pool.query(
      `UPDATE content.txilladas SET pinned_comment_id = $2 WHERE id = $1 AND status = 'live' AND pinned_comment_id IS DISTINCT FROM $2`,
      [id, commentId],
    );
    const comment = row ? this.commentDto(row) : null;
    if (upd.rowCount) {
      const to = await this.audience(id, r.host_id);
      if (!row) this.emit(to, { type: 'txillada.pinned', txilladaId: id, comment: null });
      else {
        const sees = new Set(await this.withoutBlocks(row.a_id as string, to));
        const reporters = new Set(
          (await this.pool.query(
            `SELECT reporter_id FROM social.reports WHERE target_type = 'txillada_comment' AND target_id = $1 AND reporter_id = ANY($2::uuid[])`,
            [commentId, to],
          )).rows.map((x) => x.reporter_id as string),
        );
        for (const u of to) this.bus.publish(u, { type: 'txillada.pinned', txilladaId: id, comment: sees.has(u) && !reporters.has(u) ? comment : null });
      }
    }
    return { pinned: comment };
  }

  /**
   * Denunciar um comentário da Txillada ('txillada_comment', a mesma fila de moderação). Quem denuncia deixa de o ver (na
   * lista e no fixado); o comentário fica guardado até à decisão (a limpeza dos 7 dias salta-o).
   */
  async reportComment(me: string, id: string, commentId: string, reason: ReportReason, note?: string) {
    await this.access(me, id);
    const c = (await this.pool.query('SELECT 1 FROM content.txillada_comments WHERE id = $2 AND txillada_id = $1 AND removed_at IS NULL', [id, commentId])).rows[0];
    if (!c) throw new NotFoundException('Comentário não encontrado');
    await this.moderation.report(me, 'txillada_comment', commentId, reason, note);
  }

  /**
   * Brindar um comentário (outra vez tira), como nos comentários das publicações. Só enquanto está a decorrer, só quem pode
   * ver a Txillada (sem expulsos) e o comentário (sem bloqueio com quem o escreveu); no máximo 5 por segundo por pessoa.
   * Não avisa o autor (é ao vivo): a contagem nova vai a quem está na sala (`txillada.comment_cheer`, sem dizer quem foi),
   * menos a quem tem um bloqueio com o autor do comentário (não o vê).
   */
  async cheerComment(me: string, id: string, commentId: string) {
    const r = await this.access(me, id);
    if (r.status !== 'live') throw new ConflictException('A Txillada já acabou.');
    const c = (
      await this.pool.query(
        `SELECT c.author_id FROM content.txillada_comments c JOIN identity.users a ON a.id = c.author_id AND a.status = 'active'
          WHERE c.id = $2 AND c.txillada_id = $1 AND c.removed_at IS NULL AND NOT ${blockedBetween('a.id', '$3')}`,
        [id, commentId, me],
      )
    ).rows[0];
    if (!c) throw new NotFoundException('Comentário não encontrado');
    if ((await this.rates.hit(`tx:ccheer:${me}`, 1_000)) > CHEERS_PER_SEC) throw new HttpException('Calma! No máximo 5 brindes por segundo.', HttpStatus.TOO_MANY_REQUESTS);
    const del = await this.pool.query('DELETE FROM content.txillada_comment_cheers WHERE comment_id = $1 AND user_id = $2', [commentId, me]);
    if (!del.rowCount) await this.pool.query('INSERT INTO content.txillada_comment_cheers (comment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [commentId, me]);
    const cheers = (await this.pool.query('SELECT count(*)::int AS n FROM content.txillada_comment_cheers WHERE comment_id = $1', [commentId])).rows[0].n as number;
    this.emit(await this.withoutBlocks(c.author_id as string, await this.audience(id, r.host_id)), { type: 'txillada.comment_cheer', txilladaId: id, commentId, cheers });
    return { cheered: !del.rowCount, cheers };
  }

  async cheer(me: string, id: string) {
    const r = await this.access(me, id);
    if (r.status !== 'live') throw new ConflictException('A Txillada já acabou.');
    const cheers = await this.addCheer(me, r);
    return { cheers };
  }

  /**
   * Um brinde (o POST /cheer e a reação 🍻): o anfitrião não brinda a sua, no máximo 5 por segundo, conta em
   * txillada_cheers e txilladas.cheers e (com `broadcast`) manda `txillada.cheer`. `r` é a linha de access(), já 'live'.
   */
  private async addCheer(me: string, r: Record<string, any>, broadcast = true) {
    const id = r.id as string;
    if (r.host_id === me) throw new BadRequestException('Não podes brindar a tua própria Txillada.');
    if ((await this.rates.hit(`tx:cheer:${me}`, 1_000)) > CHEERS_PER_SEC) throw new HttpException('Calma! No máximo 5 brindes por segundo.', HttpStatus.TOO_MANY_REQUESTS);
    await this.pool.query(
      `INSERT INTO content.txillada_cheers (txillada_id, user_id, count, last_at) VALUES ($1, $2, 1, now())
       ON CONFLICT (txillada_id, user_id) DO UPDATE SET count = content.txillada_cheers.count + 1, last_at = now()`,
      [id, me],
    );
    const cheers = (await this.pool.query('UPDATE content.txilladas SET cheers = cheers + 1 WHERE id = $1 RETURNING cheers', [id])).rows[0].cheers as number;
    if (broadcast) {
      const username = (await this.pool.query('SELECT username FROM identity.users WHERE id = $1', [me])).rows[0].username as string;
      this.emit(await this.withoutBlocks(me, await this.audience(id, r.host_id)), { type: 'txillada.cheer', txilladaId: id, cheers, from: { username } });
    }
    return cheers;
  }

  /* ───────────── Txillada paga e Angariação (0167) ───────────── */

  private async balance(userId: string) {
    const r = (await this.pool.query('SELECT balance FROM ledger.accounts WHERE user_id = $1', [userId])).rows[0];
    return r ? Number(r.balance) : 0;
  }

  /** O «Saldo insuficiente» da carteira em palavras para quem paga, com o valor e o saldo (a app aponta para a carteira). */
  private async moneyError(e: unknown, me: string, amount: number, what: 'ticket' | 'gift') {
    if (e instanceof UnprocessableEntityException && /saldo insuficiente/i.test(e.message)) {
      const balance = await this.balance(me);
      return new UnprocessableEntityException({
        message: what === 'ticket'
          ? `Não tens Txills suficientes: a entrada custa ${amount} Txills e tens ${balance}.`
          : `Não tens Txills suficientes para oferecer ${amount} (tens ${balance}).`,
        code: 'insufficient_funds',
        amount,
        balance,
      });
    }
    return e;
  }

  /**
   * Pagar a entrada de uma Txillada paga (uma vez só): quem vê → anfitrião na carteira, com a chave de idempotência da pessoa
   * e da Txillada, na mesma transação que grava a entrada. Pagar outra vez (ou dois pedidos ao mesmo tempo) não cobra outra
   * vez; voltar a entrar depois de sair é grátis. O anfitrião e os convidados para transmitir não pagam (já têm `hasTicket`).
   * Sem saldo: 422 `insufficient_funds` com o preço e o saldo. Devolve `{ hasTicket, charged, balance, txillada }`.
   */
  async pay(me: string, id: string) {
    const r = await this.access(me, id, { ticket: false });
    if (r.audience !== 'paid') throw new BadRequestException('Esta Txillada não é paga.');
    if (r.status !== 'live') throw new ConflictException('A Txillada já acabou.');
    if (r.has_ticket) return { hasTicket: true, charged: false, balance: await this.balance(me), txillada: this.dto(r, me) };
    const price = Number(r.price);
    await this.wallet.ensureWallet(me);
    await this.wallet.ensureWallet(r.host_id as string);
    let charged = false;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Primeiro as carteiras (trancadas pela transferência), depois a linha da Txillada (o UPDATE no fim): sempre por esta
      // ordem, sem deadlocks. Se a cortaram entretanto, o UPDATE não apanha nada e tudo volta atrás.
      const tr = await this.wallet.transfer({
        actorId: me, fromUserId: me, toUserId: r.host_id as string, amount: price, type: 'txillada_ticket',
        idempotencyKey: `txillada_ticket:${id}`, metadata: { txilladaId: id, price },
      }, client);
      const ins = await client.query(
        `INSERT INTO content.txillada_tickets (id, txillada_id, host_id, user_id, price, transaction_id) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [uuidv7(), id, r.host_id, me, price, tr.transactionId],
      );
      const live = await client.query(`UPDATE content.txilladas SET tickets = tickets + $2 WHERE id = $1 AND status = 'live'`, [id, ins.rowCount ? 1 : 0]);
      if (!live.rowCount) throw new ConflictException('A Txillada já acabou.');
      charged = !tr.replayed && !!ins.rowCount;
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      // Dois pedidos ao mesmo tempo (a mesma chave na carteira): o outro pagou; esta entrada já existe.
      const raced = (e as { code?: string }).code === '23505'
        && !!(await this.pool.query('SELECT 1 FROM content.txillada_tickets WHERE txillada_id = $1 AND user_id = $2', [id, me])).rowCount;
      if (!raced) throw await this.moneyError(e, me, price, 'ticket');
    } finally {
      client.release();
    }
    return { hasTicket: true, charged, balance: await this.balance(me), txillada: await this.get(me, id) };
  }

  /**
   * Devolve as entradas de uma Txillada cortada pela moderação (0167), cada uma uma vez só (a chave na carteira é a da
   * entrada). Sai da carteira do anfitrião; se ele já gastou parte, a diferença sai da emissão (quem pagou recebe sempre
   * tudo). Devolve quantas voltaram agora.
   */
  async refundTickets(id: string) {
    const { rows } = await this.pool.query('SELECT id FROM content.txillada_tickets WHERE txillada_id = $1 AND refunded_at IS NULL ORDER BY id', [id]);
    let n = 0;
    for (const k of rows) if (await this.refundTicket(k.id as string)) n++;
    return n;
  }

  private async refundTicket(ticketId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const k = (await client.query(
        'SELECT id, txillada_id, host_id, user_id, price FROM content.txillada_tickets WHERE id = $1 AND refunded_at IS NULL FOR UPDATE',
        [ticketId],
      )).rows[0];
      if (!k) {
        await client.query('COMMIT');
        return false;
      }
      const price = Number(k.price);
      const key = `txillada_refund:${k.id}`;
      let txId = (await client.query('SELECT id FROM ledger.transactions WHERE actor_id = $1 AND idempotency_key = $2', [k.host_id, key])).rows[0]?.id as string | undefined;
      if (!txId) {
        // As duas carteiras trancadas por ordem de id (como nas transferências: sem deadlocks).
        const accs = (await client.query('SELECT id, user_id, balance FROM ledger.accounts WHERE user_id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[k.host_id, k.user_id]])).rows;
        const h = accs.find((a) => a.user_id === k.host_id);
        const v = accs.find((a) => a.user_id === k.user_id);
        if (!v) throw new Error(`carteira de ${k.user_id} em falta`);
        const fromHost = Math.min(Math.max(0, Number(h?.balance ?? 0)), price);
        const legs: [string, number][] = [[v.id as string, price]];
        if (fromHost > 0) legs.push([h.id as string, -fromHost]);
        if (price - fromHost > 0) legs.push([ISSUANCE_ACCOUNT, -(price - fromHost)]);
        txId = await this.wallet.postIn(client, {
          type: 'txillada_refund', actorId: k.host_id as string, key, legs,
          metadata: { txilladaId: k.txillada_id, ticketId: k.id, price, fromHost },
        });
      }
      await client.query('UPDATE content.txillada_tickets SET refunded_at = now(), refund_transaction_id = $2 WHERE id = $1', [k.id, txId]);
      await client.query('COMMIT');
      return true;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Uma oferta como a sala a vê (o selo vai sempre com o nome). */
  private giftDto(g: Record<string, any>, from: ReturnType<typeof publicPerson>) {
    return { id: g.id as string, from, amount: Number(g.amount), createdAt: iso(g.created_at) };
  }

  /**
   * Oferecer Txills durante o live (com ou sem Angariação): quem vê → anfitrião na carteira, com a chave de idempotência da
   * app (`key`: repetir o pedido devolve a mesma oferta sem cobrar outra vez). Quem pode ver (numa paga, com a entrada), não
   * o anfitrião, só a decorrer; no máximo 5 ofertas a cada 10 s. A sala recebe `txillada.gift` (a linha «@x ofereceu N
   * Txills», quanto já se juntou e quem mais ofereceu), menos quem tem um bloqueio com quem ofereceu.
   */
  async gift(me: string, id: string, amount: number, key: string) {
    const r = await this.access(me, id);
    if (r.status !== 'live') throw new ConflictException('A Txillada já acabou.');
    if (r.host_id === me) throw new BadRequestException('Não podes oferecer Txills na tua própria Txillada.');
    if (!Number.isInteger(amount) || amount < 1 || amount > GIFT_MAX) throw new BadRequestException(`Podes oferecer de 1 a ${GIFT_MAX} Txills de cada vez.`);
    const lkey = `txillada_gift:${id}:${key}`;
    const u = (await this.pool.query(
      'SELECT id, username, display_name, (avatar_media_id IS NOT NULL) AS has_avatar, verified, verified_tier FROM identity.users WHERE id = $1',
      [me],
    )).rows[0];
    const from = publicPerson(u);
    const replay = async () => {
      const g = (await this.pool.query(
        `SELECT g.id, g.amount, g.created_at FROM ledger.transactions x JOIN content.txillada_gifts g ON g.transaction_id = x.id
          WHERE x.actor_id = $1 AND x.idempotency_key = $2`,
        [me, lkey],
      )).rows[0];
      if (!g) return null;
      const s = (await this.pool.query(`SELECT t.raised, t.goal, ${topGiversSql('t', '$2')} AS top FROM content.txilladas t WHERE t.id = $1`, [id, me])).rows[0];
      return {
        gift: this.giftDto(g, from), raised: Number(s.raised), goal: s.goal == null ? null : Number(s.goal),
        topGivers: ((s.top as Record<string, any>[] | null) ?? []).map(giverDto), balance: await this.balance(me), replayed: true,
      };
    };
    const again = await replay();
    if (again) return again;
    if ((await this.rates.hit(`tx:gift:${me}`, 10_000)) > GIFTS_PER_10S) {
      throw new HttpException('Calma! Espera um bocadinho antes de ofereceres outra vez.', HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.wallet.ensureWallet(me);
    await this.wallet.ensureWallet(r.host_id as string);
    const gid = uuidv7();
    let row: { created_at: string; raised: string; goal: number | null };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Como no pagamento: as carteiras primeiro, a linha da Txillada no fim (só se ainda está a decorrer).
      const tr = await this.wallet.transfer({
        actorId: me, fromUserId: me, toUserId: r.host_id as string, amount, type: 'txillada_gift', idempotencyKey: lkey,
        metadata: { txilladaId: id, giftId: gid },
      }, client);
      if (tr.replayed) {
        await client.query('ROLLBACK');
        const g = await replay();
        if (g) return g;
        throw new ConflictException('Esta oferta já foi feita.');
      }
      const g = (await client.query(
        `INSERT INTO content.txillada_gifts (id, txillada_id, host_id, giver_id, amount, transaction_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at`,
        [gid, id, r.host_id, me, amount, tr.transactionId],
      )).rows[0];
      const s = (await client.query(`UPDATE content.txilladas SET raised = raised + $2 WHERE id = $1 AND status = 'live' RETURNING raised, goal`, [id, amount])).rows[0];
      if (!s) throw new ConflictException('A Txillada já acabou.');
      await client.query('COMMIT');
      row = { created_at: g.created_at, raised: s.raised, goal: s.goal };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((e as { code?: string }).code === '23505') {
        const g = await replay();
        if (g) return g;
      }
      throw await this.moneyError(e, me, amount, 'gift');
    } finally {
      client.release();
    }
    const gift = this.giftDto({ id: gid, amount, created_at: row.created_at }, from);
    const raised = Number(row.raised);
    const goal = row.goal == null ? null : Number(row.goal);
    const top = await this.sendGift(id, r.host_id as string, me, gift, raised, goal);
    return { gift, raised, goal, topGivers: top, balance: await this.balance(me), replayed: false };
  }

  /**
   * `txillada.gift` à sala (e a quem ofereceu), menos a quem tem um bloqueio com quem ofereceu. «Quem mais ofereceu» vai a
   * cada pessoa sem quem tem um bloqueio com ela (como no DTO). Devolve o top como quem ofereceu o vê.
   */
  private async sendGift(id: string, hostId: string, giver: string, gift: ReturnType<TxilladaService['giftDto']>, raised: number, goal: number | null) {
    const to = [...new Set([giver, ...(await this.withoutBlocks(giver, await this.audience(id, hostId)))])];
    const top = ((await this.pool.query(`SELECT ${topGiversSql('t', null, 12)} AS top FROM content.txilladas t WHERE t.id = $1`, [id])).rows[0]?.top ?? []) as Record<string, any>[];
    const ids = top.map((g) => g.id as string);
    const blocked = new Set<string>();
    if (ids.length) {
      const { rows } = await this.pool.query(
        `SELECT blocker_id, blocked_id FROM social.blocks
          WHERE (blocker_id = ANY($1::uuid[]) AND blocked_id = ANY($2::uuid[])) OR (blocked_id = ANY($1::uuid[]) AND blocker_id = ANY($2::uuid[]))`,
        [ids, to],
      );
      for (const b of rows) { blocked.add(`${b.blocker_id}:${b.blocked_id}`); blocked.add(`${b.blocked_id}:${b.blocker_id}`); }
    }
    const topFor = (u: string) => top.filter((g) => !blocked.has(`${u}:${g.id}`)).slice(0, TOP_GIVERS).map(giverDto);
    for (const u of to) this.bus.publish(u, { type: 'txillada.gift', txilladaId: id, gift, raised, goal, topGivers: topFor(u) });
    return topFor(giver);
  }

  /* ───────────── reações e quem está a ver ───────────── */

  /**
   * Uma reação (👋 🍻 🔥 😂 ❤️) a quem está na sala, sem se guardar nada (o 🍻 conta como um brinde). O anfitrião pode mandar
   * tudo menos 🍻 e só ele usa `to` (um olá a quem entrou). No máximo 8 por segundo por pessoa; o olá de quem vê, 1 a cada
   * 4 s. Com a sala acima de 40 por segundo, não se difunde (`sent: false`), mas o 🍻 conta na mesma.
   */
  async react(me: string, id: string, kind: TxilladaReaction, to?: string) {
    const r = await this.access(me, id);
    if (r.status !== 'live') throw new ConflictException('A Txillada já acabou.');
    const isHost = r.host_id === me;
    if (isHost && kind === 'cheers') throw new BadRequestException('Não podes brindar a tua própria Txillada.');
    if (to !== undefined && !isHost) throw new BadRequestException('Só o anfitrião pode responder a alguém.');
    if (to !== undefined && kind !== 'hello') throw new BadRequestException('Só se responde a alguém com um olá.');
    if ((await this.rates.hit(`tx:react:${me}`, 1_000)) > REACT_PER_SEC) throw new HttpException('Calma! Muitas reações seguidas.', HttpStatus.TOO_MANY_REQUESTS);
    let target: { username: string; verified: boolean; verifiedTier: string | null } | undefined;
    if (to !== undefined) {
      const t = (
        await this.pool.query(
          `SELECT u.id, u.username, u.verified, u.verified_tier FROM identity.users u
            WHERE lower(u.username) = lower($1) AND u.status = 'active' AND NOT ${blockedBetween('u.id', '$2')}`,
          [to.replace(/^@/, ''), me],
        )
      ).rows[0];
      if (!t) throw new NotFoundException('Utilizador não encontrado');
      if (t.id === me) throw new BadRequestException('Não podes responder a ti próprio.');
      target = { username: t.username, ...badge(t.verified, t.verified_tier) };
    }
    if (kind === 'hello' && !isHost && !(await this.bus.claimOnce(`tx:hello:${me}`, HELLO_MS))) {
      throw new HttpException('Calma! Muitas reações seguidas.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const sent = (await this.rates.hit(`tx:react-room:${id}`, 1_000)) <= REACT_ROOM_PER_SEC;
    const cheers = kind === 'cheers' ? await this.addCheer(me, r, sent) : undefined;
    if (sent) {
      const u = (
        await this.pool.query('SELECT username, display_name, (avatar_media_id IS NOT NULL) AS has_avatar, verified, verified_tier FROM identity.users WHERE id = $1', [me])
      ).rows[0];
      this.emit(await this.withoutBlocks(me, await this.audience(id, r.host_id)), {
        type: 'txillada.reaction',
        txilladaId: id,
        kind,
        // O selo de verificado vai sempre com o nome (como nos comentários e no «entrou»).
        from: { ...publicPerson(u), host: isHost },
        ...(target ? { to: target } : {}),
      });
    }
    return cheers === undefined ? { sent } : { sent, cheers };
  }

  /**
   * Quem está a ver agora (quem fez `join` e não saiu): sem o anfitrião, só contas ativas, sem expulsos e sem quem tem um
   * bloqueio com quem pede. Quem eu sigo primeiro, depois pelo @ (máx. 200).
   */
  async viewers(me: string, id: string) {
    const r = await this.access(me, id);
    // Numa paga (0167), a lista é só do anfitrião: os outros recebem-na vazia (`hidden: true`).
    const hidden = r.audience === 'paid' && r.host_id !== me;
    if (hidden) return { items: [], total: 0, hidden };
    const ids = (await this.bus.recent(toKey(id), SET_MS)).filter((v) => v !== r.host_id && UUID_RE.test(v));
    if (!ids.length) return { items: [], total: 0, hidden };
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, u.verified, u.verified_tier,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $2 AND f.followee_id = u.id) AS followed
         FROM identity.users u
        WHERE u.id = ANY($1::uuid[]) AND u.status = 'active' AND NOT ${blockedBetween('u.id', '$2')}
          AND NOT EXISTS (SELECT 1 FROM content.txillada_bans b WHERE b.txillada_id = $3 AND b.user_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM content.txillada_guests g WHERE g.txillada_id = $3 AND g.user_id = u.id AND g.status = 'accepted')
        ORDER BY followed DESC, lower(u.username)
        LIMIT 200`,
      [ids, me, id],
    );
    const items = rows.map((x) => publicPerson(x));
    return { items, total: items.length, hidden };
  }

  /* ───────────── expulsar e denunciar ───────────── */

  async ban(me: string, id: string, username: string) {
    const r = await this.access(me, id);
    if (r.host_id !== me) throw new ForbiddenException('Só o anfitrião pode tirar alguém da Txillada.');
    const t = (await this.pool.query('SELECT id FROM identity.users WHERE lower(username) = lower($1)', [username.replace(/^@/, '')])).rows[0];
    if (!t) throw new NotFoundException('Utilizador não encontrado');
    if (t.id === me) throw new BadRequestException('Não te podes tirar da tua própria Txillada.');
    await this.pool.query('INSERT INTO content.txillada_bans (txillada_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, t.id]);
    // Expulsar também tira de transmitir (e o pedido ou o convite à espera), antes de sair da sala (0165).
    await this.dropGuest(r, t.id, 'removed');
    await this.bus.untouch(toKey(id), t.id);
    if (r.status === 'live' && this.rooms) await this.rooms.removeParticipant(r.room, t.id).catch((e) => this.log.warn(`não consegui tirar ${t.id} da sala ${r.room}: ${(e as Error).message}`));
  }

  async report(me: string, id: string, reason: ReportReason, note?: string) {
    // O cartão de uma paga (o título) também se pode denunciar sem pagar.
    await this.access(me, id, { ticket: false });
    await this.moderation.report(me, 'txillada', id, reason, note);
  }

  /* ───────────── convidados (0165): até 3 a transmitir com o anfitrião ───────────── */

  private async guestRow(id: string, userId: string) {
    return (await this.pool.query('SELECT kind, status FROM content.txillada_guests WHERE txillada_id = $1 AND user_id = $2', [id, userId])).rows[0] as
      | { kind: 'request' | 'invite'; status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'left' | 'removed' }
      | undefined;
  }

  /** Pode transmitir? Conta ativa e 18 anos ou mais (como para abrir uma Txillada). */
  private async canBroadcast(userId: string) {
    const r = (await this.pool.query(
      `SELECT status = 'active' AND COALESCE(birth_date <= (current_date - interval '18 years'), false) AS ok FROM identity.users WHERE id = $1`,
      [userId],
    )).rows[0];
    return !!r?.ok;
  }

  /** Está na sala (fez `join` e não saiu)? */
  private async watching(id: string, userId: string) {
    return (await this.bus.recent(toKey(id), SET_MS)).includes(userId);
  }

  private async personOf(userId: string) {
    const r = (await this.pool.query(
      'SELECT id, username, display_name, (avatar_media_id IS NOT NULL) AS has_avatar, verified, verified_tier FROM identity.users WHERE id = $1',
      [userId],
    )).rows[0];
    return person(r);
  }

  /** O que o anfitrião vê: quem transmite, os pedidos e os convites à espera. */
  private async hostLists(id: string, hostId: string) {
    const r = (await this.pool.query(
      `SELECT ${guestsSql('t', '$2')} AS guests, ${pendingSql('t', '$2', 'request')} AS requests, ${pendingSql('t', '$2', 'invite')} AS invites
         FROM content.txilladas t WHERE t.id = $1`,
      [id, hostId],
    )).rows[0];
    return { guests: this.guestList(r?.guests), requests: this.pendingList(r?.requests), invites: this.pendingList(r?.invites) };
  }

  /** Os pedidos ou os convites mudaram: o anfitrião recebe as listas novas (`txillada.requests`). Devolve-as. */
  private async sendLists(id: string, hostId: string) {
    const l = await this.hostLists(id, hostId);
    this.bus.publish(hostId, { type: 'txillada.requests', txilladaId: id, requests: l.requests, invites: l.invites });
    return l;
  }

  /** A conta pelo @ (ativa e sem bloqueio com o anfitrião), ou 404. */
  private async guestTarget(hostId: string, username: string) {
    const t = (await this.pool.query(
      `SELECT u.id, u.username FROM identity.users u WHERE lower(u.username) = lower($1) AND u.status = 'active' AND NOT ${blockedBetween('u.id', '$2')}`,
      [username.replace(/^@/, ''), hostId],
    )).rows[0] as { id: string; username: string } | undefined;
    if (!t) throw new NotFoundException('Utilizador não encontrado');
    if (t.id === hostId) throw new BadRequestException('Já estás a transmitir: és o anfitrião.');
    return t;
  }

  /** A Txillada como o anfitrião a vê, a decorrer (403 a quem não é o anfitrião, 409 acabada). */
  private async hostLive(me: string, id: string) {
    this.assertEnabled();
    const r = await this.access(me, id);
    if (r.host_id !== me) throw new ForbiddenException('Só o anfitrião pode escolher quem transmite.');
    if (r.status !== 'live') throw new ConflictException('A Txillada já acabou.');
    return r;
  }

  /**
   * Pedir para entrar (quem vê): 18 anos ou mais, conta ativa, não expulso, sem bloqueio com o anfitrião (o access() já dá
   * 404/403). Um convite à espera passa logo a aceite. 1 pedido a cada 20 s (429); um pedido à espera não se repete. O
   * anfitrião recebe `txillada.request` (com as listas).
   */
  async requestToJoin(me: string, id: string): Promise<{ state: GuestState; guests?: GuestDto[] }> {
    this.assertEnabled();
    const r = await this.access(me, id);
    if (r.status !== 'live') throw new ConflictException('A Txillada já acabou.');
    if (r.host_id === me) throw new BadRequestException('Já estás a transmitir: és o anfitrião.');
    if (!(await this.canBroadcast(me))) throw new ForbiddenException('Para transmitir numa Txillada tens de ter 18 anos ou mais.');
    const g = await this.guestRow(id, me);
    if (g?.status === 'accepted') throw new ConflictException('Já estás a transmitir nesta Txillada.');
    if (g?.status === 'pending' && g.kind === 'invite') return this.acceptInvite(me, id);
    if (g?.status === 'pending') return { state: 'requested' };
    if (!(await this.bus.claimOnce(`tx:greq:${id}:${me}`, REQUEST_GAP_MS))) {
      throw new HttpException('Calma! Espera um bocadinho antes de pedires outra vez.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const ins = await this.pool.query(
      `INSERT INTO content.txillada_guests (txillada_id, user_id, kind, status) VALUES ($1, $2, 'request', 'pending')
       ON CONFLICT (txillada_id, user_id) DO UPDATE SET kind = 'request', status = 'pending', since = NULL, updated_at = now()
        WHERE content.txillada_guests.status NOT IN ('pending', 'accepted')`,
      [id, me],
    );
    if (ins.rowCount) {
      const l = await this.hostLists(id, r.host_id);
      this.bus.publish(r.host_id, { type: 'txillada.request', txilladaId: id, user: await this.personOf(me), requests: l.requests, invites: l.invites });
    }
    return { state: 'requested' };
  }

  /**
   * O anfitrião convida alguém que está a ver (da lista «A ver agora»): conta ativa, 18 anos ou mais, sem bloqueio, não
   * expulso. Quem já pediu para entrar fica logo aceite. Com 3 a transmitir: 409. A pessoa recebe `txillada.invite`.
   */
  async invite(me: string, id: string, username: string) {
    const r = await this.hostLive(me, id);
    if ((await this.rates.hit(`tx:invite:${me}`, 60_000)) > INVITES_PER_MIN) throw new HttpException('Calma! Muitos convites seguidos.', HttpStatus.TOO_MANY_REQUESTS);
    const t = await this.guestTarget(me, username);
    const banned = (await this.pool.query('SELECT 1 FROM content.txillada_bans WHERE txillada_id = $1 AND user_id = $2', [id, t.id])).rowCount;
    // Numa paga (0167), o anfitrião pode convidar quem ainda não entrou (pelo @): quem é convidado entra de graça. Tem de a
    // poder ver (o perfil do anfitrião), como toda a gente.
    const paidInvite = r.audience === 'paid' && !banned && !!(await this.pool.query(
      `SELECT 1 FROM content.txilladas t JOIN identity.users h ON h.id = t.host_id WHERE t.id = $1 AND ${txilladaVisible('t', 'h', '$2::uuid')}`,
      [id, t.id],
    )).rowCount;
    if (banned || (!paidInvite && !(await this.watching(id, t.id)))) {
      throw new ConflictException(r.audience === 'paid' ? `@${t.username} não pode ver a tua Txillada.` : `Só podes convidar quem está a ver a tua Txillada.`);
    }
    // Sem dizer porquê (a idade de outra pessoa não se mostra).
    if (!(await this.canBroadcast(t.id))) throw new ForbiddenException(`Não podes convidar @${t.username} para transmitir.`);
    const g = await this.guestRow(id, t.id);
    if (g?.status === 'accepted') throw new ConflictException(`@${t.username} já está a transmitir.`);
    if (g?.status === 'pending' && g.kind === 'request') return this.acceptRequest(me, id, t.username);
    if (g?.status !== 'pending') {
      const n = (await this.pool.query(`SELECT count(*)::int AS n FROM content.txillada_guests WHERE txillada_id = $1 AND status = 'accepted'`, [id])).rows[0].n as number;
      if (n >= GUESTS_MAX) throw new ConflictException(GUESTS_FULL);
      await this.pool.query(
        `INSERT INTO content.txillada_guests (txillada_id, user_id, kind, status) VALUES ($1, $2, 'invite', 'pending')
         ON CONFLICT (txillada_id, user_id) DO UPDATE SET kind = 'invite', status = 'pending', since = NULL, updated_at = now()
          WHERE content.txillada_guests.status NOT IN ('pending', 'accepted')`,
        [id, t.id],
      );
      this.bus.publish(t.id, { type: 'txillada.invite', txilladaId: id, host: publicPerson(r, 'h_') });
    }
    return this.sendLists(id, me);
  }

  /** O anfitrião aceita um pedido: a pessoa passa a transmitir (tem de estar a ver). 409 com 3 a transmitir. */
  async acceptRequest(me: string, id: string, username: string) {
    const r = await this.hostLive(me, id);
    const t = await this.guestTarget(me, username);
    const g = await this.guestRow(id, t.id);
    if (g?.status === 'accepted') return this.hostLists(id, me);
    if (g?.status !== 'pending' || g.kind !== 'request') throw new NotFoundException('Pedido não encontrado');
    if (!(await this.watching(id, t.id))) {
      await this.pool.query(`UPDATE content.txillada_guests SET status = 'cancelled', updated_at = now() WHERE txillada_id = $1 AND user_id = $2 AND status = 'pending'`, [id, t.id]);
      await this.sendLists(id, me);
      throw new ConflictException(`@${t.username} já não está a ver.`);
    }
    if (!(await this.canBroadcast(t.id))) throw new ForbiddenException(`@${t.username} não pode transmitir.`);
    await this.admit(r, t.id, 'request');
    return this.hostLists(id, me);
  }

  /** O anfitrião recusa um pedido: a pessoa recebe `txillada.request_declined` (pode pedir outra vez daqui a 20 s). */
  async declineRequest(me: string, id: string, username: string) {
    await this.hostLive(me, id);
    const t = await this.guestTarget(me, username);
    const u = await this.pool.query(
      `UPDATE content.txillada_guests SET status = 'declined', updated_at = now() WHERE txillada_id = $1 AND user_id = $2 AND status = 'pending' AND kind = 'request'`,
      [id, t.id],
    );
    if (!u.rowCount) throw new NotFoundException('Pedido não encontrado');
    this.bus.publish(t.id, { type: 'txillada.request_declined', txilladaId: id });
    return this.sendLists(id, me);
  }

  /** Aceitar o convite do anfitrião (quem foi convidado, a ver): passa a transmitir. 409 com 3 a transmitir. */
  async acceptInvite(me: string, id: string): Promise<{ state: GuestState; guests: GuestDto[] }> {
    this.assertEnabled();
    const r = await this.access(me, id);
    if (r.status !== 'live') throw new ConflictException('A Txillada já acabou.');
    const g = await this.guestRow(id, me);
    if (g?.status !== 'accepted') {
      if (g?.status !== 'pending' || g.kind !== 'invite') throw new NotFoundException('Convite não encontrado');
      if (!(await this.canBroadcast(me))) throw new ForbiddenException('Para transmitir numa Txillada tens de ter 18 anos ou mais.');
      if (!(await this.watching(id, me))) throw new ConflictException('Entra na Txillada para aceitares o convite.');
      await this.admit(r, me, 'invite');
    }
    return { state: 'guest', guests: this.guestList((await this.pool.query(`SELECT ${guestsSql('t', '$2')} AS guests FROM content.txilladas t WHERE t.id = $1`, [id, me])).rows[0].guests) };
  }

  /** Recusar o convite: o anfitrião recebe `txillada.invite_declined`. */
  async declineInvite(me: string, id: string) {
    const t = await this.txRow(id);
    const u = await this.pool.query(
      `UPDATE content.txillada_guests SET status = 'declined', updated_at = now() WHERE txillada_id = $1 AND user_id = $2 AND status = 'pending' AND kind = 'invite'`,
      [id, me],
    );
    if (u.rowCount && t.status === 'live') {
      this.bus.publish(t.host_id, { type: 'txillada.invite_declined', txilladaId: id, user: await this.personOf(me) });
      await this.sendLists(id, t.host_id);
    }
    return { state: 'none' as GuestState };
  }

  /** Sair (o convidado deixa de transmitir e volta a só ver), desistir do pedido ou recusar o convite. Sempre 200. */
  async leaveGuest(me: string, id: string) {
    const t = await this.txRow(id);
    const g = await this.guestRow(id, me);
    if (g?.status === 'pending' && g.kind === 'invite') return this.declineInvite(me, id);
    await this.dropGuest(t, me, 'left');
    return { state: 'none' as GuestState };
  }

  /** O anfitrião tira um convidado (deixa de publicar; as faixas param), retira um convite ou recusa um pedido. */
  async removeGuest(me: string, id: string, username: string) {
    const r = await this.hostLive(me, id);
    const t = await this.guestTarget(me, username);
    if (!(await this.dropGuest(r, t.id, 'removed'))) throw new NotFoundException(`@${t.username} não está a transmitir.`);
    return this.hostLists(id, me);
  }

  private async txRow(id: string) {
    const t = (await this.pool.query('SELECT id, host_id, room, status FROM content.txilladas WHERE id = $1', [id])).rows[0] as
      | { id: string; host_id: string; room: string; status: TxStatus }
      | undefined;
    if (!t) throw new NotFoundException('Txillada não encontrada');
    return t;
  }

  /**
   * Passa a transmitir (o pedido ou o convite já verificados): com a linha da Txillada trancada, conta os que transmitem
   * (no máximo 3: 409) e aceita. Depois deixa-o publicar no LiveKit (sem voltar a entrar) e a sala recebe
   * `txillada.guest_joined` (menos quem tem um bloqueio com o convidado, que não o vê).
   */
  private async admit(t: { id: string; host_id: string; room: string }, userId: string, kind: 'request' | 'invite') {
    const client = await this.pool.connect();
    let since: string;
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT status FROM content.txilladas WHERE id = $1 FOR UPDATE', [t.id])).rows[0];
      if (row?.status !== 'live') throw new ConflictException('A Txillada já acabou.');
      const n = (await client.query(`SELECT count(*)::int AS n FROM content.txillada_guests WHERE txillada_id = $1 AND status = 'accepted'`, [t.id])).rows[0].n as number;
      if (n >= GUESTS_MAX) throw new ConflictException(GUESTS_FULL);
      const u = await client.query(
        `UPDATE content.txillada_guests SET status = 'accepted', since = now(), updated_at = now()
          WHERE txillada_id = $1 AND user_id = $2 AND status = 'pending' AND kind = $3 RETURNING since`,
        [t.id, userId, kind],
      );
      if (!u.rowCount) throw new NotFoundException(kind === 'request' ? 'Pedido não encontrado' : 'Convite não encontrado');
      since = u.rows[0].since;
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    if (this.rooms) {
      await this.rooms.setCanPublish(t.room, userId, true).catch((e) => this.log.warn(`não consegui deixar ${userId} publicar na sala ${t.room}: ${(e as Error).message}`));
    }
    const guest = { user: await this.personOf(userId), since: iso(since) };
    const to = new Set([userId, ...(await this.withoutBlocks(userId, await this.audience(t.id, t.host_id)))]);
    this.emit([...to], { type: 'txillada.guest_joined', txilladaId: t.id, guest });
    await this.recount(t.id, t.host_id);
    await this.sendLists(t.id, t.host_id);
  }

  /** Deixa de transmitir (saiu ou foi tirado): sem permissão de publicar no LiveKit e a sala recebe `txillada.guest_left`. */
  private async endGuest(t: { id: string; host_id: string; room: string; status: string }, userId: string, reason: GuestReason) {
    const u = await this.pool.query(
      `UPDATE content.txillada_guests SET status = $3, updated_at = now() WHERE txillada_id = $1 AND user_id = $2 AND status = 'accepted'`,
      [t.id, userId, reason],
    );
    if (!u.rowCount) return false;
    if (this.rooms && t.status === 'live') {
      await this.rooms.setCanPublish(t.room, userId, false).catch((e) => this.log.warn(`não consegui tirar a permissão a ${userId} na sala ${t.room}: ${(e as Error).message}`));
    }
    // O anfitrião recebe sempre (mesmo depois de um bloqueio com o convidado: o quadrado tem de sair do ecrã dele).
    const to = new Set([t.host_id, userId, ...(await this.withoutBlocks(userId, await this.audience(t.id, t.host_id)))]);
    this.emit([...to], { type: 'txillada.guest_left', txilladaId: t.id, user: await this.personOf(userId), reason });
    await this.recount(t.id, t.host_id);
    return true;
  }

  /**
   * Tira alguém de transmitir, ou o pedido ou o convite à espera (sair, tirar, expulsar, bloquear, apagar a conta). Devolve
   * true se havia alguma coisa a tirar.
   */
  private async dropGuest(t: { id: string; host_id: string; room: string; status: string }, userId: string, reason: GuestReason) {
    const g = await this.guestRow(t.id, userId);
    if (g?.status === 'accepted') return this.endGuest(t, userId, reason);
    if (g?.status !== 'pending') return false;
    const u = await this.pool.query(
      `UPDATE content.txillada_guests SET status = $3, updated_at = now() WHERE txillada_id = $1 AND user_id = $2 AND status = 'pending'`,
      [t.id, userId, reason === 'left' || g.kind === 'invite' ? 'cancelled' : 'declined'],
    );
    if (!u.rowCount) return false;
    if (g.kind === 'invite' && reason === 'removed') this.bus.publish(userId, { type: 'txillada.invite_cancelled', txilladaId: t.id });
    if (g.kind === 'request' && reason === 'removed') this.bus.publish(userId, { type: 'txillada.request_declined', txilladaId: t.id });
    if (t.status === 'live') await this.sendLists(t.id, t.host_id);
    return true;
  }

  /** Apagar a conta: deixa de transmitir nas Txilladas dos outros (e os pedidos e convites caem), antes de a apagar. */
  async leaveAllGuests(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT t.id, t.host_id, t.room, t.status FROM content.txillada_guests g JOIN content.txilladas t ON t.id = g.txillada_id
        WHERE g.user_id = $1 AND g.status IN ('pending', 'accepted') AND t.status = 'live'`,
      [userId],
    );
    for (const t of rows) {
      await this.dropGuest(t, userId, 'left');
      if (this.rooms) await this.rooms.removeParticipant(t.room, userId).catch(() => undefined);
    }
  }

  /* ───────────── webhook do LiveKit ───────────── */

  async webhook(body: string, auth: string | undefined) {
    if (!this.receive) throw new ServiceUnavailableException(UNAVAILABLE);
    let ev: WebhookEvent;
    try {
      ev = await this.receive(body, auth);
    } catch {
      throw new UnauthorizedException('Assinatura inválida');
    }
    const roomName = ev.room?.name;
    if (!roomName) return;
    const t = (await this.pool.query('SELECT id, host_id, status, room FROM content.txilladas WHERE room = $1', [roomName])).rows[0];
    if (!t) return;
    const who = ev.participant?.identity;
    const isHost = who === t.host_id;
    switch (ev.event) {
      case 'room_finished':
        await this.finish(t.id, 'ended');
        return;
      case 'participant_joined': {
        if (!who) return;
        // Alguém entrou numa sala que já acabou (com um token antigo), foi expulso ou já não a pode ver (um bloqueio…): sai outra vez.
        // (Uma identidade que não é das nossas — os tokens dão sempre o id da conta — também sai.)
        const banned = !isHost && (!/^[0-9a-f-]{36}$/i.test(who) || !(await this.pool.query(
          `SELECT 1 FROM content.txilladas t JOIN identity.users h ON h.id = t.host_id
            WHERE t.id = $1 AND ${txilladaVisible('t', 'h', '$2::uuid')} AND NOT ${txilladaBanned('t', '$2::uuid')} AND ${txilladaTicket('t', '$2::uuid')}`,
          [t.id, who],
        )).rowCount);
        if (t.status !== 'live' || banned) {
          if (this.rooms) await this.rooms.removeParticipant(t.room, who).catch(() => undefined);
          return;
        }
        if (isHost) return;
        await this.bus.touch(toKey(t.id), who, SET_MS);
        await this.bus.touch(inKey(t.id), who, SET_MS);
        await this.recount(t.id, t.host_id);
        // Um convidado que voltou a entrar (uma religação reaproveita o token antigo, sem `canPublish`): a permissão outra vez.
        if (this.rooms && (await this.guestRow(t.id, who))?.status === 'accepted') {
          await this.rooms.setCanPublish(t.room, who, true).catch((e) => this.log.warn(`não consegui deixar ${who} publicar na sala ${t.room}: ${(e as Error).message}`));
        }
        return;
      }
      case 'participant_left':
      case 'participant_connection_aborted':
        if (!who || t.status !== 'live') return;
        if (isHost) {
          await this.pool.query('UPDATE content.txilladas SET video_on = false, video_at = now() WHERE id = $1 AND status = $2', [t.id, 'live']);
          return;
        }
        await this.bus.untouch(toKey(t.id), who);
        await this.bus.untouch(inKey(t.id), who);
        // Um convidado que saiu da sala deixa de transmitir (se ainda lá está com outra ligação, o aviso era da antiga).
        if ((await this.guestRow(t.id, who))?.status === 'accepted') {
          const still = this.rooms ? (await this.rooms.participants(t.room).catch(() => [])).some((p) => p.identity === who) : false;
          if (!still) await this.endGuest(t, who, 'left');
        }
        await this.recount(t.id, t.host_id);
        return;
      case 'track_published':
      case 'track_unpublished':
        if (!isHost || t.status !== 'live' || ev.track?.type !== TrackType.VIDEO) return;
        await this.pool.query('UPDATE content.txilladas SET video_on = $2, video_at = now() WHERE id = $1 AND status = $3', [t.id, ev.event === 'track_published', 'live']);
        return;
      default:
        return;
    }
  }

  /* ───────────── tarefas ───────────── */

  /**
   * Acaba as Txilladas a decorrer há mais de 4 h e as que estão sem vídeo do anfitrião há mais de 60 s. «Sem vídeo» vem do
   * webhook (track_published/unpublished, o anfitrião sair); antes de acabar, pergunta-se ao LiveKit se o anfitrião está mesmo
   * sem vídeo (assim também funciona com o webhook por ligar ou um aviso perdido). Devolve quantas acabaram.
   */
  async sweep(now = new Date()) {
    let n = 0;
    // As entradas de uma Txillada cortada que ainda não voltaram (o afterEnd falhou a meio, ou pagou-se enquanto se cortava).
    const owed = await this.pool.query(
      `SELECT DISTINCT k.txillada_id AS id FROM content.txillada_tickets k JOIN content.txilladas t ON t.id = k.txillada_id
        WHERE k.refunded_at IS NULL AND t.status = 'cut' LIMIT 20`,
    );
    for (const r of owed.rows) await this.refundTickets(r.id).catch((e) => this.log.warn(`não consegui devolver as entradas da Txillada ${r.id}: ${(e as Error).message}`));
    // As de mais de 4 h e as de um anfitrião que deixou de estar ativo (suspenso a meio: o LiveKit não o sabe e continuava a transmitir).
    const old = await this.pool.query(
      `SELECT t.id FROM content.txilladas t JOIN identity.users h ON h.id = t.host_id
        WHERE t.status = 'live' AND (t.started_at < $1::timestamptz - make_interval(secs => $2) OR h.status <> 'active')`,
      [now, MAX_LIVE_MS / 1000],
    );
    for (const r of old.rows) if (await this.finish(r.id, 'ended')) n++;
    const quiet = await this.pool.query(
      `SELECT id, room, host_id FROM content.txilladas
        WHERE status = 'live' AND NOT video_on AND COALESCE(video_at, started_at) < $1::timestamptz - make_interval(secs => $2)`,
      [now, NO_VIDEO_MS / 1000],
    );
    for (const r of quiet.rows) {
      if (this.rooms) {
        let hostVideo: boolean;
        try {
          hostVideo = (await this.rooms.participants(r.room)).some((p) => p.identity === r.host_id && p.videoTracks > 0);
        } catch (e) {
          const msg = (e as Error).message ?? '';
          // A sala já não existe: acaba. Outro erro (o LiveKit não responde): tenta-se na volta seguinte (as 4 h travam o resto).
          if (!/not.?found|does not exist/i.test(msg)) {
            this.log.warn(`não consegui perguntar ao LiveKit pela sala ${r.room}: ${msg}`);
            continue;
          }
          hostVideo = false;
        }
        if (hostVideo) {
          await this.pool.query('UPDATE content.txilladas SET video_at = now() WHERE id = $1', [r.id]);
          continue;
        }
      }
      if (await this.finish(r.id, 'ended')) n++;
    }
    return n;
  }

  /**
   * Nada fica guardado: os comentários e os brindes (e as expulsões) de uma Txillada acabada há mais de 7 dias apagam-se,
   * menos os comentários de uma Txillada com denúncia por decidir e os comentários denunciados por decidir (0162): ficam
   * até à decisão, mas os brindes a eles saem já.
   * A linha da Txillada fica (registo).
   */
  async purge(days = TX_KEEP_DAYS) {
    const ended = `t.status <> 'live' AND t.ended_at < now() - make_interval(days => $1)`;
    const cc = await this.pool.query(
      `DELETE FROM content.txillada_comment_cheers x USING content.txillada_comments c, content.txilladas t
        WHERE x.comment_id = c.id AND c.txillada_id = t.id AND ${ended}`,
      [days],
    );
    const c = await this.pool.query(
      `DELETE FROM content.txillada_comments c USING content.txilladas t
        WHERE c.txillada_id = t.id AND ${ended}
          AND NOT EXISTS (SELECT 1 FROM social.reports r WHERE r.target_type = 'txillada' AND r.target_id = t.id AND r.status = 'open')
          AND NOT EXISTS (SELECT 1 FROM social.reports r WHERE r.target_type = 'txillada_comment' AND r.target_id = c.id AND r.status = 'open')`,
      [days],
    );
    const ch = await this.pool.query(`DELETE FROM content.txillada_cheers x USING content.txilladas t WHERE x.txillada_id = t.id AND ${ended}`, [days]);
    await this.pool.query(`DELETE FROM content.txillada_bans x USING content.txilladas t WHERE x.txillada_id = t.id AND ${ended}`, [days]);
    // Quem pediu, foi convidado ou transmitiu (0165).
    const g = await this.pool.query(`DELETE FROM content.txillada_guests x USING content.txilladas t WHERE x.txillada_id = t.id AND ${ended}`, [days]);
    return { comments: c.rowCount ?? 0, cheers: ch.rowCount ?? 0, commentCheers: cc.rowCount ?? 0, guests: g.rowCount ?? 0 };
  }

  /* ───────────── backoffice ───────────── */

  /** As que estão a decorrer, com as denúncias por decidir e os últimos comentários (as denunciadas primeiro). */
  async adminList() {
    const { rows } = await this.pool.query(
      `SELECT ${TX_COLS}, ${HOST_COLS}, h.status AS h_status, ${guestsSql('t', null)} AS guests, ${topGiversSql('t', null)} AS top_givers,
              (SELECT count(*) FROM social.reports r WHERE r.target_type = 'txillada' AND r.target_id = t.id AND r.status = 'open')::int AS open_reports,
              (SELECT array_agg(DISTINCT r.reason) FROM social.reports r WHERE r.target_type = 'txillada' AND r.target_id = t.id AND r.status = 'open') AS reasons,
              (SELECT json_agg(x ORDER BY x.id) FROM (
                 SELECT c.id, c.body, c.created_at AS "createdAt", a.username FROM content.txillada_comments c JOIN identity.users a ON a.id = c.author_id
                  WHERE c.txillada_id = t.id AND c.removed_at IS NULL ORDER BY c.id DESC LIMIT 5) x) AS last_comments
         FROM content.txilladas t JOIN identity.users h ON h.id = t.host_id
        WHERE t.status = 'live'
        ORDER BY open_reports DESC, t.viewers DESC, t.started_at DESC LIMIT 200`,
    );
    return {
      items: rows.map((r) => ({
        ...this.dto({ ...r, comment_ok: false, has_ticket: true }, ''),
        reports: { open: r.open_reports as number, reasons: ((r.reasons as string[] | null) ?? []) as ReportReason[] },
        lastComments: (r.last_comments as { id: string; body: string; createdAt: string; username: string }[] | null) ?? [],
      })),
    };
  }

  /** A equipa corta uma Txillada: fecha a sala, avisa quem via, fecha as denúncias por decidir e avisa o anfitrião. */
  async adminCut(staff: string, id: string, reason: string) {
    const r = (await this.pool.query('SELECT host_id, status FROM content.txilladas WHERE id = $1', [id])).rows[0];
    if (!r) throw new NotFoundException('Txillada não encontrada');
    if (!(await this.finish(id, 'cut', reason, staff))) throw new ConflictException('Esta Txillada já não está a decorrer.');
    await this.pool.query(
      `UPDATE social.reports SET status = 'actioned', resolution = 'remove', resolved_by = $2, resolved_at = now(), resolution_note = $3
        WHERE target_type = 'txillada' AND target_id = $1 AND status = 'open'`,
      [id, staff, reason],
    );
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [
      uuidv7(), staff, 'moderation.txillada_cut', `txillada:${id}`, { owner: r.host_id, note: reason },
    ]);
    void this.notifications.notifyTxillapp({ userId: r.host_id, actorId: staff, kind: 'content_removed', data: { type: 'txillada', reason } });
  }
}
