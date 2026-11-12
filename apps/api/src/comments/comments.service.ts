import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TextFilter } from '../safety/text-filter.service';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { allowedBy, blockedBetween, canView, notReportedBy } from '../social/visibility';
import { readGif, type GifInput } from '../gifs/gif';
import { remixAllowed } from '../posts/remix';

const UUID = /^[0-9a-f-]{36}$/;

const SELECT = `
  SELECT c.id, c.post_id, c.parent_id, c.body, c.gif, c.created_at, c.edited_at,
         EXISTS (SELECT 1 FROM social.follows af WHERE af.follower_id = $1 AND af.followee_id = u.id) AS author_followed,
         u.id AS author_id, u.username, u.display_name, u.verified, u.verified_tier, (u.avatar_media_id IS NOT NULL) AS author_has_avatar,
         (SELECT count(*) FROM content.comment_cheers x WHERE x.comment_id = c.id)::int AS cheers,
         EXISTS (SELECT 1 FROM content.comment_cheers x WHERE x.comment_id = c.id AND x.user_id = $1) AS cheered,
         (SELECT count(*) FROM content.comments r WHERE r.parent_id = c.id)::int AS reply_count,
         -- Remix (0134): dá para responder a este comentário com uma tcheka (quem o escreveu e o dono da publicação deixam)…
         (${remixAllowed('u')} AND EXISTS (SELECT 1 FROM content.posts rpo JOIN identity.users rpu ON rpu.id = rpo.author_id
            WHERE rpo.id = c.post_id AND rpo.kind = 'post' AND rpo.venue_id IS NULL AND ${remixAllowed('rpu')})) AS remix_ok,
         -- …e as tchekas que já lhe responderam e que este espectador vê: quantas e a mais recente («Respondeu com uma tcheka»).
         (SELECT json_build_object('count', count(*), 'postId', (array_agg(rxp.id ORDER BY rxp.id DESC))[1])
            FROM content.post_remixes rxr JOIN content.posts rxp ON rxp.id = rxr.post_id AND rxp.removed_at IS NULL
            JOIN identity.users ru ON ru.id = rxp.author_id
           WHERE rxr.comment_id = c.id AND ${canView('ru')}) AS tcheka_replies
    FROM content.comments c JOIN identity.users u ON u.id = c.author_id`;

@Injectable()
export class CommentsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly notifications: NotificationsService,
    private readonly filter: TextFilter,
  ) {}

  /** Comentários de topo, do mais recente para o mais antigo, com paginação por cursor. */
  async list(userId: string, postId: string, cursor: string | undefined, limit: number) {
    await this.assertPost(userId, postId);
    this.assertCursor(cursor);
    const { rows } = await this.pool.query(
      `${SELECT} WHERE c.post_id = $2 AND c.parent_id IS NULL AND ($3::uuid IS NULL OR c.id < $3) AND ${notReportedBy('comment', 'c.id')}
        ORDER BY c.id DESC LIMIT $4`,
      [userId, postId, cursor ?? null, limit + 1],
    );
    return this.page(rows, limit);
  }

  /** Respostas a um comentário, da mais antiga para a mais recente. */
  async replies(userId: string, commentId: string, cursor: string | undefined, limit: number) {
    this.assertCursor(cursor);
    await this.assertComment(userId, commentId);
    const { rows } = await this.pool.query(
      `${SELECT} WHERE c.parent_id = $2 AND ($3::uuid IS NULL OR c.id > $3) AND ${notReportedBy('comment', 'c.id')} ORDER BY c.id ASC LIMIT $4`,
      [userId, commentId, cursor ?? null, limit + 1],
    );
    return this.page(rows, limit);
  }

  async create(userId: string, postId: string, body: string, parentId?: string, gif?: GifInput) {
    this.filter.assertClean(body);
    if (!body && !gif) throw new BadRequestException('Escreve alguma coisa');
    // O título do GIF (do GIPHY, só para o leitor de ecrã) não pode passar o que o filtro barra.
    if (gif?.title && this.filter.check(gif.title)) gif = { ...gif, title: undefined };
    const postAuthorId = await this.assertCanComment(userId, postId);
    let threadParent: string | null = null;
    let parentAuthorId: string | null = null;
    if (parentId) {
      const p = await this.pool.query('SELECT id, post_id, parent_id, author_id FROM content.comments WHERE id = $1', [parentId]);
      if (!p.rows[0] || p.rows[0].post_id !== postId) throw new BadRequestException('Comentário a que respondes não existe');
      // Resposta a uma resposta: fica no mesmo fio, sob o comentário de topo.
      threadParent = p.rows[0].parent_id ?? p.rows[0].id;
      parentAuthorId = p.rows[0].author_id;
    }
    const id = uuidv7();
    await this.pool.query(
      'INSERT INTO content.comments (id, post_id, author_id, body, parent_id, gif) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
      [id, postId, userId, body, threadParent, gif ? JSON.stringify(gif) : null],
    );
    const data = { postId, commentId: id, snippet: (body || 'GIF').slice(0, 80) };
    // Avisa quem foi respondido e, se for outra pessoa, o dono da publicação.
    if (parentAuthorId) await this.notifications.notify({ userId: parentAuthorId, actorId: userId, kind: 'reply', data });
    if (postAuthorId !== parentAuthorId) await this.notifications.notify({ userId: postAuthorId, actorId: userId, kind: 'comment', data });
    if (body) void this.notifications.notifyMentions(userId, body, data);
    return this.getOne(userId, id);
  }

  async toggleCheer(userId: string, commentId: string) {
    await this.assertComment(userId, commentId);
    const del = await this.pool.query('DELETE FROM content.comment_cheers WHERE comment_id = $1 AND user_id = $2', [commentId, userId]);
    if (!del.rowCount) {
      const ins = await this.pool.query('INSERT INTO content.comment_cheers (comment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [commentId, userId]);
      // Avisa quem escreveu o comentário (agrupado por comentário). Ver NotificationsService.notifyCheer.
      if (ins.rowCount) {
        const c = (await this.pool.query('SELECT author_id, post_id FROM content.comments WHERE id = $1', [commentId])).rows[0];
        if (c) await this.notifications.notifyCheer(c.author_id as string, userId, { kind: 'comment', postId: c.post_id as string, commentId });
      }
    }
    const c = await this.pool.query('SELECT count(*)::int AS n FROM content.comment_cheers WHERE comment_id = $1', [commentId]);
    return { cheered: !del.rowCount, cheers: c.rows[0].n };
  }

  /** Só o autor edita o seu comentário. O texto passa pelo mesmo filtro de quando se escreve. */
  async update(userId: string, commentId: string, body: string) {
    this.filter.assertClean(body);
    const { rows } = await this.pool.query('SELECT post_id, author_id FROM content.comments WHERE id = $1', [commentId]);
    if (!rows[0]) throw new NotFoundException('Comentário não encontrado');
    await this.assertComment(userId, commentId);
    if (rows[0].author_id !== userId) throw new ForbiddenException('Só quem escreveu pode editar');
    await this.pool.query('UPDATE content.comments SET body = $2, edited_at = now() WHERE id = $1', [commentId, body]);
    return this.getOne(userId, commentId);
  }

  /** O autor do comentário ou o dono da publicação podem apagar. Devolve quantos comentários saíram (com respostas). */
  async remove(userId: string, commentId: string) {
    const { rows } = await this.pool.query(
      `SELECT 1 + (SELECT count(*) FROM content.comments r WHERE r.parent_id = c.id)::int AS removed
         FROM content.comments c JOIN content.posts p ON p.id = c.post_id
        WHERE c.id = $1 AND (c.author_id = $2 OR p.author_id = $2)`,
      [commentId, userId],
    );
    if (!rows[0]) throw new NotFoundException('Comentário não encontrado');
    await this.pool.query('DELETE FROM content.comments WHERE id = $1', [commentId]);
    return { removed: rows[0].removed as number };
  }

  private async getOne(userId: string, id: string) {
    const { rows } = await this.pool.query(`${SELECT} WHERE c.id = $2`, [userId, id]);
    return this.toDto(rows[0]);
  }

  private page(rows: Record<string, any>[], limit: number) {
    const items = rows.slice(0, limit);
    return { items: items.map(this.toDto), nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  private assertCursor(cursor?: string) {
    if (cursor && !UUID.test(cursor)) throw new BadRequestException('cursor inválido');
  }

  /** A publicação existe e é visível para este espectador (perfis privados só para seguidores). */
  private async assertPost(viewerId: string, postId: string) {
    const r = await this.pool.query(
      `SELECT 1 FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL WHERE p.id = $2 AND ${canView()}`,
      [viewerId, postId],
    );
    if (!r.rowCount) throw new NotFoundException('Publicação não encontrada');
  }

  /** Visível e com os comentários permitidos pelo autor (todos / quem ele segue / ninguém). Devolve o id do autor. */
  private async assertCanComment(viewerId: string, postId: string): Promise<string> {
    const r = await this.pool.query(
      `SELECT u.id AS author_id, (${allowedBy('u', 'comments_allowed')} AND NOT p.comments_off) AS allowed
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL WHERE p.id = $2 AND ${canView()}`,
      [viewerId, postId],
    );
    if (!r.rows[0]) throw new NotFoundException('Publicação não encontrada');
    if (!r.rows[0].allowed) throw new ForbiddenException('Os comentários estão desativados nesta publicação 🔕');
    return r.rows[0].author_id as string;
  }

  private async assertComment(viewerId: string, id: string) {
    const r = await this.pool.query(
      `SELECT 1 FROM content.comments c JOIN content.posts p ON p.id = c.post_id JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
        WHERE c.id = $2 AND ${canView()}`,
      [viewerId, id],
    );
    if (!r.rowCount) throw new NotFoundException('Comentário não encontrado');
  }

  private toDto = (r: Record<string, any>) => ({
    id: r.id,
    postId: r.post_id,
    parentId: r.parent_id,
    body: r.body,
    /** GIF do GIPHY no comentário: { id, w, h, url, still?, title? } ou null. */
    gif: readGif(r.gif),
    createdAt: r.created_at,
    author: { id: r.author_id, username: r.username, displayName: r.display_name, verified: r.verified as boolean, verifiedTier: (r.verified_tier as string | null) ?? null },
    cheers: r.cheers,
    cheered: r.cheered,
    replyCount: r.reply_count,
    editedAt: (r.edited_at as string | null) ?? null,
    /** Eu sigo o autor? Só se presenteia quem se segue. */
    authorFollowed: r.author_followed as boolean,
    /** Posso responder a este comentário com uma tcheka (?resposta=<id> no estúdio). */
    canRemix: r.remix_ok === true,
    /** «Respondeu com uma tcheka»: quantas tchekas responderam (que eu vejo) e a mais recente. */
    tchekaReplies: r.tcheka_replies && Number(r.tcheka_replies.count) > 0 ? { count: Number(r.tcheka_replies.count), postId: r.tcheka_replies.postId as string } : null,
  });

  /** Um comentário para o autocolante do estúdio (?resposta=<id>): o texto, o autor e a publicação, se o posso ver. */
  async forReply(userId: string, id: string) {
    await this.assertComment(userId, id);
    const { rows } = await this.pool.query(`${SELECT} WHERE c.id = $2 AND u.status = 'active' AND NOT ${blockedBetween('u.id', '$1')}`, [userId, id]);
    if (!rows[0]) throw new NotFoundException('Comentário não encontrado');
    const dto = this.toDto(rows[0]);
    return { ...dto, author: { ...dto.author, hasAvatar: rows[0].author_has_avatar === true } };
  }
}
