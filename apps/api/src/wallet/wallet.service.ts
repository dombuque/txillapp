import { HttpException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { badge, type Badge } from '../common/badge';

export const ISSUANCE_ACCOUNT = '00000000-0000-7000-8000-000000000001';
export const WELCOME_BONUS = 500;
export const MAX_AMOUNT = 100_000;

export interface TransferParams {
  actorId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  type: 'transfer' | 'gift';
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface TransferResult {
  transactionId: string;
  replayed: boolean;
}

/** Tipos de movimento do ledger (iguais ao CHECK de ledger.transactions). */
export type LedgerType = 'welcome_bonus' | 'transfer' | 'gift' | 'topup' | 'invite' | 'group_contribution' | 'venue_payment' | 'group_refund' | 'boost' | 'boost_refund';

/**
 * Movimento entre contas quaisquer (carteiras, cofres de grupo, carteiras de locais).
 * `lock`: as contas a bloquear, pela ordem dada. Para não haver deadlocks, a ordem é sempre
 * cofre do grupo, depois carteiras de pessoas (por id), por fim a carteira do local; ninguém bloqueia um cofre depois de uma carteira.
 * `legs` pode ser uma função: corre depois dos bloqueios (por exemplo, a devolução do cofre lê o saldo já bloqueado).
 */
export interface MoveParams {
  type: LedgerType;
  actorId: string;
  idempotencyKey: string;
  lock: string[];
  legs: [string, number][] | ((c: PoolClient) => Promise<[string, number][]>);
  metadata: Record<string, unknown>;
  /** Mensagem quando uma conta ficaria negativa. */
  insufficient?: string;
}

/** O texto de cada movimento no histórico da carteira, do lado de quem o vê. */
export function historyLabel(type: LedgerType, amount: number, x: { who: string | null; venue: string | null; group: string | null }): string {
  const out = amount < 0;
  switch (type) {
    case 'welcome_bonus': return 'Bónus de boas-vindas';
    case 'topup': return 'Carregamento de Txills';
    case 'invite': return 'Prémio por convite';
    case 'gift': return out ? `Presente para ${x.who ?? 'alguém'}` : `Presente de ${x.who ?? 'alguém'}`;
    case 'transfer': return out ? `Enviaste a ${x.who ?? 'alguém'}` : `Recebeste de ${x.who ?? 'alguém'}`;
    case 'group_contribution': return `Puseste no cofre de ${x.group ?? 'um grupo'}`;
    case 'group_refund': return `Devolução do cofre de ${x.group ?? 'um grupo'}`;
    case 'boost': return `Bombar ${x.venue ?? 'o local'}`;
    case 'boost_refund': return `Devolução do Bombar de ${x.venue ?? 'um local'}`;
    case 'venue_payment':
      if (!out) return x.who ? `Pagamento de ${x.who}` : `Pagamento do cofre de ${x.group ?? 'um grupo'}`;
      return x.group ? `Pago em ${x.venue ?? 'um local'} com o cofre de ${x.group}` : `Pagaste em ${x.venue ?? 'um local'}`;
    default: return 'Movimento';
  }
}

/**
 * Campos extra no histórico para os movimentos novos:
 * - `venue?: { slug, name, kind }` nos venue_payment (slug e kind a null se o local já não existir);
 * - `group?: { id, name }` em group_contribution, group_refund e venue_payment pago com o cofre de um grupo;
 * - `from?: { username, displayName }` do lado do local (entrada positiva de venue_payment feito por uma pessoa).
 */
function historyExtras(r: Record<string, any>) {
  const m = (r.metadata ?? {}) as Record<string, unknown>;
  const out: { venue?: { slug: string | null; name: string; kind: string | null }; group?: { id: string; name: string }; from?: { username: string; displayName: string } & Badge } = {};
  if (r.type === 'venue_payment') {
    out.venue = r.venue_slug ? { slug: r.venue_slug as string, name: r.venue_name as string, kind: r.venue_kind as string } : { slug: null, name: String(m.venueName ?? 'Local'), kind: null };
    if (Number(r.amount) > 0 && r.payer_username) out.from = { username: r.payer_username as string, displayName: r.payer_name as string, ...badge(r.payer_verified, r.payer_tier) };
  }
  if (['group_contribution', 'group_refund', 'venue_payment'].includes(r.type as string) && m.groupId) {
    out.group = { id: String(m.groupId), name: (r.group_name as string | null) ?? String(m.groupName ?? 'Grupo') };
  }
  return out;
}

@Injectable()
export class WalletService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Abre a carteira (idempotente) e credita o bónus de boas-vindas em Txills FICTÍCIOS. */
  async ensureWallet(userId: string): Promise<string> {
    const existing = await this.pool.query('SELECT id FROM ledger.accounts WHERE user_id = $1', [userId]);
    if (existing.rows[0]) return existing.rows[0].id;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const id = uuidv7();
      const ins = await client.query(
        `INSERT INTO ledger.accounts (id, user_id, kind) VALUES ($1, $2, 'user_wallet')
         ON CONFLICT (user_id) DO NOTHING RETURNING id`,
        [id, userId],
      );
      if (ins.rowCount) {
        await this.post(client, {
          type: 'welcome_bonus', actorId: userId, key: 'welcome_bonus',
          legs: [[ISSUANCE_ACCOUNT, -WELCOME_BONUS], [id, WELCOME_BONUS]],
          metadata: { demo: true },
        });
      }
      await client.query('COMMIT');
      return (await this.pool.query('SELECT id FROM ledger.accounts WHERE user_id = $1', [userId])).rows[0].id;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getWallet(userId: string) {
    await this.ensureWallet(userId);
    const acc = (await this.pool.query('SELECT id, balance FROM ledger.accounts WHERE user_id = $1', [userId])).rows[0];
    const { rows } = await this.pool.query(
      `SELECT e.id, e.amount, e.created_at, t.type, t.metadata,
              cp.username AS counterparty_username, cp.display_name AS counterparty_name, cp.verified AS counterparty_verified, cp.verified_tier AS counterparty_tier,
              v.slug AS venue_slug, v.name AS venue_name, v.kind AS venue_kind, g.id AS group_id, g.name AS group_name,
              pu.username AS payer_username, pu.display_name AS payer_name, pu.verified AS payer_verified, pu.verified_tier AS payer_tier
         FROM ledger.entries e
         JOIN ledger.transactions t ON t.id = e.transaction_id
         LEFT JOIN LATERAL (
           SELECT u.username, u.display_name, u.verified, u.verified_tier
             FROM ledger.entries e2 JOIN ledger.accounts a2 ON a2.id = e2.account_id
             JOIN identity.users u ON u.id = a2.user_id
            WHERE e2.transaction_id = e.transaction_id AND e2.account_id <> e.account_id AND t.type IN ('transfer', 'gift') LIMIT 1
         ) cp ON true
         LEFT JOIN content.venues v ON t.type = 'venue_payment' AND v.id::text = t.metadata->>'venueId'
         LEFT JOIN social.groups g ON t.type IN ('group_contribution', 'group_refund', 'venue_payment') AND g.id::text = t.metadata->>'groupId'
         LEFT JOIN identity.users pu ON t.type = 'venue_payment' AND e.amount > 0 AND pu.id::text = t.metadata->>'payerId'
        WHERE e.account_id = $1 ORDER BY e.id DESC LIMIT 30`,
      [acc.id],
    );
    return {
      currency: 'TXL',
      demo: true,
      balance: Number(acc.balance),
      history: rows.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        type: r.type,
        createdAt: r.created_at,
        counterparty: r.counterparty_username
          ? { username: r.counterparty_username, displayName: r.counterparty_name, ...badge(r.counterparty_verified, r.counterparty_tier) }
          : null,
        note: r.metadata?.note ?? null,
        /** Local pago (pagamentos com Txills) e grupo do cofre (contribuições e devoluções); o nome guardado no movimento se já não existirem. */
        // Só nos movimentos novos (pagamentos com Txills, cofres dos TxillGroups); nos outros os campos não aparecem.
        ...historyExtras(r),
        label: historyLabel(r.type as LedgerType, Number(r.amount), {
          who: r.counterparty_username ? `@${r.counterparty_username as string}` : r.payer_username ? `@${r.payer_username as string}` : null,
          venue: (r.venue_name as string | null) ?? (r.metadata?.venueName as string | undefined) ?? null,
          group: (r.group_name as string | null) ?? (r.metadata?.groupName as string | undefined) ?? null,
        }),
      })),
    };
  }

  async transferToUsername(actorId: string, toUsername: string, amount: number, key: string, note?: string) {
    const { rows } = await this.pool.query(
      `SELECT id FROM identity.users WHERE username = $1 AND status = 'active'`,
      [toUsername],
    );
    if (!rows[0]) throw new NotFoundException('Utilizador não encontrado');
    return this.transfer({
      actorId, fromUserId: actorId, toUserId: rows[0].id, amount, type: 'transfer',
      idempotencyKey: key, metadata: note ? { note } : {},
    });
  }

  /**
   * Movimento de partidas dobradas com idempotência e controlo de concorrência.
   * `client` opcional: permite compor com outras escritas (ex.: registo do presente) na mesma transacção.
   */
  async transfer(p: TransferParams, client?: PoolClient): Promise<TransferResult> {
    if (!Number.isInteger(p.amount) || p.amount < 1 || p.amount > MAX_AMOUNT) {
      throw new UnprocessableEntityException(`Montante deve ser inteiro entre 1 e ${MAX_AMOUNT}`);
    }
    if (p.fromUserId === p.toUserId) throw new UnprocessableEntityException('Não pode enviar para si próprio');

    const own = !client;
    const c = client ?? (await this.pool.connect());
    try {
      if (own) await c.query('BEGIN');

      const dup = await c.query('SELECT id FROM ledger.transactions WHERE actor_id = $1 AND idempotency_key = $2', [
        p.actorId, p.idempotencyKey,
      ]);
      if (dup.rows[0]) {
        if (own) await c.query('COMMIT');
        return { transactionId: dup.rows[0].id, replayed: true };
      }

      const accs = await c.query(
        'SELECT id, user_id FROM ledger.accounts WHERE user_id = ANY($1) ORDER BY id',
        [[p.fromUserId, p.toUserId]],
      );
      const from = accs.rows.find((a) => a.user_id === p.fromUserId);
      const to = accs.rows.find((a) => a.user_id === p.toUserId);
      if (!from) throw new UnprocessableEntityException('Carteira de origem inexistente');
      if (!to) throw new UnprocessableEntityException('O destinatário ainda não abriu a carteira');
      // Bloqueio ordenado por id (evita deadlocks) antes de alterar saldos.
      await c.query('SELECT 1 FROM ledger.accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE', [[from.id, to.id]]);

      const txId = await this.post(c, {
        type: p.type, actorId: p.actorId, key: p.idempotencyKey,
        legs: [[from.id, -p.amount], [to.id, p.amount]], metadata: p.metadata ?? {},
      });
      if (own) await c.query('COMMIT');
      return { transactionId: txId, replayed: false };
    } catch (e) {
      if (own) await c.query('ROLLBACK').catch(() => undefined);
      const code = (e as { code?: string }).code;
      if (code === '23514') throw new UnprocessableEntityException('Saldo insuficiente');
      if (code === '23505' && own) {
        // Corrida entre dois pedidos com a mesma chave: devolve o resultado do vencedor.
        const r = await this.pool.query('SELECT id FROM ledger.transactions WHERE actor_id = $1 AND idempotency_key = $2', [
          p.actorId, p.idempotencyKey,
        ]);
        if (r.rows[0]) return { transactionId: r.rows[0].id, replayed: true };
      }
      if (e instanceof HttpException) throw e;
      throw e;
    } finally {
      if (own) c.release();
    }
  }

  /**
   * Credita Txills comprados (emissão → carteira) no mesmo livro de partidas dobradas, de forma idempotente por `key`.
   * `client` opcional para compor com a atualização do pedido na mesma transação.
   */
  async credit(userId: string, amount: number, key: string, metadata: Record<string, unknown>, client?: PoolClient, type: 'topup' | 'invite' = 'topup'): Promise<{ transactionId: string; replayed: boolean }> {
    if (!Number.isInteger(amount) || amount < 1) throw new UnprocessableEntityException('Montante inválido');
    const accountId = await this.ensureWallet(userId);
    const own = !client;
    const c = client ?? (await this.pool.connect());
    try {
      if (own) await c.query('BEGIN');
      const dup = await c.query('SELECT id FROM ledger.transactions WHERE actor_id = $1 AND idempotency_key = $2', [userId, key]);
      if (dup.rows[0]) {
        if (own) await c.query('COMMIT');
        return { transactionId: dup.rows[0].id, replayed: true };
      }
      await c.query('SELECT 1 FROM ledger.accounts WHERE id = $1 FOR UPDATE', [accountId]);
      const txId = await this.post(c, { type, actorId: userId, key, legs: [[ISSUANCE_ACCOUNT, -amount], [accountId, amount]], metadata });
      if (own) await c.query('COMMIT');
      return { transactionId: txId, replayed: false };
    } catch (e) {
      if (own) await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      if (own) c.release();
    }
  }

  /** Cofre de um grupo (criado na primeira vez que é preciso). */
  async ensureGroupPot(groupId: string): Promise<string> {
    await this.pool.query(`INSERT INTO ledger.accounts (id, kind, group_id) VALUES ($1, 'group_pot', $2) ON CONFLICT (group_id) DO NOTHING`, [uuidv7(), groupId]);
    return (await this.pool.query('SELECT id FROM ledger.accounts WHERE group_id = $1', [groupId])).rows[0].id as string;
  }

  /** Carteira de um local (criada na primeira vez que é preciso). */
  async ensureVenueWallet(venueId: string): Promise<string> {
    await this.pool.query(`INSERT INTO ledger.accounts (id, kind, venue_id) VALUES ($1, 'venue_wallet', $2) ON CONFLICT (venue_id) DO NOTHING`, [uuidv7(), venueId]);
    return (await this.pool.query('SELECT id FROM ledger.accounts WHERE venue_id = $1', [venueId])).rows[0].id as string;
  }

  /** Movimento genérico com idempotência (por quem age e chave), bloqueios de linha e saldo nunca negativo (CHECK no_overdraft). */
  async move(p: MoveParams): Promise<TransferResult> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const dup = await c.query('SELECT id FROM ledger.transactions WHERE actor_id = $1 AND idempotency_key = $2', [p.actorId, p.idempotencyKey]);
      if (dup.rows[0]) {
        await c.query('COMMIT');
        return { transactionId: dup.rows[0].id, replayed: true };
      }
      for (const id of p.lock) await c.query('SELECT 1 FROM ledger.accounts WHERE id = $1 FOR UPDATE', [id]);
      const legs = typeof p.legs === 'function' ? await p.legs(c) : p.legs;
      if (legs.length < 2 || legs.reduce((s, [, a]) => s + a, 0) !== 0 || legs.some(([, a]) => !Number.isInteger(a) || a === 0)) throw new UnprocessableEntityException('Movimento inválido');
      const txId = await this.post(c, { type: p.type, actorId: p.actorId, key: p.idempotencyKey, legs, metadata: p.metadata });
      await c.query('COMMIT');
      return { transactionId: txId, replayed: false };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      const code = (e as { code?: string }).code;
      if (code === '23514') throw new UnprocessableEntityException(p.insufficient ?? 'Saldo insuficiente');
      if (code === '23505') {
        // Corrida entre dois pedidos com a mesma chave: devolve o resultado do vencedor.
        const r = await this.pool.query('SELECT id FROM ledger.transactions WHERE actor_id = $1 AND idempotency_key = $2', [p.actorId, p.idempotencyKey]);
        if (r.rows[0]) return { transactionId: r.rows[0].id, replayed: true };
      }
      throw e;
    } finally {
      c.release();
    }
  }

  /**
   * Um movimento dentro da transação de quem chama (que já viu a idempotência e bloqueou as contas).
   * Uma conta que ficasse negativa faz falhar a query com o código 23514 (CHECK no_overdraft).
   */
  postIn(c: PoolClient, t: { type: LedgerType; actorId: string; key: string; legs: [string, number][]; metadata: Record<string, unknown> }): Promise<string> {
    if (t.legs.length < 2 || t.legs.reduce((s, [, a]) => s + a, 0) !== 0 || t.legs.some(([, a]) => !Number.isInteger(a) || a === 0)) throw new UnprocessableEntityException('Movimento inválido');
    return this.post(c, t);
  }

  private async post(
    c: PoolClient,
    t: { type: string; actorId: string; key: string; legs: [string, number][]; metadata: Record<string, unknown> },
  ): Promise<string> {
    const txId = uuidv7();
    await c.query(
      'INSERT INTO ledger.transactions (id, type, actor_id, idempotency_key, metadata) VALUES ($1, $2, $3, $4, $5)',
      [txId, t.type, t.actorId, t.key, t.metadata],
    );
    for (const [accountId, amount] of t.legs) {
      await c.query('INSERT INTO ledger.entries (id, transaction_id, account_id, amount) VALUES ($1, $2, $3, $4)', [
        uuidv7(), txId, accountId, amount,
      ]);
      await c.query('UPDATE ledger.accounts SET balance = balance + $2 WHERE id = $1', [accountId, amount]);
    }
    return txId;
  }
}
