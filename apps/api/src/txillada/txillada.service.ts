import {
  BadRequestException, ConflictException, ForbiddenException, GoneException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException,
  OnModuleInit, ServiceUnavailableException, UnauthorizedException,
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
import { txilladaBanned, txilladaVisible } from './txillada-visibility';

/**
 * A Txillada (os lives), fase 1 — docs/txillada-contrato.md. O vídeo passa só pelo LiveKit (nada se grava); aqui ficam os
 * acessos (tokens LiveKit), o estado, os comentários, os brindes, as expulsões e a moderação, e os eventos em tempo real
 * pelo canal da app (RealtimeBus.publish → o SSE do chat).
 *
 * Quem está a ver (para lhe mandar os eventos): um conjunto no RealtimeBus (`tx:to:<id>`, Redis com REDIS_URL) com quem fez
 * `join` ou entrou na sala (webhook), e de onde sai quem saiu da sala (webhook participant_left). Quantos estão na sala
 * (`viewers`): outro conjunto (`tx:in:<id>`), só com o que o webhook diz.
 */
export type TxAudience = 'everyone' | 'followers' | 'close';
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
/** O «olá» de quem vê: 1 a cada 4 s por pessoa. */
const HELLO_MS = 4_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** As colunas do anfitrião (`h`) com o prefixo h_. */
const HOST_COLS = `h.id AS h_id, h.username AS h_username, h.display_name AS h_display_name, (h.avatar_media_id IS NOT NULL) AS h_has_avatar,
                   h.verified AS h_verified, h.verified_tier AS h_verified_tier`;
const TX_COLS = `t.id, t.host_id, t.title, t.audience, t.status, t.room, t.started_at, t.ended_at, t.viewers, t.peak_viewers, t.cheers, t.comments`;

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

  private dto(r: Record<string, any>, me: string) {
    const isHost = r.host_id === me;
    return {
      id: r.id as string,
      host: person(r, 'h_'),
      title: r.title as string,
      audience: r.audience as TxAudience,
      status: r.status as TxStatus,
      startedAt: r.started_at as string,
      endedAt: (r.ended_at as string | null) ?? null,
      viewers: r.viewers as number,
      peakViewers: r.peak_viewers as number,
      cheers: r.cheers as number,
      comments: r.comments as number,
      isHost,
      canComment: r.status === 'live' && (isHost || (!!r.comment_ok && !r.banned)),
    };
  }

  /** A Txillada como `me` a vê: 404 se não a pode ver, 403 se foi expulso. */
  private async access(me: string, id: string) {
    const { rows } = await this.pool.query(
      `SELECT ${TX_COLS}, ${HOST_COLS}, ${txilladaVisible('t', 'h', '$1')} AS visible, ${txilladaBanned('t', '$1')} AS banned,
              ${allowedBy('h', 'comments_allowed', '$1')} AS comment_ok
         FROM content.txilladas t JOIN identity.users h ON h.id = t.host_id WHERE t.id = $2`,
      [me, id],
    );
    const r = rows[0];
    if (!r || !r.visible) throw new NotFoundException('Txillada não encontrada');
    if (r.banned && r.host_id !== me) throw new ForbiddenException('O anfitrião tirou-te desta Txillada.');
    return r;
  }

  publicConfig() {
    return { enabled: this.enabled };
  }

  async get(me: string, id: string) {
    return this.dto(await this.access(me, id), me);
  }

  /** As que estão a decorrer e posso ver: de quem sigo primeiro, depois as mais vistas do meu país (máx. 30). */
  async live(me: string) {
    const { rows } = await this.pool.query(
      `SELECT ${TX_COLS}, ${HOST_COLS}, false AS banned, ${allowedBy('h', 'comments_allowed', '$1')} AS comment_ok,
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

  async create(me: string, title: string, audience: TxAudience) {
    this.assertEnabled();
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
    const running = (await this.pool.query(`SELECT id FROM content.txilladas WHERE host_id = $1 AND status = 'live'`, [me])).rows[0];
    if (running) throw new ConflictException({ message: 'Já tens uma Txillada a decorrer.', id: running.id });
    const id = uuidv7();
    try {
      await this.pool.query(
        `INSERT INTO content.txilladas (id, host_id, title, audience, room, video_at) VALUES ($1, $2, $3, $4, $5, now())`,
        [id, me, title, audience, `tx-${id}`],
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
    const token = await roomToken(this.config, isHost
      ? { room: r.room, identity: me, name: u.display_name, username: u.username, host: true }
      : { room: r.room, identity: me, host: false });
    if (!isHost) {
      await this.bus.touch(toKey(id), me, SET_MS);
      // «@fulano entrou»: daqui (o webhook pode não estar ligado), uma vez por pessoa a cada 60 s (as religações não repetem).
      if (await this.bus.claimOnce(`tx:joined:${id}:${me}`, 60_000)) {
        const user = publicPerson(u);
        const to = (await this.withoutBlocks(me, await this.audience(id, r.host_id))).filter((x) => x !== me);
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
    const to = await this.audience(r.id, r.host_id);
    this.emit(to, { type: 'txillada.ended', txilladaId: r.id, status: r.status });
    for (const k of [toKey(r.id), inKey(r.id)]) for (const m of await this.bus.recent(k, SET_MS)) await this.bus.untouch(k, m);
    if (this.rooms) await this.rooms.deleteRoom(r.room).catch((e) => this.log.warn(`não consegui fechar a sala ${r.room}: ${(e as Error).message}`));
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
    const { rows } = await this.pool.query(`SELECT id, room, host_id FROM content.txilladas WHERE status = 'live' AND host_id = ANY($1::uuid[])`, [[a, b]]);
    for (const t of rows) {
      const other = t.host_id === a ? b : a;
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

  /** Quantos estão na sala (sem o anfitrião), pelo que o webhook disse; avisa se mudou. */
  private async recount(id: string, hostId: string) {
    const n = (await this.bus.recent(inKey(id), SET_MS)).filter((u) => u !== hostId).length;
    const r = await this.pool.query(
      `UPDATE content.txilladas SET viewers = $2, peak_viewers = GREATEST(peak_viewers, $2)
        WHERE id = $1 AND status = 'live' AND viewers IS DISTINCT FROM $2 RETURNING viewers`,
      [id, n],
    );
    if (r.rowCount) this.emit(await this.audience(id, hostId), { type: 'txillada.viewers', txilladaId: id, viewers: n });
  }

  /* ───────────── comentários e brindes ───────────── */

  private commentDto(r: Record<string, any>) {
    return { id: r.id as string, author: person(r, 'a_'), body: r.body as string, createdAt: r.created_at as string };
  }

  async comments(me: string, id: string, after?: string) {
    await this.access(me, id);
    const { rows } = await this.pool.query(
      `SELECT c.id, c.body, c.created_at, a.id AS a_id, a.username AS a_username, a.display_name AS a_display_name,
              (a.avatar_media_id IS NOT NULL) AS a_has_avatar, a.verified AS a_verified, a.verified_tier AS a_verified_tier
         FROM content.txillada_comments c JOIN identity.users a ON a.id = c.author_id AND a.status = 'active'
        WHERE c.txillada_id = $1 AND c.removed_at IS NULL AND ($2::uuid IS NULL OR c.id > $2) AND NOT ${blockedBetween('a.id', '$3')}
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
         SELECT c.id, c.body, c.created_at, a.id AS a_id, a.username AS a_username, a.display_name AS a_display_name,
                (a.avatar_media_id IS NOT NULL) AS a_has_avatar, a.verified AS a_verified, a.verified_tier AS a_verified_tier
           FROM c, identity.users a WHERE a.id = $3`,
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
    this.emit(await this.audience(id, c.host_id), { type: 'txillada.comment_removed', txilladaId: id, commentId });
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
    if ((await this.rates.hit(`tx:cheer:${me}`, 1_000)) > 5) throw new HttpException('Calma! No máximo 5 brindes por segundo.', HttpStatus.TOO_MANY_REQUESTS);
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
    const ids = (await this.bus.recent(toKey(id), SET_MS)).filter((v) => v !== r.host_id && UUID_RE.test(v));
    if (!ids.length) return { items: [], total: 0 };
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, u.verified, u.verified_tier,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $2 AND f.followee_id = u.id) AS followed
         FROM identity.users u
        WHERE u.id = ANY($1::uuid[]) AND u.status = 'active' AND NOT ${blockedBetween('u.id', '$2')}
          AND NOT EXISTS (SELECT 1 FROM content.txillada_bans b WHERE b.txillada_id = $3 AND b.user_id = u.id)
        ORDER BY followed DESC, lower(u.username)
        LIMIT 200`,
      [ids, me, id],
    );
    const items = rows.map((x) => publicPerson(x));
    return { items, total: items.length };
  }

  /* ───────────── expulsar e denunciar ───────────── */

  async ban(me: string, id: string, username: string) {
    const r = await this.access(me, id);
    if (r.host_id !== me) throw new ForbiddenException('Só o anfitrião pode tirar alguém da Txillada.');
    const t = (await this.pool.query('SELECT id FROM identity.users WHERE lower(username) = lower($1)', [username.replace(/^@/, '')])).rows[0];
    if (!t) throw new NotFoundException('Utilizador não encontrado');
    if (t.id === me) throw new BadRequestException('Não te podes tirar da tua própria Txillada.');
    await this.pool.query('INSERT INTO content.txillada_bans (txillada_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, t.id]);
    await this.bus.untouch(toKey(id), t.id);
    if (r.status === 'live' && this.rooms) await this.rooms.removeParticipant(r.room, t.id).catch((e) => this.log.warn(`não consegui tirar ${t.id} da sala ${r.room}: ${(e as Error).message}`));
  }

  async report(me: string, id: string, reason: ReportReason, note?: string) {
    await this.access(me, id);
    await this.moderation.report(me, 'txillada', id, reason, note);
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
            WHERE t.id = $1 AND ${txilladaVisible('t', 'h', '$2::uuid')} AND NOT ${txilladaBanned('t', '$2::uuid')}`,
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
   * menos os comentários de uma Txillada com denúncia por decidir (ficam até à decisão). A linha da Txillada fica (registo).
   */
  async purge(days = TX_KEEP_DAYS) {
    const ended = `t.status <> 'live' AND t.ended_at < now() - make_interval(days => $1)`;
    const c = await this.pool.query(
      `DELETE FROM content.txillada_comments c USING content.txilladas t
        WHERE c.txillada_id = t.id AND ${ended}
          AND NOT EXISTS (SELECT 1 FROM social.reports r WHERE r.target_type = 'txillada' AND r.target_id = t.id AND r.status = 'open')`,
      [days],
    );
    const ch = await this.pool.query(`DELETE FROM content.txillada_cheers x USING content.txilladas t WHERE x.txillada_id = t.id AND ${ended}`, [days]);
    await this.pool.query(`DELETE FROM content.txillada_bans x USING content.txilladas t WHERE x.txillada_id = t.id AND ${ended}`, [days]);
    return { comments: c.rowCount ?? 0, cheers: ch.rowCount ?? 0 };
  }

  /* ───────────── backoffice ───────────── */

  /** As que estão a decorrer, com as denúncias por decidir e os últimos comentários (as denunciadas primeiro). */
  async adminList() {
    const { rows } = await this.pool.query(
      `SELECT ${TX_COLS}, ${HOST_COLS}, h.status AS h_status,
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
        ...this.dto({ ...r, comment_ok: false }, ''),
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
