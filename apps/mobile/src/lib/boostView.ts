// Bombar (destaques pagos dos locais): regras e textos que não dependem do React (onde entra cada destaque no feed,
// a posição que vai para o servidor, preços, estados e o relatório). Sem dependências: tests/boostView.test.mjs.

export type BoostPackageId = '1d' | '3d' | '7d';
export type BoostState = 'scheduled' | 'active' | 'ended' | 'stopped' | 'suspended' | 'pending';

/** A etiqueta obrigatória (publicidade identificada). O servidor manda a mesma em cada destaque. */
export const SPONSORED_LABEL = 'Bombado · Patrocinado';

/** O que o leitor de ecrã diz antes do cartão: a etiqueta e quem paga. */
export function sponsoredA11y(venueName: string, label: string = SPONSORED_LABEL): string {
  return `${label.replace(' · ', ', ')}. Publicidade de ${venueName}.`;
}

/** Um destaque do feed, como vem do servidor (GET /feed?lat&lng → `sponsored`). */
export interface SponsoredSlotLike {
  campaignId: string;
  afterId: string | null;
}

/** Os destaques de todas as páginas, arrumados pela publicação depois da qual entram (null = antes de tudo). Sem repetir campanhas. */
export function slotsByAnchor<S extends SponsoredSlotLike>(pages: { sponsored?: S[] }[]): Map<string | null, S[]> {
  const out = new Map<string | null, S[]>();
  const seen = new Set<string>();
  for (const p of pages)
    for (const s of p.sponsored ?? []) {
      if (seen.has(s.campaignId)) continue;
      seen.add(s.campaignId);
      const k = s.afterId ?? null;
      out.set(k, [...(out.get(k) ?? []), s]);
    }
  return out;
}

/** Cidades com o centro (as mesmas do "À tua volta"). */
export interface CityLike {
  name: string;
  lat: number;
  lng: number;
}

/**
 * A posição que vai com o feed para escolher os destaques: a do "À tua volta". `saved` é o que ficou guardado nesse ecrã
 * ('gps' ou o nome da cidade escolhida). Com 'gps', só se usa a posição do aparelho se já houver autorização
 * (`device`, nunca se pergunta por causa disto). Sai sempre com 2 casas decimais (~1 km).
 */
export function feedNear(saved: string | null, cities: CityLike[], device: { lat: number; lng: number } | null): { lat: number; lng: number } | null {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const city = saved && saved !== 'gps' ? cities.find((c) => c.name === saved) : undefined;
  if (city) return { lat: r2(city.lat), lng: r2(city.lng) };
  if (saved === 'gps' && device && Number.isFinite(device.lat) && Number.isFinite(device.lng)) return { lat: r2(device.lat), lng: r2(device.lng) };
  return null;
}

/** "1 500 Txills". */
export function txills(n: number): string {
  return `${Math.round(n).toLocaleString('pt-PT')} Txills`;
}

/** O preço do pacote num raio (o servidor manda a tabela; sem ela, nada). */
export function priceFor(packages: { id: string; prices: Record<string | number, number> }[], id: string, radiusKm: number): number | null {
  const p = packages.find((x) => x.id === id);
  const v = p?.prices[radiusKm] ?? p?.prices[String(radiusKm)];
  return typeof v === 'number' ? v : null;
}

export const STATE_LABEL: Record<BoostState, string> = {
  scheduled: 'Agendada',
  active: 'A bombar',
  ended: 'Terminada',
  stopped: 'Parada',
  suspended: 'Suspensa pela equipa',
  pending: 'À espera da equipa',
};

/** O texto do que se devolve ao parar (a mesma regra do servidor: os dias inteiros que faltam; tudo se ainda não começou). */
export function refundPreview(c: { price: number; days: number; startsAt: string; endsAt: string }, now: Date = new Date()): number {
  const s = Date.parse(c.startsAt);
  const e = Date.parse(c.endsAt);
  if (now.getTime() < s) return c.price;
  const left = e - now.getTime();
  if (left <= 0) return 0;
  return Math.floor((c.price * Math.min(c.days, Math.floor(left / 86_400_000))) / c.days);
}

export interface BoostReportLike {
  impressions: number;
  people: number;
  taps: number;
  interested: number | null;
  cheers: number | null;
  checkins: number;
  checkinsAfterSeeing: number;
}

/** As linhas do relatório (só totais). */
export function reportLines(r: BoostReportLike): { label: string; value: number }[] {
  const out = [
    { label: 'Vezes mostrado', value: r.impressions },
    { label: 'Pessoas', value: r.people },
    { label: 'Toques', value: r.taps },
  ];
  if (r.interested != null) out.push({ label: '"Tenho interesse"', value: r.interested });
  if (r.cheers != null) out.push({ label: 'Brindes', value: r.cheers });
  out.push({ label: 'Check-ins', value: r.checkins }, { label: 'Check-ins de quem viu', value: r.checkinsAfterSeeing });
  return out;
}

/** "12 nov, 21:00". */
export function shortWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const MO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${d.getDate()} ${MO[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Os destaques no mapa vão para o topo da lista; entre eles (e entre os outros) fica a ordem por distância. */
export function boostedFirst<T extends { distanceKm: number; boosted?: boolean }>(xs: T[]): T[] {
  const byDist = [...xs].sort((a, b) => a.distanceKm - b.distanceKm);
  return [...byDist.filter((x) => x.boosted), ...byDist.filter((x) => !x.boosted)];
}
