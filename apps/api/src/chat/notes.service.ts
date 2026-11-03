import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { blockedBetween } from '../social/visibility';
import { ChatService } from './chat.service';

export type NoteAudience = 'mutual' | 'close_friends';

/** Notas de 24 horas por cima da foto de perfil. Só os seguidores da pessoa as vêem. Não se editam: apaga-se e publica-se outra. */
@Injectable()
export class NotesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly chat: ChatService,
  ) {}

  /** A minha nota (se ainda vale) e as de quem me deixa vê-las. */
  async list(me: string) {
    const { rows } = await this.pool.query(
      `SELECT n.user_id, n.body, n.music, n.audience, n.created_at, n.expires_at, u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar
         FROM social.notes n JOIN identity.users u ON u.id = n.user_id AND u.status = 'active'
        WHERE n.expires_at > now()
          AND (n.user_id = $1 OR (
                NOT ${blockedBetween('u.id', '$1')}
                AND EXISTS (SELECT 1 FROM social.follows a WHERE a.follower_id = $1 AND a.followee_id = u.id)))
        ORDER BY n.created_at DESC LIMIT 60`,
      [me],
    );
    const map = (r: Record<string, unknown>) => ({
      username: r.username as string,
      displayName: r.display_name as string,
      hasAvatar: r.has_avatar as boolean,
      body: r.body as string,
      /** Faixa de licença aberta com o crédito do autor, se a nota leva música. */
      music: (r.music as Record<string, unknown> | null) ?? null,
      audience: r.audience as NoteAudience,
      createdAt: r.created_at as string,
      expiresAt: r.expires_at as string,
    });
    const mine = rows.find((r) => r.user_id === me);
    return { mine: mine ? map(mine) : null, items: rows.filter((r) => r.user_id !== me).map(map) };
  }

  /** Publicar a minha nota (24 horas, para os seguidores). Não se troca: para escrever outra, apaga-se esta primeiro. */
  async set(me: string, body: string, music: Record<string, unknown> | null = null) {
    await this.pool.query('DELETE FROM social.notes WHERE user_id = $1 AND expires_at <= now()', [me]);
    try {
      await this.pool.query(
        `INSERT INTO social.notes (user_id, body, music, audience, created_at, expires_at) VALUES ($1, $2, $3, 'mutual', now(), now() + interval '24 hours')`,
        [me, body.trim(), music ? JSON.stringify(music) : null],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Já tens uma nota. Apaga-a para publicar outra');
      throw e;
    }
  }

  async remove(me: string) {
    await this.pool.query('DELETE FROM social.notes WHERE user_id = $1', [me]);
  }

  /** Responder a uma nota: vai como mensagem normal, a dizer a que nota responde (só quem pode ver a nota). */
  async reply(me: string, username: string, text: string) {
    const visible = (await this.list(me)).items.find((n) => n.username.toLowerCase() === username.toLowerCase());
    if (!visible) throw new NotFoundException('Essa nota já não está disponível');
    return this.chat.send(me, visible.username, { kind: 'text', body: `Em resposta à tua nota “${visible.body || (visible.music as { title?: string } | null)?.title || '♪'}”: ${text.trim()}` });
  }
}
