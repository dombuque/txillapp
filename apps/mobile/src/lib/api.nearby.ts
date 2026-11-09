/** "À tua volta": o que há perto (locais, eventos, publicações, TxillGroups e malta) e os eventos dos locais. */
import { post, raw } from '@/lib/api';

export type NearbyKind = 'venues' | 'events' | 'posts' | 'groups' | 'people';
export type NearbyWhen = 'now' | 'today' | 'week';
export type NearbyVisibility = 'off' | 'mutual' | 'following';

export interface NearbyVenue { slug: string; name: string; kind: string; avatarUrl: string | null; verified: boolean; acceptsTxills?: boolean; lat: number; lng: number; distanceKm: number; checkinsToday: number; followers: number }
export interface NearbyEvent { id: string; title: string; startsAt: string; endsAt: string | null; coverUrl: string | null; venue: { slug: string; name: string; lat: number; lng: number }; distanceKm: number; interested: number }
export interface NearbyPost { id: string; code: string; thumbUrl: string | null; kind: 'photo' | 'video'; locationLabel: string | null; lat: number; lng: number; distanceKm: number; createdAt: string; author: { username: string; displayName: string } }
export interface NearbyGroup { id: string; name: string; kind: string; coverUrl: string | null; destination: string | null; startsOn: string | null; lat: number; lng: number; distanceKm: number; members: number; /** Se o servidor já disser se estou no grupo. */ isMember?: boolean }
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

export interface PlaceHit { type: 'venue' | 'event'; id: string; slug?: string; name: string; lat: number; lng: number; distanceKm?: number }

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
  places: (q: string, lat: number, lng: number): Promise<PlaceHit[]> =>
    raw(`/nearby/places?${new URLSearchParams({ q, lat: String(round2(lat)), lng: String(round2(lng)) }).toString()}`),

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

/** Abrir o caminho até um sítio na app de mapas do telemóvel (Apple Maps no iPhone, Google Maps no resto). */
export function directionsUrl(lat: number, lng: number, label: string, ios: boolean): string {
  const q = encodeURIComponent(label);
  return ios ? `https://maps.apple.com/?daddr=${lat},${lng}&q=${q}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** "a 1,2 km" / "a 300 m". */
export const kmLabel = (km: number) => (km < 1 ? `a ${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `a ${km.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} km`);

const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** "Hoje · 21:00", "Amanhã · 18:30", "sáb, 14 nov · 22:00". */
export function eventWhen(startsAt: string, endsAt?: string | null): string {
  const d = new Date(startsAt);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  const e = endsAt ? new Date(endsAt) : null;
  const live = e && d.getTime() <= now.getTime() && now.getTime() <= e.getTime();
  const head = live ? 'A decorrer' : diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : `${WD[d.getDay()]}, ${d.getDate()} ${MO[d.getMonth()]}`;
  return `${head} · ${hm(d)}${e && !isNaN(e.getTime()) ? ` até ${hm(e)}` : ''}`;
}
