import { BadRequestException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { PostsService } from '../posts/posts.service';
import { PushService } from '../push/push.service';
import { MediaService } from '../media/media.service';
import { allowedBy, blockedBetween } from '../social/visibility';
import { ChatEvents } from './chat.events';

export type MessageKind = 'text' | 'story_reply' | 'story_reaction' | 'image' | 'voice' | 'sticker' | 'location' | 'post' | 'gift';

/** Stickers que existem (o desenho está na app; aqui só se confirma que o id é válido). */
export const STICKERS = ['bora', 'fixe', 'ja-vou', 'a-caminho', 'paga', 'saude', 'saudades', 'obrigado', 'parabens', 'ups', 'dormir', 'fome', 'festa', 'amor', 'rir', 'ok'] as const;
const PAGE = 40;

/** Os dois ids por ordem fixa (user_a < user_b), para haver uma só conversa por par. */
/** Quantas mensagens se podem mandar a quem não nos segue, antes de a pessoa responder, aceitar ou seguir de volta. */
export const STRANGER_LIMIT = 3;

const pair = (x: string, y: string) => (x < y ? ([x, y] as const) : ([y, x] as const));

export interface Outgoing {
  body: string;
  kind: 'text' | 'image' | 'voice' | 'sticker' | 'location' | 'post' | 'gift';
  mediaId?: string;
  durationMs?: number;
  waveform?: string;
  lat?: number;
  lng?: number;
  /** Visualização única (texto, foto ou voz, só em conversas diretas). */
  once?: boolean;
  /** Localização em direto durante estes minutos (15, 60 ou 480). */
  liveMinutes?: number;
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly media: MediaService,
    private readonly events: ChatEvents,
    private readonly push: PushService,
    private readonly posts: PostsService,
  ) {}

  private async userByName(username: string) {
    const { rows } = await this.pool.query(
      `SELECT id, username, display_name, status, (avatar_media_id IS NOT NULL) AS has_avatar FROM identity.users WHERE lower(username) = lower($1)`,
      [username],
    );
    if (!rows[0] || rows[0].status !== 'active') throw new NotFoundException('Pessoa não encontrada');
    return rows[0] as { id: string; username: string; display_name: string; has_avatar: boolean };
  }

  /**
   * Relação entre duas pessoas numa conversa (a política de mensagens de quem não se segue):
   *  - `request`: para mim, é um pedido de mensagem (não sigo a pessoa, ela escreveu, e eu ainda não respondi nem aceitei);
   *  - `left`: quantas mensagens ainda posso mandar a quem não me segue e ainda não interagiu (null = sem limite).
   */
  async relationOf(me: string, otherId: string, conv: string | null) {
    const f = (
      await this.pool.query(
        `SELECT EXISTS (SELECT 1 FROM social.follows WHERE follower_id = $1 AND followee_id = $2) AS i_follow,
                EXISTS (SELECT 1 FROM social.follows WHERE follower_id = $2 AND followee_id = $1) AS they_follow`,
        [me, otherId],
      )
    ).rows[0];
    let sentByMe = 0;
    let sentByThem = 0;
    let acceptedMe = false;
    let acceptedThem = false;
    let hidden = false;
    if (conv) {
      const r = (
        await this.pool.query(
          `SELECT (SELECT count(*) FROM social.messages WHERE conversation_id = c.id AND sender_id = $2 AND deleted_at IS NULL)::int AS mine,
                  (SELECT count(*) FROM social.messages WHERE conversation_id = c.id AND sender_id = $3 AND deleted_at IS NULL)::int AS theirs,
                  c.user_a, c.accepted_a, c.accepted_b, c.hidden_a, c.hidden_b
             FROM social.conversations c WHERE c.id = $1`,
          [conv, me, otherId],
        )
      ).rows[0];
      if (r) {
        const iAmA = r.user_a === me;
        sentByMe = r.mine;
        sentByThem = r.theirs;
        acceptedMe = iAmA ? r.accepted_a : r.accepted_b;
        acceptedThem = iAmA ? r.accepted_b : r.accepted_a;
        hidden = iAmA ? r.hidden_a : r.hidden_b;
      }
    }
    const iFollow = f.i_follow as boolean;
    const theyFollow = f.they_follow as boolean;
    return {
      iFollow,
      theyFollow,
      hidden,
      request: !iFollow && sentByMe === 0 && !acceptedMe && sentByThem > 0,
      left: !theyFollow && sentByThem === 0 && !acceptedThem ? Math.max(0, STRANGER_LIMIT - sentByMe) : null,
    };
  }

  /** Aceitar o pedido: a conversa passa para a lista normal. */
  async accept(me: string, username: string) {
    const other = await this.userByName(username);
    const conv = await this.conversation(me, other.id, false);
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    await this.pool.query(
      `UPDATE social.conversations SET accepted_a = CASE WHEN user_a = $2 THEN true ELSE accepted_a END, accepted_b = CASE WHEN user_b = $2 THEN true ELSE accepted_b END,
              hidden_a = CASE WHEN user_a = $2 THEN false ELSE hidden_a END, hidden_b = CASE WHEN user_b = $2 THEN false ELSE hidden_b END WHERE id = $1`,
      [conv, me],
    );
  }

  /** Recusar o pedido: some da minha lista e deixo de receber avisos desta conversa (a outra pessoa não é avisada). */
  async decline(me: string, username: string) {
    const other = await this.userByName(username);
    const conv = await this.conversation(me, other.id, false);
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    await this.pool.query(
      `UPDATE social.conversations SET hidden_a = CASE WHEN user_a = $2 THEN true ELSE hidden_a END, hidden_b = CASE WHEN user_b = $2 THEN true ELSE hidden_b END WHERE id = $1`,
      [conv, me],
    );
  }

  /** Hora a que a pessoa foi vista pela última vez (ao abrir e fechar a app). */
  async touchSeen(userId: string) {
    await this.pool.query('UPDATE identity.users SET last_seen_at = now() WHERE id = $1', [userId]).catch(() => undefined);
  }

  /** Online / visto há…: só se as duas pessoas mostram a presença (quem esconde a sua também não vê a dos outros). */
  private async presenceOf(me: string, otherId: string) {
    const { rows } = await this.pool.query(
      'SELECT o.show_presence AS o_show, o.last_seen_at, m.show_presence AS m_show FROM identity.users o, identity.users m WHERE o.id = $2 AND m.id = $1',
      [me, otherId],
    );
    const r = rows[0];
    if (!r || !r.o_show || !r.m_show) return null;
    return { online: this.events.isOnline(otherId), lastSeen: (r.last_seen_at as string | null) ?? null };
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
      `SELECT c.id, o.id AS other_id, o.username, o.display_name, (o.avatar_media_id IS NOT NULL) AS has_avatar, o.status, o.show_presence AS o_show, o.last_seen_at,
              lm.body AS last_body, lm.view_once AS last_once, lm.kind AS last_kind, lm.sender_id AS last_sender, lm.created_at AS last_at,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = o.id) AS i_follow,
              (SELECT count(*) FROM social.messages sm WHERE sm.conversation_id = c.id AND sm.sender_id = $1 AND sm.deleted_at IS NULL)::int AS sent_by_me,
              (CASE WHEN c.user_a = $1 THEN c.accepted_a ELSE c.accepted_b END) AS accepted,
              (SELECT count(*) FROM social.messages m
                WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.deleted_at IS NULL
                  AND (CASE WHEN c.user_a = $1 THEN c.read_a ELSE c.read_b END IS NULL
                       OR m.id > (CASE WHEN c.user_a = $1 THEN c.read_a ELSE c.read_b END)))::int AS unread
         FROM social.conversations c
         JOIN identity.users o ON o.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
         JOIN LATERAL (SELECT body, kind, sender_id, created_at, view_once FROM social.messages WHERE conversation_id = c.id AND deleted_at IS NULL ORDER BY id DESC LIMIT 1) lm ON true
        WHERE (c.user_a = $1 OR c.user_b = $1) AND NOT ${blockedBetween('o.id', '$1')}
          AND NOT (CASE WHEN c.user_a = $1 THEN c.hidden_a ELSE c.hidden_b END)
        ORDER BY lm.created_at DESC LIMIT 100`,
      [me],
    );
    const iShow = (await this.pool.query('SELECT show_presence FROM identity.users WHERE id = $1', [me])).rows[0]?.show_presence !== false;
    return rows.map((r) => ({
      username: r.username,
      presence: iShow && r.o_show && r.status === 'active' ? { online: this.events.isOnline(r.other_id as string), lastSeen: (r.last_seen_at as string | null) ?? null } : null,
      displayName: r.status === 'active' ? r.display_name : 'Conta eliminada',
      hasAvatar: r.has_avatar,
      lastMessage: {
        body: r.last_once ? '' : (r.last_body as string),
        once: !!r.last_once,
        kind: r.last_kind as MessageKind,
        fromMe: r.last_sender === me,
        at: r.last_at as string,
      },
      /** Pedido de mensagem: quem escreveu não é seguido por mim, eu ainda não respondi nem aceitei. */
      request: !r.i_follow && r.sent_by_me === 0 && !r.accepted && r.last_sender !== me,
      unread: r.unread as number,
    }));
  }

  /** Quantas conversas têm mensagens por ler (o ponto no ícone das mensagens). */
  async unread(me: string) {
    // Os pedidos de mensagem não contam para o número do ícone: só aparecem na caixa de pedidos.
    const list = await this.list(me);
    return { conversations: list.filter((c) => c.unread > 0 && !c.request).length, requests: list.filter((c) => c.request).length };
  }

  /** Mensagens da conversa (as mais recentes primeiro, por cursor). Abrir marca como lidas e avisa o outro lado. */
  async thread(me: string, username: string, cursor?: string) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const other = await this.userByName(username);
    const blocked = (await this.pool.query(`SELECT ${blockedBetween('$2::uuid', '$1::uuid')} AS b`, [me, other.id])).rows[0].b as boolean;
    // Só se sugere presentear quem se segue, que aceita presentes, sem bloqueio (as mesmas regras de presentear).
    const g = (
      await this.pool.query(
        `SELECT ${allowedBy('u', 'gifts_allowed', '$1')} AS allowed, EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS following FROM identity.users u WHERE u.id = $2`,
        [me, other.id],
      )
    ).rows[0];
    const person = { username: other.username, displayName: other.display_name, hasAvatar: other.has_avatar, canGift: !blocked && !!g?.allowed && !!g?.following, presence: blocked ? null : await this.presenceOf(me, other.id) };
    const conv = await this.conversation(me, other.id, false);
    const rel = await this.relationOf(me, other.id, conv);
    const relation = { iFollow: rel.iFollow, theyFollow: rel.theyFollow, request: rel.request, left: rel.left };
    if (!conv) return { person, blocked, relation, otherRead: null, items: [], nextCursor: null };
    const { rows } = await this.pool.query(
      `SELECT m.id, m.sender_id, m.body, m.kind, m.story_media_id, m.media_id, m.duration_ms, m.waveform, m.lat, m.lng, m.view_once, m.viewed_at, m.live_until, m.gift_amount, m.created_at FROM social.messages m
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
      relation,
      /** Último id que a outra pessoa já leu ("Visto" nas minhas mensagens até aqui). */
      otherRead,
      items: await this.mapItems(me, page),
      nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
    };
  }

  /** Linhas de mensagens → o que a app recebe (ficheiros com URL temporário, publicações partilhadas com os dados de quem as vê). */
  async mapItems(me: string, page: Record<string, any>[]) {
    return Promise.all(
      page.map(async (m) => ({
        id: m.id as string,
        fromMe: m.sender_id === me,
        // Visualização única: o conteúdo nunca vai na lista (nem para quem enviou); só se lê ao abrir, uma vez.
        body: m.view_once ? '' : (m.body as string),
        kind: m.kind as MessageKind,
        viewOnce: !!m.view_once,
        opened: !!m.viewed_at,
        storyUrl: m.story_media_id ? `/api/v1/media/${m.story_media_id}` : null,
        mediaUrl: m.media_id && !m.view_once ? this.media.chatUrl(m.media_id) : null,
        durationMs: m.duration_ms as number | null,
        waveform: m.view_once ? null : ((m.waveform as string | null) ?? null),
        lat: (m.lat as number | null) ?? null,
        lng: (m.lng as number | null) ?? null,
        /** Presente enviado na conversa: quanto (a nota vai no texto). */
        giftAmount: (m.gift_amount as number | null) ?? null,
        /** Localização em direto ainda a decorrer. */
        live: !!m.live_until && new Date(m.live_until as string).getTime() > Date.now(),
        liveUntil: (m.live_until as string | null) ?? null,
        // Publicação partilhada: o cartão mostra-se com os dados de quem a vê agora (null se já não a pode ver).
        post: m.kind === 'post' ? await this.posts.getOne(me, m.body as string).catch(() => null) : undefined,
        at: m.created_at as string,
      })),
    );
  }

  /** Valida o conteúdo de uma mensagem (texto, sticker, publicação, localização ou ficheiro do chat) e devolve a localização arredondada, se houver. */
  async validateOutgoing(me: string, msg: Outgoing): Promise<{ lat: number; lng: number } | null> {
    if (msg.kind === 'text') {
      if (!msg.body.trim()) throw new BadRequestException('Mensagem vazia');
    } else if (msg.kind === 'sticker') {
      if (!(STICKERS as readonly string[]).includes(msg.body)) throw new BadRequestException('Sticker inválido');
    } else if (msg.kind === 'post') {
      // Só se partilha o que quem envia pode ver (e que ainda existe).
      if (!/^[0-9a-f-]{36}$/.test(msg.body)) throw new BadRequestException('Publicação inválida');
      await this.posts.getOne(me, msg.body);
    } else if (msg.kind === 'location') {
      if (typeof msg.lat !== 'number' || typeof msg.lng !== 'number') throw new BadRequestException('Falta a localização');
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
    // A localização guarda-se com ~1 m de precisão e só o que a pessoa escolheu enviar, uma vez.
    const place = msg.kind === 'location' ? { lat: Math.round(msg.lat! * 1e5) / 1e5, lng: Math.round(msg.lng! * 1e5) / 1e5 } : null;
    return place;
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

    // Presente na conversa: a mensagem aponta para a transação; só entra se foi mesmo feita por mim a esta pessoa (ninguém inventa presentes).
    if (msg.kind === 'gift') {
      if (!/^[0-9a-f-]{36}$/.test(msg.body)) throw new BadRequestException('Presente inválido');
      const g = (
        await this.pool.query(
          `SELECT t.metadata, e.amount, a.user_id AS recipient_id
             FROM ledger.transactions t
             JOIN ledger.entries e ON e.transaction_id = t.id AND e.amount > 0
             JOIN ledger.accounts a ON a.id = e.account_id
            WHERE t.id = $1 AND t.actor_id = $2 AND t.type = 'gift'`,
          [msg.body, me],
        )
      ).rows[0];
      if (!g || g.recipient_id !== other.id) throw new BadRequestException('Presente inválido');
      const note = String((g.metadata as { note?: string } | null)?.note ?? '').slice(0, 280);
      try {
        return await this.insert(me, other.id, note, 'gift', null, null, null, null, null, { giftTx: msg.body, giftAmount: Number(g.amount) });
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new BadRequestException('Este presente já está na conversa');
        throw e;
      }
    }
    const rel = await this.relationOf(me, other.id, await this.conversation(me, other.id, false));
    if (rel.left === 0) {
      throw new ForbiddenException(`Esta pessoa não te segue e ainda não respondeu. Podes escrever outra vez quando ela responder, aceitar ou te seguir.`);
    }
    const place = await this.validateOutgoing(me, msg);
    const once = !!msg.once && (msg.kind === 'text' || msg.kind === 'image' || msg.kind === 'voice');
    const live = msg.kind === 'location' && msg.liveMinutes && [15, 60, 480].includes(msg.liveMinutes) ? msg.liveMinutes : null;
    return this.insert(me, other.id, msg.kind === 'location' ? msg.body.slice(0, 80) : msg.body, msg.kind, null, msg.mediaId ?? null, msg.durationMs ?? null, msg.kind === 'voice' ? (msg.waveform ?? null) : null, place, { once, liveMinutes: live });
  }

  /** Resposta/reacção a um story: já foi autorizada pela definição de respostas do autor. */
  async sendStoryReply(me: string, recipientId: string, body: string, kind: 'story_reply' | 'story_reaction', storyMediaId: string) {
    return this.insert(me, recipientId, body, kind, storyMediaId, null, null, null, null, {});
  }

  /** Apagar para todos (só quem enviou): a mensagem desaparece da conversa, sem deixar rasto visível. */
  async remove(me: string, messageId: string) {
    const { rows } = await this.pool.query(
      `UPDATE social.messages m SET deleted_at = now(), body = '', media_id = NULL, story_media_id = NULL
        WHERE m.id = $1 AND m.sender_id = $2 AND m.deleted_at IS NULL
       RETURNING m.group_id, (SELECT CASE WHEN c.user_a = $2 THEN c.user_b ELSE c.user_a END FROM social.conversations c WHERE c.id = m.conversation_id) AS other`,
      [messageId, me],
    );
    if (!rows[0]) throw new NotFoundException('Mensagem não encontrada');
    if (rows[0].group_id) {
      const members = (await this.pool.query('SELECT user_id FROM social.group_members WHERE group_id = $1 AND user_id <> $2', [rows[0].group_id, me])).rows;
      for (const r of members) this.events.emit(r.user_id as string, { type: 'deleted', group: rows[0].group_id as string });
      return;
    }
    this.events.emit(rows[0].other, { type: 'deleted', from: await this.usernameOf(me) });
  }

  /**
   * Abrir uma mensagem de visualização única (só quem a recebeu, uma vez). Devolve o conteúdo e apaga-o do servidor:
   * o texto, o ficheiro e a onda deixam de existir; fica só "Aberta".
   */
  async open(me: string, messageId: string) {
    const m = (
      await this.pool.query(
        `SELECT m.sender_id, c.user_a, c.user_b FROM social.messages m JOIN social.conversations c ON c.id = m.conversation_id
          WHERE m.id = $1 AND m.deleted_at IS NULL AND m.view_once`,
        [messageId],
      )
    ).rows[0];
    if (!m || (m.user_a !== me && m.user_b !== me) || m.sender_id === me) throw new NotFoundException('Mensagem não encontrada');
    const { rows } = await this.pool.query(
      `UPDATE social.messages m SET viewed_at = now(), body = '', media_id = NULL, waveform = NULL
         FROM (SELECT id, body, media_id, kind, duration_ms, waveform FROM social.messages WHERE id = $1 FOR UPDATE) o
        WHERE m.id = o.id AND m.viewed_at IS NULL
        RETURNING o.body, o.media_id, o.kind, o.duration_ms, o.waveform`,
      [messageId],
    );
    if (!rows[0]) throw new GoneException('Esta mensagem já foi aberta');
    this.events.emit(m.sender_id as string, { type: 'read', from: await this.usernameOf(me) });
    const r = rows[0];
    return {
      kind: r.kind as MessageKind,
      body: r.body as string,
      mediaUrl: r.media_id ? this.media.chatUrl(r.media_id as string) : null,
      durationMs: r.duration_ms as number | null,
      waveform: (r.waveform as string | null) ?? null,
    };
  }

  /** Localização em direto: o remetente vai atualizando a posição enquanto a partilha dura. */
  async updateLive(me: string, messageId: string, lat: number, lng: number) {
    const { rows } = await this.pool.query(
      `UPDATE social.messages m SET lat = $3, lng = $4 WHERE m.id = $1 AND m.sender_id = $2 AND m.kind = 'location' AND m.live_until > now()
       RETURNING (SELECT CASE WHEN c.user_a = $2 THEN c.user_b ELSE c.user_a END FROM social.conversations c WHERE c.id = m.conversation_id) AS other`,
      [messageId, me, Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5],
    );
    if (!rows[0]) throw new NotFoundException('Esta partilha já terminou');
    this.events.emit(rows[0].other as string, { type: 'message', from: await this.usernameOf(me) });
  }

  async stopLive(me: string, messageId: string) {
    const { rows } = await this.pool.query(
      `UPDATE social.messages m SET live_until = now() WHERE m.id = $1 AND m.sender_id = $2 AND m.kind = 'location' AND m.live_until > now()
       RETURNING (SELECT CASE WHEN c.user_a = $2 THEN c.user_b ELSE c.user_a END FROM social.conversations c WHERE c.id = m.conversation_id) AS other`,
      [messageId, me],
    );
    if (rows[0]) this.events.emit(rows[0].other as string, { type: 'message', from: await this.usernameOf(me) });
  }

  /** "A escrever…": não é guardado, só chega a quem tem a conversa aberta. */
  async typing(me: string, username: string) {
    const other = await this.userByName(username);
    const blocked = (await this.pool.query(`SELECT ${blockedBetween('$2::uuid', '$1::uuid')} AS b`, [me, other.id])).rows[0].b as boolean;
    if (blocked || !(await this.conversation(me, other.id, false))) return;
    this.events.emit(other.id, { type: 'typing', from: await this.usernameOf(me) });
  }

  private async insert(me: string, other: string, body: string, kind: MessageKind, storyMediaId: string | null, mediaId: string | null, durationMs: number | null, waveform: string | null, place: { lat: number; lng: number } | null, extra: { once?: boolean; liveMinutes?: number | null; giftTx?: string; giftAmount?: number } = {}) {
    const conv = await this.conversation(me, other, true);
    const id = uuidv7();
    await this.pool.query(
      "INSERT INTO social.messages (id, conversation_id, sender_id, body, kind, story_media_id, media_id, duration_ms, waveform, lat, lng, view_once, live_until, gift_tx, gift_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CASE WHEN $13::int IS NULL THEN NULL ELSE now() + ($13::int * interval '1 minute') END, $14, $15)",
      [id, conv, me, body, kind, storyMediaId, mediaId, durationMs, waveform, place?.lat ?? null, place?.lng ?? null, !!extra.once, extra.liveMinutes ?? null, extra.giftTx ?? null, extra.giftAmount ?? null],
    );
    await this.pool.query(
      `UPDATE social.conversations SET last_message_at = now(),
              read_a = CASE WHEN user_a = $2 THEN $3::uuid ELSE read_a END, read_b = CASE WHEN user_b = $2 THEN $3::uuid ELSE read_b END WHERE id = $1`,
      [conv, me, id],
    );
    // Quem responde aceita (sai dos pedidos e volta a ver a conversa).
    await this.pool.query(
      `UPDATE social.conversations SET accepted_a = CASE WHEN user_a = $2 THEN true ELSE accepted_a END, accepted_b = CASE WHEN user_b = $2 THEN true ELSE accepted_b END,
              hidden_a = CASE WHEN user_a = $2 THEN false ELSE hidden_a END, hidden_b = CASE WHEN user_b = $2 THEN false ELSE hidden_b END WHERE id = $1`,
      [conv, me],
    );
    const theirs = await this.relationOf(other, me, conv);
    // Quem recusou a conversa não recebe avisos dela.
    if (theirs.hidden) return { id, kind };
    const from = await this.usernameOf(me);
    this.events.emit(other, { type: 'message', from });
    // Também no telemóvel, sem o texto da mensagem.
    const sender = (await this.pool.query('SELECT display_name FROM identity.users WHERE id = $1', [me])).rows[0].display_name as string;
    const what: Partial<Record<MessageKind, string>> = { image: 'enviou-te uma foto', voice: 'enviou-te uma mensagem de voz', sticker: 'enviou-te um sticker', location: 'partilhou a localização contigo', post: 'partilhou uma publicação contigo', gift: 'enviou-te um presente' };
    void this.push.send(other, { title: sender, body: theirs.request ? 'quer enviar-te uma mensagem' : extra.once ? 'enviou-te uma mensagem de visualização única' : extra.liveMinutes ? 'está a partilhar a localização em direto' : (what[kind] ?? 'enviou-te uma mensagem'), url: `/messages/${from}`, tag: `chat:${me}` });
    return { id, kind };
  }
}
