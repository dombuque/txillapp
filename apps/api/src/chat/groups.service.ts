import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TextFilter } from '../safety/text-filter.service';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { PushService } from '../push/push.service';
import { allowedBy, blockedBetween } from '../social/visibility';
import { ChatEvents } from './chat.events';
import { ChatService, Outgoing, expiresFor, notExpired, notHiddenFor, systemText, type MessageKind, type SystemInfo, type Ttl } from './chat.service';
import { GroupAccess, NO_MAP_PLACE, venueOnMap } from '../groups/group-access';
import { roundPlace } from '../nearby/geo-sql';
import { PlanService } from '../groups/plan.service';
import { PotService } from '../groups/pot.service';
import { NotificationsService } from '../notifications/notifications.service';

const PAGE = 30;
export const MAX_MEMBERS = 50;
const UUID = /^[0-9a-f-]{36}$/;
type Db = Pool | PoolClient;
export const GROUP_KINDS = ['viagem', 'festa', 'fim_de_semana', 'outro'] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

export interface GroupInfo {
  name?: string;
  kind?: GroupKind;
  description?: string | null;
  coverMediaId?: string | null;
  /** Foto de perfil do grupo: o mesmo mecanismo da capa (foto minha, já carregada e livre). */
  avatarMediaId?: string | null;
  /** Só no PATCH (admins). */
  visibility?: 'private' | 'public';
  showOnMap?: boolean;
  /** O ponto no mapa (arredondado antes de guardar); `null` limpa. Só no PATCH (admins). */
  mapPlace?: { lat: number; lng: number; label?: string | null } | null;
}

/**
 * Conversas de grupo: criar, mensagens, membros (admin adiciona/remove; qualquer um sai).
 *
 * TxillGroups (os grupos passam a ser TxillGroups). Acrescentos ao contrato:
 * - POST /chat/groups { name: 2..40, kind?: 'viagem' | 'festa' | 'fim_de_semana' | 'outro' (por omissão 'outro'),
 *   description?: <= 300, coverMediaId?: uuid (foto minha, já carregada, como o logótipo dos locais), members: [username] (2..49) } -> { id }
 * - PATCH /chat/groups/:id { name?, kind?, description?: string | null, coverMediaId?: uuid | null } (admins) -> 204, como antes.
 * - GET /chat/groups: cada grupo traz também { groupKind (o tipo; `kind` já é 'group' nesta lista), description, coverUrl, visibility: 'private', createdBy: username | null,
 *   plan: { destination, startsOn, endsOn, going, maybe, notGoing, myRsvp }, pot: { balance, goal, venue: { slug, name, avatarUrl, acceptsTxills } | null } }.
 *   Na última mensagem, uma sondagem (kind 'poll') traz a pergunta no body.
 * - GET /chat/groups/:id: `group` traz os mesmos campos (com o tipo em `kind` e também em `groupKind`); as mensagens kind 'poll' trazem `poll` (formato em groups/plan.service.ts) ou null.
 *
 * Grupos vistos de fora (0102): POST e PATCH aceitam também `avatarMediaId` (foto de perfil, como a capa); o PATCH (admins) aceita
 * `visibility: 'private' | 'public'` e `showOnMap: boolean`. GET /chat/groups e GET /chat/groups/:id trazem `visibility` (o real),
 * `showOnMap` (sempre true se público), `avatarUrl` e `pendingRequests` (só para os admins; 0 para os outros).
 * Voltar a privado oculto (privado e fora do mapa) apaga os pedidos à espera. O resto em groups/public-groups.service.ts.
 * - Quando a última pessoa sai e o grupo desaparece, o cofre é devolvido a quem contribuiu antes (ver groups/pot.service.ts).
 *
 * Quem administra (0103):
 * - PATCH /chat/groups/:id/members/:username { role: 'admin' | 'member' } (admins) -> 200 { username, role }.
 *   Torna admin um membro, tira o papel a outro admin, ou a si próprio se houver outro admin
 *   (409 { message: 'O grupo precisa de pelo menos um administrador' }). Idempotente: 200 se já estava assim (sem avisos).
 *   403 se quem pede é só membro; 404 se não é membro ou a pessoa não está no grupo. Avisa todos em tempo real
 *   ({ type: 'group', what: 'info' }) e a pessoa promovida com group_admin_granted (ator = quem promoveu). Tirar não notifica.
 *   GET /chat/groups/:id continua a trazer `role` em cada um de `group.members`.
 * - O limite de membros é atómico: entrar, aceitar, adicionar, sair e mudar de papel correm com o grupo bloqueado (ver locked()).
 *
 * O sítio no mapa (0104):
 * - PATCH /chat/groups/:id (admins) aceita também `mapPlace: { lat, lng, label?: string <= 80 | null } | null`: um ponto escolhido
 *   no mapa quando o plano não tem um local aprovado. Guarda-se SÓ o centro da quadrícula da malta (~1,5 km, ver nearby/geo-sql.ts);
 *   o ponto exato nunca é guardado nem devolvido. `null` limpa.
 * - Passar a público, ou a privado no mapa, exige sítio: o local do plano aprovado e com posição, ou o ponto (no mesmo pedido ou
 *   já guardado). Também não se tira o ponto a um grupo visível que fica sem sítio. Senão 400 { message: NO_MAP_PLACE }.
 *   Os grupos que já estavam visíveis sem sítio continuam como estão (só a mudança é validada).
 * - GET /chat/groups e GET /chat/groups/:id trazem `mapPlace: { lat, lng, label } | null` (o arredondado) e `mapReady: boolean`
 *   (tem sítio para o mapa: local do plano aprovado com posição, ou o ponto).
 */
@Injectable()
export class GroupsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly chat: ChatService,
    private readonly events: ChatEvents,
    private readonly push: PushService,
    private readonly filter: TextFilter,
    private readonly access: GroupAccess,
    private readonly plan: PlanService,
    private readonly pot: PotService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Uma foto própria, já carregada e livre (o mesmo que o logótipo dos locais). */
  private async assertCover(userId: string, mediaId: string) {
    const ok = await this.pool.query(
      `SELECT 1 FROM content.media_assets a WHERE a.id = $1 AND a.owner_id = $2 AND a.status = 'ready' AND a.mime LIKE 'image/%'
          AND NOT EXISTS (SELECT 1 FROM content.post_media pm WHERE pm.media_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM content.stories s WHERE s.media_id = a.id)`,
      [mediaId, userId],
    );
    if (!ok.rowCount) throw new BadRequestException('Foto inválida ou ainda não carregada');
  }

  private assertId(id: string) {
    if (!UUID.test(id)) throw new BadRequestException('Grupo inválido');
  }

  /** Papel da pessoa no grupo (null se não é membro). */
  private async roleOf(groupId: string, userId: string) {
    const { rows } = await this.pool.query('SELECT role FROM social.group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
    return (rows[0]?.role as 'admin' | 'member' | undefined) ?? null;
  }
  private async needMember(groupId: string, userId: string) {
    this.assertId(groupId);
    const role = await this.roleOf(groupId, userId);
    if (!role) throw new NotFoundException('Grupo não encontrado');
    return role;
  }

  /** Quem pode ser adicionado por `me`: sem bloqueio e a aceitar mensagens (ou já com conversa), como numa mensagem normal. */
  private async resolveInvitees(me: string, usernames: string[]) {
    const names = [...new Set(usernames.map((n) => n.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))];
    if (!names.length) return [];
    const { rows } = await this.pool.query(
      `SELECT u.id, u.username, u.status, ${blockedBetween('u.id', '$1')} AS blocked, ${allowedBy('u', 'dms_allowed')} AS allowed,
              EXISTS (SELECT 1 FROM social.conversations c WHERE c.user_a = LEAST($1::uuid, u.id) AND c.user_b = GREATEST($1::uuid, u.id)) AS spoke
         FROM identity.users u WHERE lower(u.username) = ANY($2)`,
      [me, names],
    );
    const byName = new Map(rows.map((r) => [String(r.username).toLowerCase(), r]));
    const out: string[] = [];
    for (const n of names) {
      const r = byName.get(n);
      if (!r || r.status !== 'active') throw new NotFoundException(`@${n} não existe`);
      if (r.id === me) continue;
      if (r.blocked) throw new ForbiddenException(`Não podes adicionar @${r.username}`);
      if (!r.allowed && !r.spoke) throw new ForbiddenException(`@${r.username} não aceita mensagens novas`);
      out.push(r.id as string);
    }
    return out;
  }

  async create(me: string, name: string, usernames: string[], info: Omit<GroupInfo, 'name'> = {}) {
    this.filter.assertClean(name, info.description ?? '');
    if (info.coverMediaId) await this.assertCover(me, info.coverMediaId);
    if (info.avatarMediaId) await this.assertCover(me, info.avatarMediaId);
    const invitees = await this.resolveInvitees(me, usernames);
    if (invitees.length < 2) throw new BadRequestException('Um grupo precisa de pelo menos 2 pessoas além de ti');
    if (invitees.length + 1 > MAX_MEMBERS) throw new BadRequestException(`Um grupo tem no máximo ${MAX_MEMBERS} pessoas`);
    const id = uuidv7();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO social.groups (id, name, created_by, kind, description, cover_media_id, avatar_media_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, name.trim(), me, info.kind ?? 'outro', info.description?.trim() || null, info.coverMediaId ?? null, info.avatarMediaId ?? null]);
      await client.query(`INSERT INTO social.group_members (group_id, user_id, role, joined_at) VALUES ($1, $2, 'admin', clock_timestamp())`, [id, me]);
      for (const u of invitees) await client.query(`INSERT INTO social.group_members (group_id, user_id, joined_at) VALUES ($1, $2, clock_timestamp())`, [id, u]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    for (const u of invitees) this.events.emit(u, { type: 'message', group: id });
    // O grupo novo aparece também na lista dos meus outros aparelhos.
    this.events.echo(me, { type: 'message', group: id });
    return { id };
  }

  /** Os grupos de que faço parte, com a última mensagem e quantas por ler (para a lista de conversas). */
  async list(me: string) {
    const { rows } = await this.pool.query(
      `SELECT g.id, g.name, g.last_message_at, g.ttl_seconds, gm.cleared_id,
              (SELECT count(*) FROM social.group_members x WHERE x.group_id = g.id)::int AS members,
              (SELECT json_agg(t) FROM (SELECT u.username, u.display_name AS "displayName", (u.avatar_media_id IS NOT NULL) AS "hasAvatar"
                  FROM social.group_members x JOIN identity.users u ON u.id = x.user_id WHERE x.group_id = g.id AND x.user_id <> $1 ORDER BY x.joined_at LIMIT 3) t) AS preview,
              CASE WHEN lm.view_once THEN '' WHEN lm.kind = 'poll' THEN (SELECT p.question FROM social.group_polls p WHERE p.id::text = lm.body) ELSE lm.body END AS last_body, lm.kind AS last_kind, lm.sender_id AS last_sender, lm.created_at AS last_at, lm.system AS last_system, su.display_name AS last_name,
              (SELECT count(*) FROM social.messages m WHERE m.group_id = g.id AND m.sender_id <> $1 AND m.deleted_at IS NULL AND m.kind <> 'system' AND ${notHiddenFor('m', '$1')} AND ${notExpired('m')}
                  AND (gm.read_id IS NULL OR m.id > gm.read_id) AND (gm.cleared_id IS NULL OR m.id > gm.cleared_id))::int AS unread
         FROM social.group_members gm
         JOIN social.groups g ON g.id = gm.group_id
         LEFT JOIN LATERAL (SELECT x.body, x.kind, x.sender_id, x.created_at, x.view_once, x.system FROM social.messages x WHERE x.group_id = g.id AND x.deleted_at IS NULL AND ${notHiddenFor('x', '$1')} AND ${notExpired('x')} AND (gm.cleared_id IS NULL OR x.id > gm.cleared_id) ORDER BY x.id DESC LIMIT 1) lm ON true
         LEFT JOIN identity.users su ON su.id = lm.sender_id
        WHERE gm.user_id = $1
        ORDER BY COALESCE(lm.created_at, g.last_message_at) DESC LIMIT 100`,
      [me],
    );
    const sums = await this.plan.summaries(me, rows.map((r) => r.id as string));
    return rows.map((r) => ({
      kind: 'group' as const,
      id: r.id as string,
      name: r.name as string,
      groupKind: sums.get(r.id as string)!.kind,
      ...(({ kind: _k, ...rest }) => rest)(sums.get(r.id as string)!),
      members: r.members as number,
      preview: (r.preview ?? []) as { username: string; displayName: string; hasAvatar: boolean }[],
      /** Mensagens temporárias: quanto dura cada mensagem nova (segundos), ou null (desligadas). */
      ttl: (r.ttl_seconds as number | null) ?? null,
      lastMessage: {
        body: r.last_kind === 'system' ? systemText(r.last_system as SystemInfo, r.last_sender === me) : ((r.last_body as string | null) ?? ''),
        kind: ((r.last_kind as MessageKind | null) ?? 'text') as MessageKind,
        fromMe: r.last_sender === me,
        // Num aviso de sistema o nome já vai no texto.
        senderName: r.last_sender === me || r.last_kind === 'system' ? null : ((r.last_name as string | null)?.split(' ')[0] ?? null),
        at: (r.last_at as string | null) ?? (r.last_message_at as string),
        empty: !r.last_at,
        /** Vazia porque a limpei ("Limpar conversa"): a lista mostra "Sem mensagens". */
        cleared: !r.last_at && !!r.cleared_id,
      },
      unread: r.unread as number,
    }));
  }

  /** O grupo e as mensagens (as mais recentes primeiro). Abrir marca como lido. */
  async thread(me: string, groupId: string, cursor?: string, markRead = true) {
    const myRole = await this.needMember(groupId, me);
    if (cursor && !UUID.test(cursor)) throw new BadRequestException('cursor inválido');
    const g = (await this.pool.query('SELECT g.id, g.name, g.ttl_seconds, gm.cleared_id FROM social.groups g JOIN social.group_members gm ON gm.group_id = g.id AND gm.user_id = $2 WHERE g.id = $1', [groupId, me])).rows[0];
    const members = (
      await this.pool.query(
        `SELECT u.id, u.username, u.display_name AS "displayName", (u.avatar_media_id IS NOT NULL) AS "hasAvatar", x.role
           FROM social.group_members x JOIN identity.users u ON u.id = x.user_id WHERE x.group_id = $1 ORDER BY (x.role = 'admin') DESC, x.joined_at`,
        [groupId],
      )
    ).rows as { id: string; username: string; displayName: string; hasAvatar: boolean; role: 'admin' | 'member' }[];
    const { rows } = await this.pool.query(
      `SELECT m.id, m.sender_id, m.body, m.kind, m.story_media_id, m.media_id, m.duration_ms, m.waveform, m.lat, m.lng, m.place_name, m.place_address, m.reply_to, m.created_at, m.view_once, m.deleted_at, m.edited_at, m.gif, m.expires_at, m.system,
              CASE WHEN m.sender_id = $4 THEN EXISTS (SELECT 1 FROM social.message_views v WHERE v.message_id = m.id) ELSE EXISTS (SELECT 1 FROM social.message_views v WHERE v.message_id = m.id AND v.user_id = $4) END AS viewed_at
         FROM social.messages m WHERE m.group_id = $1 AND (m.deleted_at IS NULL OR m.deleted_notice) AND ${notHiddenFor('m', '$4')} AND ${notExpired('m')}
          AND ($5::uuid IS NULL OR m.id > $5) AND ($2::uuid IS NULL OR m.id < $2) ORDER BY m.id DESC LIMIT $3`,
      [groupId, cursor ?? null, PAGE + 1, me, (g?.cleared_id as string | null) ?? null],
    );
    const page = rows.slice(0, PAGE);
    if (!cursor && markRead && page[0]) {
      const upd = await this.pool.query('UPDATE social.group_members SET read_id = $3 WHERE group_id = $1 AND user_id = $2 AND read_id IS DISTINCT FROM $3::uuid', [groupId, me, page[0].id]);
      // Li noutro aparelho: os meus outros aparelhos tiram o número de "por ler" da lista.
      if (upd.rowCount) this.events.echo(me, { type: 'read', group: groupId });
    }
    const bySender = new Map(members.map((m) => [m.id, m]));
    // Sondagens que aparecem nesta página da conversa (mensagens kind 'poll', body = id da sondagem).
    const pollIds = page.filter((m) => m.kind === 'poll' && UUID.test(String(m.body))).map((m) => String(m.body));
    const polls = new Map((await this.plan.polls(me, groupId, pollIds)).map((p) => [p.id, p]));
    const items = (await this.chat.mapItems(me, page)).map((it, i) => {
      const s = bySender.get(page[i].sender_id as string);
      return {
        ...it,
        ...(page[i].kind === 'poll' && !page[i].deleted_at ? { poll: polls.get(String(page[i].body)) ?? null } : {}),
        sender: s ? { username: s.username, displayName: s.displayName, hasAvatar: s.hasAvatar } : { username: '', displayName: 'Ex-membro', hasAvatar: false },
      };
    });
    const sum = (await this.plan.summaries(me, [groupId])).get(groupId)!;
    return {
      // `ttl`: mensagens temporárias (segundos, ou null); só quem administra muda (PUT /chat/groups/:id/ttl).
      group: { id: g.id as string, name: g.name as string, ...sum, groupKind: sum.kind, myRole, ttl: (g.ttl_seconds as number | null) ?? null, members: members.map(({ id: _id, ...m }) => m) },
      items,
      nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
    };
  }

  async send(me: string, groupId: string, msg: Outgoing) {
    if (msg.kind === 'text' || msg.kind === 'image') this.filter.assertClean(msg.body);
    await this.needMember(groupId, me);
    const place = await this.chat.validateOutgoing(me, msg);
    const id = uuidv7();
    const spot = this.chat.placeFields(msg);
    await this.pool.query(
      // Mensagens temporárias ligadas no grupo: leva `expires_at` (criação + duração). Só se responde a uma que ainda existe.
      `INSERT INTO social.messages (id, group_id, sender_id, body, kind, media_id, duration_ms, waveform, lat, lng, view_once, reply_to, place_name, place_address, gif, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $12, (SELECT r.id FROM social.messages r WHERE r.id = $11::uuid AND r.group_id = $2 AND r.deleted_at IS NULL AND r.kind <> 'system' AND ${notExpired('r')}), $13, $14, $15::jsonb, ${expiresFor('groups', '$2')})`,
      [id, groupId, me, spot.body, msg.kind, msg.mediaId ?? null, msg.durationMs ?? null, msg.kind === 'voice' ? (msg.waveform ?? null) : null, place?.lat ?? null, place?.lng ?? null, msg.replyTo ?? null, !!msg.once && (msg.kind === 'text' || msg.kind === 'image' || msg.kind === 'voice' || msg.kind === 'video'), spot.name, spot.address, msg.kind === 'gif' && msg.gif ? JSON.stringify(msg.gif) : null],
    );
    await this.access.fanOut(groupId, me, id, msg.kind === 'text' ? 'enviou uma mensagem' : msg.kind === 'image' ? 'enviou uma foto' : msg.kind === 'video' ? 'enviou um vídeo' : msg.kind === 'voice' ? 'enviou uma mensagem de voz' : msg.kind === 'sticker' ? 'enviou um sticker' : msg.kind === 'gif' ? 'enviou um GIF' : msg.kind === 'location' ? 'partilhou a localização' : 'partilhou uma publicação');
    return { id, kind: msg.kind };
  }

  /**
   * Mensagens temporárias no grupo (só quem administra): 24 h, 7 dias, 90 dias ou desligadas (`null`). Deixa o aviso de
   * sistema na conversa ("Dom ligou as mensagens temporárias: 7 dias.") e avisa todos em tempo real ('message', sem
   * notificação no telemóvel). Pedir o que já está não muda nada. Devolve { ttl }.
   */
  async setTtl(me: string, groupId: string, ttl: Ttl) {
    if ((await this.needMember(groupId, me)) !== 'admin') throw new ForbiddenException('Só quem administra muda as mensagens temporárias');
    const upd = await this.pool.query('UPDATE social.groups SET ttl_seconds = $2 WHERE id = $1 AND ttl_seconds IS DISTINCT FROM $2::int', [groupId, ttl]);
    if (!upd.rowCount) return { ttl };
    const sys: SystemInfo = { type: 'ttl', ttl, name: await this.chat.firstNameOf(me) };
    const id = uuidv7();
    await this.pool.query("INSERT INTO social.messages (id, group_id, sender_id, body, kind, system) VALUES ($1, $2, $3, $4, 'system', $5::jsonb)", [id, groupId, me, systemText(sys, false), JSON.stringify(sys)]);
    await this.pool.query('UPDATE social.group_members SET read_id = $3 WHERE group_id = $1 AND user_id = $2', [groupId, me, id]);
    await this.pool.query('UPDATE social.groups SET last_message_at = now() WHERE id = $1', [groupId]);
    const rows = (await this.pool.query('SELECT user_id FROM social.group_members WHERE group_id = $1', [groupId])).rows;
    for (const r of rows) {
      if (r.user_id === me) this.events.echo(me, { type: 'message', group: groupId });
      else this.events.emit(r.user_id as string, { type: 'message', group: groupId });
    }
    return { ttl };
  }

  /**
   * Limpar a conversa do grupo só para mim: as mensagens até agora deixam de me aparecer (os outros continuam a vê-las) e
   * o grupo fica na lista, vazio ("Sem mensagens"), até chegar outra. Os "Apagar para mim" dessas mensagens já não são
   * precisos e vão-se. Só os meus outros aparelhos são avisados (eco 'deleted').
   */
  async clear(me: string, groupId: string) {
    await this.needMember(groupId, me);
    const { rows } = await this.pool.query(
      `UPDATE social.group_members gm SET cleared_id = m.last, read_id = m.last
         FROM (SELECT max(id::text)::uuid AS last FROM social.messages WHERE group_id = $1) m
        WHERE gm.group_id = $1 AND gm.user_id = $2 AND m.last IS NOT NULL
        RETURNING m.last`,
      [groupId, me],
    );
    if (rows[0]) {
      await this.pool.query(
        'DELETE FROM social.message_hidden h USING social.messages m WHERE h.user_id = $1 AND h.message_id = m.id AND m.group_id = $2 AND m.id <= $3',
        [me, groupId, rows[0].last],
      );
    }
    this.events.echo(me, { type: 'deleted', group: groupId });
    return { ok: true };
  }

  /** Mudar o nome, o tipo, a descrição, a capa, a foto, a visibilidade ou o mapa (só quem administra; campos presentes, `null` limpa). */
  async update(me: string, groupId: string, b: GroupInfo) {
    if ((await this.needMember(groupId, me)) !== 'admin') throw new ForbiddenException('Só quem administra muda o grupo');
    this.filter.assertClean(b.name ?? '', b.description ?? '', b.mapPlace?.label ?? '');
    if (b.coverMediaId) await this.assertCover(me, b.coverMediaId);
    if (b.avatarMediaId) await this.assertCover(me, b.avatarMediaId);
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (b.name !== undefined) set('name', b.name.trim());
    if (b.kind !== undefined) set('kind', b.kind);
    if (b.description !== undefined) set('description', b.description?.trim() || null);
    if (b.coverMediaId !== undefined) set('cover_media_id', b.coverMediaId);
    if (b.avatarMediaId !== undefined) set('avatar_media_id', b.avatarMediaId);
    if (b.visibility !== undefined) set('visibility', b.visibility);
    if (b.showOnMap !== undefined) set('show_on_map', b.showOnMap);
    if (b.mapPlace !== undefined) {
      // Só se guarda o centro da quadrícula (a mesma regra da malta à tua volta); o ponto exato não sai daqui.
      const p = b.mapPlace ? roundPlace(b.mapPlace.lat, b.mapPlace.lng) : null;
      set('map_lat', p?.lat ?? null);
      set('map_lng', p?.lng ?? null);
      set('map_label', (b.mapPlace && b.mapPlace.label?.trim()) || null);
    }
    if (!sets.length) return;
    vals.push(groupId);
    const g = await this.locked(groupId, async (c) => {
      await this.assertMapPlace(c, groupId, b);
      return (await c.query(`UPDATE social.groups SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING name, visibility, show_on_map`, vals)).rows[0];
    });
    // Privado oculto (privado e fora do mapa): já ninguém de fora o vê, por isso os pedidos à espera (e os avisos aos admins) vão-se.
    if (g && g.visibility === 'private' && !g.show_on_map) await this.dropJoinRequests(groupId);
    await this.notifyMembers(groupId, me);
    await this.access.changed(groupId, 'info');
  }

  /**
   * Um grupo que passa a ser visto de fora (público, ou privado no mapa) precisa de sítio no mapa: o local do plano aprovado e
   * com posição, ou o ponto (deste pedido ou já guardado). Tirar o ponto a um grupo visível que fica sem sítio também não dá.
   * Corre com o grupo bloqueado, antes do UPDATE.
   */
  private async assertMapPlace(c: PoolClient, groupId: string, b: GroupInfo) {
    if (b.visibility === undefined && b.showOnMap === undefined && b.mapPlace === undefined) return;
    const g = (await c.query(
      `SELECT g.visibility, g.show_on_map, g.map_lat IS NOT NULL AS has_point,
              EXISTS (SELECT 1 FROM content.venues v WHERE v.id = g.plan_venue_id AND ${venueOnMap('v')}) AS venue_ok
         FROM social.groups g WHERE g.id = $1`,
      [groupId],
    )).rows[0] as { visibility: 'private' | 'public'; show_on_map: boolean; has_point: boolean; venue_ok: boolean };
    const visibleBefore = g.visibility === 'public' || g.show_on_map;
    const visibleAfter = (b.visibility ?? g.visibility) === 'public' || (b.showOnMap ?? g.show_on_map);
    const pointAfter = b.mapPlace === undefined ? g.has_point : b.mapPlace !== null;
    const turningVisible = (b.visibility === 'public' && g.visibility !== 'public') || (b.showOnMap === true && !visibleBefore);
    const droppingPoint = b.mapPlace === null && g.has_point;
    if (visibleAfter && !g.venue_ok && !pointAfter && (turningVisible || droppingPoint)) throw new BadRequestException(NO_MAP_PLACE);
  }

  async rename(me: string, groupId: string, name: string) {
    return this.update(me, groupId, { name });
  }

  async addMembers(me: string, groupId: string, usernames: string[]) {
    if ((await this.needMember(groupId, me)) !== 'admin') throw new ForbiddenException('Só quem administra adiciona pessoas');
    const ids = await this.resolveInvitees(me, usernames);
    await this.locked(groupId, async (c) => {
      const count = (await c.query('SELECT count(*)::int AS n FROM social.group_members WHERE group_id = $1', [groupId])).rows[0].n as number;
      if (count + ids.length > MAX_MEMBERS) throw new BadRequestException(`Um grupo tem no máximo ${MAX_MEMBERS} pessoas`);
      for (const u of ids) await this.insertMember(groupId, u, c);
    });
    await this.notifyMembers(groupId, me);
  }

  /**
   * Corre `fn` numa transação com a linha do grupo bloqueada (FOR NO KEY UPDATE: um de cada vez por grupo, sem travar
   * quem só escreve mensagens): contar e inserir membros, ou mudar quem administra, não se atropela com pedidos em simultâneo.
   * 404 se o grupo já não existe.
   */
  private async locked<T>(groupId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const g = await client.query('SELECT 1 FROM social.groups WHERE id = $1 FOR NO KEY UPDATE', [groupId]);
      if (!g.rowCount) throw new NotFoundException('Grupo não encontrado');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Entrar pela porta de fora (grupo público ou pedido aceite): a mesma via de adicionar membro, entra como `member`.
   * `by` é quem deixou entrar (o admin que aceitou; a própria pessoa num grupo público). 409 se o grupo já está cheio.
   * Conta e insere com o grupo bloqueado: com pedidos em simultâneo nunca passa de MAX_MEMBERS.
   * Devolve false se a pessoa já era membro (nada muda).
   */
  async admit(groupId: string, userId: string, by: string): Promise<boolean> {
    const added = await this.locked(groupId, async (c) => {
      if ((await c.query('SELECT 1 FROM social.group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId])).rowCount) return false;
      const count = (await c.query('SELECT count(*)::int AS n FROM social.group_members WHERE group_id = $1', [groupId])).rows[0].n as number;
      if (count + 1 > MAX_MEMBERS) throw new ConflictException(`Este grupo já está cheio (máximo ${MAX_MEMBERS} pessoas)`);
      await this.insertMember(groupId, userId, c);
      return true;
    });
    if (!added) return false;
    await this.notifyMembers(groupId, by);
    // Quem entrou vê o grupo aparecer na lista de conversas (se entrou sozinho, num grupo público, o eco de notifyMembers já chega).
    if (by !== userId) this.events.emit(userId, { type: 'message', group: groupId });
    return true;
  }

  private async insertMember(groupId: string, userId: string, db: Db = this.pool) {
    await db.query('INSERT INTO social.group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [groupId, userId]);
    // Quem estava à espera (e foi aceite ou adicionado por um admin) deixa de ter o pedido pendente.
    await this.dropJoinRequests(groupId, userId, db);
  }

  /** Apaga pedidos para entrar (de uma pessoa, ou todos os do grupo) e as notificações que os anunciavam aos admins. */
  async dropJoinRequests(groupId: string, userId?: string, db: Db = this.pool) {
    await db.query('DELETE FROM social.group_join_requests WHERE group_id = $1 AND ($2::uuid IS NULL OR user_id = $2)', [groupId, userId ?? null]);
    await db.query(
      `DELETE FROM social.notifications WHERE kind = 'group_join_request' AND data->>'groupId' = $1 AND ($2::uuid IS NULL OR actor_id = $2)`,
      [groupId, userId ?? null],
    );
  }

  /** O admin tira alguém; qualquer pessoa pode sair (passa a admin o membro mais antigo se não ficar nenhum). */
  async removeMember(me: string, groupId: string, username: string) {
    await this.needMember(groupId, me);
    // Com o grupo bloqueado: quem sai e quem muda de papel ao mesmo tempo não deixam o grupo sem admin.
    const { target, empty } = await this.locked(groupId, async (c) => {
      const role = (await c.query('SELECT role FROM social.group_members WHERE group_id = $1 AND user_id = $2', [groupId, me])).rows[0]?.role as string | undefined;
      if (!role) throw new NotFoundException('Grupo não encontrado');
      const t = (await c.query('SELECT u.id FROM social.group_members x JOIN identity.users u ON u.id = x.user_id WHERE x.group_id = $1 AND lower(u.username) = lower($2)', [groupId, username])).rows[0];
      if (!t) throw new NotFoundException('Essa pessoa não está no grupo');
      if (t.id !== me && role !== 'admin') throw new ForbiddenException('Só quem administra tira pessoas');
      await c.query('DELETE FROM social.group_members WHERE group_id = $1 AND user_id = $2', [groupId, t.id]);
      const left = (await c.query('SELECT user_id, role FROM social.group_members WHERE group_id = $1 ORDER BY joined_at', [groupId])).rows;
      if (left.length && !left.some((r) => r.role === 'admin')) await c.query(`UPDATE social.group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2`, [groupId, left[0].user_id]);
      return { target: t.id as string, empty: !left.length };
    });
    if (empty) {
      // O grupo vai desaparecer: o cofre volta primeiro a quem contribuiu (nenhum Txill fica preso).
      await this.pot.refundAll(me, groupId, `fecho:${groupId}`);
      await this.pool.query('DELETE FROM social.groups WHERE id = $1', [groupId]);
    }
    // Quem saiu pelo seu pé: o grupo some dos seus outros aparelhos (eco); quem foi tirado é avisado.
    if (target === me) this.events.echo(me, { type: 'deleted', group: groupId });
    else this.events.emit(target, { type: 'deleted', group: groupId });
    await this.notifyMembers(groupId, me);
  }

  /**
   * Quem administra dá ou tira o papel de admin (também a si próprio, se ficar outro admin). Contrato no topo.
   * Devolve { username (como está na conta), role }.
   */
  async setRole(me: string, groupId: string, username: string, role: 'admin' | 'member') {
    if ((await this.needMember(groupId, me)) !== 'admin') throw new ForbiddenException('Só quem administra muda quem administra');
    const name = username.trim().replace(/^@/, '').slice(0, 40);
    const r = await this.locked(groupId, async (c) => {
      // De novo com o grupo bloqueado: entretanto posso ter deixado de ser admin (ou de estar no grupo).
      const mine = (await c.query('SELECT role FROM social.group_members WHERE group_id = $1 AND user_id = $2', [groupId, me])).rows[0]?.role as string | undefined;
      if (!mine) throw new NotFoundException('Grupo não encontrado');
      if (mine !== 'admin') throw new ForbiddenException('Só quem administra muda quem administra');
      const t = (await c.query(
        `SELECT u.id, u.username, x.role, g.name AS group_name,
                (SELECT count(*) FROM social.group_members a WHERE a.group_id = x.group_id AND a.role = 'admin')::int AS admins
           FROM social.group_members x JOIN identity.users u ON u.id = x.user_id JOIN social.groups g ON g.id = x.group_id
          WHERE x.group_id = $1 AND lower(u.username) = lower($2)`,
        [groupId, name],
      )).rows[0];
      if (!t) throw new NotFoundException('Essa pessoa não está no grupo');
      const out = { id: t.id as string, username: t.username as string, groupName: t.group_name as string, changed: t.role !== role };
      if (!out.changed) return out;
      if (role === 'member' && (t.admins as number) <= 1) throw new ConflictException('O grupo precisa de pelo menos um administrador');
      await c.query('UPDATE social.group_members SET role = $3 WHERE group_id = $1 AND user_id = $2', [groupId, t.id, role]);
      return out;
    });
    if (r.changed) {
      await this.access.changed(groupId, 'info');
      if (role === 'admin') await this.notifications.notify({ userId: r.id, actorId: me, kind: 'group_admin_granted', data: { groupId, groupName: r.groupName } });
    }
    return { username: r.username, role };
  }

  /**
   * Mudaram os membros ou os dados do grupo: os outros membros voltam a pedir o grupo; quem fez a mudança (`by`, se ainda
   * for membro) recebe o eco ('message' com self: a conversa e a lista põem-se em dia nos seus outros aparelhos).
   */
  private async notifyMembers(groupId: string, by: string) {
    const rows = (await this.pool.query('SELECT user_id FROM social.group_members WHERE group_id = $1', [groupId])).rows;
    for (const r of rows) {
      if (r.user_id === by) this.events.echo(by, { type: 'message', group: groupId });
      else this.events.emit(r.user_id as string, { type: 'read', group: groupId });
    }
  }
}
