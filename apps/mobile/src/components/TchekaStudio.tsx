import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Track } from '@/lib/api.music';
import { useAuth } from '@/lib/auth';
import { abs } from '@/lib/config';
import { stickerById } from '@/lib/stickers';
import {
  animState, freezeSplit, fxSeconds, newSticker, newText, playbackRateAt, resolveFx, restingTime, reverseFrameIndex, sanitizeFx, sourceOffset, transitionFor,
  type ClipFx, type Overlay, type StickerContent, type StickerOverlay, type TextOverlay,
} from '@/lib/studio/effects';
import { loadStudioFonts } from '@/lib/studio/renderFonts';
import { drawClip, FxGL } from '@/lib/studio/renderGL';
import { drawOverlays, type OverlayBox } from '@/lib/studio/renderOverlays';
import { ReverseFrames } from '@/lib/studio/renderReverse';
import { drawTransition, type Scratch } from '@/lib/studio/renderTransitions';
import {
  beatGrid, checkTcheka, clampTrim, detectBeats, editLocked, fmtS, previewClock, previewResume, rhythmDurations, SPEEDS, speedLabel, studioSignature, TCHEKA_MAX_S, type Trim,
} from '@/lib/tchekaRules';
import { colors } from '@/lib/theme';
import { sealOf } from '@/lib/wordmark';
import { Icon } from './Icon';
import { MusicPicker } from './MusicPicker';
import { RangeSlider } from './RangeSlider';
import type { FrameGrab } from './studio/FxFilterStrip';
import { FxPanel, type FxTarget, type ReverseState } from './studio/FxPanel';
import { FxStage } from './studio/FxStage';
import { StickerTray } from './studio/StickerTray';
import { TextPanel } from './studio/TextPanel';
import { GalleryPick, stampTxillapp, type Shot } from './TxCamera';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const W = 1080;
const H = 1920;
const PHOTO_S = [2, 3, 5] as const;
const PHOTO_BEATS = [1, 2, 4] as const;
type Tab = 'clipes' | 'som' | 'texto' | 'stickers' | 'efeitos' | 'capa';

export interface Clip { uri: string; video: boolean; mime: string; durationMs?: number; /** Velocidade a que foi gravado na câmara (0,5× a 3×). */ speed?: number }
type Item = Clip & {
  /** Filtro, ajustes, transição de entrada, rampa, inverter e congelar (lib/studio/effects.ts, docs/estudio-efeitos.md). */
  fx?: ClipFx;
  key: string;
  /** Fotos: segundos no modo manual. */
  seconds: number;
  /** Fotos: batidas no modo ao ritmo. */
  beats: number;
  speed: number;
  /** Vídeos: duração do ficheiro (s) e o bocado que entra. */
  length: number;
  trim: Trim;
  hasAudio?: boolean;
};
/** Um bocado da sequência já montada: onde começa, quanto dura e de onde vem. */
interface Seg { key: string; uri: string; video: boolean; start: number; dur: number; from: number; speed: number; /** segundos do corte (nos vídeos) */ len: number; fx?: ClipFx }
/** Como acabou uma volta da sequência: até ao fim ou interrompida; e o vídeo, se se gravou e ainda vale. */
interface RunOut { finished: boolean; blob: Blob | null }

const recorderType = () => ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let itemSeq = 0;

function makeItem(c: Clip): Item {
  const length = c.video ? Math.max(0.5, (c.durationMs ?? 5000) / 1000) : 0;
  itemSeq += 1;
  return { ...c, key: `${itemSeq}-${c.uri}`, seconds: 3, beats: 2, speed: c.speed ?? 1, length, trim: { start: 0, end: length } };
}

/** Lê se um vídeo tem som: descodifica o áudio do ficheiro (sem faixa de áudio, a descodificação falha) e vê se não é silêncio. */
async function probeAudio(uri: string): Promise<boolean | undefined> {
  try {
    const OAC = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!OAC) return undefined;
    const buf = await (await fetch(uri)).arrayBuffer();
    if (buf.byteLength > 40 * 1024 * 1024) return undefined; // pesado demais para ler aqui: conta como tendo som
    const audio = await new OAC(1, 1, 44100).decodeAudioData(buf);
    const d = audio.getChannelData(0);
    for (let i = 0; i < d.length; i += 97) if (Math.abs(d[i]) > 0.002) return true;
    return false;
  } catch {
    return false;
  }
}

/** Fotos e vídeos da galeria, já como clipes (os vídeos com a duração lida). */
async function filesToClips(files: File[]): Promise<Clip[]> {
  const out: Clip[] = [];
  for (const f of files) {
    const uri = URL.createObjectURL(f);
    if (f.type.startsWith('video/')) {
      const ms = await new Promise<number>((done) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0);
        v.onerror = () => done(0);
        v.src = uri;
      });
      out.push({ uri, video: true, mime: f.type || 'video/mp4', durationMs: ms || undefined });
    } else out.push({ uri, video: false, mime: f.type || 'image/jpeg' });
  }
  return out;
}

/**
 * Estúdio de tchekas, ao estilo do TikTok: junta fotos e vídeos numa sequência e grava um vídeo só (9:16, até 60 s).
 * - Regras para seguir (lib/tchekaRules): 3 fotos, ou 3 s de vídeo, ou 5 s misturados; som obrigatório (música, um som
 *   de outra tcheka ou o som original dos vídeos); só com fotos, a música é obrigatória; até 60 s. O botão fica desligado,
 *   com a dica por baixo.
 * - Ao ritmo: com música, as fotos mudam nas batidas (deteção por Web Audio; sem ela, 120 BPM).
 * - Edição: cortar e reordenar os clipes, velocidade, volume do original contra a música e a capa.
 * - Efeitos por clipe (components/studio, lib/studio): 16 filtros com intensidade e miniaturas ao vivo, ajustes (WebGL),
 *   transições por junção, rampas de velocidade, inverter e congelar; textos e stickers (emoji, Txillapp, GIF, @, local,
 *   hora) com animações, a mexer na pré-visualização, com zona segura e guias. O contrato está em docs/estudio-efeitos.md.
 * - Pré-visualização fiel: é o próprio canvas da montagem a tocar, com o som misturado. A primeira volta inteira fica
 *   gravada; se nada mudar, «Seguinte» já não espera pela montagem.
 * - `reference`: um vídeo de referência ao lado (dueto): fica na metade esquerda e a tcheka na direita; o som dele conta
 *   como o som da tcheka.
 */
export function TchekaStudio({ clips, initialMusic, reference, onDone, onClose }: {
  clips: Clip[];
  initialMusic: Track | null;
  reference?: { uri: string } | null;
  onDone: (shot: Shot, music: Track | null) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const username = user?.username;
  const seal = sealOf(user);
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>(() => clips.map(makeItem));
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<Tab>('clipes');
  /** Os textos e stickers por cima (lib/studio/effects.ts, `Overlay`), cada um com início e fim. */
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [selOv, setSelOv] = useState<string | null>(null);
  const [editTick, setEditTick] = useState(0);
  const [stageTick, setStageTick] = useState(0);
  /** Sobe quando chega uma coisa que o desenho esperava (fontes, frames do inverso, imagens dos stickers). */
  const [assetTick, setAssetTick] = useState(0);
  const [revState, setRevState] = useState<Record<string, ReverseState>>({});
  const [freezing, setFreezing] = useState(false);
  const [music, setMusic] = useState<Track | null>(initialMusic);
  const [pickMusic, setPickMusic] = useState(false);
  const [rhythm, setRhythm] = useState(true);
  const [beatInfo, setBeatInfo] = useState<{ url: string; bpm: number | null; offset: number; detected: boolean } | null>(null);
  // Com um som de outra tcheka (que costuma ser para dobrar), o original começa calado; com música, mais baixo.
  const [origVol, setOrigVol] = useState(initialMusic ? (initialMusic.kind === 'sound' ? 0 : 0.4) : 1);
  const [musicVol, setMusicVol] = useState(1);
  const [coverAt, setCoverAt] = useState(0.5);
  const [playing, setPlayingState] = useState(true);
  const [playT, setPlayT] = useState(0);
  // O estado da pré-visualização também em refs: os temporizadores e o ciclo leem sempre o valor de agora.
  const playingRef = useRef(true);
  const tRef = useRef(0);
  const setPlaying = (on: boolean) => { playingRef.current = on; setPlayingState(on); };
  const setT = (t: number) => { tRef.current = t; setPlayT(t); };
  const [loading, setLoading] = useState(true);
  const [progress, setProgressState] = useState<number | null>(null);
  // A montagem em curso (null quando não há): enquanto dura, a edição fica bloqueada (ver `editLocked`).
  const progressRef = useRef<number | null>(null);
  const setProgress = (p: number | null) => { progressRef.current = p; setProgressState(p); };
  const cancelled = useRef(false);
  const editBox = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = editBox.current as (HTMLElement & { inert?: boolean }) | null;
    if (!el || typeof el.setAttribute !== 'function') return;
    el.inert = progress !== null;
    if (progress !== null) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    // Quem estava a escrever no texto sai do campo (o teclado deixa de mexer na montagem).
    if (progress !== null && typeof document !== 'undefined' && el.contains(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur?.();
  }, [progress !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState('');
  const [readyTick, setReadyTick] = useState(0);

  // ---------------------------------------------------------------- a sequência
  const photosOnly = items.length > 0 && items.every((i) => !i.video);
  const useRhythm = rhythm && !!music && items.some((i) => !i.video);
  const grid = useMemo(() => (useRhythm ? beatGrid(beatInfo?.bpm ?? null, beatInfo?.offset ?? 0, TCHEKA_MAX_S + 30) : []), [useRhythm, beatInfo]);
  const durations = useMemo(() => {
    // Os vídeos: o corte, à velocidade e com a rampa (lib/studio/effects.ts, fxSeconds).
    const base = items.map((it) => (it.video ? fxSeconds(it.trim.end - it.trim.start, it.speed, it.fx) : it.seconds));
    return useRhythm ? rhythmDurations(items.map((it, i) => ({ video: it.video, seconds: base[i], beats: it.beats })), grid) : base;
  }, [items, useRhythm, grid]);
  const segs: Seg[] = useMemo(() => {
    let t = 0;
    return items.map((it, i) => {
      const s = { key: it.key, uri: it.uri, video: it.video, start: t, dur: durations[i], from: it.video ? it.trim.start : 0, speed: it.video ? it.speed : 1, len: it.video ? Math.max(0, it.trim.end - it.trim.start) : durations[i], fx: it.fx };
      t += durations[i];
      return s;
    });
  }, [items, durations]);
  const total = durations.reduce((n, d) => n + d, 0);
  const playTotal = Math.min(total, TCHEKA_MAX_S);
  // Um vídeo ao contrário fica com o som original calado (não conta para o som obrigatório).
  const rules = checkTcheka({ clips: items.map((it, i) => ({ video: it.video, seconds: durations[i], hasAudio: it.fx?.reverse ? false : it.hasAudio })), music: !!music || !!reference, originalVolume: origVol });
  const cur = items[sel] ?? items[0];

  // Nem os textos e stickers nem a capa passam do fim.
  useEffect(() => {
    setCoverAt((v) => Math.min(v, Math.max(0, playTotal - 0.1)));
    if (!playTotal) return;
    setOverlays((l) => {
      let changed = false;
      const n = l.map((o) => {
        if (o.end <= playTotal + 1e-3) return o;
        changed = true;
        const end = Math.max(Math.min(o.end, playTotal), Math.min(playTotal, o.start + 0.5));
        return { ...o, start: Math.min(o.start, Math.max(0, end - 0.5)), end };
      });
      return changed ? n : l;
    });
  }, [playTotal]);

  /** O que muda o tempo da sequência (obriga a recomeçar a pré-visualização). */
  const timelineSig = studioSignature({ s: segs.map((s) => [s.uri, s.start, s.dur, s.from, s.speed, s.fx?.ramp ?? 0, s.fx?.reverse ? 1 : 0]), m: music?.url ?? null, r: reference?.uri ?? null });
  /** Tudo o que muda o vídeo final (para saber se a volta gravada ainda vale). */
  const fullSig = studioSignature({ t: timelineSig, fx: items.map((it) => it.fx ?? null), ov: overlays, a: assetTick, origVol, musicVol });
  const fxs: Record<string, ClipFx | undefined> = {};
  for (const it of items) fxs[it.key] = it.fx;
  const live = { overlays, fxs, origVol, musicVol, segs, total: playTotal, fullSig };
  const cfg = useRef(live);
  cfg.current = live;

  // ---------------------------------------------------------------- o motor (canvas + Web Audio + MediaRecorder)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engine = useRef<{
    ac: AudioContext | null; dest: MediaStreamAudioDestinationNode | null; speak: GainNode | null; musicGain: GainNode | null; origGain: GainNode | null;
    stream: MediaStream | null; videos: Map<string, HTMLVideoElement>; images: Map<string, HTMLImageElement>; sources: WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>;
    music: { url: string; buf: AudioBuffer } | null; last: HTMLCanvasElement | null; lastKey: string | null; ref: HTMLVideoElement | null;
    /** O WebGL dos efeitos (null: o browser não tem; undefined: ainda não se criou). */
    gl: FxGL | null | undefined; scratch: Map<string, { c: HTMLCanvasElement; g: CanvasRenderingContext2D }>;
    /** As imagens dos stickers do Txillapp e dos GIFs. */
    ovImages: Map<string, { img: HTMLImageElement; w: number; h: number } | 'loading' | 'error'>;
    /** Os frames dos vídeos ao contrário, por corte. */
    reverse: Map<string, ReverseFrames>;
    /** Onde ficaram os textos e stickers no último frame (para os agarrar na pré-visualização). */
    boxes: OverlayBox[];
  }>({ ac: null, dest: null, speak: null, musicGain: null, origGain: null, stream: null, videos: new Map(), images: new Map(), sources: new WeakMap(), music: null, last: null, lastKey: null, ref: null, gl: undefined, scratch: new Map(), ovImages: new Map(), reverse: new Map(), boxes: [] });
  const gifBox = useRef<HTMLDivElement | null>(null);
  const revJobs = useRef(new Map<string, Promise<ReverseFrames | null>>());
  const gen = useRef(0);
  const pausedAt = useRef(0);
  const restartFrom = useRef(0);
  /** A última volta inteira gravada (e de que montagem é). */
  const ready = useRef<{ sig: string; blob: Blob; mime: string } | null>(null);
  const dirty = useRef(false);
  const recording = useRef(false);
  const alive = useRef(true);
  const probing = useRef(new Set<string>());
  useEffect(() => { if (recording.current) dirty.current = true; }, [fullSig]);
  useEffect(() => () => {
    alive.current = false;
    gen.current += 1;
    const e = engine.current;
    e.videos.forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
    e.ref?.pause();
    e.reverse.forEach((r) => r.dispose());
    e.ovImages.forEach((x) => { if (typeof x === 'object') x.img.remove(); });
    void e.ac?.close().catch(() => undefined);
  }, []);
  // As fontes do texto: quando chegam, o frame parado volta a desenhar-se com elas.
  useEffect(() => { void loadStudioFonts().then(() => { if (alive.current) setAssetTick((n) => n + 1); }); }, []);

  function audio() {
    const e = engine.current;
    if (e.ac) return e;
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) return e;
    const ac = new AC();
    const dest = ac.createMediaStreamDestination();
    const master = ac.createGain();
    const speak = ac.createGain();
    const musicGain = ac.createGain();
    const origGain = ac.createGain();
    musicGain.connect(master);
    origGain.connect(master);
    master.connect(dest);
    master.connect(speak);
    speak.connect(ac.destination);
    Object.assign(e, { ac, dest, speak, musicGain, origGain });
    return e;
  }
  function videoFor(key: string, uri: string): HTMLVideoElement {
    const e = engine.current;
    let v = e.videos.get(key);
    if (!v || v.dataset.src !== uri) {
      v = document.createElement('video');
      v.dataset.src = uri;
      v.playsInline = true;
      v.preload = 'auto';
      v.crossOrigin = 'anonymous';
      v.setAttribute('playsinline', '');
      v.src = uri;
      e.videos.set(key, v);
    }
    return v;
  }
  function imageFor(uri: string): Promise<HTMLImageElement> {
    const e = engine.current;
    const have = e.images.get(uri);
    if (have?.complete && have.naturalWidth) return Promise.resolve(have);
    return new Promise((res, rej) => {
      const i = have ?? new Image();
      i.addEventListener('load', () => res(i), { once: true });
      i.addEventListener('error', () => rej(new Error('foto')), { once: true });
      if (!have) { i.src = uri; e.images.set(uri, i); }
    });
  }
  function routeAudio(el: HTMLMediaElement, to: 'orig' | 'music') {
    const e = audio();
    if (!e.ac || e.sources.has(el)) return;
    try { const s = e.ac.createMediaElementSource(el); s.connect(to === 'orig' ? e.origGain! : e.musicGain!); e.sources.set(el, s); } catch { /* sem Web Audio para este elemento */ }
  }
  async function loadMusic(t: Track) {
    const e = audio();
    if (!e.ac) return null;
    if (e.music?.url !== t.url) e.music = { url: t.url, buf: await e.ac.decodeAudioData(await (await fetch(abs(t.url) ?? t.url)).arrayBuffer()) };
    return e.music;
  }
  /** Prepara tudo o que a sequência precisa (fotos, vídeos, música, sticker): da segunda vez já está em memória. */
  async function preload(list: Seg[]) {
    const e = audio();
    await Promise.all(list.map(async (s) => {
      if (!s.video) { await imageFor(s.uri).catch(() => undefined); return; }
      const v = videoFor(s.key, s.uri);
      routeAudio(v, 'orig');
      if (v.readyState < 2) await Promise.race([new Promise<void>((r) => { v.addEventListener('loadeddata', () => r(), { once: true }); v.addEventListener('error', () => r(), { once: true }); }), wait(6000)]);
    }));
    if (reference) {
      if (!e.ref || e.ref.dataset.src !== reference.uri) {
        const v = document.createElement('video');
        v.dataset.src = reference.uri; v.playsInline = true; v.crossOrigin = 'anonymous'; v.preload = 'auto'; v.src = reference.uri;
        e.ref = v;
      }
      routeAudio(e.ref, 'music');
    }
    if (music) await loadMusic(music).catch(() => undefined);
    await Promise.all(cfg.current.overlays.map((o) => (o.kind === 'sticker' ? loadOvImage(o) : null)));
  }

  // ---------------------------------------------------------------- efeitos: WebGL, imagens dos stickers, inverso
  function glFx(): FxGL | null {
    const e = engine.current;
    if (e.gl === undefined || e.gl?.lost) e.gl = FxGL.create(W, H);
    return e.gl;
  }
  /** Canvas de trabalho (transições), guardados por nome. */
  const scratch: Scratch = (name, w, h) => {
    const e = engine.current;
    let s = e.scratch.get(name);
    if (!s) {
      const c = document.createElement('canvas');
      const g = c.getContext('2d');
      if (!g) return null;
      s = { c, g };
      e.scratch.set(name, s);
    }
    if (s.c.width !== w || s.c.height !== h) { s.c.width = w; s.c.height = h; }
    return s;
  };
  const ovKey = (o: StickerOverlay) => (o.sticker.type === 'txill' ? `txill:${o.sticker.id}` : o.sticker.type === 'gif' ? `gif:${o.sticker.id}` : '');
  /**
   * A imagem de um sticker do Txillapp (o SVG como data URL) ou de um GIF do GIPHY. Os GIFs ficam dentro da página (num
   * cantinho invisível da pré-visualização) para o browser os animar; o canvas desenha o frame de agora. Com CORS (anonymous),
   * para o canvas não ficar «sujo» e a gravação continuar a funcionar.
   */
  function loadOvImage(o: StickerOverlay): Promise<void> {
    const e = engine.current;
    const k = ovKey(o);
    if (!k || e.ovImages.has(k)) return Promise.resolve();
    e.ovImages.set(k, 'loading');
    return new Promise<void>((res) => {
      const img = new Image();
      img.decoding = 'async';
      const done = (ok: boolean, w = 1, h = 1) => {
        e.ovImages.set(k, ok ? { img, w, h } : 'error');
        if (alive.current && ok) setAssetTick((n) => n + 1);
        res();
      };
      if (o.sticker.type === 'txill') {
        const def = stickerById(o.sticker.id);
        // Como imagem (data URL) o SVG precisa do xmlns; dentro da página não precisava.
        const raw = def?.svg;
        const svg = raw && !/xmlns=/.test(raw) ? raw.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ') : raw;
        if (!svg) { done(false); return; }
        img.onload = () => done(true, 1, def?.ratio ?? 1);
        img.onerror = () => done(false);
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      } else if (o.sticker.type === 'gif') {
        img.crossOrigin = 'anonymous';
        img.alt = '';
        img.onload = () => done(true, img.naturalWidth || 1, img.naturalHeight || 1);
        img.onerror = () => { img.remove(); done(false); };
        img.src = o.sticker.url;
        gifBox.current?.appendChild(img);
      } else done(false);
    });
  }
  const ovImage = (o: StickerOverlay) => {
    const x = engine.current.ovImages.get(ovKey(o));
    if (x === undefined) { void loadOvImage(o); return null; }
    return typeof x === 'object' ? x : null;
  };
  /** Os frames ao contrário de um vídeo (tira-os uma vez por corte, com o progresso no painel «Tempo»). */
  function ensureReverse(s: { key: string; uri: string; from: number; len: number }): Promise<ReverseFrames | null> {
    const e = engine.current;
    const k = ReverseFrames.keyOf(s.uri, s.from, s.from + s.len);
    const have = e.reverse.get(k);
    if (have) return Promise.resolve(have);
    const job = revJobs.current.get(k);
    if (job) return job;
    const mark = (st: ReverseState) => { if (alive.current) setRevState((m) => ({ ...m, [s.key]: st })); };
    mark({ status: 'working', progress: 0 });
    const p = ReverseFrames.extract(s.uri, s.from, s.from + s.len, (pr) => mark({ status: 'working', progress: pr }), () => !alive.current).then((rf) => {
      revJobs.current.delete(k);
      if (rf) e.reverse.set(k, rf);
      mark({ status: rf ? 'ready' : 'error', progress: 1 });
      if (rf && alive.current) setAssetTick((n) => n + 1);
      return rf;
    });
    revJobs.current.set(k, p);
    return p;
  }
  const reverseFor = (s: Seg) => engine.current.reverse.get(ReverseFrames.keyOf(s.uri, s.from, s.from + s.len)) ?? null;
  // Os vídeos que estão ao contrário preparam-se logo; os cortes que já não servem libertam a memória.
  useEffect(() => {
    const want = new Set<string>();
    for (const s of segs) {
      if (!s.video || !s.fx?.reverse) continue;
      want.add(ReverseFrames.keyOf(s.uri, s.from, s.from + s.len));
      void ensureReverse(s);
    }
    const e = engine.current;
    for (const [k, r] of e.reverse) if (!want.has(k)) { r.dispose(); e.reverse.delete(k); }
  }, [timelineSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // As batidas da música: lidas do áudio (Web Audio); se não der, o BPM da faixa (se vier) ou 120.
  useEffect(() => {
    if (!music || beatInfo?.url === music.url) return;
    let off = false;
    void (async () => {
      try {
        const m = await loadMusic(music);
        if (!m) throw new Error('sem web audio');
        const n = Math.min(m.buf.length, Math.round(m.buf.sampleRate * (TCHEKA_MAX_S + 5)));
        const info = detectBeats(m.buf.getChannelData(0).subarray(0, n), m.buf.sampleRate);
        if (!off) setBeatInfo({ url: music.url, bpm: info.bpm, offset: info.offset, detected: !!info.bpm });
      } catch {
        if (!off) setBeatInfo({ url: music.url, bpm: (music as Track & { bpm?: number }).bpm ?? null, offset: 0, detected: false });
      }
    })();
    return () => { off = true; };
  }, [music]); // eslint-disable-line react-hooks/exhaustive-deps

  // Se os vídeos têm som (para a regra do som obrigatório).
  useEffect(() => {
    for (const it of items) {
      if (!it.video || it.hasAudio !== undefined || probing.current.has(it.key)) continue;
      probing.current.add(it.key);
      void probeAudio(it.uri).then((has) => { if (alive.current) setItems((l) => l.map((x) => (x.key === it.key ? { ...x, hasAudio: has ?? true } : x))); });
    }
  }, [items]);

  // A duração verdadeira dos vídeos (quando não veio): o corte acompanha.
  useEffect(() => {
    for (const it of items) {
      if (!it.video || it.durationMs) continue;
      const v = videoFor(it.key, it.uri);
      const fix = () => {
        if (!Number.isFinite(v.duration) || v.duration <= 0) return;
        setItems((l) => l.map((x) => (x.key === it.key && !x.durationMs ? { ...x, durationMs: Math.round(v.duration * 1000), length: v.duration, trim: clampTrim({ start: x.trim.start, end: x.trim.end >= x.length - 0.01 ? v.duration : x.trim.end }, v.duration) } : x)));
      };
      if (v.readyState >= 1) fix(); else v.addEventListener('loadedmetadata', fix, { once: true });
    }
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Os efeitos de agora de um clipe (lidos a cada frame: mudam sem recomeçar). */
  const fxOf = (s: Seg): ClipFx | undefined => (s.key in cfg.current.fxs ? cfg.current.fxs[s.key] : s.fx);
  /** Onde está o ficheiro (segundos) no instante `tl` do bocado: o corte, a velocidade, a rampa e o inverso. */
  const srcAt = (s: Seg, tl: number) => s.from + sourceOffset(tl, s.dur, s.len, s.speed, fxOf(s));
  /** O vídeo de referência (dueto) na metade esquerda, sem efeitos. */
  function drawRef(g: CanvasRenderingContext2D) {
    const r = engine.current.ref;
    if (reference && r && r.readyState >= 2) drawClip(g, null, r, r.videoWidth || W, r.videoHeight || H, { x: 0, y: 0, w: W / 2, h: H }, 1, resolveFx(undefined));
  }
  /** O fundo de um bocado no instante `tl` (segundos dentro dele), com os efeitos dele: a foto com zoom suave ou o frame do vídeo. */
  function drawBase(g: CanvasRenderingContext2D, s: Seg, tl: number) {
    const e = engine.current;
    const fx = fxOf(s);
    const p = resolveFx(fx);
    const half = !!(reference && e.ref);
    const to = { x: half ? W / 2 : 0, y: 0, w: half ? W / 2 : W, h: H };
    const seed = Math.floor((s.start + tl) * 30);
    if (s.video) {
      const rf = fx?.reverse ? reverseFor(s) : null;
      const fr = rf ? rf.frame(reverseFrameIndex(srcAt(s, tl) - s.from, rf.count)) : null;
      const v = e.videos.get(s.key);
      if (rf && fr) drawClip(g, glFx(), fr, rf.w, rf.h, to, 1, p, seed);
      else if (v && v.readyState >= 2) drawClip(g, glFx(), v, v.videoWidth || W, v.videoHeight || H, to, 1, p, seed);
    } else {
      const img = e.images.get(s.uri);
      // Zoom suave (Ken Burns); um frame congelado fica parado.
      if (img?.naturalWidth) drawClip(g, glFx(), img, img.naturalWidth, img.naturalHeight, to, fx?.freeze ? 1 : 1 + 0.07 * Math.min(1, tl / Math.max(0.1, s.dur)), p, seed);
    }
    if (half) drawRef(g);
  }
  /** Por cima de cada frame: os textos e os stickers (no tempo deles, com as animações) e a assinatura. */
  function overlay(g: CanvasRenderingContext2D, t: number) {
    const e = engine.current;
    e.boxes = drawOverlays(g, cfg.current.overlays, t, { W, H, image: ovImage });
    stampTxillapp(g, W, H, username, seal);
  }
  /** Um frame inteiro: o fundo (ou a transição a partir do bocado anterior) e as camadas por cima. */
  function drawFrame(g: CanvasRenderingContext2D, list: Seg[], i: number, t: number) {
    const s = list[i];
    const tl = t - s.start;
    const e = engine.current;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const tr = transitionFor(fxOf(s), i, s.dur);
    const cur = tr && tl < tr.dur && e.last && e.lastKey === list[i - 1]?.key ? scratch('cur', W, H) : null;
    if (tr && cur && e.last) {
      cur.g.fillStyle = '#000';
      cur.g.fillRect(0, 0, W, H);
      drawBase(cur.g, s, tl);
      drawTransition(g, e.last, cur.c, tr.type, tl / tr.dur, W, H, scratch);
      if (reference && e.ref) drawRef(g);
    } else drawBase(g, s, tl);
    overlay(g, t);
  }
  const segAt = (list: Seg[], t: number) => { const i = list.findIndex((s) => t < s.start + s.dur); return i < 0 ? list.length - 1 : i; };
  /** Guarda o último frame (sem nada por cima, com os efeitos) do bocado anterior, para a transição. */
  function snapLast(prev: Seg) {
    const e = engine.current;
    if (!e.last) { e.last = document.createElement('canvas'); e.last.width = W; e.last.height = H; }
    const lg = e.last.getContext('2d');
    if (lg) { lg.fillStyle = '#000'; lg.fillRect(0, 0, W, H); drawBase(lg, prev, prev.dur); e.lastKey = prev.key; }
  }

  /**
   * Toca a sequência no canvas desde `from` (segundos). Com `record` (só a partir do início) grava o canvas e o som;
   * `speakers` deixa ouvir. O vídeo gravado só volta se a volta chegou ao fim sem nada mudar pelo meio.
   */
  async function run(from: number, opt: { record: boolean; speakers: boolean; onProgress?: (p: number) => void }): Promise<RunOut> {
    const my = ++gen.current;
    const stopped: RunOut = { finished: false, blob: null };
    const canvas = canvasRef.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return stopped;
    const list = cfg.current.segs;
    if (!list.length) { g.fillStyle = '#111'; g.fillRect(0, 0, W, H); return stopped; }
    await preload(list);
    if (my !== gen.current || !alive.current) return stopped;
    setLoading(false);
    const e = engine.current;
    if (e.ac && e.ac.state !== 'running') await Promise.race([e.ac.resume().catch(() => undefined), wait(400)]);
    if (e.ac) { e.musicGain!.gain.value = cfg.current.musicVol; e.origGain!.gain.value = cfg.current.origVol; e.speak!.gain.value = opt.speakers ? 1 : 0; }
    const end = Math.min(cfg.current.total, TCHEKA_MAX_S);
    // A gravação: o próprio canvas que se vê, com o som misturado (sem som a correr, não se grava: sairia mudo).
    let rec: MediaRecorder | null = null;
    let done: Promise<Blob> | null = null;
    const type = recorderType();
    if (opt.record && from === 0 && typeof MediaRecorder !== 'undefined' && (!e.ac || e.ac.state === 'running')) {
      if (!e.stream) {
        e.stream = (canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream }).captureStream?.(30) ?? null;
        if (e.stream && e.dest) e.dest.stream.getAudioTracks().forEach((t) => e.stream!.addTrack(t));
      }
      if (e.stream) {
        try { rec = new MediaRecorder(e.stream, type ? { mimeType: type, videoBitsPerSecond: 6_000_000 } : undefined); } catch { rec = null; }
        if (rec) {
          const r = rec;
          const chunks: Blob[] = [];
          r.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
          done = new Promise<Blob>((res) => { r.onstop = () => res(new Blob(chunks, { type: (r.mimeType || type || 'video/mp4').split(';')[0] })); });
        }
      }
    }
    // A música, desde o ponto certo (em ciclo se a sequência for mais comprida).
    let musicNode: AudioBufferSourceNode | null = null;
    if (music && e.ac && e.music?.url === music.url) {
      musicNode = e.ac.createBufferSource();
      musicNode.buffer = e.music.buf;
      musicNode.loop = true;
      musicNode.connect(e.musicGain!);
    }
    if (e.ref) { e.ref.currentTime = from; void e.ref.play().catch(() => undefined); }
    let idx = -1;
    let active: HTMLVideoElement | null = null;
    recording.current = !!rec;
    dirty.current = false;
    const recSig = cfg.current.fullSig;
    const t0 = performance.now() - from * 1000;
    rec?.start(500);
    if (musicNode && e.music) musicNode.start(0, from % e.music.buf.duration);
    let lastUi = 0;
    let lastDraw = 0;
    let t = from;
    try {
      while (my === gen.current && alive.current) {
        t = (performance.now() - t0) / 1000;
        if (t >= end) break;
        const i = segAt(list, t);
        const s = list[i];
        const tl = t - s.start;
        if (i !== idx) {
          if (idx >= 0) snapLast(list[idx]);
          active?.pause();
          active = null;
          if (s.video) {
            const v = videoFor(s.key, s.uri);
            if (fxOf(s)?.reverse && reverseFor(s)) v.pause(); // ao contrário: os frames vêm do ReverseFrames (e o som fica calado)
            else {
              v.playbackRate = Math.min(16, Math.max(0.0625, playbackRateAt(tl, s.dur, s.speed, fxOf(s))));
              v.muted = false;
              v.currentTime = srcAt(s, tl);
              void v.play().catch(() => undefined);
              active = v;
            }
          }
          // O vídeo seguinte já fica no ponto de entrada (sem esperar quando chega a vez dele).
          const nx = list[i + 1];
          if (nx?.video) { const nv = videoFor(nx.key, nx.uri); if (nv !== active) { nv.pause(); nv.currentTime = srcAt(nx, 0); } }
          idx = i;
        } else if (active && fxOf(s)?.reverse && reverseFor(s)) {
          active.pause(); // o inverso ficou pronto a meio: passa para os frames dele
          active = null;
        } else if (active && !active.paused && !active.seeking) {
          // A rampa muda a velocidade ao longo do clipe; e apanha-se o atraso.
          const rate = Math.min(16, Math.max(0.0625, playbackRateAt(tl, s.dur, s.speed, fxOf(s))));
          if (Math.abs(active.playbackRate - rate) > 0.01) active.playbackRate = rate;
          const want = srcAt(s, tl);
          if (Math.abs(active.currentTime - want) > (fxOf(s)?.ramp ? 0.2 : 0.35)) active.currentTime = want;
        }
        // Desenha a 30 fps (o que a gravação apanha): metade do trabalho do GPU num ecrã de 60 Hz.
        const nowMs = performance.now();
        if (nowMs - lastDraw >= 30) { lastDraw = nowMs; drawFrame(g, list, i, t); }
        if (t - lastUi > 0.1) { lastUi = t; setT(t); opt.onProgress?.(Math.min(1, t / end)); }
        await nextFrame();
      }
    } finally {
      active?.pause();
      e.ref?.pause();
      try { musicNode?.stop(); } catch { /* já parou */ }
      recording.current = false;
    }
    const finished = t >= end && my === gen.current && alive.current;
    if (finished) { setT(end); opt.onProgress?.(1); }
    if (!rec || !done) return { finished, blob: null };
    await nextFrame();
    rec.stop();
    const blob = await done;
    if (finished && blob.size && !dirty.current && recSig === cfg.current.fullSig) {
      ready.current = { sig: recSig, blob, mime: blob.type || 'video/mp4' };
      setReadyTick((n) => n + 1);
      return { finished, blob };
    }
    return { finished, blob: null };
  }

  /** A pré-visualização em ciclo; a primeira volta inteira de cada montagem fica gravada (para seguir logo). */
  async function loop(from: number) {
    let start = from;
    for (;;) {
      const out = await run(start, { record: start === 0 && ready.current?.sig !== cfg.current.fullSig, speakers: true });
      if (!out.finished || !alive.current) return;
      start = 0;
    }
  }
  function play(from = 0) { pausedAt.current = from; setPlaying(true); void loop(from); }
  function pause() { gen.current += 1; pausedAt.current = tRef.current; setPlaying(false); }
  /** O instante em que a pré-visualização está agora (a tocar ou parada). */
  const nowT = () => (playingRef.current ? tRef.current : pausedAt.current);
  /** Salta para `t` sem mudar o estado: a tocar continua a tocar dali; em pausa mostra esse frame. */
  function seekTo(t: number, opts: { play?: boolean } = {}) {
    const r = previewResume({ playing: opts.play ?? playingRef.current, at: t, total: cfg.current.total });
    if (r.action === 'play') play(r.at); else void showAt(r.at);
  }
  /** Depois de escolher música no seletor a pré-visualização volta a tocar (com a música nova, do ponto onde estava). */
  const resumeAfterPick = useRef(false);
  const pickerWasPlaying = useRef(false);
  /** Abrir o seletor de música pára a pré-visualização (não se ouvem duas músicas); fechar sem escolher retoma. */
  function openPicker() { pickerWasPlaying.current = playingRef.current; if (playingRef.current) pause(); setPickMusic(true); }
  function closePicker() { setPickMusic(false); if (pickerWasPlaying.current && !resumeAfterPick.current) play(pausedAt.current); pickerWasPlaying.current = false; }
  /** Sair do estúdio pára logo a pré-visualização (o resto liberta-se ao desmontar). */
  function close() {
    if (progressRef.current !== null) {
      Alert.alert('Cancelar a montagem?', 'O que editaste fica como está e podes montar outra vez.', [
        { text: 'Continuar a montar', style: 'cancel' },
        { text: 'Cancelar a montagem', style: 'destructive', onPress: cancelBuild },
      ]);
      return;
    }
    if (playingRef.current) pause();
    onClose();
  }
  /** Pára a montagem em curso: o ciclo sai no frame seguinte e a edição volta a ficar ativa. */
  function cancelBuild() { if (progressRef.current === null) return; cancelled.current = true; gen.current += 1; }

  // Recomeça a pré-visualização quando a sequência muda (um pouco depois, para não recomeçar a cada toque).
  useEffect(() => {
    if (progress !== null) return;
    const id = setTimeout(() => {
      if (!cfg.current.segs.length) { gen.current += 1; return; }
      // Continua do ponto da mudança (não volta ao início); em pausa fica parada, a mostrar esse frame.
      seekTo(restartFrom.current, resumeAfterPick.current ? { play: true } : {});
      resumeAfterPick.current = false;
      restartFrom.current = 0;
    }, 350);
    return () => clearTimeout(id);
  }, [timelineSig]); // eslint-disable-line react-hooks/exhaustive-deps
  // Em pausa, o que se muda (texto, filtro, sticker, transição) vê-se logo no frame parado.
  useEffect(() => {
    if (playing || progress !== null) return;
    // Com um texto ou sticker escolhido, mostra um instante em que ele já se vê inteiro (à entrada ainda está a aparecer).
    const t = pausedAt.current;
    const o = selOv ? overlays.find((x) => x.id === selOv) : null;
    const f = o ? animState(o, t) : null;
    const at = o && f && (f.alpha < 0.9 || f.scale < 0.9 || f.chars < 1) ? restingTime(o) : t;
    const id = setTimeout(() => void showAt(at), 120);
    return () => clearTimeout(id);
  }, [fullSig]); // eslint-disable-line react-hooks/exhaustive-deps
  // A arrastar um texto ou sticker em pausa: redesenha logo o frame parado (sem esperar nem ir buscar o vídeo outra vez).
  useEffect(() => { if (!playingRef.current && progressRef.current === null) repaint(); }, [overlays]); // eslint-disable-line react-hooks/exhaustive-deps
  // O volume muda logo, sem recomeçar.
  useEffect(() => { const e = engine.current; if (e.ac) { e.musicGain!.gain.value = musicVol; e.origGain!.gain.value = origVol; } }, [musicVol, origVol]);

  /** Mostra o frame de um instante (para escolher a capa ou ver um clipe), com a pré-visualização em pausa. */
  async function showAt(t: number) {
    gen.current += 1;
    const my = gen.current;
    setPlaying(false);
    pausedAt.current = t;
    const g = canvasRef.current?.getContext('2d');
    const list = cfg.current.segs;
    if (!g || !list.length) return;
    await preload(list);
    if (my !== gen.current) return;
    const i = segAt(list, t);
    const s = list[i];
    const tl = t - s.start;
    await seekSeg(s, tl);
    // A meio de uma transição: o último frame do clipe anterior também tem de estar pronto.
    const tr = transitionFor(fxOf(s), i, s.dur);
    if (tr && tl < tr.dur && list[i - 1]) {
      const prev = list[i - 1];
      await seekSeg(prev, Math.max(0, prev.dur - 0.04));
      if (my !== gen.current) return;
      snapLast(prev);
      await seekSeg(s, tl);
    }
    if (reference && engine.current.ref) engine.current.ref.currentTime = t;
    if (my !== gen.current) return;
    drawFrame(g, list, i, t);
    setT(t);
    setStageTick((n) => n + 1);
  }
  /** Põe o vídeo (ou os frames ao contrário) de um bocado no instante `tl`, parado. */
  async function seekSeg(s: Seg, tl: number) {
    if (!s.video) return;
    const v = videoFor(s.key, s.uri);
    v.pause();
    const rf = fxOf(s)?.reverse ? reverseFor(s) : null;
    if (rf) { await rf.frameAsync(reverseFrameIndex(srcAt(s, tl) - s.from, rf.count)); return; }
    const to = srcAt(s, tl);
    if (Math.abs(v.currentTime - to) > 0.02) await Promise.race([new Promise<void>((r) => { v.addEventListener('seeked', () => r(), { once: true }); v.currentTime = to; }), wait(1500)]);
  }
  /** Redesenha o frame parado como está (para arrastar textos e stickers sem atraso). */
  function repaint() {
    const g = canvasRef.current?.getContext('2d');
    const list = cfg.current.segs;
    if (!g || !list.length || loading) return;
    const t = pausedAt.current;
    drawFrame(g, list, segAt(list, t), t);
    setStageTick((n) => n + 1);
  }

  // ---------------------------------------------------------------- seguir
  async function build() {
    if (!rules.ok || progress !== null) return;
    setErr('');
    const t0 = performance.now();
    const finish = (blob: Blob, mime: string, reused: boolean) => {
      // Para medir (laboratório e consola): quanto se esperou depois de tocar em «Seguinte».
      (window as unknown as { __tchekaBuild?: unknown }).__tchekaBuild = { ms: Math.round(performance.now() - t0), reused, seconds: playTotal, bytes: blob.size };
      // O vídeo sai com a assinatura do Txillapp em todos os frames (signed): o servidor não a volta a pôr.
      onDone({ uri: URL.createObjectURL(blob), video: true, mime, durationMs: Math.round(playTotal * 1000), signed: true, posterMs: Math.round(coverAt * 1000) }, music);
    };
    // A pré-visualização já gravou esta montagem inteira: segue logo.
    if (ready.current && ready.current.sig === fullSig) { gen.current += 1; finish(ready.current.blob, ready.current.mime, true); return; }
    if (typeof MediaRecorder === 'undefined' || !(canvasRef.current as (HTMLCanvasElement & { captureStream?: unknown }) | null)?.captureStream) { setErr('Este browser não consegue montar o vídeo'); return; }
    setProgress(0);
    try {
      cancelled.current = false;
      await prepareFx();
      const out = await run(0, { record: true, speakers: false, onProgress: setProgress });
      setProgress(null);
      if (!alive.current) return;
      // Cancelada no ×: volta à edição tal como estava, sem aviso de erro.
      if (cancelled.current) { cancelled.current = false; play(0); return; }
      if (!out.blob || !out.blob.size) { setErr('Não consegui montar a tcheka. Tenta outra vez.'); play(0); return; }
      finish(out.blob, out.blob.type || 'video/mp4', false);
    } catch {
      setProgress(null);
      if (cancelled.current) { cancelled.current = false; play(0); return; }
      setErr('Não consegui montar a tcheka');
    }
  }

  /** Antes de gravar: as fontes, os frames ao contrário e as imagens dos stickers (o vídeo sai igual à pré-visualização). */
  async function prepareFx() {
    const list = cfg.current.segs;
    await Promise.race([loadStudioFonts(), wait(4000)]);
    await Promise.all(list.filter((s) => s.video && fxOf(s)?.reverse).map((s) => ensureReverse(s)));
    await Promise.all(cfg.current.overlays.map((o) => (o.kind === 'sticker' ? loadOvImage(o) : null)));
  }

  // ---------------------------------------------------------------- efeitos e camadas (os painéis)
  /** Muda o fx de um clipe ou de todos; `timing` (rampa, inverter): a pré-visualização continua do início desse clipe. */
  const setFx = (target: FxTarget, patch: (fx: ClipFx | undefined, i: number) => ClipFx | undefined, timing = false) => {
    if (locked) return;
    if (timing) restartFrom.current = typeof target === 'number' ? segs[target]?.start ?? 0 : nowT();
    setItems((l) => l.map((it, k) => (target === 'all' || k === target ? { ...it, fx: patch(it.fx, k) } : it)));
  };
  /** Escolher um clipe no painel dos efeitos: a pré-visualização vai para dentro dele (já depois da transição). */
  const pickFxClip = (i: number) => {
    setSel(i);
    const s = segs[i];
    if (!s) return;
    const tr = transitionFor(s.fx, i, s.dur);
    seekTo(s.start + Math.min(s.dur * 0.5, (tr?.dur ?? 0) + 0.05));
  };
  /** Ver uma transição: toca a partir de um pouco antes da junção. */
  const previewJunction = (i: number) => seekTo(Math.max(0, (segs[i]?.start ?? 0) - 0.6), { play: true });
  /** O frame que está agora na pré-visualização, sem efeitos (para as miniaturas dos filtros). */
  const grabFrame = (): FrameGrab | null => {
    const e = engine.current;
    const list = cfg.current.segs;
    if (!list.length) return null;
    const k = items[sel]?.key;
    const s = list.find((x) => x.key === k) ?? list[segAt(list, nowT())];
    if (s.video) {
      const rf = fxOf(s)?.reverse ? reverseFor(s) : null;
      const fr = rf?.frame(reverseFrameIndex(srcAt(s, Math.max(0, nowT() - s.start)) - s.from, rf.count));
      if (rf && fr) return { src: fr, w: rf.w, h: rf.h };
      const v = e.videos.get(s.key);
      return v && v.readyState >= 2 ? { src: v, w: v.videoWidth || W, h: v.videoHeight || H } : null;
    }
    const img = e.images.get(s.uri);
    return img?.naturalWidth ? { src: img, w: img.naturalWidth, h: img.naturalHeight } : null;
  };
  /**
   * Congelar: o frame que está na pré-visualização vira uma foto parada. A meio de um vídeo, divide-o nesse ponto e a foto
   * fica entre as duas partes (sem transição, como no TikTok); no princípio ou no fim, a foto entra a seguir.
   */
  async function freezeFrame() {
    if (locked || freezing) return;
    const list = cfg.current.segs;
    const t = nowT();
    const s = list[segAt(list, t)];
    if (!s?.video) { setErr('Põe a pré-visualização num vídeo para congelar um frame.'); return; }
    setErr('');
    pause();
    setFreezing(true);
    try {
      const tl = Math.max(0, Math.min(s.dur - 0.01, t - s.start));
      const fx = fxOf(s);
      const at = srcAt(s, tl);
      const rf = fx?.reverse ? reverseFor(s) : null;
      let src: CanvasImageSource | null = null, sw = 0, sh = 0;
      if (rf) { src = await rf.frameAsync(reverseFrameIndex(at - s.from, rf.count)); sw = rf.w; sh = rf.h; }
      if (!src) { await seekSeg(s, tl); const v = videoFor(s.key, s.uri); src = v; sw = v.videoWidth; sh = v.videoHeight; }
      if (!src || !sw || !sh) throw new Error('frame');
      const c = document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      c.getContext('2d')?.drawImage(src, 0, 0, sw, sh);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) throw new Error('jpeg');
      const photo = makeItem({ uri: URL.createObjectURL(blob), video: false, mime: 'image/jpeg' });
      photo.seconds = 2;
      photo.fx = sanitizeFx({ filter: fx?.filter, adjust: fx?.adjust, transition: { type: 'corte', dur: 0.5 }, freeze: { from: s.key, at } });
      const plain = !fx?.reverse && !fx?.ramp;
      restartFrom.current = s.start;
      setItems((l) => {
        const k = l.findIndex((x) => x.key === s.key);
        if (k < 0) return l;
        const it = l[k];
        const split = plain ? freezeSplit(it.trim, at) : null;
        if (!split) { setSel(k + 1); return [...l.slice(0, k + 1), photo, ...l.slice(k + 1)]; }
        itemSeq += 1;
        const rest: Item = { ...it, key: `${itemSeq}-${it.uri}`, trim: split.after, fx: sanitizeFx({ ...it.fx, transition: { type: 'corte', dur: 0.5 } }) };
        setSel(k + 1);
        return [...l.slice(0, k), { ...it, trim: split.before }, photo, rest, ...l.slice(k + 1)];
      });
    } catch {
      setErr('Não consegui congelar este frame.');
    } finally {
      setFreezing(false);
    }
  }
  const texts = overlays.filter((o): o is TextOverlay => o.kind === 'text');
  const stickerOvs = overlays.filter((o): o is StickerOverlay => o.kind === 'sticker');
  /** Escolher uma camada: em pausa, a pré-visualização vai para um instante em que ela se vê. */
  const selectOverlay = (id: string | null) => {
    const o = id ? overlays.find((x) => x.id === id) : null;
    setSelOv(o ? o.id : null);
    if (!o) return;
    setTab(o.kind === 'text' ? 'texto' : 'stickers');
    const t = nowT();
    if (!playingRef.current && !animState(o, t).visible) void showAt(restingTime(o));
  };
  const changeOverlay = (o: Overlay) => { if (!locked) setOverlays((l) => l.map((x) => (x.id === o.id ? o : x))); };
  const deleteOverlay = (id: string) => { if (locked) return; setOverlays((l) => l.filter((x) => x.id !== id)); setSelOv((s) => (s === id ? null : s)); };
  const addText = () => {
    if (locked) return;
    if (playingRef.current) pause();
    const o = newText(nowT(), playTotal);
    setOverlays((l) => [...l, o]);
    setSelOv(o.id);
    setEditTick((n) => n + 1);
  };
  const addSticker = (c: StickerContent) => {
    if (locked) return;
    // Os stickers ficam a tcheka toda (muda-se no «Aparece de»). Cada tipo tem o seu sítio dentro da zona segura (os emojis
    // e as imagens em cima, as etiquetas mais abaixo), sem se taparem uns aos outros.
    const o = newSticker(c, 0, playTotal);
    const pic = (t: string) => t === 'emoji' || t === 'txill' || t === 'gif';
    const same = stickerOvs.filter((s) => pic(s.sticker.type) === pic(c.type)).length;
    if (pic(c.type)) { o.x = 0.28 + (same % 3) * 0.2; o.y = 0.24 + Math.floor(same / 3) * 0.12; }
    else { o.x = 0.46; o.y = Math.min(0.72, 0.5 + same * 0.115); }
    setOverlays((l) => [...l, o]);
    setSelOv(o.id);
  };

  // ---------------------------------------------------------------- edição
  const edit = (i: number, patch: (it: Item) => Item) => { restartFrom.current = segs[i]?.start ?? 0; setItems((l) => l.map((it, k) => (k === i ? patch(it) : it))); };
  const move = (i: number, d: -1 | 1) => setItems((l) => { const j = i + d; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; setSel(j); return n; });
  const remove = (i: number) => setItems((l) => { const n = l.filter((_, k) => k !== i); setSel((s) => Math.max(0, Math.min(s, n.length - 1))); return n; });
  const cycle = (i: number) => edit(i, (it) => (it.video ? it : useRhythm
    ? { ...it, beats: PHOTO_BEATS[(PHOTO_BEATS.indexOf(it.beats as 1 | 2 | 4) + 1) % PHOTO_BEATS.length] }
    : { ...it, seconds: PHOTO_S[(PHOTO_S.indexOf(it.seconds as 2 | 3 | 5) + 1) % PHOTO_S.length] }));
  const addFiles = async (files: File[]) => { const more = await filesToClips(files); if (alive.current) setItems((l) => [...l, ...more.map(makeItem)]); };
  const pickedMusic = (t: Track) => {
    // A música nova entra no ponto onde a pré-visualização estava (o som começa nesse instante da faixa).
    restartFrom.current = pausedAt.current;
    resumeAfterPick.current = true;
    pickerWasPlaying.current = false;
    if (t.url === music?.url) { resumeAfterPick.current = false; play(pausedAt.current); }
    setMusic(t);
    setRhythm(true);
    if (origVol === 1 && items.some((i) => i.video)) setOrigVol(0.4);
    setPickMusic(false);
  };

  const topPad = Math.max(insets.top, 12);
  const botPad = Math.max(insets.bottom, 12);
  const chip = (on: boolean, label: string, onPress: () => void, key?: string, a11y?: string) => (
    <Pressable key={key ?? label} onPress={onPress} style={[st.chip, on && st.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={a11y ?? label}>
      <Text style={[st.chipText, on && { color: colors.zinc900 }]}>{label}</Text>
    </Pressable>
  );
  const busy = progress !== null;
  /** Com a montagem em curso nada se edita (o vídeo que sai é o que estava no ecrã ao carregar em «Seguinte»). */
  const locked = editLocked(progress);
  const prepared = readyTick > 0 && ready.current?.sig === fullSig;
  const left = Math.max(0, Math.ceil(playTotal * (1 - (progress ?? 0))));
  const TABS: { id: Tab; label: string }[] = [{ id: 'clipes', label: 'Clipes' }, { id: 'som', label: 'Som' }, { id: 'texto', label: 'Texto' }, { id: 'stickers', label: 'Stickers' }, { id: 'efeitos', label: 'Efeitos' }, { id: 'capa', label: 'Capa' }];
  /** Tocar ou pausar (o botão e o toque no vídeo): no fim recomeça do princípio. */
  const togglePlay = () => { if (busy) return; if (playingRef.current) pause(); else play(pausedAt.current >= playTotal - 0.05 ? 0 : pausedAt.current); };

  return (
    <View style={[st.root, { paddingTop: topPad, paddingBottom: botPad }]} accessibilityViewIsModal>
      <View style={st.top}>
        <Pressable onPress={close} style={st.round} accessibilityRole="button" accessibilityLabel="Voltar"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        <Text style={st.title}>Nova tcheka</Text>
        <Pressable onPress={() => void build()} disabled={!rules.ok || busy} style={[st.cta, (!rules.ok || busy) && { opacity: 0.45 }]} accessibilityRole="button" accessibilityState={{ disabled: !rules.ok || busy }} accessibilityHint={rules.hint ?? undefined} accessibilityLabel={busy ? `A montar, ${Math.round((progress ?? 0) * 100)}%` : 'Seguinte'}>
          <Text style={st.ctaText}>{busy ? `${Math.round((progress ?? 0) * 100)}%` : 'Seguinte'}</Text>
        </Pressable>
      </View>
      {rules.hint ? (
        <View style={st.hintWrap}>
          <Pressable onPress={() => setTab(rules.problem === 'som' ? 'som' : 'clipes')} disabled={locked} style={st.hint} accessibilityRole="button" accessibilityLabel={`Para seguir: ${rules.hint}`}>
            <Icon name="info" size={15} color="#fff" />
            <Text style={st.hintText} accessibilityLiveRegion="polite">{rules.hint}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* A pré-visualização é o próprio canvas da montagem (o que se vê é o que sai). Tocar põe em pausa. */}
      <Pressable style={st.preview} onPress={togglePlay} accessibilityRole="button" accessibilityLabel={playing ? 'Pausa' : 'Tocar'}>
        {dom('canvas', { ref: (el: HTMLCanvasElement | null) => { canvasRef.current = el; }, width: W, height: H, 'aria-label': 'Pré-visualização da tcheka', style: { width: '100%', height: '100%', objectFit: 'contain', display: 'block', backgroundColor: '#000' } })}
        {/* Os GIFs dos stickers ficam aqui (quase invisíveis) para o browser os animar; o canvas desenha o frame de agora. */}
        {dom('div', { ref: (el: HTMLDivElement | null) => { gifBox.current = el; }, 'aria-hidden': true, style: { position: 'absolute', left: 0, top: 0, width: 2, height: 2, overflow: 'hidden', opacity: 0.01, pointerEvents: 'none' } })}
        {/* Mexer nos textos e stickers (mover, rodar, escalar), com a zona segura e as guias; fora deles, tocar pausa. */}
        <FxStage locked={locked} overlays={overlays} selId={selOv} boxes={() => engine.current.boxes} onSelect={selectOverlay} onChange={changeOverlay} onDelete={deleteOverlay}
          onEdit={(id) => { selectOverlay(id); setEditTick((n) => n + 1); }} showSafe={tab === 'texto' || tab === 'stickers'} tick={stageTick} />
        {loading && items.length ? <View style={st.center} pointerEvents="none"><Text style={st.loadText}>A preparar…</Text></View> : null}
        {!playing && !busy && !selOv ? <View style={st.center} pointerEvents="none"><View style={st.playBig}><Icon name="play" size={34} color="#fff" solid /></View></View> : null}
        <View style={st.timeline} pointerEvents="none">
          <View style={[st.timeFill, { width: `${playTotal ? Math.min(100, (playT / playTotal) * 100) : 0}%` }]} />
          {useRhythm ? segs.slice(0, -1).map((s) => <View key={s.key} style={[st.beatTick, { left: `${((s.start + s.dur) / Math.max(0.1, playTotal)) * 100}%` }]} />) : null}
        </View>
        {!busy ? (
          <View style={st.controls} pointerEvents="box-none">
            <Pressable onPress={togglePlay} style={({ pressed }) => [st.playBtn, pressed && { transform: [{ scale: 0.92 }] }]} hitSlop={6} accessibilityRole="button" accessibilityLabel={playing ? 'Pausar a pré-visualização' : 'Tocar a pré-visualização'}>
              <Icon name={playing ? 'pause' : 'play'} size={22} color="#fff" solid />
            </Pressable>
            <Text style={st.clock} pointerEvents="none">{previewClock(playT, playTotal)}{prepared && rules.ok ? ' · pronto' : ''}</Text>
          </View>
        ) : null}
        {busy && (
          <View style={st.building} pointerEvents="none">
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18 }}>A montar a tcheka…</Text>
            <View style={st.track}><View style={[st.fill, { width: `${Math.round((progress ?? 0) * 100)}%` }]} /></View>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, textAlign: 'center' }}>Faltam {left} s. Não feches a app.</Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, textAlign: 'center' }}>Dica: vê a pré-visualização até ao fim e fica logo pronto.</Text>
          </View>
        )}
      </Pressable>

      <View
        ref={(el) => { editBox.current = el as unknown as HTMLElement | null; }}
        style={[{ flexShrink: 0 }, locked && st.locked]}
        pointerEvents={locked ? 'none' : 'auto'}
        accessibilityState={{ disabled: locked }}
        aria-disabled={locked}
      >
      <View style={st.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={st.tabBtn} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }} accessibilityLabel={t.label}>
            <Text style={[st.tabText, tab === t.id && st.tabOn]}>{t.label}</Text>
            <View style={[st.tabDot, tab !== t.id && { opacity: 0 }]} />
          </Pressable>
        ))}
      </View>

      <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ paddingBottom: 10 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {tab === 'clipes' ? (
          <>
            {/* A sequência: toca para escolher; setas para ordenar; x tira; nas fotos o tempo (ou as batidas) muda ao tocar. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, alignItems: 'flex-start' }} style={{ maxHeight: 112, marginTop: 8 }}>
              {items.map((it, i) => (
                <View key={it.key} style={{ alignItems: 'center', gap: 4 }}>
                  <Pressable onPress={() => { setSel(i); seekTo(segs[i]?.start ?? 0); }} style={[st.thumb, i === sel && { borderColor: colors.brand }]} accessibilityRole="button" accessibilityLabel={`Clipe ${i + 1}${it.video ? ', vídeo' : ', foto'}`}>
                    {it.video
                      ? dom('video', { src: it.uri, muted: true, playsInline: true, preload: 'metadata', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })
                      : dom('img', { src: it.uri, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })}
                    <Pressable onPress={() => remove(i)} style={st.rm} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Tirar o clipe ${i + 1}`}><Icon name="x" size={12} color="#fff" strokeWidth={3} /></Pressable>
                    {it.video && it.speed !== 1 ? <View style={st.speedTag}><Text style={st.speedTagText}>{speedLabel(it.speed)}</Text></View> : null}
                  </Pressable>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Pressable onPress={() => move(i, -1)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Mover para trás"><Icon name="chevron-left" size={14} color="rgba(255,255,255,0.8)" /></Pressable>
                    <Pressable onPress={() => cycle(i)} disabled={it.video} accessibilityRole="button" accessibilityLabel={it.video ? `Vídeo de ${fmtS(durations[i] ?? 0)} s` : useRhythm ? `Foto durante ${it.beats} batidas, toca para mudar` : `Foto durante ${it.seconds} s, toca para mudar`}>
                      <Text style={st.secs}>{useRhythm && !it.video ? `${it.beats}♪` : `${fmtS(durations[i] ?? 0)} s`}</Text>
                    </Pressable>
                    <Pressable onPress={() => move(i, 1)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Mover para a frente"><Icon name="chevron-right" size={14} color="rgba(255,255,255,0.8)" /></Pressable>
                  </View>
                </View>
              ))}
              <GalleryPick onFiles={(f) => void addFiles(f)} style={[st.thumb, st.addThumb]}><Icon name="plus" size={24} color="#fff" strokeWidth={2.2} /></GalleryPick>
            </ScrollView>
            <Text style={st.meta}>{items.length} {items.length === 1 ? 'clipe' : 'clipes'} · {fmtS(total)} s de {TCHEKA_MAX_S} s</Text>

            {music && items.some((i) => !i.video) ? (
              <View style={st.rowWrap}>
                <Text style={st.label}>Fotos</Text>
                {chip(useRhythm, 'Ao ritmo', () => { restartFrom.current = nowT(); setRhythm(true); })}
                {chip(!useRhythm, 'Manual', () => { restartFrom.current = nowT(); setRhythm(false); })}
                <Text style={st.small}>{useRhythm ? `${beatInfo ? `${Math.round(beatInfo.bpm ?? 120)} BPM${beatInfo.detected ? '' : ' (fixo)'}` : 'a ouvir a música…'} · toca no tempo de uma foto: 1, 2 ou 4 batidas` : 'toca no tempo de uma foto: 2, 3 ou 5 s'}</Text>
              </View>
            ) : null}

            {cur?.video ? (
              <>
                <View style={st.rowWrap}>
                  <Text style={st.label}>Velocidade</Text>
                  {SPEEDS.map((sp) => chip(cur.speed === sp, speedLabel(sp), () => edit(sel, (it) => ({ ...it, speed: sp })), `sp-${sp}`, `Velocidade ${speedLabel(sp)}`))}
                </View>
                <View style={st.trimBox}>
                  <Text style={st.label}>Cortar o clipe {sel + 1}</Text>
                  <Text style={st.small}>Início · {fmtS(cur.trim.start)} s</Text>
                  <RangeSlider label="Início do clipe" value={cur.trim.start} min={0} max={Math.max(0.1, cur.length - 0.5)} step={0.1} format={(v) => `${fmtS(v)} s`}
                    onChange={(v) => edit(sel, (it) => ({ ...it, trim: clampTrim({ start: v, end: it.trim.end }, it.length) }))} />
                  <Text style={st.small}>Fim · {fmtS(cur.trim.end)} s</Text>
                  <RangeSlider label="Fim do clipe" value={cur.trim.end} min={Math.min(cur.length, 0.5)} max={Math.max(0.6, cur.length)} step={0.1} format={(v) => `${fmtS(v)} s`}
                    onChange={(v) => edit(sel, (it) => ({ ...it, trim: clampTrim({ start: Math.min(it.trim.start, v - 0.5), end: v }, it.length) }))} />
                  <Text style={st.small}>Fica com {fmtS(durations[sel] ?? 0)} s{cur.speed !== 1 ? ` a ${speedLabel(cur.speed)}` : ''}</Text>
                </View>
              </>
            ) : null}
            {items.length > 1 ? <Text style={[st.small, { paddingHorizontal: 16, marginTop: 8 }]}>Transições, filtros e rampas de cada clipe: no separador Efeitos.</Text> : null}
          </>
        ) : null}

        {tab === 'som' ? (
          <>
            <View style={st.musicRow}>
              <Icon name="music" size={20} color="#fff" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }} numberOfLines={1}>{music ? music.title : reference ? 'Som do dueto' : 'Sem música'}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }} numberOfLines={1}>{music ? music.artist || 'Toca em ciclo' : photosOnly ? 'Só com fotos, escolhe uma música' : 'Fica o som dos vídeos'}</Text>
              </View>
              <Pressable onPress={openPicker} style={st.smallBtn} accessibilityRole="button"><Text style={st.smallBtnText}>{music ? 'Trocar' : 'Escolher'}</Text></Pressable>
              {music ? <Pressable onPress={() => { restartFrom.current = nowT(); setMusic(null); if (origVol === 0) setOrigVol(1); }} style={st.smallBtn} accessibilityRole="button" accessibilityLabel="Tirar a música"><Icon name="x" size={16} color="#fff" strokeWidth={2.4} /></Pressable> : null}
            </View>
            {items.some((i) => i.video) ? (
              <View style={st.trimBox}>
                <Text style={st.label}>Som original</Text>
                <RangeSlider label="Volume do som original" value={Math.round(origVol * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => setOrigVol(v / 100)} />
                {items.some((i) => i.video && i.hasAudio === false) ? <Text style={st.small}>{items.every((i) => !i.video || i.hasAudio === false) ? 'Os vídeos não têm som' : 'Alguns vídeos não têm som'}</Text> : null}
              </View>
            ) : null}
            {music ? (
              <View style={st.trimBox}>
                <Text style={st.label}>Música</Text>
                <RangeSlider label="Volume da música" value={Math.round(musicVol * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => setMusicVol(v / 100)} />
              </View>
            ) : null}
          </>
        ) : null}

        {tab === 'texto' ? (
          <TextPanel texts={texts} selId={selOv} onSelect={selectOverlay} onAdd={addText} onChange={changeOverlay} onDelete={deleteOverlay} total={playTotal} locked={locked} focusKey={editTick} />
        ) : null}

        {tab === 'stickers' ? (
          <StickerTray locked={locked} stickers={stickerOvs} selId={selOv} onSelect={(id) => selectOverlay(id || null)} onAdd={addSticker} onChange={changeOverlay} onDelete={deleteOverlay} total={playTotal} />
        ) : null}

        {tab === 'efeitos' ? (
          <FxPanel
            clips={segs.map((s) => ({ key: s.key, video: s.video, uri: s.uri, fx: s.fx, dur: s.dur, trimLen: s.len, start: s.start }))}
            sel={sel}
            onSelect={pickFxClip}
            setFx={setFx}
            grab={grabFrame}
            playing={playing}
            frameKey={`${Math.round(playT * 2)}|${assetTick}`}
            onPreviewJunction={previewJunction}
            onFreeze={() => void freezeFrame()}
            freezing={freezing}
            reverseOf={(k) => revState[k] ?? { status: null, progress: 0 }}
          />
        ) : null}

        {tab === 'capa' ? (
          <View style={st.trimBox}>
            <Text style={st.label}>Capa</Text>
            <RangeSlider label="Momento da capa" value={coverAt} min={0} max={Math.max(0.2, playTotal - 0.1)} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={setCoverAt} onCommit={(v) => void showAt(v)} />
            <Text style={st.small}>A capa é o frame aos {fmtS(coverAt)} s: é o que aparece no feed e no perfil.</Text>
            <Pressable onPress={() => void showAt(coverAt)} style={[st.smallBtn, { alignSelf: 'flex-start', marginTop: 6 }]} accessibilityRole="button" accessibilityLabel="Ver a capa"><Text style={st.smallBtnText}>Ver a capa</Text></Pressable>
          </View>
        ) : null}
        {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
      </ScrollView>
      </View>
      {pickMusic ? <MusicPicker allowLocal onClose={closePicker} onPick={pickedMusic} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 6 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  cta: { height: 40, minWidth: 96, paddingHorizontal: 18, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  hintWrap: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: 'rgba(214,51,79,0.92)', paddingHorizontal: 12, paddingVertical: 6, maxWidth: '100%' },
  hintText: { color: '#fff', fontWeight: '700', fontSize: 13, flexShrink: 1 },
  preview: { flex: 1, minHeight: 200, marginHorizontal: 16, borderRadius: 20, overflow: 'hidden', backgroundColor: '#111' },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  loadText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700' },
  playBig: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  timeline: { position: 'absolute', left: 10, right: 10, bottom: 8, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  timeFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: '#fff' },
  beatTick: { position: 'absolute', top: -3, width: 2, height: 10, marginLeft: -1, borderRadius: 1, backgroundColor: '#ffd60a' },
  locked: { opacity: 0.35 },
  controls: { position: 'absolute', left: 10, right: 10, bottom: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  playBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  clock: { color: '#fff', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  building: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  track: { width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  tabs: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 6 },
  tabBtn: { paddingHorizontal: 8, height: 36, alignItems: 'center', justifyContent: 'center' },
  tabText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '800' },
  tabOn: { color: '#fff' },
  tabDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff', marginTop: 3 },
  thumb: { width: 64, height: 84, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', backgroundColor: '#222' },
  addThumb: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },
  rm: { position: 'absolute', right: 3, top: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  speedTag: { position: 'absolute', left: 3, bottom: 3, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 4 },
  speedTagText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  secs: { color: '#fff', fontSize: 12, fontWeight: '700', minWidth: 30, textAlign: 'center' },
  meta: { color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center', marginTop: 4 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginTop: 8 },
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', paddingRight: 4 },
  small: { color: 'rgba(255,255,255,0.65)', fontSize: 12, flexShrink: 1 },
  chip: { height: 30, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  trimBox: { paddingHorizontal: 16, marginTop: 8, gap: 2 },
  textRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginTop: 10 },
  input: { flex: 1, minWidth: 0, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', paddingHorizontal: 12, fontSize: 14 },
  castBtn: { width: 52, height: 52, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  musicRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14, paddingVertical: 10 },
  smallBtn: { height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  smallBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  err: { color: '#fecaca', textAlign: 'center', marginTop: 8, fontSize: 13 },
});
