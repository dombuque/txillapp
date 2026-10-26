import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { PushService } from '../push/push.service';
import { MediaService } from '../media/media.service';
import { allowedBy, blockedBetween } from '../social/visibility';
import { ChatEvents } from './chat.events';

export type MessageKind = 'text' | 'story_reply' | 'story_reaction' | 'image' | 'voice';
const PAGE = 40;

/** Os dois ids por ordem fixa (user_a < user_b), para haver uma só conversa por par. */
const pair = (x: string, y: string) => (x < y ? ([x, y] as const) : ([y, x] as const));

export interface Outgoing {
  body: string;
  kind: 'text' | 'image' | 'voice';
  mediaId?: string;
  durationMs?: number;
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly media: MediaService,
    private readonly events: ChatEvents,
    private readonly push: PushService,
  ) {}

  private async userByName(username: string) {
    const { rows } = await this.pool.query(
      `SELECT id, username, display_name, status, (avatar_media_id IS NOT NULL) AS has_avatar FROM identity.users WHERE lower(username) = lower($1)`,
      [username],
    );
    if (!rows[0] || rows[0].status !== 'active') throw new NotFoundException('Pessoa não encontrada');
    return rows[0] as { id: string; username: string; display_name: string; has_avatar: boolean };
  }

  private async usernameOf(id: string) {
    return (await this.pool.query('SELECT username FROM identity.users WHERE id = $1', [id])).rows[0].username as string;
  }

  private async conversation(a: string, b: string, create: boolean): Promise<string | null> {
    const [x, y] = pair(a, b);
    const found = await this.pool.query('SELECT id FROM social.conversations WHERE user_a = $1 AND user_b = $2', [x, y]);
    if (found.rows[0]) return found.rows[0].id as string;
    if (!create) return null;
    const id = uuidv7();
    await this.pool.query('INSERT INTO social.conversations (id, user_a, user_b) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, x, y]);
    return (await this.conversation(a, b, false))!;
  }

  /** Conversas, da mais recente para a mais antiga, com a última mensagem e quantas por ler. */
  async list(me: string) {
    const { rows } = await this.pool.query(
      `SELECT c.id, o.username, o.display_name, (o.avatar_media_id IS NOT NULL) AS has_avatar, o.status,
              lm.body AS last_body, lm.kind AS last_kind, lm.sender_id AS last_sender, lm.created_at AS last_at,
              (SELECT count(*) FROM social.messages m
                WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.deleted_at IS NULL
                  AND (CASE WHEN c.user_a = $1 THEN c.read_a ELSE c.read_b END IS NULL
                       OR m.id > (CASE WHEN c.user_a = $1 THEN c.read_a ELSE c.read_b END)))::int AS unread
         FROM social.conversations c
         JOIN identity.users o ON o.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
         JOIN LATERAL (SELECT body, kind, sender_id, created_at FROM social.messages WHERE conversation_id = c.id AND deleted_at IS NULL ORDER BY id DESC LIMIT 1) lm ON true
        WHERE (c.user_a = $1 OR c.user_b = $1) AND NOT ${blockedBetween('o.id', '$1')}
        ORDER BY lm.created_at DESC LIMIT 100`,
      [me],
    );
    return rows.map((r) => ({
      username: r.username,
      displayName: r.status === 'active' ? r.display_name : 'Conta eliminada',
      hasAvatar: r.has_avatar,
      lastMessage: {
        body: r.last_body as string,
        kind: r.last_kind as MessageKind,
        fromMe: r.last_sender === me,
        at: r.last_at as string,
      },
      unread: r.unread as number,
    }));
  }

  /** Quantas conversas têm mensagens por ler (o ponto no ícone das mensagens). */
  async unread(me: string) {
    const list = await this.list(me);
    return { conversations: list.filter((c) => c.unread > 0).length };
  }

  /** Mensagens da conversa (as mais recentes primeiro, por cursor). Abrir marca como lidas e avisa o outro lado. */
  async thread(me: string, username: string, cursor?: string) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const other = await this.userByName(username);
    const person = { username: other.username, displayName: other.display_name, hasAvatar: other.has_avatar };
    const blocked = (await this.pool.query(`SELECT ${blockedBetween('$2::uuid', '$1::uuid')} AS b`, [me, other.id])).rows[0].b as boolean;
    const conv = await this.conversation(me, other.id, false);
    if (!conv) return { person, blocked, otherRead: null, items: [], nextCursor: null };
    const { rows } = await this.pool.query(
      `SELECT m.id, m.sender_id, m.body, m.kind, m.story_media_id, m.media_id, m.duration_ms, m.created_at FROM social.messages m
        WHERE m.conversation_id = $1 AND m.deleted_at IS NULL AND ($2::uuid IS NULL OR m.id < $2) ORDER BY m.id DESC LIMIT $3`,
      [conv, cursor ?? null, PAGE + 1],
    );
    const page = rows.slice(0, PAGE);
    if (!cursor && page[0]) {
      const upd = await this.pool.query(
        `UPDATE social.conversations SET read_a = CASE WHEN user_a = $2 THEN $3::uuid ELSE read_a END, read_b = CASE WHEN user_b = $2 THEN $3::uuid ELSE read_b END
          WHERE id = $1 AND (CASE WHEN user_a = $2 THEN read_a ELSE read_b END IS DISTINCT FROM $3::uuid)`,
        [conv, me, page[0].id],
      );
      if (upd.rowCount) this.events.emit(other.id, { type: 'read', from: await this.usernameOf(me) });
    }
    const reads = (await this.pool.query('SELECT user_a, read_a, read_b FROM social.conversations WHERE id = $1', [conv])).rows[0];
    const otherRead = (reads.user_a === me ? reads.read_b : reads.read_a) as string | null;
    return {
      person,
      blocked,
      /** Último id que a outra pessoa já leu ("Visto" nas minhas mensagens até aqui). */
      otherRead,
      items: page.map((m) => ({
        id: m.id as string,
        fromMe: m.sender_id === me,
        body: m.body as string,
        kind: m.kind as MessageKind,
        storyUrl: m.story_media_id ? `/api/v1/media/${m.story_media_id}` : null,
        mediaUrl: m.media_id ? this.media.chatUrl(m.media_id) : null,
        durationMs: m.duration_ms as number | null,
        at: m.created_at as string,
      })),
      nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
    };
  }

  /** Mensagem normal: precisa de não haver bloqueio e de a pessoa aceitar mensagens (ou já existir conversa). */
  async send(me: string, username: string, msg: Outgoing) {
    const other = await this.userByName(username);
    if (other.id === me) throw new BadRequestException('Não podes enviar mensagens a ti próprio');
    const ok = await this.pool.query(
      `SELECT ${blockedBetween('u.id', '$1')} AS blocked, ${allowedBy('u', 'dms_allowed')} AS allowed,
              EXISTS (SELECT 1 FROM social.conversations c WHERE c.user_a = LEAST($1::uuid, u.id) AND c.user_b = GREATEST($1::uuid, u.id)) AS spoke
         FROM identity.users u WHERE u.id = $2`,
      [me, other.id],
    );
    const r = ok.rows[0];
    if (r.blocked) throw new ForbiddenException('Não podes enviar mensagens a esta pessoa');
    if (!r.allowed && !r.spoke) throw new ForbiddenException('Esta pessoa não aceita mensagens novas');

    if (msg.kind === 'text') {
      if (!msg.body.trim()) throw new BadRequestException('Mensagem vazia');
    } else {
      if (!msg.mediaId) throw new BadRequestException('Falta o ficheiro');
      // Só ficheiros do chat, do próprio, já carregados, do tipo certo e ainda não usados.
      const a = await this.pool.query(
        `SELECT mime FROM content.media_assets a
          WHERE a.id = $1 AND a.owner_id = $2 AND a.purpose = 'chat' AND a.status = 'ready'
            AND NOT EXISTS (SELECT 1 FROM social.messages m WHERE m.media_id = a.id)`,
        [msg.mediaId, me],
      );
      const mime = a.rows[0]?.mime as string | undefined;
      if (!mime || (msg.kind === 'image') !== mime.startsWith('image/')) throw new BadRequestException('Ficheiro inválido');
    }
    return this.insert(me, other.id, msg.body, msg.kind, null, msg.mediaId ?? null, msg.durationMs ?? null);
  }

  /** Resposta/reacção a um story: já foi autorizada pela definição de respostas do autor. */
  async sendStoryReply(me: string, recipientId: string, body: string, kind: 'story_reply' | 'story_reaction', storyMediaId: string) {
    return this.insert(me, recipientId, body, kind, storyMediaId, null, null);
  }

  /** Apagar para todos (só quem enviou): a mensagem desaparece da conversa, sem deixar rasto visível. */
  async remove(me: string, messageId: string) {
    const { rows } = await this.pool.query(
      `UPDATE social.messages m SET deleted_at = now(), body = '', media_id = NULL, story_media_id = NULL
        WHERE m.id = $1 AND m.sender_id = $2 AND m.deleted_at IS NULL
       RETURNING (SELECT CASE WHEN c.user_a = $2 THEN c.user_b ELSE c.user_a END FROM social.conversations c WHERE c.id = m.conversation_id) AS other`,
      [messageId, me],
    );
    if (!rows[0]) throw new NotFoundException('Mensagem não encontrada');
    this.events.emit(rows[0].other, { type: 'deleted', from: await this.usernameOf(me) });
  }

  /** "A escrever…": não é guardado, só chega a quem tem a conversa aberta. */
  async typing(me: string, username: string) {
    const other = await this.userByName(username);
    const blocked = (await this.pool.query(`SELECT ${blockedBetween('$2::uuid', '$1::uuid')} AS b`, [me, other.id])).rows[0].b as boolean;
    if (blocked || !(await this.conversation(me, other.id, false))) return;
    this.events.emit(other.id, { type: 'typing', from: await this.usernameOf(me) });
  }

  private async insert(me: string, other: string, body: string, kind: MessageKind, storyMediaId: string | null, mediaId: string | null, durationMs: number | null) {
    const conv = await this.conversation(me, other, true);
    const id = uuidv7();
    await this.pool.query(
      'INSERT INTO social.messages (id, conversation_id, sender_id, body, kind, story_media_id, media_id, duration_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, conv, me, body, kind, storyMediaId, mediaId, durationMs],
    );
    await this.pool.query(
      `UPDATE social.conversations SET last_message_at = now(),
              read_a = CASE WHEN user_a = $2 THEN $3::uuid ELSE read_a END, read_b = CASE WHEN user_b = $2 THEN $3::uuid ELSE read_b END WHERE id = $1`,
      [conv, me, id],
    );
    const from = await this.usernameOf(me);
    this.events.emit(other, { type: 'message', from });
    // Também no telemóvel, sem o texto da mensagem.
    const sender = (await this.pool.query('SELECT display_name FROM identity.users WHERE id = $1', [me])).rows[0].display_name as string;
    void this.push.send(other, { title: 'Txillapp', body: `${sender} enviou-te uma mensagem`, url: `/messages/${from}`, tag: `chat:${me}` });
    return { id, kind };
  }
}
