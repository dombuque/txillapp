import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { badge, type Badge } from '../common/badge';
import { topicLabel } from '../common/topics';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { PostsService } from '../posts/posts.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import { Scheduler } from '../realtime/scheduler';
import { TextFilter } from '../safety/text-filter.service';
import { notReportedBy } from '../social/visibility';
import { controlCandidates, dropTopics, loadControl, maskTopic, mixarOffTopics, privateTopicsOfAll } from './mixar-controlo';
import { mixarDay, pickDaily, type From } from './mixar-pick';
import { MixarGrupoService } from './mixar-grupo.service';
import { bothSee, MixarService, seeAll, type MixarItem, type ReactionId, type Row } from './mixar.service';

/** Quantas vezes por dia se pode pedir «Mais 5» em cada Mixar, e quantos itens vêm de cada vez. */
export const MORE_PER_DAY = 3;
export const MORE_ITEMS = 5;
/** O tamanho máximo de um comentário do Mixar. */
export const COMMENT_MAX = 500;
/** A presença («está a ver contigo») vale 45 s; a app repete-a de 20 em 20 s enquanto o Mixar está aberto. */
export const PRESENCE_MS = 45_000;
/** Os comentários apagados (pelo autor ou pela moderação) apagam-se de vez ao fim de 30 dias, se não houver denúncias por decidir. */
const PURGE_DAYS = 30;

type Person = { username: string; displayName: string; hasAvatar: boolean } & Badge;

export interface MixarComment {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  author: Person;
}

export interface MixarSavedItem extends MixarItem {
  savedAt: string;
  /** Quem guardou: eu, o outro, ou os dois (entrou sozinho porque os dois reagiram). */
  savedBy: 'me' | 'them' | 'both';
  /** Mixar de grupo (0173): quem guardou, quando foi outra pessoa à mão ('both' = entrou sozinho porque a maioria reagiu). */
  savedByPerson?: Person | null;
}

/**
 * O evento em tempo real do social do Mixar (pelo RealtimeBus, o mesmo canal SSE da app). Vai para o outro do par e, como eco
 * (`self`), para os meus outros aparelhos (menos a presença, que só interessa ao outro).
 *  - 'comment': mudou a conversa do item `postId` (comentário novo ou apagado);
 *  - 'saved': mudou um guardado (`postId`, `saved`);
 *  - 'more': chegaram mais itens à seleção de hoje («Mais 5»);
 *  - 'presence': o outro abriu o Mixar ou mudou de item (`here: true`, `postId`) ou saiu (`here: false`).
 */
export interface MixarLiveEvent {
  type: 'mixar.live';
  id: string;
  what: 'comment' | 'saved' | 'more' | 'presence';
  postId?: string | null;
  here?: boolean;
  saved?: boolean;
  self?: boolean;
}

const presenceKey = (mixarId: string, userId: string) => `mixar:pres:${mixarId}:${userId}`;
const SAVED_CURSOR = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z)_([0-9a-f-]{36})$/;
const UUID = /^[0-9a-f-]{36}$/;

/**
 * O lado social do Mixar (0171, docs/mixar-contrato.md, «Social e guardados»): a conversa só dos dois em cada item, o «ver
 * juntos» (presença curta no RealtimeBus, sem guardar nada na base), o «Mais 5» quando a seleção do dia acaba e os Guardados
 * (a coleção dos dois: entra sozinho quando os dois reagem sem ser com «nah», pelo gatilho da 0171, ou à mão).
 * As regras de acesso são as do Mixar (MixarService.active / assertItem): só os dois, com o Mixar ativo, sem bloqueio, e só
 * com o que os dois podem ver agora.
 */
@Injectable()
export class MixarSocialService implements OnModuleInit {
  private readonly log = new Logger('Mixar social');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly mixar: MixarService,
    private readonly posts: PostsService,
    private readonly bus: RealtimeBus,
    private readonly scheduler: Scheduler,
    private readonly filter: TextFilter,
    private readonly grupo: MixarGrupoService,
  ) {}

  onModuleInit() {
    this.scheduler.every('mixar.social.purge', 6 * 3_600_000, () => this.purge().then(() => undefined), { firstAfterMs: 7 * 60_000 });
  }

  /** Apaga de vez os comentários apagados há mais de 30 dias (os denunciados ficam até à decisão). Devolve quantos. */
  async purge(now = new Date()): Promise<number> {
    const r = await this.pool.query(
      `DELETE FROM social.mixar_comments c WHERE c.deleted_at IS NOT NULL AND c.deleted_at < $1::timestamptz - make_interval(days => $2)
          AND NOT EXISTS (SELECT 1 FROM social.reports r WHERE r.target_type = 'mixar_comment' AND r.target_id = c.id AND r.status = 'open')`,
      [now, PURGE_DAYS],
    );
    return r.rowCount ?? 0;
  }

  /* ───────────── comentários ───────────── */

  /** A conversa de um item, da mais antiga para a mais recente (a página mais recente primeiro; `cursor` = as mais antigas). */
  async comments(me: string, id: string, postId: string, cursor: string | undefined, limit: number) {
    const m = await this.mixar.active(me, id);
    await this.mixar.assertItem(me, m, postId);
    if (cursor && !UUID.test(cursor)) throw new BadRequestException('cursor inválido');
    const { rows } = await this.pool.query(
      `SELECT c.id, c.body, c.created_at, c.user_id, u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, u.verified, u.verified_tier
         FROM social.mixar_comments c JOIN identity.users u ON u.id = c.user_id
        WHERE c.mixar_id = $2 AND c.post_id = $3 AND c.deleted_at IS NULL AND ($4::uuid IS NULL OR c.id < $4)
          AND ${notReportedBy('mixar_comment', 'c.id', '$1')}
        ORDER BY c.id DESC LIMIT $5`,
      [me, id, postId, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: page.reverse().map((r) => this.commentDto(me, r)), nextCursor: rows.length > limit ? (page[0].id as string) : null };
  }

  async comment(me: string, id: string, postId: string, text: string): Promise<MixarComment> {
    const body = text.trim();
    if (!body) throw new BadRequestException('Escreve alguma coisa');
    if (body.length > COMMENT_MAX) throw new BadRequestException(`No máximo ${COMMENT_MAX} caracteres`);
    this.filter.assertClean(body);
    const m = await this.mixar.active(me, id);
    await this.mixar.assertItem(me, m, postId);
    const cid = uuidv7();
    await this.pool.query('INSERT INTO social.mixar_comments (id, mixar_id, post_id, user_id, body) VALUES ($1, $2, $3, $4, $5)', [cid, id, postId, me, body]);
    this.live(m, me, { what: 'comment', postId });
    const r = (
      await this.pool.query(
        `SELECT c.id, c.body, c.created_at, c.user_id, u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar, u.verified, u.verified_tier
           FROM social.mixar_comments c JOIN identity.users u ON u.id = c.user_id WHERE c.id = $1`,
        [cid],
      )
    ).rows[0];
    return this.commentDto(me, r);
  }

  /** Só quem escreveu apaga (deixa de se ver para os dois). */
  async deleteComment(me: string, id: string, commentId: string) {
    const m = await this.mixar.active(me, id);
    const r = await this.pool.query(
      'UPDATE social.mixar_comments SET deleted_at = now() WHERE id = $1 AND mixar_id = $2 AND user_id = $3 AND deleted_at IS NULL RETURNING post_id',
      [commentId, id, me],
    );
    if (!r.rowCount) throw new NotFoundException('Comentário não encontrado');
    this.live(m, me, { what: 'comment', postId: r.rows[0].post_id as string });
    return { ok: true as const };
  }

  /** Para o carril: quantos comentários tem cada item e se está nos Guardados (até 50 itens de cada vez). */
  async social(me: string, id: string, postIds: string[]) {
    await this.mixar.active(me, id);
    const ids = [...new Set(postIds.filter((p) => UUID.test(p)))].slice(0, 50);
    if (!ids.length) return { items: [] as { postId: string; comments: number; saved: boolean }[] };
    const { rows } = await this.pool.query(
      `SELECT x.pid AS post_id,
              (SELECT count(*) FROM social.mixar_comments c WHERE c.mixar_id = $2 AND c.post_id = x.pid AND c.deleted_at IS NULL
                  AND ${notReportedBy('mixar_comment', 'c.id', '$1')})::int AS comments,
              EXISTS (SELECT 1 FROM social.mixar_saves s WHERE s.mixar_id = $2 AND s.post_id = x.pid AND s.removed_at IS NULL) AS saved
         FROM unnest($3::uuid[]) AS x(pid)`,
      [me, id, ids],
    );
    return { items: rows.map((r) => ({ postId: r.post_id as string, comments: r.comments as number, saved: !!r.saved })) };
  }

  /* ───────────── guardados ───────────── */

  async save(me: string, id: string, postId: string) {
    const m = await this.mixar.active(me, id);
    await this.mixar.assertItem(me, m, postId);
    // Já guardado: fica como estava (com quem o guardou primeiro). Tirado antes: volta, guardado por mim.
    await this.pool.query(
      `INSERT INTO social.mixar_saves (mixar_id, post_id, saved_by) VALUES ($1, $2, $3)
       ON CONFLICT (mixar_id, post_id) DO UPDATE SET removed_at = NULL, saved_by = $3, created_at = now() WHERE social.mixar_saves.removed_at IS NOT NULL`,
      [id, postId, me],
    );
    this.live(m, me, { what: 'saved', postId, saved: true });
    return { saved: true as const };
  }

  /** Tirar dos Guardados (qualquer um dos dois). Não volta a entrar sozinho; só se alguém o guardar à mão. */
  async unsave(me: string, id: string, postId: string) {
    const m = await this.mixar.active(me, id);
    const r = await this.pool.query('UPDATE social.mixar_saves SET removed_at = now() WHERE mixar_id = $1 AND post_id = $2 AND removed_at IS NULL', [id, postId]);
    if (r.rowCount) this.live(m, me, { what: 'saved', postId, saved: false });
    return { saved: false as const };
  }

  /** Os Guardados, do mais recente para o mais antigo, só com o que os dois podem ver agora (nada removido nem ocultado). */
  async saved(me: string, id: string, cursor: string | undefined, limit: number): Promise<{ items: MixarSavedItem[]; nextCursor: string | null }> {
    const m = await this.mixar.active(me, id);
    if (m.group_id) return this.savedGroup(me, m, cursor, limit);
    let at: string | null = null;
    let after: string | null = null;
    if (cursor) {
      const c = SAVED_CURSOR.exec(cursor);
      if (!c) throw new BadRequestException('cursor inválido');
      [, at, after] = c;
    }
    const { rows } = await this.pool.query(
      `SELECT s.post_id, s.saved_by, s.created_at,
              to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ck,
              li.source, li.topic,
              (SELECT r.reaction FROM social.mixar_reactions r WHERE r.mixar_id = s.mixar_id AND r.post_id = s.post_id AND r.user_id = $1) AS mine,
              (SELECT r.reaction FROM social.mixar_reactions r WHERE r.mixar_id = s.mixar_id AND r.post_id = s.post_id AND r.user_id = $2) AS theirs,
              EXISTS (SELECT 1 FROM social.mixar_views v WHERE v.mixar_id = s.mixar_id AND v.post_id = s.post_id AND v.user_id = $2) AS seen_by_them
         FROM social.mixar_saves s
         JOIN content.posts p ON p.id = s.post_id JOIN identity.users u ON u.id = p.author_id
         LEFT JOIN LATERAL (SELECT i.source, i.topic FROM social.mixar_items i WHERE i.mixar_id = s.mixar_id AND i.post_id = s.post_id ORDER BY i.day DESC LIMIT 1) li ON true
        WHERE s.mixar_id = $3 AND s.removed_at IS NULL AND ${bothSee('$1', '$2')}
          AND ($4::timestamptz IS NULL OR (s.created_at, s.post_id) < ($4::timestamptz, $5::uuid))
        ORDER BY s.created_at DESC, s.post_id DESC LIMIT $6`,
      [me, m.other_id, id, at, after, limit + 1],
    );
    const page = rows.slice(0, limit);
    const posts = new Map((await this.posts.feedPosts(me, page.map((r) => r.post_id as string))).map((p) => [p.id as string, p]));
    const meIsA = m.user_a === me;
    // 0172: a razão fica sem tema se o tema for privado de um dos dois ou se foi tirado deste Mixar (o item guardado fica).
    const [priv, off] = await Promise.all([privateTopicsOfAll(this.pool, [me, m.other_id]), mixarOffTopics(this.pool, id)]);
    const hidden = new Set([...priv, ...off]);
    const items: MixarSavedItem[] = [];
    for (const r of page) {
      const post = posts.get(r.post_id as string);
      if (!post) continue;
      items.push({
        post,
        from: fromFor((r.source as From | null) ?? 'both', meIsA),
        topic: maskTopic(r.topic as string | null, hidden) ? { topic: r.topic as string, label: topicLabel(r.topic as string) } : null,
        mine: (r.mine as ReactionId | null) ?? null,
        theirs: (r.theirs as ReactionId | null) ?? null,
        seenByThem: !!r.seen_by_them,
        savedAt: (r.created_at as Date).toISOString(),
        savedBy: r.saved_by === me ? 'me' : r.saved_by ? 'them' : 'both',
      });
    }
    const last = page[page.length - 1];
    return { items, nextCursor: rows.length > limit && last ? `${last.ck as string}_${last.post_id as string}` : null };
  }

  /**
   * Os Guardados de um Mixar de grupo (0173): o mesmo que no Mixar a dois, com as reações e os vistos de todos e quem guardou
   * (`savedBy` 'me', 'them' com `savedByPerson`, ou 'both' quando entrou sozinho porque a maioria reagiu).
   */
  private async savedGroup(me: string, m: Row, cursor: string | undefined, limit: number) {
    let at: string | null = null;
    let after: string | null = null;
    if (cursor) {
      const c = SAVED_CURSOR.exec(cursor);
      if (!c) throw new BadRequestException('cursor inválido');
      [, at, after] = c;
    }
    const ids = [me, ...m.others];
    const { rows } = await this.pool.query(
      `SELECT s.post_id, s.saved_by, s.created_at,
              to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ck,
              li.source, li.topic, li.fans,
              (SELECT json_agg(json_build_object('u', r.user_id, 'r', r.reaction)) FROM social.mixar_reactions r
                WHERE r.mixar_id = s.mixar_id AND r.post_id = s.post_id AND r.user_id = ANY($1::uuid[])) AS reactions,
              ARRAY(SELECT v.user_id FROM social.mixar_views v WHERE v.mixar_id = s.mixar_id AND v.post_id = s.post_id AND v.user_id = ANY($1::uuid[])) AS seen
         FROM social.mixar_saves s
         JOIN content.posts p ON p.id = s.post_id JOIN identity.users u ON u.id = p.author_id
         LEFT JOIN LATERAL (SELECT i.source, i.topic, i.fans FROM social.mixar_items i WHERE i.mixar_id = s.mixar_id AND i.post_id = s.post_id ORDER BY i.day DESC LIMIT 1) li ON true
        WHERE s.mixar_id = $2 AND s.removed_at IS NULL AND ${seeAll('$1')}
          AND ($3::timestamptz IS NULL OR (s.created_at, s.post_id) < ($3::timestamptz, $4::uuid))
        ORDER BY s.created_at DESC, s.post_id DESC LIMIT $5`,
      [ids, m.id, at, after, limit + 1],
    );
    const page = rows.slice(0, limit);
    const off = await mixarOffTopics(this.pool, m.id);
    const items = await this.grupo.items(me, m, page.map((r) => ({ ...r, topic: r.topic && off.has(r.topic as string) ? null : r.topic })));
    const byPost = new Map(page.map((r) => [r.post_id as string, r]));
    const people = new Map((m.people ?? []).map((p) => [p.id, p]));
    const out = items.map((it) => {
      const r = byPost.get(it.post.id)!;
      const by = r.saved_by as string | null;
      const who = by && by !== me ? people.get(by) : undefined;
      return {
        ...it,
        savedAt: (r.created_at as Date).toISOString(),
        savedBy: (by === me ? 'me' : by ? 'them' : 'both') as MixarSavedItem['savedBy'],
        savedByPerson: who ? { username: who.username, displayName: who.displayName, hasAvatar: who.hasAvatar, verified: who.verified, verifiedTier: who.verifiedTier } : null,
      };
    });
    const last = page[page.length - 1];
    return { items: out, nextCursor: rows.length > limit && last ? `${last.ck as string}_${last.post_id as string}` : null };
  }

  /* ───────────── «Mais 5» ───────────── */

  async moreLeft(me: string, id: string) {
    await this.mixar.active(me, id);
    const d = (await this.pool.query('SELECT more_rounds FROM social.mixar_days WHERE mixar_id = $1 AND day = $2::date', [id, mixarDay()])).rows[0];
    return { left: Math.max(0, MORE_PER_DAY - ((d?.more_rounds as number | undefined) ?? 0)) };
  }

  /**
   * Mais até 5 itens no fim da seleção de hoje, com o mesmo algoritmo (pickDaily) e sem repetir nada do que já saiu neste
   * Mixar (em dia nenhum). No máximo 3 vezes por dia (429 depois); quando não há nada novo devolve `added: 0` e não conta.
   * O desafio do dia não muda.
   */
  async more(me: string, id: string): Promise<{ added: number; left: number }> {
    const m = await this.mixar.active(me, id);
    const day = mixarDay();
    await this.mixar.ensureDay(m, day);
    const client = await this.pool.connect();
    let added = 0;
    let rounds = 0;
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('mixar:' || $1))`, [id]);
      const d = (await client.query('SELECT more_rounds FROM social.mixar_days WHERE mixar_id = $1 AND day = $2::date FOR UPDATE', [id, day])).rows[0];
      rounds = (d?.more_rounds as number | undefined) ?? 0;
      if (rounds >= MORE_PER_DAY) {
        throw new HttpException(`Já pediram mais ${MORE_PER_DAY} vezes hoje. Amanhã às 05:00 há uma seleção nova`, HttpStatus.TOO_MANY_REQUESTS);
      }
      const before = await client.query(
        `SELECT i.post_id, p.author_id, (i.day = $2::date) AS today, i.position
           FROM social.mixar_items i JOIN content.posts p ON p.id = i.post_id WHERE i.mixar_id = $1`,
        [id, day],
      );
      // No máximo 2 do mesmo autor no dia (contando com o que já lá está).
      const perAuthor = new Map<string, number>();
      let next = 0;
      for (const r of before.rows) {
        if (!r.today) continue;
        perAuthor.set(r.author_id as string, (perAuthor.get(r.author_id as string) ?? 0) + 1);
        next = Math.max(next, (r.position as number) + 1);
      }
      const exclude = before.rows.map((r) => r.post_id as string);
      const seed = `${id}:${day}:mais${rounds + 1}`;
      let picked: { postId: string; from: string; topic: string | null; score: number; fans?: string[] }[];
      if (m.group_id) {
        // Mixar de grupo (0173): a escolha com os gostos de todos os participantes (MixarGrupoService.pickFor).
        picked = (await this.grupo.pickFor(id, [me, ...m.others], day, { exclude, max: MORE_ITEMS, perAuthor: 1, seed, skipAuthors: perAuthor })).picked;
      } else {
        const [pa, pb, pm, cands, ctl] = await Promise.all([
          this.mixar.profile(m.user_a),
          this.mixar.profile(m.user_b),
          this.mixar.mixarProfile(id, day),
          this.mixar.candidates(m.user_a, m.user_b),
          loadControl(this.pool, id, m.user_a, m.user_b),
        ]);
        picked = pickDaily({
          // 0172: como na seleção do dia, sem os temas tirados e com o «Menos disto» (temas e autores) a pesar menos.
          a: dropTopics(pa, ctl.off),
          b: dropTopics(pb, ctl.off),
          mixar: dropTopics(pm, ctl.off),
          candidates: controlCandidates(cands, ctl).filter((c) => (perAuthor.get(c.authorId) ?? 0) < 2),
          exclude,
          max: MORE_ITEMS,
          perAuthor: 1,
          seed,
        });
      }
      for (const [i, p] of picked.entries()) {
        const ins = await client.query(
          'INSERT INTO social.mixar_items (mixar_id, day, post_id, position, source, topic, score, fans) VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8::uuid[]) ON CONFLICT DO NOTHING',
          [id, day, p.postId, next + i, p.from, p.topic, p.score, p.fans ?? null],
        );
        added += ins.rowCount ?? 0;
      }
      if (added) {
        rounds++;
        await client.query('UPDATE social.mixar_days SET more_rounds = $3, items = items + $4 WHERE mixar_id = $1 AND day = $2::date', [id, day, rounds, added]);
        await client.query('UPDATE social.mixars SET updated_at = now() WHERE id = $1', [id]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    if (added) this.live(m, me, { what: 'more' });
    return { added, left: Math.max(0, MORE_PER_DAY - rounds) };
  }

  /* ───────────── ver juntos ───────────── */

  /**
   * «Estou com o Mixar aberto, neste item» (a app repete de 20 em 20 s e quando muda de item; `leave` ao sair). Vale 45 s.
   * O outro recebe um evento quando chego, mudo de item ou saio (não a cada repetição). Devolve onde está o outro.
   */
  async presence(me: string, id: string, postId: string | null, leave: boolean) {
    const m = await this.mixar.active(me, id);
    const key = presenceKey(id, me);
    if (leave) {
      const was = await this.bus.getFlag(key);
      await this.bus.delFlag(key);
      if (was !== null) for (const o of m.others) this.bus.publish(o, { type: 'mixar.live', id, what: 'presence', here: false, postId: null } satisfies MixarLiveEvent);
    } else {
      if (postId) {
        const ok = await this.pool.query('SELECT 1 FROM social.mixar_items WHERE mixar_id = $1 AND post_id = $2 LIMIT 1', [id, postId]);
        if (!ok.rowCount) postId = null;
      }
      const was = await this.bus.swap(key, postId ?? '', PRESENCE_MS);
      if (was !== (postId ?? '')) for (const o of m.others) this.bus.publish(o, { type: 'mixar.live', id, what: 'presence', here: true, postId } satisfies MixarLiveEvent);
    }
    if (!m.group_id) {
      const theirs = await this.bus.getFlag(presenceKey(id, m.other_id));
      return { partner: { here: theirs !== null, postId: theirs ? theirs : null } };
    }
    // Mixar de grupo: quem mais está (pela ordem de entrada).
    const people = new Map((m.people ?? []).map((p) => [p.id, p]));
    const here: { username: string; displayName: string; hasAvatar: boolean; verified: boolean; verifiedTier?: string | null; postId: string | null }[] = [];
    for (const o of m.others) {
      const f = await this.bus.getFlag(presenceKey(id, o));
      const p = people.get(o);
      if (f !== null && p) here.push({ username: p.username, displayName: p.displayName, hasAvatar: p.hasAvatar, verified: p.verified, verifiedTier: p.verifiedTier, postId: f || null });
    }
    return { partner: { here: here.length > 0, postId: here[0]?.postId ?? null }, here };
  }

  /* ───────────── ajudas ───────────── */

  private commentDto(me: string, r: Record<string, any>): MixarComment {
    return {
      id: r.id as string,
      body: r.body as string,
      createdAt: (r.created_at as Date).toISOString(),
      mine: r.user_id === me,
      author: { username: r.username as string, displayName: r.display_name as string, hasAvatar: !!r.has_avatar, ...badge(r.verified, r.verified_tier) },
    };
  }

  /** Evento para o outro e eco para os meus outros aparelhos. */
  private live(m: Row, me: string, e: Omit<MixarLiveEvent, 'type' | 'id' | 'self'>) {
    try {
      for (const o of m.others) this.bus.publish(o, { type: 'mixar.live', id: m.id, ...e } satisfies MixarLiveEvent);
      this.bus.publish(me, { type: 'mixar.live', id: m.id, ...e, self: true } satisfies MixarLiveEvent);
    } catch (err) {
      this.log.warn(`evento do Mixar ${m.id}: ${(err as Error).message}`);
    }
  }
}

function fromFor(source: From, meIsA: boolean): 'me' | 'them' | 'both' {
  if (source === 'both') return 'both';
  return (source === 'a') === meIsA ? 'me' : 'them';
}
