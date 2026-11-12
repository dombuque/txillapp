import { boRequest, type BoBoost } from '../../../lib/api';

/** Cliente das rotas de Finanças, Bombar, Crescimento e Resumo do backoffice (só leitura). */

export type LedgerType = 'welcome_bonus' | 'invite' | 'topup' | 'gift' | 'transfer' | 'venue_payment' | 'group_contribution' | 'group_refund' | 'boost' | 'boost_refund';

export const LEDGER_LABEL: Record<LedgerType, string> = {
  welcome_bonus: 'Bónus de boas-vindas',
  invite: 'Prémios de convite',
  topup: 'Compras (carregamentos)',
  gift: 'Presentes',
  transfer: 'Transferências',
  venue_payment: 'Pagamentos a locais',
  group_contribution: 'Entradas em cofres',
  group_refund: 'Devoluções de cofres',
  boost: 'Bombar (pago)',
  boost_refund: 'Bombar (devolvido)',
};
export const LEDGER_TYPES = Object.keys(LEDGER_LABEL) as LedgerType[];

export interface FinSummary {
  dau?: number; wau?: number; mau?: number; signupsToday?: number; signupsYesterday?: number; reportsOpen?: number; verificationsPending?: number;
  venuesPending?: number; boostsActive?: number; txillsToday?: number; movesToday?: number; invitesToday?: number;
}

export interface FinOverview {
  days: number;
  circulation: { total: number; users: number; venues: number; groups: number; wallets: { users: number; venues: number; groups: number }; issuedEver: number; redeemedEver: number; balanced: boolean };
  period: { count: number; volume: number; issued: number; redeemed: number };
  byType: { type: LedgerType; count: number; volume: number; issued: number; redeemed: number }[];
  series: { day: string; count: number; volume: number; issued: number; redeemed: number }[];
}

export interface FinVenueWallet {
  accountId: string; venue: { id: string; slug: string; name: string; kind: string; reviewStatus: string; acceptsTxills: boolean } | null;
  balance: number; received: number; payments: number; boostSpent: number; receivedEver: number; lastMove: string | null;
}

export interface FinLedgerRow { id: string; type: LedgerType; createdAt: string; amount: number; from: string[]; to: string[]; actor: string | null; actorIsStaff: boolean; note: string | null; net: number | null }
export interface FinLedgerPage { items: FinLedgerRow[]; nextCursor: string | null; totals: { count: number; volume: number; in: number; out: number }; account: { query: string; label: string | null; found: boolean } | null }
export interface FinLedgerFilter { type: string; account: string; from: string; to: string }

export interface FinTx {
  id: string; type: LedgerType; createdAt: string; amount: number; idempotencyKey: string; metadata: Record<string, unknown>; balanced: boolean;
  actor: { id: string; username: string; displayName: string; staff: boolean } | null;
  legs: { account: string; amount: number; kind: string; balance: number; userId: string | null; username: string | null; displayName: string | null; venue: string | null; venueSlug: string | null; group: string | null; label: string }[];
  order: { id: string; packageId: string; provider: string; status: string; amountMinor: number; currency: string; createdAt: string; paidAt: string | null } | null;
  campaign: { id: string; status: string; package: string; price: number; refunded: number; startsAt: string; endsAt: string; venue: { slug: string; name: string } } | null;
}

export interface FinAlert { id: string; level: 'critical' | 'warning' | 'info'; title: string; detail: string; account?: { userId: string; username: string }; amount?: number }
export interface FinAlerts { rules: Record<string, number>; medianReceived: number; receivers: number; items: FinAlert[] }

export interface FinPurchases {
  days: number; mode: 'off' | 'sandbox' | 'live';
  providers: { id: string; label: string; enabled: boolean; test: boolean }[];
  packages: { id: string; name: string; txills: number; priceMinor: number; currency: string; active: boolean; sold: number; revenueMinor: number; txillsSold: number }[];
  orders: Record<'paid' | 'pending' | 'failed' | 'cancelled' | 'expired', number>;
  paid: { count: number; txills: number; revenueMinor: number; testMinor: number };
  recent: { id: string; username: string | null; packageId: string; txills: number; amountMinor: number; currency: string; provider: string; status: string; createdAt: string; paidAt: string | null; ledgerTx: string | null }[];
}

export type FinBoost = BoBoost & { package?: string; days?: number; report: BoBoost['report'] & { feedImpressions?: number; mapImpressions?: number } };
export interface FinBoosts {
  days: number;
  totals: { campaigns: number; live: number; scheduled: number; suspended: number; stopped: number; venues: number; price: number; refunded: number; spent: number; impressions: number; taps: number; people: number; tapRate: number | null };
  series: { day: string; views: number; taps: number }[];
  topVenues: { slug: string; name: string; campaigns: number; spent: number; impressions: number; taps: number }[];
  campaigns: FinBoost[];
}

export interface FinGrowth {
  days: number;
  invites: { joined: number; waiting: number; active: number; holding: number; paid: number; blocked: number; blockedBy: { reason: string; count: number }[]; share: number | null };
  budget: { monthly: number; used: number; rewards: number; pct: number; left: number };
  rules: { REWARD: number; PER_DAY: number; MAX_PAID: number; HOLD_DAYS: number; MIN_AGE_DAYS: number; MONTHLY_BUDGET: number; SAME_NET_MAX: number; ACTIVE_FOLLOWS: number };
  top: { id: string; username: string; displayName: string; status: string; joined: number; active: number; paid: number; blocked: number; earned: number }[];
  series: { day: string; signups: number; joined: number; blocked: number; qualified: number; paid: number }[];
  funnel: { signed: number; verified: number; returned: number; followed: number; posted: number; active: number };
  sources: { total: number; invite: number; direct: number; methods: { id: string; count: number }[]; platforms: { platform: string; count: number }[] };
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const finApi = {
  summary: (): Promise<FinSummary> => boRequest('/admin/summary'),
  overview: (days: number): Promise<FinOverview> => boRequest(`/admin/fin/overview?days=${days}`),
  venues: (days: number): Promise<{ days: number; totals: { balance: number; received: number; boostSpent: number; wallets: number }; items: FinVenueWallet[] }> => boRequest(`/admin/fin/venues?days=${days}`),
  ledger: (f: FinLedgerFilter, cursor?: string): Promise<FinLedgerPage> => boRequest(`/admin/fin/ledger${qs({ ...f, cursor, limit: 50 })}`),
  tx: (id: string): Promise<FinTx> => boRequest(`/admin/fin/ledger/${id}`),
  alerts: (): Promise<FinAlerts> => boRequest('/admin/fin/alerts'),
  purchases: (days: number): Promise<FinPurchases> => boRequest(`/admin/fin/purchases?days=${days}`),
  boosts: (days: number, filter: 'live' | 'all'): Promise<FinBoosts> => boRequest(`/admin/fin/boosts?days=${days}&filter=${filter}`),
  growth: (days: number): Promise<FinGrowth> => boRequest(`/admin/growth?days=${days}`),
};

/* ───────────── Compras pela loja (App Store / Google Play): verificação paga e Bombar ───────────── */

export type StorePurchaseStatus = 'active' | 'expired' | 'refunded' | 'revoked' | 'consumed';
export interface StorePurchaseFilter { store: string; status: string; kind: string; product: string; env: string; user: string; from: string; to: string }
export interface StoreTotals { purchases: number; renewals: number; refunds: number; grossMinor: number; refundedMinor: number; netMinor: number }
export interface StorePurchasesPage {
  config: { enabled: boolean; apple: boolean; google: boolean; currency: string; products: { id: string; kind: 'subscription' | 'consumable' }[] };
  counts: Record<StorePurchaseStatus, number>;
  totals: { byProduct: (StoreTotals & { productId: string; store: 'apple' | 'google' })[]; byMonth: (StoreTotals & { month: string })[]; sandbox: StoreTotals | null };
  items: {
    id: string; store: 'apple' | 'google'; productId: string; kind: 'subscription' | 'consumable'; status: StorePurchaseStatus; environment: 'Production' | 'Sandbox';
    user: { id: string; username: string | null }; transactionId: string | null; orderId: string | null; expiresAt: string | null; autoRenew: boolean | null;
    renewals: number; paidMinor: number | null; campaign: { id: string; status: string; venue: { slug: string; name: string } | null } | null; createdAt: string; updatedAt: string;
  }[];
  nextCursor: string | null;
}

/** Finanças → Compras na loja (só leitura). */
export const storePurchasesApi = (f: StorePurchaseFilter, cursor?: string): Promise<StorePurchasesPage> =>
  boRequest(`/admin/fin/store-purchases${qs({ ...f, cursor, limit: 50 })}`);
