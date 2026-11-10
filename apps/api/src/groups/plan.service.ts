import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { MediaService } from '../media/media.service';
import { TextFilter } from '../safety/text-filter.service';
import { GroupAccess, pendingVisibleTo } from './group-access';
import { PotService } from './pot.service';
import { mzn, settle, splitCents, toCents } from './settle';

/*
 * TxillGroups: o plano de cada grupo (um por grupo). Os administradores mudam o destino, o local e as datas;
 * todos os membros respondem (vou / talvez / não vou), votam, tratam da lista e registam despesas.
 * Formatos devolvidos (acrescentos ao contrato marcados com "+"):
 *
 * GET /chat/groups/:id/plan -> {
 *   destination: string | null, venue: { slug, name, avatarUrl } | null, startsOn: 'AAAA-MM-DD' | null, endsOn: 'AAAA-MM-DD' | null,
 *   rsvps: [{ username, displayName, hasAvatar, status: 'going' | 'maybe' | 'not_going' }]   (só quem respondeu e ainda é membro),
 *   polls: [Poll]   (as 50 mais recentes),
 *   checklist: [{ id, text, done, assignee: { username, displayName, hasAvatar } | null, createdBy: username | null, at }],
 *   expenses: { items: [Expense], balances: [{ username, displayName, net }], settlements: [{ from, to, amount }], + total },
 *   pot: Pot   (o mesmo de GET /chat/groups/:id/pot)
 * }
 * Poll = { id, question, multiple, closed, + closesAt, options: [{ id, text, votes, voters: [username] }], myVotes: [optionId], createdBy: username | null, + at }
 * Expense = { id, description, amountMzn, paidBy: { username, displayName }, splitAmong: [username], createdBy: username | null, at, + canDelete }
 *
 * Dinheiro das despesas: tudo em METICAIS com até 2 casas decimais (ex.: 1250.5). Na base de dados fica em cêntimos inteiros.
 * `net` > 0: a pessoa tem a receber; < 0: tem a pagar. `settlements`: quem paga a quem (algoritmo guloso, poucas transferências).
 * As despesas não mexem em Txills: são só contas.
 *
 * Escritas:
 * PATCH /chat/groups/:id/plan { destination?: string <= 80 | null, venueSlug?: string | null, startsOn?: 'AAAA-MM-DD' | null, endsOn?: ... | null } (admins) -> plano
 * PUT   /chat/groups/:id/plan/rsvp { status } -> plano
 * POST  /chat/groups/:id/polls { question <= 140, options: 2..6 textos <= 60 (sem repetidos), multiple?, closesAt?: ISO (futuro, até 90 dias) } -> Poll (201)
 *       Cria também uma mensagem kind 'poll' na conversa, com body = id da sondagem; na conversa (GET /chat/groups/:id) essa mensagem traz `poll: Poll | null`.
 * POST  /chat/groups/:id/polls/:pollId/vote { optionIds: [] } (substitui o meu voto; [] tira o voto; sondagem fechada: 403) -> Poll
 * POST  /chat/groups/:id/polls/:pollId/close (quem criou ou admin) -> Poll
 * POST  /chat/groups/:id/checklist { text <= 120, assignee?: username } -> item (201)
 * PATCH /chat/groups/:id/checklist/:itemId { done?, text?, assignee?: username | null } (qualquer membro) -> item
 * DELETE /chat/groups/:id/checklist/:itemId (quem criou ou admin) -> 204
 * POST  /chat/groups/:id/expenses { description <= 120, amountMzn: número > 0 com até 2 casas, paidBy?: username (eu), splitAmong?: [username] (todos) } -> expenses (201)
 * DELETE /chat/groups/:id/expenses/:expenseId (quem registou ou admin) -> expenses
 * GET   /chat/groups/:id/album?cursor=<id> -> { items: [{ id, kind: 'image' | 'video', mediaUrl, durationMs, at, sender: { username, displayName, hasAvatar } }], nextCursor }
 *       (fotos e vídeos da conversa, os mais recentes primeiro, sem os de visualização única).
 *
 * Cada mudança emite no tempo real { type: 'group', groupId, what: 'plan' | 'poll' | 'checklist' | 'expense' | 'pot' } a todos os membros.
 */

const MAX_CHECKLIST = 200;
const MAX_EXPENSES = 500;
const ALBUM_PAGE = 30;

export type Rsvp = 'going' | 'maybe' | 'not_going';
type PersonRow = { username: string; displayName: string; hasAvatar: boolean };

export interface PlanPatch {
  destination?: string | null;
  venueSlug?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
}

/** 'AAAA-MM-DD' que existe no calendário. */
export function validDay(s: string) {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

@Injectable()
export class PlanService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly access: GroupAccess,
    private readonly filter: TextFilter,
    private readonly media: MediaService,
    private readonly pot: PotService,
  ) {}

  private venueDto(r: { slug?: string | null; name?: string | null; avatar_media_id?: string | null } | null) {
    return r?.slug ? { slug: r.slug, name: r.name as string, avatarUrl: r.avatar_media_id ? `/api/v1/media/${r.avatar_media_id}` : null } : null;
  }

  /**
   * Resumo de vários grupos de uma vez (para a lista de conversas e o topo da conversa):
   * tipo, descrição, capa, quem criou, o plano em poucas linhas e o cofre.
   */
  async summaries(me: string, ids: string[]) {
    const out = new Map<string, ReturnType<PlanService['summaryDto']>>();
    if (!ids.length) return out;
    const { rows } = await this.pool.query(
      `SELECT g.id, g.kind, g.description, g.cover_media_id, g.avatar_media_id, g.visibility, g.show_on_map, cu.username AS created_by,
              CASE WHEN EXISTS (SELECT 1 FROM social.group_members am WHERE am.group_id = g.id AND am.user_id = $1 AND am.role = 'admin')
                   THEN (SELECT count(*) FROM social.group_join_requests jr WHERE jr.group_id = g.id AND ${pendingVisibleTo('jr', '$1')})::int ELSE 0 END AS pending_requests,
              g.destination, g.starts_on::text AS starts_on, g.ends_on::text AS ends_on, g.pot_goal,
              (SELECT count(*) FROM social.group_rsvps r JOIN social.group_members m ON m.group_id = r.group_id AND m.user_id = r.user_id WHERE r.group_id = g.id AND r.status = 'going')::int AS going,
              (SELECT count(*) FROM social.group_rsvps r JOIN social.group_members m ON m.group_id = r.group_id AND m.user_id = r.user_id WHERE r.group_id = g.id AND r.status = 'maybe')::int AS maybe,
              (SELECT count(*) FROM social.group_rsvps r JOIN social.group_members m ON m.group_id = r.group_id AND m.user_id = r.user_id WHERE r.group_id = g.id AND r.status = 'not_going')::int AS not_going,
              (SELECT r.status FROM social.group_rsvps r WHERE r.group_id = g.id AND r.user_id = $1) AS my_rsvp,
              (SELECT a.balance FROM ledger.accounts a WHERE a.group_id = g.id) AS pot_balance,
              pv.slug AS pv_slug, pv.name AS pv_name, pv.avatar_media_id AS pv_avatar, pv.accepts_txills AS pv_accepts
         FROM social.groups g
         LEFT JOIN identity.users cu ON cu.id = g.created_by
         LEFT JOIN content.venues pv ON pv.id = g.pot_venue_id
        WHERE g.id = ANY($2::uuid[])`,
      [me, ids],
    );
    for (const r of rows) out.set(r.id as string, this.summaryDto(r));
    return out;
  }

  private summaryDto(r: Record<string, any>) {
    return {
      kind: r.kind as 'viagem' | 'festa' | 'fim_de_semana' | 'outro',
      description: (r.description as string | null) ?? null,
      coverUrl: r.cover_media_id ? `/api/v1/media/${r.cover_media_id as string}` : null,
      avatarUrl: r.avatar_media_id ? `/api/v1/media/${r.avatar_media_id as string}` : null,
      visibility: r.visibility as 'private' | 'public',
      // Público está sempre no mapa, seja qual for o valor guardado.
      showOnMap: r.visibility === 'public' || !!r.show_on_map,
      // Pedidos para entrar à espera (só para os admins; 0 para os outros).
      pendingRequests: Number(r.pending_requests ?? 0),
      createdBy: (r.created_by as string | null) ?? null,
      plan: {
        destination: (r.destination as string | null) ?? null,
        startsOn: (r.starts_on as string | null) ?? null,
        endsOn: (r.ends_on as string | null) ?? null,
        going: r.going as number,
        maybe: r.maybe as number,
        notGoing: r.not_going as number,
        myRsvp: (r.my_rsvp as Rsvp | null) ?? null,
      },
      pot: {
        balance: Number(r.pot_balance ?? 0),
        goal: r.pot_goal == null ? null : Number(r.pot_goal),
        venue: r.pv_slug ? { slug: r.pv_slug as string, name: r.pv_name as string, avatarUrl: r.pv_avatar ? `/api/v1/media/${r.pv_avatar as string}` : null, acceptsTxills: !!r.pv_accepts } : null,
      },
    };
  }

  /* ───────────── o plano ───────────── */

  async get(me: string, groupId: string) {
    const role = await this.access.needMember(groupId, me);
    const g = (await this.pool.query(
      `SELECT g.destination, g.starts_on::text AS starts_on, g.ends_on::text AS ends_on, v.slug, v.name, v.avatar_media_id
         FROM social.groups g LEFT JOIN content.venues v ON v.id = g.plan_venue_id WHERE g.id = $1`,
      [groupId],
    )).rows[0];
    const rsvps = (await this.pool.query(
      `SELECT u.username, u.display_name AS "displayName", (u.avatar_media_id IS NOT NULL) AS "hasAvatar", r.status
         FROM social.group_rsvps r
         JOIN social.group_members m ON m.group_id = r.group_id AND m.user_id = r.user_id
         JOIN identity.users u ON u.id = r.user_id
        WHERE r.group_id = $1 ORDER BY r.updated_at`,
      [groupId],
    )).rows as (PersonRow & { status: Rsvp })[];
    const [polls, checklist, expenses, pot] = await Promise.all([this.polls(me, groupId), this.checklist(groupId), this.expenses(me, groupId, role), this.pot.get(me, groupId)]);
    return {
      destination: (g.destination as string | null) ?? null,
      venue: this.venueDto(g),
      startsOn: (g.starts_on as string | null) ?? null,
      endsOn: (g.ends_on as string | null) ?? null,
      rsvps,
      polls,
      checklist,
      expenses,
      pot,
    };
  }

  async update(me: string, groupId: string, b: PlanPatch) {
    await this.access.needAdmin(groupId, me, 'Só quem administra o grupo muda o plano');
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (b.destination !== undefined) {
      const d = b.destination?.trim() || null;
      if (d) this.filter.assertClean(d);
      set('destination', d);
    }
    if (b.venueSlug !== undefined) {
      if (b.venueSlug === null) set('plan_venue_id', null);
      else {
        const v = (await this.pool.query('SELECT id FROM content.venues WHERE slug = $1', [b.venueSlug.toLowerCase()])).rows[0];
        if (!v) throw new NotFoundException('Local não encontrado');
        set('plan_venue_id', v.id);
      }
    }
    for (const [k, col] of [['startsOn', 'starts_on'], ['endsOn', 'ends_on']] as const) {
      const d = b[k];
      if (d === undefined) continue;
      if (d !== null && !validDay(d)) throw new BadRequestException('Data inválida (AAAA-MM-DD)');
      set(col, d);
    }
    if (sets.length) {
      vals.push(groupId);
      try {
        await this.pool.query(`UPDATE social.groups SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
      } catch (e) {
        if ((e as { code?: string }).code === '23514') throw new BadRequestException('O fim não pode ser antes do início');
        throw e;
      }
      await this.access.changed(groupId, 'plan');
    }
    return this.get(me, groupId);
  }

  async rsvp(me: string, groupId: string, status: Rsvp) {
    await this.access.needMember(groupId, me);
    await this.pool.query(
      `INSERT INTO social.group_rsvps (group_id, user_id, status) VALUES ($1, $2, $3)
       ON CONFLICT (group_id, user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
      [groupId, me, status],
    );
    await this.access.changed(groupId, 'plan');
    return this.get(me, groupId);
  }

  /* ───────────── sondagens ───────────── */

  /** Sondagens do grupo (as 50 mais recentes) ou só as pedidas (`ids`). */
  async polls(me: string, groupId: string, ids?: string[]) {
    if (ids && !ids.length) return [];
    const ps = (await this.pool.query(
      `SELECT p.id, p.question, p.multiple, p.closes_at, p.created_at, cu.username AS created_by,
              (p.closed_at IS NOT NULL OR (p.closes_at IS NOT NULL AND p.closes_at <= now())) AS closed
         FROM social.group_polls p LEFT JOIN identity.users cu ON cu.id = p.created_by
        WHERE p.group_id = $1 AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))
        ORDER BY p.id DESC LIMIT 50`,
      [groupId, ids ?? null],
    )).rows;
    if (!ps.length) return [];
    const opts = (await this.pool.query(
      `SELECT o.id, o.poll_id, o.text,
              coalesce(array_agg(u.username::text ORDER BY v.created_at) FILTER (WHERE u.username IS NOT NULL), '{}') AS voters,
              coalesce(bool_or(v.user_id = $2), false) AS mine
         FROM social.group_poll_options o
         LEFT JOIN social.group_poll_votes v ON v.option_id = o.id
         LEFT JOIN identity.users u ON u.id = v.user_id
        WHERE o.poll_id = ANY($1::uuid[])
        GROUP BY o.id ORDER BY o.poll_id, o.position`,
      [ps.map((p) => p.id), me],
    )).rows;
    return ps.map((p) => {
      const mine = opts.filter((o) => o.poll_id === p.id);
      return {
        id: p.id as string,
        question: p.question as string,
        multiple: !!p.multiple,
        closed: !!p.closed,
        closesAt: (p.closes_at as string | null) ?? null,
        options: mine.map((o) => ({ id: o.id as string, text: o.text as string, votes: (o.voters as string[]).length, voters: o.voters as string[] })),
        myVotes: mine.filter((o) => o.mine).map((o) => o.id as string),
        createdBy: (p.created_by as string | null) ?? null,
        at: p.created_at as string,
      };
    });
  }

  private async poll(me: string, groupId: string, pollId: string) {
    const p = (await this.polls(me, groupId, [pollId]))[0];
    if (!p) throw new NotFoundException('Sondagem não encontrada');
    return p;
  }

  async createPoll(me: string, groupId: string, b: { question: string; options: string[]; multiple?: boolean; closesAt?: string }) {
    await this.access.needMember(groupId, me);
    const question = b.question.trim();
    const options = b.options.map((o) => o.trim());
    this.filter.assertClean(question, ...options);
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new BadRequestException('As opções não se podem repetir');
    let closesAt: Date | null = null;
    if (b.closesAt) {
      closesAt = new Date(b.closesAt);
      const ms = closesAt.getTime() - Date.now();
      if (Number.isNaN(ms) || ms <= 0) throw new BadRequestException('A sondagem tem de fechar no futuro');
      if (ms > 90 * 86_400_000) throw new BadRequestException('A sondagem fecha no máximo daqui a 90 dias');
    }
    const id = uuidv7();
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('INSERT INTO social.group_polls (id, group_id, question, multiple, closes_at, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [id, groupId, question, !!b.multiple, closesAt, me]);
      for (const [i, text] of options.entries()) await c.query('INSERT INTO social.group_poll_options (id, poll_id, position, text) VALUES ($1, $2, $3, $4)', [uuidv7(), id, i, text]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    // A sondagem aparece na conversa (body = id da sondagem).
    await this.access.postMessage(groupId, me, 'poll', id, 'criou uma sondagem');
    await this.access.changed(groupId, 'poll');
    return this.poll(me, groupId, id);
  }

  async vote(me: string, groupId: string, pollId: string, optionIds: string[]) {
    await this.access.needMember(groupId, me);
    this.access.assertId(pollId, 'Sondagem');
    const p = (await this.pool.query(
      'SELECT multiple, (closed_at IS NOT NULL OR (closes_at IS NOT NULL AND closes_at <= now())) AS closed FROM social.group_polls WHERE id = $1 AND group_id = $2',
      [pollId, groupId],
    )).rows[0];
    if (!p) throw new NotFoundException('Sondagem não encontrada');
    if (p.closed) throw new ForbiddenException('Esta sondagem já fechou');
    const chosen = [...new Set(optionIds)];
    if (!p.multiple && chosen.length > 1) throw new BadRequestException('Nesta sondagem só se escolhe uma opção');
    if (chosen.length) {
      const ok = (await this.pool.query('SELECT count(*)::int AS n FROM social.group_poll_options WHERE poll_id = $1 AND id = ANY($2::uuid[])', [pollId, chosen])).rows[0].n as number;
      if (ok !== chosen.length) throw new BadRequestException('Opção inválida');
    }
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM social.group_poll_votes WHERE poll_id = $1 AND user_id = $2', [pollId, me]);
      for (const o of chosen) await c.query('INSERT INTO social.group_poll_votes (poll_id, option_id, user_id) VALUES ($1, $2, $3)', [pollId, o, me]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    await this.access.changed(groupId, 'poll');
    return this.poll(me, groupId, pollId);
  }

  async closePoll(me: string, groupId: string, pollId: string) {
    const role = await this.access.needMember(groupId, me);
    this.access.assertId(pollId, 'Sondagem');
    const p = (await this.pool.query('SELECT created_by FROM social.group_polls WHERE id = $1 AND group_id = $2', [pollId, groupId])).rows[0];
    if (!p) throw new NotFoundException('Sondagem não encontrada');
    if (p.created_by !== me && role !== 'admin') throw new ForbiddenException('Só quem criou a sondagem ou quem administra a fecha');
    await this.pool.query('UPDATE social.group_polls SET closed_at = now() WHERE id = $1 AND closed_at IS NULL', [pollId]);
    await this.access.changed(groupId, 'poll');
    return this.poll(me, groupId, pollId);
  }

  /* ───────────── lista ───────────── */

  private readonly ITEM = `
    SELECT i.id, i.text, i.done, i.created_at, cu.username AS created_by,
           au.username AS a_username, au.display_name AS a_name, (au.avatar_media_id IS NOT NULL) AS a_avatar
      FROM social.group_checklist i
      LEFT JOIN identity.users cu ON cu.id = i.created_by
      LEFT JOIN identity.users au ON au.id = i.assignee_id`;

  private itemDto(r: Record<string, any>) {
    return {
      id: r.id as string,
      text: r.text as string,
      done: !!r.done,
      assignee: r.a_username ? { username: r.a_username as string, displayName: r.a_name as string, hasAvatar: !!r.a_avatar } : null,
      createdBy: (r.created_by as string | null) ?? null,
      at: r.created_at as string,
    };
  }

  async checklist(groupId: string) {
    return (await this.pool.query(`${this.ITEM} WHERE i.group_id = $1 ORDER BY i.id`, [groupId])).rows.map((r) => this.itemDto(r));
  }

  private async item(groupId: string, itemId: string) {
    const r = (await this.pool.query(`${this.ITEM} WHERE i.group_id = $1 AND i.id = $2`, [groupId, itemId])).rows[0];
    if (!r) throw new NotFoundException('Item não encontrado');
    return this.itemDto(r);
  }

  private async assigneeId(groupId: string, username: string | null | undefined) {
    if (!username) return null;
    const m = await this.access.membersByUsername(groupId, [username]);
    return [...m.values()][0];
  }

  async addItem(me: string, groupId: string, b: { text: string; assignee?: string }) {
    await this.access.needMember(groupId, me);
    const text = b.text.trim();
    this.filter.assertClean(text);
    const n = (await this.pool.query('SELECT count(*)::int AS n FROM social.group_checklist WHERE group_id = $1', [groupId])).rows[0].n as number;
    if (n >= MAX_CHECKLIST) throw new BadRequestException(`A lista tem no máximo ${MAX_CHECKLIST} itens`);
    const id = uuidv7();
    await this.pool.query('INSERT INTO social.group_checklist (id, group_id, text, assignee_id, created_by) VALUES ($1, $2, $3, $4, $5)', [id, groupId, text, await this.assigneeId(groupId, b.assignee), me]);
    await this.access.changed(groupId, 'checklist');
    return this.item(groupId, id);
  }

  async patchItem(me: string, groupId: string, itemId: string, b: { done?: boolean; text?: string; assignee?: string | null }) {
    await this.access.needMember(groupId, me);
    this.access.assertId(itemId, 'Item');
    await this.item(groupId, itemId);
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (b.done !== undefined) set('done', b.done);
    if (b.text !== undefined) { this.filter.assertClean(b.text.trim()); set('text', b.text.trim()); }
    if (b.assignee !== undefined) set('assignee_id', await this.assigneeId(groupId, b.assignee));
    if (sets.length) {
      vals.push(itemId);
      await this.pool.query(`UPDATE social.group_checklist SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
      await this.access.changed(groupId, 'checklist');
    }
    return this.item(groupId, itemId);
  }

  async deleteItem(me: string, groupId: string, itemId: string) {
    const role = await this.access.needMember(groupId, me);
    this.access.assertId(itemId, 'Item');
    const r = (await this.pool.query('SELECT created_by FROM social.group_checklist WHERE id = $1 AND group_id = $2', [itemId, groupId])).rows[0];
    if (!r) throw new NotFoundException('Item não encontrado');
    if (r.created_by !== me && role !== 'admin') throw new ForbiddenException('Só quem criou o item ou quem administra o apaga');
    await this.pool.query('DELETE FROM social.group_checklist WHERE id = $1', [itemId]);
    await this.access.changed(groupId, 'checklist');
  }

  /* ───────────── despesas (contas em meticais, sem mexer em Txills) ───────────── */

  async expenses(me: string, groupId: string, role?: 'admin' | 'member') {
    const myRole = role ?? (await this.access.needMember(groupId, me));
    const items = (await this.pool.query(
      `SELECT e.id, e.description, e.amount_cents, e.created_at, e.created_by, pu.username AS paid_username, pu.display_name AS paid_name, cu.username AS created_username,
              (SELECT coalesce(array_agg(u.username::text ORDER BY u.username), '{}') FROM social.group_expense_shares s JOIN identity.users u ON u.id = s.user_id WHERE s.expense_id = e.id) AS split
         FROM social.group_expenses e
         JOIN identity.users pu ON pu.id = e.paid_by
         LEFT JOIN identity.users cu ON cu.id = e.created_by
        WHERE e.group_id = $1 ORDER BY e.id DESC LIMIT ${MAX_EXPENSES}`,
      [groupId],
    )).rows;
    const nets = (await this.pool.query(
      `SELECT u.username, u.display_name, sum(x.v)::bigint AS net FROM (
           SELECT paid_by AS uid, amount_cents AS v FROM social.group_expenses WHERE group_id = $1
           UNION ALL
           SELECT s.user_id, -s.share_cents FROM social.group_expense_shares s JOIN social.group_expenses e ON e.id = s.expense_id WHERE e.group_id = $1
         ) x JOIN identity.users u ON u.id = x.uid GROUP BY u.username, u.display_name`,
      [groupId],
    )).rows;
    const members = (await this.pool.query(
      'SELECT u.username, u.display_name FROM social.group_members m JOIN identity.users u ON u.id = m.user_id WHERE m.group_id = $1 ORDER BY m.joined_at',
      [groupId],
    )).rows;
    // Todos os membros aparecem (mesmo a zero); quem saiu só aparece se ainda tem contas por acertar.
    const people = new Map<string, { username: string; displayName: string; cents: number }>();
    for (const m of members) people.set(m.username as string, { username: m.username as string, displayName: m.display_name as string, cents: 0 });
    for (const n of nets) {
      const cents = Number(n.net);
      const p = people.get(n.username as string);
      if (p) p.cents = cents;
      else if (cents !== 0) people.set(n.username as string, { username: n.username as string, displayName: n.display_name as string, cents });
    }
    const settlements = settle(new Map([...people.values()].map((p) => [p.username, p.cents])));
    return {
      items: items.map((r) => ({
        id: r.id as string,
        description: r.description as string,
        amountMzn: mzn(Number(r.amount_cents)),
        paidBy: { username: r.paid_username as string, displayName: r.paid_name as string },
        splitAmong: r.split as string[],
        createdBy: (r.created_username as string | null) ?? null,
        at: r.created_at as string,
        canDelete: r.created_by === me || myRole === 'admin',
      })),
      total: mzn(items.reduce((s, r) => s + Number(r.amount_cents), 0)),
      balances: [...people.values()].map((p) => ({ username: p.username, displayName: p.displayName, net: mzn(p.cents) })),
      settlements: settlements.map((s) => ({ from: s.from, to: s.to, amount: mzn(s.cents) })),
    };
  }

  async addExpense(me: string, groupId: string, b: { description: string; amountMzn: number; paidBy?: string; splitAmong?: string[] }) {
    const role = await this.access.needMember(groupId, me);
    const description = b.description.trim();
    this.filter.assertClean(description);
    const cents = toCents(b.amountMzn);
    if (cents === null || cents < 1) throw new BadRequestException('Valor inválido (meticais, até 2 casas decimais)');
    const n = (await this.pool.query('SELECT count(*)::int AS n FROM social.group_expenses WHERE group_id = $1', [groupId])).rows[0].n as number;
    if (n >= MAX_EXPENSES) throw new BadRequestException(`O grupo tem no máximo ${MAX_EXPENSES} despesas`);
    const payer = b.paidBy ? [...(await this.access.membersByUsername(groupId, [b.paidBy])).values()][0] : me;
    let among: string[];
    if (b.splitAmong?.length) {
      const names = [...new Set(b.splitAmong.map((x) => x.trim().replace(/^@/, '').toLowerCase()))];
      const map = await this.access.membersByUsername(groupId, names);
      among = names.map((x) => map.get(x)!);
    } else {
      among = (await this.pool.query('SELECT user_id FROM social.group_members WHERE group_id = $1 ORDER BY joined_at', [groupId])).rows.map((r) => r.user_id as string);
    }
    const shares = splitCents(cents, among.length);
    const id = uuidv7();
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('INSERT INTO social.group_expenses (id, group_id, description, amount_cents, paid_by, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [id, groupId, description, cents, payer, me]);
      for (const [i, u] of among.entries()) await c.query('INSERT INTO social.group_expense_shares (expense_id, user_id, share_cents) VALUES ($1, $2, $3)', [id, u, shares[i]]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    await this.access.changed(groupId, 'expense');
    return this.expenses(me, groupId, role);
  }

  async deleteExpense(me: string, groupId: string, expenseId: string) {
    const role = await this.access.needMember(groupId, me);
    this.access.assertId(expenseId, 'Despesa');
    const r = (await this.pool.query('SELECT created_by FROM social.group_expenses WHERE id = $1 AND group_id = $2', [expenseId, groupId])).rows[0];
    if (!r) throw new NotFoundException('Despesa não encontrada');
    if (r.created_by !== me && role !== 'admin') throw new ForbiddenException('Só quem registou a despesa ou quem administra a apaga');
    await this.pool.query('DELETE FROM social.group_expenses WHERE id = $1', [expenseId]);
    await this.access.changed(groupId, 'expense');
    return this.expenses(me, groupId, role);
  }

  /* ───────────── álbum ───────────── */

  /** As fotos e os vídeos da conversa do grupo (as memórias da viagem), os mais recentes primeiro. */
  async album(me: string, groupId: string, cursor?: string) {
    await this.access.needMember(groupId, me);
    if (cursor) this.access.assertId(cursor, 'cursor');
    const { rows } = await this.pool.query(
      `SELECT m.id, m.kind, m.media_id, m.duration_ms, m.created_at, u.username, u.display_name, (u.avatar_media_id IS NOT NULL) AS has_avatar
         FROM social.messages m LEFT JOIN identity.users u ON u.id = m.sender_id
        WHERE m.group_id = $1 AND m.kind IN ('image', 'video') AND m.media_id IS NOT NULL AND NOT m.view_once AND m.deleted_at IS NULL
          AND ($2::uuid IS NULL OR m.id < $2)
        ORDER BY m.id DESC LIMIT $3`,
      [groupId, cursor ?? null, ALBUM_PAGE + 1],
    );
    const page = rows.slice(0, ALBUM_PAGE);
    return {
      items: page.map((r) => ({
        id: r.id as string,
        kind: r.kind as 'image' | 'video',
        mediaUrl: this.media.chatUrl(r.media_id as string),
        durationMs: (r.duration_ms as number | null) ?? null,
        at: r.created_at as string,
        sender: r.username ? { username: r.username as string, displayName: r.display_name as string, hasAvatar: !!r.has_avatar } : { username: '', displayName: 'Ex-membro', hasAvatar: false },
      })),
      nextCursor: rows.length > ALBUM_PAGE ? (page[page.length - 1].id as string) : null,
    };
  }
}
