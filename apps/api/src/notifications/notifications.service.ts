import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { PushService, type NotifyCategory } from '../push/push.service';
import { allowedBy, blockedBetween, canView } from '../social/visibility';

/** @utilizador num texto (o @ não pode vir colado a letras, para não apanhar e-mails). */
export const MENTION_RE = /(?<![\w.])@([a-zA-Z0-9_.]{3,30})/g;
export const extractMentions = (text: string) => [...new Set([...text.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase().replace(/\.+$/, '')))].slice(0, 10);

/**
 * Quem pode ser mencionado por `$1`: conta activa, sem bloqueio, que aceita menções (definição) e
 * (eu sigo a pessoa OU a conta é pública). Fonte única da regra, usada nas sugestões e nas notificações.
 */
export const mentionableBy = (u = 'u', viewer = '$1') =>
  `(${u}.id <> ${viewer} AND ${u}.status = 'active' AND NOT ${blockedBetween(`${u}.id`, viewer)} AND ${allowedBy(u, 'mentions_allowed', viewer)} AND ` +
  `(NOT ${u}.is_private OR EXISTS (SELECT 1 FROM social.follows mf WHERE mf.follower_id = ${viewer} AND mf.followee_id = ${u}.id)))`;

export type NotificationKind = 'blocked' | 'follow' | 'follow_request' | 'request_accepted' | 'gift' | 'comment' | 'reply' | 'story_reply' | 'repost' | 'mention' | 'tag' | 'verified';

/** A categoria que a pessoa pode desligar (os avisos de bloqueio e de verificação ficam sempre). */
export const CATEGORY_OF: Partial<Record<NotificationKind, NotifyCategory>> = {
  follow: 'follows', follow_request: 'follows', request_accepted: 'follows',
  comment: 'comments', reply: 'comments', story_reply: 'comments',
  mention: 'mentions', tag: 'mentions', repost: 'reposts', gift: 'gifts',
};

/** Tipos que não se repetem enquanto houver uma igual por ler (evita spam de seguir/deixar de seguir). */
const DEDUPE_UNREAD = new Set<NotificationKind>(['blocked', 'follow', 'follow_request']);

@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly push: PushService,
  ) {}

  /**
   * Cria uma notificação. Nunca falha a acção principal: um erro aqui só fica registado.
   * Não notifica a própria pessoa.
   */
  async notify(n: { userId: string; actorId: string; kind: NotificationKind; data?: Record<string, unknown> }): Promise<void> {
    if (n.userId === n.actorId) return;
    try {
      // Categoria desligada: nem na lista nem no telemóvel (os pedidos de seguir ficam sempre na lista, porque têm botões).
      const cat = CATEGORY_OF[n.kind];
      if (cat && n.kind !== 'follow_request' && (await this.push.off(n.userId)).includes(cat)) return;
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
      void this.pushFor(n);
    } catch (e) {
      this.log.warn(`falha a criar notificação ${n.kind}: ${(e as Error).message}`);
    }
  }

  /** Também no telemóvel. O título é quem fez a ação (o iPhone já diz que é do Txillapp) e o texto é genérico: nunca leva o conteúdo (o ecrã de bloqueio é público). */
  private async pushFor(n: { userId: string; actorId: string; kind: NotificationKind; data?: Record<string, unknown> }) {
    if (!this.push.enabled) return;
    const a = (await this.pool.query('SELECT display_name, username FROM identity.users WHERE id = $1', [n.actorId])).rows[0];
    const profile = a?.username ? `/u/${a.username as string}` : '/notifications';
    const who = (a?.display_name as string | undefined) ?? 'Alguém';
    const postId = n.data?.postId as string | undefined;
    const t: Partial<Record<NotificationKind, { body: string; url: string }>> = {
      follow: { body: 'começou a seguir-te', url: profile },
      follow_request: { body: 'quer seguir-te', url: '/notifications' },
      request_accepted: { body: 'aceitou o teu pedido', url: profile },
      gift: { body: 'presenteou-te', url: '/wallet' },
      comment: { body: 'comentou a tua publicação', url: postId ? `/p/${postId}?comments=1` : '/notifications' },
      reply: { body: 'respondeu ao teu comentário', url: postId ? `/p/${postId}?comments=1` : '/notifications' },
      repost: { body: 'repostou a tua publicação', url: postId ? `/p/${postId}` : '/notifications' },
      mention: { body: 'mencionou-te', url: postId ? `/p/${postId}` : '/notifications' },
      tag: { body: 'identificou-te numa foto', url: postId ? `/p/${postId}` : '/notifications' },
      story_reply: { body: 'respondeu ao teu story', url: n.data?.replyKind === 'comment' ? '/profile' : a?.username ? `/messages/${a.username as string}` : '/notifications' },
      verified: { body: 'agora tem a conta verificada', url: profile },
    };
    const m = t[n.kind];
    if (m) await this.push.send(n.userId, { title: who, body: m.body, url: m.url, tag: `${n.kind}:${n.actorId}`, category: CATEGORY_OF[n.kind] });
  }

  /** Avisa as pessoas mencionadas em `text` que o autor pode mencionar e que podem ver o conteúdo dele. */
  async notifyMentions(authorId: string, text: string, data: Record<string, unknown>): Promise<void> {
    const names = extractMentions(text);
    if (!names.length) return;
    try {
      const { rows } = await this.pool.query(
        `SELECT u.id FROM identity.users u, identity.users au
          WHERE au.id = $1 AND lower(u.username) = ANY($2) AND ${mentionableBy('u', '$1')} AND ${canView('au', 'u.id')}`,
        [authorId, names],
      );
      for (const r of rows) await this.notify({ userId: r.id, actorId: authorId, kind: 'mention', data });
    } catch (e) {
      this.log.warn(`falha a notificar menções: ${(e as Error).message}`);
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
