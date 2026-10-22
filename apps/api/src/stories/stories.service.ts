import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { canView } from '../social/visibility';

/** O autor escondeu os stories a este espectador? */
const notHidden = (author: string, viewer = '$1') =>
  `NOT EXISTS (SELECT 1 FROM social.story_hidden h WHERE h.owner_id = ${author} AND h.hidden_id = ${viewer})`;

const REACTIONS = new Set(['😂', '😮', '😍', '😢', '👏', '🔥', '🍻']);

@Injectable()
export class StoriesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly notifications: NotificationsService,
  ) {}

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

  /** Bandeja: stories activos de quem sigo (e os meus). O próprio primeiro, depois "não vistos", depois os mais recentes. */
  async tray(userId: string) {
    const { rows } = await this.pool.query(
      `WITH active AS (
         SELECT s.id, s.author_id, s.created_at,
                EXISTS (SELECT 1 FROM content.story_views v WHERE v.story_id = s.id AND v.viewer_id = $1) AS seen
           FROM content.stories s
          WHERE s.expires_at > now()
            AND (s.author_id = $1 OR EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = s.author_id))
            AND ${notHidden('s.author_id')}
       )
       SELECT u.username, u.display_name, (u.id = $1) AS is_me,
              count(*)::int AS story_count, bool_and(a.seen OR u.id = $1) AS seen,
              count(*) FILTER (WHERE a.seen AND u.id <> $1)::int AS seen_count, max(a.created_at) AS latest_at
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
      /** Quantos já foram vistos: o anel mostra os segmentos vistos a cinzento e os novos a cores. */
      seenCount: r.seen_count,
      seen: r.seen,
      latestAt: r.latest_at,
    }));
  }

  async byUser(viewerId: string, username: string) {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.media_id, s.caption, s.created_at, s.expires_at, u.id AS author_id, u.username, u.display_name,
              EXISTS (SELECT 1 FROM content.story_views v WHERE v.story_id = s.id AND v.viewer_id = $1) AS seen,
              (SELECT count(*) FROM content.story_views v WHERE v.story_id = s.id)::int AS view_count,
              (SELECT count(*) FROM content.story_replies r WHERE r.story_id = s.id)::int AS reply_count,
              (u.id <> $1 AND (u.story_replies = 'everyone' OR (u.story_replies = 'following' AND
                 EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1)))) AS can_reply
         FROM content.stories s JOIN identity.users u ON u.id = s.author_id
        WHERE u.username = $2 AND s.expires_at > now() AND ${canView('u')} AND ${notHidden('s.author_id')} ORDER BY s.id ASC`,
      [viewerId, username],
    );
    return rows.map((r) => this.toDto(r, viewerId));
  }

  async view(viewerId: string, storyId: string) {
    const s = await this.visibleStory(viewerId, storyId);
    if (s.author_id === viewerId) return; // o autor não conta como visualização
    await this.pool.query('INSERT INTO content.story_views (story_id, viewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [storyId, viewerId]);
  }

  /** Story activo e visível para este espectador (perfis privados só para seguidores). */
  private async visibleStory(viewerId: string, storyId: string): Promise<{ author_id: string; story_replies: string; author_follows_viewer: boolean }> {
    const s = await this.pool.query(
      `SELECT s.author_id, u.story_replies,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AS author_follows_viewer
         FROM content.stories s JOIN identity.users u ON u.id = s.author_id
        WHERE s.id = $2 AND s.expires_at > now() AND ${canView('u')} AND ${notHidden('s.author_id')}`,
      [viewerId, storyId],
    );
    if (!s.rows[0]) throw new NotFoundException('Story não encontrado ou já expirou');
    return s.rows[0];
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

  /** Responder a um story (ou reagir com emoji). Chega ao autor; não se responde ao próprio story nem a um expirado. */
  async reply(userId: string, storyId: string, body: string) {
    const s = await this.visibleStory(userId, storyId);
    if (s.author_id === userId) throw new BadRequestException('Não podes responder ao teu próprio story');
    // O autor decide quem pode responder: todos, só quem ele segue, ou ninguém.
    if (s.story_replies === 'off' || (s.story_replies === 'following' && !s.author_follows_viewer)) {
      throw new ForbiddenException('Este story não aceita respostas');
    }
    const id = uuidv7();
    const kind = REACTIONS.has(body) ? 'reaction' : 'reply';
    await this.pool.query('INSERT INTO content.story_replies (id, story_id, author_id, body, kind) VALUES ($1, $2, $3, $4, $5)', [
      id, storyId, userId, body, kind,
    ]);
    await this.notifications.notify({ userId: s.author_id, actorId: userId, kind: 'story_reply', data: { storyId, replyKind: kind, snippet: body.slice(0, 80) } });
    return { id, kind };
  }

  /** Respostas e reacções ao story: só o autor as vê. */
  async replies(userId: string, storyId: string) {
    const own = await this.pool.query('SELECT 1 FROM content.stories WHERE id = $1 AND author_id = $2', [storyId, userId]);
    if (!own.rowCount) throw new NotFoundException('Story não encontrado');
    const { rows } = await this.pool.query(
      `SELECT r.id, r.body, r.kind, r.created_at, u.username, u.display_name
         FROM content.story_replies r JOIN identity.users u ON u.id = r.author_id
        WHERE r.story_id = $1 ORDER BY r.id DESC LIMIT 200`,
      [storyId],
    );
    return rows.map((r) => ({
      id: r.id, body: r.body, kind: r.kind, createdAt: r.created_at,
      author: { username: r.username, displayName: r.display_name },
    }));
  }

  /** Definições de stories do próprio: quem pode responder e a quem está escondido. */
  async settings(userId: string) {
    const u = await this.pool.query('SELECT story_replies FROM identity.users WHERE id = $1', [userId]);
    const h = await this.pool.query(
      `SELECT u.username, u.display_name FROM social.story_hidden h JOIN identity.users u ON u.id = h.hidden_id
        WHERE h.owner_id = $1 ORDER BY h.created_at DESC`,
      [userId],
    );
    return {
      replies: u.rows[0].story_replies as 'everyone' | 'following' | 'off',
      hidden: h.rows.map((r) => ({ username: r.username, displayName: r.display_name })),
    };
  }

  async setReplies(userId: string, replies: 'everyone' | 'following' | 'off') {
    await this.pool.query('UPDATE identity.users SET story_replies = $2 WHERE id = $1', [userId, replies]);
    return this.settings(userId);
  }

  /** Esconder os meus stories a uma pessoa (ela deixa de os ver, sem ser avisada). */
  async hide(userId: string, username: string) {
    const t = await this.pool.query(`SELECT id FROM identity.users WHERE username = $1 AND status = 'active'`, [username]);
    if (!t.rows[0]) throw new NotFoundException('Utilizador não encontrado');
    if (t.rows[0].id === userId) throw new BadRequestException('Não podes esconder o story de ti próprio 😅');
    await this.pool.query('INSERT INTO social.story_hidden (owner_id, hidden_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, t.rows[0].id]);
    return this.settings(userId);
  }

  async unhide(userId: string, username: string) {
    await this.pool.query(
      `DELETE FROM social.story_hidden WHERE owner_id = $1 AND hidden_id = (SELECT id FROM identity.users WHERE username = $2)`,
      [userId, username],
    );
    return this.settings(userId);
  }

  async remove(userId: string, storyId: string) {
    const r = await this.pool.query('DELETE FROM content.stories WHERE id = $1 AND author_id = $2', [storyId, userId]);
    if (!r.rowCount) throw new NotFoundException('Story não encontrado');
  }

  private async getOne(userId: string, id: string) {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.media_id, s.caption, s.created_at, s.expires_at, u.id AS author_id, u.username, u.display_name,
              false AS seen, 0 AS view_count, 0 AS reply_count, false AS can_reply
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
    replyCount: r.author_id === viewerId ? r.reply_count : null,
    /** Se este espectador pode responder (depende da definição do autor). */
    canReply: !!r.can_reply,
  });
}
