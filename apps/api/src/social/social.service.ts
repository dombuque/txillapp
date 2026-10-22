import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { blockedBetween, canView } from './visibility';

const UUID = /^[0-9a-f-]{36}$/;

export interface PersonItem {
  username: string;
  displayName: string;
  following: boolean;
  followsYou: boolean;
}

export type Who = 'everyone' | 'following' | 'off';
export type Connections = 'everyone' | 'followers' | 'me';

@Injectable()
export class SocialService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly notifications: NotificationsService,
  ) {}

  /* ───────────── perfil ───────────── */

  async profile(viewerId: string, username: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.username, u.display_name, u.bio, u.created_at, u.is_private, u.show_connections,
              (u.avatar_media_id IS NOT NULL) AS has_avatar,
              (SELECT count(*) FROM content.posts p WHERE p.author_id = u.id)::int AS posts,
              (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers,
              (SELECT count(*) FROM social.follows f WHERE f.follower_id = u.id)::int AS following,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS i_follow,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AS follows_me,
              EXISTS (SELECT 1 FROM social.follow_requests r WHERE r.requester_id = $1 AND r.target_id = u.id) AS requested,
              (SELECT count(*) FROM social.follow_requests r WHERE r.target_id = u.id AND u.id = $1)::int AS pending_requests,
              ${canView('u')} AS can_view,
              EXISTS (SELECT 1 FROM social.blocks b WHERE b.blocker_id = $1 AND b.blocked_id = u.id) AS blocked_by_me,
              EXISTS (SELECT 1 FROM social.blocks b WHERE b.blocker_id = u.id AND b.blocked_id = $1) AS blocked_me,
              (SELECT count(*) FROM content.stories s WHERE s.author_id = u.id AND s.expires_at > now() AND ${canView('u')})::int AS active_stories
         FROM identity.users u WHERE u.username = $2 AND u.status = 'active'`,
      [viewerId, username],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('Utilizador não encontrado');
    const isMe = r.id === viewerId;
    return {
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      bio: r.bio,
      hasAvatar: r.has_avatar,
      joinedAt: r.created_at,
      isMe,
      isPrivate: r.is_private,
      following: r.i_follow,
      followsYou: r.follows_me,
      requested: r.requested,
      /** Como no X: o cabeçalho continua visível, com o aviso de bloqueio, mas sem publicações nem poder seguir. */
      blockedByMe: r.blocked_by_me,
      blockedMe: r.blocked_me,
      /** Falso num perfil privado para quem não é seguidor: publicações, stories e listas ficam escondidos. */
      canView: r.can_view,
      /** Se a lista de seguidores/seguindo está acessível a este espectador. */
      canSeeConnections: r.can_view && (isMe || r.show_connections === 'everyone' || (r.show_connections === 'followers' && r.i_follow)),
      pendingRequests: r.pending_requests,
      activeStories: r.active_stories,
      counts: { posts: r.posts, followers: r.followers, following: r.following },
    };
  }

  /** 403 se o perfil é privado e o espectador não é o próprio nem seguidor aceite. */
  async assertVisible(viewerId: string, username: string) {
    const { rows } = await this.pool.query(
      `SELECT ${canView('u')} AS ok, ${blockedBetween('u.id', '$1')} AS blocked
         FROM identity.users u WHERE u.username = $2 AND u.status = 'active'`,
      [viewerId, username],
    );
    if (!rows[0]) throw new NotFoundException('Utilizador não encontrado');
    if (rows[0].blocked) throw new ForbiddenException('Não tens acesso a este perfil 🚫');
    if (!rows[0].ok) throw new ForbiddenException('Esta conta é privada 🔒');
  }

  /** Quem pode ver as listas de seguidores/seguindo, segundo a definição da pessoa. */
  private async assertConnections(viewerId: string, username: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.show_connections,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS i_follow
         FROM identity.users u WHERE u.username = $2 AND u.status = 'active'`,
      [viewerId, username],
    );
    const u = rows[0];
    if (!u) throw new NotFoundException('Utilizador não encontrado');
    if (u.id === viewerId || u.show_connections === 'everyone') return;
    if (u.show_connections === 'followers' && u.i_follow) return;
    throw new ForbiddenException('Esta pessoa mantém estas listas privadas 🔒');
  }

  /** Editar o próprio perfil. Só campos enviados são alterados. Passar a público aceita os pedidos pendentes. */
  async updateMe(userId: string, patch: { displayName?: string; bio?: string; isPrivate?: boolean }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE identity.users SET
            display_name = COALESCE($2, display_name),
            bio = CASE WHEN $3::boolean THEN NULLIF($4, '') ELSE bio END,
            is_private = COALESCE($5, is_private)
          WHERE id = $1 RETURNING id, username, display_name, bio, is_private`,
        [userId, patch.displayName ?? null, patch.bio !== undefined, patch.bio ?? null, patch.isPrivate ?? null],
      );
      if (patch.isPrivate === false) {
        await client.query(
          `INSERT INTO social.follows (follower_id, followee_id)
           SELECT requester_id, target_id FROM social.follow_requests WHERE target_id = $1 ON CONFLICT DO NOTHING`,
          [userId],
        );
        await client.query('DELETE FROM social.follow_requests WHERE target_id = $1', [userId]);
      }
      await client.query('COMMIT');
      return { id: rows[0].id, username: rows[0].username, displayName: rows[0].display_name, bio: rows[0].bio, isPrivate: rows[0].is_private };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /* ───────────── foto de perfil ───────────── */

  /** Define a foto de perfil a partir de uma imagem já carregada (só do próprio, pronta e ainda não usada). */
  async setAvatar(userId: string, mediaId: string) {
    const ok = await this.pool.query(
      `SELECT 1 FROM content.media_assets a
        WHERE a.id = $1 AND a.owner_id = $2 AND a.status = 'ready'
          AND NOT EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.media_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM content.stories s WHERE s.media_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM identity.users x WHERE x.avatar_media_id = a.id)`,
      [mediaId, userId],
    );
    if (!ok.rowCount) throw new BadRequestException('Foto inválida ou ainda não carregada');
    await this.pool.query('UPDATE identity.users SET avatar_media_id = $2 WHERE id = $1', [userId, mediaId]);
    return { hasAvatar: true };
  }

  async clearAvatar(userId: string) {
    await this.pool.query('UPDATE identity.users SET avatar_media_id = NULL WHERE id = $1', [userId]);
    return { hasAvatar: false };
  }

  /* ───────────── seguir ───────────── */

  /**
   * Seguir um perfil público é imediato; num privado cria um pedido que a pessoa aceita ou recusa.
   * Repetir é idempotente. Com bloqueio, a conta "não existe".
   */
  async follow(viewerId: string, username: string) {
    const t = await this.target(username, viewerId);
    if (t.id === viewerId) throw new BadRequestException('Não podes seguir-te a ti próprio 😅');
    if (t.blockedMe) throw new ForbiddenException(`Foste bloqueado por @${username}. Não podes seguir esta conta 🚫`);
    if (t.blockedByMe) throw new ForbiddenException(`Bloqueaste @${username}. Desbloqueia para poderes seguir.`);
    const already = await this.pool.query('SELECT 1 FROM social.follows WHERE follower_id = $1 AND followee_id = $2', [viewerId, t.id]);
    if (!already.rowCount) {
      if (t.is_private) {
        await this.pool.query('INSERT INTO social.follow_requests (requester_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [viewerId, t.id]);
        await this.notifications.notify({ userId: t.id, actorId: viewerId, kind: 'follow_request' });
      } else {
        await this.pool.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [viewerId, t.id]);
        await this.notifications.notify({ userId: t.id, actorId: viewerId, kind: 'follow' });
      }
    }
    return this.state(viewerId, t.id);
  }

  /** Deixar de seguir, ou cancelar um pedido pendente. */
  async unfollow(viewerId: string, username: string) {
    const t = await this.target(username);
    await this.pool.query('DELETE FROM social.follows WHERE follower_id = $1 AND followee_id = $2', [viewerId, t.id]);
    await this.pool.query('DELETE FROM social.follow_requests WHERE requester_id = $1 AND target_id = $2', [viewerId, t.id]);
    return this.state(viewerId, t.id);
  }

  async requests(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name, r.created_at FROM social.follow_requests r
         JOIN identity.users u ON u.id = r.requester_id
        WHERE r.target_id = $1 AND u.status = 'active' AND NOT ${blockedBetween('u.id', '$1')}
        ORDER BY r.created_at DESC LIMIT 100`,
      [userId],
    );
    return rows.map((r) => ({ username: r.username, displayName: r.display_name, requestedAt: r.created_at }));
  }

  async acceptRequest(userId: string, username: string) {
    const requester = (await this.target(username)).id;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const del = await client.query('DELETE FROM social.follow_requests WHERE requester_id = $1 AND target_id = $2', [requester, userId]);
      if (!del.rowCount) throw new NotFoundException('Pedido não encontrado');
      await client.query('INSERT INTO social.follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [requester, userId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    await this.notifications.notify({ userId: requester, actorId: userId, kind: 'request_accepted' });
  }

  async declineRequest(userId: string, username: string) {
    const requester = (await this.target(username)).id;
    const del = await this.pool.query('DELETE FROM social.follow_requests WHERE requester_id = $1 AND target_id = $2', [requester, userId]);
    if (!del.rowCount) throw new NotFoundException('Pedido não encontrado');
  }

  async followers(viewerId: string, username: string, cursor?: string) {
    return this.list(viewerId, username, 'followers', cursor);
  }

  async following(viewerId: string, username: string, cursor?: string) {
    return this.list(viewerId, username, 'following', cursor);
  }

  /* ───────────── bloqueios ───────────── */

  /** Bloquear: deixam de se ver, de se seguir e de interagir. Remove seguidores e pedidos nos dois sentidos. */
  async block(userId: string, username: string) {
    const t = await this.target(username);
    if (t.id === userId) throw new BadRequestException('Não podes bloquear-te a ti próprio 😅');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO social.blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, t.id]);
      await client.query('DELETE FROM social.follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)', [userId, t.id]);
      await client.query('DELETE FROM social.follow_requests WHERE (requester_id = $1 AND target_id = $2) OR (requester_id = $2 AND target_id = $1)', [userId, t.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    // A pessoa bloqueada é avisada: "@x bloqueou-te".
    await this.notifications.notify({ userId: t.id, actorId: userId, kind: 'blocked' });
    return this.blocked(userId);
  }

  async unblock(userId: string, username: string) {
    await this.pool.query(
      'DELETE FROM social.blocks WHERE blocker_id = $1 AND blocked_id = (SELECT id FROM identity.users WHERE username = $2)',
      [userId, username],
    );
    return this.blocked(userId);
  }

  async blocked(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name FROM social.blocks b JOIN identity.users u ON u.id = b.blocked_id
        WHERE b.blocker_id = $1 AND u.status = 'active' ORDER BY b.created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ username: r.username, displayName: r.display_name }));
  }

  /* ───────────── privacidade ───────────── */

  async privacy(userId: string) {
    const { rows } = await this.pool.query(
      'SELECT is_private, comments_allowed, gifts_allowed, show_connections, suggestable FROM identity.users WHERE id = $1',
      [userId],
    );
    const r = rows[0];
    return {
      isPrivate: r.is_private as boolean,
      commentsAllowed: r.comments_allowed as Who,
      giftsAllowed: r.gifts_allowed as Who,
      showConnections: r.show_connections as Connections,
      suggestable: r.suggestable as boolean,
    };
  }

  async setPrivacy(
    userId: string,
    p: { isPrivate?: boolean; commentsAllowed?: Who; giftsAllowed?: Who; showConnections?: Connections; suggestable?: boolean },
  ) {
    if (p.isPrivate !== undefined) await this.updateMe(userId, { isPrivate: p.isPrivate }); // aceita pedidos ao passar a público
    await this.pool.query(
      `UPDATE identity.users SET
          comments_allowed = COALESCE($2, comments_allowed),
          gifts_allowed = COALESCE($3, gifts_allowed),
          show_connections = COALESCE($4, show_connections),
          suggestable = COALESCE($5, suggestable)
        WHERE id = $1`,
      [userId, p.commentsAllowed ?? null, p.giftsAllowed ?? null, p.showConnections ?? null, p.suggestable ?? null],
    );
    return this.privacy(userId);
  }

  /* ───────────── sugestões ───────────── */

  /**
   * Sugestões de pessoas: quem eu não sigo, ainda não dispensei, não bloqueei, e que aceita ser sugerido;
   * ordenado por amigos em comum, depois por quem já me segue, depois popularidade.
   */
  async suggestions(viewerId: string, limit = 12) {
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name, u.is_private,
              (SELECT count(*) FROM social.follows a JOIN social.follows b ON b.follower_id = a.followee_id AND b.followee_id = u.id
                WHERE a.follower_id = $1)::int AS mutual,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AS follows_me,
              EXISTS (SELECT 1 FROM social.follow_requests r WHERE r.requester_id = $1 AND r.target_id = u.id) AS requested,
              (SELECT count(*) FROM social.follows f WHERE f.followee_id = u.id)::int AS followers,
              (SELECT m.display_name FROM social.follows a JOIN social.follows b ON b.follower_id = a.followee_id AND b.followee_id = u.id
                 JOIN identity.users m ON m.id = a.followee_id WHERE a.follower_id = $1 ORDER BY b.created_at DESC LIMIT 1) AS mutual_name
         FROM identity.users u
        WHERE u.id <> $1 AND u.status = 'active' AND u.suggestable
          AND NOT ${blockedBetween('u.id', '$1')}
          AND NOT EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM social.suggestion_dismissals d WHERE d.user_id = $1 AND d.dismissed_id = u.id)
        ORDER BY mutual DESC, follows_me DESC, followers DESC, u.id DESC
        LIMIT $2`,
      [viewerId, limit],
    );
    return rows.map((r) => ({
      username: r.username,
      displayName: r.display_name,
      isPrivate: r.is_private,
      requested: r.requested,
      followsYou: r.follows_me,
      mutual: r.mutual,
      reason: r.follows_me ? 'Segue-te' : r.mutual > 1 ? `${r.mutual_name} e mais ${r.mutual - 1} seguem` : r.mutual === 1 ? `${r.mutual_name} segue` : 'Novo no txillapp',
    }));
  }

  async dismiss(viewerId: string, username: string) {
    const target = (await this.target(username)).id;
    await this.pool.query('INSERT INTO social.suggestion_dismissals (user_id, dismissed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [viewerId, target]);
  }

  /* ───────────── internos ───────────── */

  private async list(viewerId: string, username: string, kind: 'followers' | 'following', cursor?: string) {
    if (cursor && !UUID.test(cursor)) throw new BadRequestException('cursor inválido');
    await this.assertVisible(viewerId, username);
    await this.assertConnections(viewerId, username);
    const target = (await this.target(username)).id;
    const [self, other] = kind === 'followers' ? ['f.follower_id', 'f.followee_id'] : ['f.followee_id', 'f.follower_id'];
    const limit = 30;
    const { rows } = await this.pool.query(
      `SELECT u.id, u.username, u.display_name,
              EXISTS (SELECT 1 FROM social.follows x WHERE x.follower_id = $1 AND x.followee_id = u.id) AS following,
              EXISTS (SELECT 1 FROM social.follows x WHERE x.follower_id = u.id AND x.followee_id = $1) AS follows_you
         FROM social.follows f JOIN identity.users u ON u.id = ${self}
        WHERE ${other} = $2 AND ($3::uuid IS NULL OR u.id < $3) AND u.status = 'active' AND NOT ${blockedBetween('u.id', '$1')}
        ORDER BY u.id DESC LIMIT $4`,
      [viewerId, target, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((r): PersonItem => ({ username: r.username, displayName: r.display_name, following: r.following, followsYou: r.follows_you })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  private async state(viewerId: string, targetId: string) {
    const { rows } = await this.pool.query(
      `SELECT EXISTS (SELECT 1 FROM social.follows WHERE follower_id = $1 AND followee_id = $2) AS following,
              EXISTS (SELECT 1 FROM social.follow_requests WHERE requester_id = $1 AND target_id = $2) AS requested,
              (SELECT count(*) FROM social.follows WHERE followee_id = $2)::int AS followers`,
      [viewerId, targetId],
    );
    return rows[0] as { following: boolean; requested: boolean; followers: number };
  }

  /** Utilizador activo pelo @. Com `viewerId`, indica também o sentido de um eventual bloqueio. */
  private async target(username: string, viewerId?: string): Promise<{ id: string; is_private: boolean; blockedMe: boolean; blockedByMe: boolean }> {
    const { rows } = await this.pool.query(
      viewerId
        ? `SELECT u.id, u.is_private,
                  EXISTS (SELECT 1 FROM social.blocks b WHERE b.blocker_id = u.id AND b.blocked_id = $2) AS blocked_me,
                  EXISTS (SELECT 1 FROM social.blocks b WHERE b.blocker_id = $2 AND b.blocked_id = u.id) AS blocked_by_me
             FROM identity.users u WHERE u.username = $1 AND u.status = 'active'`
        : `SELECT u.id, u.is_private, false AS blocked_me, false AS blocked_by_me
             FROM identity.users u WHERE u.username = $1 AND u.status = 'active'`,
      viewerId ? [username, viewerId] : [username],
    );
    if (!rows[0]) throw new NotFoundException('Utilizador não encontrado');
    return { id: rows[0].id, is_private: rows[0].is_private, blockedMe: rows[0].blocked_me, blockedByMe: rows[0].blocked_by_me };
  }
}
