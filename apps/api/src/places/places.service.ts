import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

export interface NearbyPlace {
  name: string;
  kind: string;
  distanceM: number;
  /** Posição do sítio (dado público do OpenStreetMap) para o mapa. */
  lat: number;
  lng: number;
}
export interface PlaceHit {
  name: string;
  sub: string;
  kind: string;
}
export interface NearbyPlaces {
  area: string | null;
  city: string | null;
  places: NearbyPlace[];
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const USER_AGENT = process.env.GEO_USER_AGENT ?? 'TxillappMVP/0.1';

/** ~110 m: suficiente para sugerir sítios, sem precisão de GPS. As coordenadas nunca são guardadas nem registadas. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function distanceM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function kindOf(tags: Record<string, string>): string {
  if (tags.natural === 'beach') return 'praia';
  if (tags.amenity === 'bar' || tags.amenity === 'pub' || tags.amenity === 'nightclub') return 'bar';
  if (tags.amenity) return 'restaurante';
  if (tags.leisure) return 'lazer';
  if (tags.tourism) return 'turismo';
  return 'local';
}

@Injectable()
export class PlacesService {
  constructor(@Optional() @Inject(PG_POOL) private readonly pool?: Pool) {}

  /**
   * Sítios "a bater": os que mais aparecem em publicações públicas nas últimas 48 h.
   * Só contam contas públicas e ativas; devolve o nome e quantas publicações, nada de quem publicou.
   */
  async hot(): Promise<{ name: string; posts: number }[]> {
    if (!this.pool) return [];
    const { rows } = await this.pool.query(
      `SELECT min(p.location_label) AS name, count(*)::int AS posts
         FROM content.posts p JOIN identity.users u ON u.id = p.author_id AND p.removed_at IS NULL
        WHERE p.kind = 'post' AND p.location_label IS NOT NULL AND u.status = 'active' AND NOT u.is_private
          AND p.created_at > now() - interval '48 hours'
        GROUP BY lower(trim(p.location_label))
        ORDER BY posts DESC, max(p.created_at) DESC LIMIT 8`,
    );
    return rows;
  }
  private readonly cache = new Map<string, { exp: number; value: NearbyPlaces }>();

  async nearby(lat: number, lng: number): Promise<NearbyPlaces> {
    const rlat = round3(lat);
    const rlng = round3(lng);
    const key = `${rlat},${rlng}`;
    const hit = this.cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;

    const [area, places] = await Promise.all([
      this.reverse(rlat, rlng).catch(() => ({ area: null, city: null })),
      this.pois(rlat, rlng).catch(() => [] as NearbyPlace[]),
    ]);
    const value: NearbyPlaces = { ...area, places };
    if (area.area || area.city || places.length) {
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { exp: Date.now() + CACHE_TTL_MS, value });
    }
    return value;
  }

  private readonly searchCache = new Map<string, { exp: number; value: PlaceHit[] }>();

  /** Pesquisa por nome (Photon, feito para sugestões ao escrever). Só nomes saem daqui; nada é guardado. */
  async search(text: string, lat?: number, lng?: number): Promise<PlaceHit[]> {
    const near = lat != null && lng != null ? `&lat=${round3(lat)}&lon=${round3(lng)}` : '';
    const key = `${text.toLowerCase()}|${near}`;
    const hit = this.searchCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;

    const base = process.env.GEO_SEARCH_URL ?? 'https://photon.komoot.io/api/';
    const data = await this.get(`${base}?q=${encodeURIComponent(text)}&limit=7&lang=en${near}`).catch(() => ({ features: [] }));
    const seen = new Set<string>();
    const out: PlaceHit[] = [];
    for (const f of data.features ?? []) {
      const p: Record<string, string> = f.properties ?? {};
      const name = p.name ?? p.street;
      if (!name) continue;
      const sub = [p.district ?? p.locality, p.city ?? p.county, p.state, p.country].filter((x, i, a) => x && a.indexOf(x) === i && x !== name).slice(0, 3).join(', ');
      const id = `${name}|${sub}`.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ name, sub, kind: kindOf({ [p.osm_key ?? '']: p.osm_value ?? '' }) });
    }
    if (out.length) {
      if (this.searchCache.size >= CACHE_MAX) this.searchCache.delete(this.searchCache.keys().next().value!);
      this.searchCache.set(key, { exp: Date.now() + CACHE_TTL_MS, value: out });
    }
    return out;
  }

  private async get(url: string, init: RequestInit = {}): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init.headers },
      });
      if (!res.ok) throw new Error(`geo ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private async reverse(lat: number, lng: number) {
    const url = `${NOMINATIM}?format=jsonv2&zoom=16&addressdetails=1&accept-language=pt&lat=${lat.toFixed(3)}&lon=${lng.toFixed(3)}`;
    const a: Record<string, string> = (await this.get(url)).address ?? {};
    return {
      area: a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? a.village ?? a.hamlet ?? null,
      city: a.city ?? a.town ?? a.municipality ?? a.county ?? null,
    };
  }

  private async pois(lat: number, lng: number): Promise<NearbyPlace[]> {
    const p = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const q =
      `[out:json][timeout:8];(` +
      `nwr(around:700,${p})["name"]["amenity"~"^(bar|pub|restaurant|cafe|nightclub|fast_food|ice_cream|marketplace)$"];` +
      `nwr(around:700,${p})["name"]["leisure"~"^(beach_resort|park|stadium|sports_centre|marina)$"];` +
      `nwr(around:1500,${p})["name"]["natural"="beach"];` +
      `nwr(around:700,${p})["name"]["tourism"~"^(hotel|attraction|viewpoint|guest_house|museum)$"];` +
      `);out center 40;`;
    const data = await this.get(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(q)}`,
    });
    const seen = new Set<string>();
    const out: NearbyPlace[] = [];
    for (const el of data.elements ?? []) {
      const name: string | undefined = el.tags?.name;
      const elat = el.lat ?? el.center?.lat;
      const elng = el.lon ?? el.center?.lon;
      if (!name || elat == null || elng == null || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, kind: kindOf(el.tags), distanceM: distanceM(lat, lng, elat, elng), lat: elat, lng: elng });
    }
    return out.sort((x, y) => x.distanceM - y.distanceM).slice(0, 8);
  }
}
