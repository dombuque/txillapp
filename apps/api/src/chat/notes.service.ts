import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { MusicService, type MusicInput } from '../music/music.service';
import { TextFilter } from '../safety/text-filter.service';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { blockedBetween, notReportedBy } from '../social/visibility';
import { badge } from '../common/badge';
import { PushService } from '../push/push.service';
import { ChatService } from './chat.service';
import { GifsService } from '../gifs/gifs.service';
import { gifForMinor, readGif, type GifInput } from '../gifs/gif';
import { uuidv7 } from '../common/uuid7';
import { Scheduler } from '../realtime/scheduler';
import { ModerationService, type ReportReason } from '../moderation/moderation.service';
import { NOTE_KEEP_AFTER_EXPIRY, noteVisibleTo } from './note-visibility';

export type NoteAudience = 'mutual' | 'close_friends';

/** As cores da bolha da nota (lista fechada, como o CHECK da 0178); sem cor = a bolha branca de sempre. */
export const NOTE_COLORS = ['coral', 'ambar', 'verde', 'ceu', 'noite'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** O local de uma nota: só o nome do sítio (nunca a posição: nem se guarda nem se envia). */
export interface NotePlace { name: string }

/** De quanto em quanto tempo corre a limpeza das notas (apaga as que deixaram de se ver há mais de 24 horas). */
export const NOTES_PURGE_EVERY_MS = 3_600_000;

/** O que a app manda além do texto e da música. */
export interface NoteExtras {
  color?: NoteColor | null;
  place?: { name: string } | null;
  gif?: GifInput | null;
  audience?: NoteAudience;
}

/** Lê o jsonb `place` guardado (defensivo: sem nome, não se mostra). Sai só o nome. */
export function readNotePlace(v: unknown): NotePlace | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p.name !== 'string' || !p.name.trim()) return null;
  return { name: p.name.slice(0, 80) };
}

/** Se a pessoa com o id `id` (SQL) é adulta: 18 anos feitos, com data de nascimento. */
const ADULT_SQL = (id: string) => `EXISTS (SELECT 1 FROM identity.users ad WHERE ad.id = ${id} AND ad.birth_date IS NOT NULL AND ad.birth_date <= (current_date - interval '18 years'))`;

/**
 * Notas de 24 horas por cima da foto de perfil. Só os seguidores da pessoa as vêem. Não se editam: apaga-se e publica-se outra.
 * Às 24 horas deixam de se ver; 24 horas depois a limpeza (`purge`, de hora a hora) apaga-as de vez, com os brindes e os
 * avisos de brinde (ON DELETE CASCADE). As respostas já enviadas ficam nas conversas: são mensagens.
 */
@Injectable()
export class NotesService implements OnModuleInit {
  private readonly log = new Logger('Notas');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly chat: ChatService,
    private readonly filter: TextFilter,
    private readonly musicSvc: MusicService,
    private readonly push: PushService,
    private readonly moderation: ModerationService,
    private readonly scheduler: Scheduler,
    private readonly gifs: GifsService,
  ) {}

  /** A limpeza de hora a hora (só no worker, fora dos testes: aí chama-se `purge()`). */
  onModuleInit() {
    this.scheduler.every('notes.purge', NOTES_PURGE_EVERY_MS, () => this.purge(), { firstAfterMs: 4 * 60_000 });
  }

  /**
   * Apaga de vez as notas que deixaram de se ver há mais de 24 horas (e, pela base de dados, os brindes e os avisos de
   * brinde delas). As denúncias ficam, com a cópia da nota (a prova). Devolve quantas apagou.
   */
  async purge(): Promise<number> {
    const r = await this.pool.query(`DELETE FROM social.notes WHERE expires_at < now() - interval '${NOTE_KEEP_AFTER_EXPIRY}'`);
    const n = r.rowCount ?? 0;
    if (n) this.log.log(`${n} notas antigas apagadas`);
    return n;
  }

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
      `SELECT o.username, o.display_name, o.verified, o.verified_tier, (o.avatar_media_id IS NOT NULL) AS has_avatar, lm.created_at AS last_at
         FROM social.conversations c
         JOIN identity.users o ON o.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END AND o.status = 'active' AND o.id <> $1
         JOIN LATERAL (SELECT created_at FROM social.messages WHERE conversation_id = c.id AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND ((CASE WHEN c.user_a = $1 THEN c.cleared_a ELSE c.cleared_b END) IS NULL OR id > (CASE WHEN c.user_a = $1 THEN c.cleared_a ELSE c.cleared_b END)) ORDER BY id DESC LIMIT 1) lm ON true
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
      ...badge(r.verified, r.verified_tier),
      hasAvatar: r.has_avatar as boolean,
      lastAt: r.last_at as string,
    }));
  }

  /**
   * A nota ativa da outra pessoa, para o cabeçalho da conversa 1:1 (como o recado do WhatsApp por baixo da foto): só se
   * eu a puder ver (as mesmas regras de `visible`, com os bloqueios). A minha própria nota não conta.
   */
  async peerNote(me: string, username: string) {
    const n = (await this.visible(me, username)).items[0];
    return n ? { body: n.body, music: n.music, color: n.color, place: n.place, gif: n.gif, createdAt: n.createdAt, expiresAt: n.expiresAt, cheered: n.cheered } : null;
  }

  /**
   * A bio da outra pessoa, para o mesmo sítio do cabeçalho quando ela não tem nota. Segue a regra do perfil: a bio é do
   * cabeçalho do perfil e vê-a quem abre o perfil, mesmo numa conta privada que não sigo (só as publicações, as stories e
   * as listas ficam escondidas). Aqui, além disso, nada com bloqueio (em qualquer sentido), com a conta inativa ou para
   * mim próprio. Vai tal como está (até 150 caracteres); a app é que a corta.
   */
  async peerBio(me: string, username: string) {
    const { rows } = await this.pool.query(
      `SELECT u.bio FROM identity.users u
        WHERE lower(u.username) = lower($2) AND u.status = 'active' AND u.id <> $1
          AND NOT ${blockedBetween('u.id', '$1')}
          AND char_length(btrim(COALESCE(u.bio, ''))) > 0`,
      [me, username],
    );
    return (rows[0]?.bio as string | undefined) ?? null;
  }

  /**
   * A minha nota (se ainda vale) e as de quem me deixa vê-las (os brindes e as respostas só valem para estas).
   * As regras de quem vê a nota de outra pessoa estão em noteVisibleTo (note-visibility.ts): seguir o autor e, numa nota
   * 'close_friends', estar na lista de amigos próximos dele. A minha vejo-a sempre. Uma nota que denunciei deixa de me
   * aparecer. GIFs: quem é menor de 18 (ou não tem data de nascimento) recebe a nota sem o GIF se a classificação for
   * acima de 'g' ou se faltar (gifForMinor); se a nota era só o GIF, não a recebe.
   * `only` (username) = só a dessa pessoa (e a minha, se for eu).
   */
  private async visible(me: string, only?: string) {
    const { rows } = await this.pool.query(
      `SELECT n.id, n.user_id, n.body, n.music, n.color, n.place, n.gif, n.audience, n.created_at, n.expires_at, u.username, u.display_name, u.verified, u.verified_tier, (u.avatar_media_id IS NOT NULL) AS has_avatar,
              (SELECT count(*)::int FROM social.note_cheers c WHERE c.note_user_id = n.user_id) AS cheers,
              EXISTS (SELECT 1 FROM social.note_cheers c WHERE c.note_user_id = n.user_id AND c.user_id = $1) AS cheered,
              ${ADULT_SQL('$1')} AS viewer_adult
         FROM social.notes n JOIN identity.users u ON u.id = n.user_id AND u.status = 'active'
        WHERE n.expires_at > now()
          AND (n.user_id = $1 OR (${noteVisibleTo('n', 'u', '$1')} AND ${notReportedBy('note', 'n.id', '$1')}))
          AND ($2::text IS NULL OR lower(u.username) = lower($2))
        ORDER BY n.created_at DESC LIMIT 60`,
      [me, only ?? null],
    );
    const gifFor = (r: Record<string, unknown>) => {
      const g = readGif(r.gif);
      return g && (r.viewer_adult || gifForMinor(g.rating)) ? g : null;
    };
    const map = (r: Record<string, unknown>) => ({
      /** O id desta nota (muda a cada nota publicada). */
      id: r.id as string,
      username: r.username as string,
      displayName: r.display_name as string,
      ...badge(r.verified, r.verified_tier),
      hasAvatar: r.has_avatar as boolean,
      body: r.body as string,
      /** Faixa de licença aberta com o crédito do autor, se a nota leva música. */
      music: this.musicSvc.resolve((r.music as Record<string, unknown> | null) ?? null),
      /** A cor da bolha (null = a branca de sempre). */
      color: ((r.color as string | null) ?? null) as NoteColor | null,
      /** O local: { name } (só o nome do sítio). */
      place: readNotePlace(r.place),
      /** O GIF (o formato das mensagens GIF, com a classificação), lido como no chat; a menores, só até 'g'. */
      gif: gifFor(r),
      audience: r.audience as NoteAudience,
      createdAt: r.created_at as string,
      expiresAt: r.expires_at as string,
      cheers: r.cheers as number,
      cheered: r.cheered as boolean,
    });
    const mine = rows.find((r) => r.user_id === me);
    // Uma nota que, sem o GIF, fica sem nada para mostrar não se manda.
    const shown = (n: ReturnType<typeof map>) => !!n.body || !!n.music || !!n.place || !!n.gif;
    return { mine: mine ? map(mine) : null, items: rows.filter((r) => r.user_id !== me).map(map).filter(shown) };
  }

  /**
   * Publicar a minha nota (24 horas, para os seguidores ou só para os amigos próximos). Não se troca: para escrever outra,
   * apaga-se esta primeiro (uma nota que já expirou sai aqui). Do local guarda-se só o nome do sítio, nunca a posição.
   * O GIF guarda a classificação que o GIPHY lhe dá (GifsService.confirm; a da app não conta).
   */
  async set(me: string, body: string, musicIn: MusicInput | null = null, extras: NoteExtras = {}) {
    const placeIn = extras.place ?? null;
    this.filter.assertClean(body, placeIn?.name, musicIn?.title, 'artist' in (musicIn ?? {}) ? (musicIn as { artist?: string }).artist : undefined);
    const music = await this.musicSvc.prepare(me, musicIn);
    const place: NotePlace | null = placeIn ? { name: placeIn.name.trim().slice(0, 80) } : null;
    const gif = extras.gif ? await this.gifs.confirm(me, extras.gif) : null;
    await this.pool.query('DELETE FROM social.notes WHERE user_id = $1 AND expires_at <= now()', [me]);
    try {
      await this.pool.query(
        `INSERT INTO social.notes (id, user_id, body, music, color, place, gif, audience, created_at, expires_at) VALUES ($8, $1, $2, $3, $4, $5, $6, $7, now(), now() + interval '24 hours')`,
        [me, body.trim(), music ? JSON.stringify(music) : null, extras.color ?? null, place ? JSON.stringify(place) : null, gif ? JSON.stringify(gif) : null, extras.audience ?? 'mutual', uuidv7()],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Já tens uma nota. Apaga-a para publicar outra');
      throw e;
    }
  }

  async remove(me: string) {
    await this.pool.query('DELETE FROM social.notes WHERE user_id = $1', [me]);
  }

  /**
   * Brindar a nota de alguém (só quem a pode ver): põe ou tira o meu brinde. O dono é avisado só do primeiro brinde de cada
   * pessoa a esta nota (social.note_cheer_pings): brindar, tirar e voltar a pôr não volta a avisar.
   */
  async cheer(me: string, username: string) {
    const visible = (await this.visible(me, username)).items[0];
    if (!visible) throw new NotFoundException('Essa nota já não está disponível');
    const owner = (await this.pool.query('SELECT id FROM identity.users WHERE lower(username) = lower($1)', [visible.username])).rows[0].id as string;
    const del = await this.pool.query('DELETE FROM social.note_cheers WHERE note_user_id = $1 AND user_id = $2', [owner, me]);
    const cheered = !del.rowCount;
    let first = false;
    if (cheered) {
      await this.pool.query('INSERT INTO social.note_cheers (note_user_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [owner, me]);
      first = !!(await this.pool.query('INSERT INTO social.note_cheer_pings (note_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [visible.id, me])).rowCount;
    }
    if (first) {
      const name = (await this.pool.query('SELECT display_name FROM identity.users WHERE id = $1', [me])).rows[0]?.display_name as string;
      void this.push.send(owner, { title: name, body: 'brindou a tua nota', url: '/messages', tag: `note-cheer:${owner}`, category: 'reactions' });
    }
    const cheers = (await this.pool.query('SELECT count(*)::int AS n FROM social.note_cheers WHERE note_user_id = $1', [owner])).rows[0].n as number;
    return { cheered, cheers };
  }

  /** Responder a uma nota: vai como mensagem normal, a dizer a que nota responde (só quem pode ver a nota). */
  async reply(me: string, username: string, text: string) {
    this.filter.assertClean(text);
    const visible = (await this.visible(me, username)).items[0];
    if (!visible) throw new NotFoundException('Essa nota já não está disponível');
    const label = visible.body || (visible.music as { title?: string } | null)?.title || (visible.gif ? 'GIF' : '') || visible.place?.name || '♪';
    return this.chat.send(me, visible.username, { kind: 'text', body: `Em resposta à tua nota “${label}”: ${text.trim()}` });
  }

  /**
   * Denunciar a nota de alguém (só quem a pode ver; a própria nunca): a fila da moderação ('note', com a cópia da nota como
   * prova), os mesmos motivos e limites das outras denúncias. Quem denuncia deixa de ver essa nota (visible).
   */
  async report(me: string, username: string, reason: ReportReason, note?: string) {
    const visible = (await this.visible(me, username)).items[0];
    if (!visible) {
      const mine = (await this.pool.query('SELECT 1 FROM identity.users WHERE id = $1 AND lower(username) = lower($2)', [me, username])).rowCount;
      if (mine) throw new BadRequestException('Não podes denunciar a tua própria nota');
      throw new NotFoundException('Essa nota já não está disponível');
    }
    await this.moderation.report(me, 'note', visible.id, reason, note);
  }
}
