import { BadRequestException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TextFilter } from '../safety/text-filter.service';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { PostsService } from '../posts/posts.service';
import { PushService } from '../push/push.service';
import { MediaService } from '../media/media.service';
import { allowedBy, blockedBetween } from '../social/visibility';
import { readGif, type GifInput } from '../gifs/gif';
import { ChatEvents } from './chat.events';

export type MessageKind = 'text' | 'story_reply' | 'story_reaction' | 'image' | 'voice' | 'sticker' | 'location' | 'post' | 'gift' | 'video' | 'zas_reply' | 'call' | 'poll' | 'gif' | 'system';

/**
 * O texto de uma mensagem GIF (kind 'gif'): o GIF vai na coluna `gif`; o body leva só "GIF", que é o que as versões
 * antigas da app (que não conhecem o tipo) mostram na bolha e na lista de conversas.
 */
export const GIF_BODY = 'GIF';

/** Stickers que existem (o desenho está na app; aqui só se confirma que o id é válido). */
/** Os stickers são desenhados na app; o servidor só confirma que o id tem o feitio certo (a lista cresce sem mexer aqui). */
export const STICKER_ID = /^[a-z0-9-]{2,24}$/;
const PAGE = 40;

/** Os dois ids por ordem fixa (user_a < user_b), para haver uma só conversa por par. */
/** Quantas mensagens se podem mandar a quem não nos segue, antes de a pessoa responder, aceitar ou seguir de volta. */
export const STRANGER_LIMIT = 3;

/**
 * SQL: a mensagem `m` não foi apagada para mim ("Apagar para mim", social.message_hidden). `me` é o parâmetro com o meu id.
 * Entra nas conversas, nos grupos, na última mensagem da lista e nas contas de por ler.
 */
export const notHiddenFor = (m: string, me: string) => `NOT EXISTS (SELECT 1 FROM social.message_hidden h WHERE h.message_id = ${m}.id AND h.user_id = ${me})`;

/**
 * SQL: a mensagem `m` ainda não expirou (mensagens temporárias, 0123). Uma expirada nunca mais aparece: na conversa, na
 * última mensagem da lista, nos por ler, nas citações, no álbum e na exportação. A limpeza (chat-expiry.service.ts) apaga-a depois.
 */
export const notExpired = (m: string) => `(${m}.expires_at IS NULL OR ${m}.expires_at > now())`;

/** Mensagens temporárias: quanto dura cada mensagem (segundos): 24 horas, 7 dias ou 90 dias. `null` = desligadas. */
export const TTL_OPTIONS = [86_400, 604_800, 7_776_000] as const;
export type Ttl = (typeof TTL_OPTIONS)[number] | null;
export const TTL_LABEL: Record<number, string> = { 86400: '24 horas', 604800: '7 dias', 7776000: '90 dias' };

/**
 * SQL: o `expires_at` de uma mensagem nova na conversa (`table` = 'conversations') ou no grupo ('groups') com o id `idParam`:
 * criação + duração, se as mensagens temporárias estiverem ligadas; senão NULL.
 */
export const expiresFor = (table: 'conversations' | 'groups', idParam: string) =>
  `(SELECT CASE WHEN t.ttl_seconds IS NULL THEN NULL ELSE now() + t.ttl_seconds * interval '1 second' END FROM social.${table} t WHERE t.id = ${idParam})`;

/** O que um aviso de sistema (kind 'system') guarda em `system`: quem mudou (o 1.º nome, na altura) e para quanto. */
export interface SystemInfo { type: 'ttl'; ttl: number | null; name: string }

/**
 * O texto do aviso de sistema para quem o vê: "Dom ligou as mensagens temporárias: 7 dias." ou, para quem mudou,
 * "Desligaste as mensagens temporárias." (`mine`).
 */
export function systemText(s: SystemInfo | null | undefined, mine: boolean): string {
  if (!s || s.type !== 'ttl') return '';
  const label = s.ttl ? (TTL_LABEL[s.ttl] ?? `${Math.round(s.ttl / 86_400)} dias`) : null;
  if (mine) return label ? `Ligaste as mensagens temporárias: ${label}.` : 'Desligaste as mensagens temporárias.';
  const who = s.name || 'Alguém';
  return label ? `${who} ligou as mensagens temporárias: ${label}.` : `${who} desligou as mensagens temporárias.`;
}

/** Até quando (depois de enviar) se pode editar uma mensagem de texto. A app tem o mesmo número (src/lib/messageMenu.ts). */
export const EDIT_WINDOW_MS = 15 * 60_000;

/** O aviso que fica no lugar de uma mensagem apagada para todos (é também o que as versões antigas da app mostram). */
export const deletedNotice = (mine: boolean) => (mine ? 'Apagaste esta mensagem' : 'Esta mensagem foi apagada');

const pair = (x: string, y: string) => (x < y ? ([x, y] as const) : ([y, x] as const));

/**
 * Tira tudo o que uma mensagem tinha (o "Apagar para todos" de quem a enviou e a remoção pela moderação fazem o mesmo).
 * Corre dentro da transação de quem chama, com a mensagem já confirmada (e ainda não apagada).
 *  - o ficheiro (foto, vídeo, voz) passa a 'deleted' e sai do armazenamento;
 *  - numa sondagem de grupo (kind 'poll', body = id da sondagem) apaga a sondagem, as opções e os votos;
 *  - apaga as reações e as vistas (visualização única nos grupos);
 *  - na linha fica só quem enviou, onde, quando e quando foi apagada: o texto, o ficheiro, o sítio, a partilha em direto,
 *    a duração, a onda, o valor do presente, a visualização única, a hora da edição, a citação e o GIF vão-se, e o tipo passa a
 *    'text' (a app desenha o aviso a partir de `deleted`, não do tipo). O presente em si (a transação na carteira) não se
 *    desfaz: `gift_tx` fica, para o mesmo presente não voltar a entrar na conversa.
 * `notice` = deixar o aviso "Esta mensagem foi apagada" no lugar (o "Apagar para todos"); a moderação remove sem aviso.
 */
export async function wipeMessage(db: Pick<Pool, 'query'>, messageId: string, notice: boolean) {
  await db.query(
    `DELETE FROM social.group_polls p USING social.messages m
      WHERE m.id = $1 AND m.kind = 'poll' AND m.group_id = p.group_id AND p.id::text = m.body`,
    [messageId],
  );
  await db.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = (SELECT media_id FROM social.messages WHERE id = $1)`, [messageId]);
  await db.query('DELETE FROM social.message_reactions WHERE message_id = $1', [messageId]);
  await db.query('DELETE FROM social.message_views WHERE message_id = $1', [messageId]);
  await db.query(
    `UPDATE social.messages SET deleted_at = now(), deleted_notice = $2, kind = 'text', body = '', media_id = NULL, story_media_id = NULL,
            duration_ms = NULL, waveform = NULL, lat = NULL, lng = NULL, place_name = NULL, place_address = NULL, live_until = NULL,
            gift_amount = NULL, view_once = false, viewed_at = NULL, edited_at = NULL, reply_to = NULL, gif = NULL
      WHERE id = $1`,
    [messageId, notice],
  );
}

/** Uma partilha em direto que já acabou (o tempo acabou ou alguém carregou em "Parar"). As localizações fixas não têm `live_until`. */
export const liveEnded = (m: { kind?: unknown; live_until?: unknown }) =>
  m.kind === 'location' && !!m.live_until && new Date(m.live_until as string).getTime() <= Date.now();

export interface Outgoing {
  body: string;
  kind: 'text' | 'image' | 'voice' | 'video' | 'sticker' | 'location' | 'post' | 'gift' | 'zas_reply' | 'gif';
  mediaId?: string;
  /** GIF do GIPHY (kind 'gif'): já validado pelo gifSchema (url https de media*.giphy.com, id e medidas). */
  gif?: GifInput;
  /** Resposta a um Zás (kind 'zas_reply'): qual. A foto do Zás fica na mensagem. */
  instantId?: string;
  durationMs?: number;
  waveform?: string;
  lat?: number;
  lng?: number;
  /** Visualização única (texto, foto, voz ou vídeo; nos grupos cada pessoa abre uma vez). */
  once?: boolean;
  /** Localização em direto durante estes minutos (15, 60 ou 480). */
  liveMinutes?: number;
  /** Localização de um sítio escolhido: o nome (até 80) e a morada (até 160). Só nas mensagens de localização. */
  name?: string;
  address?: string;
  /** Responde a esta mensagem (da mesma conversa ou grupo). */
  replyTo?: string;
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly media: MediaService,
    private readonly events: ChatEvents,
    private readonly push: PushService,
    private readonly posts: PostsService,
    private readonly filter: TextFilter,
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
          `SELECT (SELECT count(*) FROM social.messages WHERE conversation_id = c.id AND sender_id = $2 AND deleted_at IS NULL AND kind <> 'system')::int AS mine,
                  (SELECT count(*) FROM social.messages WHERE conversation_id = c.id AND sender_id = $3 AND deleted_at IS NULL AND kind <> 'system')::int AS theirs,
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
    // Os meus outros aparelhos: a conversa sai dos pedidos (lista e aviso de pedido na conversa).
    this.events.echo(me, { type: 'message', from: other.username });
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
    this.events.echo(me, { type: 'message', from: other.username });
  }

  /** Marcar a conversa como por ler (só para mim). */
  async markUnread(me: string, username: string) {
    const other = await this.userByName(username);
    const conv = await this.conversation(me, other.id, false);
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    await this.pool.query('UPDATE social.conversations SET unread_mark_a = CASE WHEN user_a = $2 THEN true ELSE unread_mark_a END, unread_mark_b = CASE WHEN user_b = $2 THEN true ELSE unread_mark_b END WHERE id = $1', [conv, me]);
    // Só muda a lista (o ponto de "por ler"): 'read' com self.
    this.events.echo(me, { type: 'read', from: other.username });
    return { ok: true };
  }

  /**
   * Apagar a conversa só do meu lado (`keep` = false, o "Apagar conversa" da lista): as mensagens até agora deixam de
   * aparecer para mim (a outra pessoa continua a vê-las) e a conversa sai da lista; se chegar uma mensagem nova, volta só
   * com o que vier dali para a frente.
   * "Limpar conversa" (`keep` = true, no menu da conversa): o mesmo, mas a conversa fica na lista, vazia ("Sem mensagens"),
   * até chegar outra. Nos dois casos os "Apagar para mim" dessas mensagens deixam de ser precisos e vão-se; só os meus
   * outros aparelhos são avisados (eco 'deleted'); ao outro lado não chega nada.
   */
  async clearForMe(me: string, username: string, keep = false) {
    const other = await this.userByName(username);
    const conv = await this.conversation(me, other.id, false);
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const { rows } = await this.pool.query(
      `UPDATE social.conversations c SET
              cleared_a = CASE WHEN c.user_a = $2 THEN m.last ELSE c.cleared_a END, cleared_b = CASE WHEN c.user_b = $2 THEN m.last ELSE c.cleared_b END,
              cleared_keep_a = CASE WHEN c.user_a = $2 THEN $3 ELSE c.cleared_keep_a END, cleared_keep_b = CASE WHEN c.user_b = $2 THEN $3 ELSE c.cleared_keep_b END,
              read_a = CASE WHEN c.user_a = $2 THEN m.last ELSE c.read_a END, read_b = CASE WHEN c.user_b = $2 THEN m.last ELSE c.read_b END,
              unread_mark_a = CASE WHEN c.user_a = $2 THEN false ELSE c.unread_mark_a END, unread_mark_b = CASE WHEN c.user_b = $2 THEN false ELSE c.unread_mark_b END
         FROM (SELECT max(id::text)::uuid AS last FROM social.messages WHERE conversation_id = $1) m
        WHERE c.id = $1 AND m.last IS NOT NULL
        RETURNING m.last`,
      [conv, me, keep],
    );
    if (rows[0]) {
      await this.pool.query(
        `DELETE FROM social.message_hidden h USING social.messages m WHERE h.user_id = $1 AND h.message_id = m.id AND m.conversation_id = $2 AND m.id <= $3`,
        [me, conv, rows[0].last],
      );
    }
    this.events.echo(me, { type: 'deleted', from: other.username });
    return { ok: true };
  }

  /**
   * Mensagens temporárias numa conversa a dois: qualquer um dos dois liga (24 h, 7 dias, 90 dias) ou desliga. Só entre quem
   * já conversa (não num pedido de mensagem por aceitar, nem a quem não me segue e ainda não respondeu) e sem bloqueio.
   * Cada mudança deixa um aviso de sistema na conversa e chega ao outro lado e aos meus outros aparelhos ('message').
   * Pedir o que já está não muda nada (sem aviso). Devolve { ttl }.
   */
  async setTtl(me: string, username: string, ttl: Ttl) {
    const other = await this.userByName(username);
    if (other.id === me) throw new BadRequestException('Conversa inválida');
    const ok = (
      await this.pool.query(
        `SELECT ${blockedBetween('u.id', '$1')} AS blocked, ${allowedBy('u', 'dms_allowed')} AS allowed,
                EXISTS (SELECT 1 FROM social.conversations c WHERE c.user_a = LEAST($1::uuid, u.id) AND c.user_b = GREATEST($1::uuid, u.id)) AS spoke
           FROM identity.users u WHERE u.id = $2`,
        [me, other.id],
      )
    ).rows[0];
    if (ok.blocked) throw new ForbiddenException('Não podes mudar esta conversa');
    if (!ok.allowed && !ok.spoke) throw new ForbiddenException('Esta pessoa não aceita mensagens novas');
    const rel = await this.relationOf(me, other.id, await this.conversation(me, other.id, false));
    if (rel.request || rel.left !== null) throw new ForbiddenException('Só podes ligar as mensagens temporárias quando já estiverem a conversar');
    const conv = (await this.conversation(me, other.id, true))!;
    const upd = await this.pool.query('UPDATE social.conversations SET ttl_seconds = $2 WHERE id = $1 AND ttl_seconds IS DISTINCT FROM $2::int', [conv, ttl]);
    if (!upd.rowCount) return { ttl };
    const name = await this.firstNameOf(me);
    const sys: SystemInfo = { type: 'ttl', ttl, name };
    const id = uuidv7();
    await this.pool.query("INSERT INTO social.messages (id, conversation_id, sender_id, body, kind, system) VALUES ($1, $2, $3, $4, 'system', $5::jsonb)", [id, conv, me, systemText(sys, false), JSON.stringify(sys)]);
    await this.pool.query(
      `UPDATE social.conversations SET last_message_at = now(),
              read_a = CASE WHEN user_a = $2 THEN $3::uuid ELSE read_a END, read_b = CASE WHEN user_b = $2 THEN $3::uuid ELSE read_b END WHERE id = $1`,
      [conv, me, id],
    );
    this.events.echo(me, { type: 'message', from: other.username });
    // Quem recusou a conversa não recebe avisos dela.
    if (!(await this.relationOf(other.id, me, conv)).hidden) this.events.emit(other.id, { type: 'message', from: await this.usernameOf(me) });
    return { ttl };
  }

  /** O primeiro nome de quem está a usar (para os avisos de sistema). */
  async firstNameOf(id: string) {
    const r = (await this.pool.query('SELECT display_name, username FROM identity.users WHERE id = $1', [id])).rows[0];
    return ((r?.display_name as string | undefined)?.trim().split(/\s+/)[0] || (r?.username as string | undefined) || '').slice(0, 40);
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
              lm.body AS last_body, lm.view_once AS last_once, lm.kind AS last_kind, lm.sender_id AS last_sender, lm.created_at AS last_at, lm.system AS last_system,
              c.last_message_at, c.ttl_seconds,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = o.id) AS i_follow,
              (SELECT count(*) FROM social.messages sm WHERE sm.conversation_id = c.id AND sm.sender_id = $1 AND sm.deleted_at IS NULL AND sm.kind <> 'system')::int AS sent_by_me,
              (CASE WHEN c.user_a = $1 THEN c.accepted_a ELSE c.accepted_b END) AS accepted,
              (SELECT count(*) FROM social.messages m
                WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.deleted_at IS NULL AND m.kind <> 'system' AND ${notHiddenFor('m', '$1')} AND ${notExpired('m')}
                  AND (CASE WHEN c.user_a = $1 THEN c.read_a ELSE c.read_b END IS NULL
                       OR m.id > (CASE WHEN c.user_a = $1 THEN c.read_a ELSE c.read_b END))
                  AND ((CASE WHEN c.user_a = $1 THEN c.cleared_a ELSE c.cleared_b END) IS NULL OR m.id > (CASE WHEN c.user_a = $1 THEN c.cleared_a ELSE c.cleared_b END)))::int AS unread,
              (CASE WHEN c.user_a = $1 THEN c.unread_mark_a ELSE c.unread_mark_b END) AS unread_mark
         FROM social.conversations c
         JOIN identity.users o ON o.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
         LEFT JOIN LATERAL (SELECT x.body, x.kind, x.sender_id, x.created_at, x.view_once, x.system FROM social.messages x WHERE x.conversation_id = c.id AND x.deleted_at IS NULL AND ${notHiddenFor('x', '$1')} AND ${notExpired('x')} AND ((CASE WHEN c.user_a = $1 THEN c.cleared_a ELSE c.cleared_b END) IS NULL OR x.id > (CASE WHEN c.user_a = $1 THEN c.cleared_a ELSE c.cleared_b END)) ORDER BY x.id DESC LIMIT 1) lm ON true
        WHERE (c.user_a = $1 OR c.user_b = $1) AND NOT ${blockedBetween('o.id', '$1')}
          AND NOT (CASE WHEN c.user_a = $1 THEN c.hidden_a ELSE c.hidden_b END)
          -- Sem nada para mostrar, a conversa só fica na lista se a limpei ("Limpar conversa": fica vazia até chegar outra).
          AND (lm.created_at IS NOT NULL OR (CASE WHEN c.user_a = $1 THEN c.cleared_keep_a ELSE c.cleared_keep_b END))
        ORDER BY COALESCE(lm.created_at, c.last_message_at) DESC LIMIT 100`,
      [me],
    );
    const iShow = (await this.pool.query('SELECT show_presence FROM identity.users WHERE id = $1', [me])).rows[0]?.show_presence !== false;
    return rows.map((r) => ({
      username: r.username,
      presence: iShow && r.o_show && r.status === 'active' ? { online: this.events.isOnline(r.other_id as string), lastSeen: (r.last_seen_at as string | null) ?? null } : null,
      displayName: r.status === 'active' ? r.display_name : 'Conta eliminada',
      hasAvatar: r.has_avatar,
      /** Mensagens temporárias: quanto dura cada mensagem nova (segundos), ou null (desligadas). */
      ttl: (r.ttl_seconds as number | null) ?? null,
      lastMessage: r.last_at
        ? {
            body: r.last_once ? '' : r.last_kind === 'system' ? systemText(r.last_system as SystemInfo, r.last_sender === me) : (r.last_body as string),
            once: !!r.last_once,
            kind: r.last_kind as MessageKind,
            fromMe: r.last_sender === me,
            at: r.last_at as string,
            empty: false,
          }
        : // Limpa por mim e sem nada novo: a lista mostra "Sem mensagens".
          { body: '', once: false, kind: 'text' as MessageKind, fromMe: false, at: r.last_message_at as string, empty: true },
      /** Pedido de mensagem: quem escreveu não é seguido por mim, eu ainda não respondi nem aceitei. */
      request: !r.i_follow && r.sent_by_me === 0 && !r.accepted && r.last_sender !== me,
      /** Marcada por mim como por ler: conta como 1 até a abrir. */
      unread: Math.max(r.unread as number, r.unread_mark ? 1 : 0),
      /** Só está por ler porque a marquei à mão (sem mensagens novas): a lista mostra um ponto em vez de um número. */
      marked: !!r.unread_mark && (r.unread as number) === 0,
    }));
  }

  /** Quantas conversas têm mensagens por ler (o ponto no ícone das mensagens). */
  async unread(me: string) {
    // Os pedidos de mensagem não contam para o número do ícone: só aparecem na caixa de pedidos.
    const list = await this.list(me);
    return { conversations: list.filter((c) => c.unread > 0 && !c.request).length, requests: list.filter((c) => c.request).length };
  }

  /** Mensagens da conversa (as mais recentes primeiro, por cursor). Abrir marca como lidas e avisa o outro lado. */
  async thread(me: string, username: string, cursor?: string, markRead = true) {
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
    // "1 publicação nova" por baixo do nome (como no Instagram): o que publicou e eu ainda não vi. Só na 1.ª página.
    const newPosts = blocked || cursor ? { count: 0, latestId: null } : await this.posts.newPostsBy(me, other.id);
    if (!conv) return { person, blocked, relation, newPosts, ttl: null, otherRead: null, items: [], nextCursor: null };
    const { rows } = await this.pool.query(
      `SELECT m.id, m.sender_id, m.body, m.kind, m.story_media_id, m.media_id, m.duration_ms, m.waveform, m.lat, m.lng, m.place_name, m.place_address, m.view_once, m.viewed_at, m.live_until, m.gift_amount, m.reply_to, m.created_at, m.deleted_at, m.edited_at, m.gif, m.expires_at, m.system FROM social.messages m
        WHERE m.conversation_id = $1 AND (m.deleted_at IS NULL OR m.deleted_notice) AND ${notHiddenFor('m', '$4')} AND ${notExpired('m')} AND ($2::uuid IS NULL OR m.id < $2)
          AND m.id > COALESCE((SELECT CASE WHEN c.user_a = $4 THEN c.cleared_a ELSE c.cleared_b END FROM social.conversations c WHERE c.id = $1), '00000000-0000-0000-0000-000000000000'::uuid)
        ORDER BY m.id DESC LIMIT $3`,
      [conv, cursor ?? null, PAGE + 1, me],
    );
    const page = rows.slice(0, PAGE);
    // Abrir tira a marca de "por ler".
    // (Só quando havia marca: assim sei se mudou alguma coisa para avisar os meus outros aparelhos.)
    // Só quando a conversa está mesmo à vista (`markRead`): pré-carregar ou atualizar por trás não lê nada.
    const unmarked = cursor || !markRead
      ? 0
      : (await this.pool.query('UPDATE social.conversations SET unread_mark_a = CASE WHEN user_a = $2 THEN false ELSE unread_mark_a END, unread_mark_b = CASE WHEN user_b = $2 THEN false ELSE unread_mark_b END WHERE id = $1 AND CASE WHEN user_a = $2 THEN unread_mark_a ELSE unread_mark_b END', [conv, me])).rowCount ?? 0;
    let readNow = false;
    if (!cursor && markRead && page[0]) {
      const upd = await this.pool.query(
        `UPDATE social.conversations SET read_a = CASE WHEN user_a = $2 THEN $3::uuid ELSE read_a END, read_b = CASE WHEN user_b = $2 THEN $3::uuid ELSE read_b END
          WHERE id = $1 AND (CASE WHEN user_a = $2 THEN read_a ELSE read_b END IS DISTINCT FROM $3::uuid)`,
        [conv, me, page[0].id],
      );
      readNow = !!upd.rowCount;
      if (readNow) this.events.emit(other.id, { type: 'read', from: await this.usernameOf(me) });
    }
    // Li noutro aparelho: os meus outros aparelhos tiram o número de "por ler" da lista.
    if (readNow || unmarked) this.events.echo(me, { type: 'read', from: other.username });
    const reads = (await this.pool.query('SELECT user_a, read_a, read_b, ttl_seconds FROM social.conversations WHERE id = $1', [conv])).rows[0];
    const otherRead = (reads.user_a === me ? reads.read_b : reads.read_a) as string | null;
    return {
      person,
      blocked,
      relation,
      /** Publicações dela que ainda não vi (últimos 7 dias); `latestId` = a mais recente. */
      newPosts,
      /** Mensagens temporárias: quanto dura cada mensagem nova (segundos: 86400, 604800 ou 7776000), ou null (desligadas). */
      ttl: (reads.ttl_seconds as number | null) ?? null,
      /** Último id que a outra pessoa já leu ("Visto" nas minhas mensagens até aqui). */
      otherRead,
      items: await this.mapItems(me, page),
      nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
    };
  }

  /** Linhas de mensagens → o que a app recebe (ficheiros com URL temporário, publicações partilhadas com os dados de quem as vê). */
  async mapItems(me: string, page: Record<string, any>[]) {
    const ids = page.map((m) => m.id as string);
    const replyIds = [...new Set(page.map((m) => m.reply_to as string | null).filter((x): x is string => !!x))];
    const none = { rows: [] as Record<string, any>[] };
    const [rx, rp] = await Promise.all([
      ids.length ? this.pool.query('SELECT message_id, reaction, count(*)::int AS n, bool_or(user_id = $2) AS mine FROM social.message_reactions WHERE message_id = ANY($1::uuid[]) GROUP BY message_id, reaction', [ids, me]) : none,
      replyIds.length
        ? this.pool.query(`SELECT m.id, m.sender_id, m.body, m.kind, m.view_once, m.deleted_at, split_part(u.display_name, ' ', 1) AS name FROM social.messages m LEFT JOIN identity.users u ON u.id = m.sender_id WHERE m.id = ANY($1::uuid[]) AND ${notExpired('m')}`, [replyIds])
        : none,
    ]);
    const reactions = new Map<string, { reaction: string; count: number; mine: boolean }[]>();
    for (const r of rx.rows) reactions.set(r.message_id, [...(reactions.get(r.message_id) ?? []), { reaction: r.reaction, count: r.n, mine: r.mine }]);
    const quoted = new Map(rp.rows.map((r) => [r.id as string, r]));
    return Promise.all(
      page.map(async (m) => m.deleted_at ? this.deletedItem(me, m) : m.kind === 'system' ? this.systemItem(me, m) : this.item(me, m, reactions, quoted)),
    );
  }

  /**
   * Aviso de sistema (kind 'system', ex.: "Dom ligou as mensagens temporárias: 7 dias."): só o texto, para quem o vê, e o
   * que mudou em `system` ({ type: 'ttl', ttl }). Não tem reações, citação nem ficheiro, e nunca expira.
   */
  private systemItem(me: string, m: Record<string, any>) {
    const fromMe = m.sender_id === me;
    const sys = m.system as SystemInfo | null;
    return {
      ...this.deletedItem(me, m),
      deleted: undefined,
      body: systemText(sys, fromMe) || (m.body as string),
      kind: 'system' as MessageKind,
      system: sys ? { type: sys.type, ttl: sys.ttl ?? null } : null,
    };
  }

  private async item(me: string, m: Record<string, any>, reactions: Map<string, { reaction: string; count: number; mine: boolean }[]>, quoted: Map<string, Record<string, any>>) {
    // Partilha em direto que já acabou: a última posição exata (e o sítio) deixa de ser servida a quem quer que seja, também
    // a quem a enviou. A bolha fica só "Partilha em direto terminada", sem mapa. As localizações fixas mantêm o ponto.
    const ended = liveEnded(m);
    return {
      id: m.id as string,
      fromMe: m.sender_id === me,
      // Visualização única: o conteúdo nunca vai na lista (nem para quem enviou); só se lê ao abrir, uma vez.
      body: m.view_once ? '' : (m.body as string),
      kind: m.kind as MessageKind,
      viewOnce: !!m.view_once,
      opened: !!m.viewed_at,
      storyUrl: m.story_media_id && m.kind !== 'zas_reply' ? `/api/v1/media/${m.story_media_id}` : null,
      // Resposta a um Zás: a foto do Zás vai como média da mensagem (URL assinado, como as fotos do chat).
      mediaUrl: m.media_id && !m.view_once ? this.media.chatUrl(m.media_id) : m.kind === 'zas_reply' && m.story_media_id ? this.media.chatUrl(m.story_media_id) : null,
      durationMs: m.duration_ms as number | null,
      waveform: m.view_once ? null : ((m.waveform as string | null) ?? null),
      lat: ended ? null : ((m.lat as number | null) ?? null),
      lng: ended ? null : ((m.lng as number | null) ?? null),
      /** Localização de um sítio: o nome e a morada (null na localização atual, na em direto e nas mensagens antigas). */
      placeName: ended ? null : ((m.place_name as string | null) ?? null),
      placeAddress: ended ? null : ((m.place_address as string | null) ?? null),
      /** Presente enviado na conversa: quanto (a nota vai no texto). */
      giftAmount: (m.gift_amount as number | null) ?? null,
      /** GIF do GIPHY (kind 'gif'): { id, w, h, url, still?, title? }; null nas outras. */
      gif: m.kind === 'gif' ? readGif(m.gif) : null,
      /** Localização em direto ainda a decorrer. */
      live: !!m.live_until && new Date(m.live_until as string).getTime() > Date.now(),
      liveUntil: (m.live_until as string | null) ?? null,
      // Publicação partilhada: o cartão mostra-se com os dados de quem a vê agora (null se já não a pode ver).
      post: m.kind === 'post' ? await this.posts.getOne(me, m.body as string).catch(() => null) : undefined,
      /** Mensagem a que esta responde (um excerto; sem o conteúdo de mensagens de visualização única). */
      replyTo: (() => {
        const q = m.reply_to ? quoted.get(m.reply_to as string) : null;
        if (!m.reply_to) return null;
        if (!q || q.deleted_at) return { id: m.reply_to as string, gone: true };
        return { id: q.id as string, gone: false, fromMe: q.sender_id === me, name: (q.name as string) || '', kind: q.kind as MessageKind, body: q.view_once || q.kind !== 'text' ? '' : String(q.body).slice(0, 120) };
      })(),
      reactions: reactions.get(m.id as string) ?? [],
      /** Foi editada depois de enviada (a bolha mostra "editada" ao lado da hora). */
      edited: !!m.edited_at,
      /** Mensagens temporárias: quando deixa de existir (null = fica). Passada esta hora, a app tira-a da conversa. */
      expiresAt: (m.expires_at as string | null) ?? null,
      at: m.created_at as string,
    };
  }

  /** Mensagem apagada para todos: só o aviso, no lugar dela (nada do que tinha: texto, ficheiro, sítio, reações, citação). */
  private deletedItem(me: string, m: Record<string, any>) {
    const fromMe = m.sender_id === me;
    return {
      id: m.id as string,
      fromMe,
      deleted: true as const,
      body: deletedNotice(fromMe),
      kind: 'text' as MessageKind,
      viewOnce: false,
      opened: false,
      storyUrl: null,
      mediaUrl: null,
      durationMs: null,
      waveform: null,
      lat: null,
      lng: null,
      placeName: null,
      placeAddress: null,
      giftAmount: null,
      gif: null,
      live: false,
      liveUntil: null,
      replyTo: null,
      reactions: [] as { reaction: string; count: number; mine: boolean }[],
      expiresAt: (m.expires_at as string | null) ?? null,
      at: m.created_at as string,
    };
  }

  /** Valida o conteúdo de uma mensagem (texto, sticker, publicação, localização ou ficheiro do chat) e devolve a localização arredondada, se houver. */
  async validateOutgoing(me: string, msg: Outgoing): Promise<{ lat: number; lng: number } | null> {
    if (msg.kind === 'text') {
      if (!msg.body.trim()) throw new BadRequestException('Mensagem vazia');
    } else if (msg.kind === 'sticker') {
      if (!STICKER_ID.test(msg.body)) throw new BadRequestException('Sticker inválido');
    } else if (msg.kind === 'gif') {
      // O gifSchema (no controlador) já confirmou o anfitrião, o id e as medidas; aqui só se exige que venha.
      if (!msg.gif) throw new BadRequestException('Falta o GIF');
      // O título (vem do GIPHY, só para o leitor de ecrã) não pode ser usado para passar o que o filtro barra: sai.
      if (msg.gif.title && this.filter.check(msg.gif.title)) msg.gif = { ...msg.gif, title: undefined };
    } else if (msg.kind === 'post') {
      // Só se partilha o que quem envia pode ver (e que ainda existe).
      if (!/^[0-9a-f-]{36}$/.test(msg.body)) throw new BadRequestException('Publicação inválida');
      await this.posts.getOne(me, msg.body);
    } else if (msg.kind === 'location') {
      if (typeof msg.lat !== 'number' || typeof msg.lng !== 'number') throw new BadRequestException('Falta a localização');
      this.filter.assertClean(msg.body, msg.name ?? '', msg.address ?? '');
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
      const want = msg.kind === 'image' ? 'image/' : msg.kind === 'video' ? 'video/' : 'audio/';
      if (!mime || !mime.startsWith(want)) throw new BadRequestException('Ficheiro inválido');
    }
    // A localização guarda-se com ~1 m de precisão e só o que a pessoa escolheu enviar, uma vez.
    const place = msg.kind === 'location' ? { lat: Math.round(msg.lat! * 1e5) / 1e5, lng: Math.round(msg.lng! * 1e5) / 1e5 } : null;
    return place;
  }

  /**
   * O que fica gravado de uma mensagem de localização: o texto (até 80; sem texto, o nome do sítio, para a lista de conversas
   * e para apps antigas) e o nome e a morada do sítio, se vierem. Nas outras mensagens, o texto como veio e nada de sítio.
   */
  placeFields(msg: Outgoing): { body: string; name: string | null; address: string | null } {
    if (msg.kind === 'gif') return { body: GIF_BODY, name: null, address: null };
    if (msg.kind !== 'location') return { body: msg.body, name: null, address: null };
    const name = msg.name?.trim().slice(0, 80) || null;
    const address = msg.address?.trim().slice(0, 160) || null;
    return { body: (msg.body.trim() || name || '').slice(0, 80), name, address };
  }

  /** Mensagem normal: precisa de não haver bloqueio e de a pessoa aceitar mensagens (ou já existir conversa). */
  async send(me: string, username: string, msg: Outgoing) {
    if (msg.kind === 'text' || msg.kind === 'image' || msg.kind === 'zas_reply') this.filter.assertClean(msg.body);
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
    // Resposta a um Zás: tem de ser um Zás dessa pessoa ainda a valer; a foto dele vai na mensagem.
    if (msg.kind === 'zas_reply') {
      if (!msg.body.trim()) throw new BadRequestException('Escreve alguma coisa');
      const z = await this.pool.query('SELECT media_id FROM social.instants WHERE id = $1 AND author_id = $2 AND expires_at > now()', [msg.instantId ?? null, other.id]);
      if (!z.rows[0]) throw new BadRequestException('Esse Zás já não está disponível');
      return this.insert(me, other.id, msg.body.slice(0, 2000), 'zas_reply', z.rows[0].media_id as string, null, null, null, null, {});
    }
    const place = await this.validateOutgoing(me, msg);
    const once = !!msg.once && (msg.kind === 'text' || msg.kind === 'image' || msg.kind === 'voice' || msg.kind === 'video');
    const live = msg.kind === 'location' && msg.liveMinutes && [15, 60, 480].includes(msg.liveMinutes) ? msg.liveMinutes : null;
    const spot = this.placeFields(msg);
    return this.insert(me, other.id, spot.body, msg.kind, null, msg.mediaId ?? null, msg.durationMs ?? null, msg.kind === 'voice' ? (msg.waveform ?? null) : null, place, { once, liveMinutes: live, replyTo: msg.replyTo, placeName: spot.name, placeAddress: spot.address, gif: msg.kind === 'gif' ? msg.gif : undefined });
  }

  /** Resposta/reacção a um story: já foi autorizada pela definição de respostas do autor. */
  async sendStoryReply(me: string, recipientId: string, body: string, kind: 'story_reply' | 'story_reaction', storyMediaId: string) {
    this.filter.assertClean(body);
    return this.insert(me, recipientId, body, kind, storyMediaId, null, null, null, null, {});
  }

  /**
   * Apagar para todos (só quem enviou; sem limite de tempo; nas conversas e nos TxillGroups): o conteúdo desaparece
   * (texto, ficheiro, sítio, partilha em direto, duração, valor do presente, reações, vistas e, numa sondagem, a sondagem
   * com as opções e os votos; ver wipeMessage) e no lugar fica o aviso "Apagaste esta mensagem" / "Esta mensagem foi apagada", que cada um pode tirar com
   * "Apagar para mim". De outra pessoa, já apagada ou que não existe: 404.
   */
  async remove(me: string, messageId: string) {
    // Tudo numa transação, com a mensagem bloqueada: o ficheiro, a sondagem, as reações e as vistas vão-se com ela (ver wipeMessage).
    const client = await this.pool.connect();
    let m: { group_id: string | null; kind: string; other: string | null } | undefined;
    try {
      await client.query('BEGIN');
      m = (
        await client.query(
          `SELECT m.group_id, m.kind, (SELECT CASE WHEN c.user_a = $2 THEN c.user_b ELSE c.user_a END FROM social.conversations c WHERE c.id = m.conversation_id) AS other
             FROM social.messages m WHERE m.id = $1 AND m.sender_id = $2 AND m.deleted_at IS NULL AND m.kind <> 'system' AND ${notExpired('m')} FOR UPDATE`,
          [messageId, me],
        )
      ).rows[0];
      if (!m) throw new NotFoundException('Esta mensagem já foi apagada ou não é tua');
      await wipeMessage(client, messageId, true);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    if (m.group_id) {
      const members = (await this.pool.query('SELECT user_id FROM social.group_members WHERE group_id = $1', [m.group_id])).rows;
      for (const r of members) {
        if (r.user_id !== me) this.events.emit(r.user_id as string, { type: 'deleted', group: m.group_id });
        // A sondagem saiu também do plano do grupo: os ecrãs abertos voltam a pedir as sondagens.
        if (m.kind === 'poll') this.events.emit(r.user_id as string, { type: 'group', groupId: m.group_id, what: 'poll' });
      }
      this.events.echo(me, { type: 'deleted', group: m.group_id });
      return;
    }
    this.events.emit(m.other!, { type: 'deleted', from: await this.usernameOf(me) });
    this.events.echo(me, { type: 'deleted', from: await this.usernameOf(m.other!) });
  }

  /**
   * Apagar para mim: qualquer mensagem de uma conversa ou de um TxillGroup em que estou (minha ou de outra pessoa, e
   * também o aviso de uma apagada para todos) deixa de me aparecer. Os outros continuam a vê-la. Repetir não faz mal.
   */
  async hideForMe(me: string, messageId: string) {
    const m = (
      await this.pool.query(
        `SELECT m.group_id, c.user_a, c.user_b, EXISTS (SELECT 1 FROM social.group_members gm WHERE gm.group_id = m.group_id AND gm.user_id = $2) AS member
           FROM social.messages m LEFT JOIN social.conversations c ON c.id = m.conversation_id WHERE m.id = $1`,
        [messageId, me],
      )
    ).rows[0];
    const mine = !!m && (m.group_id ? !!m.member : m.user_a === me || m.user_b === me);
    if (!mine) throw new NotFoundException('Mensagem não encontrada');
    await this.pool.query('INSERT INTO social.message_hidden (user_id, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me, messageId]);
    // Os meus outros aparelhos põem a conversa em dia.
    if (m.group_id) this.events.echo(me, { type: 'deleted', group: m.group_id as string });
    else this.events.echo(me, { type: 'deleted', from: await this.usernameOf((m.user_a === me ? m.user_b : m.user_a) as string) });
  }

  /**
   * Editar uma mensagem (como no WhatsApp): só a minha, só texto (não de visualização única), só nos primeiros
   * EDIT_WINDOW_MS depois de a enviar, com o mesmo filtro do envio. Guarda `edited_at`; o outro lado (ou o grupo) recebe
   * o evento 'edited' e a conversa põe-se em dia. Numa conversa com bloqueio não se edita.
   */
  async edit(me: string, messageId: string, body: string) {
    const text = body.trim();
    if (!text) throw new BadRequestException('Escreve alguma coisa');
    const m = (
      await this.pool.query(
        `SELECT m.sender_id, m.kind, m.view_once, m.created_at, (m.deleted_at IS NOT NULL OR NOT ${notExpired('m')}) AS deleted_at, m.group_id, c.user_a, c.user_b,
                EXISTS (SELECT 1 FROM social.group_members gm WHERE gm.group_id = m.group_id AND gm.user_id = $2) AS member
           FROM social.messages m LEFT JOIN social.conversations c ON c.id = m.conversation_id WHERE m.id = $1`,
        [messageId, me],
      )
    ).rows[0];
    const inside = !!m && (m.group_id ? !!m.member : m.user_a === me || m.user_b === me);
    if (!inside || m.deleted_at) throw new NotFoundException('Mensagem não encontrada');
    if (m.sender_id !== me) throw new ForbiddenException('Só podes editar as tuas mensagens');
    if (m.kind !== 'text' || m.view_once) throw new BadRequestException('Só se editam mensagens de texto');
    if (Date.now() - new Date(m.created_at as string).getTime() > EDIT_WINDOW_MS) {
      throw new ForbiddenException('Já passaram 15 minutos: esta mensagem já não se pode editar');
    }
    this.filter.assertClean(text);
    let other: string | null = null;
    if (!m.group_id) {
      other = (m.user_a === me ? m.user_b : m.user_a) as string;
      const blocked = (await this.pool.query(`SELECT ${blockedBetween('$2::uuid', '$1::uuid')} AS b`, [me, other])).rows[0].b as boolean;
      if (blocked) throw new ForbiddenException('Não podes editar mensagens nesta conversa');
    }
    await this.pool.query('UPDATE social.messages SET body = $2, edited_at = now() WHERE id = $1 AND deleted_at IS NULL', [messageId, text.slice(0, 2000)]);
    if (m.group_id) {
      const members = (await this.pool.query('SELECT user_id FROM social.group_members WHERE group_id = $1 AND user_id <> $2', [m.group_id, me])).rows;
      for (const r of members) this.events.emit(r.user_id as string, { type: 'edited', group: m.group_id as string });
      this.events.echo(me, { type: 'edited', group: m.group_id as string });
    } else {
      this.events.emit(other!, { type: 'edited', from: await this.usernameOf(me) });
      this.events.echo(me, { type: 'edited', from: await this.usernameOf(other!) });
    }
    return { id: messageId, body: text.slice(0, 2000), edited: true };
  }

  /** Reagir a uma mensagem (de uma conversa ou grupo em que estou): uma reação por pessoa; `null` tira-a. */
  async react(me: string, messageId: string, reaction: string | null) {
    const m = (
      await this.pool.query(
        `SELECT m.group_id, c.user_a, c.user_b FROM social.messages m LEFT JOIN social.conversations c ON c.id = m.conversation_id WHERE m.id = $1 AND m.deleted_at IS NULL AND m.kind <> 'system' AND ${notExpired('m')}`,
        [messageId],
      )
    ).rows[0];
    if (!m) throw new NotFoundException('Mensagem não encontrada');
    let notify: { to: string; event: { type: 'message'; from?: string; group?: string } }[];
    let echo: { type: 'message'; from?: string; group?: string };
    if (m.group_id) {
      const members = (await this.pool.query('SELECT user_id FROM social.group_members WHERE group_id = $1', [m.group_id])).rows.map((r) => r.user_id as string);
      if (!members.includes(me)) throw new NotFoundException('Mensagem não encontrada');
      notify = members.filter((u) => u !== me).map((u) => ({ to: u, event: { type: 'message' as const, group: m.group_id as string } }));
      echo = { type: 'message', group: m.group_id as string };
    } else {
      if (m.user_a !== me && m.user_b !== me) throw new NotFoundException('Mensagem não encontrada');
      const other = (m.user_a === me ? m.user_b : m.user_a) as string;
      const blocked = (await this.pool.query(`SELECT ${blockedBetween('$2::uuid', '$1::uuid')} AS b`, [me, other])).rows[0].b as boolean;
      if (blocked) throw new ForbiddenException('Não podes reagir aqui');
      notify = [{ to: other, event: { type: 'message' as const, from: await this.usernameOf(me) } }];
      echo = { type: 'message', from: await this.usernameOf(other) };
    }
    if (reaction === null) await this.pool.query('DELETE FROM social.message_reactions WHERE message_id = $1 AND user_id = $2', [messageId, me]);
    else
      await this.pool.query(
        `INSERT INTO social.message_reactions (message_id, user_id, reaction) VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = now()`,
        [messageId, me, reaction],
      );
    for (const n of notify) this.events.emit(n.to, n.event);
    this.events.echo(me, echo);
  }

  /**
   * Abrir uma mensagem de visualização única (só quem a recebeu, uma vez). Devolve o conteúdo e apaga-o do servidor:
   * o texto, o ficheiro e a onda deixam de existir; fica só "Aberta".
   */
  async open(me: string, messageId: string) {
    const m = (
      await this.pool.query(
        `SELECT m.sender_id, m.group_id, c.user_a, c.user_b FROM social.messages m LEFT JOIN social.conversations c ON c.id = m.conversation_id
          WHERE m.id = $1 AND m.deleted_at IS NULL AND m.view_once AND ${notExpired('m')}`,
        [messageId],
      )
    ).rows[0];
    if (m?.group_id) return this.openInGroup(me, messageId, m.group_id as string, m.sender_id as string);
    if (!m || (m.user_a !== me && m.user_b !== me) || m.sender_id === me) throw new NotFoundException('Mensagem não encontrada');
    const { rows } = await this.pool.query(
      `UPDATE social.messages m SET viewed_at = now(), body = '', media_id = NULL, waveform = NULL
         FROM (SELECT id, body, media_id, kind, duration_ms, waveform FROM social.messages WHERE id = $1 FOR UPDATE) o
        WHERE m.id = o.id AND m.viewed_at IS NULL
        RETURNING o.body, o.media_id, o.kind, o.duration_ms, o.waveform`,
      [messageId],
    );
    if (!rows[0]) throw new GoneException('Esta mensagem já foi aberta');
    // Já foi aberta: o ficheiro fica só uns minutos (para acabar de ver) e depois é apagado do armazenamento.
    if (rows[0].media_id) await this.media.expireIn(rows[0].media_id as string, 15);
    this.events.emit(m.sender_id as string, { type: 'read', from: await this.usernameOf(me) });
    // Nos meus outros aparelhos a mensagem passa a "Aberta".
    this.events.echo(me, { type: 'message', from: await this.usernameOf(m.sender_id as string) });
    const r = rows[0];
    return {
      kind: r.kind as MessageKind,
      body: r.body as string,
      mediaUrl: r.media_id ? this.media.chatUrl(r.media_id as string) : null,
      durationMs: r.duration_ms as number | null,
      waveform: (r.waveform as string | null) ?? null,
    };
  }

  /**
   * Visualização única num grupo: cada pessoa abre uma vez. O conteúdo só desaparece do servidor quando todos os outros membros já abriram.
   */
  private async openInGroup(me: string, messageId: string, groupId: string, senderId: string) {
    const member = await this.pool.query('SELECT 1 FROM social.group_members WHERE group_id = $1 AND user_id = $2', [groupId, me]);
    if (!member.rowCount || senderId === me) throw new NotFoundException('Mensagem não encontrada');
    const ins = await this.pool.query('INSERT INTO social.message_views (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [messageId, me]);
    if (!ins.rowCount) throw new GoneException('Já abriste esta mensagem');
    const r = (await this.pool.query('SELECT body, media_id, kind, duration_ms, waveform FROM social.messages WHERE id = $1', [messageId])).rows[0];
    if (!r) throw new GoneException('Esta mensagem já não existe');
    const left = (
      await this.pool.query(
        `SELECT count(*)::int AS n FROM social.group_members x WHERE x.group_id = $1 AND x.user_id <> $2
            AND NOT EXISTS (SELECT 1 FROM social.message_views v WHERE v.message_id = $3 AND v.user_id = x.user_id)`,
        [groupId, senderId, messageId],
      )
    ).rows[0].n as number;
    if (left === 0) {
      // Já todos abriram: apaga o conteúdo (o ficheiro fica só uns minutos para acabar de ver).
      await this.pool.query("UPDATE social.messages SET viewed_at = now(), body = '', media_id = NULL, waveform = NULL WHERE id = $1", [messageId]);
      if (r.media_id) await this.media.expireIn(r.media_id as string, 15);
    }
    this.events.emit(senderId, { type: 'message', group: groupId });
    this.events.echo(me, { type: 'message', group: groupId });
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
    await this.liveChanged(me, rows[0].other as string | null);
  }

  /** A partilha em direto mudou: avisa o outro lado e os meus outros aparelhos (lá também se vê o mapa a mexer). */
  private async liveChanged(me: string, other: string | null) {
    if (!other) return;
    this.events.emit(other, { type: 'message', from: await this.usernameOf(me) });
    this.events.echo(me, { type: 'message', from: await this.usernameOf(other) });
  }

  /**
   * "Parar" a partilha em direto: acaba agora e a última posição apaga-se (a mensagem fica só "Partilha em direto terminada").
   * Só mexe numa partilha em direto minha ainda a decorrer: as localizações fixas (sem `live_until`) nunca passam por aqui.
   */
  async stopLive(me: string, messageId: string) {
    const { rows } = await this.pool.query(
      `UPDATE social.messages m SET live_until = now(), lat = NULL, lng = NULL, place_name = NULL, place_address = NULL
        WHERE m.id = $1 AND m.sender_id = $2 AND m.kind = 'location' AND m.live_until IS NOT NULL AND m.live_until > now()
       RETURNING (SELECT CASE WHEN c.user_a = $2 THEN c.user_b ELSE c.user_a END FROM social.conversations c WHERE c.id = m.conversation_id) AS other`,
      [messageId, me],
    );
    if (rows[0]) await this.liveChanged(me, rows[0].other as string | null);
  }

  /**
   * Regista uma chamada na conversa (mensagem de quem ligou, tipo 'call'): o corpo é JSON {video, status, durationS}.
   * Não manda notificação (a chamada já tem as suas); só avisa os dois em tempo real para a conversa se atualizar.
   */
  async logCall(callerId: string, calleeId: string, info: { video: boolean; status: string; durationS: number | null }) {
    const conv = await this.conversation(callerId, calleeId, true);
    if (!conv) return;
    const id = uuidv7();
    await this.pool.query(`INSERT INTO social.messages (id, conversation_id, sender_id, body, kind, expires_at) VALUES ($1, $2, $3, $4, $5, ${expiresFor('conversations', '$2')})`, [id, conv, callerId, JSON.stringify(info), 'call']);
    await this.pool.query(
      `UPDATE social.conversations SET last_message_at = now(),
              read_a = CASE WHEN user_a = $2 THEN $3::uuid ELSE read_a END, read_b = CASE WHEN user_b = $2 THEN $3::uuid ELSE read_b END WHERE id = $1`,
      [conv, callerId, id],
    );
    const [from, to] = await Promise.all([this.usernameOf(callerId), this.usernameOf(calleeId)]);
    this.events.emit(calleeId, { type: 'message', from });
    // Quem ligou é quem "enviou" o registo: para os aparelhos dele é um eco (sem som nem aviso).
    this.events.echo(callerId, { type: 'message', from: to });
  }

  /** "A escrever…": não é guardado, só chega a quem tem a conversa aberta. */
  async typing(me: string, username: string) {
    const other = await this.userByName(username);
    const blocked = (await this.pool.query(`SELECT ${blockedBetween('$2::uuid', '$1::uuid')} AS b`, [me, other.id])).rows[0].b as boolean;
    if (blocked || !(await this.conversation(me, other.id, false))) return;
    this.events.emit(other.id, { type: 'typing', from: await this.usernameOf(me) });
  }

  private async insert(me: string, other: string, body: string, kind: MessageKind, storyMediaId: string | null, mediaId: string | null, durationMs: number | null, waveform: string | null, place: { lat: number; lng: number } | null, extra: { once?: boolean; liveMinutes?: number | null; giftTx?: string; giftAmount?: number; replyTo?: string; placeName?: string | null; placeAddress?: string | null; gif?: GifInput } = {}) {
    const conv = await this.conversation(me, other, true);
    const id = uuidv7();
    const ins = await this.pool.query(
      // Mensagens temporárias ligadas: leva `expires_at` (criação + duração). Só se responde a uma que ainda existe.
      `INSERT INTO social.messages (id, conversation_id, sender_id, body, kind, story_media_id, media_id, duration_ms, waveform, lat, lng, view_once, live_until, gift_tx, gift_amount, reply_to, place_name, place_address, gif, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CASE WHEN $13::int IS NULL THEN NULL ELSE now() + ($13::int * interval '1 minute') END, $14, $15, (SELECT r.id FROM social.messages r WHERE r.id = $16::uuid AND r.conversation_id = $2 AND r.deleted_at IS NULL AND r.kind <> 'system' AND ${notExpired('r')}), $17, $18, $19::jsonb, ${expiresFor('conversations', '$2')}) RETURNING expires_at`,
      [id, conv, me, body, kind, storyMediaId, mediaId, durationMs, waveform, place?.lat ?? null, place?.lng ?? null, !!extra.once, extra.liveMinutes ?? null, extra.giftTx ?? null, extra.giftAmount ?? null, extra.replyTo ?? null, extra.placeName ?? null, extra.placeAddress ?? null, extra.gif ? JSON.stringify(extra.gif) : null],
    );
    // Com as temporárias ligadas, a app sabe logo quando a mensagem enviada desaparece (envio otimista, lib/chatPending).
    const exp = ins.rows[0]?.expires_at as Date | string | null | undefined;
    const expiresAt = exp ? new Date(exp).toISOString() : null;
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
    // Os meus outros aparelhos (e este) mostram logo a mensagem enviada (todos os tipos: texto, presentes, partilhas, mimos…).
    this.events.echo(me, { type: 'message', from: await this.usernameOf(other) });
    const theirs = await this.relationOf(other, me, conv);
    // Quem recusou a conversa não recebe avisos dela.
    if (theirs.hidden) return { id, kind, expiresAt };
    const from = await this.usernameOf(me);
    this.events.emit(other, { type: 'message', from });
    // Também no telemóvel, sem o texto da mensagem.
    const sender = (await this.pool.query('SELECT display_name FROM identity.users WHERE id = $1', [me])).rows[0].display_name as string;
    const what: Partial<Record<MessageKind, string>> = { story_reply: 'respondeu ao teu mimo', story_reaction: 'reagiu ao teu mimo', image: 'enviou-te uma foto', video: 'enviou-te um vídeo', voice: 'enviou-te uma mensagem de voz', sticker: 'enviou-te um sticker', gif: 'enviou-te um GIF', location: 'partilhou a localização contigo', post: 'partilhou uma publicação contigo', gift: 'enviou-te um presente' };
    if (!this.events.isActive(other, `u:${from}`)) void this.push.send(other, { title: sender, body: theirs.request ? 'quer enviar-te uma mensagem' : extra.once ? 'enviou-te uma mensagem de visualização única' : extra.liveMinutes ? 'está a partilhar a localização em direto' : (what[kind] ?? 'enviou-te uma mensagem'), url: `/messages/${from}`, tag: `chat:${me}`, category: 'messages' });
    return { id, kind, expiresAt };
  }
}
