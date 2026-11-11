/**
 * A lógica do campo "Procurar o sítio…" (components/PlaceField.tsx) e do sítio dos locais: quando procurar, que estado mostrar,
 * como escrever a morada, o que mandar ao servidor e quando avisar que um local ainda não está no mapa.
 * Sem imports da app: os testes (tests/placeField.test.mjs) correm-no direto no Node.
 */

/** O sítio escolhido: o ponto exato, a morada e a cidade (o nome só quando veio de uma sugestão). */
export interface PlaceValue {
  name?: string | null;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
}

/** Uma sugestão de `GET /places/search` (os campos novos podem não vir num servidor antigo). */
export interface PlaceSuggestion {
  name: string;
  sub: string;
  kind: string;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  city?: string | null;
}

/** A resposta de `GET /places/reverse`. */
export interface PlaceReverse {
  name: string | null;
  address: string | null;
  city: string | null;
}

/** Pausa na escrita antes de procurar e o mínimo de letras. */
export const SEARCH_DELAY_MS = 350;
export const SEARCH_MIN_CHARS = 2;
export const ADDRESS_MAX = 160;
export const CITY_MAX = 60;

/** O texto que vale a pena procurar (aparado e com espaços seguidos juntos), ou '' se ainda for curto de mais. */
export function searchQuery(text: string | null | undefined): string {
  const q = String(text ?? '').replace(/\s+/g, ' ').trim();
  return q.length >= SEARCH_MIN_CHARS ? q : '';
}

/**
 * Um adiamento simples: `push(v)` volta a contar do zero e só chama `fire(v)` depois de `ms` sem nada novo;
 * `cancel()` esquece o que estava à espera. Os temporizadores podem ser trocados (testes).
 */
export function createDebounce<T>(
  fire: (v: T) => void,
  ms = SEARCH_DELAY_MS,
  timers: { set: (f: () => void, ms: number) => unknown; clear: (h: unknown) => void } = {
    set: (f, t) => setTimeout(f, t),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
) {
  let h: unknown = null;
  return {
    push(v: T) {
      if (h != null) timers.clear(h);
      h = timers.set(() => {
        h = null;
        fire(v);
      }, ms);
    },
    cancel() {
      if (h != null) timers.clear(h);
      h = null;
    },
    get pending() {
      return h != null;
    },
  };
}

export type SearchStatus = 'idle' | 'waiting' | 'loading' | 'error' | 'empty' | 'results';

/**
 * O que a lista de sugestões mostra:
 * idle (nada escrito ou curto de mais) · waiting (a escrever, ainda na pausa) · loading · error · empty ("Não encontrei.") · results.
 */
export function searchStatus(s: { text: string; debounced: string; loading: boolean; error: boolean; count: number }): SearchStatus {
  const q = searchQuery(s.text);
  if (!q) return 'idle';
  if (searchQuery(s.debounced) !== q) return s.count > 0 ? 'results' : 'waiting';
  if (s.loading) return s.count > 0 ? 'results' : 'loading';
  if (s.error) return 'error';
  return s.count > 0 ? 'results' : 'empty';
}

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
/** Um ponto que existe (e não o 0,0 do meio do mar, que é o "sem sítio" de alguns serviços). */
export function validPoint(lat: unknown, lng: unknown): boolean {
  return num(lat) && num(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

const clean = (s: unknown, max: number): string | null => {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max).trim() : '';
  return t || null;
};

/** A sugestão escolhida como sítio; null se não trouxer coordenadas (servidor antigo): aí marca-se no mapa. */
export function suggestionToValue(h: PlaceSuggestion): PlaceValue | null {
  if (!validPoint(h.lat, h.lng)) return null;
  const name = clean(h.name, 120);
  // Sem morada própria, o "sub" da sugestão (rua, bairro) serve de morada; a cidade não se repete.
  const city = clean(h.city, CITY_MAX);
  let address = clean(h.address, ADDRESS_MAX) ?? clean(h.sub, ADDRESS_MAX);
  if (address && city && sameText(address, city)) address = null;
  return { name, address, city, lat: h.lat as number, lng: h.lng as number };
}

/** O reverse não soube nada (o serviço falhou: vem tudo a null). */
export const reverseEmpty = (rev: PlaceReverse | null | undefined) => !rev || (!clean(rev.address, ADDRESS_MAX) && !clean(rev.city, CITY_MAX));

/**
 * O ponto mudou (arrastado no mapa ou a minha posição) e chegou a morada desse ponto: o nome fica, a morada e a cidade mudam.
 * Se o reverse não soube nada, o pino muda e a morada que havia fica (escreve-se à mão em "Corrigir a morada").
 */
export function applyReverse(prev: PlaceValue, at: { lat: number; lng: number }, rev: PlaceReverse | null): PlaceValue {
  if (!rev || reverseEmpty(rev)) return { ...prev, lat: at.lat, lng: at.lng };
  return {
    name: prev.name ?? null,
    address: clean(rev.address, ADDRESS_MAX),
    city: clean(rev.city, CITY_MAX) ?? prev.city,
    lat: at.lat,
    lng: at.lng,
  };
}

/** A distância em metros entre dois pontos (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Até onde se pode mexer o pino sem perder o nome da sugestão ("Bar do Ponto" continua a ser o Bar do Ponto). */
export const KEEP_NAME_M = 300;

/** O ponto mudou: o nome fica se for perto do anterior; longe já é outro sítio e fica sem nome até chegar a morada. */
export function movedValue(prev: PlaceValue | null, at: { lat: number; lng: number }): PlaceValue {
  if (!prev) return pointValue(at);
  const near = distanceM(prev, at) <= KEEP_NAME_M;
  return { name: near ? (prev.name ?? null) : null, address: near ? prev.address : null, city: prev.city, lat: at.lat, lng: at.lng };
}

/** Um ponto novo, sem nada mais (marcado no mapa sem pesquisar), antes de a morada chegar. */
export function pointValue(at: { lat: number; lng: number }, name?: string | null): PlaceValue {
  return { name: clean(name, 120), address: null, city: null, lat: at.lat, lng: at.lng };
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const sameText = (a: string, b: string) => fold(a) === fold(b);

/** "Av. Marginal 141, Maputo": morada e cidade juntas, sem a cidade repetida se a morada já acabar nela. */
export function formatAddress(p: { address?: string | null; city?: string | null } | null | undefined): string {
  if (!p) return '';
  const a = clean(p.address, ADDRESS_MAX);
  const c = clean(p.city, CITY_MAX);
  if (!a) return c ?? '';
  if (!c) return a;
  const parts = a.split(',').map((x) => x.trim());
  return parts.some((x) => sameText(x, c)) ? a : `${a}, ${c}`;
}

/** O título do sítio escolhido: o nome, senão a morada, senão "Ponto marcado no mapa". */
export function placeTitle(p: PlaceValue): string {
  return clean(p.name, 120) ?? clean(p.address, ADDRESS_MAX) ?? clean(p.city, CITY_MAX) ?? 'Ponto marcado no mapa';
}

/** A linha por baixo do título (o que ainda não está no título). */
export function placeSubtitle(p: PlaceValue): string {
  const name = clean(p.name, 120);
  if (name) return formatAddress(p);
  if (clean(p.address, ADDRESS_MAX)) return clean(p.city, CITY_MAX) ?? '';
  return '';
}

/** O texto para os leitores de ecrã: "Sítio escolhido: Bar do Ponto, Av. Marginal 141, Maputo." */
export function placeA11y(p: PlaceValue): string {
  const sub = placeSubtitle(p);
  return `Sítio escolhido: ${placeTitle(p)}${sub ? `, ${sub}` : ''}.`;
}

/** O sítio que o local já tem (para o campo de editar): só com coordenadas; sem elas o campo começa vazio. */
export function venuePlace(v: { lat?: number | null; lng?: number | null; address?: string | null; city?: string | null } | null | undefined): PlaceValue | null {
  if (!v || !validPoint(v.lat, v.lng)) return null;
  return { name: null, address: clean(v.address, ADDRESS_MAX), city: clean(v.city, CITY_MAX), lat: v.lat as number, lng: v.lng as number };
}

/** O local ainda não tem ponto no mapa: aviso no topo de Gerir ("Este local ainda não está no mapa. Marca onde fica."). */
export function needsMapPin(v: { lat?: number | null; lng?: number | null } | null | undefined): boolean {
  return !!v && !validPoint(v.lat, v.lng);
}

/** Por omissão o local aparece no mapa (servidor antigo sem o campo = sim). */
export const showsOnMap = (v: { showOnMap?: boolean | null } | null | undefined) => v?.showOnMap !== false;

/**
 * O que vai para POST /venues e PATCH /venues/:slug. Sem sítio escolhido (ou com um ponto que não existe, como o 0,0) não manda
 * morada nem coordenadas (ficam como estão); `lat` e `lng` vão sempre os dois juntos. `showOnMap` só vai se vier (só o dono e
 * os administradores o podem mudar: aos editores o servidor diz que não).
 */
export function venuePlaceBody(p: PlaceValue | null, showOnMap?: boolean): { address?: string | null; city?: string | null; lat?: number; lng?: number; showOnMap?: boolean } {
  const show = showOnMap === undefined ? {} : { showOnMap };
  if (!p || !validPoint(p.lat, p.lng)) return show;
  return { address: clean(p.address, ADDRESS_MAX), city: clean(p.city, CITY_MAX), lat: round6(p.lat), lng: round6(p.lng), ...show };
}

/** Quem pode mudar "Mostrar no mapa": o dono e os administradores do local. */
export const canSetShowOnMap = (role: string | null | undefined) => role === 'owner' || role === 'admin';

/** "Como chegar" pela morada em texto (local escondido do mapa: quem não gere não recebe as coordenadas). */
export function directionsByAddress(address: string, ios: boolean): string {
  const q = encodeURIComponent(address);
  return ios ? `https://maps.apple.com/?daddr=${q}` : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

/** ~10 cm chegam: não se manda o número todo da posição do aparelho. */
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
/** A posição do aparelho só vai para a pesquisa arredondada (~1 km), para ordenar as sugestões por perto. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * O aviso por baixo de "Onde fica?" ao criar um local, ou null:
 * sem sítio (escreveu e não escolheu, ou nem escreveu) e com o local escondido do mapa.
 */
export function createPlaceWarning(p: PlaceValue | null, typed: string, showOnMap: boolean): string | null {
  if (p) return showOnMap ? null : 'O local fica fora do mapa do À tua volta. Quem abre a página vê na mesma a morada.';
  if (searchQuery(typed)) return 'Escolhe uma sugestão ou marca no mapa: sem isso o local não aparece no mapa do À tua volta. Podes marcar depois em Gerir.';
  return 'Ainda não disseste onde fica: o local não aparece no mapa do À tua volta. Podes marcar depois em Gerir.';
}

/** O ícone de cada tipo de sugestão (os nomes dos ícones Tx). */
export type PlaceKindIcon = 'waves' | 'cheers' | 'utensils' | 'trees' | 'camera' | 'map-pin' | 'store' | 'city' | 'home';
export function placeKindIcon(kind: string | null | undefined): PlaceKindIcon {
  switch (kind) {
    case 'praia': return 'waves';
    case 'bar': return 'cheers';
    case 'restaurante': return 'utensils';
    case 'lazer': return 'trees';
    case 'turismo': return 'camera';
    case 'venue': case 'local-txill': return 'store';
    case 'cidade': case 'city': return 'city';
    case 'bairro': case 'rua': case 'morada': return 'home';
    default: return 'map-pin';
  }
}
