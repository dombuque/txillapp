/** Bombar: os locais destacam um evento ou uma publicação no feed e no mapa, pagando com os Txills da carteira do local. */
import { post, raw, type Post } from '@/lib/api';
import type { EventDetail } from '@/lib/api.nearby';
import type { BoostPackageId, BoostReportLike, BoostState } from '@/lib/boostView';
import { CITIES } from '@/lib/cities';
import { feedNear } from '@/lib/boostView';
import { devicePosition } from '@/lib/devicePosition';
import { kvGet } from '@/lib/kv';

export interface BoostOptions {
  canBoost: boolean;
  /** Porque é que ainda não dá para bombar (local por aprovar, fora do mapa, sem posição). */
  blocker: string | null;
  balance: number;
  label: string;
  payments: { id: 'txills' | 'mzn'; label: string; enabled: boolean }[];
  radius: { min: number; max: number; included: number; extraPerKm: number; default: number };
  packages: { id: BoostPackageId; days: number; label: string; basePrice: number; prices: Record<string, number> }[];
  targets: {
    events: { id: string; title: string; startsAt: string; endsAt: string | null }[];
    posts: { id: string; code: string; body: string; createdAt: string; thumbUrl: string | null }[];
  };
}

export interface BoostCampaign {
  id: string;
  state: BoostState;
  target: { kind: 'event'; id: string; title: string } | { kind: 'post'; id: string; code: string | null; title: string };
  package: BoostPackageId;
  days: number;
  radiusKm: number;
  startsAt: string;
  endsAt: string;
  stoppedAt: string | null;
  /** 'iap': paga na App Store ou no Google Play (o preço em Txills fica a 0 e parar não devolve nada). */
  payment: 'txills' | 'mzn' | 'iap';
  price: number;
  refunded: number;
  review: 'auto' | 'staff';
  note: string | null;
  createdAt: string;
  label: string;
  report: BoostReportLike & { feedImpressions: number; mapImpressions: number };
}

/** Um destaque no feed (GET /feed?lat&lng → `sponsored`): entra depois da publicação `afterId`. */
export interface SponsoredSlot {
  campaignId: string;
  afterId: string | null;
  label: string;
  kind: 'post' | 'event';
  venue: { slug: string; name: string; avatarUrl: string | null; verified: boolean };
  post: (Post & { sponsored?: true }) | null;
  event: EventDetail | null;
}

const s = (slug: string) => encodeURIComponent(slug);

export const boostsApi = {
  options: (slug: string): Promise<BoostOptions> => raw(`/boosts/venue/${s(slug)}/options`),
  list: (slug: string): Promise<{ balance: number; active: BoostCampaign[]; past: BoostCampaign[] }> => raw(`/boosts/venue/${s(slug)}`),
  /** A mesma `idempotencyKey` nunca cobra duas vezes. Com `source: 'iap'` não cobra nada: fica em rascunho até o verify da loja. */
  create: (slug: string, b: { target: { kind: 'event' | 'post'; id: string }; package: BoostPackageId; radiusKm: number; startsAt?: string; payment?: 'txills'; /** Pago pela loja (App Store / Google Play): cria a campanha em rascunho, ativada pelo verify. */ source?: 'iap'; /** O produto da loja do pacote. */ pack?: string; idempotencyKey: string }): Promise<{ campaign: BoostCampaign; balance: number; replayed: boolean }> =>
    raw(`/boosts/venue/${s(slug)}`, { ...post(b), headers: { 'Idempotency-Key': b.idempotencyKey } }),
  stop: (id: string): Promise<{ campaign: BoostCampaign; refunded: number }> => raw(`/boosts/${id}/stop`, post({})),
  /** Quem vê tocou no destaque (o servidor conta; nada de analytics na app). */
  tap: (id: string, surface: 'feed' | 'map'): Promise<void> => raw(`/boosts/${id}/tap`, post({ surface })),
  /** "Não mostrar destaques deste local". */
  hide: (id: string): Promise<void> => raw(`/boosts/${id}/hide`, post({})),
};

/** O que ficou guardado no "À tua volta" (ver perto.tsx): 'gps' ou o nome da cidade. */
const PLACE_KEY = 'txill.perto.place';
let cached: { at: number; value: { lat: number; lng: number } | null } | null = null;

/**
 * A posição aproximada que vai com o feed (só para escolher os destaques; o servidor não a guarda): a do "À tua volta"
 * (a cidade escolhida, ou o GPS se já tiver autorização; nunca se pede por causa disto). Fica 5 minutos em memória.
 */
export async function feedPosition(): Promise<{ lat: number; lng: number } | null> {
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;
  const saved = await kvGet(PLACE_KEY);
  const device = saved === 'gps' ? await devicePosition(false) : null;
  const value = feedNear(saved, CITIES, device);
  cached = { at: Date.now(), value };
  return value;
}
