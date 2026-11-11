/** "À tua volta": o que há perto (locais, eventos, publicações, TxillGroups e malta) e os eventos dos locais. */
import { post, raw } from '@/lib/api';
import { clearOnSignOut, type NearbyKind, type NearbyWhen } from '@/lib/nearbyView';

export type { NearbyKind, NearbyWhen } from '@/lib/nearbyView';
// Os textos das distâncias e das datas dos eventos vivem em nearbyView (testados em Node); ficam aqui para quem já os importava.
export { eventWhen, kmLabel } from '@/lib/nearbyView';
export type NearbyVisibility = 'off' | 'mutual' | 'following';

/** Destaque pago (Bombar): o pino fica realçado e no topo da lista, com a etiqueta "Patrocinado". */
export interface NearbyBoost { campaignId: string; label: string }
export interface NearbyVenue { slug: string; name: string; kind: string; avatarUrl: string | null; verified: boolean; acceptsTxills?: boolean; lat: number; lng: number; distanceKm: number; checkinsToday: number; followers: number; boosted?: NearbyBoost | null }
export interface NearbyEvent { id: string; title: string; startsAt: string; endsAt: string | null; coverUrl: string | null; venue: { slug: string; name: string; lat: number; lng: number }; distanceKm: number; interested: number; boosted?: NearbyBoost | null }
export interface NearbyPost { id: string; code: string; thumbUrl: string | null; kind: 'photo' | 'video'; locationLabel: string | null; lat: number; lng: number; distanceKm: number; createdAt: string; author: { username: string; displayName: string } }
export interface NearbyGroup { id: string; name: string; kind: string; coverUrl: string | null; destination: string | null; startsOn: string | null; lat: number; lng: number; distanceKm: number; members: number; /** Se o servidor já disser se estou no grupo. */ isMember?: boolean; /** Foto de perfil do grupo. */ avatarUrl?: string | null; visibility?: 'private' | 'public'; /** 'open' = entra logo; 'request' = pede e um administrador aprova. */ joinMode?: 'open' | 'request'; /** Onde aparece no mapa ("Costa do Sol", ou o local do Plano). */ placeLabel?: string | null }
/** Malta à volta: a posição vem arredondada pelo servidor (célula de ~1,5 km), nunca a exata. */
export interface NearbyPerson { username: string; displayName: string; hasAvatar: boolean; lat: number; lng: number; ago: string; approxKm: number }

export interface NearbyResult {
  center: { lat: number; lng: number };
  radiusKm: number;
  venues: NearbyVenue[];
  events: NearbyEvent[];
  posts: NearbyPost[];
  groups: NearbyGroup[];
  people?: NearbyPerson[];
}

export interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  coverUrl: string | null;
  /** O local pode não ter coordenadas (então não há "Ir até lá"). */
  venue: { slug: string; name: string; avatarUrl: string | null; verified: boolean; lat: number | null; lng: number | null; acceptsTxills?: boolean };
  interested: number;
  imInterested: boolean;
  cancelled?: boolean;
  /** Dono ou gestor ativo do local. */
  canManage?: boolean;
}
/** Os próximos eventos de um local vêm no mesmo formato que o detalhe. */
export type VenueEvent = EventDetail;
export interface NewEvent { venueSlug: string; title: string; description?: string; startsAt: string; endsAt?: string; coverMediaId?: string }

/** A localização sai daqui só com 2 casas decimais (~1 km), mesmo antes de chegar ao servidor. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

const put = (b: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(b) });

export const nearbyApi = {
  around: (p: { lat: number; lng: number; radiusKm: number; kinds: NearbyKind[]; when: NearbyWhen }): Promise<NearbyResult> => {
    const q = new URLSearchParams({ lat: String(round2(p.lat)), lng: String(round2(p.lng)), radiusKm: String(p.radiusKm), kinds: p.kinds.join(','), when: p.when });
    return raw(`/nearby?${q.toString()}`);
  },
  // (GET /nearby/places, a pesquisa da caixa do mapa, existe no servidor e devolve { venues, events }; a app não a usa.)

  settings: (): Promise<{ visibility: NearbyVisibility; canEnable?: boolean }> => raw('/nearby/settings'),
  setSettings: (visibility: NearbyVisibility): Promise<{ visibility: NearbyVisibility }> => raw('/nearby/settings', put({ visibility })),
  /** Só com o ecrã aberto e visível (nunca em segundo plano), no máximo uma vez por minuto. */
  presence: (lat: number, lng: number): Promise<void> => raw('/nearby/presence', post({ lat: round2(lat), lng: round2(lng) })),
  clearPresence: (): Promise<void> => raw('/nearby/presence', { method: 'DELETE' }),

  event: (id: string): Promise<EventDetail> => raw(`/events/${encodeURIComponent(id)}`),
  setInterest: (id: string, on: boolean): Promise<{ interested?: number; imInterested?: boolean } | void> =>
    raw(`/events/${encodeURIComponent(id)}/interest`, { method: on ? 'PUT' : 'DELETE' }),
  createEvent: (b: NewEvent): Promise<{ id: string }> => raw('/events', post(b)),
  // O servidor devolve { items }: desembrulha aqui para os ecrãs receberem a lista.
  venueEvents: async (slug: string): Promise<VenueEvent[]> => ((await raw(`/venues-events/${encodeURIComponent(slug)}`)) as { items?: VenueEvent[] }).items ?? [],
};

/** Ao terminar sessão: tira-me do mapa da malta, sem prender a saída (ver nearbyView.clearOnSignOut). */
export const leaveMapOnSignOut = () => clearOnSignOut(() => nearbyApi.clearPresence());

/** Abrir o caminho até um sítio na app de mapas do telemóvel (Apple Maps no iPhone, Google Maps no resto). */
export function directionsUrl(lat: number, lng: number, label: string, ios: boolean): string {
  const q = encodeURIComponent(label);
  return ios ? `https://maps.apple.com/?daddr=${lat},${lng}&q=${q}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
