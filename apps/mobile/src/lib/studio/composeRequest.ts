/**
 * Do projeto do estúdio ao pedido de montagem no servidor (`POST /tchekas/compose`), sem React nem rede (testado em
 * tests/studioCompose.test.mjs). O contrato está em docs/montagem.md (secções 2, 4-A e 4-B) e docs/estudio-efeitos.md.
 *
 * - Cada clipe leva a chave dele (`id`), o corte, a velocidade (vídeos), a duração (fotos) e os efeitos (`fx`).
 * - Com 2 ou mais clipes, todos (menos o primeiro) levam a transição escrita, mesmo a de sempre (fundido de 0,5 s): assim o
 *   servidor entra no «modo estúdio» e o vídeo sai com as transições que a pré-visualização mostrou.
 * - O som: a música (ou o som de outra tcheka), o trecho, os fades, o ducking, a voz-off, os efeitos de voz e os sonoros.
 * - O som de cada vídeo vai em `sound: false` (calado) e `volume` (0 a 1), com os nomes do `ProjectClip`.
 * - `compatRequest` tira o que um servidor mais antigo (só com a secção 4-B) ainda não conhece: os panos de capulana, o
 *   enquadramento das fotos e o som por clipe. Usa-se uma vez, quando o servidor responde «Pedido inválido (…)».
 *
 * Só importa tipos (o node corre este ficheiro direto).
 */
import type { StudioMix } from './audioMix';
import type { ClipFx, Overlay, TransitionId } from './effects';
import type { ProjectClip } from './project';

/** As velocidades que a montagem aceita (as da câmara: `SPEEDS` em lib/tchekaRules). */
export const COMPOSE_SPEEDS = [0.5, 1, 2, 3] as const;
/** Uma foto fica de 0,3 a 10 s (sem ritmo). */
export const PHOTO_MIN_MS = 300;
export const PHOTO_MAX_MS = 10_000;
export const COMPOSE_MAX_CLIPS = 30;
export const COMPOSE_MAX_OVERLAYS = 20;
export const COMPOSE_MAX_SFX = 30;
const MAX_FADE_MS = 3000;

export interface ComposeClip {
  id: string;
  mediaId: string;
  kind: 'video' | 'photo';
  trimStartMs?: number;
  trimEndMs?: number;
  speed?: number;
  durationMs?: number;
  beats?: 1 | 2 | 4;
  fx?: ClipFx;
  /** O som do próprio vídeo: `false` = calado (sem o campo, ligado). */
  sound?: false;
  /** O volume do som do vídeo, de 0 a 1 (sem o campo, 1). Multiplica pelo `originalVolume`. */
  volume?: number;
}
export interface ComposeRequest {
  clips: ComposeClip[];
  sound?: { kind: 'music'; music: Record<string, unknown> } | { kind: 'sound'; soundId: string };
  originalVolume?: number;
  musicVolume?: number;
  musicStartMs?: number;
  musicFadeInMs?: number;
  musicFadeOutMs?: number;
  ducking?: boolean;
  voiceOver?: { mediaId: string; startMs: number; volume: number; effect: string };
  originalEffect?: string;
  soundEffects?: { id: string; atMs: number }[];
  soundEffectsVolume?: number;
  beats?: { mode: 'auto' | 'manual'; perPhoto?: 1 | 2 | 4; bpm?: number };
  overlays?: Overlay[];
  coverMs?: number;
  duet?: { postId: string; layout: 'side' };
}

export interface ComposeInput {
  clips: ProjectClip[];
  /** O id no servidor de cada ficheiro já enviado, pela chave `media` do clipe. */
  mediaIds: Record<string, string>;
  /** As camadas (já limpas com `sanitizeOverlay`). */
  overlays: readonly Overlay[];
  mix: StudioMix;
  /** O id no servidor da voz-off enviada (sem ele, a voz-off não vai). */
  voiceMediaId?: string | null;
  /** A música como vai para o servidor (`musicPayload` de lib/api.music); null sem música. */
  music?: Record<string, unknown> | null;
  /** «Usar este som»: o id do som (ganha à música). */
  soundId?: string | null;
  origVol: number;
  musicVol: number;
  /** As fotos mudam nas batidas da música (o servidor lê as batidas do trecho). */
  rhythm: boolean;
  /** O andamento que a app estimou (o servidor usa-o se não conseguir ler as batidas). */
  bpm?: number | null;
  /** Segundos da tcheka (como a pré-visualização a mostra, até 60). */
  total: number;
  /** O instante da capa (segundos). */
  coverAt: number;
  /** Dueto: a publicação ao lado. */
  duetPostId?: string | null;
}

const ms = (s: number) => Math.max(0, Math.round((Number.isFinite(s) ? s : 0) * 1000));
const unit = (v: number, d = 1) => Math.round(Math.max(0, Math.min(1, Number.isFinite(v) ? v : d)) * 100) / 100;
const beatsOf = (b: number): 1 | 2 | 4 => (b >= 3 ? 4 : b >= 2 ? 2 : 1);
const CAPULANA_FALLBACK: Record<string, string> = {
  'capulana-deslizar': 'deslizar-esquerda', 'capulana-desenrolar': 'deslizar-baixo', 'capulana-rasgar': 'zoom', 'capulana-losango': 'zoom', 'capulana-vento': 'deslizar-esquerda',
};

/** Os efeitos de um clipe como o servidor os aceita: sem rampa nem inverso nas fotos, sem congelar nos vídeos. */
export function clipFxFor(c: ProjectClip, index: number, keys: ReadonlySet<string>, many: boolean): ClipFx | undefined {
  const src = c.fx ?? {};
  const fx: ClipFx = {};
  if (src.filter && src.filter.id && src.filter.id !== 'normal') fx.filter = { id: src.filter.id, amount: unit(src.filter.amount) };
  if (src.adjust && Object.keys(src.adjust).length) fx.adjust = { ...src.adjust };
  // A transição é a entrada do clipe: no primeiro não conta; nos outros vai sempre escrita (a de sempre é o fundido de 0,5 s).
  if (index > 0 && many) {
    const t = src.transition ?? { type: 'fundido' as const, dur: 0.5 };
    fx.transition = { type: t.type, dur: Math.round(Math.max(0.15, Math.min(1.5, t.dur)) * 100) / 100, ...(t.pano ? { pano: t.pano } : {}) };
  }
  if (c.video) {
    if (src.ramp) fx.ramp = src.ramp;
    if (src.reverse) fx.reverse = true;
  } else {
    // O frame congelado tem de vir de um clipe desta tcheka: se o vídeo de onde veio já saiu, aponta para a própria foto.
    if (src.freeze) fx.freeze = { from: keys.has(src.freeze.from) ? src.freeze.from : c.key, at: Math.round(Math.max(0, src.freeze.at) * 1000) / 1000 };
    if (src.focus) fx.focus = src.focus;
    if (src.moldura) fx.moldura = src.moldura;
  }
  return Object.keys(fx).length ? fx : undefined;
}

/** O pedido de montagem deste projeto. Os clipes sem ficheiro enviado ficam de fora (quem chama confirma antes com `missingMedia`). */
export function buildComposeRequest(i: ComposeInput): ComposeRequest {
  const keys = new Set(i.clips.map((c) => c.key));
  const list = i.clips.filter((c) => !!i.mediaIds[c.media]);
  const many = list.length > 1;
  const withSound = !!i.soundId || !!i.music;
  const clips: ComposeClip[] = list.map((c, k) => {
    const fx = clipFxFor(c, k, keys, many);
    const base = { id: c.key, mediaId: i.mediaIds[c.media] };
    if (c.video) {
      const out: ComposeClip = { ...base, kind: 'video', trimStartMs: ms(c.trim.start), trimEndMs: ms(c.trim.end) };
      if (c.speed && c.speed !== 1) out.speed = c.speed;
      if (c.sound === false) out.sound = false;
      if (c.volume != null && c.volume < 1) out.volume = unit(c.volume);
      if (fx) out.fx = fx;
      return out;
    }
    const out: ComposeClip = { ...base, kind: 'photo', durationMs: Math.max(PHOTO_MIN_MS, Math.min(PHOTO_MAX_MS, ms(c.seconds))) };
    if (i.rhythm && withSound) out.beats = beatsOf(c.beats);
    if (fx) out.fx = fx;
    return out;
  });

  const req: ComposeRequest = { clips };
  if (i.soundId) req.sound = { kind: 'sound', soundId: i.soundId };
  else if (i.music) req.sound = { kind: 'music', music: i.music };
  req.originalVolume = unit(i.origVol);
  if (withSound || i.duetPostId) req.musicVolume = unit(i.musicVol);
  if (withSound) {
    req.musicStartMs = Math.max(0, Math.round(i.mix.musicStartMs || 0));
    req.musicFadeInMs = Math.min(MAX_FADE_MS, ms(i.mix.fadeIn));
    req.musicFadeOutMs = Math.min(MAX_FADE_MS, ms(i.mix.fadeOut));
  }
  const v = i.mix.voice;
  if (v && i.voiceMediaId && v.at < i.total) {
    req.voiceOver = { mediaId: i.voiceMediaId, startMs: ms(v.at), volume: unit(v.volume), effect: v.fx };
    req.ducking = !!i.mix.ducking;
  }
  if (i.mix.origFx && i.mix.origFx !== 'normal') req.originalEffect = i.mix.origFx;
  const sfx = i.mix.sfx.filter((s) => s.at >= 0 && s.at < i.total).sort((a, b) => a.at - b.at).slice(0, COMPOSE_MAX_SFX).map((s) => ({ id: s.id as string, atMs: ms(s.at) }));
  if (sfx.length) { req.soundEffects = sfx; req.soundEffectsVolume = unit(i.mix.sfxVolume); }
  if (i.rhythm && withSound && list.some((c) => !c.video)) {
    req.beats = { mode: 'auto', ...(i.bpm && i.bpm >= 40 && i.bpm <= 240 ? { bpm: Math.round(i.bpm * 10) / 10 } : {}) };
  }
  // As camadas que só entram depois do fim não vão; as que passam do fim ficam até ao fim.
  const overlays = i.overlays.filter((o) => o.start < i.total - 0.05).slice(0, COMPOSE_MAX_OVERLAYS).map((o) => (o.end > i.total ? { ...o, end: Math.max(o.start + 0.1, Math.round(i.total * 1000) / 1000) } : o));
  if (overlays.length) req.overlays = overlays;
  req.coverMs = Math.min(ms(i.coverAt), Math.max(0, ms(i.total) - 100));
  if (i.duetPostId) req.duet = { postId: i.duetPostId, layout: 'side' };
  return req;
}

/** As chaves `media` dos ficheiros que ainda não têm id no servidor (têm de ser enviados antes do pedido). */
export function missingMedia(clips: ProjectClip[], mediaIds: Record<string, string>): string[] {
  const out: string[] = [];
  for (const c of clips) if (!mediaIds[c.media] && !out.includes(c.media)) out.push(c.media);
  return out;
}

/** O que impede a montagem no servidor antes de se enviar nada (frases para a pessoa); null quando está tudo bem. */
export function composeBlocker(clips: ProjectClip[]): string | null {
  if (clips.length > COMPOSE_MAX_CLIPS) return `No máximo ${COMPOSE_MAX_CLIPS} clipes numa tcheka`;
  const odd = clips.find((c) => c.video && !(COMPOSE_SPEEDS as readonly number[]).includes(c.speed));
  if (odd) return 'A velocidade de um vídeo tem de ser 0,5×, 1×, 2× ou 3×';
  return null;
}

/**
 * O mesmo pedido sem o que só o servidor mais novo conhece: os panos (transições, molduras, letras, faixas e stickers de
 * capulana), o enquadramento das fotos e o som por clipe. `changed` diz o que saiu, para avisar a pessoa.
 */
export function compatRequest(r: ComposeRequest): { request: ComposeRequest; changed: string[] } {
  const changed = new Set<string>();
  const videos = r.clips.filter((c) => c.kind === 'video');
  const allMuted = videos.length > 0 && videos.every((c) => c.sound === false || c.volume === 0);
  const clips = r.clips.map((c) => {
    const { sound, volume, ...rest } = c;
    if (sound === false || volume != null) changed.add('o som de cada vídeo');
    if (!rest.fx) return rest;
    const fx: ClipFx = { ...rest.fx };
    if (fx.focus) { delete fx.focus; changed.add('o enquadramento das fotos'); }
    if (fx.moldura) { delete fx.moldura; changed.add('as molduras de capulana'); }
    if (fx.transition) {
      const type = CAPULANA_FALLBACK[fx.transition.type];
      if (type || fx.transition.pano) { fx.transition = { type: (type ?? fx.transition.type) as TransitionId, dur: fx.transition.dur }; changed.add('as transições de pano'); }
    }
    return Object.keys(fx).length ? { ...rest, fx } : (() => { const { fx: _fx, ...bare } = rest; return bare; })();
  });
  const overlays = (r.overlays ?? []).flatMap((o): Overlay[] => {
    if (o.kind === 'sticker') { if (o.sticker.type === 'capulana') { changed.add('os stickers de capulana'); return []; } return [o]; }
    if (!o.pano && o.bg !== 'pano') return [o];
    changed.add('as letras e faixas de capulana');
    const { pano: _pano, ...text } = o;
    return [{ ...text, bg: text.bg === 'pano' ? 'cheio' : text.bg }];
  });
  const request: ComposeRequest = { ...r, clips };
  if (r.overlays) { if (overlays.length) request.overlays = overlays; else delete request.overlays; }
  // Todos os vídeos calados: o som original sai inteiro (o que o servidor antigo sabe fazer).
  if (allMuted && changed.has('o som de cada vídeo')) request.originalVolume = 0;
  return { request, changed: [...changed] };
}

/** Uma assinatura curta do pedido (o mesmo projeto dá a mesma): para saber se uma montagem em curso é desta tcheka. */
export function requestSignature(parts: unknown): string {
  const s = JSON.stringify(parts);
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
  return `${(h >>> 0).toString(36)}:${s.length}`;
}
