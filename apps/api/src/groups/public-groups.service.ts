import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { GroupsService, MAX_MEMBERS } from '../chat/groups.service';
import { PG_POOL } from '../db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { GroupAccess, adminBlocked, pendingVisibleTo } from './group-access';

/*
 * TxillGroups vistos de fora. Três modos (colunas social.groups.visibility e show_on_map):
 *   privado oculto (por omissão): ninguém de fora o vê; só entra quem um admin adiciona;
 *   privado no mapa (show_on_map): aparece em "À tua volta" e aqui; quem não é membro PEDE e um admin aceita;
 *   público (visibility = 'public'): aparece sempre; quem não é membro ENTRA LOGO.
 * Quem bloqueou ou foi bloqueado por um admin do grupo não o vê de fora nem pode pedir (404).
 * Mensagens, sondagens, lista, despesas, álbum, cofre e a lista de membros continuam só para membros.
 *
 * GET    /chat/groups/:id/public -> { id, name, groupKind, description, coverUrl, avatarUrl, visibility, joinMode: 'open' | 'request',
 *          destination, venueName, startsOn, endsOn, members, me: 'none' | 'pending' | 'member' }   (404 se oculto ou com bloqueio; membros veem sempre)
 * POST   /chat/groups/:id/join-requests -> público: 200 { status: 'member' } (entra logo; avisa os admins com group_member_joined)
 *                                          privado no mapa: 201 { status: 'pending' } (200 se já estava à espera; avisa os admins com group_join_request)
 *          409 { message } se já é membro ou o grupo está cheio; 404 se oculto ou com bloqueio.
 * DELETE /chat/groups/:id/join-requests/me -> 204 (cancela o meu pedido; também se não houver)
 * GET    /chat/groups/:id/join-requests (admins) -> [{ username, displayName, avatarUrl, createdAt }], o mais antigo primeiro
 * POST   /chat/groups/:id/join-requests/:username/accept (admins) -> 200 { status: 'member' } (avisa quem pediu com group_join_accepted)
 * POST   /chat/groups/:id/join-requests/:username/decline (admins) -> 204, sem aviso
 *          (404 se não há pedido dessa pessoa; 409 ao aceitar com o grupo cheio)
 */
export type JoinMode = 'open' | 'request';

interface GroupRow {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  cover_media_id: string | null;
  avatar_media_id: string | null;
  visibility: 'private' | 'public';
  show_on_map: boolean;
  destination: string | null;
  venue_name: string | null;
  starts_on: string | null;
  ends_on: string | null;
  members: number;
  my_role: 'admin' | 'member' | null;
  pending: boolean;
  blocked: boolean;
}

const media = (id: string | null) => (id ? `/api/v1/media/${id}` : null);

@Injectable()
export class PublicGroupsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly access: GroupAccess,
    private readonly groups: GroupsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** O grupo como o vê `me` (ainda sem dizer se pode vê-lo). */
  private async load(me: string, groupId: string): Promise<GroupRow | null> {
    this.access.assertId(groupId);
    const { rows } = await this.pool.query(
      `SELECT g.id, g.name, g.kind, g.description, g.cover_media_id, g.avatar_media_id, g.visibility, g.show_on_map,
              g.destination, CASE WHEN v.review_status = 'approved' THEN v.name END AS venue_name,
              g.starts_on::text AS starts_on, g.ends_on::text AS ends_on,
              (SELECT count(*) FROM social.group_members gm WHERE gm.group_id = g.id)::int AS members,
              (SELECT gm.role FROM social.group_members gm WHERE gm.group_id = g.id AND gm.user_id = $2) AS my_role,
              EXISTS (SELECT 1 FROM social.group_join_requests jr WHERE jr.group_id = g.id AND jr.user_id = $2) AS pending,
              ${adminBlocked('g.id', '$2')} AS blocked
         FROM social.groups g LEFT JOIN content.venues v ON v.id = g.plan_venue_id
        WHERE g.id = $1`,
      [groupId, me],
    );
    return (rows[0] as GroupRow | undefined) ?? null;
  }

  /** Visto de fora: público ou no mapa, e sem bloqueio com nenhum admin. */
  private seenFromOutside(g: GroupRow) {
    return (g.visibility === 'public' || g.show_on_map) && !g.blocked;
  }

  async view(me: string, groupId: string) {
    const g = await this.load(me, groupId);
    if (!g || (!g.my_role && !this.seenFromOutside(g))) throw new NotFoundException('Grupo não encontrado');
    return {
      id: g.id,
      name: g.name,
      groupKind: g.kind,
      description: g.description ?? null,
      coverUrl: media(g.cover_media_id),
      avatarUrl: media(g.avatar_media_id),
      visibility: g.visibility,
      joinMode: (g.visibility === 'public' ? 'open' : 'request') as JoinMode,
      destination: g.destination ?? null,
      venueName: g.venue_name ?? null,
      startsOn: g.starts_on ?? null,
      endsOn: g.ends_on ?? null,
      members: g.members,
      me: (g.my_role ? 'member' : g.pending ? 'pending' : 'none') as 'none' | 'pending' | 'member',
    };
  }

  /** Entrar (público) ou pedir para entrar (privado no mapa). `created` diz se o pedido é novo (201) ou não (200). */
  async request(me: string, groupId: string): Promise<{ status: 'member' | 'pending'; created: boolean }> {
    const g = await this.load(me, groupId);
    if (g?.my_role) throw new ConflictException('Já fazes parte deste grupo');
    if (!g || !this.seenFromOutside(g)) throw new NotFoundException('Grupo não encontrado');
    const data = { groupId: g.id, groupName: g.name };
    if (g.visibility === 'public') {
      await this.groups.admit(g.id, me, me);
      for (const a of await this.admins(g.id)) await this.notifications.notify({ userId: a, actorId: me, kind: 'group_member_joined', data });
      return { status: 'member', created: false };
    }
    if (g.pending) return { status: 'pending', created: false };
    if (g.members >= MAX_MEMBERS) throw new ConflictException(`Este grupo já está cheio (máximo ${MAX_MEMBERS} pessoas)`);
    const ins = await this.pool.query('INSERT INTO social.group_join_requests (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [g.id, me]);
    if (!ins.rowCount) return { status: 'pending', created: false };
    for (const a of await this.admins(g.id)) {
      await this.notifications.notify({ userId: a, actorId: me, kind: 'group_join_request', data });
      this.access.notifyInfo(a, g.id);
    }
    return { status: 'pending', created: true };
  }

  async cancel(me: string, groupId: string) {
    this.access.assertId(groupId);
    const had = await this.pool.query('SELECT 1 FROM social.group_join_requests WHERE group_id = $1 AND user_id = $2', [groupId, me]);
    if (!had.rowCount) return;
    await this.groups.dropJoinRequests(groupId, me);
    for (const a of await this.admins(groupId)) this.access.notifyInfo(a, groupId);
  }

  async list(me: string, groupId: string) {
    await this.access.needAdmin(groupId, me, 'Só quem administra o grupo vê os pedidos');
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name, u.avatar_media_id IS NOT NULL AS has_avatar, jr.created_at
         FROM social.group_join_requests jr JOIN identity.users u ON u.id = jr.user_id
        WHERE jr.group_id = $1 AND ${pendingVisibleTo('jr', '$2')}
        ORDER BY jr.created_at, u.username`,
      [groupId, me],
    );
    return rows.map((r) => ({
      username: r.username as string,
      displayName: r.display_name as string,
      avatarUrl: r.has_avatar ? `/api/v1/avatars/${encodeURIComponent(r.username as string)}` : null,
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
  }

  /** O pedido de @username neste grupo (que este admin pode ver), ou 404. */
  private async requester(me: string, groupId: string, username: string) {
    await this.access.needAdmin(groupId, me, 'Só quem administra o grupo responde aos pedidos');
    const r = (await this.pool.query(
      `SELECT jr.user_id FROM social.group_join_requests jr JOIN identity.users u ON u.id = jr.user_id
        WHERE jr.group_id = $1 AND lower(u.username) = lower($3) AND ${pendingVisibleTo('jr', '$2')}`,
      [groupId, me, username.trim().replace(/^@/, '').slice(0, 40)],
    )).rows[0];
    if (!r) throw new NotFoundException('Pedido não encontrado');
    return r.user_id as string;
  }

  async accept(me: string, groupId: string, username: string) {
    const userId = await this.requester(me, groupId, username);
    await this.groups.admit(groupId, userId, me);
    const name = (await this.pool.query('SELECT name FROM social.groups WHERE id = $1', [groupId])).rows[0]?.name as string;
    await this.notifications.notify({ userId, actorId: me, kind: 'group_join_accepted', data: { groupId, groupName: name } });
    for (const a of await this.admins(groupId)) this.access.notifyInfo(a, groupId);
    return { status: 'member' as const };
  }

  async decline(me: string, groupId: string, username: string) {
    const userId = await this.requester(me, groupId, username);
    await this.groups.dropJoinRequests(groupId, userId);
    for (const a of await this.admins(groupId)) this.access.notifyInfo(a, groupId);
  }

  private async admins(groupId: string): Promise<string[]> {
    return (await this.pool.query(`SELECT user_id FROM social.group_members WHERE group_id = $1 AND role = 'admin'`, [groupId])).rows.map((r) => r.user_id as string);
  }
}
