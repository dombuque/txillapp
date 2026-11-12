import type { AppConfig } from '../config';
import { BOOST_PACKAGES, type BoostPackageId } from '../boosts/boost-config';

/**
 * O que se vende nas lojas (App Store e Google Play). Só duas coisas:
 * - a verificação paga: subscrições com renovação automática, mensal e anual (no mesmo «subscription group» na Apple e
 *   na mesma subscrição com dois planos base, ou duas subscrições, no Google Play);
 * - o Bombar: consumíveis com os pacotes fixos de 1, 3 e 7 dias, cada um com um raio fixo.
 * Os Txills NÃO se vendem nas lojas.
 *
 * Mapeamento do Bombar (por omissão, mudável em IAP_BOOST_RADIUS_KM e IAP_PRODUCT_BOOST_*):
 *   txillapp.bombar.1d -> pacote '1d', 1 dia, 3 km
 *   txillapp.bombar.3d -> pacote '3d', 3 dias, 3 km
 *   txillapp.bombar.7d -> pacote '7d', 7 dias, 3 km
 * O raio de 3 km é o que o preço base de cada pacote cobre hoje (boost-config.ts: 1500, 4000 e 8000 Txills = 150, 400
 * e 800 MZN a 0,10 MZN por Txill). São esses os preços sugeridos para as lojas (ver docs/lojas/iap.md).
 */

export type VerificationPeriod = 'month' | 'year';
export interface VerificationProduct { id: string; period: VerificationPeriod }
export interface BoostProduct { id: string; package: BoostPackageId; days: number; radiusKm: number }
export interface IapProducts {
  verification: VerificationProduct[];
  boost: BoostProduct[];
  /** Preço de referência em centavos (para os totais do backoffice quando a loja não diz o valor). */
  prices: Map<string, number>;
  currency: string;
}

export type ProductInfo = ({ kind: 'subscription' } & VerificationProduct) | ({ kind: 'consumable' } & BoostProduct);

/** O raio fixo de cada pacote do Bombar comprado na loja (`1d:3,3d:3,7d:3`), dentro dos limites do Bombar (1 a 10 km). */
export function iapBoostRadius(cfg: Pick<AppConfig, 'IAP_BOOST_RADIUS_KM'>): Record<BoostPackageId, number> {
  const out = Object.fromEntries(BOOST_PACKAGES.map((p) => [p.id, 3])) as Record<BoostPackageId, number>;
  for (const part of (cfg.IAP_BOOST_RADIUS_KM ?? '').split(',')) {
    const [k, v] = part.split(':').map((s) => s.trim());
    if (k in out) out[k as BoostPackageId] = Math.min(10, Math.max(1, Math.round(Number(v)) || 3));
  }
  return out;
}

export function iapProducts(cfg: AppConfig): IapProducts {
  const radius = iapBoostRadius(cfg);
  const ids: Record<BoostPackageId, string> = { '1d': cfg.IAP_PRODUCT_BOOST_1D, '3d': cfg.IAP_PRODUCT_BOOST_3D, '7d': cfg.IAP_PRODUCT_BOOST_7D };
  const prices = new Map<string, number>();
  for (const part of (cfg.IAP_PRICES ?? '').split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    const n = Math.round(Number(v));
    if (k && Number.isFinite(n) && n >= 0) prices.set(k, n);
  }
  return {
    verification: [
      { id: cfg.IAP_PRODUCT_VERIFY_MONTHLY, period: 'month' },
      { id: cfg.IAP_PRODUCT_VERIFY_YEARLY, period: 'year' },
    ],
    boost: BOOST_PACKAGES.map((p) => ({ id: ids[p.id], package: p.id, days: p.days, radiusKm: radius[p.id] })),
    prices,
    currency: cfg.IAP_CURRENCY,
  };
}

export function productInfo(p: IapProducts, id: string): ProductInfo | null {
  const v = p.verification.find((x) => x.id === id);
  if (v) return { kind: 'subscription', ...v };
  const b = p.boost.find((x) => x.id === id);
  return b ? { kind: 'consumable', ...b } : null;
}

/** Os rascunhos do Bombar por pagar (compra pela loja) apagam-se passadas estas horas. */
export const IAP_DRAFT_HOURS = 24;
