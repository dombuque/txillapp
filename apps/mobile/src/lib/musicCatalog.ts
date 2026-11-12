/**
 * Lógica do seletor de música (sem React): rótulos das licenças, que separadores mostrar, tirar as faixas de que não gosto
 * e o texto das contagens. O catálogo vem curado do servidor (docs/musica.md); aqui só se decide o que aparece.
 */

/** O mínimo de uma faixa que esta lógica precisa (compatível com `Track` de api.music). */
export interface TrackLike { id: string; kind?: string; uses?: number; featured?: boolean; artist?: string; artistUsername?: string }
export interface StyleLike { id: string; label: string; count: number }
export interface HomeLike<T extends TrackLike = TrackLike> { styles: StyleLike[]; trending: T[]; local: T[] | null; sounds: boolean; recent: T[] }

/** Como se lê a licença no crédito. */
export const licenseLabel = (l: string) =>
  l === 'own' ? 'Original'
    : l === 'cc0' ? 'CC0'
      : l === 'pdm' ? 'Domínio público'
        : l === 'txillapp' ? 'Artista no Txillapp'
          : `CC ${l.toUpperCase()}`;

/** Os separadores do seletor. `style:<id>` é uma pastilha de estilo. */
export type PickerTab = 'trending' | 'local' | 'sounds' | 'favorites' | 'search' | `style:${string}`;

/** «Em alta» sempre; «Artistas de Moçambique» só com faixas da fonte local; «Sons» só quando o servidor diz que há; «Favoritas» sempre. */
export function pickerTabs(home: Pick<HomeLike, 'local' | 'sounds'> | null | undefined): { id: PickerTab; label: string }[] {
  const out: { id: PickerTab; label: string }[] = [{ id: 'trending', label: 'Em alta no Txillapp' }];
  if (hasLocal(home)) out.push({ id: 'local', label: 'Artistas de Moçambique' });
  if (home?.sounds === true) out.push({ id: 'sounds', label: 'Sons' });
  out.push({ id: 'favorites', label: 'Favoritas' });
  return out;
}

/** A secção dos artistas de Moçambique só aparece quando a fonte local existe e tem faixas. */
export const hasLocal = (home: Pick<HomeLike, 'local'> | null | undefined) => Array.isArray(home?.local) && home!.local!.length > 0;

/** As pastilhas de estilo: só as que têm faixas, e o estilo sugerido pelo texto (se houver) primeiro. */
export function styleChips<S extends StyleLike>(styles: S[] | null | undefined, suggested?: string | null): S[] {
  const list = (styles ?? []).filter((s) => s.count > 0);
  if (!suggested) return list;
  const i = list.findIndex((s) => s.id === suggested);
  return i <= 0 ? list : [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

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

export const mmss = (ms: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}` : '');
