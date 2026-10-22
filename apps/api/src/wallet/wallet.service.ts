import { HttpException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';

export const ISSUANCE_ACCOUNT = '00000000-0000-7000-8000-000000000001';
export const WELCOME_BONUS = 1000;
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
              cp.username AS counterparty_username, cp.display_name AS counterparty_name
         FROM ledger.entries e
         JOIN ledger.transactions t ON t.id = e.transaction_id
         LEFT JOIN LATERAL (
           SELECT u.username, u.display_name
             FROM ledger.entries e2 JOIN ledger.accounts a2 ON a2.id = e2.account_id
             JOIN identity.users u ON u.id = a2.user_id
            WHERE e2.transaction_id = e.transaction_id AND e2.account_id <> e.account_id LIMIT 1
         ) cp ON true
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
          ? { username: r.counterparty_username, displayName: r.counterparty_name }
          : null,
        note: r.metadata?.note ?? null,
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
