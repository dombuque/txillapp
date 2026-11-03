import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TextFilter } from '../safety/text-filter.service';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { PushService } from '../push/push.service';
import { allowedBy, blockedBetween } from '../social/visibility';
import { ChatEvents } from './chat.events';
import { ChatService, Outgoing, type MessageKind } from './chat.service';

const PAGE = 30;
export const MAX_MEMBERS = 50;
const UUID = /^[0-9a-f-]{36}$/;

/** Conversas de grupo: criar, mensagens, membros (admin adiciona/remove; qualquer um sai). */
@Injectable()
export class GroupsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly chat: ChatService,
    private readonly events: ChatEvents,
    private readonly push: PushService,
    private readonly filter: TextFilter,
  ) {}

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

  async create(me: string, name: string, usernames: string[]) {
    this.filter.assertClean(name);
    const invitees = await this.resolveInvitees(me, usernames);
    if (invitees.length < 2) throw new BadRequestException('Um grupo precisa de pelo menos 2 pessoas além de ti');
    if (invitees.length + 1 > MAX_MEMBERS) throw new BadRequestException(`Um grupo tem no máximo ${MAX_MEMBERS} pessoas`);
    const id = uuidv7();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO social.groups (id, name, created_by) VALUES ($1, $2, $3)', [id, name.trim(), me]);
      await client.query(`INSERT INTO social.group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`, [id, me]);
      for (const u of invitees) await client.query(`INSERT INTO social.group_members (group_id, user_id) VALUES ($1, $2)`, [id, u]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    for (const u of invitees) this.events.emit(u, { type: 'message', group: id });
    return { id };
  }

  /** Os grupos de que faço parte, com a última mensagem e quantas por ler (para a lista de conversas). */
  async list(me: string) {
    const { rows } = await this.pool.query(
      `SELECT g.id, g.name, g.last_message_at,
              (SELECT count(*) FROM social.group_members x WHERE x.group_id = g.id)::int AS members,
              (SELECT json_agg(t) FROM (SELECT u.username, u.display_name AS "displayName", (u.avatar_media_id IS NOT NULL) AS "hasAvatar"
                  FROM social.group_members x JOIN identity.users u ON u.id = x.user_id WHERE x.group_id = g.id AND x.user_id <> $1 ORDER BY x.joined_at LIMIT 3) t) AS preview,
              lm.body AS last_body, lm.kind AS last_kind, lm.sender_id AS last_sender, lm.created_at AS last_at, su.display_name AS last_name,
              (SELECT count(*) FROM social.messages m WHERE m.group_id = g.id AND m.sender_id <> $1 AND m.deleted_at IS NULL
                  AND (gm.read_id IS NULL OR m.id > gm.read_id))::int AS unread
         FROM social.group_members gm
         JOIN social.groups g ON g.id = gm.group_id
         LEFT JOIN LATERAL (SELECT body, kind, sender_id, created_at FROM social.messages WHERE group_id = g.id AND deleted_at IS NULL ORDER BY id DESC LIMIT 1) lm ON true
         LEFT JOIN identity.users su ON su.id = lm.sender_id
        WHERE gm.user_id = $1
        ORDER BY COALESCE(lm.created_at, g.created_at) DESC LIMIT 100`,
      [me],
    );
    return rows.map((r) => ({
      kind: 'group' as const,
      id: r.id as string,
      name: r.name as string,
      members: r.members as number,
      preview: (r.preview ?? []) as { username: string; displayName: string; hasAvatar: boolean }[],
      lastMessage: {
        body: (r.last_body as string | null) ?? '',
        kind: ((r.last_kind as MessageKind | null) ?? 'text') as MessageKind,
        fromMe: r.last_sender === me,
        senderName: r.last_sender === me ? null : ((r.last_name as string | null)?.split(' ')[0] ?? null),
        at: (r.last_at as string | null) ?? (r.last_message_at as string),
        empty: !r.last_at,
      },
      unread: r.unread as number,
    }));
  }

  /** O grupo e as mensagens (as mais recentes primeiro). Abrir marca como lido. */
  async thread(me: string, groupId: string, cursor?: string) {
    const myRole = await this.needMember(groupId, me);
    if (cursor && !UUID.test(cursor)) throw new BadRequestException('cursor inválido');
    const g = (await this.pool.query('SELECT id, name FROM social.groups WHERE id = $1', [groupId])).rows[0];
    const members = (
      await this.pool.query(
        `SELECT u.id, u.username, u.display_name AS "displayName", (u.avatar_media_id IS NOT NULL) AS "hasAvatar", x.role
           FROM social.group_members x JOIN identity.users u ON u.id = x.user_id WHERE x.group_id = $1 ORDER BY (x.role = 'admin') DESC, x.joined_at`,
        [groupId],
      )
    ).rows as { id: string; username: string; displayName: string; hasAvatar: boolean; role: 'admin' | 'member' }[];
    const { rows } = await this.pool.query(
      `SELECT m.id, m.sender_id, m.body, m.kind, m.story_media_id, m.media_id, m.duration_ms, m.waveform, m.lat, m.lng, m.reply_to, m.created_at
         FROM social.messages m WHERE m.group_id = $1 AND m.deleted_at IS NULL AND ($2::uuid IS NULL OR m.id < $2) ORDER BY m.id DESC LIMIT $3`,
      [groupId, cursor ?? null, PAGE + 1],
    );
    const page = rows.slice(0, PAGE);
    if (!cursor && page[0]) {
      await this.pool.query('UPDATE social.group_members SET read_id = $3 WHERE group_id = $1 AND user_id = $2 AND read_id IS DISTINCT FROM $3::uuid', [groupId, me, page[0].id]);
    }
    const bySender = new Map(members.map((m) => [m.id, m]));
    const items = (await this.chat.mapItems(me, page)).map((it, i) => {
      const s = bySender.get(page[i].sender_id as string);
      return { ...it, sender: s ? { username: s.username, displayName: s.displayName, hasAvatar: s.hasAvatar } : { username: '', displayName: 'Ex-membro', hasAvatar: false } };
    });
    return {
      group: { id: g.id as string, name: g.name as string, myRole, members: members.map(({ id: _id, ...m }) => m) },
      items,
      nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
    };
  }

  async send(me: string, groupId: string, msg: Outgoing) {
    if (msg.kind === 'text' || msg.kind === 'image') this.filter.assertClean(msg.body);
    await this.needMember(groupId, me);
    const place = await this.chat.validateOutgoing(me, msg);
    const id = uuidv7();
    await this.pool.query(
      'INSERT INTO social.messages (id, group_id, sender_id, body, kind, media_id, duration_ms, waveform, lat, lng, reply_to) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT r.id FROM social.messages r WHERE r.id = $11::uuid AND r.group_id = $2 AND r.deleted_at IS NULL))',
      [id, groupId, me, msg.kind === 'location' ? msg.body.slice(0, 80) : msg.body, msg.kind, msg.mediaId ?? null, msg.durationMs ?? null, msg.kind === 'voice' ? (msg.waveform ?? null) : null, place?.lat ?? null, place?.lng ?? null, msg.replyTo ?? null],
    );
    await this.pool.query('UPDATE social.group_members SET read_id = $3 WHERE group_id = $1 AND user_id = $2', [groupId, me, id]);
    await this.pool.query('UPDATE social.groups SET last_message_at = now() WHERE id = $1', [groupId]);
    const others = (await this.pool.query('SELECT user_id FROM social.group_members WHERE group_id = $1 AND user_id <> $2', [groupId, me])).rows.map((r) => r.user_id as string);
    const meta = (await this.pool.query('SELECT g.name, u.display_name FROM social.groups g, identity.users u WHERE g.id = $1 AND u.id = $2', [groupId, me])).rows[0];
    for (const u of others) {
      this.events.emit(u, { type: 'message', group: groupId });
      void this.push.send(u, { title: meta.name as string, body: `${(meta.display_name as string).split(' ')[0]}: ${msg.kind === 'text' ? 'enviou uma mensagem' : msg.kind === 'image' ? 'enviou uma foto' : msg.kind === 'voice' ? 'enviou uma mensagem de voz' : msg.kind === 'sticker' ? 'enviou um sticker' : msg.kind === 'location' ? 'partilhou a localização' : 'partilhou uma publicação'}`, url: `/messages/g/${groupId}`, tag: `group:${groupId}` });
    }
    return { id, kind: msg.kind };
  }

  async rename(me: string, groupId: string, name: string) {
    if ((await this.needMember(groupId, me)) !== 'admin') throw new ForbiddenException('Só quem administra muda o nome');
    await this.pool.query('UPDATE social.groups SET name = $2 WHERE id = $1', [groupId, name.trim()]);
    await this.notifyMembers(groupId, me);
  }

  async addMembers(me: string, groupId: string, usernames: string[]) {
    if ((await this.needMember(groupId, me)) !== 'admin') throw new ForbiddenException('Só quem administra adiciona pessoas');
    const ids = await this.resolveInvitees(me, usernames);
    const count = (await this.pool.query('SELECT count(*)::int AS n FROM social.group_members WHERE group_id = $1', [groupId])).rows[0].n as number;
    if (count + ids.length > MAX_MEMBERS) throw new BadRequestException(`Um grupo tem no máximo ${MAX_MEMBERS} pessoas`);
    for (const u of ids) await this.pool.query('INSERT INTO social.group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [groupId, u]);
    await this.notifyMembers(groupId, me);
  }

  /** O admin tira alguém; qualquer pessoa pode sair (passa a admin o membro mais antigo se não ficar nenhum). */
  async removeMember(me: string, groupId: string, username: string) {
    const role = await this.needMember(groupId, me);
    const t = (await this.pool.query('SELECT u.id FROM social.group_members x JOIN identity.users u ON u.id = x.user_id WHERE x.group_id = $1 AND lower(u.username) = lower($2)', [groupId, username])).rows[0];
    if (!t) throw new NotFoundException('Essa pessoa não está no grupo');
    if (t.id !== me && role !== 'admin') throw new ForbiddenException('Só quem administra tira pessoas');
    await this.pool.query('DELETE FROM social.group_members WHERE group_id = $1 AND user_id = $2', [groupId, t.id]);
    const left = (await this.pool.query('SELECT user_id, role FROM social.group_members WHERE group_id = $1 ORDER BY joined_at', [groupId])).rows;
    if (!left.length) await this.pool.query('DELETE FROM social.groups WHERE id = $1', [groupId]);
    else if (!left.some((r) => r.role === 'admin')) await this.pool.query(`UPDATE social.group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2`, [groupId, left[0].user_id]);
    this.events.emit(t.id as string, { type: 'deleted', group: groupId });
    await this.notifyMembers(groupId, me);
  }

  private async notifyMembers(groupId: string, except: string) {
    const rows = (await this.pool.query('SELECT user_id FROM social.group_members WHERE group_id = $1 AND user_id <> $2', [groupId, except])).rows;
    for (const r of rows) this.events.emit(r.user_id as string, { type: 'read', group: groupId });
  }
}
