/**
 * As contas do ecrã de ver tchekas (sem React, para os testes em node): o som da tcheka (o letreiro e o disco), o tempo
 * da barra de progresso, o menu de segurar, a velocidade e os separadores «Para ti» / «A seguir».
 */

/**
 * O som de uma tcheka, como a API o manda (`post.sound`, docs/sons.md): `{ id, title, kind, author?, artist? }`. O id é o
 * uuid do som original, `cat:<faixa>` ou `local:<uuid>`. `author` é a pessoa (o autor do som original ou a conta do artista);
 * `artist` é o crédito das faixas. Aceita-se também `author` como texto e `cover` (versões antigas da app e testes).
 */
export interface ReelSound {
  id: string;
  title: string;
  kind: 'original' | 'catalog' | 'local';
  author?: string | { username?: string | null; displayName?: string | null; name?: string | null } | null;
  artist?: string | null;
  cover?: string | null;
}

/** A música que já vinha na publicação (antes do `sound`): só os campos que usamos aqui. */
export interface ReelMusic {
  id: string;
  title: string;
  artist?: string | null;
  cover?: string | null;
  kind?: 'clip' | 'music' | 'sound';
  /** Fonte da faixa (`local`: artistas de Moçambique) e, num som original guardado na música, o id do som. */
  source?: string | null;
  soundId?: string | null;
}

export interface ReelSoundSource {
  sound?: ReelSound | null;
  music?: ReelMusic | null;
  author: { username: string };
  /** O som que a tcheka usava foi tirado (docs/sons.md): 'author' ou 'rights'. */
  soundRemoved?: string | null;
}

/** O que o ecrã mostra do som: o letreiro, a capa do disco e para onde vai o toque. */
export interface SoundView {
  /** «Som original · @ana» ou «Título · Artista» (sem o ♪, que é desenhado à parte). */
  label: string;
  /** Capa do disco (endereço); sem ela o disco mostra o avatar de quem fez o som original, ou uma nota. */
  cover: string | null;
  /** O @ de quem fez o som original (para o avatar no disco). */
  originalBy: string | null;
  /** `/som/<id>`: a página do som; null quando não há página (clipe próprio, som que já não existe para quem vê). */
  href: string | null;
}

const clean = (s: string | null | undefined) => (s ?? '').trim();

/** O @ de quem fez o som (ou o nome do artista), venha o `author` como texto ou como pessoa. */
function authorOf(a: ReelSound['author']): { username: string; name: string } {
  if (!a) return { username: '', name: '' };
  if (typeof a === 'string') return { username: '', name: clean(a) };
  return { username: clean(a.username).replace(/^@/, ''), name: clean(a.displayName) || clean(a.name) };
}

/**
 * O id do som de uma faixa guardada na publicação, com as regras de `soundIdOfTrack` (lib/sounds.ts): catálogo
 * `cat:<id>`, artistas `local:<uuid>`. Clipes próprios e sons originais (sem `sound` na publicação, ou seja, que já não
 * existem para quem vê) não têm página. Repetido aqui para o ficheiro não ter imports (testes em node).
 */
export function musicSoundId(m: ReelMusic | null | undefined): string | null {
  if (!m || !m.id || m.kind === 'clip' || m.kind === 'sound') return null;
  const id = m.source === 'local' && !m.id.startsWith('local:') ? `local:${m.id}` : m.id;
  const out = id.startsWith('local:') ? id : `cat:${id}`;
  if (out.length > 90 || out.startsWith('cat:local:')) return null;
  return /^local:[0-9a-f-]{36}$/.test(out) || /^cat:[\w.:-]{1,80}$/.test(out) ? out : null;
}

/**
 * O som a mostrar numa tcheka. Primeiro o `sound` (da equipa dos sons); se a API não o mandar (tchekas antigas, ou o
 * som já não existe para quem vê), a música da publicação (`music`). Sem nenhum dos dois devolve null: não há letreiro nem
 * disco.
 */
export function reelSound(p: ReelSoundSource): SoundView | null {
  const s = p.sound;
  const m = p.music;
  if (s && s.id) {
    const by = authorOf(s.author);
    if (s.kind === 'original') {
      const who = by.username || p.author.username;
      return { label: `Som original · @${who}`, cover: s.cover ?? null, originalBy: who, href: soundHref(s.id) };
    }
    const artist = clean(s.artist) || by.name || (by.username ? `@${by.username}` : '');
    const title = clean(s.title) || 'Som';
    // A capa da faixa vem na música da publicação (o `sound` não a traz).
    return { label: artist ? `${title} · ${artist}` : title, cover: s.cover ?? m?.cover ?? null, originalBy: null, href: soundHref(s.id) };
  }
  if (m && m.id) {
    // Um clipe próprio (a pessoa gravou o som) é o som original de quem publicou.
    if (m.kind === 'clip') return { label: `Som original · @${p.author.username}`, cover: m.cover ?? null, originalBy: p.author.username, href: null };
    if (m.kind === 'sound') return { label: clean(m.title) || 'Som original', cover: m.cover ?? null, originalBy: null, href: null };
    const id = musicSoundId(m);
    const title = clean(m.title) || 'Música';
    const artist = clean(m.artist);
    return { label: artist ? `${title} · ${artist}` : title, cover: m.cover ?? null, originalBy: null, href: id ? soundHref(id) : null };
  }
  // O som foi tirado (pelo autor ou por direitos de autor): o letreiro diz porquê, sem página.
  if (p.soundRemoved === 'author') return { label: 'Som retirado pelo autor', cover: null, originalBy: null, href: null };
  if (p.soundRemoved === 'rights') return { label: 'Som retirado por direitos de autor', cover: null, originalBy: null, href: null };
  return null;
}

export const soundHref = (id: string) => `/som/${encodeURIComponent(id)}`;
/** Abre o estúdio com este som. */
export const useSoundHref = (id: string) => `/tcheka/nova?som=${encodeURIComponent(id)}`;

/** 7 → «0:07»; 65 → «1:05». Valores inválidos contam como 0. */
export function clock(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * Arrastar na barra de progresso: onde ficas (0 a 1) a partir do sítio onde o dedo pousou (`startRatio`) e de quanto já
 * andou para os lados (`dx`, em píxeis) numa barra com `width` píxeis.
 */
export function seekRatio(startRatio: number, dx: number, width: number): number {
  if (!(width > 0)) return clamp01(startRatio);
  return clamp01(startRatio + dx / width);
}

/** O segundo a que o vídeo salta, sem chegar ao fim (aí acabava e mostrava o ecrã do fim). */
export function seekTime(ratio: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.min(Math.max(0, duration - 0.05), clamp01(ratio) * duration);
}

/** Setas ← / → no computador: recua ou avança `by` segundos, sem passar do início nem do fim. */
export function stepTime(current: number, duration: number, by: number): number {
  if (!(duration > 0)) return 0;
  return Math.min(Math.max(0, duration - 0.05), Math.max(0, (Number.isFinite(current) ? current : 0) + by));
}

/** As velocidades do menu de segurar. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** 0.5 → «0,5×», 1 → «1×», 1.25 → «1,25×» (vírgula, como se escreve cá). */
export const speedLabel = (r: number) => `${String(r).replace('.', ',')}×`;

export type HoldItem = 'not-interested' | 'report' | 'save' | 'speed' | 'captions' | 'gift' | 'more';

/**
 * O menu de segurar (toque longo no vídeo). Nas tchekas dos outros: «Não me interessa» e «Denunciar»; em todas: guardar
 * e velocidade; «Legendas» só se o vídeo as tiver; «Presentear» só se der; e por fim «Mais opções» (o menu ⋯ de sempre).
 */
export function holdMenu(o: { mine: boolean; captions: boolean; canGift?: boolean }): HoldItem[] {
  const out: HoldItem[] = [];
  if (!o.mine) out.push('not-interested', 'report');
  out.push('save', 'speed');
  if (o.captions) out.push('captions');
  if (!o.mine && o.canGift) out.push('gift');
  out.push('more');
  return out;
}

/** Mostra o «+» no avatar do lado: só em tchekas dos outros, de quem ainda não segues. */
export function showFollowPlus(o: { mine: boolean; authorFollowed?: boolean; followedNow?: boolean }): boolean {
  return !o.mine && o.authorFollowed === false && !o.followedNow;
}

/** A legenda é comprida (mostra «mais» e expande ao tocar). */
export function captionIsLong(body: string | null | undefined, max = 80): boolean {
  const b = clean(body);
  return b.length > max || b.split('\n').length > 2;
}

export type ReelTab = 'foryou' | 'following';
export const REEL_TABS: { id: ReelTab; label: string }[] = [
  { id: 'foryou', label: 'Para ti' },
  { id: 'following', label: 'A seguir' },
];
/** A chave da lista de cada separador (as duas começam por 'reels': o que limpa as tchekas limpa as duas). */
export const reelsKey = (tab: ReelTab) => (tab === 'following' ? ['reels', 'following'] : ['reels']);

/** Quanto tempo (ms) o letreiro do som leva a dar uma volta: ~40 px por segundo, nunca menos de 4 s. */
export const marqueeMs = (textWidth: number) => Math.max(4000, Math.round((Math.max(0, textWidth) / 40) * 1000));
