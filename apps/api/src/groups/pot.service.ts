import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { TextFilter } from '../safety/text-filter.service';
import { VenuesService } from '../venues/venues.service';
import { MAX_AMOUNT, WalletService } from '../wallet/wallet.service';
import { GroupAccess } from './group-access';
import { proRata } from './settle';
import { badge } from '../common/badge';

/*
 * Cofre de Txills de um TxillGroup (Txills são a moeda do Txillapp). Cada grupo tem no máximo um cofre:
 * uma conta do ledger kind 'group_pot', criada na primeira contribuição. Todos os movimentos passam pelo
 * WalletService.move (partidas dobradas, chave de idempotência, bloqueio de linhas, saldo nunca negativo).
 *
 * GET   /chat/groups/:id/pot -> Pot = {
 *   balance, goal: number | null, venue: { slug, name, avatarUrl, acceptsTxills } | null,
 *   contributions: [{ username, displayName, amount, at }]          (todas, as mais recentes primeiro, até 100),
 *   totalByMember: [{ username, displayName, amount }]               (o que cada um pôs desde a última devolução; é a base da devolução),
 *   payments: [{ venue: { slug, name }, amount, note, at, by: { username, displayName } }],
 *   + refunds: [{ amount, at, by: { username, displayName } }],
 *   + canManage: boolean                                             (sou admin: posso mudar a meta, pagar e devolver)
 * }
 * PATCH /chat/groups/:id/pot { goal?: int 1..100000000 | null, venueSlug?: string | null } (admins; o local tem de aceitar Txills) -> Pot
 * POST  /chat/groups/:id/pot/contribute { amount: int 10..100000, idempotencyKey } -> Pot (201)   (tipo 'group_contribution')
 * POST  /chat/groups/:id/pot/pay { venueSlug, amount: int 1..100000, note?: <= 120, idempotencyKey } (admins) -> Pot (201)  (tipo 'venue_payment')
 * POST  /chat/groups/:id/pot/refund { idempotencyKey? } (admins) -> Pot (201)  (tipo 'group_refund')
 * A chave de idempotência pode vir no corpo ou no cabeçalho Idempotency-Key. Saldo insuficiente: 422. Local sem Txills: 422.
 *
 * Regras:
 * - Quem sai do grupo não leva os Txills: o que já está no cofre fica no cofre (e continua a contar para a devolução).
 * - Devolução: o saldo todo volta a quem contribuiu desde a última devolução, na proporção do que cada um pôs
 *   (partes inteiras; os Txills que sobram do arredondamento vão para os restos maiores).
 * - Se o grupo desaparecer (sai a última pessoa), o cofre é devolvido automaticamente antes de o grupo ser apagado,
 *   para nenhum Txill ficar preso numa conta sem dono.
 * - Ordem dos bloqueios: cofre, depois carteiras de pessoas (por id), por fim a carteira do local.
 */

@Injectable()
export class PotService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly access: GroupAccess,
    private readonly wallet: WalletService,
    private readonly venues: VenuesService,
    private readonly filter: TextFilter,
  ) {}

  private async groupName(groupId: string) {
    return (await this.pool.query('SELECT name FROM social.groups WHERE id = $1', [groupId])).rows[0]?.name as string;
  }

  async get(me: string, groupId: string) {
    const role = await this.access.needMember(groupId, me);
    const g = (await this.pool.query(
      `SELECT g.pot_goal, a.balance, v.slug, v.name, v.avatar_media_id, v.accepts_txills
         FROM social.groups g
         LEFT JOIN ledger.accounts a ON a.group_id = g.id
         LEFT JOIN content.venues v ON v.id = g.pot_venue_id
        WHERE g.id = $1`,
      [groupId],
    )).rows[0];
    if (!g) throw new NotFoundException('Grupo não encontrado');
    const contributions = (await this.pool.query(
      `SELECT u.username, u.display_name, u.verified, u.verified_tier, (-e.amount)::bigint AS amount, t.created_at
         FROM ledger.transactions t
         JOIN ledger.entries e ON e.transaction_id = t.id AND e.amount < 0
         JOIN ledger.accounts a ON a.id = e.account_id
         JOIN identity.users u ON u.id = a.user_id
        WHERE t.type = 'group_contribution' AND t.metadata->>'groupId' = $1
        ORDER BY t.id DESC LIMIT 100`,
      [groupId],
    )).rows;
    const stakes = (await this.stakes(this.pool, groupId)).filter((s) => s.stake > 0n);
    const people = stakes.length
      ? new Map((await this.pool.query('SELECT id, username, display_name, verified, verified_tier FROM identity.users WHERE id = ANY($1::uuid[])', [stakes.map((s) => s.userId)])).rows.map((r) => [r.id as string, r]))
      : new Map();
    const payments = (await this.pool.query(
      `SELECT t.created_at, t.metadata, (t.metadata->>'amount')::bigint AS amount, v.slug, v.name, u.username, u.display_name
         FROM ledger.transactions t
         JOIN identity.users u ON u.id = t.actor_id
         LEFT JOIN content.venues v ON v.id::text = t.metadata->>'venueId'
        WHERE t.type = 'venue_payment' AND t.metadata->>'groupId' = $1
        ORDER BY t.id DESC LIMIT 100`,
      [groupId],
    )).rows;
    const refunds = (await this.pool.query(
      `SELECT t.created_at, (t.metadata->>'total')::bigint AS amount, u.username, u.display_name
         FROM ledger.transactions t JOIN identity.users u ON u.id = t.actor_id
        WHERE t.type = 'group_refund' AND t.metadata->>'groupId' = $1
        ORDER BY t.id DESC LIMIT 50`,
      [groupId],
    )).rows;
    return {
      balance: Number(g.balance ?? 0),
      goal: g.pot_goal == null ? null : Number(g.pot_goal),
      venue: g.slug ? { slug: g.slug as string, name: g.name as string, avatarUrl: g.avatar_media_id ? `/api/v1/media/${g.avatar_media_id as string}` : null, acceptsTxills: !!g.accepts_txills } : null,
      contributions: contributions.map((r) => ({ username: r.username as string, displayName: r.display_name as string, ...badge(r.verified, r.verified_tier), amount: Number(r.amount), at: r.created_at as string })),
      totalByMember: stakes
        .map((s) => ({ username: people.get(s.userId)?.username as string, displayName: people.get(s.userId)?.display_name as string, ...badge(people.get(s.userId)?.verified, people.get(s.userId)?.verified_tier), amount: Number(s.stake) }))
        .sort((a, b) => b.amount - a.amount || a.username.localeCompare(b.username)),
      payments: payments.map((r) => ({
        venue: { slug: (r.slug as string | null) ?? null, name: (r.name as string | null) ?? String(r.metadata?.venueName ?? 'Local') },
        amount: Number(r.amount),
        note: (r.metadata?.note as string | null) ?? null,
        at: r.created_at as string,
        by: { username: r.username as string, displayName: r.display_name as string },
      })),
      refunds: refunds.map((r) => ({ amount: Number(r.amount), at: r.created_at as string, by: { username: r.username as string, displayName: r.display_name as string } })),
      canManage: role === 'admin',
    };
  }

  /** O que cada pessoa pôs no cofre desde a última devolução (a base da devolução proporcional). */
  private async stakes(q: Pool | PoolClient, groupId: string) {
    const { rows } = await q.query(
      `WITH last AS (SELECT t.id FROM ledger.transactions t WHERE t.type = 'group_refund' AND t.metadata->>'groupId' = $1 ORDER BY t.id DESC LIMIT 1)
       SELECT a.id AS account_id, a.user_id, sum(-e.amount)::bigint AS stake
         FROM ledger.transactions t
         JOIN ledger.entries e ON e.transaction_id = t.id AND e.amount < 0
         JOIN ledger.accounts a ON a.id = e.account_id
        WHERE t.type = 'group_contribution' AND t.metadata->>'groupId' = $1
          AND ((SELECT id FROM last) IS NULL OR t.id > (SELECT id FROM last))
        GROUP BY a.id, a.user_id ORDER BY a.id`,
      [groupId],
    );
    return rows.map((r) => ({ accountId: r.account_id as string, userId: r.user_id as string, stake: BigInt(r.stake) }));
  }

  async update(me: string, groupId: string, b: { goal?: number | null; venueSlug?: string | null }) {
    await this.access.needAdmin(groupId, me, 'Só quem administra o grupo muda o cofre');
    if (b.goal !== undefined) await this.pool.query('UPDATE social.groups SET pot_goal = $2 WHERE id = $1', [groupId, b.goal]);
    if (b.venueSlug !== undefined) {
      const venueId = b.venueSlug === null ? null : (await this.venues.payableVenue(b.venueSlug)).id;
      await this.pool.query('UPDATE social.groups SET pot_venue_id = $2 WHERE id = $1', [groupId, venueId]);
    }
    await this.access.changed(groupId, 'pot');
    return this.get(me, groupId);
  }

  async contribute(me: string, groupId: string, amount: number, key: string) {
    await this.access.needMember(groupId, me);
    if (!Number.isInteger(amount) || amount < 10 || amount > MAX_AMOUNT) throw new UnprocessableEntityException(`Contribui com um número inteiro de Txills entre 10 e ${MAX_AMOUNT}`);
    const mine = await this.wallet.ensureWallet(me);
    const pot = await this.wallet.ensureGroupPot(groupId);
    const r = await this.wallet.move({
      type: 'group_contribution', actorId: me, idempotencyKey: `group_contribution:${groupId}:${key}`,
      lock: [pot, mine], legs: [[mine, -amount], [pot, amount]],
      metadata: { groupId, groupName: await this.groupName(groupId), contributorId: me, amount },
      insufficient: 'Não tens Txills suficientes',
    });
    if (!r.replayed) await this.access.changed(groupId, 'pot');
    return this.get(me, groupId);
  }

  async pay(me: string, groupId: string, b: { venueSlug: string; amount: number; note?: string }, key: string) {
    await this.access.needAdmin(groupId, me, 'Só quem administra o grupo paga com o cofre');
    if (!Number.isInteger(b.amount) || b.amount < 1 || b.amount > MAX_AMOUNT) throw new UnprocessableEntityException(`Montante deve ser inteiro entre 1 e ${MAX_AMOUNT}`);
    const note = b.note?.trim() || null;
    if (note) this.filter.assertClean(note);
    const v = await this.venues.payableVenue(b.venueSlug);
    const pot = await this.wallet.ensureGroupPot(groupId);
    const to = await this.wallet.ensureVenueWallet(v.id);
    const groupName = await this.groupName(groupId);
    const r = await this.wallet.move({
      type: 'venue_payment', actorId: me, idempotencyKey: `pot_payment:${groupId}:${key}`,
      lock: [pot, to], legs: [[pot, -b.amount], [to, b.amount]],
      metadata: { groupId, groupName, venueId: v.id, venueName: v.name, amount: b.amount, note },
      insufficient: 'O cofre não tem Txills suficientes',
    });
    if (!r.replayed) {
      await this.venues.notifyPayment(v.id, me, { venueSlug: v.slug, venueName: v.name, amount: b.amount, note, groupId, groupName });
      await this.access.changed(groupId, 'pot');
    }
    return this.get(me, groupId);
  }

  async refund(me: string, groupId: string, key?: string) {
    await this.access.needAdmin(groupId, me, 'Só quem administra o grupo devolve o cofre');
    const r = await this.refundAll(me, groupId, key ?? uuidv7());
    if (!r) throw new UnprocessableEntityException('O cofre está vazio');
    return this.get(me, groupId);
  }

  /**
   * Devolve o saldo todo do cofre a quem contribuiu, na proporção do que cada um pôs desde a última devolução.
   * Devolve null se o cofre não existe ou está vazio. Também usado quando o grupo desaparece.
   */
  async refundAll(actorId: string, groupId: string, key: string) {
    const acc = (await this.pool.query('SELECT id, balance FROM ledger.accounts WHERE group_id = $1', [groupId])).rows[0];
    if (!acc) return null;
    const pot = acc.id as string;
    const dup = (await this.pool.query('SELECT id FROM ledger.transactions WHERE actor_id = $1 AND idempotency_key = $2', [actorId, `group_refund:${groupId}:${key}`])).rows[0];
    if (!dup && Number(acc.balance) <= 0) return null;
    // A metadata só é escrita depois de calcular as partes: o total entra nela aqui.
    const metadata: Record<string, unknown> = { groupId, groupName: await this.groupName(groupId) };
    try {
      const r = await this.wallet.move({
        type: 'group_refund', actorId, idempotencyKey: `group_refund:${groupId}:${key}`,
        lock: [pot],
        // Corre com o cofre já bloqueado: o saldo e as contribuições não mudam até ao fim.
        legs: async (c) => {
          const balance = BigInt((await c.query('SELECT balance FROM ledger.accounts WHERE id = $1', [pot])).rows[0].balance);
          if (balance <= 0n) throw new UnprocessableEntityException('O cofre está vazio');
          const stakes = await this.stakes(c, groupId);
          const parts = proRata(balance, stakes.map((s) => [s.accountId, s.stake])).filter(([, v]) => v > 0n);
          if (!parts.length) throw new BadRequestException('Não há contribuições para devolver');
          // Carteiras das pessoas bloqueadas por id, depois do cofre (ordem fixa, sem deadlocks).
          await c.query('SELECT 1 FROM ledger.accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [parts.map(([k]) => k)]);
          metadata.total = Number(balance);
          metadata.refunds = Object.fromEntries(parts.map(([k, v]) => [k, Number(v)]));
          return [[pot, -Number(balance)], ...parts.map(([k, v]) => [k, Number(v)] as [string, number])];
        },
        metadata,
      });
      await this.access.changed(groupId, 'pot');
      return r;
    } catch (e) {
      if (e instanceof UnprocessableEntityException && /vazio/.test(e.message)) return null;
      throw e;
    }
  }
}
