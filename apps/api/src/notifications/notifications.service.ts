import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { blockedBetween } from '../social/visibility';

export type NotificationKind = 'blocked' | 'follow' | 'follow_request' | 'request_accepted' | 'gift' | 'comment' | 'reply' | 'story_reply' | 'repost';

/** Tipos que não se repetem enquanto houver uma igual por ler (evita spam de seguir/deixar de seguir). */
const DEDUPE_UNREAD = new Set<NotificationKind>(['blocked', 'follow', 'follow_request']);

@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Cria uma notificação. Nunca falha a acção principal: um erro aqui só fica registado.
   * Não notifica a própria pessoa.
   */
  async notify(n: { userId: string; actorId: string; kind: NotificationKind; data?: Record<string, unknown> }): Promise<void> {
    if (n.userId === n.actorId) return;
    try {
      if (DEDUPE_UNREAD.has(n.kind)) {
        const dup = await this.pool.query(
          'SELECT 1 FROM social.notifications WHERE user_id = $1 AND actor_id = $2 AND kind = $3 AND read_at IS NULL',
          [n.userId, n.actorId, n.kind],
        );
        if (dup.rowCount) return;
      }
      await this.pool.query('INSERT INTO social.notifications (id, user_id, actor_id, kind, data) VALUES ($1, $2, $3, $4, $5)', [
        uuidv7(), n.userId, n.actorId, n.kind, n.data ?? {},
      ]);
    } catch (e) {
      this.log.warn(`falha a criar notificação ${n.kind}: ${(e as Error).message}`);
    }
  }

  /** Lista paginada por cursor. O aviso de bloqueio aparece sempre; as outras de quem entretanto foi bloqueado ficam escondidas. */
  async list(userId: string, cursor?: string, limit = 30) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const { rows } = await this.pool.query(
      `SELECT n.id, n.kind, n.data, n.created_at, n.read_at, a.username, a.display_name, a.status
         FROM social.notifications n JOIN identity.users a ON a.id = n.actor_id
        WHERE n.user_id = $1 AND ($2::uuid IS NULL OR n.id < $2)
          AND (n.kind = 'blocked' OR NOT ${blockedBetween('a.id', '$1')})
        ORDER BY n.id DESC LIMIT $3`,
      [userId, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        kind: r.kind as NotificationKind,
        data: r.data,
        createdAt: r.created_at,
        read: r.read_at !== null,
        actor: { username: r.username, displayName: r.status === 'active' ? r.display_name : 'Conta eliminada' },
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  async unreadCount(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM social.notifications n JOIN identity.users a ON a.id = n.actor_id
        WHERE n.user_id = $1 AND n.read_at IS NULL AND (n.kind = 'blocked' OR NOT ${blockedBetween('a.id', '$1')})`,
      [userId],
    );
    return { count: rows[0].n as number };
  }

  async markAllRead(userId: string) {
    await this.pool.query('UPDATE social.notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  }
}
