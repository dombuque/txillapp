import { Injectable } from '@nestjs/common';

export interface NearbyPlace {
  name: string;
  kind: string;
  distanceM: number;
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
      out.push({ name, kind: kindOf(el.tags), distanceM: distanceM(lat, lng, elat, elng) });
    }
    return out.sort((x, y) => x.distanceM - y.distanceM).slice(0, 8);
  }
}
