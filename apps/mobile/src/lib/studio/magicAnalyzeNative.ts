/**
 * A análise da «Montagem mágica» no telemóvel (no site é lib/studio/magicAnalyze.ts, com <img>, <video>, canvas e Web Audio).
 * As contas são as mesmas do site (magic.ts); muda só a maneira de chegar aos píxeis e ao som:
 * - **Fotos**: a Skia lê a foto e reduz a 32×56 (luz, cor, nitidez e o ponto de interesse).
 * - **Vídeos**: o expo-video tira os frames exatos (`generateThumbnailsAsync`, ~2 por segundo, no máximo 40, do geral para
 *   o pormenor enquanto houver tempo) e a Skia lê-os numa grelha escondida (components/studio/native/useMagicFrames.tsx):
 *   movimento, nitidez, luz e o ponto de interesse. O leitor diz também se o vídeo tem pista de áudio (nativeVideoAudio.ts).
 * - **Som dos vídeos**: o servidor ouve os clipes que a app já enviou (magicUploads.ts e magicSound.ts); sem rede, fica
 *   só a imagem.
 * - **Música**: a curva de volume do MP3 (lib/studio/nativeAudio.ts) dá a energia, o trecho ao jeito da onda e o andamento.
 * O tempo é o do site: cerca de 5 s para os vídeos todos (cada um com a parte dele), e o que se mediu fica em cache por ficheiro.
 */
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { createVideoPlayer, type VideoPlayer, type VideoThumbnail } from 'expo-video';
import {
  ANALYSIS, energyBlocks, frameStats, MAGIC_MAX_S, neutralItem, photoFocus, photoItem, pickMusicStart, videoFocus, videoFrame,
  videoItemFromFrames, videoSampleTimes, waveById, withVideoSound,
  type Focus, type MagicItem, type MagicSource, type MusicInfo, type VideoFrame, type WaveId,
} from './magic';
import type { AnalyzeOptions } from './magicAnalyze';
import { batchSize, GRID_RESERVE_MS, SOUND_WAIT_MS, THUMB_MAX, videoBudget, type SoundReply } from './magicFrames';
import { fetchVideoSound } from './magicSound';
import { magicMediaId } from './magicUploads';
import { analyzeMusicNative } from './nativeAudio';
import { trackInfoOf, type TrackInfo } from './nativeVideoAudio';
import { detectBeats } from '@/lib/tchekaRules';
import type { MagicFrameGrabber } from '@/components/studio/native/useMagicFrames';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const photoCache = new Map<string, MagicItem>();
/** Os vídeos medidos pelos frames (sem o som do servidor, que se junta à parte), por ficheiro. */
const videoCache = new Map<string, MagicItem>();
const timeout = <T,>(ms: number) => new Promise<T | null>((r) => setTimeout(() => r(null), Math.max(0, ms)));

// ---------------------------------------------------------------- fotos

async function photoPixels(uri: string): Promise<{ px: Uint8Array; aspect: number } | null> {
  try {
    const data = await Skia.Data.fromURI(uri);
    const img = Skia.Image.MakeImageFromEncoded(data);
    if (!img || !(img.width() > 0)) return null;
    const { w, h } = ANALYSIS;
    const surface = Skia.Surface.MakeOffscreen(w, h) ?? Skia.Surface.Make(w, h);
    if (!surface) return null;
    surface.getCanvas().drawImageRect(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(0, 0, w, h), Skia.Paint());
    surface.flush();
    const snap = surface.makeImageSnapshot();
    const px = snap.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    if (!px || px.length < w * h * 4 || px instanceof Float32Array) return null;
    return { px, aspect: img.width() / img.height() };
  } catch { return null; }
}

async function analyzePhoto(s: MagicSource): Promise<MagicItem> {
  const got = await photoPixels(s.uri);
  const { w, h } = ANALYSIS;
  return got ? photoItem(s.key, got.aspect, frameStats(got.px, w, h), photoFocus(got.px, w, h)) : neutralItem(s);
}

// ---------------------------------------------------------------- vídeos

/** Um vídeo: as miniaturas em lotes enquanto houver tempo, os píxeis delas pela grelha, e o «tem pista de áudio?». */
async function analyzeVideo(s: MagicSource, budgetMs: number, grab: MagicFrameGrabber, signal?: { cancelled: boolean }): Promise<MagicItem> {
  const t0 = now();
  const deadline = t0 + Math.max(300, budgetMs - GRID_RESERVE_MS);
  let player: VideoPlayer | null = null;
  const thumbs: VideoThumbnail[] = [];
  let info: TrackInfo = {};
  let dur = Math.max(0.5, (s.durationMs ?? 0) / 1000 || 0);
  try {
    player = createVideoPlayer({ uri: s.uri });
    player.muted = true;
    const tracks = trackInfoOf(player, 1500);
    // Sem a duração no clipe, espera-se pelo leitor (é ela que diz onde tirar os frames).
    if (!s.durationMs) { info = await tracks; if (info.duration) dur = info.duration; }
    const times = videoSampleTimes(dur);
    let msPer = 0;
    for (let i = 0; i < times.length && !signal?.cancelled;) {
      const n = batchSize(times.length - i, deadline - now(), msPer, thumbs.length);
      if (!n) break;
      const b0 = now();
      // O primeiro lote tem sempre uns segundos (os vídeos grandes demoram a abrir); os outros, o tempo que sobra.
      const limit = thumbs.length ? Math.max(400, deadline - now() + 400) : Math.max(2500, budgetMs);
      let got: VideoThumbnail[] | null = null;
      try {
        got = await Promise.race([player.generateThumbnailsAsync(times.slice(i, i + n), { maxWidth: THUMB_MAX, maxHeight: THUMB_MAX }), timeout<VideoThumbnail[]>(limit)]);
      } catch { got = null; }
      if (!got?.length) break;
      thumbs.push(...got);
      const per = (now() - b0) / got.length;
      msPer = msPer ? (msPer + per) / 2 : per;
      i += n;
    }
    if (s.durationMs) info = (await Promise.race([tracks, timeout<TrackInfo>(300)])) ?? {};
  } catch { /* sem leitor: fica neutro */ } finally {
    try { player?.release(); } catch { /* já libertado */ }
  }
  const flat = (): MagicItem => ({ ...neutralItem({ ...s, durationMs: Math.round(dur * 1000) }), ...(info.hasAudio !== undefined ? { hasAudio: info.hasAudio } : {}) });
  if (!thumbs.length || signal?.cancelled) return flat();
  const g = await grab(thumbs);
  if (!g) return flat();
  const frames: VideoFrame[] = [];
  const focuses: Focus[] = [];
  const { w, h } = ANALYSIS;
  thumbs.forEach((t, k) => {
    if (!g.ok[k] || !g.cover[k] || !g.full[k]) return;
    frames.push(videoFrame(Number.isFinite(t.requestedTime) ? t.requestedTime : 0, g.cover[k]));
    focuses.push(photoFocus(g.full[k], w, h));
  });
  if (!frames.length) return flat();
  const aspect = thumbs[0].width > 0 && thumbs[0].height > 0 ? thumbs[0].width / thumbs[0].height : 9 / 16;
  return videoItemFromFrames(s.key, aspect, dur, frames, null, info.hasAudio, videoFocus(focuses));
}

// ---------------------------------------------------------------- o que a Montagem mágica chama

export interface NativeMagicOptions {
  /** Quem lê os píxeis das miniaturas (o hook useMagicFrames, montado no estúdio). Sem ele, os vídeos ficam neutros. */
  grab: MagicFrameGrabber | null;
  /** O rascunho cujos envios trazem os `mediaId` dos vídeos (magicUploads.ts). Sem ele, não se ouve o som. */
  draftId?: string;
  /** Avisa o estúdio de que um vídeo (pela chave `media`) tem ou não tem som (a regra do som e o «Som do vídeo»). */
  onHasAudio?: (media: string, hasAudio: boolean) => void;
}

/** As fotos e os vídeos (pela ordem das fontes), com o tempo do site para os vídeos (um de cada vez). */
async function analyzeSourcesWith(o: NativeMagicOptions, sources: MagicSource[], opts: AnalyzeOptions = {}): Promise<MagicItem[]> {
  const budget = opts.budgetMs ?? 5000;
  const t0 = now();
  const videos = o.grab ? sources.filter((s) => s.video && !videoCache.has(s.uri)) : [];
  for (let i = 0; i < videos.length; i++) {
    if (opts.signal?.cancelled || !o.grab) break;
    const s = videos[i];
    const it = await analyzeVideo(s, videoBudget(budget, now() - t0, videos.length - i), o.grab, opts.signal);
    if (opts.signal?.cancelled) break;
    videoCache.set(s.uri, it);
    if (it.hasAudio !== undefined) o.onHasAudio?.(s.media ?? s.key, it.hasAudio);
  }
  for (const s of sources) {
    if (opts.signal?.cancelled) break;
    if (s.video || photoCache.has(s.uri)) continue;
    photoCache.set(s.uri, await analyzePhoto(s));
  }
  return sources.map((s) => ({ ...((s.video ? videoCache : photoCache).get(s.uri) ?? neutralItem(s)), key: s.key, video: s.video }));
}

/** O som dos vídeos: espera (no máximo `SOUND_WAIT_MS`) pelos envios e pelo servidor e junta-o aos vídeos já medidos. */
async function analyzeSoundWith(o: NativeMagicOptions, videos: MagicSource[], items: MagicItem[], opts: AnalyzeOptions = {}): Promise<{ items: MagicItem[]; heard: number; withSound: number }> {
  const end = now() + SOUND_WAIT_MS;
  const replies = new Map<string, SoundReply>();
  await Promise.all(videos.map(async (s) => {
    if (!o.draftId) return;
    const media = s.media ?? s.key;
    const id = await magicMediaId(o.draftId, media, end - now());
    if (!id || opts.signal?.cancelled) return;
    // O que chegar depois do tempo ainda serve ao estúdio (e fica em cache para a próxima montagem).
    void fetchVideoSound(id, 30_000).then((r) => { if (r) o.onHasAudio?.(media, r.hasAudio); });
    const r = await fetchVideoSound(id, end - now());
    if (r) replies.set(s.key, r);
  }));
  let withSound = 0;
  const out = items.map((it) => {
    const r = it.video ? replies.get(it.key) : undefined;
    if (!r) return it;
    if (r.hasAudio) withSound++;
    return withVideoSound(it, r.sound, r.hasAudio);
  });
  return { items: out, heard: replies.size, withSound };
}

/** A música para a onda `wave` (a mesma conta do site, com a curva do MP3 no lugar das amostras). */
export async function analyzeMusicNativeMagic(url: string | null | undefined, wave: WaveId, windowS: number): Promise<MusicInfo | null> {
  const m = await analyzeMusicNative(url);
  if (!m) return null;
  const energy = energyBlocks(m.env, m.rate);
  let top = 0;
  for (const e of energy) top = Math.max(top, e);
  const norm = top > 0 ? energy.map((e) => e / top) : energy;
  const win = Math.min(MAGIC_MAX_S, Math.max(8, windowS));
  const start = pickMusicStart(norm, win, waveById(wave).start);
  const s0 = Math.min(m.env.length, Math.round(start * m.rate));
  const beats = detectBeats(m.env.subarray(s0, Math.min(m.env.length, s0 + Math.round(m.rate * (win + 5)))), m.rate);
  const period = beats.bpm ? 60 / beats.bpm : 0;
  const shift = period && beats.offset > 0.04 && beats.offset < period - 0.04 ? beats.offset : 0;
  const from = start + shift;
  return { startMs: Math.round(from * 1000), bpm: beats.bpm, energy: norm.slice(Math.round(from * 10)) };
}

/** As funções que a `MagicMontage` usa no telemóvel (`analyzers`). */
export function nativeMagicAnalyzers(o: NativeMagicOptions) {
  return {
    sources: (sources: MagicSource[], opts?: AnalyzeOptions) => analyzeSourcesWith(o, sources, opts),
    music: (url: string | null | undefined, wave: WaveId, windowS: number) => analyzeMusicNativeMagic(url, wave, windowS),
    sound: (videos: MagicSource[], items: MagicItem[], opts?: AnalyzeOptions) => analyzeSoundWith(o, videos, items, opts),
  };
}

/** Sem a grelha nem os envios: as fotos medidas e os vídeos neutros (o que a `MagicMontage` usa por omissão no telemóvel). */
export const analyzeSourcesNative = (sources: MagicSource[], opts?: AnalyzeOptions) => analyzeSourcesWith({ grab: null }, sources, opts);

export const clearNativeMagicCache = () => { photoCache.clear(); videoCache.clear(); };
