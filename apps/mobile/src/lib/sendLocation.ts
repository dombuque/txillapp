/**
 * A lógica da folha "Enviar localização" do chat (components/SendLocationSheet.tsx), como no WhatsApp: o texto da precisão,
 * as distâncias, o botão principal (a minha posição ou o pino arrastado), as durações da partilha em direto, o aviso da
 * permissão, a lista de "Sítios perto" e a mensagem que vai para o servidor. Nada se envia sem um toque em Enviar.
 * Sem imports da app: os testes (tests/sendLocation.test.mjs) correm-no direto no Node.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** A posição do aparelho, com a precisão em metros (null se o sistema não a disser). */
export interface Fix extends LatLng {
  accuracy: number | null;
}

/** Um sítio que se pode enviar: o ponto, o nome e a morada (a morada pode ainda não ser conhecida). */
export interface SpotChoice extends LatLng {
  name: string;
  address: string | null;
  kind?: string | null;
}

/** O que a pessoa escolheu enviar. */
export type LocationChoice =
  | { type: 'current'; fix: Fix }
  | { type: 'pin'; at: LatLng; address?: string | null }
  | { type: 'place'; place: SpotChoice }
  | { type: 'live'; fix: Fix; minutes: number };

/** A mensagem de localização (o corpo de POST /chat/with/:username e de POST /chat/groups/:id/messages). */
export interface LocationMessage {
  kind: 'location';
  lat: number;
  lng: number;
  name?: string;
  address?: string;
  liveMinutes?: 15 | 60 | 480;
}

/** As durações da partilha em direto que o servidor aceita (chat.controller.ts: 15, 60 ou 480 minutos). */
export const LIVE_DURATIONS = [
  { minutes: 15, label: '15 minutos' },
  { minutes: 60, label: '1 hora' },
  { minutes: 480, label: '8 horas' },
] as const;
export type LiveMinutes = (typeof LIVE_DURATIONS)[number]['minutes'];

/** Os limites do servidor para o nome e a morada do sítio. */
export const NAME_MAX = 80;
export const ADDRESS_MAX = 160;
/** Até onde o mapa se pode mexer (sem ser arrastado pela pessoa) e ainda contar como "a minha posição". */
export const SAME_SPOT_M = 8;
/** O início do mapa quando ainda não se sabe onde estou (Maputo). */
export const DEFAULT_CENTER: LatLng = { lat: -25.97, lng: 32.57 };

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clean = (s: unknown, max: number): string | null => {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max).trim() : '';
  return t || null;
};

/** Um ponto que existe (e não o 0,0 do meio do mar, que alguns serviços dão quando não sabem). */
export function validPoint(p: Partial<LatLng> | null | undefined): p is LatLng {
  return !!p && num(p.lat) && num(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);
}

/** A distância em metros entre dois pontos (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const km = (m: number) => {
  const k = m / 1000;
  // Sem toLocaleString (nem todos os motores de JS o têm completo): vírgula decimal à mão.
  return k < 9.95 ? `${(Math.round(k * 10) / 10).toFixed(1).replace('.', ',')} km` : `${Math.round(k)} km`;
};

/** "7 m", "850 m", "1,2 km", "15 km": a distância como se lê na lista. Até 10 m ao metro; depois às dezenas; de 1 km em diante em km. */
export function distanceText(m: number | null | undefined): string {
  if (!num(m) || m < 0) return '';
  if (m < 10) return `${Math.max(1, Math.round(m))} m`;
  if (m < 995) return `${Math.round(m / 10) * 10} m`;
  return km(m);
}

/** A precisão em texto curto: "12 m", "1,2 km"; null se não se souber. */
export function accuracyValue(m: number | null | undefined): string | null {
  if (!num(m) || m <= 0) return null;
  if (m < 1000) return `${Math.max(1, Math.round(m))} m`;
  return km(m);
}

/** "Precisão de 12 m" (por cima do mapa e por baixo de "Enviar a tua localização atual"). */
export function accuracyText(m: number | null | undefined): string {
  const v = accuracyValue(m);
  return v ? `Precisão de ${v}` : 'Precisão desconhecida';
}

/** A posição é fraca (mais de 100 m de erro): avisa-se que pode valer mais a pena escolher um sítio. */
export const weakAccuracy = (m: number | null | undefined) => num(m) && m > 100;

/** O mapa saiu da minha posição? (só conta a partir de alguns metros, para os arredondamentos do mapa não enganarem). */
export function movedAway(me: LatLng | null | undefined, center: LatLng | null | undefined, minM = SAME_SPOT_M): boolean {
  if (!validPoint(me) || !validPoint(center)) return false;
  return distanceM(me, center) > minM;
}

/** Em que estado está a folha (para o botão principal). */
export interface SheetState {
  /** A permissão da localização. */
  permission: 'granted' | 'ask' | 'denied' | 'blocked' | 'checking';
  /** A minha posição, quando já chegou. */
  fix: Fix | null;
  /** A pessoa arrastou o mapa (aparece o pino ao centro). */
  dragged: boolean;
  /** O centro do mapa (onde está o pino). */
  center: LatLng | null;
}

/** O botão principal da folha: o que faz, o texto e a linha por baixo. `action: null` = desligado. */
export interface MainButton {
  action: 'current' | 'pin' | null;
  label: string;
  sub: string;
}

/**
 * Decide o botão principal, como no WhatsApp: arrastado o mapa → "Enviar esta localização" (o ponto do pino);
 * senão "Enviar a tua localização atual" com a precisão, só depois de a posição chegar e com permissão.
 */
export function mainButton(s: SheetState): MainButton {
  if (s.dragged && validPoint(s.center)) {
    return { action: 'pin', label: 'Enviar esta localização', sub: 'O ponto do pino no mapa' };
  }
  if (s.permission !== 'granted') {
    const sub = s.permission === 'checking' ? 'A ver a autorização…' : 'Sem acesso à localização. Podes procurar um sítio ou arrastar o mapa.';
    return { action: null, label: 'Enviar a tua localização atual', sub };
  }
  if (!s.fix || !validPoint(s.fix)) return { action: null, label: 'Enviar a tua localização atual', sub: 'A procurar a tua posição…' };
  return { action: 'current', label: 'Enviar a tua localização atual', sub: accuracyText(s.fix.accuracy) };
}

/** O texto para os leitores de ecrã de "Enviar a tua localização atual (precisão de 12 m)". */
export function currentA11y(fix: Fix | null): string {
  const v = fix ? accuracyValue(fix.accuracy) : null;
  return `Enviar a tua localização atual${v ? ` (precisão de ${v})` : ''}`;
}

/** "durante 1 hora", para a confirmação e o rótulo da duração. */
export function liveLabel(minutes: number): string {
  return LIVE_DURATIONS.find((d) => d.minutes === minutes)?.label ?? `${minutes} minutos`;
}

/** Aceita só as durações do servidor (15, 60, 480); qualquer outra fica nos 60 minutos. */
export function liveMinutes(m: unknown): LiveMinutes {
  return (LIVE_DURATIONS.find((d) => d.minutes === m)?.minutes ?? 60) as LiveMinutes;
}

/**
 * A confirmação curta da partilha em direto: quem vê, durante quanto tempo e que se pode parar quando se quiser.
 * Na app a posição só se atualiza com o Txillapp aberto (não pedimos a localização em segundo plano): diz-se isso também.
 */
export function liveConfirmText(minutes: number, who?: string | null): string {
  const name = clean(who, 40);
  const whom = name ? name : 'A outra pessoa';
  return `${whom} vai ver a tua posição em tempo real durante ${liveLabel(minutes)}. A posição atualiza-se enquanto o Txillapp estiver aberto neste aparelho. Podes parar quando quiseres, na própria mensagem.`;
}

/** Porque é que a localização não está disponível e o que oferecer: pedir, abrir as definições (só na app) ou explicar o cadeado (site). */
export interface PermissionNotice {
  title: string;
  text: string;
  action: 'ask' | 'settings' | null;
  actionLabel: string | null;
}

/**
 * O aviso da permissão (explica antes de pedir). `ask`: ainda se pode perguntar → "Continuar" pede-a.
 * `denied` (recusada agora) e `blocked` (não se pode voltar a perguntar): na app "Abrir definições"; no site o cadeado.
 * null = há permissão (ou ainda se está a ver): não há aviso.
 */
export function permissionNotice(permission: SheetState['permission'], web: boolean): PermissionNotice | null {
  if (permission === 'granted' || permission === 'checking') return null;
  if (permission === 'ask') {
    return {
      title: 'Partilhar onde estás',
      text: 'Para mostrar onde estás e os sítios perto, o Txillapp precisa da tua localização. Só é enviada quando tocares em Enviar.',
      action: 'ask',
      actionLabel: 'Continuar',
    };
  }
  if (web) {
    return {
      title: 'Localização bloqueada neste browser',
      text: 'Toca no cadeado ao lado do endereço, em cima, e permite a Localização para este site. Depois volta a abrir esta folha. Entretanto, podes procurar um sítio.',
      action: null,
      actionLabel: null,
    };
  }
  if (permission === 'denied') {
    return {
      title: 'Sem acesso à localização',
      text: 'Sem autorização não consigo enviar onde estás. Podes procurar um sítio ou arrastar o mapa, ou autorizar nas definições.',
      action: 'settings',
      actionLabel: 'Abrir definições',
    };
  }
  return {
    title: 'Localização bloqueada',
    text: 'O Txillapp não tem autorização para usar a localização. Autoriza nas definições do telemóvel ou procura um sítio.',
    action: 'settings',
    actionLabel: 'Abrir definições',
  };
}

/** Um sítio da lista "Sítios perto" ou dos resultados da pesquisa, pronto a mostrar. */
export interface SpotRow extends SpotChoice {
  key: string;
  /** A distância a mim (ou ao centro do mapa), em metros; null se não houver ponto de partida. */
  distanceM: number | null;
  /** "120 m · Av. Marginal" (o que vai por baixo do nome). */
  sub: string;
}

/** Um sítio de `GET /places/nearby`. */
export interface NearbyPlace {
  name: string;
  kind: string;
  distanceM: number;
  lat: number;
  lng: number;
}
/** Uma sugestão de `GET /places/search`. */
export interface SearchHit {
  name: string;
  sub?: string | null;
  kind?: string | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  city?: string | null;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function joinSub(distance: number | null, address: string | null): string {
  return [distance == null ? '' : distanceText(distance), address ?? ''].filter(Boolean).join(' · ');
}

/**
 * "Sítios perto" (de /places/nearby): só os que têm nome e ponto válido, sem repetidos (o mesmo nome a menos de 50 m),
 * do mais perto para o mais longe. A distância conta-se a partir de `from` (a minha posição exata), não do ponto arredondado
 * que o servidor usou; sem `from`, fica a do servidor.
 */
export function nearbyRows(places: NearbyPlace[] | null | undefined, from: LatLng | null, area?: string | null): SpotRow[] {
  const out: SpotRow[] = [];
  for (const p of places ?? []) {
    const name = clean(p?.name, NAME_MAX);
    if (!name || !validPoint(p)) continue;
    if (out.some((o) => fold(o.name) === fold(name) && distanceM(o, p) < 50)) continue;
    const d = validPoint(from) ? distanceM(from, p) : num(p.distanceM) ? p.distanceM : null;
    const address = clean(area, ADDRESS_MAX);
    out.push({ key: `n:${name}:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`, name, address, kind: p.kind ?? null, lat: p.lat, lng: p.lng, distanceM: d, sub: joinSub(d, null) });
  }
  return out.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
}

/** A morada de uma sugestão: a morada, senão a rua/bairro ("sub"), com a cidade no fim se ainda não estiver lá. */
export function hitAddress(h: SearchHit): string | null {
  const a = clean(h.address, ADDRESS_MAX) ?? clean(h.sub, ADDRESS_MAX);
  const c = clean(h.city, 60);
  if (!a) return c;
  if (!c || a.split(',').some((x) => fold(x) === fold(c))) return a;
  return clean(`${a}, ${c}`, ADDRESS_MAX);
}

/** Os resultados de "Procurar um sítio": só os que trazem ponto (os outros não se podem enviar), com a distância a `from`. */
export function searchRows(hits: SearchHit[] | null | undefined, from: LatLng | null): SpotRow[] {
  const out: SpotRow[] = [];
  for (const h of hits ?? []) {
    const name = clean(h?.name, NAME_MAX);
    const at = { lat: h?.lat as number, lng: h?.lng as number };
    if (!name || !validPoint(at)) continue;
    const address = hitAddress(h);
    const d = validPoint(from) ? distanceM(from, at) : null;
    const key = `s:${name}:${at.lat.toFixed(5)},${at.lng.toFixed(5)}`;
    if (out.some((o) => o.key === key)) continue;
    out.push({ key, name, address, kind: h.kind ?? null, lat: at.lat, lng: at.lng, distanceM: d, sub: joinSub(d, address) });
  }
  return out;
}

/** O que se lê por baixo do nome no passo de confirmar um sítio. */
export function placeConfirmA11y(p: SpotChoice): string {
  return `Enviar ${p.name}${p.address ? `, ${p.address}` : ''}`;
}

/** As coordenadas como se escrevem (6 casas, ~10 cm), para quando o pino não tem morada. */
export function coordsText(p: LatLng): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}

/**
 * A mensagem que vai para o servidor. Só a escolha explícita entra: a posição atual (só o ponto), o pino (o ponto e a morada,
 * se já se souber), um sítio (o ponto, o nome e a morada) ou a partilha em direto (o ponto e a duração). Nos grupos não há
 * partilha em direto (`allowLive: false`): devolve null. Também null sem ponto válido.
 */
export function buildLocationMessage(choice: LocationChoice, opts: { allowLive?: boolean } = {}): LocationMessage | null {
  const round = (p: LatLng) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });
  switch (choice.type) {
    case 'current':
      return validPoint(choice.fix) ? { kind: 'location', ...round(choice.fix) } : null;
    case 'pin': {
      if (!validPoint(choice.at)) return null;
      const address = clean(choice.address, ADDRESS_MAX);
      return { kind: 'location', ...round(choice.at), ...(address ? { address } : null) };
    }
    case 'place': {
      const p = choice.place;
      if (!validPoint(p)) return null;
      const name = clean(p.name, NAME_MAX);
      const address = clean(p.address, ADDRESS_MAX);
      return { kind: 'location', ...round(p), ...(name ? { name } : null), ...(address ? { address } : null) };
    }
    case 'live':
      if (opts.allowLive === false || !validPoint(choice.fix)) return null;
      return { kind: 'location', ...round(choice.fix), liveMinutes: liveMinutes(choice.minutes) };
  }
}

/** A bolha de uma localização: o título (nome do sítio) e a linha de baixo (morada), ou o texto antigo / "Localização". */
export function bubbleLines(m: { body?: string | null; placeName?: string | null; placeAddress?: string | null; live?: boolean; liveUntil?: string | null }): { title: string; sub: string | null; named: boolean } {
  const name = clean(m.placeName, NAME_MAX);
  const address = clean(m.placeAddress, ADDRESS_MAX);
  if (name) return { title: name, sub: address, named: true };
  if (address) return { title: address, sub: null, named: true };
  const body = clean(m.body, NAME_MAX);
  if (m.liveUntil) return { title: body ?? 'Localização em direto', sub: null, named: false };
  return { title: body ?? 'Localização', sub: null, named: false };
}
