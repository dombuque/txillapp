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
  /** Posição do sítio (dado público do OpenStreetMap, via Photon), para o pôr no mapa. */
  lat: number;
  lng: number;
  /** Rua e número, quando houver (ex. "Av. Julius Nyerere 123"). */
  address: string | null;
  city: string | null;
}
/** O que está num ponto do mapa (arrastar o pino ou usar a localização atual). */
export interface ReversePlace {
  name: string | null;
  address: string | null;
  city: string | null;
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
/** ~11 m: o reverso precisa de chegar à rua; continua sem precisão de GPS e nunca é guardado nem registado. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
/** Sem a posição de quem procura, a pesquisa puxa para Moçambique (centro aproximado do país, raio largo). */
const MZ_BIAS = '&lat=-18.7&lon=35.5&zoom=5&location_bias_scale=0.5';
const SEARCH_LIMIT = 7;

const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
/** "Rua 123" (ou só a rua); sem rua, nada. */
const streetLine = (street: unknown, number: unknown) => {
  const st = str(street);
  return st ? [st, str(number)].filter(Boolean).join(' ') : null;
};
const validCoord = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

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

  /**
   * Pesquisa por nome (Photon, feito para sugestões ao escrever): nome, posição do sítio, rua e cidade. Nada é guardado.
   * Com a posição de quem procura (arredondada a ~110 m) o Photon privilegia o que está perto. Sem ela, puxa para
   * Moçambique (viés de posição no centro do país) e, entre os resultados, os de Moçambique vêm primeiro.
   * Resultados sem posição válida ficam de fora.
   */
  async search(text: string, lat?: number, lng?: number): Promise<PlaceHit[]> {
    const hasNear = lat != null && lng != null;
    const near = hasNear ? `&lat=${round3(lat)}&lon=${round3(lng)}` : MZ_BIAS;
    const key = `${text.toLowerCase()}|${near}`;
    const hit = this.searchCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;

    const base = process.env.GEO_SEARCH_URL ?? 'https://photon.komoot.io/api/';
    // Sem posição pede-se um pouco mais, para haver por onde escolher os de Moçambique.
    const ask = hasNear ? SEARCH_LIMIT : SEARCH_LIMIT + 3;
    const data = await this.get(`${base}?q=${encodeURIComponent(text)}&limit=${ask}&lang=en${near}`).catch(() => ({ features: [] }));
    const seen = new Set<string>();
    const found: (PlaceHit & { mz: boolean })[] = [];
    for (const f of data.features ?? []) {
      const p: Record<string, string> = f.properties ?? {};
      // O Photon dá a posição em GeoJSON: [lng, lat].
      const [flng, flat] = (Array.isArray(f.geometry?.coordinates) ? f.geometry.coordinates : []) as unknown[];
      if (!validCoord(flat, flng)) continue;
      const name = p.name ?? p.street;
      if (!name) continue;
      const sub = [p.district ?? p.locality, p.city ?? p.county, p.state, p.country].filter((x, i, a) => x && a.indexOf(x) === i && x !== name).slice(0, 3).join(', ');
      const id = `${name}|${sub}`.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      found.push({
        name,
        sub,
        kind: kindOf({ [p.osm_key ?? '']: p.osm_value ?? '' }),
        lat: flat as number,
        lng: flng as number,
        address: streetLine(p.street, p.housenumber),
        city: str(p.city) ?? (p.type === 'city' ? str(p.name) : null),
        mz: String(p.countrycode ?? '').toUpperCase() === 'MZ',
      });
    }
    // Ordenação estável: sem posição, os de Moçambique sobem (mantendo entre eles a ordem do Photon).
    const ordered = hasNear ? found : [...found.filter((x) => x.mz), ...found.filter((x) => !x.mz)];
    const out: PlaceHit[] = ordered.slice(0, SEARCH_LIMIT).map(({ mz: _mz, ...h }) => h);
    if (out.length) {
      if (this.searchCache.size >= CACHE_MAX) this.searchCache.delete(this.searchCache.keys().next().value!);
      this.searchCache.set(key, { exp: Date.now() + CACHE_TTL_MS, value: out });
    }
    return out;
  }

  private readonly reverseCache = new Map<string, { exp: number; value: ReversePlace }>();

  /**
   * O que está num ponto (Nominatim): o nome do sítio (se o ponto cair num), rua e número, e a cidade. A posição é
   * arredondada a ~11 m antes de sair e não é guardada nem registada. Se o serviço falhar, vem tudo a null.
   */
  async reverseAddress(lat: number, lng: number): Promise<ReversePlace> {
    const rlat = round4(lat);
    const rlng = round4(lng);
    const key = `${rlat},${rlng}`;
    const hit = this.reverseCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;
    const url = `${NOMINATIM}?format=jsonv2&zoom=18&addressdetails=1&accept-language=pt&lat=${rlat.toFixed(4)}&lon=${rlng.toFixed(4)}`;
    const data = await this.get(url).catch(() => null);
    const a: Record<string, string> = data?.address ?? {};
    const road = str(a.road ?? a.pedestrian ?? a.footway);
    const name = str(data?.name);
    const value: ReversePlace = {
      // O nome só se for de um sítio (não repete a rua).
      name: name && name !== road ? name : null,
      address: streetLine(road, a.house_number),
      city: str(a.city ?? a.town ?? a.municipality ?? a.village ?? a.county),
    };
    if (value.name || value.address || value.city) {
      if (this.reverseCache.size >= CACHE_MAX) this.reverseCache.delete(this.reverseCache.keys().next().value!);
      this.reverseCache.set(key, { exp: Date.now() + CACHE_TTL_MS, value });
    }
    return value;
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
