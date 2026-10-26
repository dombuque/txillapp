import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { ChatService } from '../chat/chat.service';
import { NotificationsService } from '../notifications/notifications.service';
import { blockedBetween, canView } from '../social/visibility';

/** O autor escondeu os stories a este espectador? */
/** Stories só para amigos próximos: visíveis ao autor e à lista dele. */
export const audienceOk = (a = 's', v = '$1') =>
  `(${a}.audience = 'all' OR ${a}.author_id = ${v} OR EXISTS (SELECT 1 FROM social.close_friends cf WHERE cf.owner_id = ${a}.author_id AND cf.friend_id = ${v}))`;

/** Um story partilhado só existe enquanto a publicação original existir e o ficheiro estiver disponível. */
const sharedOk = (s = 's') =>
  `(${s}.shared_post_id IS NULL OR EXISTS (SELECT 1 FROM content.posts sp WHERE sp.id = ${s}.shared_post_id AND sp.removed_at IS NULL))
   AND EXISTS (SELECT 1 FROM content.media_assets sma WHERE sma.id = ${s}.media_id AND sma.status = 'ready')`;

const notHidden = (author: string, viewer = '$1') =>
  `NOT EXISTS (SELECT 1 FROM social.story_hidden h WHERE h.owner_id = ${author} AND h.hidden_id = ${viewer})`;

const REACTIONS = new Set(['😂', '😮', '😍', '😢', '👏', '🔥', '🍻']);

@Injectable()
export class StoriesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly notifications: NotificationsService,
    private readonly chat: ChatService,
  ) {}

  async create(userId: string, mediaId: string, caption: string, audience: 'all' | 'close_friends' = 'all') {
    const ok = await this.pool.query(
      `SELECT 1 FROM content.media_assets a
        WHERE a.id = $1 AND a.owner_id = $2 AND a.status = 'ready'
          AND NOT EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.media_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM content.stories s WHERE s.media_id = a.id)`,
      [mediaId, userId],
    );
    if (!ok.rowCount) throw new BadRequestException('Foto inválida ou ainda não carregada');
    const id = uuidv7();
    await this.pool.query('INSERT INTO content.stories (id, author_id, media_id, caption, audience) VALUES ($1, $2, $3, $4, $5)', [
      id, userId, mediaId, caption || null, audience,
    ]);
    if (caption && audience === 'all') void this.notifications.notifyMentions(userId, caption, { snippet: caption.slice(0, 80) });
    return this.getOne(userId, id);
  }

  /** Bandeja: stories activos de quem sigo (e os meus). O próprio primeiro, depois "não vistos", depois os mais recentes. */
  async tray(userId: string) {
    const { rows } = await this.pool.query(
      `WITH active AS (
         SELECT s.id, s.author_id, s.created_at, s.audience,
                EXISTS (SELECT 1 FROM content.story_views v WHERE v.story_id = s.id AND v.viewer_id = $1) AS seen
           FROM content.stories s
          WHERE s.expires_at > now()
            AND (s.author_id = $1 OR EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = s.author_id))
            AND ${notHidden('s.author_id')} AND ${audienceOk()} AND ${sharedOk()}
       )
       SELECT u.username, u.display_name, (u.id = $1) AS is_me,
              count(*)::int AS story_count, bool_and(a.seen OR u.id = $1) AS seen,
              count(*) FILTER (WHERE a.seen AND u.id <> $1)::int AS seen_count, bool_and(a.audience = 'close_friends') AS close_only, max(a.created_at) AS latest_at
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
      /** Todos os stories activos desta pessoa são só para amigos próximos (anel verde). */
      closeFriends: r.close_only,
      latestAt: r.latest_at,
    }));
  }

  async byUser(viewerId: string, username: string) {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.media_id, s.caption, s.created_at, s.expires_at, s.audience, u.id AS author_id, u.username, u.display_name,
              (SELECT m.mime FROM content.media_assets m WHERE m.id = s.media_id) AS mime,
              (SELECT m.duration_ms FROM content.media_assets m WHERE m.id = s.media_id) AS duration_ms,
              s.shared_post_id,
              (SELECT json_build_object('username', su.username, 'displayName', su.display_name) FROM content.posts sp JOIN identity.users su ON su.id = sp.author_id WHERE sp.id = s.shared_post_id) AS shared_from,
              EXISTS (SELECT 1 FROM content.story_views v WHERE v.story_id = s.id AND v.viewer_id = $1) AS seen,
              (SELECT count(*) FROM content.story_views v WHERE v.story_id = s.id)::int AS view_count,
              (SELECT count(*) FROM content.story_replies r WHERE r.story_id = s.id)::int AS reply_count,
              (SELECT count(*) FROM content.story_comments sc WHERE sc.story_id = s.id)::int AS comment_count,
              (u.id <> $1 AND (u.story_replies = 'everyone' OR (u.story_replies = 'following' AND
                 EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1)))) AS can_reply
         FROM content.stories s JOIN identity.users u ON u.id = s.author_id
        WHERE u.username = $2 AND s.expires_at > now() AND ${canView('u')} AND ${notHidden('s.author_id')} AND ${audienceOk()} AND ${sharedOk()} ORDER BY s.id ASC`,
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
  private async visibleStory(viewerId: string, storyId: string): Promise<{ author_id: string; media_id: string; story_replies: string; author_follows_viewer: boolean }> {
    const s = await this.pool.query(
      `SELECT s.author_id, s.media_id, u.story_replies,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AS author_follows_viewer
         FROM content.stories s JOIN identity.users u ON u.id = s.author_id
        WHERE s.id = $2 AND s.expires_at > now() AND ${canView('u')} AND ${notHidden('s.author_id')} AND ${audienceOk()} AND ${sharedOk()}`,
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
    // A resposta também chega ao autor como mensagem, para continuar a conversa no chat.
    await this.chat.sendStoryReply(userId, s.author_id, body, kind === 'reaction' ? 'story_reaction' : 'story_reply', s.media_id);
    await this.notifications.notify({ userId: s.author_id, actorId: userId, kind: 'story_reply', data: { storyId, replyKind: kind, snippet: body.slice(0, 80) } });
    return { id, kind };
  }

  /** Respostas e reacções ao story: só o autor as vê. */
  /** Comentários públicos, visíveis a quem pode ver o story. Contas privadas só aparecem a quem as segue (e o autor do story vê todos). */
  async comments(viewerId: string, storyId: string) {
    await this.visibleStory(viewerId, storyId);
    const { rows } = await this.pool.query(
      `SELECT c.id, c.body, c.created_at, a.username, a.display_name, (a.avatar_media_id IS NOT NULL) AS has_avatar,
              (c.author_id = $1) AS mine, (st.author_id = $1 OR c.author_id = $1) AS can_delete
         FROM content.story_comments c
         JOIN content.stories st ON st.id = c.story_id
         JOIN identity.users a ON a.id = c.author_id
        WHERE c.story_id = $2 AND a.status = 'active' AND NOT ${blockedBetween('a.id', '$1')}
          AND (a.id = $1 OR st.author_id = $1 OR ${canView('a')})
        ORDER BY c.id ASC LIMIT 200`,
      [viewerId, storyId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      body: r.body as string,
      createdAt: r.created_at as string,
      mine: r.mine as boolean,
      canDelete: r.can_delete as boolean,
      author: { username: r.username as string, displayName: r.display_name as string, hasAvatar: r.has_avatar as boolean },
    }));
  }

  /** Comentar num story: segue a mesma definição de respostas do autor (todos, quem ele segue, ninguém). */
  async comment(userId: string, storyId: string, body: string) {
    const s = await this.visibleStory(userId, storyId);
    if (s.author_id !== userId && (s.story_replies === 'off' || (s.story_replies === 'following' && !s.author_follows_viewer))) {
      throw new ForbiddenException('Este story não aceita comentários');
    }
    const id = uuidv7();
    await this.pool.query('INSERT INTO content.story_comments (id, story_id, author_id, body) VALUES ($1, $2, $3, $4)', [id, storyId, userId, body]);
    await this.notifications.notify({ userId: s.author_id, actorId: userId, kind: 'story_reply', data: { storyId, replyKind: 'comment', snippet: body.slice(0, 80) } });
    void this.notifications.notifyMentions(userId, body, { storyId, snippet: body.slice(0, 80) });
    return { id };
  }

  async deleteComment(userId: string, commentId: string) {
    const r = await this.pool.query(
      `DELETE FROM content.story_comments c USING content.stories st
        WHERE c.id = $1 AND st.id = c.story_id AND (c.author_id = $2 OR st.author_id = $2)`,
      [commentId, userId],
    );
    if (!r.rowCount) throw new NotFoundException('Comentário não encontrado');
  }

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

  /**
   * Partilhar uma publicação (foto ou reel) no meu status. Só publicações públicas e normais, que eu possa ver;
   * o story reutiliza o ficheiro e mostra de quem é. Se a publicação for apagada, o story deixa de aparecer.
   */
  async share(userId: string, postId: string, caption: string, audience: 'all' | 'close_friends' = 'all') {
    const { rows } = await this.pool.query(
      `SELECT (SELECT pm.media_id FROM content.post_media pm JOIN content.media_assets m ON m.id = pm.media_id
                WHERE pm.post_id = p.id AND m.status = 'ready' ORDER BY pm.position LIMIT 1) AS media_id
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
        WHERE p.id = $2 AND p.kind = 'post' AND NOT u.is_private AND ${canView('u')}`,
      [userId, postId],
    );
    if (!rows[0]) throw new NotFoundException('Publicação não encontrada');
    if (!rows[0].media_id) throw new BadRequestException('Só se partilham publicações com foto ou vídeo');
    const id = uuidv7();
    await this.pool.query('INSERT INTO content.stories (id, author_id, media_id, caption, audience, shared_post_id) VALUES ($1, $2, $3, $4, $5, $6)', [
      id, userId, rows[0].media_id, caption || null, audience, postId,
    ]);
    return this.getOne(userId, id);
  }

  /** Lista de amigos próximos. */
  async closeFriends(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar
         FROM social.close_friends cf JOIN identity.users u ON u.id = cf.friend_id
        WHERE cf.owner_id = $1 AND u.status = 'active' ORDER BY cf.created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ username: r.username, displayName: r.display_name, hasAvatar: r.has_avatar }));
  }

  /** Só se pode adicionar quem me segue (é quem vê os meus stories na bandeja) e não há bloqueio. */
  async addCloseFriend(userId: string, username: string) {
    const r = await this.pool.query(
      `INSERT INTO social.close_friends (owner_id, friend_id)
       SELECT $1, u.id FROM identity.users u
        WHERE lower(u.username) = lower($2) AND u.id <> $1 AND u.status = 'active'
          AND EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1)
          AND NOT ${blockedBetween('u.id', '$1')}
       ON CONFLICT DO NOTHING`,
      [userId, username],
    );
    if (!r.rowCount) {
      const exists = await this.pool.query(
        'SELECT 1 FROM social.close_friends cf JOIN identity.users u ON u.id = cf.friend_id WHERE cf.owner_id = $1 AND lower(u.username) = lower($2)',
        [userId, username],
      );
      if (!exists.rowCount) throw new BadRequestException('Só podes adicionar quem te segue');
    }
  }

  async removeCloseFriend(userId: string, username: string) {
    await this.pool.query(
      'DELETE FROM social.close_friends WHERE owner_id = $1 AND friend_id = (SELECT id FROM identity.users WHERE lower(username) = lower($2))',
      [userId, username],
    );
  }

  async remove(userId: string, storyId: string) {
    const r = await this.pool.query('DELETE FROM content.stories WHERE id = $1 AND author_id = $2', [storyId, userId]);
    if (!r.rowCount) throw new NotFoundException('Story não encontrado');
  }

  private async getOne(userId: string, id: string) {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.media_id, s.caption, s.created_at, s.expires_at, s.audience, u.id AS author_id, u.username, u.display_name,
              (SELECT m.mime FROM content.media_assets m WHERE m.id = s.media_id) AS mime,
              (SELECT m.duration_ms FROM content.media_assets m WHERE m.id = s.media_id) AS duration_ms,
              s.shared_post_id,
              (SELECT json_build_object('username', su.username, 'displayName', su.display_name) FROM content.posts sp JOIN identity.users su ON su.id = sp.author_id WHERE sp.id = s.shared_post_id) AS shared_from,
              false AS seen, 0 AS view_count, 0 AS reply_count, 0 AS comment_count, false AS can_reply
         FROM content.stories s JOIN identity.users u ON u.id = s.author_id WHERE s.id = $1`,
      [id],
    );
    return this.toDto(rows[0], userId);
  }

  private toDto = (r: Record<string, any>, viewerId: string) => ({
    id: r.id,
    mediaUrl: `/api/v1/media/${r.media_id}`,
    /** 'video' quando o story é um reel partilhado. */
    mediaKind: (String(r.mime ?? '').startsWith('video/') ? 'video' : 'image') as 'video' | 'image',
    durationMs: (r.duration_ms ?? null) as number | null,
    /** Partilhado de uma publicação: de quem e qual (para abrir o original). */
    sharedFrom: r.shared_post_id ? { postId: r.shared_post_id as string, ...(r.shared_from as { username: string; displayName: string }) } : null,
    caption: r.caption,
    audience: r.audience as 'all' | 'close_friends',
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    author: { username: r.username, displayName: r.display_name },
    seen: r.seen,
    // Só o autor vê o contador de visualizações.
    viewCount: r.author_id === viewerId ? r.view_count : null,
    replyCount: r.author_id === viewerId ? r.reply_count : null,
    /** Comentários públicos: o número é visível a quem vê o story. */
    commentCount: (r.comment_count ?? 0) as number,
    /** Se este espectador pode responder (depende da definição do autor). */
    canReply: !!r.can_reply,
  });
}
