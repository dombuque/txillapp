import { raw, post } from '@/lib/api';
import { musicPayload, type Track } from '@/lib/api.music';
import type { PlaceReverse, PlaceSuggestion } from '@/lib/placeField';

export interface NearbyPlaces { area: string | null; city: string | null; places: { name: string; kind: string; distanceM: number; lat: number; lng: number }[] }
export interface PhotoTag { username: string; displayName: string; x: number; y: number }

/** Sítios e publicação completa (com música, ponto do sítio e pessoas identificadas): igual ao `api` do site. */
export const composeApi = {
  nearbyPlaces: (lat: number, lng: number): Promise<NearbyPlaces> => raw(`/places/nearby?lat=${lat}&lng=${lng}`),
  hotPlaces: (): Promise<{ name: string; posts: number }[]> => raw('/places/hot'),
  searchPlaces: (q: string, at?: { lat: number; lng: number }): Promise<PlaceSuggestion[]> =>
    raw(`/places/search?q=${encodeURIComponent(q)}${at ? `&lat=${at.lat}&lng=${at.lng}` : ''}`),
  /** A morada e a cidade de um ponto (o pino arrastado no mapa ou a minha posição). */
  reversePlace: (lat: number, lng: number): Promise<PlaceReverse> => raw(`/places/reverse?lat=${lat}&lng=${lng}`),
  mentionable: (q: string): Promise<{ username: string; displayName: string; hasAvatar: boolean; following: boolean; verified?: boolean }[]> => raw(`/mentionable?q=${encodeURIComponent(q)}`),
  createPost: (b: { body: string; music?: Track | null; locationLabel?: string; locationLat?: number; locationLng?: number; locationCoarse?: boolean; mediaIds: string[]; tags?: { index: number; username: string; x: number; y: number }[]; /** Publicar como um local que giro. */ venueId?: string | null }) =>
    raw('/posts', post({ ...b, music: musicPayload(b.music) })),
};
