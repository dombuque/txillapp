// O aspeto da música nas publicações e nos mimos (sem React, para os testes em Node: tests/musicLook.test.mjs):
// as cores do cartão (o gradiente da capa ou o da marca), a cor do texto pela luminância, onde aparece a música (o cartão
// completo nas publicações só com texto, o selo flutuante por cima das fotos e dos vídeos), o «Usar este som», o artista
// local, o rótulo do leitor de ecrã, quando há movimento (reduzir movimento) e as contas das ondas de som.
// As funções das ondas levam 'worklet': correm no fio da interface (Reanimated) e também em Node.

/** O gradiente da marca, para as faixas sem as cores da capa. */
export const BRAND_GRADIENT: readonly [string, string] = ['#d6334f', '#5b1426'];
/** As duas cores possíveis do texto sobre a capa: branco ou quase preto (o zinc-900 da app). */
export const TEXT_LIGHT = '#ffffff';
export const TEXT_DARK = '#18181b';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const isHex = (c: unknown): c is string => typeof c === 'string' && HEX.test(c);

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Luminância relativa (WCAG 2), de 0 (preto) a 1 (branco). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre duas cores (1 a 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * A cor do texto sobre um fundo com estas cores (as do gradiente): branco ou quase preto, a que tiver o melhor contraste
 * no pior ponto do gradiente. Sem cores válidas, o branco (o fundo é o da marca).
 */
export function textOn(bg: readonly (string | null | undefined)[] | null | undefined): typeof TEXT_LIGHT | typeof TEXT_DARK {
  const list = (bg ?? []).filter(isHex);
  if (!list.length) return TEXT_LIGHT;
  const worst = (fg: string) => Math.min(...list.map((c) => contrast(fg, c)));
  return worst(TEXT_DARK) > worst(TEXT_LIGHT) ? TEXT_DARK : TEXT_LIGHT;
}

/** As duas cores do cartão: as da capa (se forem cores a sério) ou as da marca. */
export function trackColors(t: object | null | undefined): [string, string] {
  const c = (t as { coverColors?: unknown } | null | undefined)?.coverColors;
  if (Array.isArray(c) && c.length >= 2 && isHex(c[0]) && isHex(c[1])) return [c[0], c[1]];
  return [BRAND_GRADIENT[0], BRAND_GRADIENT[1]];
}

/** `#rrggbb` com transparência (`rgba(...)`), para o vidro e os brilhos. */
export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(isHex(hex) ? hex : BRAND_GRADIENT[0]);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

/** Mistura duas cores (k de 0 a 1, para o lado da segunda); devolve #rrggbb. */
export function mix(a: string, b: string, k: number): string {
  const x = hexToRgb(isHex(a) ? a : BRAND_GRADIENT[0]);
  const y = hexToRgb(isHex(b) ? b : '#ffffff');
  const t = Math.max(0, Math.min(1, k));
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** O brilho das ondas: a cor da capa clareada (uma capa escura não pode virar sombra por cima da foto). */
export const glowOf = (c: string | null | undefined) => mix(c ?? BRAND_GRADIENT[0], '#ffffff', 0.45);

/** O mínimo de uma publicação que decide onde fica a música. */
export interface PostMusicLike {
  kind?: string;
  body?: string | null;
  gift?: unknown;
  music?: unknown;
  media?: readonly { kind?: string }[] | null;
  sound?: unknown;
}

/** Uma citação (repost com texto): as fotos do original não aparecem no cartão de quem cita. */
export const isQuote = (p: PostMusicLike) => p.kind === 'repost' && !!p.body && !p.gift;

/**
 * Onde aparece a música de uma publicação: `card` (o cartão completo, nas que só têm texto), `badge` (o selo flutuante por
 * cima da foto ou do vídeo, sem ocupar espaço por baixo) ou `none` (sem música).
 */
export function musicPlacement(p: PostMusicLike): 'none' | 'card' | 'badge' {
  if (!p.music) return 'none';
  return p.media && p.media.length > 0 && !isQuote(p) ? 'badge' : 'card';
}

/** As ondas de som passam por cima de fotos (num vídeo já há movimento que chegue). */
export const wavesOverMedia = (media: readonly { kind?: string }[] | null | undefined) => !!media?.some((m) => m.kind !== 'video');

const SOUND_ID = /^[A-Za-z0-9._:-]{1,120}$/;
/**
 * «Usar este som»: a página `/som/[id]` do som da publicação. Só com `post.sound` (um id, ou um objeto com `id`) com um id
 * que pareça um id; sem ele, a ligação não aparece.
 */
export function soundHref(p: { sound?: unknown } | null | undefined): string | null {
  const s = p?.sound;
  const id = typeof s === 'string' ? s : s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string' ? (s as { id: string }).id : null;
  return id && SOUND_ID.test(id) ? `/som/${encodeURIComponent(id)}` : null;
}

/** O artista da faixa: o nome a mostrar, se é do programa de artistas e para onde leva (o perfil, só com um @ válido). */
export function trackArtist(t: { kind?: string; artist?: string | null; source?: string; artistUsername?: string | null }) {
  const local = t.source === 'local';
  const href = local && t.artistUsername && /^[a-z0-9._]{2,40}$/i.test(t.artistUsername) ? `/u/${t.artistUsername}` : null;
  const name = t.kind === 'clip' ? 'Áudio original' : (t.artist || '').trim() || (local && t.artistUsername ? `@${t.artistUsername}` : 'Autor desconhecido');
  return { name, local, href };
}

/** O que o leitor de ecrã diz do cartão e do selo. */
export function musicA11yLabel(t: { kind?: string; title: string; artist?: string | null; source?: string; artistUsername?: string | null }, muted = false): string {
  const { name } = trackArtist(t);
  return `Música: ${t.title}, de ${name}. ${muted ? 'Sem som. ' : ''}Toca para silenciar ou ligar o som`;
}

/** «♪ Título · Artista», a linha do selo. */
export const badgeLine = (t: { kind?: string; title: string; artist?: string | null; source?: string; artistUsername?: string | null }) =>
  t.kind === 'clip' ? `♪ ${t.title}` : `♪ ${t.title} · ${trackArtist(t).name}`;

/**
 * Há movimento (equalizador, disco a rodar, marquee, ondas)? Só com a música a tocar, com som, à vista e sem «reduzir
 * movimento». O marquee não depende do som (`needsSound: false`).
 */
export function motionOn(o: { reduce: boolean; playing: boolean; visible?: boolean; muted?: boolean; needsSound?: boolean }): boolean {
  if (o.reduce || !o.playing || o.visible === false) return false;
  return o.needsSound === false ? true : !o.muted;
}

/** O marquee: corre só se o texto não couber; a distância é o texto mais o intervalo, a uma velocidade calma (px/s). */
export const MARQUEE_GAP = 36;
export function marquee(textW: number, boxW: number, speed = 28): { run: boolean; distance: number; ms: number } {
  if (!(textW > 0) || !(boxW > 0) || textW <= boxW + 1) return { run: false, distance: 0, ms: 0 };
  const distance = Math.round(textW + MARQUEE_GAP);
  return { run: true, distance, ms: Math.round((distance / speed) * 1000) };
}

/** A fração do trecho já tocada (0 a 1), para o anel de progresso. */
export function ringProgress(currentSec: number | null | undefined, durationSec: number | null | undefined): number {
  if (!durationSec || !(durationSec > 0) || !currentSec || !(currentSec > 0)) return 0;
  return Math.min(1, (currentSec % durationSec) / durationSec);
}

/** A duração do trecho em segundos: a do leitor (já carregada) ou a do catálogo. */
export function snippetSeconds(playerDur: number | null | undefined, durationMs: number | null | undefined): number {
  if (playerDur && Number.isFinite(playerDur) && playerDur > 0) return playerDur;
  return durationMs && durationMs > 0 ? durationMs / 1000 : 30;
}

/** O nível do som (0 a 1) a partir de uma janela de amostras (-1 a 1): RMS, com ganho, para as ondas. */
export function rmsLevel(frames: ArrayLike<number> | null | undefined): number {
  if (!frames || !frames.length) return 0;
  let sum = 0;
  const step = frames.length > 512 ? Math.floor(frames.length / 512) : 1;
  let n = 0;
  for (let i = 0; i < frames.length; i += step) { sum += frames[i] * frames[i]; n++; }
  return Math.min(1, Math.sqrt(sum / Math.max(1, n)) * 3.2);
}

/**
 * A «respiração» das ondas quando não há análise do áudio: um ritmo plausível (um batimento a ~112 bpm com uma ondulação
 * mais lenta por cima), sempre entre 0,25 e 1. `t` em segundos.
 */
export function breath(t: number): number {
  'worklet';
  const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * (112 / 60))), 6);
  const swell = 0.5 + 0.5 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1.3);
  return Math.min(1, 0.25 + 0.45 * swell + 0.3 * beat);
}

/**
 * O caminho SVG de uma onda (uma linha suave que atravessa a imagem a meio). `phase` em radianos, `amp` em px, `cycles`
 * quantas ondas cabem na largura. A amplitude encolhe nas pontas, como num visualizador.
 */
export function wavePath(width: number, height: number, phase: number, amp: number, cycles: number, points = 28): string {
  'worklet';
  const mid = height / 2;
  let d = '';
  for (let i = 0; i <= points; i++) {
    const x = (width * i) / points;
    const u = i / points;
    const env = Math.sin(Math.PI * u);
    const y = mid + Math.sin(u * cycles * Math.PI * 2 + phase) * amp * env + Math.sin(u * cycles * 5.1 + phase * 1.7) * amp * 0.18 * env;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}
