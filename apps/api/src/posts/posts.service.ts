import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { WalletService } from '../wallet/wallet.service';

export const MAX_PHOTOS = 10;

const FEED_SQL = `
  SELECT p.id, p.body, p.location_label, p.created_at, p.kind, p.gift_amount,
         u.id AS author_id, u.username, u.display_name,
         gr.username AS gift_username, gr.display_name AS gift_display_name,
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
      `${FEED_SQL} WHERE ($2::uuid IS NULL OR p.id < $2) ORDER BY p.id DESC LIMIT $3`,
      [userId, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return { items: page.map(this.toDto), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  async getOne(userId: string, postId: string) {
    const { rows } = await this.pool.query(`${FEED_SQL} WHERE p.id = $2`, [userId, postId]);
    if (!rows[0]) throw new NotFoundException('Publicação não encontrada');
    return this.toDto(rows[0]);
  }

  async toggleCheer(userId: string, postId: string) {
    await this.assertPost(postId);
    const del = await this.pool.query('DELETE FROM content.cheers WHERE post_id = $1 AND user_id = $2', [postId, userId]);
    if (!del.rowCount) {
      await this.pool.query('INSERT INTO content.cheers (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, userId]);
    }
    const c = await this.pool.query('SELECT count(*)::int AS n FROM content.cheers WHERE post_id = $1', [postId]);
    return { cheered: !del.rowCount, cheers: c.rows[0].n };
  }

  /** Presente em Txills (fictícios): movimento no ledger + registo do presente, numa só transacção. */
  async gift(userId: string, postId: string, amount: number, key: string) {
    const { rows } = await this.pool.query('SELECT author_id FROM content.posts WHERE id = $1', [postId]);
    if (!rows[0]) throw new NotFoundException('Publicação não encontrada');
    const authorId: string = rows[0].author_id;
    if (authorId === userId) throw new UnprocessableEntityException('Não pode presentear a sua própria publicação');
    await this.wallet.ensureWallet(userId);
    await this.wallet.ensureWallet(authorId);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await this.wallet.transfer(
        { actorId: userId, fromUserId: userId, toUserId: authorId, amount, type: 'gift', idempotencyKey: key, metadata: { postId } },
        client,
      );
      if (!r.replayed) {
        await client.query(
          'INSERT INTO content.gifts (id, post_id, sender_id, recipient_id, amount, transaction_id) VALUES ($1, $2, $3, $4, $5, $6)',
          [uuidv7(), postId, userId, authorId, amount, r.transactionId],
        );
      }
      await client.query('COMMIT');
      return { transactionId: r.transactionId, replayed: r.replayed, post: await this.getOne(userId, postId) };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Presente directo a uma pessoa (Txills de demonstração). Com `publish`, cria também o post
   * "X presenteou Y" na mesma transacção: nunca há post sem pagamento nem pagamento duplicado.
   */
  async giftUser(userId: string, toUsername: string, amount: number, key: string, note: string, publish: boolean) {
    const to = await this.pool.query(`SELECT id FROM identity.users WHERE username = $1 AND status = 'active'`, [toUsername]);
    if (!to.rows[0]) throw new NotFoundException('Utilizador não encontrado');
    const toId: string = to.rows[0].id;
    await this.wallet.ensureWallet(userId);
    await this.wallet.ensureWallet(toId);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await this.wallet.transfer(
        { actorId: userId, fromUserId: userId, toUserId: toId, amount, type: 'gift', idempotencyKey: key, metadata: note ? { note } : {} },
        client,
      );
      let postId: string | null = null;
      if (publish) {
        const existing = await client.query('SELECT id FROM content.posts WHERE gift_transaction_id = $1', [r.transactionId]);
        postId = existing.rows[0]?.id ?? uuidv7();
        if (!existing.rows[0]) {
          await client.query(
            `INSERT INTO content.posts (id, author_id, body, kind, gift_recipient_id, gift_amount, gift_transaction_id)
             VALUES ($1, $2, $3, 'gift', $4, $5, $6)`,
            [postId, userId, note, toId, amount, r.transactionId],
          );
        }
      }
      await client.query('COMMIT');
      return { transactionId: r.transactionId, replayed: r.replayed, post: postId ? await this.getOne(userId, postId) : null };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  private async assertPost(postId: string) {
    const r = await this.pool.query('SELECT 1 FROM content.posts WHERE id = $1', [postId]);
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
    gift:
      r.kind === 'gift'
        ? { amount: Number(r.gift_amount), recipient: { username: r.gift_username, displayName: r.gift_display_name } }
        : null,
  });
}
