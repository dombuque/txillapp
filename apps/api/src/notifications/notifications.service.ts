import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { PushService, type NotifyCategory } from '../push/push.service';
import { allowedBy, blockedBetween, canView } from '../social/visibility';
import { badge, type Badge } from '../common/badge';

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

export type NotificationKind = 'blocked' | 'follow' | 'follow_request' | 'request_accepted' | 'gift' | 'comment' | 'reply' | 'story_reply' | 'repost' | 'mention' | 'tag' | 'verified' | 'venue_invite' | 'missed_call' | 'venue_payment' | 'venue_review'
  // TxillGroups vistos de fora (data: { groupId, groupName }): pediram para entrar (aos admins), aceitaram o meu pedido (a quem pediu),
  // alguém entrou num grupo público (aos admins).
  // Fizeram-me administrador de um grupo (à pessoa promovida; ator = quem promoveu; o mesmo data).
  | 'group_join_request' | 'group_join_accepted' | 'group_member_joined' | 'group_admin_granted'
  // Brindaram a minha geleira (só da primeira vez que cada pessoa brinda; ator = quem brindou; sem data).
  | 'geleira_cheer'
  // Brindaram a minha publicação (ou tcheka) ou o meu comentário: UMA linha por coisa brindada a cada 24 h, que sobe ao topo com
  // o último a brindar (ator). data: { target: 'post' | 'comment', targetId, postId, commentId?, tcheka?, since }. Ver notifyCheer.
  | 'cheer'
  // Alguém entrou com o meu convite (ator = quem entrou; sem data). Chega logo no registo; o prémio tem o seu próprio aviso.
  | 'invite_joined'
  // A moderação (ator = a conta de equipa, que a lista mostra como «Txillapp») removeu ou repôs um conteúdo meu, ou deixou-me
  // um aviso. data: { type: 'post' | 'comment' | 'story' | 'message' | 'media' | 'user' | 'venue', reason, postId?, tcheka? } (0121).
  | 'content_removed' | 'content_restored' | 'moderation_warning'
  // Programa de artistas (0131): a equipa decidiu o meu pedido de artista ou uma faixa minha.
  // data: { what: 'artist' | 'track', decision: 'approved' | 'rejected' | 'revoked' | 'removed' | 'restored', title?, reason? }.
  | 'music_review';

/** Avisos da equipa do Txillapp: não se desligam e mostram-se em nome do Txillapp (não da pessoa da equipa). */
export const STAFF_KINDS = new Set<NotificationKind>(['content_removed', 'content_restored', 'moderation_warning', 'venue_review', 'music_review']);
/** O que se diz do conteúdo nos avisos da moderação. */
export const contentNoun = (type: unknown, tcheka?: unknown) =>
  type === 'comment' ? 'o teu comentário' : type === 'story' ? 'o teu mimo' : type === 'message' ? 'a tua mensagem' : type === 'media' ? 'a tua foto'
  : type === 'venue' ? 'a página do teu local' : type === 'user' ? 'o teu perfil' : tcheka ? 'a tua tcheka' : 'a tua publicação';

/** A categoria que a pessoa pode desligar (os avisos de bloqueio e de verificação ficam sempre). */
export const CATEGORY_OF: Partial<Record<NotificationKind, NotifyCategory>> = {
  follow: 'follows', follow_request: 'follows', request_accepted: 'follows',
  comment: 'comments', reply: 'comments', story_reply: 'comments',
  mention: 'mentions', tag: 'mentions', repost: 'reposts', gift: 'gifts',
  missed_call: 'calls', venue_invite: 'venues', venue_payment: 'venues', venue_review: 'venues',
  group_join_request: 'messages', group_join_accepted: 'messages', group_member_joined: 'messages', group_admin_granted: 'messages',
  geleira_cheer: 'reactions', cheer: 'reactions',
  invite_joined: 'invites',
};

/** O que se brindou: uma publicação (ou tcheka) ou um comentário. */
export type CheerTarget = { kind: 'post'; postId: string; tcheka?: boolean } | { kind: 'comment'; postId: string; commentId: string };

/** O travão dos brindes no telemóvel: no máximo um aviso por coisa brindada a cada 30 min, e 6 por pessoa em 24 h. */
export const CHEER_PUSH_EVERY_MIN = 30;
export const CHEER_PUSH_DAILY_MAX = 6;

const cheerTargetId = (t: CheerTarget) => (t.kind === 'post' ? t.postId : t.commentId);
const cheerWhat = (t: CheerTarget) =>
  t.kind === 'comment' ? { a: 'o teu comentário', in: 'no teu comentário' } : t.tcheka ? { a: 'a tua tcheka', in: 'na tua tcheka' } : { a: 'a tua publicação', in: 'na tua publicação' };
const cheerUrl = (t: CheerTarget) => (t.kind === 'comment' ? `/p/${t.postId}?comments=1&c=${t.commentId}` : `/p/${t.postId}`);
/** O brinde ainda está posto (tirar o brinde não apaga o aviso, mas já não conta). `cn` = linha de social.cheer_notices. */
const cheerStillOn = (cn = 'cn') =>
  `(CASE ${cn}.kind WHEN 'post' THEN EXISTS (SELECT 1 FROM content.cheers ch WHERE ch.post_id = ${cn}.target_id AND ch.user_id = ${cn}.user_id)
                    ELSE EXISTS (SELECT 1 FROM content.comment_cheers ch WHERE ch.comment_id = ${cn}.target_id AND ch.user_id = ${cn}.user_id) END)`;

/** Tipos que não se repetem enquanto houver uma igual por ler (evita spam de seguir/deixar de seguir). */
const DEDUPE_UNREAD = new Set<NotificationKind>(['blocked', 'follow', 'follow_request']);

/**
 * Tipos de grupo que não se repetem para o mesmo (pessoa avisada, ator, grupo) dentro de 24 h, lida ou não:
 * quem sai e volta a entrar num grupo público não enche os admins de avisos (nem de pushes).
 */
const DEDUPE_GROUP_DAY = new Set<NotificationKind>(['group_member_joined']);

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
      // Categoria desligada: nem na lista nem no telemóvel (os pedidos de seguir e de entrar num grupo ficam sempre na lista, porque têm botões).
      const cat = CATEGORY_OF[n.kind];
      if (cat && n.kind !== 'follow_request' && n.kind !== 'group_join_request' && (await this.push.off(n.userId)).includes(cat)) return;
      if (DEDUPE_UNREAD.has(n.kind)) {
        const dup = await this.pool.query(
          'SELECT 1 FROM social.notifications WHERE user_id = $1 AND actor_id = $2 AND kind = $3 AND read_at IS NULL',
          [n.userId, n.actorId, n.kind],
        );
        if (dup.rowCount) return;
      }
      if (DEDUPE_GROUP_DAY.has(n.kind)) {
        const dup = await this.pool.query(
          `SELECT 1 FROM social.notifications
            WHERE user_id = $1 AND actor_id = $2 AND kind = $3 AND data->>'groupId' = $4 AND created_at > now() - interval '24 hours' LIMIT 1`,
          [n.userId, n.actorId, n.kind, String(n.data?.groupId ?? '')],
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
    const who = STAFF_KINDS.has(n.kind) ? 'Txillapp' : ((a?.display_name as string | undefined) ?? 'Alguém');
    const postId = n.data?.postId as string | undefined;
    const commentId = n.data?.commentId as string | undefined;
    const groupUrl = typeof n.data?.groupId === 'string' ? `/messages/g/${n.data.groupId}` : '/notifications';
    const atComment = postId ? `/p/${postId}?comments=1${commentId ? `&c=${commentId}` : ''}` : '/notifications';
    const t: Partial<Record<NotificationKind, { body: string; url: string }>> = {
      follow: { body: 'começou a seguir-te', url: profile },
      follow_request: { body: 'quer seguir-te', url: '/notifications' },
      request_accepted: { body: 'aceitou o teu pedido', url: profile },
      gift: { body: 'presenteou-te', url: '/wallet' },
      comment: { body: 'comentou a tua publicação', url: atComment },
      reply: { body: 'respondeu ao teu comentário', url: atComment },
      repost: { body: 'repostou a tua publicação', url: postId ? `/p/${postId}` : '/notifications' },
      mention: { body: 'mencionou-te', url: commentId ? atComment : postId ? `/p/${postId}` : '/notifications' },
      tag: { body: 'identificou-te numa foto', url: postId ? `/p/${postId}` : '/notifications' },
      story_reply: { body: 'respondeu ao teu mimo', url: n.data?.replyKind === 'comment' ? '/profile' : a?.username ? `/messages/${a.username as string}` : '/notifications' },
      verified: { body: 'agora tem a conta verificada', url: profile },
      venue_invite: { body: 'convidou-te para gerir um local', url: '/notifications' },
      missed_call: { body: n.data?.video ? 'Videochamada perdida' : 'Chamada perdida', url: '/calls' },
      // Pagamento com Txills a um local que a pessoa gere (direto ou do cofre de um TxillGroup).
      // Abre a secção Txills de Gerir, como a notificação dentro da app.
      venue_review: {
        body: n.data?.decision === 'approved' ? `aprovou ${String(n.data?.venueName ?? 'o teu local')}: já está à vista de todos` : `não aprovou ${String(n.data?.venueName ?? 'o teu local')}. Vê o motivo e corrige`,
        url: n.data?.venueSlug ? `/v/${String(n.data.venueSlug)}` : '/notifications',
      },
      // TxillGroups: abre a conversa do grupo (quem foi aceite já é membro). O pedido abre logo os detalhes, onde estão os pedidos (como na app).
      group_join_request: { body: `quer entrar em ${String(n.data?.groupName ?? 'o teu TxillGroup')}`, url: groupUrl === '/notifications' ? groupUrl : `${groupUrl}?info=1` },
      group_join_accepted: { body: `aceitou-te em ${String(n.data?.groupName ?? 'um TxillGroup')}`, url: groupUrl },
      group_member_joined: { body: `entrou em ${String(n.data?.groupName ?? 'o teu TxillGroup')}`, url: groupUrl },
      // Abre os detalhes do grupo, onde a pessoa passa a ter os botões de quem administra.
      group_admin_granted: { body: `fez-te administrador de ${String(n.data?.groupName ?? 'um TxillGroup')}`, url: groupUrl === '/notifications' ? groupUrl : `${groupUrl}?info=1` },
      // Abre o meu perfil, onde está a geleira (e quem a brindou).
      geleira_cheer: { body: 'brindou a tua geleira', url: '/profile' },
      // Abre os convites, onde está o progresso (quem entrou e quem já deu Txills).
      invite_joined: { body: 'entrou com o teu convite', url: '/invites' },
      // Moderação: o texto no telemóvel não leva o motivo (o ecrã de bloqueio é público); o motivo está na lista.
      content_removed: { body: `Removemos ${contentNoun(n.data?.type, n.data?.tcheka)}. Toca para ver o motivo.`, url: '/notifications' },
      content_restored: { body: `Repusemos ${contentNoun(n.data?.type, n.data?.tcheka)}.`, url: n.data?.type === 'post' && n.data?.postId ? `/p/${String(n.data.postId)}` : '/notifications' },
      moderation_warning: { body: 'Tens um aviso da moderação. Toca para ver.', url: '/notifications' },
      music_review: {
        body: n.data?.what === 'artist'
          ? n.data?.decision === 'approved' ? 'A tua conta já é de artista. Já podes carregar as tuas músicas.' : 'Há novidades sobre o teu pedido de artista. Toca para ver.'
          : n.data?.decision === 'approved' ? `«${String(n.data?.title ?? 'A tua música')}» já está no Txillapp.` : `Há novidades sobre «${String(n.data?.title ?? 'a tua música')}». Toca para ver.`,
        url: '/artista/gerir',
      },
      venue_payment: { body: `pagou ${Number(n.data?.amount ?? 0)} Txills ${n.data?.venueName ? `em ${String(n.data.venueName)}` : 'no teu local'}`, url: n.data?.venueSlug ? `/v/${String(n.data.venueSlug)}/gerir?s=txills` : '/notifications' },
    };
    const m = t[n.kind];
    // Chamada perdida: a mesma etiqueta da chamada que tocava (substitui-a) e, no Android, só dados, como o toque.
    if (m && n.kind === 'missed_call') {
      const callId = String(n.data?.callId ?? '');
      await this.push.send(n.userId, {
        title: who,
        body: m.body,
        url: m.url,
        tag: `call-${callId}`,
        category: 'calls',
        dataOnly: true,
        data: { kind: 'missed_call', callId, from: (a?.username as string | undefined) ?? '', video: n.data?.video ? '1' : '0' },
      });
      return;
    }
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

  /**
   * Brindaram uma publicação (ou tcheka) ou um comentário de `ownerId`. Os avisos juntam-se, como no Instagram:
   * - cada pessoa conta uma vez por coisa brindada (tirar e voltar a pôr não avisa outra vez);
   * - há UMA linha por coisa brindada a cada 24 h: o primeiro brinde abre-a, os seguintes sobem-na ao topo (por ler) com o
   *   último a brindar como ator; quem são e quantos calcula-se na lista, só com os brindes que ainda estão postos;
   * - não avisa quem brinda o que é seu, nem com bloqueio entre os dois, nem com a categoria "Reações" desligada.
   * Nunca falha o brinde: um erro aqui só fica registado. O aviso no telemóvel segue à parte, com travão (ver pushCheer).
   */
  async notifyCheer(ownerId: string, actorId: string, t: CheerTarget): Promise<void> {
    if (ownerId === actorId) return;
    const targetId = cheerTargetId(t);
    let client: PoolClient | undefined;
    try {
      if ((await this.push.off(ownerId)).includes('reactions')) return;
      client = await this.pool.connect();
      await client.query('BEGIN');
      // Um brinde de cada vez por coisa brindada: dois ao mesmo tempo não abrem duas linhas.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cheer:${ownerId}:${targetId}`]);
      const ok = await client.query(`SELECT 1 FROM identity.users o WHERE o.id = $1 AND o.status = 'active' AND NOT ${blockedBetween('o.id', '$2')}`, [ownerId, actorId]);
      const first = ok.rowCount
        ? await client.query('INSERT INTO social.cheer_notices (kind, target_id, user_id, owner_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [t.kind, targetId, actorId, ownerId])
        : null;
      if (!first?.rowCount) {
        await client.query('ROLLBACK');
        return;
      }
      const open = await client.query(
        `SELECT id FROM social.notifications
          WHERE user_id = $1 AND kind = 'cheer' AND data->>'targetId' = $2 AND (data->>'since')::timestamptz > now() - interval '24 hours'
          ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [ownerId, targetId],
      );
      if (open.rows[0]) {
        // A mesma linha sobe ao topo (id novo, que ordena a lista) e volta a estar por ler.
        await client.query('UPDATE social.notifications SET id = $2, actor_id = $3, created_at = now(), read_at = NULL WHERE id = $1', [open.rows[0].id, uuidv7(), actorId]);
      } else {
        const data = { target: t.kind, targetId, postId: t.postId, ...(t.kind === 'comment' ? { commentId: t.commentId } : t.tcheka ? { tcheka: true } : {}) };
        await client.query(
          `INSERT INTO social.notifications (id, user_id, actor_id, kind, data) VALUES ($1, $2, $3, 'cheer', $4::jsonb || jsonb_build_object('since', now()))`,
          [uuidv7(), ownerId, actorId, JSON.stringify(data)],
        );
      }
      await client.query('COMMIT');
      void this.pushCheer(ownerId, actorId, t);
    } catch (e) {
      await client?.query('ROLLBACK').catch(() => undefined);
      this.log.warn(`falha a criar o aviso de brinde: ${(e as Error).message}`);
    } finally {
      client?.release();
    }
  }

  /**
   * O aviso no telemóvel de um brinde, com travão para não ser chato: o primeiro brinde avisa; depois, no máximo um aviso por
   * coisa brindada a cada 30 min, com a contagem do que entrou entretanto ("+4 brindes na tua publicação"); e nunca mais de 6
   * avisos de brindes por pessoa em 24 h. O texto nunca leva o conteúdo da publicação nem do comentário.
   */
  private async pushCheer(ownerId: string, actorId: string, t: CheerTarget) {
    if (!this.push.enabled) return;
    const targetId = cheerTargetId(t);
    let client: PoolClient | undefined;
    let count = 0;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      // Um de cada vez por pessoa avisada: as contas do travão batem certo com brindes ao mesmo tempo.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cheer-push:${ownerId}`]);
      await client.query(`DELETE FROM social.cheer_pushes WHERE user_id = $1 AND sent_at < now() - interval '2 days'`, [ownerId]);
      const s = (
        await client.query(
          `SELECT count(*) FILTER (WHERE sent_at > now() - interval '24 hours')::int AS today,
                  max(sent_at) FILTER (WHERE target_id = $2) AS last
             FROM social.cheer_pushes WHERE user_id = $1`,
          [ownerId, targetId],
        )
      ).rows[0] as { today: number; last: Date | null };
      const tooSoon = s.last && Date.now() - new Date(s.last).getTime() < CHEER_PUSH_EVERY_MIN * 60_000;
      if (s.today < CHEER_PUSH_DAILY_MAX && !tooSoon) {
        // Os brindes que entraram depois do último aviso (no máximo das últimas 24 h) e que ainda estão postos.
        count = (
          await client.query(
            `SELECT count(*)::int AS n FROM social.cheer_notices cn JOIN identity.users cu ON cu.id = cn.user_id AND cu.status = 'active'
              WHERE cn.kind = $1 AND cn.target_id = $2 AND cn.created_at > COALESCE($4::timestamptz, now() - interval '24 hours')
                AND NOT ${blockedBetween('cu.id', '$3')} AND ${cheerStillOn('cn')}`,
            [t.kind, targetId, ownerId, s.last],
          )
        ).rows[0].n as number;
        if (count > 0) await client.query('INSERT INTO social.cheer_pushes (user_id, target_id) VALUES ($1, $2)', [ownerId, targetId]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client?.query('ROLLBACK').catch(() => undefined);
      this.log.warn(`falha no travão dos brindes: ${(e as Error).message}`);
      return;
    } finally {
      client?.release();
    }
    if (count < 1) return;
    const what = cheerWhat(t);
    const tag = `cheer:${targetId}`;
    if (count === 1) {
      const who = ((await this.pool.query('SELECT display_name FROM identity.users WHERE id = $1', [actorId])).rows[0]?.display_name as string | undefined) ?? 'Alguém';
      await this.push.send(ownerId, { title: who, body: `brindou ${what.a}`, url: cheerUrl(t), tag, category: 'reactions' });
    } else {
      await this.push.send(ownerId, { title: 'A malta brindou-te', body: `+${count} brindes ${what.in}`, url: cheerUrl(t), tag, category: 'reactions' });
    }
  }

  /** Lista paginada por cursor. O aviso de bloqueio aparece sempre; as outras de quem entretanto foi bloqueado ficam escondidas. */
  async list(userId: string, cursor?: string, limit = 30) {
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequestException('cursor inválido');
    const { rows } = await this.pool.query(
      `SELECT n.id, n.kind, n.data, n.created_at, n.read_at, a.username, a.display_name, a.status, a.is_private, a.verified, a.verified_tier,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = $1 AND f.followee_id = a.id) AS i_follow,
              EXISTS (SELECT 1 FROM social.follow_requests r WHERE r.requester_id = $1 AND r.target_id = a.id) AS requested,
              (SELECT json_build_object('id', pm.media_id, 'video', ma.mime LIKE 'video/%')
                 FROM content.post_media pm JOIN content.media_assets ma ON ma.id = pm.media_id
                WHERE n.data ? 'postId' AND (n.data->>'postId') ~ '^[0-9a-f-]{36}$' AND pm.post_id = (n.data->>'postId')::uuid AND ma.status = 'ready'
                ORDER BY pm.position LIMIT 1) AS thumb
         FROM social.notifications n JOIN identity.users a ON a.id = n.actor_id
        WHERE n.user_id = $1 AND ($2::uuid IS NULL OR n.id < $2)
          AND (n.kind = 'blocked' OR NOT ${blockedBetween('a.id', '$1')})
        ORDER BY n.id DESC LIMIT $3`,
      [userId, cursor ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    const cheers = await this.cheersOf(userId, page.filter((r) => r.kind === 'cheer').map((r) => r.id as string));
    return {
      items: page.map((r) => ({
        id: r.id,
        kind: r.kind as NotificationKind,
        data: r.data,
        createdAt: r.created_at,
        read: r.read_at !== null,
        // Os avisos da equipa vêm em nome do Txillapp (nunca o nome nem o @ da pessoa da equipa).
        actor: r.status === 'staff'
          ? { username: 'txillapp', displayName: 'Txillapp', isPrivate: false, following: false, requested: false, staff: true, verified: true, verifiedTier: 'official' as const }
          : { username: r.username, displayName: r.status === 'active' ? r.display_name : 'Conta eliminada', isPrivate: !!r.is_private, following: !!r.i_follow, requested: !!r.requested, ...(r.status === 'active' ? badge(r.verified, r.verified_tier) : badge(false, null)) },
        // A miniatura da publicação (a primeira foto; nos vídeos, o cartaz), como na lista de notificações do Instagram.
        thumb: r.thumb ? { url: `/api/v1/media/${(r.thumb as { id: string }).id}${(r.thumb as { video: boolean }).video ? '?poster=1' : ''}`, video: !!(r.thumb as { video: boolean }).video } : null,
        // Brindes: quantos ainda estão postos nesta janela e os dois últimos a brindar (para as fotos e "Ana, Rui e 3 outros").
        ...(r.kind === 'cheer' ? { cheer: cheers.get(r.id as string) ?? { count: 0, actors: [] } } : {}),
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /**
   * Para cada linha de brindes: quem brindou nessa janela de 24 h e ainda tem o brinde posto (sem bloqueios nem contas inativas),
   * o mais recente primeiro. Devolve a contagem e os dois primeiros.
   */
  private async cheersOf(userId: string, ids: string[]) {
    const out = new Map<string, { count: number; actors: ({ username: string; displayName: string } & Badge)[] }>();
    if (!ids.length) return out;
    const { rows } = await this.pool.query(
      `SELECT id, total, username, display_name, verified, verified_tier FROM (
         SELECT n.id, cu.username, cu.display_name, cu.verified, cu.verified_tier,
                row_number() OVER (PARTITION BY n.id ORDER BY cn.created_at DESC) AS rn,
                count(*) OVER (PARTITION BY n.id)::int AS total
           FROM social.notifications n
           JOIN social.cheer_notices cn ON cn.kind = n.data->>'target' AND cn.target_id = (n.data->>'targetId')::uuid
                AND cn.created_at >= (n.data->>'since')::timestamptz AND cn.created_at < (n.data->>'since')::timestamptz + interval '24 hours'
           JOIN identity.users cu ON cu.id = cn.user_id AND cu.status = 'active'
          WHERE n.id = ANY($2::uuid[]) AND n.user_id = $1 AND n.kind = 'cheer'
            AND NOT ${blockedBetween('cu.id', '$1')} AND ${cheerStillOn('cn')}
       ) x WHERE rn <= 2 ORDER BY id, rn`,
      [userId, ids],
    );
    for (const r of rows) {
      const g = out.get(r.id as string) ?? { count: r.total as number, actors: [] };
      g.actors.push({ username: r.username as string, displayName: r.display_name as string, ...badge(r.verified, r.verified_tier) });
      out.set(r.id as string, g);
    }
    return out;
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
