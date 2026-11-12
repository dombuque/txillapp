/**
 * Lógica do seletor de música (sem React): os separadores («Para ti», «Em alta», «Sons originais», «Guardadas»), o que vai
 * para os destaques e para «Para ti», tirar as faixas de que não gosto, guardar, o texto das contagens e os rótulos das
 * licenças. O catálogo vem curado do servidor (docs/musica.md); aqui só se decide o que aparece e como.
 */

/** O mínimo de uma faixa que esta lógica precisa (compatível com `Track` de api.music). */
export interface TrackLike {
  id: string;
  kind?: string;
  source?: string;
  uses?: number;
  usesTotal?: number;
  featured?: boolean;
  artist?: string;
  artistUsername?: string | null;
  styles?: string[];
  durationMs?: number | null;
  coverColors?: [string, string] | null;
}
export interface StyleLike { id: string; label: string; count: number }
export interface HomeLike<T extends TrackLike = TrackLike> { styles: StyleLike[]; trending: T[]; local: T[] | null; sounds: boolean; recent: T[] }

/** Como se lê a licença no crédito. */
export const licenseLabel = (l: string) =>
  l === 'own' ? 'Original'
    : l === 'cc0' ? 'CC0'
      : l === 'pdm' ? 'Domínio público'
        : l === 'txillapp' ? 'Artista no Txillapp'
          : `CC ${l.toUpperCase()}`;

/**
 * Os separadores do seletor (as pastilhas de cima):
 * - `forYou` «Para ti»: os destaques e o que combina com o estilo sugerido pelo texto e com as guardadas;
 * - `trending` «Em alta»: o «Em alta no Txillapp» do servidor;
 * - `sounds` «Sons originais»: os sons do catálogo;
 * - `saved` «Guardadas»: as favoritas.
 */
export type PickerTab = 'forYou' | 'trending' | 'sounds' | 'saved';
export const PICKER_TABS: readonly { id: PickerTab; label: string }[] = [
  { id: 'forYou', label: 'Para ti' },
  { id: 'trending', label: 'Em alta' },
  { id: 'sounds', label: 'Sons originais' },
  { id: 'saved', label: 'Guardadas' },
];
/** Os quatro separadores, sempre pela mesma ordem (o que muda é o que há dentro de cada um). */
export const pickerTabs = () => PICKER_TABS;

/** A secção dos artistas de Moçambique só aparece quando a fonte local existe e tem faixas. */
export const hasLocal = (home: Pick<HomeLike, 'local'> | null | undefined) => Array.isArray(home?.local) && home!.local!.length > 0;

/** As pastilhas de estilo: só as que têm faixas, e o estilo sugerido pelo texto (se houver) primeiro. */
export function styleChips<S extends StyleLike>(styles: S[] | null | undefined, suggested?: string | null): S[] {
  const list = (styles ?? []).filter((s) => s.count > 0);
  if (!suggested) return list;
  const i = list.findIndex((s) => s.id === suggested);
  return i <= 0 ? list : [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

/** O filtro de «Para ti» (as pastilhas pequenas): nenhum, os artistas de Moçambique ou um estilo. */
export type ForYouFilter = null | 'local' | `style:${string}`;

/**
 * As pastilhas pequenas dentro de «Para ti»: «Artistas de Moçambique» primeiro (só onde a licença deixa e quando há faixas
 * locais), depois os estilos com faixas, com o sugerido pelo texto à frente.
 */
export function forYouChips(home: Pick<HomeLike, 'local' | 'styles'> | null | undefined, allowLocal: boolean, suggested?: string | null): { id: Exclude<ForYouFilter, null>; label: string }[] {
  const out: { id: Exclude<ForYouFilter, null>; label: string }[] = [];
  if (allowLocal && hasLocal(home)) out.push({ id: 'local', label: 'Artistas de Moçambique' });
  for (const s of styleChips(home?.styles, suggested)) out.push({ id: `style:${s.id}`, label: s.label });
  return out;
}

/**
 * O cartão de destaques de «Para ti» (desliza entre eles): as destacadas pela equipa, depois até duas dos artistas de
 * Moçambique (onde a licença deixa) e, se ainda houver poucas, as primeiras de «Em alta». Até `max`, sem repetir.
 */
export function highlights<T extends TrackLike>(home: HomeLike<T> | null | undefined, allowLocal: boolean, max = 5): T[] {
  if (!home) return [];
  const out: T[] = [];
  const add = (t: T) => { if (out.length < max && !out.some((x) => x.id === t.id) && (allowLocal || t.source !== 'local')) out.push(t); };
  for (const t of home.trending) if (t.featured) add(t);
  if (allowLocal) for (const t of (home.local ?? []).slice(0, 2)) add(t);
  for (const t of home.trending) if (out.length < 3) add(t);
  return out;
}

/** Os estilos das guardadas, do que mais aparece para o que menos. */
export function savedStyles(saved: TrackLike[] | null | undefined): string[] {
  const n = new Map<string, number>();
  for (const t of saved ?? []) for (const s of t.styles ?? []) n.set(s, (n.get(s) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

/** O estilo que «Para ti» vai buscar: o sugerido pelo texto do post; sem sugestão, o mais frequente nas guardadas. */
export const forYouStyle = (suggested: string | null | undefined, saved: TrackLike[] | null | undefined): string | null => suggested || savedStyles(saved)[0] || null;

/**
 * A lista de «Para ti» (por baixo dos destaques): primeiro as do estilo sugerido (ou das guardadas), depois as de «Em alta»
 * que são dos estilos das guardadas, as que usei há pouco e o resto de «Em alta». Sem repetir e sem as que já estão nos
 * destaques.
 */
export function forYouList<T extends TrackLike>(o: { styleTracks?: T[] | null; trending?: T[] | null; recent?: T[] | null; saved?: TrackLike[] | null; skip?: readonly T[] }, max = 40): T[] {
  const skip = new Set((o.skip ?? []).map((t) => t.id));
  const seen = new Set<string>();
  const out: T[] = [];
  const add = (t: T) => {
    if (out.length >= max || skip.has(t.id) || seen.has(t.id)) return;
    seen.add(t.id);
    out.push(t);
  };
  const liked = new Set(savedStyles(o.saved));
  const trending = o.trending ?? [];
  for (const t of o.styleTracks ?? []) add(t);
  for (const t of trending) if ((t.styles ?? []).some((s) => liked.has(s))) add(t);
  for (const t of o.recent ?? []) add(t);
  for (const t of trending) add(t);
  return out;
}

/** As faixas dos artistas de Moçambique só vão em mimos e tchekas (é o que a licença autoriza): fora disso saem de todas as listas. */
export const onlyAllowed = <T extends TrackLike>(list: T[], allowLocal: boolean): T[] => (allowLocal ? list : list.filter((t) => t.source !== 'local'));

/** Tira as faixas que marquei com «Não gosto desta». */
export const withoutDisliked = <T extends TrackLike>(list: T[] | null | undefined, disliked: ReadonlySet<string>): T[] => (list ?? []).filter((t) => !disliked.has(t.id));

/** Tira uma faixa de qualquer lista do seletor guardada em cache (listas soltas ou o início `home`). */
export function dropFromCache<T>(data: T, id: string): T {
  if (Array.isArray(data)) return data.filter((t: TrackLike) => t?.id !== id) as T;
  if (data && typeof data === 'object' && 'trending' in data) {
    const h = data as unknown as HomeLike;
    return { ...h, trending: h.trending.filter((t) => t.id !== id), recent: (h.recent ?? []).filter((t) => t.id !== id), local: h.local ? h.local.filter((t) => t.id !== id) : h.local } as T;
  }
  return data;
}

// ---------------------------------------------------------------- guardar («Guardadas»)

/**
 * Que faixas se podem guardar: os clipes próprios não, e as dos artistas de Moçambique também não (o servidor só guarda
 * faixas do catálogo aberto).
 */
export const canSave = (t: TrackLike) => t.kind !== 'clip' && t.source !== 'local';

/** Guardar ou tirar das guardadas (muda logo no ecrã; o servidor confirma): a guardada nova vai para o topo. */
export function toggleSaved<T extends TrackLike>(saved: T[] | null | undefined, t: T): T[] {
  const list = saved ?? [];
  return list.some((x) => x.id === t.id) ? list.filter((x) => x.id !== t.id) : [t, ...list];
}

// ---------------------------------------------------------------- números e textos

/**
 * Números curtos à portuguesa: 950, 1 mil, 1,2 mil, 12,5 mil, 125 mil, 1 M, 4,4 M. Arredonda para baixo (nunca se mostra
 * mais do que há) e tira o «,0».
 */
export function compactCount(n: number | null | undefined): string {
  const v = Math.max(0, Math.floor(n ?? 0));
  // Contas em inteiros (2900 / 1000 × 10 dava 28,999… e mostrava «2,8 mil»).
  const fmt = (unit: number, decimals: number) => {
    const k = 10 ** decimals;
    return String(Math.floor(v / (unit / k)) / k).replace('.', ',');
  };
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${fmt(1000, v < 100_000 ? 1 : 0)} mil`;
  return `${fmt(1_000_000, v < 100_000_000 ? 1 : 0)} M`;
}

/** «1 uso», «12 usos», «1,2 mil usos» (nada para 0 ou sem número). */
export function usesText(n: number | null | undefined): string {
  if (!n || n < 1) return '';
  return n === 1 ? '1 uso' : `${compactCount(n)} usos`;
}

/** "usada 12 vezes esta semana" (nada para 0 ou sem número). */
export function usesLabel(n: number | null | undefined): string {
  if (!n || n < 1) return '';
  return n === 1 ? 'usada 1 vez esta semana' : `usada ${n} vezes esta semana`;
}

/** O crédito por baixo do título: artista (com o @ na fonte local), duração. */
export function creditLine(t: TrackLike & { durationMs?: number | null }, mmss: (ms: number | null) => string): string {
  const who = t.artistUsername ? `${t.artist || t.artistUsername} · @${t.artistUsername}` : t.artist || 'Autor desconhecido';
  const d = t.durationMs ? mmss(t.durationMs) : '';
  return d ? `${who} · ${d}` : who;
}

/** A linha cinzenta por baixo do título no seletor: «Artista · 1,2 mil usos · 2:53» (os usos desde sempre, quando os há). */
export function rowMeta(t: TrackLike): string {
  const who = t.artist || (t.artistUsername ? `@${t.artistUsername}` : '') || (t.kind === 'sound' ? 'Som' : 'Autor desconhecido');
  return [who, usesText(t.usesTotal ?? t.uses), t.durationMs ? mmss(t.durationMs) : ''].filter(Boolean).join(' · ');
}

export const mmss = (ms: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}` : '');

/** O gradiente da marca, para os destaques sem capa (ou sem as cores da capa). */
export const BRAND_GRADIENT: readonly [string, string] = ['#d6334f', '#5b1430'];

/** As cores do fundo de um destaque: as da capa (vêm do servidor) ou o gradiente da marca. */
export function highlightColors(t: TrackLike): readonly [string, string] {
  const c = t.coverColors;
  return Array.isArray(c) && c.length === 2 && c.every((x) => /^#[0-9a-f]{6}$/i.test(x)) ? [c[0], c[1]] : BRAND_GRADIENT;
}
