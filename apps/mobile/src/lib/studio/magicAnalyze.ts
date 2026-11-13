/**
 * A análise da «Montagem mágica» no browser: lê cada foto e cada vídeo em 32×56, ouve o som (WebAudio) e mede a música.
 * Tudo no aparelho: os ficheiros são lidos pelos elementos <img>/<video> e pelo WebAudio, nada é enviado para lado nenhum.
 *
 * Tem limite de tempo: cada vídeo é amostrado do geral para o pormenor (primeiro o meio, depois os quartos…), por isso
 * quando o tempo acaba já há uma ideia do vídeo todo. O que se mediu fica em cache por ficheiro: «Outra versão» e mudar de
 * onda não voltam a analisar nada.
 */
import { detectBeats } from '@/lib/tchekaRules';
import {
  ANALYSIS, MAGIC_MAX_S, coarseToFine, energyBlocks, frameStats, neutralItem, photoFocus, photoItem, pickMusicStart, videoFrame, videoItem,
  videoItemFromFrames, waveById, type MagicItem, type MagicPhase, type MagicSource, type MusicInfo, type VideoFrame, type WaveId,
} from './magic';

export { coarseToFine };

export interface AnalyzeOptions {
  /** O tempo todo para ver os ficheiros (ms). Por omissão 5 s; cada vídeo fica com a parte dele. */
  budgetMs?: number;
  onPhase?: (phase: MagicPhase, state: 'start' | 'done') => void;
  /** Para desistir a meio (fechar o ecrã). */
  signal?: { cancelled: boolean };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const itemCache = new Map<string, MagicItem>();
const musicCache = new Map<string, { rate: number; mono: Float32Array; energy: number[] }>();
/** Esquece o que se mediu (ao fechar o estúdio, ou quando os ficheiros mudam todos). */
export function clearMagicCache(): void { itemCache.clear(); musicCache.clear(); }

let work: { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null = null;
function reader() {
  if (!work) {
    const c = document.createElement('canvas');
    c.width = ANALYSIS.w; c.height = ANALYSIS.h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    work = { c, g };
  }
  return work;
}
/** Os pixels de uma imagem ou de um frame, reduzidos a 32×56. `cover`: só a parte que cabe no 9:16 (como vai aparecer). */
function pixels(src: CanvasImageSource, sw: number, sh: number, cover: boolean): Uint8ClampedArray | null {
  const r = reader();
  if (!r || !(sw > 0 && sh > 0)) return null;
  const { w, h } = ANALYSIS;
  try {
    if (cover) {
      const fa = w / h, ar = sw / sh;
      const cw = ar > fa ? sh * fa : sw, ch = ar > fa ? sh : sw / fa;
      r.g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
    } else r.g.drawImage(src, 0, 0, w, h);
    return r.g.getImageData(0, 0, w, h).data;
  } catch { return null; }
}

function loadImage(uri: string, timeoutMs: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const end = (v: HTMLImageElement | null) => { if (!done) { done = true; resolve(v); } };
    if (!uri.startsWith('blob:') && !uri.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => end(img);
    img.onerror = () => end(null);
    setTimeout(() => end(null), timeoutMs);
    img.src = uri;
  });
}

async function analyzePhoto(s: MagicSource): Promise<MagicItem> {
  const img = await loadImage(s.uri, 4000);
  const px = img ? pixels(img, img.naturalWidth, img.naturalHeight, false) : null;
  if (!img || !px) return neutral(s);
  const { w, h } = ANALYSIS;
  return photoItem(s.key, img.naturalWidth / img.naturalHeight, frameStats(px, w, h), photoFocus(px, w, h));
}

function seek(v: HTMLVideoElement, t: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const end = (ok: boolean) => { if (!done) { done = true; v.removeEventListener('seeked', onSeek); resolve(ok); } };
    const onSeek = () => end(true);
    v.addEventListener('seeked', onSeek);
    setTimeout(() => end(false), timeoutMs);
    try { v.currentTime = t; } catch { end(false); }
  });
}

/** A energia do som de um vídeo por décimo de segundo (0 a 1), ou null se não der para ouvir (sem som, ou grande de mais). */
async function videoAudio(uri: string, deadline: number): Promise<number[] | null> {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    // Vídeos grandes não se descodificam para ouvir (memória e tempo): ficam só com a imagem.
    if (blob.size > 24 * 1024 * 1024 || now() > deadline) return null;
    const buf = await decodeMono(await blob.arrayBuffer());
    return buf ? energyBlocks(buf.mono, buf.rate) : null;
  } catch { return null; }
}

async function analyzeVideo(s: MagicSource, budgetMs: number, signal?: { cancelled: boolean }): Promise<MagicItem> {
  const t0 = now(), deadline = t0 + budgetMs;
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  if (!s.uri.startsWith('blob:') && !s.uri.startsWith('data:')) v.crossOrigin = 'anonymous';
  const fallbackDur = Math.max(0.5, (s.durationMs ?? 5000) / 1000);
  const flat = (dur: number, aspect = 9 / 16): MagicItem => videoItem(s.key, aspect, { duration: dur, samples: [] }, { luma: 0.5, sat: 0.3, rgb: [0.5, 0.5, 0.5] });
  const ready = await new Promise<boolean>((resolve) => {
    let done = false;
    const end = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    v.addEventListener('loadeddata', () => end(true), { once: true });
    v.addEventListener('error', () => end(false), { once: true });
    setTimeout(() => end(v.readyState >= 2), Math.min(3000, budgetMs));
    v.src = s.uri;
  });
  const free = () => { try { v.removeAttribute('src'); v.load(); } catch { /* já foi */ } };
  if (!ready || !(v.videoWidth > 0)) { free(); return flat(fallbackDur); }
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : fallbackDur;
  const audioP = videoAudio(s.uri, deadline);
  const want = Math.max(6, Math.min(28, Math.round(dur * 2.5)));
  const got: VideoFrame[] = [];
  for (const f of coarseToFine(want)) {
    if (signal?.cancelled || (got.length >= 5 && now() > deadline)) break;
    const t = Math.min(dur - 0.05, Math.max(0, f * dur));
    if (!(await seek(v, t, 700))) continue;
    const px = pixels(v, v.videoWidth, v.videoHeight, true);
    if (!px) continue;
    got.push(videoFrame(t, px));
  }
  const aspect = v.videoWidth / v.videoHeight;
  free();
  if (!got.length) return flat(dur, aspect);
  const audio = await Promise.race([audioP, new Promise<null>((r) => setTimeout(() => r(null), Math.max(200, deadline - now() + 600)))]);
  // As contas dos frames e do som são as do magic.ts (as mesmas da app), com o som em blocos de 0,1 s.
  const silent = audio ? audio.every((e) => e === 0) : undefined;
  return videoItemFromFrames(s.key, aspect, dur, got, audio ? { energy: audio, rate: 10 } : null, audio ? !silent : undefined);
}

/**
 * Mede todos os ficheiros (as fotos de seguida; os vídeos dois de cada vez, cada um com a parte dele do tempo). Devolve os
 * `MagicItem` pela ordem das fontes.
 */
export async function analyzeSources(sources: MagicSource[], opts: AnalyzeOptions = {}): Promise<MagicItem[]> {
  // Sem browser (no nativo, por agora): não há como ver os ficheiros; a montagem faz-se com valores neutros (ver o doc).
  if (typeof document === 'undefined') return sources.map(neutral);
  const budget = opts.budgetMs ?? 5000;
  const videos = sources.filter((s) => s.video && !itemCache.has(s.uri));
  const photos = sources.filter((s) => !s.video && !itemCache.has(s.uri));
  opts.onPhase?.('ver', 'start');
  const per = videos.length ? Math.max(700, Math.min(2500, (budget * 2) / videos.length)) : 0;
  for (let i = 0; i < videos.length; i += 2) {
    if (opts.signal?.cancelled) break;
    const pair = videos.slice(i, i + 2);
    const done = await Promise.all(pair.map((s) => analyzeVideo(s, per, opts.signal)));
    done.forEach((it, k) => itemCache.set(pair[k].uri, it));
  }
  opts.onPhase?.('ver', 'done');
  opts.onPhase?.('fotos', 'start');
  for (const s of photos) {
    if (opts.signal?.cancelled) break;
    itemCache.set(s.uri, await analyzePhoto(s));
  }
  opts.onPhase?.('fotos', 'done');
  return sources.map((s) => ({ ...(itemCache.get(s.uri) ?? neutral(s)), key: s.key, video: s.video }));
}

/** Um ficheiro que não se conseguiu ver: valores neutros (entra na montagem pela ordem em que veio, do início). */
export const neutral = neutralItem;

type AC = typeof OfflineAudioContext;
/** Descodifica para mono a ~11 kHz (chega para a energia e para as batidas, e ocupa pouca memória). */
async function decodeMono(data: ArrayBuffer): Promise<{ rate: number; mono: Float32Array } | null> {
  const w = globalThis as unknown as { OfflineAudioContext?: AC; webkitOfflineAudioContext?: AC };
  const Ctor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Ctor) return null;
  try {
    const ctx = new Ctor(1, 1, 22050);
    const buf = await ctx.decodeAudioData(data);
    const ch = buf.getChannelData(0);
    const mono = new Float32Array(Math.floor(ch.length / 2));
    for (let i = 0; i < mono.length; i++) mono[i] = (ch[2 * i] + ch[2 * i + 1]) / 2;
    return { rate: buf.sampleRate / 2, mono };
  } catch { return null; }
}

/**
 * A música para a onda `wave`: o trecho (pela energia, ao jeito da onda), as batidas dele e o início acertado para uma
 * batida cair no 0 da tcheka. `null` se não der para a ouvir (a montagem faz-se a 120 BPM).
 */
export async function analyzeMusic(url: string | null | undefined, wave: WaveId, windowS: number, opts: AnalyzeOptions = {}): Promise<MusicInfo | null> {
  opts.onPhase?.('ritmo', 'start');
  let out: MusicInfo | null = null;
  try {
    if (url && typeof fetch === 'function') {
      let m = musicCache.get(url);
      if (!m) {
        const res = await fetch(url);
        const dec = await decodeMono(await res.arrayBuffer());
        if (dec) { m = { ...dec, energy: energyBlocks(dec.mono, dec.rate) }; if (musicCache.size >= 3) musicCache.delete(musicCache.keys().next().value as string); musicCache.set(url, m); }
      }
      if (m) {
        const win = Math.min(MAGIC_MAX_S, Math.max(8, windowS));
        const start = pickMusicStart(m.energy, win, waveById(wave).start);
        const s0 = Math.min(m.mono.length, Math.round(start * m.rate));
        const beats = detectBeats(m.mono.subarray(s0, Math.min(m.mono.length, s0 + Math.round(m.rate * (win + 5)))), m.rate);
        const period = beats.bpm ? 60 / beats.bpm : 0;
        const shift = period && beats.offset > 0.04 && beats.offset < period - 0.04 ? beats.offset : 0;
        const from = start + shift;
        out = { startMs: Math.round(from * 1000), bpm: beats.bpm, energy: m.energy.slice(Math.round(from * 10)) };
      }
    }
  } catch { out = null; }
  opts.onPhase?.('ritmo', 'done');
  return out;
}
