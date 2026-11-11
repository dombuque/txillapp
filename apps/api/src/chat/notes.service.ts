import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MusicService, type MusicInput } from '../music/music.service';
import { TextFilter } from '../safety/text-filter.service';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { blockedBetween } from '../social/visibility';
import { PushService } from '../push/push.service';
import { ChatService } from './chat.service';

export type NoteAudience = 'mutual' | 'close_friends';

/** Notas de 24 horas por cima da foto de perfil. Só os seguidores da pessoa as vêem. Não se editam: apaga-se e publica-se outra. */
@Injectable()
export class NotesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly chat: ChatService,
    private readonly filter: TextFilter,
    private readonly musicSvc: MusicService,
    private readonly push: PushService,
  ) {}

  /**
   * A faixa das mensagens: a minha nota, as notas que posso ver e, a seguir, as pessoas com quem já conversei
   * (sem nota visível), das conversas mais antigas para as mais recentes.
   */
  async list(me: string) {
    const notes = await this.visible(me);
    return { ...notes, people: await this.people(me, notes.items.map((n) => n.username.toLowerCase())) };
  }

  /**
   * Pessoas das minhas conversas 1:1 em que os dois já escreveram (os pedidos sem resposta não entram), sem bloqueio,
   * com a conta ativa e sem a conversa escondida por mim. Fica de fora quem já aparece pela nota (`skip`, em minúsculas).
   * Ordem: a última mensagem mais antiga primeiro (as conversas que estão mais em baixo na lista).
   */
  private async people(me: string, skip: string[]) {
    const { rows } = await this.pool.query(
      `SELECT o.username, o.display_name, (o.avatar_media_id IS NOT NULL) AS has_avatar, lm.created_at AS last_at
         FROM social.conversations c
         JOIN identity.users o ON o.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END AND o.status = 'active' AND o.id <> $1
         JOIN LATERAL (SELECT created_at FROM social.messages WHERE conversation_id = c.id AND deleted_at IS NULL AND ((CASE WHEN c.user_a = $1 THEN c.cleared_a ELSE c.cleared_b END) IS NULL OR id > (CASE WHEN c.user_a = $1 THEN c.cleared_a ELSE c.cleared_b END)) ORDER BY id DESC LIMIT 1) lm ON true
        WHERE (c.user_a = $1 OR c.user_b = $1)
          AND NOT (CASE WHEN c.user_a = $1 THEN c.hidden_a ELSE c.hidden_b END)
          AND NOT ${blockedBetween('o.id', '$1')}
          AND EXISTS (SELECT 1 FROM social.messages sm WHERE sm.conversation_id = c.id AND sm.sender_id = $1 AND sm.deleted_at IS NULL)
          AND EXISTS (SELECT 1 FROM social.messages om WHERE om.conversation_id = c.id AND om.sender_id = o.id AND om.deleted_at IS NULL)
          AND lower(o.username) <> ALL($2::text[])
        ORDER BY lm.created_at ASC LIMIT 30`,
      [me, skip],
    );
    return rows.map((r) => ({
      username: r.username as string,
      displayName: r.display_name as string,
      hasAvatar: r.has_avatar as boolean,
      lastAt: r.last_at as string,
    }));
  }

  /** A minha nota (se ainda vale) e as de quem me deixa vê-las (os brindes e as respostas só valem para estas). */
  private async visible(me: string) {
    const { rows } = await this.pool.query(
      `SELECT n.user_id, n.body, n.music, n.audience, n.created_at, n.expires_at, u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar,
              (SELECT count(*)::int FROM social.note_cheers c WHERE c.note_user_id = n.user_id) AS cheers,
              EXISTS (SELECT 1 FROM social.note_cheers c WHERE c.note_user_id = n.user_id AND c.user_id = $1) AS cheered
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
      music: this.musicSvc.resolve((r.music as Record<string, unknown> | null) ?? null),
      audience: r.audience as NoteAudience,
      createdAt: r.created_at as string,
      expiresAt: r.expires_at as string,
      cheers: r.cheers as number,
      cheered: r.cheered as boolean,
    });
    const mine = rows.find((r) => r.user_id === me);
    return { mine: mine ? map(mine) : null, items: rows.filter((r) => r.user_id !== me).map(map) };
  }

  /** Publicar a minha nota (24 horas, para os seguidores). Não se troca: para escrever outra, apaga-se esta primeiro. */
  async set(me: string, body: string, musicIn: MusicInput | null = null) {
    this.filter.assertClean(body, musicIn?.title, 'artist' in (musicIn ?? {}) ? (musicIn as { artist?: string }).artist : undefined);
    const music = await this.musicSvc.prepare(me, musicIn);
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

  /** Brindar a nota de alguém (só quem a pode ver): põe ou tira o meu brinde. O dono é avisado só da primeira vez. */
  async cheer(me: string, username: string) {
    const visible = (await this.visible(me)).items.find((n) => n.username.toLowerCase() === username.toLowerCase());
    if (!visible) throw new NotFoundException('Essa nota já não está disponível');
    const owner = (await this.pool.query('SELECT id FROM identity.users WHERE lower(username) = lower($1)', [visible.username])).rows[0].id as string;
    const del = await this.pool.query('DELETE FROM social.note_cheers WHERE note_user_id = $1 AND user_id = $2', [owner, me]);
    const cheered = !del.rowCount;
    if (cheered) {
      await this.pool.query('INSERT INTO social.note_cheers (note_user_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [owner, me]);
      const name = (await this.pool.query('SELECT display_name FROM identity.users WHERE id = $1', [me])).rows[0]?.display_name as string;
      void this.push.send(owner, { title: name, body: 'brindou a tua nota', url: '/messages', tag: `note-cheer:${owner}`, category: 'reactions' });
    }
    const cheers = (await this.pool.query('SELECT count(*)::int AS n FROM social.note_cheers WHERE note_user_id = $1', [owner])).rows[0].n as number;
    return { cheered, cheers };
  }

  /** Responder a uma nota: vai como mensagem normal, a dizer a que nota responde (só quem pode ver a nota). */
  async reply(me: string, username: string, text: string) {
    this.filter.assertClean(text);
    const visible = (await this.visible(me)).items.find((n) => n.username.toLowerCase() === username.toLowerCase());
    if (!visible) throw new NotFoundException('Essa nota já não está disponível');
    return this.chat.send(me, visible.username, { kind: 'text', body: `Em resposta à tua nota “${visible.body || (visible.music as { title?: string } | null)?.title || '♪'}”: ${text.trim()}` });
  }
}
