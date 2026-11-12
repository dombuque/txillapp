import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { uuidv7 } from '../common/uuid7';
import { PG_POOL } from '../db/db.module';
import { WalletService } from '../wallet/wallet.service';

export type ProviderId = 'sandbox' | 'mpesa' | 'emola' | 'card';
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired';

/** Um pedido pendente deixa de valer passado este tempo (o pagamento pode ainda chegar e é creditado na mesma). */
const EXPIRES_MIN = 30;
/** Telemóvel de Moçambique (Vodacom 84/85, Movitel 86/87, Tmcel 82/83), com ou sem +258. */
const PHONE_RE = /^(?:\+?258)?(8[2-7]\d{7})$/;

interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Pede o número de telemóvel (pagamento móvel). */
  needsPhone: boolean;
}
const PROVIDERS: ProviderInfo[] = [
  { id: 'mpesa', label: 'M-Pesa', needsPhone: true },
  { id: 'emola', label: 'e-Mola', needsPhone: true },
  { id: 'card', label: 'Cartão', needsPhone: false },
  { id: 'sandbox', label: 'Pagamento de teste', needsPhone: false },
];

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly wallet: WalletService,
  ) {}

  /** Fornecedores ligados neste servidor. Só o de teste existe por agora; M-Pesa, e-Mola e cartão entram quando houver as chaves. */
  private enabled(): ProviderId[] {
    return this.cfg.PAYMENTS_SANDBOX ? ['sandbox'] : [];
  }

  async config() {
    const on = this.enabled();
    const { rows } = await this.pool.query(`SELECT id, name, txills, price_minor, currency FROM payments.packages WHERE active ORDER BY position`);
    return {
      // Interruptor das lojas: a app das lojas só mostra a recarga com isto ligado (PAYMENTS_STORE_TOPUP).
      storeTopup: this.cfg.PAYMENTS_STORE_TOPUP,
      providers: PROVIDERS.filter((p) => on.includes(p.id)),
      packages: rows.map((r) => ({ id: r.id as string, name: r.name as string, txills: r.txills as number, priceMinor: r.price_minor as number, currency: r.currency as string })),
    };
  }

  private row(r: Record<string, unknown>) {
    return {
      id: r.id as string,
      packageId: r.package_id as string,
      txills: r.txills as number,
      amountMinor: r.amount_minor as number,
      currency: r.currency as string,
      provider: r.provider as ProviderId,
      status: r.status as OrderStatus,
      phoneTail: (r.phone_tail as string | null) ?? null,
      createdAt: r.created_at as string,
      paidAt: (r.paid_at as string | null) ?? null,
    };
  }

  async create(userId: string, b: { packageId: string; provider: ProviderId; phone?: string }, key: string) {
    const dup = (await this.pool.query('SELECT * FROM payments.orders WHERE user_id = $1 AND idempotency_key = $2', [userId, key])).rows[0];
    if (dup) return this.row(dup);
    if (!this.enabled().includes(b.provider)) throw new BadRequestException('Este método de pagamento ainda não está disponível');
    const info = PROVIDERS.find((p) => p.id === b.provider)!;
    let phoneTail: string | null = null;
    if (info.needsPhone) {
      const m = PHONE_RE.exec((b.phone ?? '').replace(/\s+/g, ''));
      if (!m) throw new BadRequestException('Escreve um número de telemóvel de Moçambique (por exemplo, 84 123 4567)');
      phoneTail = m[1].slice(-3);
    }
    const pkg = (await this.pool.query('SELECT txills, price_minor, currency FROM payments.packages WHERE id = $1 AND active', [b.packageId])).rows[0];
    if (!pkg) throw new NotFoundException('Pacote não encontrado');
    // Não acumula pedidos à espera: no máximo 3 de cada vez.
    await this.expire(userId);
    const open = (await this.pool.query(`SELECT count(*)::int AS n FROM payments.orders WHERE user_id = $1 AND status = 'pending'`, [userId])).rows[0].n as number;
    if (open >= 3) throw new ConflictException('Já tens pedidos à espera. Acaba ou cancela um deles primeiro');
    const id = uuidv7();
    try {
      const r = await this.pool.query(
        `INSERT INTO payments.orders (id, user_id, package_id, txills, amount_minor, currency, provider, phone_tail, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [id, userId, b.packageId, pkg.txills, pkg.price_minor, pkg.currency, b.provider, phoneTail, key],
      );
      return this.row(r.rows[0]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        const again = (await this.pool.query('SELECT * FROM payments.orders WHERE user_id = $1 AND idempotency_key = $2', [userId, key])).rows[0];
        if (again) return this.row(again);
      }
      throw e;
    }
  }

  private async expire(userId?: string) {
    await this.pool.query(
      `UPDATE payments.orders SET status = 'expired' WHERE status = 'pending' AND created_at < now() - make_interval(mins => $1) AND ($2::uuid IS NULL OR user_id = $2)`,
      [EXPIRES_MIN, userId ?? null],
    );
  }

  async list(userId: string) {
    await this.expire(userId);
    const { rows } = await this.pool.query('SELECT * FROM payments.orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', [userId]);
    return rows.map((r) => this.row(r));
  }

  async get(userId: string, id: string) {
    await this.expire(userId);
    const r = (await this.pool.query('SELECT * FROM payments.orders WHERE id = $1 AND user_id = $2', [id, userId])).rows[0];
    if (!r) throw new NotFoundException('Pedido não encontrado');
    return this.row(r);
  }

  async cancel(userId: string, id: string) {
    const r = await this.pool.query(`UPDATE payments.orders SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`, [id, userId]);
    if (!r.rowCount) throw new NotFoundException('Só se cancelam pedidos à espera');
  }

  /**
   * Marca o pedido como pago e credita os Txills, uma única vez (idempotente). Aceita também pedidos expirados ou cancelados:
   * se o dinheiro chegou, os Txills são entregues.
   */
  async markPaid(orderId: string, providerRef?: string): Promise<{ credited: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const o = (await client.query('SELECT * FROM payments.orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
      if (!o) throw new NotFoundException('Pedido não encontrado');
      if (o.status === 'paid') {
        await client.query('COMMIT');
        return { credited: false };
      }
      const tx = await this.wallet.credit(o.user_id as string, o.txills as number, `topup:${orderId}`, { orderId, provider: o.provider, packageId: o.package_id }, client);
      await client.query(`UPDATE payments.orders SET status = 'paid', paid_at = now(), ledger_tx = $2, provider_ref = coalesce($3, provider_ref) WHERE id = $1`, [orderId, tx.transactionId, providerRef ?? null]);
      await client.query('COMMIT');
      return { credited: true };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      // A mesma referência do fornecedor já foi usada noutro pedido: recusa em vez de creditar duas vezes.
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Referência de pagamento já usada');
      throw e;
    } finally {
      client.release();
    }
  }

  /** Só o fornecedor de teste: confirma o pedido como se a pessoa tivesse pago. Não existe em produção. */
  async sandboxPay(userId: string, id: string) {
    if (!this.cfg.PAYMENTS_SANDBOX) throw new NotFoundException();
    const o = (await this.pool.query('SELECT provider FROM payments.orders WHERE id = $1 AND user_id = $2', [id, userId])).rows[0];
    if (!o) throw new NotFoundException('Pedido não encontrado');
    if (o.provider !== 'sandbox') throw new ForbiddenException('Só os pedidos de teste se confirmam assim');
    await this.markPaid(id, `sandbox-${id}`);
    return this.get(userId, id);
  }

  /** Aviso assinado de um fornecedor: HMAC-SHA256 de `${orderId}.${status}.${ref}` com o segredo partilhado. */
  async webhook(b: { orderId: string; status: 'paid' | 'failed'; ref: string }, signature?: string) {
    const secret = this.cfg.PAYMENTS_WEBHOOK_SECRET;
    if (!secret) throw new NotFoundException();
    const expected = createHmac('sha256', secret).update(`${b.orderId}.${b.status}.${b.ref}`).digest('hex');
    const given = Buffer.from(signature ?? '', 'hex');
    const want = Buffer.from(expected, 'hex');
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new ForbiddenException('Assinatura inválida');
    if (b.status === 'paid') return this.markPaid(b.orderId, b.ref);
    await this.pool.query(`UPDATE payments.orders SET status = 'failed', provider_ref = coalesce(provider_ref, $2) WHERE id = $1 AND status = 'pending'`, [b.orderId, b.ref]);
    return { credited: false };
  }
}
