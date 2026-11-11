import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { PushService } from '../push/push.service';
import { ChatEvents, type GroupEvent } from '../chat/chat.events';
import { blockedBetween } from '../social/visibility';

const UUID = /^[0-9a-f-]{36}$/;
export type GroupRole = 'admin' | 'member';

/**
 * Há bloqueio (em qualquer sentido) entre `user` e ALGUM membro atual do grupo `group`, ou quem o criou?
 * Quem está nesse caso não vê o grupo de fora (nem no mapa), não pede, não entra, e um pedido que já tinha deixa de
 * aparecer aos admins e não se pode aceitar. Parte dos bloqueios de `user` (poucos; chave e blocks_blocked_idx) e
 * procura cada um nos membros pela chave (group_id, user_id): não percorre os membros do grupo.
 */
export const memberBlocked = (group: string, user: string) =>
  `(EXISTS (SELECT 1 FROM social.blocks bk JOIN social.group_members bm ON bm.group_id = ${group} AND bm.user_id = bk.blocked_id WHERE bk.blocker_id = ${user})` +
  ` OR EXISTS (SELECT 1 FROM social.blocks bk JOIN social.group_members bm ON bm.group_id = ${group} AND bm.user_id = bk.blocker_id WHERE bk.blocked_id = ${user})` +
  ` OR EXISTS (SELECT 1 FROM social.groups bg WHERE bg.id = ${group} AND bg.created_by IS NOT NULL AND ${blockedBetween('bg.created_by', user)}))`;

/**
 * O local do plano (alias `v`, de content.venues) serve de sítio no mapa: aprovado pela equipa, com posição e no mapa
 * (quem gere o local não o tirou do mapa). Senão o grupo usa o ponto que um admin escolheu.
 */
export const venueOnMap = (v: string) => `(${v}.review_status = 'approved' AND ${v}.show_on_map AND ${v}.lat IS NOT NULL AND ${v}.lng IS NOT NULL)`;

/** Mensagem quando um grupo passaria a aparecer em "À tua volta" sem sítio (nem local aprovado do plano, nem ponto). */
export const NO_MAP_PLACE = 'Escolhe onde é o grupo para aparecer em À tua volta';

/** Um pedido para entrar (alias `jr`) que os admins veem e podem aceitar: conta activa e sem bloqueio com nenhum membro (nem com quem criou). */
export const pendingVisible = (jr: string) =>
  `(EXISTS (SELECT 1 FROM identity.users ru WHERE ru.id = ${jr}.user_id AND ru.status = 'active') AND NOT ${memberBlocked(`${jr}.group_id`, `${jr}.user_id`)})`;

/** Peças comuns aos TxillGroups: quem é membro, quem administra, avisos em tempo real e mensagens do grupo. */
@Injectable()
export class GroupAccess {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly events: ChatEvents,
    private readonly push: PushService,
  ) {}

  assertId(id: string, what = 'Grupo') {
    if (!UUID.test(id)) throw new BadRequestException(`${what} inválido`);
  }

  async roleOf(groupId: string, userId: string): Promise<GroupRole | null> {
    const { rows } = await this.pool.query('SELECT role FROM social.group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
    return (rows[0]?.role as GroupRole | undefined) ?? null;
  }

  /** Só membros; quem não é membro recebe 404 (não se sabe se o grupo existe). */
  async needMember(groupId: string, userId: string): Promise<GroupRole> {
    this.assertId(groupId);
    const role = await this.roleOf(groupId, userId);
    if (!role) throw new NotFoundException('Grupo não encontrado');
    return role;
  }

  async needAdmin(groupId: string, userId: string, msg = 'Só quem administra o grupo pode fazer isto') {
    if ((await this.needMember(groupId, userId)) !== 'admin') throw new ForbiddenException(msg);
  }

  async memberIds(groupId: string): Promise<string[]> {
    return (await this.pool.query('SELECT user_id FROM social.group_members WHERE group_id = $1', [groupId])).rows.map((r) => r.user_id as string);
  }

  /** Membros do grupo por @utilizador (lança 400 se algum não é membro). */
  async membersByUsername(groupId: string, usernames: string[]): Promise<Map<string, string>> {
    const names = [...new Set(usernames.map((n) => n.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))];
    const { rows } = await this.pool.query(
      'SELECT u.id, lower(u.username) AS username FROM social.group_members m JOIN identity.users u ON u.id = m.user_id WHERE m.group_id = $1 AND lower(u.username) = ANY($2)',
      [groupId, names],
    );
    const map = new Map(rows.map((r) => [r.username as string, r.id as string]));
    const missing = names.find((n) => !map.has(n));
    if (missing) throw new BadRequestException(`@${missing} não está no grupo`);
    return map;
  }

  /** Avisa todos os membros (também quem fez a mudança, para os outros ecrãs dele) de que algo mudou no grupo. */
  async changed(groupId: string, what: GroupEvent['what']) {
    for (const u of await this.memberIds(groupId)) this.events.emit(u, { type: 'group', groupId, what });
  }

  /** Avisa uma pessoa (ex.: um admin, quando há pedidos novos para entrar) de que os dados do grupo mudaram. */
  notifyInfo(userId: string, groupId: string) {
    this.events.emit(userId, { type: 'group', groupId, what: 'info' });
  }

  /**
   * Depois de uma mensagem nova no grupo: marca como lida para quem enviou, sobe o grupo na lista e avisa os outros
   * (em tempo real e, a quem não tem a conversa aberta, no telemóvel com um texto genérico).
   */
  async fanOut(groupId: string, senderId: string, messageId: string, what: string) {
    await this.pool.query('UPDATE social.group_members SET read_id = $3 WHERE group_id = $1 AND user_id = $2', [groupId, senderId, messageId]);
    await this.pool.query('UPDATE social.groups SET last_message_at = now() WHERE id = $1', [groupId]);
    const others = (await this.pool.query('SELECT user_id FROM social.group_members WHERE group_id = $1 AND user_id <> $2', [groupId, senderId])).rows.map((r) => r.user_id as string);
    const meta = (await this.pool.query('SELECT g.name, u.display_name FROM social.groups g, identity.users u WHERE g.id = $1 AND u.id = $2', [groupId, senderId])).rows[0];
    // Os outros aparelhos de quem enviou mostram logo a mensagem (eco, sem aviso).
    this.events.echo(senderId, { type: 'message', group: groupId });
    for (const u of others) {
      this.events.emit(u, { type: 'message', group: groupId });
      if (!this.events.isActive(u, `g:${groupId}`)) void this.push.send(u, { title: meta.name as string, body: `${(meta.display_name as string).split(' ')[0]}: ${what}`, url: `/messages/g/${groupId}`, tag: `group:${groupId}`, category: 'messages' });
    }
  }

  /** Mensagem feita pelo servidor em nome de alguém (ex.: a sondagem nova aparece na conversa). */
  async postMessage(groupId: string, senderId: string, kind: 'poll', body: string, pushText: string) {
    const id = uuidv7();
    await this.pool.query('INSERT INTO social.messages (id, group_id, sender_id, body, kind) VALUES ($1, $2, $3, $4, $5)', [id, groupId, senderId, body, kind]);
    await this.fanOut(groupId, senderId, id, pushText);
    return id;
  }
}
