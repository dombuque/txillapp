import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { ChatEvents, type MixarEvent } from '../chat/chat.events';
import { ChatService } from '../chat/chat.service';
import { badge, type Badge } from '../common/badge';
import { topicLabel } from '../common/topics';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { tchekaPost } from '../posts/feed';
import { interestSql } from '../posts/interest';
import { PostsService } from '../posts/posts.service';
import { PushService } from '../push/push.service';
import { Scheduler } from '../realtime/scheduler';
import { RATE_STORE, type RateStore } from '../security/rate-store';
import { blockedBetween, canView, inMyNetwork, notReportedBy } from '../social/visibility';
import { MIXAR_CARD_TEXT } from './mixar-cards';
import {
  CHALLENGE_QUESTION, commonTopics, matchScore, MAX_ITEMS, mixarDay, onlyOf, pickChallenge, pickDaily, streakOf,
  type Candidate, type ChallengeKind, type From, type Weights,
} from './mixar-pick';

/** No máximo quantos Mixar ativos por pessoa e quantos convites por dia (dias de Maputo). */
export const MAX_ACTIVE = 20;
export const INVITES_PER_DAY = 10;
/** Anti-spam (RATE_STORE): no máximo 3 convites à mesma pessoa em 24 horas (convidar, sair, convidar outra vez…). */
export const PAIR_INVITES_PER_DAY = 3;
const DAY_MS = 86_400_000;
/** De quanto em quanto tempo a tarefa diária olha para os Mixar sem a seleção de hoje (o dia muda às 05:00 de Maputo). */
export const DAILY_EVERY_MS = 15 * 60_000;
const DAILY_BATCH = 200;
/** Quantos candidatos se leem de cada vez para a seleção. */
const CANDIDATES = 600;
/** Um dia que ficou sem itens volta a ser gerado ao fim de uma hora (pode ter aparecido conteúdo novo). */
const EMPTY_RETRY = "interval '1 hour'";

export const REACTIONS = ['kkk', 'fogo', 'amor', 'uau', 'brinde', 'nah'] as const;
export type ReactionId = (typeof REACTIONS)[number];

/** O início do dia de hoje em Maputo (para o limite de convites por dia). */
const TODAY = `((date_trunc('day', now() AT TIME ZONE 'Africa/Maputo')) AT TIME ZONE 'Africa/Maputo')`;

export type FeedPost = Awaited<ReturnType<PostsService['feedPosts']>>[number];
type Person = { username: string; displayName: string; hasAvatar: boolean } & Badge;
type Topic = { topic: string; label: string };

export interface MixarSummary {
  id: string;
  status: 'pending' | 'active';
  invitedByMe: boolean;
  partner: Person;
  name: string;
  newToday: number;
  challengePending: boolean;
  updatedAt: string;
}
export interface MixarDto extends MixarSummary {
  createdAt: string;
  acceptedAt: string | null;
  match: number;
  common: (Topic & { score: number })[];
  onlyMe: Topic[];
  onlyThem: Topic[];
  streak: number;
  matches: number;
}
export interface MixarItem {
  post: FeedPost;
  from: 'me' | 'them' | 'both';
  topic: Topic | null;
  mine: ReactionId | null;
  theirs: ReactionId | null;
  seenByThem: boolean;
}
export interface ChallengeDto {
  id: string;
  kind: ChallengeKind;
  question: string;
  day: string;
  options: FeedPost[];
  myPick: string | null;
  theirPicked: boolean;
  theirPick: string | null;
  match: boolean | null;
}

/** Uma linha do Mixar vista por `me`. */
interface Row {
  id: string;
  user_a: string;
  user_b: string;
  invited_by: string;
  status: 'pending' | 'active' | 'declined' | 'ended';
  created_at: Date;
  accepted_at: Date | null;
  updated_at: Date;
  other_id: string;
  username: string;
  display_name: string;
  has_avatar: boolean;
  verified: boolean;
  verified_tier: string | null;
  my_name: string;
  my_first: string;
  their_first: string;
  blocked: boolean;
}

/**
 * O que um espectador pode ver no Mixar (SQL, com `p` = content.posts e `u` = o autor): a regra de privacidade de sempre
 * (canView: conta ativa, sem bloqueio dos dois lados, pública ou seguida), e nada do que escondeu («não me interessa»),
 * marcou «não interessado», denunciou ou de quem pediu para ver menos.
 */
const seesFor = (viewer: string) => `(${canView('u', viewer)}
  AND NOT EXISTS (SELECT 1 FROM content.feed_impressions mhi WHERE mhi.user_id = ${viewer} AND mhi.post_id = p.id AND mhi.hidden)
  AND NOT EXISTS (SELECT 1 FROM content.post_feedback mfb WHERE mfb.user_id = ${viewer} AND mfb.post_id = p.id AND mfb.value < 0)
  AND NOT EXISTS (SELECT 1 FROM social.explore_people mep WHERE mep.user_id = ${viewer} AND mep.person_id = p.author_id AND mep.pref < 0)
  AND ${notReportedBy('post', 'p.id', viewer)})`;

/** Os dois podem ver, a publicação não foi removida e não é de nenhum dos dois. Reavaliado em cada leitura. */
export const bothSee = (a: string, b: string) => `(p.removed_at IS NULL AND p.author_id <> ${a} AND p.author_id <> ${b} AND ${seesFor(a)} AND ${seesFor(b)})`;

/**
 * Mixar (0150, docs/mixar-contrato.md): um feed a dois. O convite vai como um cartão no chat (kind 'mixar'); aceite, os dois
 * recebem todos os dias (às 05:00 de Maputo, tarefa `mixar.daily` no worker; ou na hora, quando alguém abre e ainda não há)
 * uma seleção de até 24 publicações que os dois podem ver, escolhida por mixar-pick.ts a partir dos perfis de temas dos dois
 * (o do Explorar) e do perfil do próprio Mixar (reações, vistos até ao fim, envios para o chat e escolhas nos desafios).
 * Cada dia tem um «Mixa Challenge» com 3 ou 4 itens do dia.
 */
@Injectable()
export class MixarService implements OnModuleInit {
  private readonly log = new Logger('Mixar');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly chat: ChatService,
    private readonly events: ChatEvents,
    private readonly push: PushService,
    private readonly posts: PostsService,
    private readonly scheduler: Scheduler,
    @Inject(RATE_STORE) private readonly store: RateStore,
  ) {}

  onModuleInit() {
    this.scheduler.every('mixar.daily', DAILY_EVERY_MS, () => this.runDaily(), { firstAfterMs: 60_000 });
  }

  /* ───────────── convites ───────────── */

  async invite(me: string, username: string): Promise<MixarDto> {
    const name = username.trim().replace(/^@/, '');
    const other = (
      await this.pool.query(
        `SELECT u.id, u.username, ${blockedBetween('u.id', '$1')} AS blocked FROM identity.users u WHERE lower(u.username) = lower($2) AND u.status = 'active'`,
        [me, name],
      )
    ).rows[0];
    if (!other) throw new NotFoundException('Essa pessoa não existe');
    if (other.id === me) throw new BadRequestException('Não podes fazer um Mixar contigo');
    if (other.blocked) throw new ForbiddenException('Não podes convidar esta pessoa');
    const [a, b] = me < other.id ? [me, other.id as string] : [other.id as string, me];
    const open = await this.openBetween(a, b);
    if (open) throw new ConflictException({ statusCode: 409, message: 'Já tens um Mixar com esta pessoa', id: open });
    const why = await this.chat.cannotMessage(me, other.id as string);
    if (why) throw new ForbiddenException(why);

    const used = (await this.pool.query(`SELECT count(*)::int AS n FROM social.mixars WHERE invited_by = $1 AND created_at >= ${TODAY}`, [me])).rows[0].n as number;
    if (used >= INVITES_PER_DAY) throw new HttpException(`Já mandaste ${INVITES_PER_DAY} convites para o Mixar hoje. Amanhã há mais`, HttpStatus.TOO_MANY_REQUESTS);
    if ((await this.activeCount(me)) >= MAX_ACTIVE) throw new HttpException(`Já tens ${MAX_ACTIVE} Mixar ativos. Sai de um para começar outro`, HttpStatus.TOO_MANY_REQUESTS);
    if ((await this.activeCount(other.id as string)) >= MAX_ACTIVE) throw new HttpException(`@${other.username as string} já tem ${MAX_ACTIVE} Mixar ativos`, HttpStatus.TOO_MANY_REQUESTS);
    if ((await this.store.hit(`mixar:inv:${me}:${other.id as string}`, DAY_MS)) > PAIR_INVITES_PER_DAY) {
      throw new HttpException('Já convidaste esta pessoa muitas vezes hoje. Tenta amanhã', HttpStatus.TOO_MANY_REQUESTS);
    }

    const id = uuidv7();
    const messageId = uuidv7();
    try {
      await this.pool.query(`INSERT INTO social.mixars (id, user_a, user_b, invited_by, message_id) VALUES ($1, $2, $3, $4, $5)`, [id, a, b, me, messageId]);
    } catch (e) {
      // Dois convites ao mesmo tempo: o índice único deixa passar só um.
      if ((e as { code?: string }).code === '23505') {
        const again = await this.openBetween(a, b);
        throw new ConflictException({ statusCode: 409, message: 'Já tens um Mixar com esta pessoa', id: again });
      }
      throw e;
    }
    try {
      // O cartão no chat, sem o aviso do chat no telemóvel: o aviso do Mixar vai a seguir, com o endereço do Mixar.
      await this.chat.sendCard(me, other.id as string, 'mixar', MIXAR_CARD_TEXT.received, null, messageId);
    } catch (e) {
      await this.pool.query('DELETE FROM social.mixars WHERE id = $1', [id]);
      throw e;
    }
    this.notify(other.id as string, me, id, 'invite');
    const myName = await this.displayName(me);
    void this.push.send(other.id as string, { title: 'Mixar', body: `${myName} convidou-te para um Mixar`, url: `/mixar/${id}`, tag: `mixar:${id}`, category: 'messages' });
    return this.get(me, id);
  }

  async accept(me: string, id: string): Promise<MixarDto> {
    const m = await this.row(me, id);
    if (m.status !== 'pending') throw new ConflictException('Este convite já não está à espera de resposta');
    if (m.invited_by === me) throw new ForbiddenException('Foste tu que convidaste: espera pela resposta');
    if ((await this.activeCount(me)) >= MAX_ACTIVE) throw new HttpException(`Já tens ${MAX_ACTIVE} Mixar ativos. Sai de um para aceitar este`, HttpStatus.TOO_MANY_REQUESTS);
    if ((await this.activeCount(m.other_id)) >= MAX_ACTIVE) throw new HttpException(`@${m.username} já tem ${MAX_ACTIVE} Mixar ativos`, HttpStatus.TOO_MANY_REQUESTS);
    const done = await this.pool.query(`UPDATE social.mixars SET status = 'active', accepted_at = now(), updated_at = now() WHERE id = $1 AND status = 'pending'`, [id]);
    if (!done.rowCount) throw new ConflictException('Este convite já não está à espera de resposta');
    await this.chat.cardChanged(me, m.other_id);
    // A primeira seleção logo (quem convidou abre o Mixar pelo aviso).
    await this.ensureDay({ ...m, status: 'active' }, mixarDay()).catch((e) => this.log.warn(`seleção de ${id}: ${(e as Error).message}`));
    this.notify(m.other_id, me, id, 'accepted');
    void this.push.send(m.other_id, { title: 'Mixar', body: `${m.my_name} aceitou o vosso Mixar`, url: `/mixar/${id}`, tag: `mixar:${id}`, category: 'messages' });
    return this.get(me, id);
  }

  async decline(me: string, id: string) {
    const m = await this.row(me, id);
    if (m.status !== 'pending') throw new ConflictException('Este convite já não está à espera de resposta');
    if (m.invited_by === me) throw new ForbiddenException('Foste tu que convidaste: para desistir, sai do Mixar');
    const done = await this.pool.query(`UPDATE social.mixars SET status = 'declined', ended_at = now(), ended_by = $2, updated_at = now() WHERE id = $1 AND status = 'pending'`, [id, me]);
    if (!done.rowCount) throw new ConflictException('Este convite já não está à espera de resposta');
    await this.chat.cardChanged(me, m.other_id);
    return { ok: true as const };
  }

  /** Sair (qualquer um dos dois; também quem convidou, antes da resposta). */
  async leave(me: string, id: string) {
    const m = await this.row(me, id);
    if (m.status !== 'pending' && m.status !== 'active') throw new NotFoundException('Mixar não encontrado');
    await this.pool.query(`UPDATE social.mixars SET status = 'ended', ended_at = now(), ended_by = $2, updated_at = now() WHERE id = $1 AND status IN ('pending', 'active')`, [id, me]);
    await this.chat.cardChanged(me, m.other_id);
    return { ok: true as const };
  }

  /* ───────────── leitura ───────────── */

  /** Os meus Mixar ativos e os convites pendentes (recebidos primeiro). Com bloqueio ou conta eliminada, desaparece. */
  async list(me: string): Promise<{ items: MixarSummary[] }> {
    return { items: await this.summaries(me, mixarDay()) };
  }

  async get(me: string, id: string): Promise<MixarDto> {
    const m = await this.row(me, id);
    if (m.status !== 'pending' && m.status !== 'active') throw new NotFoundException('Mixar não encontrado');
    const day = mixarDay();
    if (m.status === 'active') await this.ensureDay(m, day);
    const [summary] = await this.summaries(me, day, id);
    if (!summary) throw new NotFoundException('Mixar não encontrado');
    const [pa, pb] = await Promise.all([this.profile(me), this.profile(m.other_id)]);
    const games = await this.pool.query(
      `SELECT ch.day::text AS day, count(DISTINCT k.post_id)::int AS distinct_picks
         FROM social.mixar_challenges ch JOIN social.mixar_picks k ON k.challenge_id = ch.id
        WHERE ch.mixar_id = $1 GROUP BY ch.id, ch.day HAVING count(*) = 2`,
      [id],
    );
    const label = (t: string) => ({ topic: t, label: topicLabel(t) });
    return {
      ...summary,
      createdAt: m.created_at.toISOString(),
      acceptedAt: m.accepted_at ? m.accepted_at.toISOString() : null,
      match: matchScore(pa, pb),
      common: commonTopics(pa, pb, 8).map((c) => ({ ...label(c.topic), score: c.score })),
      onlyMe: onlyOf(pa, pb, 4).map(label),
      onlyThem: onlyOf(pb, pa, 4).map(label),
      streak: streakOf(games.rows.map((r) => r.day as string), day),
      matches: games.rows.filter((r) => r.distinct_picks === 1).length,
    };
  }

  /** O Mixar com esta pessoa (ativo ou pendente), se existir. */
  async withUser(me: string, username: string): Promise<MixarDto> {
    const o = (await this.pool.query(`SELECT id FROM identity.users WHERE lower(username) = lower($1) AND status = 'active'`, [username.trim().replace(/^@/, '')])).rows[0];
    if (!o || o.id === me) throw new NotFoundException('Mixar não encontrado');
    const [a, b] = me < o.id ? [me, o.id as string] : [o.id as string, me];
    const id = await this.openBetween(a, b);
    if (!id) throw new NotFoundException('Mixar não encontrado');
    try {
      return await this.get(me, id);
    } catch (e) {
      // Com bloqueio, aqui não se diz que existe.
      if (e instanceof ForbiddenException) throw new NotFoundException('Mixar não encontrado');
      throw e;
    }
  }

  /** A seleção de hoje (gerada na hora se ainda não existe), só com o que os dois podem ver agora. */
  async feed(me: string, id: string, cursor: string | undefined, limit: number) {
    const m = await this.active(me, id);
    const day = mixarDay();
    await this.ensureDay(m, day);
    const offset = cursor && /^\d{1,3}$/.test(cursor) ? Number(cursor) : 0;
    const { rows } = await this.pool.query(
      `SELECT i.post_id, i.source, i.topic,
              (SELECT r.reaction FROM social.mixar_reactions r WHERE r.mixar_id = i.mixar_id AND r.post_id = i.post_id AND r.user_id = $1) AS mine,
              (SELECT r.reaction FROM social.mixar_reactions r WHERE r.mixar_id = i.mixar_id AND r.post_id = i.post_id AND r.user_id = $2) AS theirs,
              EXISTS (SELECT 1 FROM social.mixar_views v WHERE v.mixar_id = i.mixar_id AND v.post_id = i.post_id AND v.user_id = $2) AS seen_by_them
         FROM social.mixar_items i JOIN content.posts p ON p.id = i.post_id JOIN identity.users u ON u.id = p.author_id
        WHERE i.mixar_id = $3 AND i.day = $4::date AND ${bothSee('$1', '$2')}
        ORDER BY i.position OFFSET $5 LIMIT $6`,
      [me, m.other_id, id, day, offset, limit + 1],
    );
    const page = rows.slice(0, limit);
    const posts = new Map((await this.posts.feedPosts(me, page.map((r) => r.post_id as string))).map((p) => [p.id as string, p]));
    const meIsA = m.user_a === me;
    const items: MixarItem[] = [];
    for (const r of page) {
      const post = posts.get(r.post_id as string);
      if (!post) continue;
      items.push({
        post,
        from: this.fromFor(r.source as From, meIsA),
        topic: r.topic ? { topic: r.topic as string, label: topicLabel(r.topic as string) } : null,
        mine: (r.mine as ReactionId | null) ?? null,
        theirs: (r.theirs as ReactionId | null) ?? null,
        seenByThem: !!r.seen_by_them,
      });
    }
    return { items, nextCursor: rows.length > limit ? String(offset + limit) : null, day };
  }

  /* ───────────── reações e sinais ───────────── */

  async react(me: string, id: string, postId: string, reaction: ReactionId | null) {
    const m = await this.active(me, id);
    await this.assertItem(me, m, postId);
    if (reaction === null) await this.pool.query('DELETE FROM social.mixar_reactions WHERE mixar_id = $1 AND post_id = $2 AND user_id = $3', [id, postId, me]);
    else {
      await this.pool.query(
        `INSERT INTO social.mixar_reactions (mixar_id, post_id, user_id, reaction) VALUES ($1, $2, $3, $4)
         ON CONFLICT (mixar_id, post_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = now()`,
        [id, postId, me, reaction],
      );
    }
    const { rows } = await this.pool.query('SELECT user_id, reaction FROM social.mixar_reactions WHERE mixar_id = $1 AND post_id = $2', [id, postId]);
    const of = (u: string) => (rows.find((r) => r.user_id === u)?.reaction as ReactionId | undefined) ?? null;
    this.notify(m.other_id, me, id, 'reaction');
    return { mine: of(me), theirs: of(m.other_id) };
  }

  async seen(me: string, id: string, postId: string, watchedMs: number | undefined, done: boolean | undefined) {
    const m = await this.active(me, id);
    await this.assertItem(me, m, postId);
    await this.pool.query(
      `INSERT INTO social.mixar_views (mixar_id, post_id, user_id, watched_ms, done) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (mixar_id, post_id, user_id) DO UPDATE SET watched_ms = GREATEST(social.mixar_views.watched_ms, EXCLUDED.watched_ms),
              done = social.mixar_views.done OR EXCLUDED.done, seen_at = now()`,
      [id, postId, me, Math.max(0, Math.min(Math.round(watchedMs ?? 0), 3_600_000)), !!done],
    );
  }

  /** A app mandou este item para o chat (com o envio de sempre, kind 'post'): conta como um sinal forte. */
  async shared(me: string, id: string, postId: string) {
    const m = await this.active(me, id);
    await this.assertItem(me, m, postId);
    await this.pool.query(
      `INSERT INTO social.mixar_views (mixar_id, post_id, user_id, shared_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (mixar_id, post_id, user_id) DO UPDATE SET shared_at = now()`,
      [id, postId, me],
    );
  }

  /* ───────────── desafio ───────────── */

  async challenge(me: string, id: string): Promise<ChallengeDto | null> {
    const m = await this.active(me, id);
    const day = mixarDay();
    await this.ensureDay(m, day);
    const ch = (await this.pool.query('SELECT id, kind, day::text AS day, options FROM social.mixar_challenges WHERE mixar_id = $1 AND day = $2::date', [id, day])).rows[0];
    return ch ? this.challengeDto(me, m, ch) : null;
  }

  async pick(me: string, id: string, challengeId: string, postId: string): Promise<ChallengeDto> {
    const m = await this.active(me, id);
    const client = await this.pool.connect();
    let both = false;
    let ch: Record<string, any>;
    try {
      await client.query('BEGIN');
      ch = (await client.query('SELECT id, kind, day::text AS day, options FROM social.mixar_challenges WHERE id = $1 AND mixar_id = $2 FOR UPDATE', [challengeId, id])).rows[0];
      if (!ch) throw new NotFoundException('Desafio não encontrado');
      if (ch.day !== mixarDay()) throw new ConflictException('Este desafio já acabou');
      if (!(ch.options as string[]).includes(postId)) throw new BadRequestException('Escolhe uma das opções do desafio');
      const ok = await client.query(`SELECT 1 FROM content.posts p JOIN identity.users u ON u.id = p.author_id WHERE p.id = $3 AND ${bothSee('$1', '$2')}`, [me, m.other_id, postId]);
      if (!ok.rowCount) throw new NotFoundException('Publicação não encontrada');
      const picks = (await client.query('SELECT user_id FROM social.mixar_picks WHERE challenge_id = $1', [challengeId])).rows;
      if (picks.length >= 2) throw new ConflictException('Os dois já escolheram');
      // Enquanto o outro não escolhe, ainda se pode mudar de ideias.
      await client.query(
        `INSERT INTO social.mixar_picks (challenge_id, user_id, post_id) VALUES ($1, $2, $3)
         ON CONFLICT (challenge_id, user_id) DO UPDATE SET post_id = EXCLUDED.post_id, created_at = now()`,
        [challengeId, me, postId],
      );
      both = picks.some((p) => p.user_id === m.other_id);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    const dto = await this.challengeDto(me, m, ch);
    if (both) {
      this.notify(m.other_id, me, id, 'result');
      const body = dto.match ? 'Escolheram o mesmo!' : `Vê o que ${m.my_first} escolheu`;
      void this.push.send(m.other_id, { title: `${m.their_first} + ${m.my_first}`, body, url: `/mixar/${id}`, tag: `mixar:${id}:challenge`, category: 'messages' });
    } else this.notify(m.other_id, me, id, 'pick');
    return dto;
  }

  private async challengeDto(me: string, m: Row, ch: Record<string, any>): Promise<ChallengeDto> {
    const picks = (await this.pool.query('SELECT user_id, post_id FROM social.mixar_picks WHERE challenge_id = $1', [ch.id])).rows;
    const my = (picks.find((p) => p.user_id === me)?.post_id as string | undefined) ?? null;
    const their = (picks.find((p) => p.user_id === m.other_id)?.post_id as string | undefined) ?? null;
    const visible = (
      await this.pool.query(`SELECT p.id FROM content.posts p JOIN identity.users u ON u.id = p.author_id WHERE p.id = ANY($3::uuid[]) AND ${bothSee('$1', '$2')}`, [me, m.other_id, ch.options])
    ).rows.map((r) => r.id as string);
    const options = await this.posts.feedPosts(me, (ch.options as string[]).filter((o) => visible.includes(o)));
    const both = !!my && !!their;
    return {
      id: ch.id as string,
      kind: ch.kind as ChallengeKind,
      question: CHALLENGE_QUESTION[ch.kind as ChallengeKind],
      day: ch.day as string,
      options,
      myPick: my,
      theirPicked: !!their,
      theirPick: both ? their : null,
      match: both ? my === their : null,
    };
  }

  /* ───────────── seleção diária ───────────── */

  /**
   * A tarefa `mixar.daily` (no worker, de 15 em 15 minutos): gera a seleção de hoje de cada Mixar ativo que ainda não a tem.
   * O dia muda às 05:00 de Maputo, por isso a primeira volta depois disso trata de todos. Avisa os dois (evento 'daily', sem
   * aviso no telemóvel). Nos testes chama-se à mão, com `now`.
   */
  async runDaily(opts: { now?: Date; limit?: number } = {}): Promise<number> {
    const day = mixarDay(opts.now);
    const limit = opts.limit ?? DAILY_BATCH;
    let total = 0;
    for (let round = 0; round < 20; round++) {
      const { rows } = await this.pool.query(
        `SELECT x.id, x.user_a, x.user_b FROM social.mixars x
           JOIN identity.users a ON a.id = x.user_a AND a.status = 'active'
           JOIN identity.users b ON b.id = x.user_b AND b.status = 'active'
          WHERE x.status = 'active' AND NOT ${blockedBetween('x.user_a', 'x.user_b')}
            AND NOT EXISTS (SELECT 1 FROM social.mixar_days d WHERE d.mixar_id = x.id AND d.day = $1::date)
          ORDER BY x.id LIMIT $2`,
        [day, limit],
      );
      for (const r of rows) {
        try {
          if (await this.generate(r.id as string, r.user_a as string, r.user_b as string, day)) {
            total++;
            for (const u of [r.user_a as string, r.user_b as string]) this.events.emit(u, { type: 'mixar', id: r.id as string, what: 'daily' });
          }
        } catch (e) {
          this.log.warn(`seleção de ${r.id as string}: ${(e as Error).message}`);
        }
      }
      if (rows.length < limit) break;
    }
    return total;
  }

  /** Garante a seleção do dia (gera na hora quando falta; um dia vazio volta a tentar ao fim de uma hora). */
  private async ensureDay(m: Pick<Row, 'id' | 'user_a' | 'user_b' | 'status'>, day: string) {
    if (m.status !== 'active') return;
    const d = (await this.pool.query(`SELECT items, generated_at < now() - ${EMPTY_RETRY} AS stale FROM social.mixar_days WHERE mixar_id = $1 AND day = $2::date`, [m.id, day])).rows[0];
    if (d && !(d.items === 0 && d.stale)) return;
    await this.generate(m.id, m.user_a, m.user_b, day);
  }

  /**
   * Gera a seleção de `day` (e o desafio). Um de cada vez por Mixar (trinco na base): quem chega depois encontra-a feita.
   * Devolve true se gerou.
   */
  async generate(id: string, a: string, b: string, day: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('mixar:' || $1))`, [id]);
      const d = (await client.query(`SELECT items, generated_at < now() - ${EMPTY_RETRY} AS stale FROM social.mixar_days WHERE mixar_id = $1 AND day = $2::date`, [id, day])).rows[0];
      if (d && !(d.items === 0 && d.stale)) {
        await client.query('COMMIT');
        return false;
      }
      if (d) await client.query('DELETE FROM social.mixar_days WHERE mixar_id = $1 AND day = $2::date', [id, day]);

      const [pa, pb, pm, cands, before] = await Promise.all([
        this.profile(a),
        this.profile(b),
        this.mixarProfile(id, day),
        this.candidates(a, b),
        this.pool.query('SELECT DISTINCT post_id FROM social.mixar_items WHERE mixar_id = $1 AND day < $2::date', [id, day]),
      ]);
      const picked = pickDaily({ a: pa, b: pb, mixar: pm, candidates: cands, exclude: before.rows.map((r) => r.post_id as string), max: MAX_ITEMS, seed: `${id}:${day}` });
      for (const [i, p] of picked.entries()) {
        await client.query(
          'INSERT INTO social.mixar_items (mixar_id, day, post_id, position, source, topic, score) VALUES ($1, $2::date, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING',
          [id, day, p.postId, i, p.from, p.topic, p.score],
        );
      }
      await client.query('INSERT INTO social.mixar_days (mixar_id, day, items) VALUES ($1, $2::date, $3)', [id, day, picked.length]);
      const video = new Map(cands.map((c) => [c.id, c.video]));
      const ch = pickChallenge(picked.map((p) => ({ postId: p.postId, video: video.get(p.postId) ?? false, score: p.score, topic: p.topic })), `${id}:${day}`);
      if (ch) {
        await client.query(
          'INSERT INTO social.mixar_challenges (id, mixar_id, day, kind, options) VALUES ($1, $2, $3::date, $4, $5::uuid[]) ON CONFLICT (mixar_id, day) DO NOTHING',
          [uuidv7(), id, day, ch.kind, ch.options],
        );
      }
      await client.query('UPDATE social.mixars SET updated_at = now() WHERE id = $1', [id]);
      await client.query('COMMIT');
      return true;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** O perfil de temas de uma pessoa (o mesmo do Explorar, com as preferências por tema). */
  private async profile(userId: string): Promise<Weights> {
    const { rows } = await this.pool.query(interestSql('$1'), [userId]);
    return Object.fromEntries(rows.map((r) => [r.topic as string, Number(r.wt)]));
  }

  /**
   * O perfil do próprio Mixar: o que os dois fizeram lá dentro, com o que é mais antigo a pesar menos (7% por dia).
   * Reações (+1,5; «nah» −2), visto até ao fim (+1), saltado logo (−0,3), mandado para o chat (+2,5) e escolhido no desafio (+2).
   */
  private async mixarProfile(id: string, day: string): Promise<Weights> {
    const decay = (col: string) => `power(0.93, GREATEST(0, $2::date - (${col})::date))`;
    const { rows } = await this.pool.query(
      `SELECT topic, sum(wt) AS wt FROM (
         SELECT unnest(p.topics) AS topic, (CASE WHEN r.reaction = 'nah' THEN -2.0 ELSE 1.5 END) * ${decay('r.created_at')} AS wt
           FROM social.mixar_reactions r JOIN content.posts p ON p.id = r.post_id WHERE r.mixar_id = $1 AND p.topics IS NOT NULL
         UNION ALL
         SELECT unnest(p.topics), (CASE WHEN v.done THEN 1.0 WHEN v.watched_ms < 2000 AND v.shared_at IS NULL THEN -0.3 ELSE least(v.watched_ms, 30000) / 30000.0 * 0.5 END
                                   + CASE WHEN v.shared_at IS NOT NULL THEN 2.5 ELSE 0 END) * ${decay('v.seen_at')}
           FROM social.mixar_views v JOIN content.posts p ON p.id = v.post_id WHERE v.mixar_id = $1 AND p.topics IS NOT NULL
         UNION ALL
         SELECT unnest(p.topics), 2.0 * ${decay('ch.day')}
           FROM social.mixar_picks k JOIN social.mixar_challenges ch ON ch.id = k.challenge_id JOIN content.posts p ON p.id = k.post_id
          WHERE ch.mixar_id = $1 AND p.topics IS NOT NULL
       ) x GROUP BY topic`,
      [id, day],
    );
    return Object.fromEntries(rows.map((r) => [r.topic as string, Number(r.wt)]));
  }

  /**
   * Os candidatos: publicações dos últimos 45 dias, com foto ou vídeo, de adultos, da rede de pelo menos um dos dois (o país
   * ou quem segue), que os dois podem ver (bothSee) e que não são de nenhum dos dois. A qualidade junta as reações por
   * alcance (como o Explorar) e a frescura; o que os dois já viram no feed desce.
   */
  private async candidates(a: string, b: string): Promise<Candidate[]> {
    const { rows } = await this.pool.query(
      `SELECT p.id, p.author_id, COALESCE(p.topics, '{}') AS topics, ${tchekaPost()} AS video,
              ((SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id) + 2 * (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id)
                + 3 * (SELECT count(*) FROM content.posts r WHERE r.repost_of = p.id AND r.kind = 'repost' AND r.removed_at IS NULL) + 1)::float
                / ((SELECT count(*) FROM content.feed_impressions i WHERE i.post_id = p.id) + 20) AS eng,
              extract(epoch FROM (now() - p.created_at)) / 3600 AS age_h,
              (SELECT count(*) FROM content.feed_impressions i WHERE i.post_id = p.id AND i.user_id IN ($1, $2))::int AS seen
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id
        WHERE p.kind = 'post' AND p.created_at > now() - interval '45 days'
          AND EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.post_id = p.id)
          AND u.birth_date <= (current_date - interval '18 years')
          AND (${inMyNetwork('p.author_id', 'p.country', '$1')} OR ${inMyNetwork('p.author_id', 'p.country', '$2')})
          AND ${bothSee('$1', '$2')}
        ORDER BY p.id DESC LIMIT ${CANDIDATES}`,
      [a, b],
    );
    return rows.map((r) => {
      const eng = Math.min(1, (Number(r.eng) * 6) / 2.5);
      const fresh = Math.exp(-Number(r.age_h) / 96);
      const seen = r.seen as number;
      return {
        id: r.id as string,
        authorId: r.author_id as string,
        topics: r.topics as string[],
        video: !!r.video,
        quality: (0.5 * eng + 0.5 * fresh) * (seen >= 2 ? 0.5 : seen === 1 ? 0.8 : 1),
      };
    });
  }

  /* ───────────── ajudas ───────────── */

  private fromFor(source: From, meIsA: boolean): 'me' | 'them' | 'both' {
    if (source === 'both') return 'both';
    return (source === 'a') === meIsA ? 'me' : 'them';
  }

  /** Evento para o outro e eco para os meus outros aparelhos. */
  private notify(other: string, me: string, id: string, what: MixarEvent['what']) {
    this.events.emit(other, { type: 'mixar', id, what });
    this.events.emit(me, { type: 'mixar', id, what, self: true });
  }

  private async displayName(userId: string) {
    return ((await this.pool.query('SELECT display_name FROM identity.users WHERE id = $1', [userId])).rows[0]?.display_name as string | undefined) ?? 'Alguém';
  }

  private async activeCount(userId: string) {
    return (await this.pool.query(`SELECT count(*)::int AS n FROM social.mixars WHERE (user_a = $1 OR user_b = $1) AND status = 'active'`, [userId])).rows[0].n as number;
  }

  private async openBetween(a: string, b: string): Promise<string | null> {
    return ((await this.pool.query(`SELECT id FROM social.mixars WHERE user_a = $1 AND user_b = $2 AND status IN ('pending', 'active')`, [a, b])).rows[0]?.id as string | undefined) ?? null;
  }

  /** O Mixar `id`, se for meu: 404 se não existe ou a outra conta já não existe; 403 com bloqueio entre os dois. */
  private async row(me: string, id: string): Promise<Row> {
    const r = (
      await this.pool.query(
        `SELECT x.id, x.user_a, x.user_b, x.invited_by, x.status, x.created_at, x.accepted_at, x.updated_at,
                o.id AS other_id, o.username, o.display_name, (o.avatar_media_id IS NOT NULL) AS has_avatar, o.verified, o.verified_tier, o.status AS o_status,
                mu.display_name AS my_name, split_part(mu.display_name, ' ', 1) AS my_first, split_part(o.display_name, ' ', 1) AS their_first,
                ${blockedBetween('o.id', '$1')} AS blocked
           FROM social.mixars x
           JOIN identity.users mu ON mu.id = $1
           JOIN identity.users o ON o.id = CASE WHEN x.user_a = $1 THEN x.user_b ELSE x.user_a END
          WHERE x.id = $2 AND (x.user_a = $1 OR x.user_b = $1)`,
        [me, id],
      )
    ).rows[0];
    if (!r || r.o_status !== 'active') throw new NotFoundException('Mixar não encontrado');
    if (r.blocked) throw new ForbiddenException('Não tens acesso a este Mixar');
    return r as Row;
  }

  private async active(me: string, id: string): Promise<Row> {
    const m = await this.row(me, id);
    if (m.status === 'pending') throw new ConflictException('O Mixar ainda não foi aceite');
    if (m.status !== 'active') throw new NotFoundException('Mixar não encontrado');
    return m;
  }

  /** O item tem de ser deste Mixar (de qualquer dia) e os dois têm de o poder ver agora. */
  private async assertItem(me: string, m: Row, postId: string) {
    const ok = await this.pool.query(
      `SELECT 1 FROM content.posts p JOIN identity.users u ON u.id = p.author_id
        WHERE p.id = $3 AND EXISTS (SELECT 1 FROM social.mixar_items i WHERE i.mixar_id = $4 AND i.post_id = p.id) AND ${bothSee('$1', '$2')}`,
      [me, m.other_id, postId, m.id],
    );
    if (!ok.rowCount) throw new NotFoundException('Publicação não encontrada neste Mixar');
  }

  /** Os resumos (todos os meus, ou só `onlyId`). Os convites que recebi primeiro, depois os mais recentes. */
  private async summaries(me: string, day: string, onlyId?: string): Promise<MixarSummary[]> {
    const { rows } = await this.pool.query(
      `SELECT x.id, x.status, x.invited_by, x.updated_at,
              o.username, o.display_name, (o.avatar_media_id IS NOT NULL) AS has_avatar, o.verified, o.verified_tier,
              split_part(mu.display_name, ' ', 1) AS my_first, split_part(o.display_name, ' ', 1) AS their_first,
              (SELECT count(*) FROM social.mixar_items i JOIN content.posts p ON p.id = i.post_id AND p.removed_at IS NULL
                WHERE i.mixar_id = x.id AND i.day = $2::date
                  AND NOT EXISTS (SELECT 1 FROM social.mixar_views v WHERE v.mixar_id = x.id AND v.post_id = i.post_id AND v.user_id = $1))::int AS new_today,
              EXISTS (SELECT 1 FROM social.mixar_challenges ch WHERE ch.mixar_id = x.id AND ch.day = $2::date
                         AND NOT EXISTS (SELECT 1 FROM social.mixar_picks k WHERE k.challenge_id = ch.id AND k.user_id = $1)) AS challenge_pending
         FROM social.mixars x
         JOIN identity.users mu ON mu.id = $1
         JOIN identity.users o ON o.id = CASE WHEN x.user_a = $1 THEN x.user_b ELSE x.user_a END
        WHERE (x.user_a = $1 OR x.user_b = $1) AND x.status IN ('pending', 'active') AND o.status = 'active'
          AND NOT ${blockedBetween('o.id', '$1')} AND ($3::uuid IS NULL OR x.id = $3)
        ORDER BY (x.status = 'pending' AND x.invited_by <> $1) DESC, x.updated_at DESC
        LIMIT 100`,
      [me, day, onlyId ?? null],
    );
    return rows.map((r) => ({
      id: r.id as string,
      status: r.status as 'pending' | 'active',
      invitedByMe: r.invited_by === me,
      partner: { username: r.username as string, displayName: r.display_name as string, hasAvatar: !!r.has_avatar, ...badge(r.verified, r.verified_tier) },
      name: `${r.my_first as string} + ${r.their_first as string}`,
      newToday: r.status === 'active' ? (r.new_today as number) : 0,
      challengePending: r.status === 'active' && !!r.challenge_pending,
      updatedAt: (r.updated_at as Date).toISOString(),
    }));
  }
}
