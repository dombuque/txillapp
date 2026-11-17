import { BadRequestException, ConflictException, ForbiddenException, forwardRef, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { ChatEvents, type MixarEvent } from '../chat/chat.events';
import { pushFor } from '../chat/hidden-push';
import { badge, type Badge } from '../common/badge';
import { topicLabel } from '../common/topics';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { tchekaPost } from '../posts/feed';
import { PostsService } from '../posts/posts.service';
import { PushService, type PushPayload } from '../push/push.service';
import { RATE_STORE, type RateStore } from '../security/rate-store';
import { inMyNetwork } from '../social/visibility';
import { mixarDayStart } from './mixar-avisos.service';
import { controlCandidates, dropTopics, loadControl, maskTopic, mixarOffTopics, notOffSql, privateTopicsOfAll } from './mixar-controlo';
import { GROUP_MAX, GROUP_MIN, groupCommon, groupMatch, groupOnlyMe, pickGroupDaily, type GroupPicked } from './mixar-grupo-pick';
import { CHALLENGE_QUESTION, MAX_ITEMS, mixarDay, pickChallenge, streakOf, type Candidate, type ChallengeKind, type Weights } from './mixar-pick';
import { MixarService, seeAll, type ChallengeDto, type MixarDto, type MixarItem, type MixarSummary, type ReactionId, type Row } from './mixar.service';

type Person = { username: string; displayName: string; hasAvatar: boolean } & Badge;
/** Uma pessoa do grupo, com o id (só dentro da API). */
type PRow = Person & { id: string };
const DAY_MS = 86_400_000;
/** No máximo 3 propostas de Mixar por grupo e por pessoa em 24 horas (propor, sair, propor outra vez…). */
export const GROUP_PROPOSALS_PER_DAY = 3;
/**
 * O limite próprio de cada TxillGroup: um Mixar aberto (pendente ou ativo) de cada vez, garantido na base pelo índice único
 * `mixars_group_open_idx` (0173). Os Mixar de grupo não contam para os 20 Mixar a dois de cada pessoa (MAX_ACTIVE em
 * mixar.service.ts conta só `user_a`/`user_b`): quem já tem 20 a dois entra e propõe na mesma (0179).
 */
export const GROUP_OPEN_MAX = 1;
const DAILY_BATCH = 200;
const CANDIDATES = 600;
const EMPTY_RETRY = "interval '1 hour'";
const DAILY_NOTICE_FROM_HOUR = 8;
const DAILY_NOTICE_TO_HOUR = 21;

export const GROUP_SIZE_TEXT = `O Mixar de grupo é para grupos de ${GROUP_MIN} a ${GROUP_MAX} pessoas`;

/** O que o Mixar de grupo acrescenta ao resumo e ao Mixar (campo `group`). */
export interface MixarGroupInfo {
  groupId: string;
  groupName: string;
  /** Os participantes (quem aceitou e continua no grupo), comigo se eu estiver. */
  people: Person[];
  /** Quantas pessoas tem o grupo. */
  members: number;
  /** O meu estado: 'in' (estou), 'declined' («Agora não»), 'left' (saí) ou null (ainda não respondi). */
  myState: 'in' | 'declined' | 'left' | null;
  /** Posso entrar agora (sou do grupo, não estou e há lugar). */
  canJoin: boolean;
  /** Pendente: quantos faltam aceitar para começar (0 se já está ativo). */
  need: number;
  /** Quem propôs (pode já ter saído). */
  proposedBy: Person | null;
}
export type MixarGroupSummary = MixarSummary & { group: MixarGroupInfo };
export type MixarGroupDto = MixarDto & { group: MixarGroupInfo };
export interface MixarGroupItemInfo {
  /** Os outros participantes de quem é o gosto (sem mim). */
  fans: Person[];
  /** O item é também do meu gosto. */
  mine: boolean;
  /** É do gosto de todos os participantes. */
  everyone: boolean;
  /** As reações dos outros participantes. */
  reactions: { person: Person; reaction: ReactionId }[];
  /** Quem já viu (sem mim). */
  seenBy: Person[];
}
export interface GroupChallengeInfo {
  /** Quantos participantes já escolheram, de quantos. */
  picked: number;
  total: number;
  pickedBy: Person[];
  /** Quando todos escolheram: quantos escolheram cada opção (pela ordem das opções). Antes disso, null. */
  counts: { postId: string; n: number }[] | null;
}

const toPerson = (r: Record<string, any>): Person => ({ username: r.username as string, displayName: r.display_name as string, hasAvatar: !!r.has_avatar, ...badge(r.verified, r.verified_tier) });
const strip = (p: PRow): Person => ({ username: p.username, displayName: p.displayName, hasAvatar: p.hasAvatar, verified: p.verified, verifiedTier: p.verifiedTier } as Person);
const first = (n: string) => n.split(' ')[0] || n;

/**
 * Mixar de grupo (0173, docs/mixar-contrato.md «Mixar de grupo»): um TxillGroup de 3 a 5 pessoas junta os gostos de quem
 * aceitou. A linha é a mesma de social.mixars (com `group_id`), por isso o social, os Guardados, os temas tirados e os avisos
 * reutilizam o que já existe; aqui fica o que muda de 2 para N: propor e responder, quem participa, a seleção (mixar-grupo-pick),
 * as reações e os vistos de todos, o desafio com a contagem e os avisos para o grupo.
 * Os participantes são os que aceitaram e continuam no grupo (sair do grupo = sair do Mixar, pelo gatilho da 0173). Com menos
 * de 3, o Mixar acaba (social.mixar_group_settle).
 */
@Injectable()
export class MixarGrupoService {
  private readonly log = new Logger('MixarGrupo');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(forwardRef(() => MixarService)) private readonly mixar: MixarService,
    private readonly events: ChatEvents,
    private readonly push: PushService,
    private readonly posts: PostsService,
    @Inject(RATE_STORE) private readonly store: RateStore,
  ) {}

  /* ───────────── acesso ───────────── */

  /** Os participantes de um Mixar de grupo (aceitaram, continuam no grupo e têm a conta ativa), pela ordem de entrada. */
  async participants(mixarId: string): Promise<PRow[]> {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, u.verified, u.verified_tier
         FROM social.mixar_members mm JOIN social.mixars x ON x.id = mm.mixar_id
         JOIN social.group_members gm ON gm.group_id = x.group_id AND gm.user_id = mm.user_id
         JOIN identity.users u ON u.id = mm.user_id AND u.status = 'active'
        WHERE mm.mixar_id = $1 AND mm.state = 'in' ORDER BY mm.joined_at, u.id`,
      [mixarId],
    );
    return rows.map((r) => ({ id: r.id as string, ...toPerson(r) }));
  }

  /**
   * O Mixar de grupo `id`, se eu for do grupo (404 se não for, ou se o Mixar não for de grupo). Não exige que eu participe:
   * quem ainda não aceitou vê o convite (MixarService.active exige `my_state = 'in'`).
   */
  async row(me: string, id: string): Promise<Row> {
    const r = (
      await this.pool.query(
        `SELECT x.id, x.invited_by, x.status, x.created_at, x.accepted_at, x.updated_at, x.group_id, g.name AS group_name,
                mu.display_name AS my_name, split_part(mu.display_name, ' ', 1) AS my_first,
                (SELECT mm.state FROM social.mixar_members mm WHERE mm.mixar_id = x.id AND mm.user_id = $1) AS my_state,
                (SELECT count(*) FROM social.group_members a JOIN identity.users au ON au.id = a.user_id AND au.status = 'active' WHERE a.group_id = x.group_id)::int AS group_size
           FROM social.mixars x JOIN social.groups g ON g.id = x.group_id
           JOIN social.group_members gm ON gm.group_id = x.group_id AND gm.user_id = $1
           JOIN identity.users mu ON mu.id = $1
          WHERE x.id = $2 AND x.group_id IS NOT NULL`,
        [me, id],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Mixar não encontrado');
    const people = await this.participants(id);
    const others = people.filter((p) => p.id !== me);
    const face = others[0];
    return {
      id: r.id as string,
      user_a: '',
      user_b: '',
      invited_by: r.invited_by as string,
      status: r.status as Row['status'],
      created_at: r.created_at as Date,
      accepted_at: (r.accepted_at as Date | null) ?? null,
      updated_at: r.updated_at as Date,
      other_id: '',
      username: face?.username ?? '',
      display_name: face?.displayName ?? (r.group_name as string),
      has_avatar: face?.hasAvatar ?? false,
      verified: face?.verified ?? false,
      verified_tier: face?.verifiedTier ?? null,
      my_name: r.my_name as string,
      my_first: r.my_first as string,
      their_first: r.group_name as string,
      blocked: false,
      group_id: r.group_id as string,
      group_name: r.group_name as string,
      others: others.map((p) => p.id),
      my_state: (r.my_state as Row['my_state']) ?? null,
      people,
      group_size: r.group_size as number,
    };
  }

  /** Para o feed, as reações e o resto: tenho de estar no Mixar (403 se sou do grupo e não estou). */
  assertIn(m: Row) {
    if (m.my_state !== 'in' || !(m.people ?? []).length) throw new ForbiddenException('Ainda não entraste neste Mixar do grupo');
  }

  /** O id do Mixar aberto (pendente ou ativo) de um grupo, ou null. */
  async openOf(groupId: string): Promise<string | null> {
    return ((await this.pool.query(`SELECT id FROM social.mixars WHERE group_id = $1 AND status IN ('pending', 'active')`, [groupId])).rows[0]?.id as string | undefined) ?? null;
  }

  /* ───────────── propor e responder ───────────── */

  /**
   * Qualquer membro de um grupo de 3 a 5 pessoas propõe o Mixar do grupo (entra logo). 404 se não sou do grupo; 409 com o
   * tamanho errado ou se já há um (com `{ id }`); 429 depois de 3 propostas no mesmo grupo em 24 horas.
   */
  async propose(me: string, groupId: string): Promise<MixarGroupDto> {
    const g = (
      await this.pool.query(
        `SELECT g.id, g.name, (SELECT count(*) FROM social.group_members a JOIN identity.users au ON au.id = a.user_id AND au.status = 'active' WHERE a.group_id = g.id)::int AS size
           FROM social.groups g JOIN social.group_members gm ON gm.group_id = g.id AND gm.user_id = $1 WHERE g.id = $2`,
        [me, groupId],
      )
    ).rows[0];
    if (!g) throw new NotFoundException('Grupo não encontrado');
    if ((g.size as number) < GROUP_MIN || (g.size as number) > GROUP_MAX) throw new ConflictException(GROUP_SIZE_TEXT);
    const open = await this.openOf(groupId);
    if (open) throw new ConflictException({ statusCode: 409, message: 'Este grupo já tem um Mixar', id: open });
    if ((await this.store.hit(`mixar:grp:${me}:${groupId}`, DAY_MS)) > GROUP_PROPOSALS_PER_DAY) {
      throw new HttpException('Já propuseste o Mixar deste grupo muitas vezes hoje. Tenta amanhã', HttpStatus.TOO_MANY_REQUESTS);
    }
    const id = uuidv7();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO social.mixars (id, group_id, invited_by) VALUES ($1, $2, $3)`, [id, groupId, me]);
      await client.query(`INSERT INTO social.mixar_members (mixar_id, user_id, state, joined_at) VALUES ($1, $2, 'in', clock_timestamp())`, [id, me]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((e as { code?: string }).code === '23505') throw new ConflictException({ statusCode: 409, message: 'Este grupo já tem um Mixar', id: await this.openOf(groupId) });
      throw e;
    } finally {
      client.release();
    }
    // O aviso aos outros membros (lista e telemóvel, categoria «Mixar») e o tempo real (a bolinha azul no grupo).
    const members = (await this.pool.query(`SELECT user_id FROM social.group_members WHERE group_id = $1 AND user_id <> $2`, [groupId, me])).rows.map((r) => r.user_id as string);
    const myName = ((await this.pool.query('SELECT display_name FROM identity.users WHERE id = $1', [me])).rows[0]?.display_name as string | undefined) ?? 'Alguém';
    for (const u of members) {
      this.events.emit(u, { type: 'mixar', id, what: 'invite' });
      await this.notice(u, me, 'mixar_group', { mixarId: id, name: g.name, groupId }, groupId, {
        title: g.name as string, body: `${first(myName)} propôs um Mixar do grupo`, url: `/mixar/${id}`, tag: `mixar:${id}`, category: 'mixar', data: { kind: 'mixar_group', mixarId: id },
      });
    }
    this.events.emit(me, { type: 'mixar', id, what: 'invite', self: true });
    return this.get(me, await this.row(me, id));
  }

  /** O Mixar aberto deste grupo (para o cabeçalho do grupo). 404 se não há ou não sou do grupo. */
  async forGroup(me: string, groupId: string): Promise<MixarGroupDto> {
    const id = await this.openOf(groupId);
    if (!id) throw new NotFoundException('Este grupo ainda não tem Mixar');
    return this.get(me, await this.row(me, id));
  }

  /** Entrar (também mais tarde, ou depois de «Agora não» ou de ter saído). Com 3 participantes, o Mixar começa. */
  async accept(me: string, m: Row): Promise<MixarGroupDto> {
    if (m.status !== 'pending' && m.status !== 'active') throw new NotFoundException('Mixar não encontrado');
    if (m.my_state === 'in') throw new ConflictException('Já estás neste Mixar');
    let started = false;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM social.mixars WHERE id = $1 FOR UPDATE', [m.id]);
      const n = (await this.participants(m.id)).length;
      if (n >= GROUP_MAX) throw new ConflictException(`Este Mixar já tem ${GROUP_MAX} pessoas`);
      await client.query(
        `INSERT INTO social.mixar_members (mixar_id, user_id, state, joined_at) VALUES ($1, $2, 'in', now())
         ON CONFLICT (mixar_id, user_id) DO UPDATE SET state = 'in', joined_at = now(), updated_at = now()`,
        [m.id, me],
      );
      if (m.status === 'pending' && n + 1 >= GROUP_MIN) {
        await client.query(`UPDATE social.mixars SET status = 'active', accepted_at = now(), updated_at = now() WHERE id = $1 AND status = 'pending'`, [m.id]);
        started = true;
      } else await client.query('UPDATE social.mixars SET updated_at = now() WHERE id = $1', [m.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    const fresh = await this.row(me, m.id);
    if (fresh.status === 'active') await this.ensureDay(fresh, mixarDay()).catch((e) => this.log.warn(`seleção de ${m.id}: ${(e as Error).message}`));
    this.notify(fresh, me, 'accepted');
    if (started) {
      for (const p of fresh.people ?? []) {
        if (p.id === me) continue;
        void this.push.send(p.id, { title: fresh.group_name ?? 'Mixar', body: 'O Mixar do grupo começou', url: `/mixar/${m.id}`, tag: `mixar:${m.id}`, category: 'mixar' });
      }
    }
    return this.get(me, fresh);
  }

  /** «Agora não»: não entro (posso entrar mais tarde). */
  async decline(me: string, m: Row) {
    if (m.status !== 'pending' && m.status !== 'active') throw new NotFoundException('Mixar não encontrado');
    if (m.my_state === 'in') throw new ConflictException('Já estás neste Mixar: para sair, sai do Mixar');
    await this.pool.query(
      `INSERT INTO social.mixar_members (mixar_id, user_id, state) VALUES ($1, $2, 'declined')
       ON CONFLICT (mixar_id, user_id) DO UPDATE SET state = 'declined', updated_at = now()`,
      [m.id, me],
    );
    // A bolinha some no grupo para mim (o convite ficou respondido).
    await this.pool.query(
      `INSERT INTO social.mixar_opens (mixar_id, user_id, opened_at) SELECT x.id, $1, GREATEST(now(), x.updated_at) FROM social.mixars x WHERE x.id = $2
       ON CONFLICT (mixar_id, user_id) DO UPDATE SET opened_at = GREATEST(social.mixar_opens.opened_at, EXCLUDED.opened_at)`,
      [me, m.id],
    );
    return { ok: true as const };
  }

  /** Sair do Mixar do grupo (continuo no grupo). Com menos de 3 participantes, acaba para todos. */
  async leave(me: string, m: Row) {
    if ((m.status !== 'pending' && m.status !== 'active') || m.my_state !== 'in') throw new NotFoundException('Mixar não encontrado');
    await this.pool.query(`UPDATE social.mixar_members SET state = 'left', updated_at = now() WHERE mixar_id = $1 AND user_id = $2`, [m.id, me]);
    await this.pool.query('SELECT social.mixar_group_settle($1)', [m.group_id]);
    await this.pool.query('UPDATE social.mixars SET updated_at = now() WHERE id = $1', [m.id]);
    this.notify(m, me, 'accepted');
    return { ok: true as const };
  }

  /* ───────────── leitura ───────────── */

  /** Os Mixar de grupo dos meus grupos (pendentes e ativos), com o que há de novo para mim. */
  async summaries(me: string, day: string, onlyId?: string): Promise<MixarGroupSummary[]> {
    const { rows } = await this.pool.query(
      `SELECT x.id, x.status, x.invited_by, x.updated_at, x.group_id, g.name AS group_name,
              (SELECT mm.state FROM social.mixar_members mm WHERE mm.mixar_id = x.id AND mm.user_id = $1) AS my_state,
              (SELECT count(*) FROM social.group_members a JOIN identity.users au ON au.id = a.user_id AND au.status = 'active' WHERE a.group_id = x.group_id)::int AS group_size,
              (SELECT count(*) FROM social.mixar_items i JOIN content.posts p ON p.id = i.post_id AND p.removed_at IS NULL AND p.hidden_at IS NULL
                WHERE i.mixar_id = x.id AND i.day = $2::date
                  AND NOT EXISTS (SELECT 1 FROM social.mixar_views v WHERE v.mixar_id = x.id AND v.post_id = i.post_id AND v.user_id = $1))::int AS new_today,
              EXISTS (SELECT 1 FROM social.mixar_challenges ch WHERE ch.mixar_id = x.id AND ch.day = $2::date
                         AND NOT EXISTS (SELECT 1 FROM social.mixar_picks k WHERE k.challenge_id = ch.id AND k.user_id = $1)) AS challenge_pending,
              (SELECT mo.opened_at FROM social.mixar_opens mo WHERE mo.mixar_id = x.id AND mo.user_id = $1) AS opened_at,
              iu.username AS by_username, iu.display_name AS by_display_name, (iu.avatar_media_id IS NOT NULL) AS by_has_avatar, iu.verified AS by_verified, iu.verified_tier AS by_verified_tier, iu.status AS by_status
         FROM social.mixars x
         JOIN social.groups g ON g.id = x.group_id
         JOIN social.group_members gm ON gm.group_id = x.group_id AND gm.user_id = $1
         LEFT JOIN identity.users iu ON iu.id = x.invited_by
        WHERE x.group_id IS NOT NULL AND x.status IN ('pending', 'active') AND ($3::uuid IS NULL OR x.id = $3)
        ORDER BY x.updated_at DESC LIMIT 50`,
      [me, day, onlyId ?? null],
    );
    const out: MixarGroupSummary[] = [];
    for (const r of rows) {
      const people = await this.participants(r.id as string);
      const myState = (r.my_state as MixarGroupInfo['myState']) ?? null;
      const inIt = myState === 'in' && people.some((p) => p.id === me);
      const others = people.filter((p) => p.id !== me);
      const by = r.by_status === 'active' ? toPerson({ username: r.by_username, display_name: r.by_display_name, has_avatar: r.by_has_avatar, verified: r.by_verified, verified_tier: r.by_verified_tier }) : null;
      const face = others[0] ? strip(others[0]) : by ?? { username: '', displayName: r.group_name as string, hasAvatar: false, ...badge(false, null) };
      out.push({
        id: r.id as string,
        status: r.status as 'pending' | 'active',
        invitedByMe: r.invited_by === me,
        partner: face,
        name: r.group_name as string,
        newToday: r.status === 'active' && inIt ? (r.new_today as number) : 0,
        challengePending: r.status === 'active' && inIt && !!r.challenge_pending,
        updatedAt: (r.updated_at as Date).toISOString(),
        openedAt: r.opened_at ? (r.opened_at as Date).toISOString() : null,
        group: {
          groupId: r.group_id as string,
          groupName: r.group_name as string,
          people: people.map(strip),
          members: r.group_size as number,
          myState: inIt ? 'in' : myState === 'in' ? 'left' : myState,
          canJoin: !inIt && people.length < GROUP_MAX,
          need: r.status === 'pending' ? Math.max(0, GROUP_MIN - people.length) : 0,
          proposedBy: by,
        },
      });
    }
    return out;
  }

  async get(me: string, m: Row): Promise<MixarGroupDto> {
    if (m.status !== 'pending' && m.status !== 'active') throw new NotFoundException('Mixar não encontrado');
    const day = mixarDay();
    const inIt = m.my_state === 'in';
    if (m.status === 'active' && inIt) await this.ensureDay(m, day);
    const [summary] = await this.summaries(me, day, m.id);
    if (!summary) throw new NotFoundException('Mixar não encontrado');
    // O cabeçalho: o match e os temas do grupo, sem os privados de cada um nem os que tiraram deste Mixar. Quem ainda não
    // entrou não vê os gostos de quem está (só o convite: quem está, quantos faltam).
    const people = inIt ? m.people ?? [] : [];
    const off = await mixarOffTopics(this.pool, m.id);
    const profiles = await Promise.all(people.map(async (p) => ({ id: p.id, w: dropTopics(await this.mixar.profile(p.id), off) })));
    const mine = profiles.find((p) => p.id === me)?.w;
    const rest = profiles.filter((p) => p.id !== me).map((p) => p.w);
    const games = await this.pool.query(
      `SELECT ch.day::text AS day, count(DISTINCT k.post_id)::int AS distinct_picks
         FROM social.mixar_challenges ch JOIN social.mixar_picks k ON k.challenge_id = ch.id
        WHERE ch.mixar_id = $1 GROUP BY ch.id, ch.day HAVING count(*) >= $2`,
      [m.id, GROUP_MIN],
    );
    const label = (t: string) => ({ topic: t, label: topicLabel(t) });
    return {
      ...summary,
      createdAt: m.created_at.toISOString(),
      acceptedAt: m.accepted_at ? m.accepted_at.toISOString() : null,
      match: groupMatch(profiles.map((p) => p.w)),
      common: groupCommon(profiles.map((p) => p.w), 8).map((c) => ({ ...label(c.topic), score: c.score })),
      onlyMe: mine && inIt ? groupOnlyMe(mine, rest, 4).map(label) : [],
      onlyThem: [],
      streak: streakOf(games.rows.map((r) => r.day as string), day),
      matches: games.rows.filter((r) => r.distinct_picks === 1).length,
    };
  }

  /** A seleção de hoje do grupo, com as reações e os vistos de todos os participantes. */
  async feed(me: string, m: Row, cursor: string | undefined, limit: number) {
    this.assertIn(m);
    const day = mixarDay();
    await this.ensureDay(m, day);
    const offset = cursor && /^\d{1,3}$/.test(cursor) ? Number(cursor) : 0;
    const ids = [me, ...m.others];
    const { rows } = await this.pool.query(
      `SELECT i.post_id, i.source, i.topic, i.fans,
              (SELECT json_agg(json_build_object('u', r.user_id, 'r', r.reaction)) FROM social.mixar_reactions r
                WHERE r.mixar_id = i.mixar_id AND r.post_id = i.post_id AND r.user_id = ANY($1::uuid[])) AS reactions,
              ARRAY(SELECT v.user_id FROM social.mixar_views v WHERE v.mixar_id = i.mixar_id AND v.post_id = i.post_id AND v.user_id = ANY($1::uuid[])) AS seen
         FROM social.mixar_items i JOIN content.posts p ON p.id = i.post_id JOIN identity.users u ON u.id = p.author_id
        WHERE i.mixar_id = $2 AND i.day = $3::date AND ${seeAll('$1')} AND ${notOffSql('i.mixar_id')}
        ORDER BY i.position OFFSET $4 LIMIT $5`,
      [ids, m.id, day, offset, limit + 1],
    );
    const page = rows.slice(0, limit);
    const items = await this.items(me, m, page);
    return { items, nextCursor: rows.length > limit ? String(offset + limit) : null, day };
  }

  /** Linhas de itens (com `post_id`, `source`, `topic`, `fans`, `reactions`, `seen`) → MixarItem com `group`. */
  async items(me: string, m: Row, page: Record<string, any>[]): Promise<(MixarItem & { group: MixarGroupItemInfo })[]> {
    const posts = new Map((await this.posts.feedPosts(me, page.map((r) => r.post_id as string))).map((p) => [p.id as string, p]));
    const people = new Map((m.people ?? []).map((p) => [p.id, p]));
    const hidden = await privateTopicsOfAll(this.pool, [me, ...m.others]);
    const out: (MixarItem & { group: MixarGroupItemInfo })[] = [];
    for (const r of page) {
      const post = posts.get(r.post_id as string);
      if (!post) continue;
      const fans = ((r.fans as string[] | null) ?? []).filter((u) => people.has(u));
      const reacts = ((r.reactions as { u: string; r: ReactionId }[] | null) ?? []);
      const mine = reacts.find((x) => x.u === me)?.r ?? null;
      const others = reacts.filter((x) => x.u !== me && people.has(x.u)).map((x) => ({ person: strip(people.get(x.u)!), reaction: x.r }));
      const seenBy = ((r.seen as string[] | null) ?? []).filter((u) => u !== me && people.has(u)).map((u) => strip(people.get(u)!));
      const iFan = fans.includes(me);
      const everyone = fans.length > 0 && [...people.keys()].every((u) => fans.includes(u));
      out.push({
        post,
        from: everyone ? 'both' : iFan && fans.length === 1 ? 'me' : iFan ? 'both' : 'them',
        topic: maskTopic(r.topic as string | null, hidden) ? { topic: r.topic as string, label: topicLabel(r.topic as string) } : null,
        mine,
        theirs: others[0]?.reaction ?? null,
        seenByThem: seenBy.length > 0,
        group: { fans: fans.filter((u) => u !== me).map((u) => strip(people.get(u)!)), mine: iFan, everyone, reactions: others, seenBy },
      });
    }
    return out;
  }

  /* ───────────── reações ───────────── */

  async react(me: string, m: Row, postId: string, reaction: ReactionId | null) {
    this.assertIn(m);
    await this.mixar.assertItem(me, m, postId);
    if (reaction === null) await this.pool.query('DELETE FROM social.mixar_reactions WHERE mixar_id = $1 AND post_id = $2 AND user_id = $3', [m.id, postId, me]);
    else {
      await this.pool.query(
        `INSERT INTO social.mixar_reactions (mixar_id, post_id, user_id, reaction) VALUES ($1, $2, $3, $4)
         ON CONFLICT (mixar_id, post_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = now()`,
        [m.id, postId, me, reaction],
      );
    }
    const { rows } = await this.pool.query('SELECT user_id, reaction FROM social.mixar_reactions WHERE mixar_id = $1 AND post_id = $2', [m.id, postId]);
    const people = new Map((m.people ?? []).map((p) => [p.id, p]));
    const reactions = rows.filter((r) => r.user_id !== me && people.has(r.user_id as string)).map((r) => ({ person: strip(people.get(r.user_id as string)!), reaction: r.reaction as ReactionId }));
    this.notify(m, me, 'reaction');
    return { mine: (rows.find((r) => r.user_id === me)?.reaction as ReactionId | undefined) ?? null, theirs: reactions[0]?.reaction ?? null, reactions };
  }

  /* ───────────── desafio ───────────── */

  async challenge(me: string, m: Row): Promise<(ChallengeDto & { group: GroupChallengeInfo }) | null> {
    this.assertIn(m);
    const day = mixarDay();
    await this.ensureDay(m, day);
    const ch = (await this.pool.query('SELECT id, kind, day::text AS day, options FROM social.mixar_challenges WHERE mixar_id = $1 AND day = $2::date', [m.id, day])).rows[0];
    return ch ? this.challengeDto(me, m, ch) : null;
  }

  /**
   * Cada participante escolhe às escondidas (e pode mudar de ideias até todos escolherem). Quando todos escolheram, abre-se
   * quantos escolheram cada opção. Avisos: «Fulano já escolheu, falta tu» a quem ainda não escolheu (uma vez por desafio) e,
   * no fim, o resultado a quem escolheu antes.
   */
  async pick(me: string, m: Row, challengeId: string, postId: string) {
    this.assertIn(m);
    const people = m.people ?? [];
    const ids = people.map((p) => p.id);
    const client = await this.pool.connect();
    let ch: Record<string, any>;
    let before: string[] = [];
    try {
      await client.query('BEGIN');
      ch = (await client.query('SELECT id, kind, day::text AS day, options FROM social.mixar_challenges WHERE id = $1 AND mixar_id = $2 FOR UPDATE', [challengeId, m.id])).rows[0];
      if (!ch) throw new NotFoundException('Desafio não encontrado');
      if (ch.day !== mixarDay()) throw new ConflictException('Este desafio já acabou');
      if (!(ch.options as string[]).includes(postId)) throw new BadRequestException('Escolhe uma das opções do desafio');
      const ok = await client.query(`SELECT 1 FROM content.posts p JOIN identity.users u ON u.id = p.author_id WHERE p.id = $2 AND ${seeAll('$1')}`, [ids, postId]);
      if (!ok.rowCount) throw new NotFoundException('Publicação não encontrada');
      const picks = (await client.query('SELECT user_id FROM social.mixar_picks WHERE challenge_id = $1 AND user_id = ANY($2::uuid[])', [challengeId, ids])).rows.map((r) => r.user_id as string);
      if (ids.every((u) => picks.includes(u))) throw new ConflictException('Já todos escolheram');
      await client.query(
        `INSERT INTO social.mixar_picks (challenge_id, user_id, post_id) VALUES ($1, $2, $3)
         ON CONFLICT (challenge_id, user_id) DO UPDATE SET post_id = EXCLUDED.post_id, created_at = now()`,
        [challengeId, me, postId],
      );
      before = picks.filter((u) => u !== me);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    const dto = await this.challengeDto(me, m, ch);
    const done = dto.group.counts !== null;
    this.notify(m, me, done ? 'result' : 'pick');
    // Avisos (lista e telemóvel, categoria «Mixar», uma vez por desafio e por pessoa).
    const url = `/mixar/${m.id}`;
    const name = m.group_name ?? 'Mixar';
    if (done) {
      await this.pool.query(`UPDATE social.notifications SET read_at = now() WHERE user_id = $1 AND kind = 'mixar_pick' AND data->>'challengeId' = $2 AND read_at IS NULL`, [me, ch.id]).catch(() => undefined);
      for (const u of before) {
        if (!(await this.claim(m.id, u, 'result', ch.id as string))) continue;
        await this.notice(u, me, 'mixar_result', { mixarId: m.id, name, challengeId: ch.id, match: !!dto.match, group: true }, m.group_id!, {
          title: name, body: dto.match ? 'Escolheram todos o mesmo' : 'Já todos escolheram. Vê o resultado', url, tag: `mixar:${m.id}:challenge`, category: 'mixar', data: { kind: 'mixar_result', mixarId: m.id },
        });
      }
    } else {
      for (const p of people) {
        if (p.id === me || before.includes(p.id)) continue;
        if (!(await this.claim(m.id, p.id, 'pick', ch.id as string))) continue;
        await this.notice(p.id, me, 'mixar_pick', { mixarId: m.id, name, challengeId: ch.id, group: true }, m.group_id!, {
          title: name, body: `${m.my_first} já escolheu no Mixa Challenge, falta tu`, url, tag: `mixar:${m.id}:challenge`, category: 'mixar', data: { kind: 'mixar_pick', mixarId: m.id },
        });
      }
    }
    return dto;
  }

  private async challengeDto(me: string, m: Row, ch: Record<string, any>): Promise<ChallengeDto & { group: GroupChallengeInfo }> {
    const people = m.people ?? [];
    const ids = people.map((p) => p.id);
    const byId = new Map(people.map((p) => [p.id, p]));
    const picks = (await this.pool.query('SELECT user_id, post_id FROM social.mixar_picks WHERE challenge_id = $1 AND user_id = ANY($2::uuid[])', [ch.id, ids])).rows;
    const my = (picks.find((p) => p.user_id === me)?.post_id as string | undefined) ?? null;
    const visible = (await this.pool.query(`SELECT p.id FROM content.posts p JOIN identity.users u ON u.id = p.author_id WHERE p.id = ANY($2::uuid[]) AND ${seeAll('$1')}`, [ids, ch.options])).rows.map((r) => r.id as string);
    const order = (ch.options as string[]).filter((o) => visible.includes(o));
    const options = await this.posts.feedPosts(me, order);
    const done = ids.length > 0 && ids.every((u) => picks.some((p) => p.user_id === u));
    const counts = done ? order.map((o) => ({ postId: o, n: picks.filter((p) => p.post_id === o).length })) : null;
    const others = picks.filter((p) => p.user_id !== me);
    return {
      id: ch.id as string,
      kind: ch.kind as ChallengeKind,
      question: CHALLENGE_QUESTION[ch.kind as ChallengeKind],
      day: ch.day as string,
      options,
      myPick: my,
      theirPicked: others.length > 0,
      theirPick: null,
      match: done ? new Set(picks.map((p) => p.post_id as string)).size === 1 : null,
      group: { picked: picks.length, total: ids.length, pickedBy: picks.map((p) => byId.get(p.user_id as string)).filter((p): p is PRow => !!p).map(strip), counts },
    };
  }

  /* ───────────── seleção ───────────── */

  async ensureDay(m: Pick<Row, 'id' | 'status' | 'group_id'>, day: string) {
    if (m.status !== 'active') return;
    const d = (await this.pool.query(`SELECT items, generated_at < now() - ${EMPTY_RETRY} AS stale FROM social.mixar_days WHERE mixar_id = $1 AND day = $2::date`, [m.id, day])).rows[0];
    if (d && !(d.items === 0 && d.stale)) return;
    await this.generate(m.id, day);
  }

  /** Os candidatos de um grupo: como no Mixar a dois (MixarService.candidates), da rede de pelo menos um e que todos podem ver. */
  async candidates(ids: string[]): Promise<Candidate[]> {
    const nets = ids.map((_, i) => inMyNetwork('p.author_id', 'p.country', `$${i + 2}`)).join(' OR ');
    const { rows } = await this.pool.query(
      `SELECT p.id, p.author_id, COALESCE(p.topics, '{}') AS topics, ${tchekaPost()} AS video,
              ((SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id) + 2 * (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id)
                + 3 * (SELECT count(*) FROM content.posts r WHERE r.repost_of = p.id AND r.kind = 'repost' AND r.removed_at IS NULL AND r.hidden_at IS NULL) + 1)::float
                / ((SELECT count(*) FROM content.feed_impressions i WHERE i.post_id = p.id) + 20) AS eng,
              extract(epoch FROM (now() - p.created_at)) / 3600 AS age_h,
              (SELECT count(*) FROM content.feed_impressions i WHERE i.post_id = p.id AND i.user_id = ANY($1::uuid[]))::int AS seen
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id
        WHERE p.kind = 'post' AND p.created_at > now() - interval '45 days'
          AND EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.post_id = p.id)
          AND u.birth_date <= (current_date - interval '18 years')
          AND (${nets})
          AND ${seeAll('$1')}
        ORDER BY p.id DESC LIMIT ${CANDIDATES}`,
      [ids, ...ids],
    );
    return rows.map((r) => {
      const eng = Math.min(1, (Number(r.eng) * 6) / 2.5);
      const fresh = Math.exp(-Number(r.age_h) / 96);
      const seen = r.seen as number;
      return { id: r.id as string, authorId: r.author_id as string, topics: r.topics as string[], video: !!r.video, quality: (0.5 * eng + 0.5 * fresh) * (seen >= 2 ? 0.5 : seen === 1 ? 0.8 : 1) };
    });
  }

  /**
   * A escolha com o controlo do Mixar (temas tirados, «Menos disto», temas privados), para a seleção do dia e para o «Mais 5».
   */
  async pickFor(mixarId: string, ids: string[], day: string, opts: { exclude: string[]; max: number; seed: string; perAuthor?: number; skipAuthors?: Map<string, number> }): Promise<{ picked: GroupPicked[]; cands: Candidate[] }> {
    const [profiles, pm, cands, ctl] = await Promise.all([
      Promise.all(ids.map(async (id) => ({ id, w: await this.mixar.profile(id) }))),
      this.mixar.mixarProfile(mixarId, day),
      this.candidates(ids),
      loadControl(this.pool, mixarId, ids[0], ids[1]),
    ]);
    const skip = opts.skipAuthors;
    const picked = pickGroupDaily({
      people: profiles.map((p) => ({ id: p.id, w: dropTopics(p.w, ctl.off) as Weights })),
      mixar: dropTopics(pm, ctl.off),
      candidates: controlCandidates(cands, ctl).filter((c) => !skip || (skip.get(c.authorId) ?? 0) < 2),
      exclude: opts.exclude,
      max: opts.max,
      seed: opts.seed,
      perAuthor: opts.perAuthor,
    });
    return { picked, cands };
  }

  /** Gera a seleção de `day` do grupo (e o desafio). Com menos de 3 participantes, o Mixar acaba em vez de gerar. */
  async generate(id: string, day: string): Promise<boolean> {
    const people = await this.participants(id);
    if (people.length < GROUP_MIN) {
      const g = (await this.pool.query('SELECT group_id FROM social.mixars WHERE id = $1', [id])).rows[0];
      if (g) await this.pool.query('SELECT social.mixar_group_settle($1)', [g.group_id]);
      return false;
    }
    const ids = people.map((p) => p.id);
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
      const before = (await client.query('SELECT DISTINCT post_id FROM social.mixar_items WHERE mixar_id = $1 AND day < $2::date', [id, day])).rows.map((r) => r.post_id as string);
      const { picked, cands } = await this.pickFor(id, ids, day, { exclude: before, max: MAX_ITEMS, seed: `${id}:${day}` });
      for (const [i, p] of picked.entries()) {
        await client.query(
          'INSERT INTO social.mixar_items (mixar_id, day, post_id, position, source, topic, score, fans) VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8::uuid[]) ON CONFLICT DO NOTHING',
          [id, day, p.postId, i, p.from, p.topic, p.score, p.fans],
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

  /** A volta da tarefa diária para os Mixar de grupo (chamada por MixarService.runDaily). Devolve quantos gerou. */
  async runDaily(day: string, limit = DAILY_BATCH): Promise<number> {
    let total = 0;
    for (let round = 0; round < 20; round++) {
      const { rows } = await this.pool.query(
        `SELECT x.id FROM social.mixars x
          WHERE x.status = 'active' AND x.group_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM social.mixar_days d WHERE d.mixar_id = x.id AND d.day = $1::date)
          ORDER BY x.id LIMIT $2`,
        [day, limit],
      );
      for (const r of rows) {
        try {
          if (await this.generate(r.id as string, day)) {
            total++;
            for (const p of await this.participants(r.id as string)) this.events.emit(p.id, { type: 'mixar', id: r.id as string, what: 'daily' });
          }
        } catch (e) {
          this.log.warn(`seleção de ${r.id as string}: ${(e as Error).message}`);
        }
      }
      if (rows.length < limit) break;
    }
    return total;
  }

  /**
   * Os avisos da seleção de hoje nos Mixar de grupo: as mesmas regras do Mixar a dois (MixarAvisosService.dailyNotices): uma
   * vez por Mixar, por pessoa e por dia, só a quem ainda não abriu, num Mixar que já estava ativo às 05:00, com a categoria
   * «Mixar» ligada e entre as 08:00 e as 21:00 de Maputo. Devolve quantos avisou.
   */
  async dailyNotices(now: Date = new Date()): Promise<number> {
    const h = (now.getUTCHours() + 2) % 24;
    if (h < DAILY_NOTICE_FROM_HOUR || h >= DAILY_NOTICE_TO_HOUR) return 0;
    const day = mixarDay(now);
    const start = mixarDayStart(day);
    const { rows } = await this.pool.query(
      `SELECT x.id, x.group_id, g.name AS group_name, mm.user_id AS me
         FROM social.mixars x
         JOIN social.groups g ON g.id = x.group_id
         JOIN social.mixar_days d ON d.mixar_id = x.id AND d.day = $1::date AND d.items > 0
         JOIN social.mixar_members mm ON mm.mixar_id = x.id AND mm.state = 'in'
         JOIN social.group_members gm ON gm.group_id = x.group_id AND gm.user_id = mm.user_id
         JOIN identity.users mu ON mu.id = mm.user_id AND mu.status = 'active'
        WHERE x.status = 'active' AND x.group_id IS NOT NULL AND x.accepted_at < $2
          AND NOT EXISTS (SELECT 1 FROM social.mixar_notices n WHERE n.mixar_id = x.id AND n.user_id = mm.user_id AND n.kind = 'daily' AND n.ref = $3)
          AND NOT EXISTS (SELECT 1 FROM social.mixar_opens o WHERE o.mixar_id = x.id AND o.user_id = mm.user_id AND o.opened_at >= $2)
          AND NOT EXISTS (SELECT 1 FROM social.notification_prefs np WHERE np.user_id = mm.user_id AND 'mixar' = ANY(np.off))
        ORDER BY x.id, mm.user_id LIMIT 2000`,
      [day, start, day],
    );
    let total = 0;
    for (const r of rows) {
      try {
        if (!(await this.claim(r.id as string, r.me as string, 'daily', day))) continue;
        // O ator: outro participante (a lista mostra «Ana e o resto do grupo: …»).
        const actor = (await this.participants(r.id as string)).find((p) => p.id !== r.me)?.id ?? (r.me as string);
        await this.notice(r.me as string, actor, 'mixar_daily', { mixarId: r.id, name: r.group_name, day, group: true }, r.group_id as string, {
          title: r.group_name as string, body: 'A vossa seleção de hoje está pronta', url: `/mixar/${r.id as string}`, tag: `mixar:${r.id as string}:daily`, category: 'mixar',
          data: { kind: 'mixar_daily', mixarId: r.id as string },
        });
        total++;
      } catch (e) {
        this.log.warn(`aviso da seleção de ${r.id as string}: ${(e as Error).message}`);
      }
    }
    return total;
  }

  /* ───────────── ajudas ───────────── */

  /** Evento para os outros participantes (e os outros membros do grupo, para a bolinha) e eco para os meus aparelhos. */
  notify(m: Row, me: string, what: MixarEvent['what']) {
    for (const u of m.others) this.events.emit(u, { type: 'mixar', id: m.id, what });
    this.events.emit(me, { type: 'mixar', id: m.id, what, self: true });
  }

  private async claim(mixarId: string, userId: string, kind: 'daily' | 'pick' | 'result', ref: string): Promise<boolean> {
    const r = await this.pool.query('INSERT INTO social.mixar_notices (mixar_id, user_id, kind, ref) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [mixarId, userId, kind, ref]);
    return !!r.rowCount;
  }

  /**
   * Um aviso na lista e no telemóvel (categoria «Mixar»: desligada, nada). No telemóvel vai discreto se a pessoa escondeu o
   * grupo (0160), como nas conversas escondidas.
   */
  private async notice(userId: string, actorId: string, kind: string, data: Record<string, unknown>, groupId: string, payload: PushPayload) {
    try {
      if ((await this.push.off(userId)).includes('mixar')) return;
      await this.pool.query('INSERT INTO social.notifications (id, user_id, actor_id, kind, data) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), userId, actorId, kind, data]);
      if (!this.push.enabled) return;
      const hidden = (await this.pool.query('SELECT hidden_at IS NOT NULL AS h FROM social.group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId])).rows[0]?.h;
      void this.push.send(userId, pushFor(payload, !!hidden)).catch(() => undefined);
    } catch (e) {
      this.log.warn(`aviso ${kind}: ${(e as Error).message}`);
    }
  }
}
