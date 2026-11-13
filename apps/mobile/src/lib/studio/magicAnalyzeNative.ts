/**
 * A análise da «Montagem mágica» no telemóvel (no site é lib/studio/magicAnalyze.ts, com <img>, <video>, canvas e Web Audio).
 * - **Fotos**: olha-se a sério. A Skia (já na app, do editor de fotos) lê a foto e reduz a 32×56, e os píxeis vão às mesmas
 *   contas do site (`frameStats`, `photoFocus`): luz, cor, nitidez e o ponto de interesse (a cara).
 * - **Vídeos**: não se olha para dentro (o expo-video não dá os píxeis dos frames sem um módulo novo). Ficam com a duração
 *   e entram do início (como `neutral` do site).
 * - **Música**: a curva de volume do MP3 (lib/studio/nativeAudio.ts) dá a energia, o trecho ao jeito da onda e o andamento.
 */
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import {
  ANALYSIS, energyBlocks, frameStats, MAGIC_MAX_S, photoFocus, photoItem, pickMusicStart, waveById,
  type MagicItem, type MagicSource, type MusicInfo, type WaveId,
} from './magic';
import { neutral, type AnalyzeOptions } from './magicAnalyze';
import { analyzeMusicNative } from './nativeAudio';
import { detectBeats } from '@/lib/tchekaRules';

const cache = new Map<string, MagicItem>();

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

/** Os `MagicItem` pela ordem das fontes (as fotos medidas, os vídeos neutros). */
export async function analyzeSourcesNative(sources: MagicSource[], opts: AnalyzeOptions = {}): Promise<MagicItem[]> {
  for (const s of sources) {
    if (opts.signal?.cancelled) break;
    if (s.video || cache.has(s.uri)) continue;
    const got = await photoPixels(s.uri);
    const { w, h } = ANALYSIS;
    cache.set(s.uri, got ? photoItem(s.key, got.aspect, frameStats(got.px, w, h), photoFocus(got.px, w, h)) : neutral(s));
  }
  return sources.map((s) => ({ ...(cache.get(s.uri) ?? neutral(s)), key: s.key, video: s.video }));
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

export const clearNativeMagicCache = () => cache.clear();
