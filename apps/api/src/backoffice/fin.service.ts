import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { BoostsService } from '../boosts/boosts.service';
import { INVITE } from '../invites/rules';
import type { Permission } from '../staff/staff.service';
import { ISSUANCE_ACCOUNT, type LedgerType } from '../wallet/wallet.service';

/** Os tipos de movimento do livro (iguais ao CHECK de ledger.transactions), pela ordem em que aparecem no backoffice. */
export const LEDGER_TYPES: readonly LedgerType[] = ['welcome_bonus', 'invite', 'topup', 'gift', 'transfer', 'venue_payment', 'group_contribution', 'group_refund', 'boost', 'boost_refund'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Regras dos alertas de presentes (simples e explicáveis). */
export const GIFT_ALERT = {
  /** Janela olhada (dias). */
  DAYS: 7,
  /** Recebeu pelo menos isto em presentes e transferências… */
  MIN_AMOUNT: 1000,
  /** …e pelo menos N vezes o normal (a mediana de quem recebeu alguma coisa na janela). */
  TIMES_MEDIAN: 10,
  /** Ou recebeu de muitas pessoas diferentes. */
  MANY_SENDERS: 15,
  /** Ou a maior parte de quem enviou tem a conta muito nova (dias), com pelo menos N pessoas. */
  NEW_SENDER_DAYS: 7,
  NEW_SENDER_MIN: 5,
  NEW_SENDER_SHARE: 0.6,
} as const;

/** Fornecedores de pagamento conhecidos (só o de teste está ligado enquanto não houver chaves). */
const PROVIDERS = [
  { id: 'mpesa', label: 'M-Pesa' },
  { id: 'emola', label: 'e-Mola' },
  { id: 'card', label: 'Cartão' },
  { id: 'sandbox', label: 'Pagamento de teste' },
] as const;

type Row = Record<string, any>;
interface Leg { account: string; amount: number; kind: string; username: string | null; displayName: string | null; userId: string | null; venue: string | null; venueSlug: string | null; group: string | null; balance: number }

/** O nome de uma conta do livro, para mostrar. */
export function accountLabel(l: { kind: string; username: string | null; venue: string | null; group: string | null }): string {
  if (l.kind === 'system_issuance') return 'Emissão';
  if (l.kind === 'user_wallet') return l.username ? `@${l.username}` : 'Conta apagada';
  if (l.kind === 'venue_wallet') return l.venue ?? 'Local apagado';
  if (l.kind === 'group_pot') return `Cofre ${l.group ?? 'de grupo'}`;
  return l.kind;
}

/** Preenche os dias sem dados (para os gráficos não terem buracos). `days` dias até hoje (UTC). */
function fillDays<T extends object>(days: number, rows: Row[], pick: (r: Row | undefined) => T): ({ day: string } & T)[] {
  const map = new Map(rows.map((r) => [String(r.d), r]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, ...pick(map.get(day)) };
  });
}

const n = (v: unknown) => Number(v ?? 0);

/**
 * Backoffice: Finanças (Txills, carteiras dos locais, livro de movimentos, compras, Bombar) e Crescimento (convites,
 * funil, fontes). Só leitura: as únicas ações (suspender e repor campanhas) continuam nas rotas que já existem.
 */
@Injectable()
export class FinService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly boosts: BoostsService,
  ) {}

  private q = async (sql: string, params: unknown[] = []) => (await this.pool.query(sql, params)).rows as Row[];

  /* ───────────── Resumo (página inicial) ───────────── */

  /** Os números do Resumo, só os que esta pessoa pode ver. */
  async summary(perms: Set<Permission>) {
    const out: Record<string, number> = {};
    const has = (p: Permission) => perms.has(p);
    if (has('stats.view')) {
      const [a] = await this.q(
        `SELECT count(DISTINCT user_id) FILTER (WHERE at > now() - interval '1 day')::int AS dau,
                count(DISTINCT user_id) FILTER (WHERE at > now() - interval '7 days')::int AS wau,
                count(DISTINCT user_id)::int AS mau
           FROM analytics.events WHERE name = 'app_open' AND at > now() - interval '30 days'`,
      );
      Object.assign(out, { dau: a.dau, wau: a.wau, mau: a.mau });
    }
    if (has('stats.view') || has('users.view') || has('invites.view')) {
      const [s] = await this.q(
        `SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today,
                count(*) FILTER (WHERE created_at < date_trunc('day', now()))::int AS yesterday
           FROM identity.users WHERE status <> 'staff' AND created_at >= date_trunc('day', now()) - interval '1 day'`,
      );
      out.signupsToday = s.today;
      out.signupsYesterday = s.yesterday;
    }
    if (has('reports.read')) out.reportsOpen = (await this.q(`SELECT count(DISTINCT (target_type, target_id))::int AS n FROM social.reports WHERE status = 'open'`))[0].n;
    if (has('verification.decide')) out.verificationsPending = (await this.q(`SELECT count(*)::int AS n FROM identity.verification_requests WHERE status = 'pending'`))[0].n;
    if (has('catalog.manage')) out.venuesPending = (await this.q(`SELECT count(*)::int AS n FROM content.venues WHERE review_status = 'pending'`))[0].n;
    if (has('wallet.view') || has('catalog.manage')) {
      out.boostsActive = (await this.q(`SELECT count(*)::int AS n FROM content.boost_campaigns WHERE status = 'active' AND starts_at <= now() AND ends_at > now()`))[0].n;
    }
    if (has('wallet.view')) {
      const [t] = await this.q(
        `SELECT count(DISTINCT t.id)::int AS n, coalesce(sum(e.amount) FILTER (WHERE e.amount > 0), 0)::bigint AS volume
           FROM ledger.transactions t JOIN ledger.entries e ON e.transaction_id = t.id WHERE t.created_at >= date_trunc('day', now())`,
      );
      out.txillsToday = n(t.volume);
      out.movesToday = t.n;
    }
    if (has('invites.view')) out.invitesToday = (await this.q(`SELECT count(*)::int AS n FROM social.referrals WHERE created_at >= date_trunc('day', now())`))[0].n;
    return out;
  }

  /* ───────────── Finanças: Txills em circulação ───────────── */

  /** Onde estão os Txills agora, quanto se emitiu e resgatou (sempre e no período), por tipo e por dia. */
  async overview(days: number) {
    const [now] = await this.q(
      `SELECT coalesce(sum(balance) FILTER (WHERE kind = 'user_wallet'), 0)::bigint AS users,
              coalesce(sum(balance) FILTER (WHERE kind = 'venue_wallet'), 0)::bigint AS venues,
              coalesce(sum(balance) FILTER (WHERE kind = 'group_pot'), 0)::bigint AS groups,
              coalesce(sum(balance) FILTER (WHERE kind = 'system_issuance'), 0)::bigint AS issuance,
              count(*) FILTER (WHERE kind = 'user_wallet')::int AS user_wallets,
              count(*) FILTER (WHERE kind = 'venue_wallet')::int AS venue_wallets,
              count(*) FILTER (WHERE kind = 'group_pot')::int AS group_pots
         FROM ledger.accounts`,
    );
    const [ever] = await this.q(
      `SELECT coalesce(-sum(amount) FILTER (WHERE amount < 0), 0)::bigint AS issued, coalesce(sum(amount) FILTER (WHERE amount > 0), 0)::bigint AS redeemed
         FROM ledger.entries WHERE account_id = $1`,
      [ISSUANCE_ACCOUNT],
    );
    const byTypeRows = await this.q(
      `SELECT t.type, count(DISTINCT t.id)::int AS n,
              coalesce(sum(e.amount) FILTER (WHERE e.amount > 0), 0)::bigint AS volume,
              coalesce(-sum(e.amount) FILTER (WHERE e.account_id = $2 AND e.amount < 0), 0)::bigint AS issued,
              coalesce(sum(e.amount) FILTER (WHERE e.account_id = $2 AND e.amount > 0), 0)::bigint AS redeemed
         FROM ledger.transactions t JOIN ledger.entries e ON e.transaction_id = t.id
        WHERE t.created_at > now() - make_interval(days => $1)
        GROUP BY t.type`,
      [days, ISSUANCE_ACCOUNT],
    );
    const byType = LEDGER_TYPES.map((type) => {
      const r = byTypeRows.find((x) => x.type === type);
      return { type, count: n(r?.n), volume: n(r?.volume), issued: n(r?.issued), redeemed: n(r?.redeemed) };
    });
    const sum = (k: 'count' | 'volume' | 'issued' | 'redeemed') => byType.reduce((s, x) => s + x[k], 0);
    const seriesRows = await this.q(
      `SELECT to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(DISTINCT t.id)::int AS n,
              coalesce(sum(e.amount) FILTER (WHERE e.amount > 0), 0)::bigint AS volume,
              coalesce(-sum(e.amount) FILTER (WHERE e.account_id = $2 AND e.amount < 0), 0)::bigint AS issued,
              coalesce(sum(e.amount) FILTER (WHERE e.account_id = $2 AND e.amount > 0), 0)::bigint AS redeemed
         FROM ledger.transactions t JOIN ledger.entries e ON e.transaction_id = t.id
        WHERE t.created_at > now() - make_interval(days => $1)
        GROUP BY 1`,
      [days, ISSUANCE_ACCOUNT],
    );
    const circulating = n(now.users) + n(now.venues) + n(now.groups);
    return {
      days,
      circulation: {
        /** Txills fora da emissão agora (nas carteiras, nos locais e nos cofres). É sempre igual a emitidos − resgatados. */
        total: circulating,
        users: n(now.users),
        venues: n(now.venues),
        groups: n(now.groups),
        wallets: { users: now.user_wallets as number, venues: now.venue_wallets as number, groups: now.group_pots as number },
        issuedEver: n(ever.issued),
        /** Voltaram à emissão (o Bombar paga para a emissão). */
        redeemedEver: n(ever.redeemed),
        /** O livro está certo se a soma de todas as contas for zero. */
        balanced: n(now.issuance) + circulating === 0,
      },
      period: { count: sum('count'), volume: sum('volume'), issued: sum('issued'), redeemed: sum('redeemed') },
      byType,
      series: fillDays(days, seriesRows, (r) => ({ count: n(r?.n), volume: n(r?.volume), issued: n(r?.issued), redeemed: n(r?.redeemed) })),
    };
  }

  /** As carteiras dos locais: saldo, recebido em pagamentos e gasto no Bombar (no período). */
  async venueWallets(days: number) {
    const rows = await this.q(
      `SELECT a.id AS account_id, a.balance, v.id AS venue_id, v.slug, v.name, v.kind, v.review_status, v.accepts_txills,
              coalesce(sum(e.amount) FILTER (WHERE t.type = 'venue_payment' AND e.amount > 0 AND t.created_at > now() - make_interval(days => $1)), 0)::bigint AS received,
              count(DISTINCT t.id) FILTER (WHERE t.type = 'venue_payment' AND e.amount > 0 AND t.created_at > now() - make_interval(days => $1))::int AS payments,
              coalesce(-sum(e.amount) FILTER (WHERE t.type = 'boost' AND t.created_at > now() - make_interval(days => $1)), 0)::bigint AS boost_spent,
              coalesce(sum(e.amount) FILTER (WHERE t.type = 'boost_refund' AND t.created_at > now() - make_interval(days => $1)), 0)::bigint AS boost_refunded,
              coalesce(sum(e.amount) FILTER (WHERE t.type = 'venue_payment' AND e.amount > 0), 0)::bigint AS received_ever,
              max(t.created_at) AS last_move
         FROM ledger.accounts a
         LEFT JOIN content.venues v ON v.id = a.venue_id
         LEFT JOIN ledger.entries e ON e.account_id = a.id
         LEFT JOIN ledger.transactions t ON t.id = e.transaction_id
        WHERE a.kind = 'venue_wallet'
        GROUP BY a.id, v.id
        ORDER BY a.balance DESC, received_ever DESC
        LIMIT 300`,
      [days],
    );
    const items = rows.map((r) => ({
      accountId: r.account_id as string,
      venue: r.venue_id ? { id: r.venue_id as string, slug: r.slug as string, name: r.name as string, kind: r.kind as string, reviewStatus: r.review_status as string, acceptsTxills: !!r.accepts_txills } : null,
      balance: n(r.balance),
      received: n(r.received),
      payments: r.payments as number,
      boostSpent: n(r.boost_spent) - n(r.boost_refunded),
      receivedEver: n(r.received_ever),
      lastMove: (r.last_move as string | null) ?? null,
    }));
    return {
      days,
      totals: { balance: items.reduce((s, x) => s + x.balance, 0), received: items.reduce((s, x) => s + x.received, 0), boostSpent: items.reduce((s, x) => s + x.boostSpent, 0), wallets: items.length },
      items,
    };
  }

  /* ───────────── Livro de movimentos ───────────── */

  /**
   * As contas do livro que correspondem ao que se escreveu no filtro: o id de uma conta (ou da pessoa, do local ou do grupo),
   * `@utilizador`, o endereço de um local, ou `emissao`.
   */
  async resolveAccount(raw: string): Promise<{ ids: string[]; label: string | null }> {
    const s = raw.trim();
    if (!s) return { ids: [], label: null };
    if (/^emiss[aã]o$/i.test(s)) return { ids: [ISSUANCE_ACCOUNT], label: 'Emissão' };
    if (UUID.test(s)) {
      const r = await this.q(
        `SELECT a.id, a.kind, u.username, v.name AS venue, g.name AS "group" FROM ledger.accounts a
           LEFT JOIN identity.users u ON u.id = a.user_id LEFT JOIN content.venues v ON v.id = a.venue_id LEFT JOIN social.groups g ON g.id = a.group_id
          WHERE a.id = $1 OR a.user_id = $1 OR a.venue_id = $1 OR a.group_id = $1`,
        [s],
      );
      return { ids: r.map((x) => x.id as string), label: r[0] ? accountLabel(r[0] as never) : null };
    }
    const name = s.replace(/^@/, '').toLowerCase();
    if (!s.startsWith('@')) {
      const v = (await this.q(`SELECT a.id, v.name FROM content.venues v JOIN ledger.accounts a ON a.venue_id = v.id WHERE lower(v.slug) = $1`, [name]))[0];
      if (v) return { ids: [v.id as string], label: v.name as string };
    }
    const u = (await this.q(`SELECT a.id, u.username FROM identity.users u JOIN ledger.accounts a ON a.user_id = u.id WHERE lower(u.username) = $1`, [name]))[0];
    if (u) return { ids: [u.id as string], label: `@${u.username as string}` };
    return { ids: [], label: null };
  }

  /** O livro de movimentos com filtros (tipo, conta, datas) e páginas (os mais recentes primeiro). */
  async ledger(f: { type?: string; account?: string; from?: string; to?: string; cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 100);
    const type = f.type && (LEDGER_TYPES as readonly string[]).includes(f.type) ? f.type : null;
    const from = f.from && DAY.test(f.from) ? `${f.from}T00:00:00Z` : null;
    // `to` inclui o dia todo.
    const to = f.to && DAY.test(f.to) ? new Date(Date.parse(`${f.to}T00:00:00Z`) + 86_400_000).toISOString() : null;
    const cursor = f.cursor && UUID.test(f.cursor) ? f.cursor : null;
    let accounts: string[] | null = null;
    let accountLabelOut: string | null = null;
    if (f.account?.trim()) {
      const r = await this.resolveAccount(f.account);
      accounts = r.ids;
      accountLabelOut = r.label;
      if (!accounts.length) return { items: [], nextCursor: null, totals: { count: 0, volume: 0, in: 0, out: 0 }, account: { query: f.account.trim(), label: null, found: false } };
    }
    const where = `($1::text IS NULL OR t.type = $1)
        AND ($2::uuid[] IS NULL OR EXISTS (SELECT 1 FROM ledger.entries x WHERE x.transaction_id = t.id AND x.account_id = ANY($2)))
        AND ($3::timestamptz IS NULL OR t.created_at >= $3)
        AND ($4::timestamptz IS NULL OR t.created_at < $4)`;
    const rows = await this.q(
      `SELECT t.id, t.type, t.created_at, t.metadata, au.username AS actor, au.status AS actor_status,
              (SELECT json_agg(json_build_object('account', e.account_id, 'amount', e.amount, 'kind', a.kind, 'username', u.username, 'venue', v.name, 'venueSlug', v.slug, 'group', g.name) ORDER BY e.amount, e.id)
                 FROM ledger.entries e JOIN ledger.accounts a ON a.id = e.account_id
                 LEFT JOIN identity.users u ON u.id = a.user_id LEFT JOIN content.venues v ON v.id = a.venue_id LEFT JOIN social.groups g ON g.id = a.group_id
                WHERE e.transaction_id = t.id) AS legs
         FROM ledger.transactions t LEFT JOIN identity.users au ON au.id = t.actor_id
        WHERE ${where} AND ($5::uuid IS NULL OR t.id < $5)
        ORDER BY t.id DESC LIMIT $6`,
      [type, accounts, from, to, cursor, limit + 1],
    );
    const [tot] = await this.q(
      `SELECT count(DISTINCT t.id)::int AS n,
              coalesce(sum(e.amount) FILTER (WHERE e.amount > 0), 0)::bigint AS volume,
              coalesce(sum(e.amount) FILTER (WHERE e.amount > 0 AND e.account_id = ANY(coalesce($2::uuid[], '{}'))), 0)::bigint AS "in",
              coalesce(-sum(e.amount) FILTER (WHERE e.amount < 0 AND e.account_id = ANY(coalesce($2::uuid[], '{}'))), 0)::bigint AS "out"
         FROM ledger.transactions t JOIN ledger.entries e ON e.transaction_id = t.id
        WHERE ${where}`,
      [type, accounts, from, to],
    );
    const page = rows.slice(0, limit).map((r) => {
      const legs: Row[] = ((r.legs ?? []) as Row[]).map((l) => ({ ...l, amount: n(l.amount) }));
      const label = (l: Row) => accountLabel(l as never);
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        id: r.id as string,
        type: r.type as LedgerType,
        createdAt: r.created_at as string,
        amount: legs.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0),
        from: legs.filter((l) => l.amount < 0).map(label),
        to: legs.filter((l) => l.amount > 0).map(label),
        actor: (r.actor as string | null) ?? null,
        actorIsStaff: r.actor_status === 'staff',
        note: typeof m.note === 'string' ? m.note : null,
        /** Do lado da conta filtrada: o que entrou (+) ou saiu (−). */
        net: accounts ? legs.filter((l) => accounts!.includes(l.account as string)).reduce((s, l) => s + l.amount, 0) : null,
      };
    });
    return {
      items: page,
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      totals: { count: tot.n as number, volume: n(tot.volume), in: n(tot.in), out: n(tot.out) },
      account: f.account?.trim() ? { query: f.account.trim(), label: accountLabelOut, found: true } : null,
    };
  }

  /** O detalhe de um movimento: as pernas (com o saldo atual de cada conta), quem fez, os dados guardados e o que está ligado. */
  async transaction(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Movimento não encontrado');
    const t = (
      await this.q(
        `SELECT t.id, t.type, t.created_at, t.metadata, t.idempotency_key, t.actor_id, au.username AS actor, au.display_name AS actor_name, au.status AS actor_status
           FROM ledger.transactions t LEFT JOIN identity.users au ON au.id = t.actor_id WHERE t.id = $1`,
        [id],
      )
    )[0];
    if (!t) throw new NotFoundException('Movimento não encontrado');
    const legs: Leg[] = (
      await this.q(
        `SELECT e.account_id, e.amount, a.kind, a.balance, u.id AS user_id, u.username, u.display_name, v.name AS venue, v.slug AS venue_slug, g.name AS "group"
           FROM ledger.entries e JOIN ledger.accounts a ON a.id = e.account_id
           LEFT JOIN identity.users u ON u.id = a.user_id LEFT JOIN content.venues v ON v.id = a.venue_id LEFT JOIN social.groups g ON g.id = a.group_id
          WHERE e.transaction_id = $1 ORDER BY e.amount, e.id`,
        [id],
      )
    ).map((r) => ({
      account: r.account_id as string, amount: n(r.amount), kind: r.kind as string, balance: n(r.balance), userId: (r.user_id as string | null) ?? null,
      username: (r.username as string | null) ?? null, displayName: (r.display_name as string | null) ?? null, venue: (r.venue as string | null) ?? null, venueSlug: (r.venue_slug as string | null) ?? null, group: (r.group as string | null) ?? null,
    }));
    const order = (await this.q(`SELECT id, package_id, provider, status, amount_minor, currency, created_at, paid_at FROM payments.orders WHERE ledger_tx = $1`, [id]))[0] ?? null;
    const campaign = (
      await this.q(
        `SELECT c.id, c.status, c.package, c.price, c.refunded, c.starts_at, c.ends_at, v.slug, v.name FROM content.boost_campaigns c JOIN content.venues v ON v.id = c.venue_id
          WHERE c.charge_tx_id = $1 OR c.refund_tx_id = $1`,
        [id],
      )
    )[0] ?? null;
    return {
      id: t.id as string,
      type: t.type as LedgerType,
      createdAt: t.created_at as string,
      amount: legs.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0),
      actor: t.actor ? { id: t.actor_id as string, username: t.actor as string, displayName: t.actor_name as string, staff: t.actor_status === 'staff' } : null,
      idempotencyKey: t.idempotency_key as string,
      metadata: t.metadata as Record<string, unknown>,
      legs: legs.map((l) => ({ ...l, label: accountLabel(l) })),
      balanced: legs.reduce((s, l) => s + l.amount, 0) === 0,
      order: order && { id: order.id as string, packageId: order.package_id as string, provider: order.provider as string, status: order.status as string, amountMinor: order.amount_minor as number, currency: order.currency as string, createdAt: order.created_at as string, paidAt: (order.paid_at as string | null) ?? null },
      campaign: campaign && { id: campaign.id as string, status: campaign.status as string, package: campaign.package as string, price: n(campaign.price), refunded: n(campaign.refunded), startsAt: campaign.starts_at as string, endsAt: campaign.ends_at as string, venue: { slug: campaign.slug as string, name: campaign.name as string } },
    };
  }

  /* ───────────── Alertas ───────────── */

  /** Alertas simples: o livro desequilibrado e contas que recebem presentes fora do normal. */
  async alerts() {
    const A = GIFT_ALERT;
    const out: { id: string; level: 'critical' | 'warning' | 'info'; title: string; detail: string; account?: { userId: string; username: string }; amount?: number }[] = [];
    // 1) O livro: a soma de todas as contas é zero e cada saldo é a soma dos seus lançamentos.
    const [b] = await this.q(
      `SELECT (SELECT coalesce(sum(balance), 0) FROM ledger.accounts)::bigint AS total,
              (SELECT count(*) FROM ledger.accounts a WHERE a.balance <> (SELECT coalesce(sum(e.amount), 0) FROM ledger.entries e WHERE e.account_id = a.id))::int AS drift,
              (SELECT count(*) FROM (SELECT transaction_id FROM ledger.entries GROUP BY 1 HAVING sum(amount) <> 0) x)::int AS unbalanced`,
    );
    if (n(b.total) !== 0 || b.drift > 0 || b.unbalanced > 0) {
      out.push({ id: 'ledger', level: 'critical', title: 'O livro de movimentos não bate certo', detail: `Soma das contas: ${n(b.total)}; contas com saldo diferente dos lançamentos: ${b.drift}; movimentos desequilibrados: ${b.unbalanced}.` });
    }
    // 2) Presentes e transferências recebidos na janela, por pessoa.
    const rec = await this.q(
      `WITH g AS (
         SELECT a.user_id AS receiver, e.amount, t.actor_id AS sender
           FROM ledger.transactions t JOIN ledger.entries e ON e.transaction_id = t.id AND e.amount > 0
           JOIN ledger.accounts a ON a.id = e.account_id AND a.kind = 'user_wallet'
          WHERE t.type IN ('gift', 'transfer') AND t.created_at > now() - make_interval(days => $1)
       )
       SELECT g.receiver, u.username, sum(g.amount)::bigint AS amount, count(*)::int AS gifts, count(DISTINCT g.sender)::int AS senders,
              count(DISTINCT g.sender) FILTER (WHERE s.created_at > now() - make_interval(days => $2))::int AS new_senders
         FROM g JOIN identity.users u ON u.id = g.receiver LEFT JOIN identity.users s ON s.id = g.sender
        GROUP BY g.receiver, u.username`,
      [A.DAYS, A.NEW_SENDER_DAYS],
    );
    const amounts = rec.map((r) => n(r.amount)).sort((x, y) => x - y);
    const median = amounts.length ? amounts[Math.floor((amounts.length - 1) / 2)] : 0;
    for (const r of rec) {
      const amount = n(r.amount);
      const why: string[] = [];
      if (amount >= A.MIN_AMOUNT && amount >= median * A.TIMES_MEDIAN) why.push(`recebeu ${amount} Txills (o normal é ${median})`);
      if (r.senders >= A.MANY_SENDERS) why.push(`de ${r.senders} pessoas diferentes`);
      if (r.new_senders >= A.NEW_SENDER_MIN && r.new_senders / r.senders >= A.NEW_SENDER_SHARE) why.push(`${r.new_senders} de ${r.senders} com a conta criada há menos de ${A.NEW_SENDER_DAYS} dias`);
      if (!why.length) continue;
      out.push({
        id: `gifts:${r.receiver as string}`,
        level: why.length > 1 ? 'critical' : 'warning',
        title: `@${r.username as string} recebe presentes fora do normal`,
        detail: `Nos últimos ${A.DAYS} dias: ${why.join('; ')} (${r.gifts} movimentos).`,
        account: { userId: r.receiver as string, username: r.username as string },
        amount,
      });
    }
    // 3) Pedidos de compra presos (pendentes há mais de uma hora).
    const [p] = await this.q(`SELECT count(*)::int AS n FROM payments.orders WHERE status = 'pending' AND created_at < now() - interval '1 hour'`);
    if (p.n > 0) out.push({ id: 'orders', level: 'info', title: `${p.n} compras de Txills pendentes há mais de uma hora`, detail: 'Pedidos que o fornecedor ainda não confirmou nem recusou.' });
    const rank = { critical: 0, warning: 1, info: 2 };
    out.sort((x, y) => rank[x.level] - rank[y.level] || (y.amount ?? 0) - (x.amount ?? 0));
    return { rules: A, medianReceived: median, receivers: rec.length, items: out };
  }

  /* ───────────── Compras de Txills ───────────── */

  /** O estado dos fornecedores, os pacotes (com vendas no período) e os pedidos. */
  async purchases(days: number) {
    const enabled = this.cfg.PAYMENTS_SANDBOX ? ['sandbox'] : [];
    const packages = await this.q(
      `SELECT p.id, p.name, p.txills, p.price_minor, p.currency, p.position, p.active,
              count(o.id) FILTER (WHERE o.status = 'paid')::int AS sold,
              coalesce(sum(o.amount_minor) FILTER (WHERE o.status = 'paid'), 0)::bigint AS revenue_minor,
              coalesce(sum(o.txills) FILTER (WHERE o.status = 'paid'), 0)::bigint AS txills_sold
         FROM payments.packages p LEFT JOIN payments.orders o ON o.package_id = p.id AND o.created_at > now() - make_interval(days => $1)
        GROUP BY p.id ORDER BY p.position, p.id`,
      [days],
    );
    const byStatus = await this.q(
      `SELECT provider, status, count(*)::int AS n, coalesce(sum(amount_minor), 0)::bigint AS amount_minor, coalesce(sum(txills), 0)::bigint AS txills
         FROM payments.orders WHERE created_at > now() - make_interval(days => $1) GROUP BY 1, 2`,
      [days],
    );
    const recent = await this.q(
      `SELECT o.id, o.package_id, o.txills, o.amount_minor, o.currency, o.provider, o.status, o.created_at, o.paid_at, o.ledger_tx, u.username
         FROM payments.orders o LEFT JOIN identity.users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 25`,
    );
    const statuses = ['paid', 'pending', 'failed', 'cancelled', 'expired'];
    return {
      days,
      mode: enabled.length === 0 ? 'off' : enabled.every((x) => x === 'sandbox') ? 'sandbox' : 'live',
      providers: PROVIDERS.map((p) => ({ ...p, enabled: enabled.includes(p.id), test: p.id === 'sandbox' })),
      packages: packages.map((p) => ({ id: p.id as string, name: p.name as string, txills: p.txills as number, priceMinor: p.price_minor as number, currency: p.currency as string, active: !!p.active, sold: p.sold as number, revenueMinor: n(p.revenue_minor), txillsSold: n(p.txills_sold) })),
      orders: Object.fromEntries(statuses.map((s) => [s, byStatus.filter((r) => r.status === s).reduce((a, r) => a + (r.n as number), 0)])) as Record<string, number>,
      paid: {
        count: byStatus.filter((r) => r.status === 'paid').reduce((a, r) => a + (r.n as number), 0),
        txills: byStatus.filter((r) => r.status === 'paid').reduce((a, r) => a + n(r.txills), 0),
        /** Só pedidos reais (o de teste não conta como dinheiro). */
        revenueMinor: byStatus.filter((r) => r.status === 'paid' && r.provider !== 'sandbox').reduce((a, r) => a + n(r.amount_minor), 0),
        testMinor: byStatus.filter((r) => r.status === 'paid' && r.provider === 'sandbox').reduce((a, r) => a + n(r.amount_minor), 0),
      },
      recent: recent.map((o) => ({ id: o.id as string, username: (o.username as string | null) ?? null, packageId: o.package_id as string, txills: o.txills as number, amountMinor: o.amount_minor as number, currency: o.currency as string, provider: o.provider as string, status: o.status as string, createdAt: o.created_at as string, paidAt: (o.paid_at as string | null) ?? null, ledgerTx: (o.ledger_tx as string | null) ?? null })),
    };
  }

  /* ───────────── Bombar (todas as campanhas) ───────────── */

  /** Visão geral do Bombar: totais no período (campanhas criadas), os locais que mais gastam e a lista de campanhas. */
  async boostsOverview(days: number, filter: 'live' | 'all') {
    const [t] = await this.q(
      `SELECT count(*)::int AS campaigns,
              count(*) FILTER (WHERE c.status = 'active' AND c.starts_at <= now() AND c.ends_at > now())::int AS live,
              count(*) FILTER (WHERE c.status = 'active' AND c.starts_at > now())::int AS scheduled,
              count(*) FILTER (WHERE c.status = 'suspended')::int AS suspended,
              count(*) FILTER (WHERE c.status = 'stopped')::int AS stopped,
              coalesce(sum(c.price), 0)::bigint AS price, coalesce(sum(c.refunded), 0)::bigint AS refunded,
              count(DISTINCT c.venue_id)::int AS venues
         FROM content.boost_campaigns c WHERE c.created_at > now() - make_interval(days => $1)`,
      [days],
    );
    const [imp] = await this.q(
      `SELECT count(*) FILTER (WHERE kind = 'view')::int AS views, count(*) FILTER (WHERE kind = 'tap')::int AS taps, count(DISTINCT user_id) FILTER (WHERE kind = 'view')::int AS people
         FROM content.boost_impressions WHERE created_at > now() - make_interval(days => $1)`,
      [days],
    );
    const series = await this.q(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*) FILTER (WHERE kind = 'view')::int AS views, count(*) FILTER (WHERE kind = 'tap')::int AS taps
         FROM content.boost_impressions WHERE created_at > now() - make_interval(days => $1) GROUP BY 1`,
      [days],
    );
    const topVenues = await this.q(
      `SELECT v.slug, v.name, count(*)::int AS campaigns, (sum(c.price) - sum(c.refunded))::bigint AS spent,
              (SELECT count(*) FROM content.boost_impressions i JOIN content.boost_campaigns c2 ON c2.id = i.campaign_id WHERE c2.venue_id = v.id AND i.kind = 'view' AND i.created_at > now() - make_interval(days => $1))::int AS views,
              (SELECT count(*) FROM content.boost_impressions i JOIN content.boost_campaigns c2 ON c2.id = i.campaign_id WHERE c2.venue_id = v.id AND i.kind = 'tap' AND i.created_at > now() - make_interval(days => $1))::int AS taps
         FROM content.boost_campaigns c JOIN content.venues v ON v.id = c.venue_id
        WHERE c.created_at > now() - make_interval(days => $1)
        GROUP BY v.id ORDER BY spent DESC, campaigns DESC LIMIT 10`,
      [days],
    );
    return {
      days,
      totals: {
        campaigns: t.campaigns as number, live: t.live as number, scheduled: t.scheduled as number, suspended: t.suspended as number, stopped: t.stopped as number,
        venues: t.venues as number, price: n(t.price), refunded: n(t.refunded), spent: n(t.price) - n(t.refunded),
        impressions: imp.views as number, taps: imp.taps as number, people: imp.people as number,
        tapRate: imp.views ? Math.round((imp.taps / imp.views) * 1000) / 10 : null,
      },
      series: fillDays(days, series, (r) => ({ views: n(r?.views), taps: n(r?.taps) })),
      topVenues: topVenues.map((r) => ({ slug: r.slug as string, name: r.name as string, campaigns: r.campaigns as number, spent: n(r.spent), impressions: r.views as number, taps: r.taps as number })),
      campaigns: await this.boosts.adminList(filter),
    };
  }

  /* ───────────── Crescimento ───────────── */

  /** Convites, quem mais convida, orçamento do mês, série diária, funil de registo e fontes de entrada. */
  async growth(days: number) {
    const [inv] = await this.q(
      `SELECT count(*)::int AS joined,
              count(*) FILTER (WHERE status = 'registered')::int AS waiting,
              count(*) FILTER (WHERE status IN ('qualified', 'paid'))::int AS active,
              count(*) FILTER (WHERE status = 'qualified')::int AS holding,
              count(*) FILTER (WHERE status = 'paid')::int AS paid,
              count(*) FILTER (WHERE status = 'blocked')::int AS blocked
         FROM social.referrals WHERE created_at > now() - make_interval(days => $1)`,
      [days],
    );
    const blockedBy = await this.q(
      `SELECT coalesce(reason, 'sem motivo') AS reason, count(*)::int AS n FROM social.referrals
        WHERE status = 'blocked' AND created_at > now() - make_interval(days => $1) GROUP BY 1 ORDER BY n DESC`,
      [days],
    );
    const [budget] = await this.q(
      `SELECT coalesce(sum(e.amount), 0)::bigint AS used, count(DISTINCT t.id)::int AS rewards
         FROM ledger.transactions t JOIN ledger.entries e ON e.transaction_id = t.id
        WHERE t.type = 'invite' AND e.amount > 0 AND e.account_id <> $1 AND t.created_at >= date_trunc('month', now())`,
      [ISSUANCE_ACCOUNT],
    );
    const top = await this.q(
      `SELECT u.id, u.username, u.display_name, u.status,
              count(*)::int AS joined,
              count(*) FILTER (WHERE r.status IN ('qualified', 'paid'))::int AS active,
              count(*) FILTER (WHERE r.status = 'paid')::int AS paid,
              count(*) FILTER (WHERE r.status = 'blocked')::int AS blocked,
              coalesce(sum(r.amount) FILTER (WHERE r.status = 'paid'), 0)::int AS earned
         FROM social.referrals r JOIN identity.users u ON u.id = r.inviter_id
        WHERE r.created_at > now() - make_interval(days => $1)
        GROUP BY u.id ORDER BY joined DESC, active DESC, u.username LIMIT 15`,
      [days],
    );
    const s1 = await this.q(`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n, count(*) FILTER (WHERE status = 'blocked')::int AS b FROM social.referrals WHERE created_at > now() - make_interval(days => $1) GROUP BY 1`, [days]);
    const s2 = await this.q(`SELECT to_char(qualified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n FROM social.referrals WHERE qualified_at > now() - make_interval(days => $1) GROUP BY 1`, [days]);
    const s3 = await this.q(`SELECT to_char(paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n FROM social.referrals WHERE paid_at > now() - make_interval(days => $1) GROUP BY 1`, [days]);
    const s4 = await this.q(`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n FROM identity.users WHERE status <> 'staff' AND created_at > now() - make_interval(days => $1) GROUP BY 1`, [days]);
    const at = (rows: Row[], d: string, k = 'n') => n(rows.find((r) => r.d === d)?.[k]);
    const series = fillDays(days, [], () => ({})).map(({ day }) => ({ day, signups: at(s4, day), joined: at(s1, day), blocked: at(s1, day, 'b'), qualified: at(s2, day), paid: at(s3, day) }));

    // Funil das contas novas no período (sem contas de equipa).
    const [funnel] = await this.q(
      `SELECT count(*)::int AS signed,
              count(*) FILTER (WHERE u.email_verified_at IS NOT NULL)::int AS verified,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics.events e WHERE e.user_id = u.id AND e.name = 'app_open' AND e.at > u.created_at + interval '1 day'))::int AS returned,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_id = u.id))::int AS followed,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM content.posts p WHERE p.author_id = u.id))::int AS posted,
              count(*) FILTER (WHERE u.email_verified_at IS NOT NULL AND (EXISTS (SELECT 1 FROM content.posts p WHERE p.author_id = u.id AND p.removed_at IS NULL)
                                     OR (SELECT count(*) FROM social.follows f WHERE f.follower_id = u.id) >= $2))::int AS active
         FROM identity.users u WHERE u.status <> 'staff' AND u.created_at > now() - make_interval(days => $1)`,
      [days, INVITE.ACTIVE_FOLLOWS],
    );
    // Fontes: convite ou direto; e por onde entrou (email, Google, Apple) e a primeira plataforma usada.
    const [src] = await this.q(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM social.referrals r WHERE r.invitee_id = u.id))::int AS invite,
              count(*) FILTER (WHERE u.google_sub IS NOT NULL)::int AS google,
              count(*) FILTER (WHERE u.apple_sub IS NOT NULL)::int AS apple
         FROM identity.users u WHERE u.status <> 'staff' AND u.created_at > now() - make_interval(days => $1)`,
      [days],
    );
    const platforms = await this.q(
      `SELECT coalesce(f.platform, 'desconhecida') AS platform, count(*)::int AS n
         FROM identity.users u
         LEFT JOIN LATERAL (SELECT e.platform FROM analytics.events e WHERE e.user_id = u.id ORDER BY e.at LIMIT 1) f ON true
        WHERE u.status <> 'staff' AND u.created_at > now() - make_interval(days => $1)
        GROUP BY 1 ORDER BY n DESC`,
      [days],
    );
    const used = n(budget.used);
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
    const email = src.total - src.google - src.apple;
    return {
      days,
      invites: { ...inv, blockedBy: blockedBy.map((r) => ({ reason: r.reason as string, count: r.n as number })), share: pct(inv.joined, src.total) } as {
        joined: number; waiting: number; active: number; holding: number; paid: number; blocked: number; blockedBy: { reason: string; count: number }[]; share: number | null;
      },
      budget: { monthly: INVITE.MONTHLY_BUDGET, used, rewards: budget.rewards as number, pct: pct(used, INVITE.MONTHLY_BUDGET) ?? 0, left: Math.max(0, INVITE.MONTHLY_BUDGET - used) },
      rules: INVITE,
      top: top.map((r) => ({ id: r.id as string, username: r.username as string, displayName: r.display_name as string, status: r.status as string, joined: r.joined as number, active: r.active as number, paid: r.paid as number, blocked: r.blocked as number, earned: r.earned as number })),
      series,
      funnel: funnel as { signed: number; verified: number; returned: number; followed: number; posted: number; active: number },
      sources: {
        total: src.total as number,
        invite: src.invite as number,
        direct: (src.total as number) - (src.invite as number),
        methods: [
          { id: 'email', count: email },
          { id: 'google', count: src.google as number },
          { id: 'apple', count: src.apple as number },
        ],
        platforms: platforms.map((r) => ({ platform: r.platform as string, count: r.n as number })),
      },
    };
  }
}
