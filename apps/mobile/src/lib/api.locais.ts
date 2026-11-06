import { post, raw, type Post } from '@/lib/api';

export interface Venue {
  id: string;
  slug: string;
  name: string;
  kind: 'bar' | 'restaurante' | 'discoteca' | 'cafe' | 'hotel' | 'evento' | 'outro';
  city: string | null;
  about: string | null;
  verified: boolean;
  lat: number | null;
  lng: number | null;
  checkins: number;
  checkinsToday: number;
  mine: boolean;
  /** Só o dono o recebe. */
  qrToken?: string;
  checkedIn: boolean;
}

export interface PlacePage { label: string; mode: 'at' | 'near'; hasNear: boolean; center: { lat: number; lng: number } | null; items: Post[]; nextCursor: string | null }

export const KIND_LABEL: Record<string, string> = { bar: 'Bar', restaurante: 'Restaurante', discoteca: 'Discoteca', cafe: 'Café', hotel: 'Hotel', evento: 'Evento', outro: 'Outro' };
export const KINDS = ['bar', 'restaurante', 'discoteca', 'cafe', 'hotel', 'evento', 'outro'] as const;

export const locaisApi = {
  venue: (slug: string): Promise<Venue> => raw(`/venues/${encodeURIComponent(slug)}`),
  findVenue: (name: string): Promise<Venue | null> => raw(`/venues/find?name=${encodeURIComponent(name)}`),
  myVenues: (): Promise<Venue[]> => raw('/venues/mine'),
  createVenue: (b: { name: string; kind: string; city?: string; about?: string }): Promise<Venue> => raw('/venues', post(b)),
  venueCheckin: (slug: string, token: string): Promise<Venue> => raw(`/venues/${encodeURIComponent(slug)}/checkin`, post({ token })),
  rotateVenueQr: (slug: string): Promise<Venue> => raw(`/venues/${encodeURIComponent(slug)}/qr/rotate`, post({})),
  placePosts: (label: string, mode: 'at' | 'near', cursor?: string): Promise<PlacePage> =>
    raw(`/feed/place?label=${encodeURIComponent(label)}&mode=${mode}${cursor ? `&cursor=${cursor}` : ''}`),
};
