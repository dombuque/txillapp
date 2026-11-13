/**
 * O som do estúdio no telemóvel, sem módulos nativos novos:
 * - a «onda» da música e o andamento, lidos dos ganhos dos frames do MP3 (lib/studio/mp3Envelope.ts; nos outros formatos
 *   não há onda e o ritmo fica nos 120 BPM até o servidor ler as batidas na montagem);
 * - os efeitos sonoros (os mesmos `synthSfx` do site e do servidor) gravados uma vez em WAV na cache, para se ouvirem já na
 *   pré-visualização.
 */
import { File, Paths } from 'expo-file-system';
import { encodeWav, synthSfx, type SfxId } from './audioDsp';
import { peaks as peaksOf, suggestStart, type StartMode, type StartSuggestion } from './audioMix';
import type { BeatState } from './audioRhythm';
import { mp3Envelope, type Mp3Envelope } from './mp3Envelope';
import { detectBeats, TCHEKA_MAX_S } from '@/lib/tchekaRules';

export interface MusicAnalysis {
  url: string;
  /** Segundos da faixa. */
  duration: number;
  /** A onda (0 a 1), ~20 pontos por segundo. */
  peaks: number[];
  /** O trecho sugerido para uma tcheka de `windowS` segundos. */
  suggest: (windowS: number, mode?: StartMode) => StartSuggestion;
  /** As batidas do trecho que começa em `startMs`. */
  beats: (startMs: number) => BeatState;
  /** A curva de volume normalizada (0 a 1) e a taxa dela, para quem quiser mais (a Montagem mágica). */
  env: Float32Array;
  rate: number;
}

const cache = new Map<string, Promise<MusicAnalysis | null>>();

function analysisOf(url: string, e: Mp3Envelope): MusicAnalysis {
  let top = 0;
  for (let i = 0; i < e.env.length; i++) top = Math.max(top, e.env[i]);
  const env = top > 0 ? e.env.map((v) => v / top) : e.env;
  return {
    url, duration: e.duration, env, rate: e.rate,
    peaks: peaksOf(env, Math.max(60, Math.min(1500, Math.round(e.duration * 20)))),
    suggest: (windowS, mode = 'forte') => suggestStart(env, e.rate, windowS, mode),
    beats: (startMs) => {
      const s0 = Math.min(env.length, Math.max(0, Math.round((e.rate * startMs) / 1000)));
      const info = detectBeats(env.subarray(s0, Math.min(env.length, s0 + Math.round(e.rate * (TCHEKA_MAX_S + 5)))), e.rate);
      return { url, start: startMs, bpm: info.bpm, offset: info.offset, detected: !!info.bpm };
    },
  };
}

/** Lê a música (até 25 MB) e devolve a análise, ou null se não for um MP3 que se consiga ler. Fica em cache por URL. */
export function analyzeMusicNative(url: string | null | undefined): Promise<MusicAnalysis | null> {
  if (!url) return Promise.resolve(null);
  const have = cache.get(url);
  if (have) return have;
  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 25 * 1024 * 1024) return null;
      const env = mp3Envelope(new Uint8Array(buf));
      return env ? analysisOf(url, env) : null;
    } catch { return null; }
  })();
  cache.set(url, p);
  void p.then((r) => { if (!r) cache.delete(url); });
  if (cache.size > 4) cache.delete(cache.keys().next().value as string);
  return p;
}

const sfxFiles = new Map<SfxId, string>();
/** O ficheiro WAV de um efeito sonoro (gerado uma vez, na cache da app). */
export function sfxFile(id: SfxId): string | null {
  const have = sfxFiles.get(id);
  if (have) return have;
  try {
    const f = new File(Paths.cache, `txill-sfx-${id}.wav`);
    if (!f.exists) {
      f.create({ intermediates: true, overwrite: true });
      f.writeSync(encodeWav([synthSfx(id, 22050)], 22050));
    }
    sfxFiles.set(id, f.uri);
    return f.uri;
  } catch { return null; }
}
