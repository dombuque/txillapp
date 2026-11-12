/**
 * O projeto do estúdio das tchekas: a sequência dos clipes, sem React nem browser (testada em tests/studioProject.test.mjs).
 * - Cada clipe tem o bocado que entra (corte: `trim.start` a `trim.end`, em segundos do ficheiro), a duração das fotos,
 *   a velocidade e a ordem (a da lista).
 * - As operações são puras (devolvem uma lista nova, ou a mesma se nada mudou): cortar pelas pontas, dividir no cursor,
 *   duplicar, apagar, mover, mudar a velocidade ou a duração e substituir o ficheiro.
 * - `fx` são os efeitos do clipe (`ClipFx`, lib/studio/effects.ts): passa tal e qual em todas as operações (dividir e
 *   duplicar copiam-no). Com rampa, o clipe dura `fxSeconds(corte, velocidade, fx)`: o estúdio passa sempre as durações
 *   (`durations`) e, ao cortar, a taxa (`rate`, segundos do ficheiro por segundo da sequência).
 * - O total valida-se contra as regras (lib/tchekaRules, máximo de 60 s): cortar e duplicar não deixam passar dos 60 s.
 *
 * Só importa tipos (o node corre este ficheiro direto, sem resolver caminhos sem extensão).
 */
import type { RuleClip, Trim } from '../tchekaRules';
import type { ClipFx } from './effects';

/** O máximo de uma tcheka (o mesmo que `TCHEKA_MAX_S`; um teste confirma). */
export const PROJECT_MAX_S = 60;
/** O mais curto que um clipe pode ficar na sequência (segundos no vídeo final). */
export const MIN_CLIP_S = 0.3;
/** Uma foto fica pelo menos meio segundo. */
export const MIN_PHOTO_S = 0.5;
/** Ao ritmo, uma foto fica de 1 a 16 batidas. */
export const MAX_BEATS = 16;
const EPS = 1e-6;

/** Um clipe da sequência. `key` é única na sequência; `media` é o ficheiro (dividir e duplicar partilham-no). */
export interface ProjectClip {
  key: string;
  media: string;
  uri: string;
  video: boolean;
  mime: string;
  durationMs?: number;
  /** Fotos: segundos no modo manual. */
  seconds: number;
  /** Fotos: batidas no modo ao ritmo. */
  beats: number;
  /** Vídeos: 0,5× a 3×. */
  speed: number;
  /** Vídeos: a duração do ficheiro (s). */
  length: number;
  /** Vídeos: o bocado do ficheiro que entra. */
  trim: Trim;
  hasAudio?: boolean;
  /** Filtro, ajustes, transição de entrada, rampa, inverter e congelar (lib/studio/effects.ts). Trata-se como imutável. */
  fx?: ClipFx;
}

/** O que chega da câmara ou da galeria. */
export interface ClipInput { uri: string; video: boolean; mime: string; durationMs?: number; speed?: number }
export type IdGen = () => string;

let seq = 0;
const stamp = Date.now().toString(36);
/** Chaves únicas (também entre rascunhos abertos noutra sessão). */
export const newId: IdGen = () => { seq += 1; return `${stamp}-${seq.toString(36)}`; };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fin = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) ? n : d);

/** Um clipe novo (foto de 3 s / 2 batidas; vídeo inteiro, à velocidade a que foi gravado). */
export function makeClip(c: ClipInput, ids: IdGen = newId): ProjectClip {
  const length = c.video ? Math.max(0.5, (c.durationMs ?? 5000) / 1000) : 0;
  const key = ids();
  return { uri: c.uri, video: c.video, mime: c.mime, durationMs: c.durationMs, key, media: key, seconds: 3, beats: 2, speed: c.speed && c.speed > 0 ? c.speed : 1, length, trim: { start: 0, end: length } };
}

/** Quanto o clipe dura na sequência (sem o ritmo): o bocado do vídeo à velocidade dele, ou os segundos da foto. */
export const clipDuration = (c: ProjectClip) => (c.video ? Math.max(0, c.trim.end - c.trim.start) / (c.speed > 0 ? c.speed : 1) : c.seconds);
export const baseDurations = (clips: ProjectClip[]) => clips.map(clipDuration);
export const totalOf = (durations: number[]) => durations.reduce((n, d) => n + d, 0);
/** Onde começa cada clipe na sequência. */
export function startsOf(durations: number[]): number[] {
  let t = 0;
  return durations.map((d) => { const s = t; t += d; return s; });
}

/** O clipe no instante `t` e quanto já passou dele. Numa junção conta o seguinte; depois do fim, o último. */
export function locate(durations: number[], t: number): { index: number; local: number } {
  if (!durations.length) return { index: -1, local: 0 };
  let s = 0;
  for (let i = 0; i < durations.length; i++) {
    if (t < s + durations[i] - EPS) return { index: i, local: Math.max(0, t - s) };
    s += durations[i];
  }
  const last = durations.length - 1;
  return { index: last, local: durations[last] };
}

const at = (clips: ProjectClip[], key: string) => clips.findIndex((c) => c.key === key);
const swapAt = (clips: ProjectClip[], i: number, c: ProjectClip) => clips.map((x, k) => (k === i ? c : x));

export type TrimEdge = 'start' | 'end';
export interface TrimResult { clips: ProjectClip[]; /** Bateu no mínimo (o clipe não encolhe mais) ou no máximo (fim do ficheiro ou 60 s). */ hit: 'min' | 'max' | null }

/**
 * Corta pela ponta `edge` arrastada `delta` segundos da sequência (positivo = para a direita), a partir do clipe como estava
 * no início do gesto. Os vídeos mexem no bocado do ficheiro (à velocidade); as fotos na duração (ao ritmo, nas batidas,
 * se vier `beatPeriod`). Nunca abaixo de `MIN_CLIP_S`, nem para lá do ficheiro, nem a passar dos `maxTotal` segundos.
 */
export function trimEdge(clips: ProjectClip[], key: string, edge: TrimEdge, delta: number, opts: { maxTotal?: number; durations?: number[]; beatPeriod?: number; /** Vídeos: segundos do ficheiro por segundo da sequência (a velocidade vezes a média da rampa); sem ela, a velocidade. */ rate?: number } = {}): TrimResult {
  const i = at(clips, key);
  if (i < 0 || !Number.isFinite(delta)) return { clips, hit: null };
  const c = clips[i];
  const durs = opts.durations ?? baseDurations(clips);
  const dur = durs[i] ?? clipDuration(c);
  const room = Math.max(0, (opts.maxTotal ?? PROJECT_MAX_S) - (totalOf(durs) - dur));
  let hit: TrimResult['hit'] = null;
  if (c.video) {
    const sp = opts.rate && opts.rate > 0 && Number.isFinite(opts.rate) ? opts.rate : c.speed > 0 ? c.speed : 1;
    const minSrc = Math.min(MIN_CLIP_S * sp, c.length);
    const maxSrc = Math.max(minSrc, room * sp);
    let { start, end } = c.trim;
    if (edge === 'start') {
      let s = start + delta * sp;
      const lo = Math.max(0, end - maxSrc), hi = end - minSrc;
      if (s >= hi - EPS) { s = hi; hit = 'min'; } else if (s <= lo + EPS && delta < 0) { s = lo; hit = 'max'; }
      start = Math.max(0, s);
    } else {
      let e = end + delta * sp;
      const lo = start + minSrc, hi = Math.min(c.length, start + maxSrc);
      if (e <= lo + EPS) { e = lo; hit = 'min'; } else if (e >= hi - EPS && delta > 0) { e = hi; hit = 'max'; }
      end = Math.min(c.length, e);
    }
    const trim = { start: r3(start), end: r3(end) };
    if (trim.start === c.trim.start && trim.end === c.trim.end) return { clips, hit };
    return { clips: swapAt(clips, i, { ...c, trim }), hit };
  }
  const want = edge === 'end' ? dur + delta : dur - delta;
  let s = want;
  const max = Math.max(MIN_PHOTO_S, room);
  if (s <= MIN_PHOTO_S + EPS) { s = MIN_PHOTO_S; hit = 'min'; } else if (s >= max - EPS) { s = max; hit = 'max'; }
  s = r3(s);
  const period = opts.beatPeriod && opts.beatPeriod > 0 ? opts.beatPeriod : 0;
  const beats = period ? Math.max(1, Math.min(MAX_BEATS, Math.round(s / period))) : c.beats;
  if (period && Math.round(want / period) < 1) hit = 'min';
  if (s === c.seconds && beats === c.beats) return { clips, hit };
  return { clips: swapAt(clips, i, { ...c, seconds: s, beats }), hit };
}

/**
 * Divide no instante `t` da sequência: o clipe que lá está fica em dois (o da direita com chave nova, o mesmo ficheiro e os
 * mesmos efeitos). Não divide a menos de `MIN_CLIP_S` de uma ponta (devolve null).
 */
export function splitAt(clips: ProjectClip[], t: number, opts: { durations?: number[]; ids?: IdGen } = {}): { clips: ProjectClip[]; left: string; right: string } | null {
  const durs = opts.durations ?? baseDurations(clips);
  const { index, local } = locate(durs, t);
  if (index < 0) return null;
  const c = clips[index];
  const dur = durs[index];
  if (local < MIN_CLIP_S - EPS || dur - local < MIN_CLIP_S - EPS) return null;
  const key = (opts.ids ?? newId)();
  let a: ProjectClip, b: ProjectClip;
  if (c.video) {
    const cut = r3(c.trim.start + (local / dur) * (c.trim.end - c.trim.start));
    a = { ...c, trim: { start: c.trim.start, end: cut } };
    b = { ...c, key, trim: { start: cut, end: c.trim.end } };
  } else {
    const k = local / dur;
    const ba = Math.max(1, Math.round(c.beats * k));
    a = { ...c, seconds: r3(Math.max(MIN_PHOTO_S, c.seconds * k)), beats: ba };
    b = { ...c, key, seconds: r3(Math.max(MIN_PHOTO_S, c.seconds * (1 - k))), beats: Math.max(1, c.beats - ba) };
  }
  return { clips: [...clips.slice(0, index), a, b, ...clips.slice(index + 1)], left: a.key, right: b.key };
}

/** Duplica o clipe logo a seguir a ele. Não duplica se a cópia passar dos `maxTotal` segundos (devolve null). */
export function duplicateClip(clips: ProjectClip[], key: string, opts: { durations?: number[]; ids?: IdGen; maxTotal?: number } = {}): { clips: ProjectClip[]; key: string } | null {
  const i = at(clips, key);
  if (i < 0) return null;
  const durs = opts.durations ?? baseDurations(clips);
  if (totalOf(durs) + (durs[i] ?? 0) > (opts.maxTotal ?? PROJECT_MAX_S) + 0.05) return null;
  const copy = { ...clips[i], key: (opts.ids ?? newId)() };
  return { clips: [...clips.slice(0, i + 1), copy, ...clips.slice(i + 1)], key: copy.key };
}

export const removeClip = (clips: ProjectClip[], key: string) => (at(clips, key) < 0 ? clips : clips.filter((c) => c.key !== key));

/** Muda o clipe da posição `from` para `to` (os outros chegam-se). */
export function moveClip(clips: ProjectClip[], from: number, to: number): ProjectClip[] {
  if (from < 0 || from >= clips.length) return clips;
  const j = Math.max(0, Math.min(clips.length - 1, Math.round(to)));
  if (j === from) return clips;
  const n = [...clips];
  const [c] = n.splice(from, 1);
  n.splice(j, 0, c);
  return n;
}

/** A velocidade de um vídeo (0,25× a 4×); nas fotos não muda nada. */
export function setSpeed(clips: ProjectClip[], key: string, speed: number): ProjectClip[] {
  const i = at(clips, key);
  if (i < 0 || !clips[i].video || !(speed > 0)) return clips;
  const sp = Math.max(0.25, Math.min(4, speed));
  return clips[i].speed === sp ? clips : swapAt(clips, i, { ...clips[i], speed: sp });
}

/** A duração de uma foto (segundos e, ao ritmo, batidas). */
export function setPhoto(clips: ProjectClip[], key: string, p: { seconds?: number; beats?: number }): ProjectClip[] {
  const i = at(clips, key);
  if (i < 0 || clips[i].video) return clips;
  const c = clips[i];
  const seconds = p.seconds != null && Number.isFinite(p.seconds) ? r3(Math.max(MIN_PHOTO_S, Math.min(PROJECT_MAX_S, p.seconds))) : c.seconds;
  const beats = p.beats != null && Number.isFinite(p.beats) ? Math.max(1, Math.min(MAX_BEATS, Math.round(p.beats))) : c.beats;
  return seconds === c.seconds && beats === c.beats ? clips : swapAt(clips, i, { ...c, seconds, beats });
}

/**
 * Troca o ficheiro do clipe e fica com o lugar, os efeitos e a duração que ele tinha (o vídeo novo entra do início, com o
 * mesmo tempo, se tiver para isso; a foto fica com os mesmos segundos).
 */
export function replaceMedia(clips: ProjectClip[], key: string, m: ClipInput & { media?: string }, opts: { durations?: number[]; ids?: IdGen } = {}): ProjectClip[] {
  const i = at(clips, key);
  if (i < 0) return clips;
  const c = clips[i];
  const dur = (opts.durations ?? baseDurations(clips))[i] ?? clipDuration(c);
  const media = m.media ?? (opts.ids ?? newId)();
  const base = { key: c.key, media, uri: m.uri, video: m.video, mime: m.mime, durationMs: m.durationMs, fx: c.fx, beats: c.beats, hasAudio: undefined as boolean | undefined };
  if (m.video) {
    const length = Math.max(0.5, (m.durationMs ?? 5000) / 1000);
    const speed = c.video ? c.speed : m.speed && m.speed > 0 ? m.speed : 1;
    const end = r3(Math.min(length, Math.max(MIN_CLIP_S * speed, dur * speed)));
    const out: ProjectClip = { ...base, seconds: c.seconds, speed, length, trim: { start: 0, end } };
    if (!('fx' in c)) delete out.fx;
    return swapAt(clips, i, out);
  }
  const out: ProjectClip = { ...base, seconds: r3(Math.max(MIN_PHOTO_S, dur)), speed: c.speed, length: 0, trim: { start: 0, end: 0 } };
  if (!('fx' in c)) delete out.fx;
  return swapAt(clips, i, out);
}

/** Os clipes como as regras os leem (com as durações da sequência, ao ritmo se for o caso). */
export const ruleClips = (clips: ProjectClip[], durations = baseDurations(clips)): RuleClip[] => clips.map((c, i) => ({ video: c.video, seconds: durations[i] ?? clipDuration(c), hasAudio: c.hasAudio }));

/** Quanto ainda cabe até aos 60 s (negativo se já passou). */
export const roomLeft = (durations: number[], maxTotal = PROJECT_MAX_S) => maxTotal - totalOf(durations);

/** Repara clipes lidos de um rascunho (números inválidos, cortes fora do ficheiro, chaves repetidas). */
export function normalizeClips(raw: unknown, ids: IdGen = newId): ProjectClip[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ProjectClip[] = [];
  for (const x of raw as Partial<ProjectClip>[]) {
    if (!x || typeof x !== 'object' || typeof x.uri !== 'string' || !x.uri) continue;
    const video = !!x.video;
    let key = typeof x.key === 'string' && x.key ? x.key : ids();
    if (seen.has(key)) key = ids();
    seen.add(key);
    const length = video ? Math.max(0.5, fin(x.length, fin(x.durationMs, 5000) / 1000)) : 0;
    const speed = Math.max(0.25, Math.min(4, fin(x.speed, 1) || 1));
    let start = Math.max(0, Math.min(length, fin(x.trim?.start, 0)));
    let end = Math.max(0, Math.min(length, fin(x.trim?.end, length)));
    if (video && end - start < MIN_CLIP_S * speed) { end = Math.min(length, start + MIN_CLIP_S * speed); start = Math.max(0, end - MIN_CLIP_S * speed); }
    const c: ProjectClip = {
      key, media: typeof x.media === 'string' && x.media ? x.media : key, uri: x.uri, video, mime: typeof x.mime === 'string' ? x.mime : video ? 'video/mp4' : 'image/jpeg',
      durationMs: typeof x.durationMs === 'number' ? x.durationMs : undefined,
      seconds: Math.max(MIN_PHOTO_S, Math.min(PROJECT_MAX_S, fin(x.seconds, 3))), beats: Math.max(1, Math.min(MAX_BEATS, Math.round(fin(x.beats, 2)))),
      speed, length, trim: { start: r3(start), end: r3(end) },
      ...(typeof x.hasAudio === 'boolean' ? { hasAudio: x.hasAudio } : {}),
      ...('fx' in x ? { fx: x.fx } : {}),
    };
    out.push(c);
  }
  return out;
}
