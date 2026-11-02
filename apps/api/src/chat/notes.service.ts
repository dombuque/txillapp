import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { blockedBetween } from '../social/visibility';
import { ChatService } from './chat.service';

export type NoteAudience = 'mutual' | 'close_friends';

/** Notas de 24 horas por cima da foto de perfil. Só quem a pessoa escolhe as vê (quem segue de volta, ou os amigos próximos). */
@Injectable()
export class NotesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly chat: ChatService,
  ) {}

  /** A minha nota (se ainda vale) e as de quem me deixa vê-las. */
  async list(me: string) {
    const { rows } = await this.pool.query(
      `SELECT n.user_id, n.body, n.audience, n.created_at, n.expires_at, u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar
         FROM social.notes n JOIN identity.users u ON u.id = n.user_id AND u.status = 'active'
        WHERE n.expires_at > now()
          AND (n.user_id = $1 OR (
                NOT ${blockedBetween('u.id', '$1')}
                AND ((n.audience = 'mutual' AND EXISTS (SELECT 1 FROM social.follows a WHERE a.follower_id = $1 AND a.followee_id = u.id)
                                            AND EXISTS (SELECT 1 FROM social.follows b WHERE b.follower_id = u.id AND b.followee_id = $1))
                  OR (n.audience = 'close_friends' AND EXISTS (SELECT 1 FROM social.close_friends cf WHERE cf.owner_id = u.id AND cf.friend_id = $1)))))
        ORDER BY n.created_at DESC LIMIT 60`,
      [me],
    );
    const map = (r: Record<string, unknown>) => ({
      username: r.username as string,
      displayName: r.display_name as string,
      hasAvatar: r.has_avatar as boolean,
      body: r.body as string,
      audience: r.audience as NoteAudience,
      createdAt: r.created_at as string,
      expiresAt: r.expires_at as string,
    });
    const mine = rows.find((r) => r.user_id === me);
    return { mine: mine ? map(mine) : null, items: rows.filter((r) => r.user_id !== me).map(map) };
  }

  /** Criar ou trocar a minha nota (recomeça as 24 horas). */
  async set(me: string, body: string, audience: NoteAudience) {
    await this.pool.query(
      `INSERT INTO social.notes (user_id, body, audience, created_at, expires_at) VALUES ($1, $2, $3, now(), now() + interval '24 hours')
       ON CONFLICT (user_id) DO UPDATE SET body = $2, audience = $3, created_at = now(), expires_at = now() + interval '24 hours'`,
      [me, body.trim(), audience],
    );
  }

  async remove(me: string) {
    await this.pool.query('DELETE FROM social.notes WHERE user_id = $1', [me]);
  }

  /** Responder a uma nota: vai como mensagem normal, a dizer a que nota responde (só quem pode ver a nota). */
  async reply(me: string, username: string, text: string) {
    const visible = (await this.list(me)).items.find((n) => n.username.toLowerCase() === username.toLowerCase());
    if (!visible) throw new NotFoundException('Essa nota já não está disponível');
    return this.chat.send(me, visible.username, { kind: 'text', body: `Em resposta à tua nota “${visible.body}”: ${text.trim()}` });
  }
}
