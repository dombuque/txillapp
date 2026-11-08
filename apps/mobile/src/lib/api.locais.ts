import { post, raw, type Post } from '@/lib/api';

export type VenueKind = 'bar' | 'restaurante' | 'discoteca' | 'cafe' | 'hotel' | 'evento' | 'outro';
export type ManagerRole = 'admin' | 'editor';
/** O que eu sou nesta página: dono, administrador, editor ou nada. */
export type VenueRole = 'owner' | ManagerRole | null;

/** A página de um local (bar, restaurante, discoteca…), como as páginas do Facebook. */
export interface Venue {
  id: string;
  slug: string;
  name: string;
  kind: VenueKind;
  city: string | null;
  about: string | null;
  address: string | null;
  hours: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  verified: boolean;
  lat: number | null;
  lng: number | null;
  checkins: number;
  checkinsToday: number;
  followers: number;
  posts: number;
  following: boolean;
  role: VenueRole;
  /** Dono ou gestor ativo. */
  mine: boolean;
  canEdit: boolean;
  canPost: boolean;
  /** Convite por aceitar para gerir esta página. */
  invite: ManagerRole | null;
  /** Só os gestores o recebem (para imprimir o QR). */
  qrToken?: string;
  checkedIn: boolean;
  owner?: { username: string; displayName: string };
  createdAt: string;
}

export interface VenueManager { username: string; displayName: string; hasAvatar: boolean; role: 'owner' | ManagerRole; status: 'pending' | 'active'; since?: string }
export interface VenueInsights {
  followers: number; followersWeek: number; checkins: number; checkinsWeek: number; peopleMonth: number;
  posts: number; cheers: number; comments: number; mentions: number; days: { day: string; checkins: number }[];
}
export interface VenueProfileInput {
  name?: string; kind?: VenueKind; city?: string | null; about?: string | null; address?: string | null; hours?: string | null;
  phone?: string | null; whatsapp?: string | null; website?: string | null; lat?: number | null; lng?: number | null;
  avatarMediaId?: string | null; coverMediaId?: string | null;
}

export interface PlacePage { label: string; mode: 'at' | 'near'; hasNear: boolean; center: { lat: number; lng: number } | null; items: Post[]; nextCursor: string | null }

export const KIND_LABEL: Record<string, string> = { bar: 'Bar', restaurante: 'Restaurante', discoteca: 'Discoteca', cafe: 'Café', hotel: 'Hotel', evento: 'Evento', outro: 'Outro' };
export const KINDS = ['bar', 'restaurante', 'discoteca', 'cafe', 'hotel', 'evento', 'outro'] as const;
export const ROLE_LABEL: Record<'owner' | ManagerRole, string> = { owner: 'Dono', admin: 'Administrador', editor: 'Editor' };

const s = (slug: string) => encodeURIComponent(slug);

export const locaisApi = {
  venue: (slug: string): Promise<Venue> => raw(`/venues/${s(slug)}`),
  findVenue: (name: string): Promise<Venue | null> => raw(`/venues/find?name=${encodeURIComponent(name)}`),
  myVenues: (): Promise<Venue[]> => raw('/venues/mine'),
  myInvites: (): Promise<Venue[]> => raw('/venues/invites'),
  searchVenues: (q: string): Promise<Venue[]> => raw(`/venues/search?q=${encodeURIComponent(q)}`),
  discover: (at?: { lat: number; lng: number } | null): Promise<{ nearby: Venue[]; popular: Venue[] }> => raw(`/venues/discover${at ? `?lat=${at.lat}&lng=${at.lng}` : ''}`),
  createVenue: (b: VenueProfileInput & { name: string; kind: VenueKind }): Promise<Venue> => raw('/venues', post(b)),
  updateVenue: (slug: string, b: VenueProfileInput): Promise<Venue> => raw(`/venues/${s(slug)}`, { method: 'PATCH', body: JSON.stringify(b) }),
  venuePosts: (slug: string, cursor?: string): Promise<{ items: Post[]; nextCursor: string | null }> => raw(`/venues/${s(slug)}/posts${cursor ? `?cursor=${cursor}` : ''}`),
  followVenue: (slug: string, on: boolean): Promise<Venue> => raw(`/venues/${s(slug)}/follow`, { method: on ? 'PUT' : 'DELETE' }),
  managers: (slug: string): Promise<VenueManager[]> => raw(`/venues/${s(slug)}/managers`),
  invite: (slug: string, username: string, role: ManagerRole): Promise<VenueManager[]> => raw(`/venues/${s(slug)}/managers`, post({ username, role })),
  answerInvite: (slug: string, accept: boolean): Promise<Venue> => raw(`/venues/${s(slug)}/managers/${accept ? 'accept' : 'decline'}`, post({})),
  setRole: (slug: string, username: string, role: ManagerRole): Promise<VenueManager[]> => raw(`/venues/${s(slug)}/managers/${encodeURIComponent(username)}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeManager: (slug: string, username: string): Promise<VenueManager[] | { left: true }> => raw(`/venues/${s(slug)}/managers/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  insights: (slug: string): Promise<VenueInsights> => raw(`/venues/${s(slug)}/insights`),
  venueCheckin: (slug: string, token: string): Promise<Venue> => raw(`/venues/${s(slug)}/checkin`, post({ token })),
  rotateVenueQr: (slug: string): Promise<Venue> => raw(`/venues/${s(slug)}/qr/rotate`, post({})),
  placePosts: (label: string, mode: 'at' | 'near', cursor?: string): Promise<PlacePage> =>
    raw(`/feed/place?label=${encodeURIComponent(label)}&mode=${mode}${cursor ? `&cursor=${cursor}` : ''}`),
};
