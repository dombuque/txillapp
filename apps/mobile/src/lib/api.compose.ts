import { raw, post } from '@/lib/api';
import { musicPayload, type Track } from '@/lib/api.music';

export interface NearbyPlaces { area: string | null; city: string | null; places: { name: string; kind: string; distanceM: number; lat: number; lng: number }[] }
export interface PhotoTag { username: string; displayName: string; x: number; y: number }

/** Sítios e publicação completa (com música, ponto do sítio e pessoas identificadas): igual ao `api` do site. */
export const composeApi = {
  nearbyPlaces: (lat: number, lng: number): Promise<NearbyPlaces> => raw(`/places/nearby?lat=${lat}&lng=${lng}`),
  hotPlaces: (): Promise<{ name: string; posts: number }[]> => raw('/places/hot'),
  searchPlaces: (q: string, at?: { lat: number; lng: number }): Promise<{ name: string; sub: string; kind: string }[]> =>
    raw(`/places/search?q=${encodeURIComponent(q)}${at ? `&lat=${at.lat}&lng=${at.lng}` : ''}`),
  mentionable: (q: string): Promise<{ username: string; displayName: string; hasAvatar: boolean; following: boolean; verified?: boolean }[]> => raw(`/mentionable?q=${encodeURIComponent(q)}`),
  createPost: (b: { body: string; music?: Track | null; locationLabel?: string; locationLat?: number; locationLng?: number; locationCoarse?: boolean; mediaIds: string[]; tags?: { index: number; username: string; x: number; y: number }[] }) =>
    raw('/posts', post({ ...b, music: musicPayload(b.music) })),
};
