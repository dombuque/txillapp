import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { allowedBy, blockedBetween, canView } from '../social/visibility';
import { WalletService } from '../wallet/wallet.service';

export const MAX_PHOTOS = 10;

/** Como se dá um presente: discreto, mensagem privada ao destinatário, ou post no feed. */
export type GiftVisibility = 'silent' | 'private' | 'public';

const FEED_SQL = `
  SELECT p.id, p.body, p.location_label, p.created_at, p.kind, p.gift_amount, p.repost_of,
         u.id AS author_id, u.username, u.display_name,
         gr.username AS gift_username, gr.display_name AS gift_display_name,
         ${allowedBy('u', 'comments_allowed')} AS can_comment,
         ${allowedBy('u', 'gifts_allowed')} AS can_gift,
         EXISTS (SELECT 1 FROM social.follows af2 WHERE af2.follower_id = $1 AND af2.followee_id = u.id) AS author_followed,
         (SELECT count(*) FROM content.posts rp WHERE rp.repost_of = p.id AND rp.kind = 'repost')::int AS reposts,
         EXISTS (SELECT 1 FROM content.posts rp WHERE rp.repost_of = p.id AND rp.author_id = $1 AND rp.kind = 'repost' AND rp.body = '') AS reposted,
         (SELECT COALESCE(json_agg(pm.media_id ORDER BY pm.position), '[]'::json)
            FROM content.post_media pm WHERE pm.post_id = p.id) AS media_ids,
         (SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id)::int AS cheers,
         (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id)::int AS comments,
         (SELECT count(*) FROM content.gifts g WHERE g.post_id = p.id)::int AS gifts,
         EXISTS (SELECT 1 FROM content.cheers c WHERE c.post_id = p.id AND c.user_id = $1) AS cheered
    FROM content.posts p JOIN identity.users u ON u.id = p.author_id
    LEFT JOIN identity.users gr ON gr.id = p.gift_recipient_id`;

@Injectable()
export class PostsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(userId: string, body: string, locationLabel?: string, mediaIds: string[] = []) {
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
        if (ok.rows[0].n !== mediaIds.length) throw new BadRequestException('Foto inválida ou ainda não carregada');
      }
      const id = uuidv7();
      await client.query('INSERT INTO content.posts (id, author_id, body, location_label) VALUES ($1, $2, $3, $4)', [
        id, userId, body.trim(), locationLabel || null,
      ]);
      for (const [i, mediaId] of mediaIds.entries()) {
        await client.query('INSERT INTO content.post_media (post_id, media_id, position) VALUES ($1, $2, $3)', [id, mediaId, i]);
      }
      await client.query('COMMIT');
      return this.getOne(userId, id);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
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
    const ids = [...new Set(rows.map((r) => r.repost_of).filter(Boolean))] as string[];
    const originals = new Map<string, ReturnType<PostsService['toDto']>>();
    if (ids.length) {
      const o = await this.pool.query(`${FEED_SQL} WHERE p.id = ANY($2) AND ${canView()}`, [viewerId, ids]);
      for (const r of o.rows) originals.set(r.id, this.toDto(r));
    }
    return rows
      .filter((r) => !r.repost_of || originals.has(r.repost_of))
      .map((r) => ({ ...this.toDto(r), repostOf: r.repost_of ? originals.get(r.repost_of)! : null }));
  }

  /**
   * Repostar: partilha a publicação de outra pessoa no teu perfil, sozinha ou com um comentário (citação).
   * Só publicações normais de contas públicas; nunca as tuas, de bloqueados, nem reposts de reposts.
   */
  async repost(userId: string, postId: string, body = '') {
    const { rows } = await this.pool.query(
      `SELECT p.author_id, p.kind, u.is_private FROM content.posts p JOIN identity.users u ON u.id = p.author_id
        WHERE p.id = $2 AND ${canView()}`,
      [userId, postId],
    );
    const o = rows[0];
    if (!o) throw new NotFoundException('Publicação não encontrada');
    if (o.kind !== 'post') throw new BadRequestException('Só se reposta publicações normais (não reposts nem presentes)');
    if (o.author_id === userId) throw new BadRequestException('Não podes repostar a tua própria publicação 😅');
    if (o.is_private) throw new ForbiddenException('As publicações de contas privadas não podem ser repostadas 🔒');

    const text = body.trim().slice(0, 500);
    if (!text) {
      const existing = await this.pool.query(
        `SELECT id FROM content.posts WHERE author_id = $1 AND repost_of = $2 AND kind = 'repost' AND body = ''`,
        [userId, postId],
      );
      if (existing.rows[0]) return this.getOne(userId, existing.rows[0].id);
    }
    const id = uuidv7();
    await this.pool.query(`INSERT INTO content.posts (id, author_id, body, kind, repost_of) VALUES ($1, $2, $3, 'repost', $4)`, [id, userId, text, postId]);
    await this.notifications.notify({ userId: o.author_id, actorId: userId, kind: 'repost', data: { postId, repostId: id, ...(text ? { snippet: text.slice(0, 80) } : {}) } });
    return this.getOne(userId, id);
  }

  /** Desfaz o repost simples que fizeste desta publicação. */
  async unrepost(userId: string, postId: string) {
    await this.pool.query(`DELETE FROM content.posts WHERE author_id = $1 AND repost_of = $2 AND kind = 'repost' AND body = ''`, [userId, postId]);
    const c = await this.pool.query(`SELECT count(*)::int AS n FROM content.posts WHERE repost_of = $1 AND kind = 'repost'`, [postId]);
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
  async search(viewerId: string, pattern: string, limit: number) {
    const { rows } = await this.pool.query(
      `${FEED_SQL} WHERE (p.body ILIKE $2 ESCAPE '\\' OR p.location_label ILIKE $2 ESCAPE '\\') AND ${canView()}
        ORDER BY p.id DESC LIMIT $3`,
      [viewerId, pattern, limit],
    );
    return this.hydrate(viewerId, rows);
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
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id WHERE p.id = $2 AND ${canView()}`,
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
      `SELECT 1 FROM content.posts p JOIN identity.users u ON u.id = p.author_id WHERE p.id = $2 AND ${canView()}`,
      [viewerId, postId],
    );
    if (!r.rowCount) throw new NotFoundException('Publicação não encontrada');
  }

  private toDto = (r: Record<string, any>) => ({
    id: r.id,
    body: r.body,
    locationLabel: r.location_label,
    media: (r.media_ids as string[]).map((id) => ({ url: `/api/v1/media/${id}` })),
    createdAt: r.created_at,
    author: { id: r.author_id, username: r.username, displayName: r.display_name },
    cheers: r.cheers,
    comments: r.comments,
    gifts: r.gifts,
    cheered: r.cheered,
    /** Conforme as definições do autor: quem pode comentar e quem pode presentear. */
    canComment: r.can_comment,
    /** Só se presenteia quem se segue (e que aceite presentes). `authorFollowed` explica ao ecrã porque não. */
    canGift: r.can_gift && r.author_followed,
    authorFollowed: r.author_followed as boolean,
    kind: r.kind as 'post' | 'gift' | 'repost',
    reposts: r.reposts as number,
    reposted: r.reposted as boolean,
    gift:
      r.kind === 'gift'
        ? { amount: Number(r.gift_amount), recipient: { username: r.gift_username, displayName: r.gift_display_name } }
        : null,
  });
}
