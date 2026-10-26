import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { NotificationsService, mentionableBy } from '../notifications/notifications.service';
import { allowedBy, blockedBetween, canView, listVisibleTo } from '../social/visibility';
import { SearchIndexer } from '../search/search-index';
import { extractHashtags, prefixQuery } from '../common/hashtags';
import { RANKED_SQL, decodeCursor, encodeCursor } from './feed';
import { WalletService } from '../wallet/wallet.service';

export const MAX_PHOTOS = 10;

/** Como se dá um presente: discreto, mensagem privada ao destinatário, ou post no feed. */
export type GiftVisibility = 'silent' | 'private' | 'public';

const FEED_SQL = `
  SELECT p.id, p.body, p.location_label, p.created_at, p.kind, p.gift_amount, p.repost_of,
         u.id AS author_id, u.username, u.display_name, u.verified AS author_verified,
         gr.username AS gift_username, gr.display_name AS gift_display_name,
         ${allowedBy('u', 'comments_allowed')} AS can_comment,
         ${allowedBy('u', 'gifts_allowed')} AS can_gift,
         ${listVisibleTo('u', 'reposts_visible')} AS reposts_list, ${listVisibleTo('u', 'cheers_visible')} AS cheers_list, ${listVisibleTo('u', 'gifts_visible')} AS gifts_list,
         EXISTS (SELECT 1 FROM social.follows af2 WHERE af2.follower_id = $1 AND af2.followee_id = u.id) AS author_followed,
         (SELECT count(*) FROM content.posts rp WHERE rp.repost_of = p.id AND rp.kind = 'repost' AND rp.removed_at IS NULL)::int AS reposts,
         EXISTS (SELECT 1 FROM content.posts rp WHERE rp.repost_of = p.id AND rp.author_id = $1 AND rp.kind = 'repost' AND rp.body = '' AND rp.removed_at IS NULL) AS reposted,
         (SELECT COALESCE(json_agg(json_build_object('id', pm.media_id, 'video', (ma.mime LIKE 'video/%'), 'durationMs', ma.duration_ms, 'w', ma.width, 'h', ma.height, 'tags',
                  (SELECT COALESCE(json_agg(json_build_object('username', tu.username, 'displayName', tu.display_name, 'x', t.x, 'y', t.y)), '[]'::json)
                     FROM content.photo_tags t JOIN identity.users tu ON tu.id = t.tagged_id
                    WHERE t.media_id = pm.media_id AND t.post_id = p.id AND tu.status = 'active' AND NOT ${blockedBetween('tu.id', '$1')})
                ) ORDER BY pm.position), '[]'::json)
            FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id WHERE pm.post_id = p.id) AS media,
         (SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id)::int AS cheers,
         (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id)::int AS comments,
         (SELECT count(*) FROM content.gifts g WHERE g.post_id = p.id)::int AS gifts,
         EXISTS (SELECT 1 FROM content.cheers c WHERE c.post_id = p.id AND c.user_id = $1) AS cheered
    FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
    LEFT JOIN identity.users gr ON gr.id = p.gift_recipient_id`;

export interface PhotoTag {
  username: string;
  displayName: string;
  x: number;
  y: number;
}

@Injectable()
export class PostsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
    private readonly indexer: SearchIndexer,
  ) {}

  async create(userId: string, body: string, locationLabel?: string, mediaIds: string[] = [], tags: { index: number; username: string; x: number; y: number }[] = []) {
    if (mediaIds.length > MAX_PHOTOS) throw new BadRequestException(`No máximo ${MAX_PHOTOS} fotos por publicação`);
    if (new Set(mediaIds).size !== mediaIds.length) throw new BadRequestException('Fotos repetidas');
    if (!body.trim() && mediaIds.length === 0) throw new BadRequestException('Escreve algo ou mete uma foto');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (mediaIds.length) {
        // Só fotos do próprio autor, já carregadas e ainda não usadas noutro post.
        const ok = await client.query(
          `SELECT count(*)::int AS n FROM content.media_assets a
            WHERE a.id = ANY($1) AND a.owner_id = $2 AND a.status = 'ready'
              AND NOT EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.media_id = a.id)`,
          [mediaIds, userId],
        );
        if (ok.rows[0].n !== mediaIds.length) throw new BadRequestException('Ficheiro inválido ou ainda não processado');
        const vids = await client.query(`SELECT count(*)::int AS n FROM content.media_assets WHERE id = ANY($1) AND mime LIKE 'video/%'`, [mediaIds]);
        // Um vídeo por publicação, sozinho (sem fotos misturadas).
        if (vids.rows[0].n > 0 && mediaIds.length !== 1) throw new BadRequestException('Uma publicação com vídeo tem só esse vídeo');
      }
      const id = uuidv7();
      await client.query('INSERT INTO content.posts (id, author_id, body, location_label) VALUES ($1, $2, $3, $4)', [
        id, userId, body.trim(), locationLabel || null,
      ]);
      for (const tag of extractHashtags(body)) {
        await client.query('INSERT INTO content.post_tags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, tag]);
      }
      for (const [i, mediaId] of mediaIds.entries()) {
        await client.query('INSERT INTO content.post_media (post_id, media_id, position) VALUES ($1, $2, $3)', [id, mediaId, i]);
      }
      // Identificações: só quem eu posso mencionar (mesma regra das @menções) e que consegue ver a minha conta.
      const tagged: string[] = [];
      for (const t of tags) {
        if (!mediaIds[t.index]) throw new BadRequestException('Identificação numa foto que não existe');
        const who = await client.query(
          `SELECT u.id FROM identity.users u, identity.users au
            WHERE au.id = $1 AND lower(u.username) = lower($2) AND ${mentionableBy('u', '$1')} AND ${canView('au', 'u.id')}`,
          [userId, t.username],
        );
        if (!who.rows[0]) throw new BadRequestException(`Não podes identificar @${t.username}`);
        const ins = await client.query(
          'INSERT INTO content.photo_tags (id, post_id, media_id, tagged_id, x, y) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
          [uuidv7(), id, mediaIds[t.index], who.rows[0].id, t.x, t.y],
        );
        if (ins.rowCount && !tagged.includes(who.rows[0].id)) tagged.push(who.rows[0].id);
      }
      await client.query('COMMIT');
      this.indexer.postChanged(id);
      for (const tid of tagged) void this.notifications.notify({ userId: tid, actorId: userId, kind: 'tag', data: { postId: id } });
      void this.notifications.notifyMentions(userId, body, { postId: id, snippet: body.trim().slice(0, 80) });
      return this.getOne(userId, id);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Quem repostou, brindou ou presenteou: só se o dono permitir (definições) e só pessoas que este espectador pode ver. */
  async people(viewerId: string, postId: string, kind: 'reposts' | 'cheers' | 'gifts') {
    const col = { reposts: 'reposts_visible', cheers: 'cheers_visible', gifts: 'gifts_visible' }[kind];
    const post = await this.pool.query(
      `SELECT ${listVisibleTo('u', col)} AS allowed FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
        WHERE p.id = $2 AND ${canView('u')}`,
      [viewerId, postId],
    );
    if (!post.rows[0]) throw new NotFoundException('Publicação não encontrada');
    if (!post.rows[0].allowed) throw new ForbiddenException('O dono desta publicação não mostra esta lista');
    const source = {
      reposts: `SELECT rp.author_id AS who, rp.created_at AS at FROM content.posts rp WHERE rp.repost_of = $2 AND rp.kind = 'repost' AND rp.removed_at IS NULL`,
      cheers: `SELECT c.user_id AS who, c.created_at AS at FROM content.cheers c WHERE c.post_id = $2`,
      gifts: `SELECT g.sender_id AS who, max(g.created_at) AS at FROM content.gifts g WHERE g.post_id = $2 GROUP BY g.sender_id`,
    }[kind];
    const { rows } = await this.pool.query(
      `SELECT a.username, a.display_name, (a.avatar_media_id IS NOT NULL) AS has_avatar, a.verified, s.at
         FROM (${source}) s JOIN identity.users a ON a.id = s.who
        WHERE ${canView('a')} ORDER BY s.at DESC LIMIT 100`,
      [viewerId, postId],
    );
    return rows.map((r) => ({ username: r.username, displayName: r.display_name, hasAvatar: r.has_avatar, verified: r.verified, at: r.at }));
  }

  /** Apagar a própria publicação: fica escondida para todos (reposts dela também deixam de aparecer). */
  async removeOwn(userId: string, postId: string) {
    const r = await this.pool.query(
      `UPDATE content.posts SET removed_at = now(), removed_by = 'author' WHERE id = $1 AND author_id = $2 AND removed_at IS NULL`,
      [postId, userId],
    );
    if (!r.rowCount) throw new NotFoundException('Publicação não encontrada');
    this.indexer.postRemoved(postId);
  }

  /** Quem foi identificado pode tirar a sua identificação de uma publicação. */
  async untagMe(userId: string, postId: string) {
    await this.pool.query('DELETE FROM content.photo_tags WHERE post_id = $1 AND tagged_id = $2', [postId, userId]);
    return this.getOne(userId, postId);
  }

  /**
   * Feed por relevância (ver feed.ts). Cada página traz até `limit` publicações; `nextCursor` continua a mesma sessão.
   * Cada item leva `feed`: de onde vem ("following", "self", "discover") e se já foi visto numa sessão anterior.
   */
  async rankedFeed(userId: string, token: string | undefined, limit: number, mode: 'feed' | 'reels' = 'feed') {
    const cur = decodeCursor(token);
    const session = cur?.t ?? new Date().toISOString();
    const bucket = String(Math.floor(Date.parse(session) / 1_800_000)); // variedade estável durante ~30 min
    const { rows: ranked } = await this.pool.query(RANKED_SQL, [userId, session, bucket, cur?.s ?? null, cur?.id ?? null, limit + 1, mode === 'reels', mode === 'reels' ? -0.1 : -0.6]);
    const page = ranked.slice(0, limit);
    const meta = new Map(page.map((r) => [r.id as string, { source: r.source as 'following' | 'self' | 'discover', seen: r.seen as boolean }]));
    let items: Awaited<ReturnType<PostsService['hydrate']>> = [];
    if (page.length) {
      const { rows } = await this.pool.query(`${FEED_SQL} WHERE p.id = ANY($2) AND ${canView()}`, [userId, page.map((r) => r.id)]);
      const order = new Map(page.map((r, i) => [r.id as string, i]));
      rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      items = await this.hydrate(userId, rows);
    }
    const last = page[page.length - 1];
    return {
      items: items.map((i) => ({ ...i, feed: meta.get(i.id) ?? { source: 'following' as const, seen: false } })),
      nextCursor: ranked.length > limit && last ? encodeCursor({ s: last.score, id: last.id, t: session }) : null,
    };
  }

  /** O telemóvel avisa que estas publicações apareceram no ecrã: na próxima sessão descem para dar lugar a novidades. */
  async markSeen(userId: string, ids: string[]) {
    if (!ids.length) return;
    await this.pool.query(
      `INSERT INTO content.feed_impressions (user_id, post_id, seen_at)
       SELECT $1, p.id, now() FROM content.posts p WHERE p.id = ANY($2::uuid[])
       ON CONFLICT (user_id, post_id) DO UPDATE SET seen_at = now()`,
      [userId, ids],
    );
  }

  /** "Não me interessa": esta publicação não volta a aparecer no feed. */
  async hideFromFeed(userId: string, postId: string) {
    const r = await this.pool.query(
      `INSERT INTO content.feed_impressions (user_id, post_id, hidden) SELECT $1, p.id, true FROM content.posts p WHERE p.id = $2
       ON CONFLICT (user_id, post_id) DO UPDATE SET hidden = true, seen_at = now()`,
      [userId, postId],
    );
    if (!r.rowCount) throw new NotFoundException('Publicação não encontrada');
  }

  /** Feed global (MVP) com paginação por cursor: ids UUIDv7 são ordenáveis no tempo. */
  async feed(userId: string, cursor: string | undefined, limit: number) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const { rows } = await this.pool.query(
      `${FEED_SQL} WHERE ($2::uuid IS NULL OR p.id < $2) AND ${canView()} ORDER BY p.id DESC LIMIT $3`,
      [userId, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: await this.hydrate(userId, page), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  /**
   * Junta, a cada repost, a publicação original (só se o espectador ainda a pode ver: se o autor passou a privado,
   * bloqueou ou eliminou a conta, o repost desaparece com ela).
   */
  private async hydrate(viewerId: string, rows: Record<string, any>[]) {
    const load = async (ids: (string | null)[]) => {
      const found = new Map<string, Record<string, any>>();
      const unique = [...new Set(ids.filter(Boolean))] as string[];
      if (unique.length) {
        const o = await this.pool.query(`${FEED_SQL} WHERE p.id = ANY($2) AND ${canView()}`, [viewerId, unique]);
        for (const r of o.rows) found.set(r.id, r);
      }
      return found;
    };
    // Até dois níveis: um repost simples de uma citação mostra a citação e, dentro, o original.
    const first = await load(rows.map((r) => r.repost_of));
    const second = await load([...first.values()].map((r) => r.repost_of));
    return rows
      .filter((r) => {
        if (!r.repost_of) return true;
        const l1 = first.get(r.repost_of);
        return !!l1 && (!l1.repost_of || second.has(l1.repost_of));
      })
      .map((r) => {
        const l1 = r.repost_of ? first.get(r.repost_of)! : null;
        const inner = l1?.repost_of ? { ...this.toDto(second.get(l1.repost_of)!), repostOf: null } : null;
        return { ...this.toDto(r), repostOf: l1 ? { ...this.toDto(l1), repostOf: inner } : null };
      });
  }

  /**
   * Repostar: partilha a publicação de outra pessoa no teu perfil, sozinha ou com um comentário (citação).
   * Só publicações normais de contas públicas; nunca as tuas, de bloqueados, nem reposts de reposts.
   */
  async repost(userId: string, postId: string, body = '') {
    const { rows } = await this.pool.query(
      `SELECT p.author_id, p.kind, p.body, u.is_private FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
        WHERE p.id = $2 AND ${canView()}`,
      [userId, postId],
    );
    const o = rows[0];
    if (!o) throw new NotFoundException('Publicação não encontrada');
    // Reposta-se publicações normais e citações (como no X); um repost simples já mostra o original, repostas esse.
    if (!(o.kind === 'post' || (o.kind === 'repost' && o.body))) throw new BadRequestException('Só se reposta publicações normais e citações (não reposts simples nem presentes)');
    // O dono também pode repostar a sua própria publicação (como no X). Contas privadas não se repostam, nem a própria.
    if (o.is_private) throw new ForbiddenException('As publicações de contas privadas não podem ser repostadas 🔒');

    const text = body.trim().slice(0, 500);
    if (!text) {
      const existing = await this.pool.query(
        `SELECT id FROM content.posts WHERE author_id = $1 AND repost_of = $2 AND kind = 'repost' AND body = '' AND removed_at IS NULL`,
        [userId, postId],
      );
      if (existing.rows[0]) return this.getOne(userId, existing.rows[0].id);
    }
    const id = uuidv7();
    await this.pool.query(`INSERT INTO content.posts (id, author_id, body, kind, repost_of) VALUES ($1, $2, $3, 'repost', $4)`, [id, userId, text, postId]);
    await this.notifications.notify({ userId: o.author_id, actorId: userId, kind: 'repost', data: { postId, repostId: id, ...(text ? { snippet: text.slice(0, 80) } : {}) } });
    for (const tag of extractHashtags(text)) await this.pool.query('INSERT INTO content.post_tags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, tag]);
    if (text) this.indexer.postChanged(id);
    if (text) void this.notifications.notifyMentions(userId, text, { postId: id, snippet: text.slice(0, 80) });
    return this.getOne(userId, id);
  }

  /** Desfaz o repost simples que fizeste desta publicação. */
  async unrepost(userId: string, postId: string) {
    await this.pool.query(`DELETE FROM content.posts WHERE author_id = $1 AND repost_of = $2 AND kind = 'repost' AND body = ''`, [userId, postId]);
    const c = await this.pool.query(`SELECT count(*)::int AS n FROM content.posts WHERE repost_of = $1 AND kind = 'repost' AND removed_at IS NULL`, [postId]);
    return { reposted: false, reposts: c.rows[0].n as number };
  }

  /** Publicações de uma pessoa (perfil), com o mesmo formato do feed. */
  async byAuthor(viewerId: string, username: string, cursor: string | undefined, limit: number) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const { rows } = await this.pool.query(
      `${FEED_SQL} WHERE u.username = $2 AND ($3::uuid IS NULL OR p.id < $3) AND ${canView()} ORDER BY p.id DESC LIMIT $4`,
      [viewerId, username, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: await this.hydrate(viewerId, page), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  /** Pesquisa por texto ou local, só em publicações que o espectador pode ver. `pattern` já vem escapado para ILIKE. */
  /**
   * Publicações por texto: texto completo em português (sem acentos, por prefixo: "prai" acha "praia"),
   * ou por parte do texto / local. As mais relevantes primeiro, depois as mais recentes.
   */
  async search(viewerId: string, term: string, limit: number) {
    const q = prefixQuery(term);
    const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    const { rows } = await this.pool.query(
      `${FEED_SQL} WHERE (
            (${'$3'}::text IS NOT NULL AND to_tsvector('portuguese', content.f_unaccent(p.body)) @@ to_tsquery('portuguese', $3))
            OR p.body ILIKE $2 ESCAPE '\\' OR p.location_label ILIKE $2 ESCAPE '\\') AND ${canView()}
        ORDER BY (CASE WHEN $3::text IS NOT NULL THEN ts_rank(to_tsvector('portuguese', content.f_unaccent(p.body)), to_tsquery('portuguese', $3)) ELSE 0 END) DESC, p.id DESC
        LIMIT $4`,
      [viewerId, like, q, limit],
    );
    return this.hydrate(viewerId, rows);
  }

  /** Publicações por id (resultado do Elasticsearch), na mesma ordem, só as que quem pede pode ver. */
  async byIds(viewerId: string, ids: string[], limit: number) {
    if (!ids.length) return [];
    const { rows } = await this.pool.query(`${FEED_SQL} WHERE p.id = ANY($2::uuid[]) AND ${canView()}`, [viewerId, ids]);
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return (await this.hydrate(viewerId, rows.slice(0, limit)));
  }

  /** Publicações com uma hashtag, para quem as pode ver. `top` = as que mais reações tiveram nos últimos 7 dias. */
  async byTag(viewerId: string, tag: string, sort: 'recent' | 'top', cursor: string | undefined, limit: number) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const order =
      sort === 'top'
        ? `ORDER BY (SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id) + 2 * (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id) DESC, p.id DESC`
        : 'ORDER BY p.id DESC';
    // "top" não usa cursor por id (a ordem não é por id): mostra só as primeiras `limit`.
    const { rows } = await this.pool.query(
      `${FEED_SQL} WHERE EXISTS (SELECT 1 FROM content.post_tags t WHERE t.post_id = p.id AND t.tag = $2)
          AND ($3::uuid IS NULL OR p.id < $3) AND ${canView()} ${sort === 'top' ? "AND p.created_at > now() - interval '7 days'" : ''} ${order} LIMIT $4`,
      [viewerId, tag, sort === 'top' ? null : cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: await this.hydrate(viewerId, page), nextCursor: sort === 'recent' && rows.length > limit ? page[page.length - 1].id : null };
  }

  async getOne(userId: string, postId: string) {
    const { rows } = await this.pool.query(`${FEED_SQL} WHERE p.id = $2 AND ${canView()}`, [userId, postId]);
    const [post] = rows[0] ? await this.hydrate(userId, [rows[0]]) : [];
    if (!post) throw new NotFoundException('Publicação não encontrada');
    return post;
  }

  async toggleCheer(userId: string, postId: string) {
    await this.assertPost(userId, postId);
    const del = await this.pool.query('DELETE FROM content.cheers WHERE post_id = $1 AND user_id = $2', [postId, userId]);
    if (!del.rowCount) {
      await this.pool.query('INSERT INTO content.cheers (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, userId]);
    }
    const c = await this.pool.query('SELECT count(*)::int AS n FROM content.cheers WHERE post_id = $1', [postId]);
    return { cheered: !del.rowCount, cheers: c.rows[0].n };
  }

  /**
   * Presente numa publicação (Txills de demonstração). A pessoa escolhe como o dar:
   * `silent` (discreto, sem mensagem), `private` (mensagem só para o destinatário) ou `public` (post "X presenteou Y").
   * Mesmo depois de enviado pode publicar (ver `publishGift`).
   */
  async gift(userId: string, postId: string, amount: number, key: string, note = '', visibility: GiftVisibility = 'silent') {
    const { rows } = await this.pool.query(
      `SELECT p.author_id, ${allowedBy('u', 'gifts_allowed')} AS allowed,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS following
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL WHERE p.id = $2 AND ${canView()}`,
      [userId, postId],
    );
    if (!rows[0]) throw new NotFoundException('Publicação não encontrada');
    if (rows[0].author_id !== userId && !rows[0].following) throw new ForbiddenException('Só podes presentear quem segues 👀');
    if (!rows[0].allowed) throw new ForbiddenException('Esta pessoa não aceita presentes 🚫');
    const authorId: string = rows[0].author_id;
    if (authorId === userId) throw new UnprocessableEntityException('Não pode presentear a sua própria publicação');
    const r = await this.sendGift({ userId, toId: authorId, amount, key, note, visibility, postId });
    return {
      transactionId: r.transactionId,
      replayed: r.replayed,
      post: await this.getOne(userId, postId),
      announcement: r.announcementId ? await this.getOne(userId, r.announcementId) : null,
    };
  }

  /** Presente directo a uma pessoa, de onde quer que seja (perfil, carteira…). Mesmas escolhas de visibilidade. */
  async giftUser(userId: string, toUsername: string, amount: number, key: string, note = '', visibility: GiftVisibility = 'silent') {
    const to = await this.pool.query(
      `SELECT u.id, ${allowedBy('u', 'gifts_allowed')} AS allowed, ${blockedBetween('u.id', '$1')} AS blocked,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS following
         FROM identity.users u WHERE u.username = $2 AND u.status = 'active'`,
      [userId, toUsername],
    );
    if (!to.rows[0]) throw new NotFoundException('Utilizador não encontrado');
    if (to.rows[0].blocked) throw new ForbiddenException('Não podes presentear esta conta 🚫');
    if (to.rows[0].id !== userId && !to.rows[0].following) throw new ForbiddenException('Só podes presentear quem segues 👀');
    if (!to.rows[0].allowed) throw new ForbiddenException('Esta pessoa não aceita presentes 🚫');
    const r = await this.sendGift({ userId, toId: to.rows[0].id, amount, key, note, visibility });
    return { transactionId: r.transactionId, replayed: r.replayed, post: r.announcementId ? await this.getOne(userId, r.announcementId) : null };
  }

  /** Publicar DEPOIS: um presente já enviado pode ser anunciado no feed (só o remetente, uma única vez). */
  async publishGift(userId: string, transactionId: string, note?: string) {
    if (!/^[0-9a-f-]{36}$/.test(transactionId)) throw new BadRequestException('id inválido');
    const { rows } = await this.pool.query(
      `SELECT t.metadata, e.amount, a.user_id AS recipient_id
         FROM ledger.transactions t
         JOIN ledger.entries e ON e.transaction_id = t.id AND e.amount > 0
         JOIN ledger.accounts a ON a.id = e.account_id
        WHERE t.id = $1 AND t.actor_id = $2 AND t.type = 'gift'`,
      [transactionId, userId],
    );
    if (!rows[0]) throw new NotFoundException('Presente não encontrado');
    if ((await this.pool.query('SELECT 1 FROM content.posts WHERE gift_transaction_id = $1', [transactionId])).rowCount) {
      throw new ConflictException('Este presente já foi publicado');
    }
    const client = await this.pool.connect();
    try {
      const text = String(note ?? rows[0].metadata?.note ?? '').trim().slice(0, 280);
      const id = await this.insertGiftPost(client, userId, rows[0].recipient_id, Number(rows[0].amount), transactionId, text);
      return { post: await this.getOne(userId, id) };
    } finally {
      client.release();
    }
  }

  /** Movimento no ledger + registos associados, numa só transacção; avisa o destinatário. */
  private async sendGift(p: { userId: string; toId: string; amount: number; key: string; note: string; visibility: GiftVisibility; postId?: string }) {
    await this.wallet.ensureWallet(p.userId);
    await this.wallet.ensureWallet(p.toId);
    // Discreto = sem mensagem. Privado/público levam a mensagem (privado: só o destinatário a vê).
    const note = p.visibility === 'silent' ? '' : p.note.trim().slice(0, 280);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await this.wallet.transfer(
        {
          actorId: p.userId, fromUserId: p.userId, toUserId: p.toId, amount: p.amount, type: 'gift', idempotencyKey: p.key,
          metadata: { ...(note ? { note } : {}), ...(p.postId ? { postId: p.postId } : {}) },
        },
        client,
      );
      if (p.postId && !r.replayed) {
        await client.query(
          'INSERT INTO content.gifts (id, post_id, sender_id, recipient_id, amount, transaction_id) VALUES ($1, $2, $3, $4, $5, $6)',
          [uuidv7(), p.postId, p.userId, p.toId, p.amount, r.transactionId],
        );
      }
      const announcementId = p.visibility === 'public' ? await this.insertGiftPost(client, p.userId, p.toId, p.amount, r.transactionId, note) : null;
      await client.query('COMMIT');
      if (!r.replayed) {
        await this.notifications.notify({
          userId: p.toId, actorId: p.userId, kind: 'gift',
          data: { amount: p.amount, transactionId: r.transactionId, ...(note ? { note } : {}), ...(p.postId ? { postId: p.postId } : {}) },
        });
      }
      return { transactionId: r.transactionId, replayed: r.replayed, announcementId };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Cria (uma só vez por presente) o post "X presenteou Y". */
  private async insertGiftPost(client: PoolClient, userId: string, toId: string, amount: number, transactionId: string, note: string) {
    const existing = await client.query('SELECT id FROM content.posts WHERE gift_transaction_id = $1', [transactionId]);
    if (existing.rows[0]) return existing.rows[0].id as string;
    const id = uuidv7();
    await client.query(
      `INSERT INTO content.posts (id, author_id, body, kind, gift_recipient_id, gift_amount, gift_transaction_id)
       VALUES ($1, $2, $3, 'gift', $4, $5, $6)`,
      [id, userId, note, toId, amount, transactionId],
    );
    return id;
  }

  private async assertPost(viewerId: string, postId: string) {
    const r = await this.pool.query(
      `SELECT 1 FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL WHERE p.id = $2 AND ${canView()}`,
      [viewerId, postId],
    );
    if (!r.rowCount) throw new NotFoundException('Publicação não encontrada');
  }

  private toDto = (r: Record<string, any>) => ({
    id: r.id,
    body: r.body,
    locationLabel: r.location_label,
    media: (r.media as { id: string; video: boolean; durationMs: number | null; w: number | null; h: number | null; tags: PhotoTag[] }[]).map((m) => ({
      url: `/api/v1/media/${m.id}`,
      tags: m.tags,
      kind: (m.video ? 'video' : 'image') as 'video' | 'image',
      // Vídeos: capa, duração e proporção (para reservar o espaço antes de carregar).
      ...(m.video ? { posterUrl: `/api/v1/media/${m.id}?poster=1`, durationMs: m.durationMs, width: m.w, height: m.h } : {}),
    })),
    createdAt: r.created_at,
    author: { id: r.author_id, username: r.username, displayName: r.display_name, verified: r.author_verified as boolean },
    cheers: r.cheers,
    comments: r.comments,
    gifts: r.gifts,
    cheered: r.cheered,
    /** Conforme as definições do autor: quem pode comentar e quem pode presentear. */
    canComment: r.can_comment,
    /** Só se presenteia quem se segue (e que aceite presentes). `authorFollowed` explica ao ecrã porque não. */
    canGift: r.can_gift && r.author_followed,
    authorFollowed: r.author_followed as boolean,
    /** O dono deixa este espectador ver QUEM repostou / brindou / presenteou? (os números são sempre públicos) */
    lists: { reposts: r.reposts_list as boolean, cheers: r.cheers_list as boolean, gifts: r.gifts_list as boolean },
    kind: r.kind as 'post' | 'gift' | 'repost',
    reposts: r.reposts as number,
    reposted: r.reposted as boolean,
    gift:
      r.kind === 'gift'
        ? { amount: Number(r.gift_amount), recipient: { username: r.gift_username, displayName: r.gift_display_name } }
        : null,
  });
}
