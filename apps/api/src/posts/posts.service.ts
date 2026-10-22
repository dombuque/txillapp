import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { WalletService } from '../wallet/wallet.service';

const FEED_SQL = `
  SELECT p.id, p.body, p.location_label, p.media_id, p.created_at,
         u.id AS author_id, u.username, u.display_name,
         (SELECT count(*) FROM content.cheers c WHERE c.post_id = p.id)::int AS cheers,
         (SELECT count(*) FROM content.comments c WHERE c.post_id = p.id)::int AS comments,
         (SELECT count(*) FROM content.gifts g WHERE g.post_id = p.id)::int AS gifts,
         EXISTS (SELECT 1 FROM content.cheers c WHERE c.post_id = p.id AND c.user_id = $1) AS cheered
    FROM content.posts p JOIN identity.users u ON u.id = p.author_id`;

@Injectable()
export class PostsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly wallet: WalletService,
  ) {}

  async create(userId: string, body: string, locationLabel?: string, mediaId?: string) {
    if (mediaId) {
      const m = await this.pool.query(
        `SELECT 1 FROM content.media_assets WHERE id = $1 AND owner_id = $2 AND status = 'ready'`,
        [mediaId, userId],
      );
      if (!m.rowCount) throw new BadRequestException('Media inválida ou ainda não carregada');
    }
    const id = uuidv7();
    await this.pool.query(
      'INSERT INTO content.posts (id, author_id, body, location_label, media_id) VALUES ($1, $2, $3, $4, $5)',
      [id, userId, body, locationLabel ?? null, mediaId ?? null],
    );
    return this.getOne(userId, id);
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

  async listComments(postId: string) {
    await this.assertPost(postId);
    const { rows } = await this.pool.query(
      `SELECT c.id, c.body, c.created_at, u.username, u.display_name
         FROM content.comments c JOIN identity.users u ON u.id = c.author_id
        WHERE c.post_id = $1 ORDER BY c.id LIMIT 200`,
      [postId],
    );
    return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at, author: { username: r.username, displayName: r.display_name } }));
  }

  async addComment(userId: string, postId: string, body: string) {
    await this.assertPost(postId);
    await this.pool.query('INSERT INTO content.comments (id, post_id, author_id, body) VALUES ($1, $2, $3, $4)', [uuidv7(), postId, userId, body]);
    return this.listComments(postId);
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

  private async assertPost(postId: string) {
    const r = await this.pool.query('SELECT 1 FROM content.posts WHERE id = $1', [postId]);
    if (!r.rowCount) throw new NotFoundException('Publicação não encontrada');
  }

  private toDto = (r: Record<string, any>) => ({
    id: r.id,
    body: r.body,
    locationLabel: r.location_label,
    mediaUrl: r.media_id ? `/api/v1/media/${r.media_id}` : null,
    createdAt: r.created_at,
    author: { id: r.author_id, username: r.username, displayName: r.display_name },
    cheers: r.cheers,
    comments: r.comments,
    gifts: r.gifts,
    cheered: r.cheered,
  });
}
