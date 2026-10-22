import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';

@Injectable()
export class StoriesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async create(userId: string, mediaId: string, caption: string) {
    const ok = await this.pool.query(
      `SELECT 1 FROM content.media_assets a
        WHERE a.id = $1 AND a.owner_id = $2 AND a.status = 'ready'
          AND NOT EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.media_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM content.stories s WHERE s.media_id = a.id)`,
      [mediaId, userId],
    );
    if (!ok.rowCount) throw new BadRequestException('Foto inválida ou ainda não carregada');
    const id = uuidv7();
    await this.pool.query('INSERT INTO content.stories (id, author_id, media_id, caption) VALUES ($1, $2, $3, $4)', [
      id, userId, mediaId, caption || null,
    ]);
    return this.getOne(userId, id);
  }

  /** Bandeja: quem tem stories activos. O próprio primeiro, depois "não vistos", depois os mais recentes. */
  async tray(userId: string) {
    const { rows } = await this.pool.query(
      `WITH active AS (
         SELECT s.id, s.author_id, s.created_at,
                EXISTS (SELECT 1 FROM content.story_views v WHERE v.story_id = s.id AND v.viewer_id = $1) AS seen
           FROM content.stories s WHERE s.expires_at > now()
       )
       SELECT u.username, u.display_name, (u.id = $1) AS is_me,
              count(*)::int AS story_count, bool_and(a.seen OR u.id = $1) AS seen, max(a.created_at) AS latest_at
         FROM active a JOIN identity.users u ON u.id = a.author_id
        GROUP BY u.id
        ORDER BY (u.id = $1) DESC, bool_and(a.seen OR u.id = $1) ASC, max(a.created_at) DESC
        LIMIT 50`,
      [userId],
    );
    return rows.map((r) => ({
      username: r.username,
      displayName: r.display_name,
      isMe: r.is_me,
      count: r.story_count,
      seen: r.seen,
      latestAt: r.latest_at,
    }));
  }

  async byUser(viewerId: string, username: string) {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.media_id, s.caption, s.created_at, s.expires_at, u.id AS author_id, u.username, u.display_name,
              EXISTS (SELECT 1 FROM content.story_views v WHERE v.story_id = s.id AND v.viewer_id = $1) AS seen,
              (SELECT count(*) FROM content.story_views v WHERE v.story_id = s.id)::int AS view_count
         FROM content.stories s JOIN identity.users u ON u.id = s.author_id
        WHERE u.username = $2 AND s.expires_at > now() ORDER BY s.id ASC`,
      [viewerId, username],
    );
    return rows.map((r) => this.toDto(r, viewerId));
  }

  async view(viewerId: string, storyId: string) {
    const s = await this.pool.query('SELECT author_id FROM content.stories WHERE id = $1 AND expires_at > now()', [storyId]);
    if (!s.rows[0]) throw new NotFoundException('Story não encontrado ou já expirou');
    if (s.rows[0].author_id === viewerId) return; // o autor não conta como visualização
    await this.pool.query('INSERT INTO content.story_views (story_id, viewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [storyId, viewerId]);
  }

  /** Só o autor vê quem viu. */
  async viewers(userId: string, storyId: string) {
    const own = await this.pool.query('SELECT 1 FROM content.stories WHERE id = $1 AND author_id = $2', [storyId, userId]);
    if (!own.rowCount) throw new NotFoundException('Story não encontrado');
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name, v.viewed_at FROM content.story_views v
         JOIN identity.users u ON u.id = v.viewer_id WHERE v.story_id = $1 ORDER BY v.viewed_at DESC LIMIT 200`,
      [storyId],
    );
    return rows.map((r) => ({ username: r.username, displayName: r.display_name, viewedAt: r.viewed_at }));
  }

  async remove(userId: string, storyId: string) {
    const r = await this.pool.query('DELETE FROM content.stories WHERE id = $1 AND author_id = $2', [storyId, userId]);
    if (!r.rowCount) throw new NotFoundException('Story não encontrado');
  }

  private async getOne(userId: string, id: string) {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.media_id, s.caption, s.created_at, s.expires_at, u.id AS author_id, u.username, u.display_name,
              false AS seen, 0 AS view_count
         FROM content.stories s JOIN identity.users u ON u.id = s.author_id WHERE s.id = $1`,
      [id],
    );
    return this.toDto(rows[0], userId);
  }

  private toDto = (r: Record<string, any>, viewerId: string) => ({
    id: r.id,
    mediaUrl: `/api/v1/media/${r.media_id}`,
    caption: r.caption,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    author: { username: r.username, displayName: r.display_name },
    seen: r.seen,
    // Só o autor vê o contador de visualizações.
    viewCount: r.author_id === viewerId ? r.view_count : null,
  });
}
