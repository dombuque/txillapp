/**
 * Bombar: preços, pagamentos e regras de entrega. Tudo o que se pode mudar sem tocar no resto do código está aqui.
 *
 * Preços em Txills (referência: 1 Txill = 0,10 MZN, a mesma dos presentes). O pacote inclui um raio até 3 km à volta
 * do local; cada km a mais soma 10% ao preço (10 km = +70%), arredondado aos 50 Txills. Os pacotes mais longos
 * saem mais baratos por dia (1 dia 1500; 3 dias 4000, ~1333/dia; 7 dias 8000, ~1143/dia).
 */
export const BOOST_PACKAGES = [
  { id: '1d', days: 1, price: 1500, label: '1 dia' },
  { id: '3d', days: 3, price: 4000, label: '3 dias' },
  { id: '7d', days: 7, price: 8000, label: '7 dias' },
] as const;
export type BoostPackageId = (typeof BOOST_PACKAGES)[number]['id'];
export const BOOST_PACKAGE_IDS = BOOST_PACKAGES.map((p) => p.id) as [BoostPackageId, ...BoostPackageId[]];

/** Raio à volta do local, em km inteiros: o preço base cobre até `included`; cada km a mais soma `extraPerKm`. */
export const BOOST_RADIUS = { min: 1, max: 10, included: 3, extraPerKm: 0.1, default: 3 } as const;

/**
 * Como se paga. Nesta fase só com os Txills da carteira do local (o relatório de negócio: "os Txills dos locais servem
 * só para promoção no Txillapp"). O pagamento em meticais fica preparado e desligado até haver fornecedor.
 */
export const BOOST_PAYMENTS = {
  txills: { enabled: true, label: 'Txills do local' },
  mzn: { enabled: false, label: 'Meticais (M-Pesa / e-Mola)' },
} as const;
export type BoostPayment = keyof typeof BOOST_PAYMENTS;
export const BOOST_PAYMENT_IDS = Object.keys(BOOST_PAYMENTS) as [BoostPayment, ...BoostPayment[]];

/** A etiqueta obrigatória (publicidade identificada), igual no feed e no mapa. */
export const SPONSORED_LABEL = 'Bombado · Patrocinado';

/** No feed: o primeiro destaque depois da 4.ª publicação e depois um a cada 11 (no máximo 1 em cada ~10–12). */
export const FEED_FIRST_SLOT = 3;
export const FEED_GAP = 11;
/** A mesma pessoa vê o mesmo destaque no feed no máximo 3 vezes em 24 horas. */
export const FEED_CAP_PER_DAY = 3;
/** No mapa, a mesma pessoa conta no máximo uma impressão por campanha a cada hora (o mapa refresca-se muitas vezes). */
export const MAP_VIEW_GAP_MINUTES = 60;
/** Até quantos dias à frente se pode agendar o início. */
export const MAX_START_DAYS_AHEAD = 30;
/** Uma campanha de um evento não pode acabar mais de 24 horas depois do fim do evento (seriam dias pagos sem nada para mostrar). */
export const EVENT_GRACE_HOURS = 24;

export const DAY_MS = 86_400_000;

export function boostPackage(id: string) {
  return BOOST_PACKAGES.find((p) => p.id === id) ?? null;
}

/** O preço de um pacote num raio (em km inteiros, 1 a 10). */
export function boostPrice(pkg: { price: number }, radiusKm: number): number {
  const extra = Math.max(0, Math.round(radiusKm) - BOOST_RADIUS.included);
  return Math.round((pkg.price * (1 + BOOST_RADIUS.extraPerKm * extra)) / 50) * 50;
}

/**
 * Devolução ao parar: os dias inteiros que ainda faltam (o dia que já começou conta como gasto), na proporção do preço.
 * Se a campanha ainda não começou, devolve-se tudo; se já acabou, nada.
 */
export function boostRefund(c: { price: number; days: number; startsAt: Date; endsAt: Date }, now: Date = new Date()): number {
  if (now.getTime() < c.startsAt.getTime()) return c.price;
  const left = c.endsAt.getTime() - now.getTime();
  if (left <= 0) return 0;
  const fullDays = Math.min(c.days, Math.floor(left / DAY_MS));
  return Math.floor((c.price * fullDays) / c.days);
}

/** As posições (contadas desde o início da sessão do feed) onde entra um destaque, numa página que começa em `start` e tem `len` publicações. */
export function feedSlotPositions(start: number, len: number): number[] {
  const out: number[] = [];
  let j = Math.max(0, Math.ceil((start - FEED_FIRST_SLOT) / FEED_GAP));
  for (let p = FEED_FIRST_SLOT + FEED_GAP * j; p < start + len; p = FEED_FIRST_SLOT + FEED_GAP * ++j) if (p >= start) out.push(p);
  return out;
}
