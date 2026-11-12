/**
 * «Ajustar ao ritmo» e os moldes, prontos a aplicar no estúdio: lê as batidas do trecho escolhido (a `detectBeats` do
 * estúdio, a partir de `musicStartMs`), acerta o início da música para uma batida cair no 0 da tcheka e encaixa os cortes
 * das fotos e dos vídeos nessas batidas (`fitToBeats`).
 */
import { beatGrid, detectBeats, TCHEKA_MAX_S, type Trim } from '@/lib/tchekaRules';
import { downbeatShift, fitToBeats, templatePhotoBeats, type BeatItem, type Template } from './audioMix';

export interface BeatState { url: string; start: number; bpm: number | null; offset: number; detected: boolean }

/** As batidas do trecho que começa em `startMs` (até 65 s dele). */
export function beatsFrom(buf: AudioBuffer, url: string, startMs: number): BeatState {
  const s0 = Math.min(buf.length, Math.max(0, Math.round((buf.sampleRate * startMs) / 1000)));
  const n = Math.min(buf.length - s0, Math.round(buf.sampleRate * (TCHEKA_MAX_S + 5)));
  const info = detectBeats(buf.getChannelData(0).subarray(s0, s0 + n), buf.sampleRate);
  return { url, start: startMs, bpm: info.bpm, offset: info.offset, detected: !!info.bpm };
}

export interface RhythmPlan {
  /** O início novo da música (a batida no 0) e as batidas dali. */
  musicStartMs: number;
  beat: BeatState;
  /** Por clipe: as batidas (fotos) ou o corte novo (vídeos). */
  beats: (number | null)[];
  trims: (Trim | null)[];
}

/** O plano do encaixe nas batidas (com um molde: as batidas por foto e o máximo por vídeo dele). */
export function planRhythm(items: BeatItem[], beat: BeatState, tpl?: Template | null): RhythmPlan {
  const period = 60 / (beat.bpm && beat.bpm > 30 ? beat.bpm : 120);
  const shift = downbeatShift(beat.offset, period);
  const b: BeatState = shift ? { ...beat, start: Math.round(beat.start + shift * 1000), offset: 0 } : beat;
  const grid = beatGrid(b.bpm, b.offset, TCHEKA_MAX_S + 30);
  const fit = fitToBeats(items, grid, tpl ? { photoBeats: (i) => templatePhotoBeats(tpl, i), maxBeats: tpl.videoBeats } : {});
  return { musicStartMs: b.start, beat: b, beats: fit.beats, trims: fit.trims };
}
