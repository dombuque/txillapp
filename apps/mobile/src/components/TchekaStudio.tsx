import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import stickers from '../assets/stickers.json';
import type { Track } from '@/lib/api.music';
import { useAuth } from '@/lib/auth';
import { abs } from '@/lib/config';
import {
  beatGrid, checkTcheka, clampTrim, clipSeconds, detectBeats, editLocked, fmtS, previewClock, previewResume, rhythmDurations, SPEEDS, speedLabel, studioSignature, TCHEKA_MAX_S, textAlpha, type Trim,
} from '@/lib/tchekaRules';
import { colors } from '@/lib/theme';
import { sealOf } from '@/lib/wordmark';
import { Icon } from './Icon';
import { MusicPicker } from './MusicPicker';
import { RangeSlider } from './RangeSlider';
import { Sticker } from './StickerPanel';
import { GalleryPick, LOOKS, lookCss, stampTxillapp, type Shot } from './TxCamera';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const W = 1080;
const H = 1920;
const PHOTO_S = [2, 3, 5] as const;
const PHOTO_BEATS = [1, 2, 4] as const;
const TR = 0.5; // segundos de transição
/** As personagens que se podem pôr na tcheka (o sticker de cada uma). */
const CAST: { id: string; name: string }[] = [
  { id: 'saude', name: 'Txilla' }, { id: 'bom-dia', name: 'Gelinho' }, { id: 'bora', name: 'Zazá' },
  { id: 'amor', name: 'Mimo' }, { id: 'cool', name: 'Txeka' }, { id: 'estrela', name: 'Super' },
];
type Transition = 'none' | 'fade' | 'slide';
type Tab = 'clipes' | 'som' | 'texto' | 'efeitos' | 'capa';

export interface Clip { uri: string; video: boolean; mime: string; durationMs?: number; /** Velocidade a que foi gravado na câmara (0,5× a 3×). */ speed?: number }
type Item = Clip & {
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
interface Seg { key: string; uri: string; video: boolean; start: number; dur: number; from: number; speed: number }
/** Como acabou uma volta da sequência: até ao fim ou interrompida; e o vídeo, se se gravou e ainda vale. */
interface RunOut { finished: boolean; blob: Blob | null }

const recorderType = () => ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';

/** Desenha `src` a cobrir o retângulo (x, y, w, h), com zoom e deslocamento horizontal. */
function cover(g: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, zoom = 1, dx = 0, x = 0, y = 0, w = W, h = H) {
  if (!sw || !sh) return;
  const k = Math.max(w / sw, h / sh) * zoom;
  const dw = sw * k, dh = sh * k;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.drawImage(src, x + (w - dw) / 2 + dx, y + (h - dh) / 2, dw, dh);
  g.restore();
}
/** Quebra o texto em linhas que cabem na largura. */
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? `${line} ${word}` : word;
      if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out.slice(0, 4);
}
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const setFilter = (g: CanvasRenderingContext2D, f: string) => { if ('filter' in g) (g as CanvasRenderingContext2D & { filter: string }).filter = f; };
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
 * - Edição: cortar e reordenar os clipes, velocidade, volume do original contra a música, texto com entrada e saída,
 *   filtro, sticker, transições e a capa.
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
  const [look, setLook] = useState(0);
  const [transition, setTransition] = useState<Transition>('fade');
  const [title, setTitle] = useState('');
  const [titleStyle, setTitleStyle] = useState<'branco' | 'coral'>('branco');
  const [cast, setCast] = useState<string | null>(null);
  const [music, setMusic] = useState<Track | null>(initialMusic);
  const [pickMusic, setPickMusic] = useState(false);
  const [rhythm, setRhythm] = useState(true);
  const [beatInfo, setBeatInfo] = useState<{ url: string; bpm: number | null; offset: number; detected: boolean } | null>(null);
  // Com um som de outra tcheka (que costuma ser para dobrar), o original começa calado; com música, mais baixo.
  const [origVol, setOrigVol] = useState(initialMusic ? (initialMusic.kind === 'sound' ? 0 : 0.4) : 1);
  const [musicVol, setMusicVol] = useState(1);
  const [textFrom, setTextFrom] = useState(0);
  const [textTo, setTextTo] = useState(4);
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
    const base = items.map((it) => (it.video ? clipSeconds(it.trim, it.speed) : it.seconds));
    return useRhythm ? rhythmDurations(items.map((it, i) => ({ video: it.video, seconds: base[i], beats: it.beats })), grid) : base;
  }, [items, useRhythm, grid]);
  const segs: Seg[] = useMemo(() => {
    let t = 0;
    return items.map((it, i) => { const s = { key: it.key, uri: it.uri, video: it.video, start: t, dur: durations[i], from: it.video ? it.trim.start : 0, speed: it.video ? it.speed : 1 }; t += durations[i]; return s; });
  }, [items, durations]);
  const total = durations.reduce((n, d) => n + d, 0);
  const playTotal = Math.min(total, TCHEKA_MAX_S);
  const rules = checkTcheka({ clips: items.map((it, i) => ({ video: it.video, seconds: durations[i], hasAudio: it.hasAudio })), music: !!music || !!reference, originalVolume: origVol });
  const cur = items[sel] ?? items[0];

  // O texto aparece de 0 a 4 s por omissão; nunca para lá do fim (nem a capa).
  useEffect(() => {
    setTextTo((v) => Math.min(Math.max(v, Math.min(4, playTotal)), playTotal || 4));
    setTextFrom((v) => Math.min(v, Math.max(0, playTotal - 0.5)));
    setCoverAt((v) => Math.min(v, Math.max(0, playTotal - 0.1)));
  }, [playTotal]);

  /** O que muda o tempo da sequência (obriga a recomeçar a pré-visualização). */
  const timelineSig = studioSignature({ s: segs.map((s) => [s.uri, s.start, s.dur, s.from, s.speed]), m: music?.url ?? null, r: reference?.uri ?? null });
  /** Tudo o que muda o vídeo final (para saber se a volta gravada ainda vale). */
  const fullSig = studioSignature({ t: timelineSig, look, transition, title: title.trim(), titleStyle, cast, textFrom, textTo, origVol, musicVol });
  const live = { look, transition, title: title.trim(), titleStyle, cast, textFrom, textTo, origVol, musicVol, segs, total: playTotal, fullSig };
  const cfg = useRef(live);
  cfg.current = live;

  // ---------------------------------------------------------------- o motor (canvas + Web Audio + MediaRecorder)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engine = useRef<{
    ac: AudioContext | null; dest: MediaStreamAudioDestinationNode | null; speak: GainNode | null; musicGain: GainNode | null; origGain: GainNode | null;
    stream: MediaStream | null; videos: Map<string, HTMLVideoElement>; images: Map<string, HTMLImageElement>; sources: WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>;
    music: { url: string; buf: AudioBuffer } | null; castImg: { id: string; img: HTMLImageElement } | null; last: HTMLCanvasElement | null; ref: HTMLVideoElement | null;
  }>({ ac: null, dest: null, speak: null, musicGain: null, origGain: null, stream: null, videos: new Map(), images: new Map(), sources: new WeakMap(), music: null, castImg: null, last: null, ref: null });
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
    void e.ac?.close().catch(() => undefined);
  }, []);

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
    const castId = cfg.current.cast;
    if (castId && e.castImg?.id !== castId) {
      // Como imagem (data URL) o SVG precisa do xmlns; dentro da página não precisava.
      const raw = (stickers.items as { id: string; svg: string }[]).find((x) => x.id === castId)?.svg;
      const svg = raw && !/xmlns=/.test(raw) ? raw.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ') : raw;
      if (svg) {
        try { e.castImg = { id: castId, img: await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('sticker')); i.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }) }; } catch { e.castImg = null; }
      }
    }
  }
  // O sticker pode mudar a meio: carrega-se logo.
  useEffect(() => { if (cast) void preload([]); }, [cast]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /** O fundo de um bocado no instante `tl` (segundos dentro dele): a foto com zoom suave ou o frame do vídeo. */
  function drawBase(g: CanvasRenderingContext2D, s: Seg, tl: number, dx: number) {
    const e = engine.current;
    setFilter(g, lookCss(LOOKS[cfg.current.look]));
    const half = !!(reference && e.ref);
    const x = half ? W / 2 : 0, w = half ? W / 2 : W;
    if (s.video) {
      const v = e.videos.get(s.key);
      if (v && v.readyState >= 2) cover(g, v, v.videoWidth || W, v.videoHeight || H, 1, dx, x, 0, w, H);
    } else {
      const img = e.images.get(s.uri);
      if (img?.naturalWidth) cover(g, img, img.naturalWidth, img.naturalHeight, 1 + 0.07 * Math.min(1, tl / Math.max(0.1, s.dur)), dx, x, 0, w, H); // zoom suave (Ken Burns)
    }
    if (half && e.ref && e.ref.readyState >= 2) { setFilter(g, 'none'); cover(g, e.ref, e.ref.videoWidth || W, e.ref.videoHeight || H, 1, 0, 0, 0, W / 2, H); }
    setFilter(g, 'none');
  }
  /** Por cima de cada frame: a transição a partir do bocado anterior, o texto (no tempo dele), a assinatura e o sticker. */
  function overlay(g: CanvasRenderingContext2D, t: number, tl: number, idx: number) {
    const c = cfg.current;
    const e = engine.current;
    if (idx > 0 && e.last && c.transition !== 'none' && tl < TR) {
      const p = ease(tl / TR);
      g.save();
      if (c.transition === 'fade') { g.globalAlpha = 1 - p; g.drawImage(e.last, 0, 0); } else g.drawImage(e.last, -W * p, 0);
      g.restore();
    }
    const a = c.title ? textAlpha(t, c.textFrom, c.textTo) : 0;
    if (a > 0) {
      const inA = ease((t - c.textFrom) / 0.45);
      g.save();
      g.globalAlpha = a;
      g.font = '900 74px Inter, system-ui, -apple-system, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const lines = wrap(g, c.title, W - 200);
      const lh = 88;
      const y0 = H * 0.62 - ((lines.length - 1) * lh) / 2 + (1 - inA) * 60;
      lines.forEach((ln, i) => {
        const y = y0 + i * lh;
        if (c.titleStyle === 'coral') {
          const tw = g.measureText(ln).width + 56;
          g.fillStyle = '#d6334f';
          g.beginPath();
          (g as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect?.(W / 2 - tw / 2, y - 48, tw, 96, 24);
          g.fill();
          g.fillStyle = '#fff';
          g.shadowColor = 'transparent';
        } else {
          g.fillStyle = '#fff';
          g.shadowColor = 'rgba(0,0,0,0.6)';
          g.shadowBlur = 18;
        }
        g.fillText(ln, W / 2, y);
      });
      g.restore();
    }
    stampTxillapp(g, W, H, username, seal);
    const ci = c.cast && e.castImg?.id === c.cast ? e.castImg.img : null;
    if (ci) {
      const size = Math.round(W * 0.24);
      const bounce = Math.abs(Math.sin(t * 2.2)) * 28;
      const pop = ease(t / 0.5);
      g.save();
      g.globalAlpha = pop;
      g.drawImage(ci, 36, H - size - 150 - bounce, size * pop, size * (129 / 132) * pop);
      g.restore();
    }
  }
  const segAt = (list: Seg[], t: number) => { const i = list.findIndex((s) => t < s.start + s.dur); return i < 0 ? list.length - 1 : i; };
  /** Guarda o último frame (sem nada por cima) do bocado anterior, para a transição. */
  function snapLast(prev: Seg) {
    const e = engine.current;
    if (!e.last) { e.last = document.createElement('canvas'); e.last.width = W; e.last.height = H; }
    const lg = e.last.getContext('2d');
    if (lg) { lg.fillStyle = '#000'; lg.fillRect(0, 0, W, H); drawBase(lg, prev, prev.dur, 0); }
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
            v.playbackRate = s.speed;
            v.muted = false;
            v.currentTime = s.from + tl * s.speed;
            void v.play().catch(() => undefined);
            active = v;
          }
          // O vídeo seguinte já fica no ponto de entrada (sem esperar quando chega a vez dele).
          const nx = list[i + 1];
          if (nx?.video) { const nv = videoFor(nx.key, nx.uri); if (nv !== active) { nv.pause(); nv.currentTime = nx.from; } }
          idx = i;
        } else if (active && !active.paused && !active.seeking && Math.abs(active.currentTime - (s.from + tl * s.speed)) > 0.35) {
          active.currentTime = s.from + tl * s.speed; // apanha o atraso
        }
        g.fillStyle = '#000';
        g.fillRect(0, 0, W, H);
        const slide = i > 0 && cfg.current.transition === 'slide' && tl < TR ? W * (1 - ease(tl / TR)) : 0;
        drawBase(g, s, tl, slide);
        overlay(g, t, tl, i);
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
    // Com texto, mostra um instante em que ele já se vê inteiro (à entrada ainda está a aparecer).
    const t = pausedAt.current;
    const at = title.trim() && textAlpha(t, textFrom, textTo) < 0.9 ? Math.min(textFrom + 0.6, Math.max(textFrom, textTo - 0.1)) : t;
    const id = setTimeout(() => void showAt(at), 120);
    return () => clearTimeout(id);
  }, [fullSig]); // eslint-disable-line react-hooks/exhaustive-deps
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
    if (s.video) {
      const v = videoFor(s.key, s.uri);
      v.pause();
      const to = s.from + tl * s.speed;
      if (Math.abs(v.currentTime - to) > 0.02) await Promise.race([new Promise<void>((r) => { v.addEventListener('seeked', () => r(), { once: true }); v.currentTime = to; }), wait(1500)]);
    }
    if (reference && engine.current.ref) engine.current.ref.currentTime = t;
    if (my !== gen.current) return;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    drawBase(g, s, tl, 0);
    overlay(g, t, Math.max(TR, tl), i);
    setT(t);
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
  const TABS: { id: Tab; label: string }[] = [{ id: 'clipes', label: 'Clipes' }, { id: 'som', label: 'Som' }, { id: 'texto', label: 'Texto' }, { id: 'efeitos', label: 'Efeitos' }, { id: 'capa', label: 'Capa' }];
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
        {loading && items.length ? <View style={st.center} pointerEvents="none"><Text style={st.loadText}>A preparar…</Text></View> : null}
        {!playing && !busy ? <View style={st.center} pointerEvents="none"><View style={st.playBig}><Icon name="play" size={34} color="#fff" solid /></View></View> : null}
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

      <ScrollView style={{ maxHeight: 250 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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

            <View style={st.rowWrap}>
              <Text style={st.label}>Transição</Text>
              {chip(transition === 'none', 'Seca', () => setTransition('none'))}
              {chip(transition === 'fade', 'Fundir', () => setTransition('fade'))}
              {chip(transition === 'slide', 'Deslizar', () => setTransition('slide'))}
            </View>
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
          <>
            <View style={st.textRow}>
              <TextInput value={title} editable={!locked} onChangeText={(v) => { if (!locked) setTitle(v.slice(0, 80)); }} placeholder="Texto por cima da tcheka" placeholderTextColor="rgba(255,255,255,0.55)" style={st.input} accessibilityLabel="Texto da tcheka" maxLength={80} />
              {chip(titleStyle === 'branco', 'Branco', () => setTitleStyle('branco'))}
              {chip(titleStyle === 'coral', 'Coral', () => setTitleStyle('coral'))}
            </View>
            <View style={st.trimBox}>
              <Text style={st.label}>Aparece</Text>
              <Text style={st.small}>Entra aos {fmtS(textFrom)} s</Text>
              <RangeSlider label="O texto entra aos" value={textFrom} min={0} max={Math.max(0.5, playTotal - 0.5)} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => { setTextFrom(v); setTextTo((x) => Math.max(x, v + 0.5)); }} onCommit={(v) => void showAt(Math.min(playTotal, v + 0.5))} />
              <Text style={st.small}>Sai aos {fmtS(textTo)} s</Text>
              <RangeSlider label="O texto sai aos" value={textTo} min={0.5} max={Math.max(0.6, playTotal)} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => { setTextTo(v); setTextFrom((x) => Math.min(x, v - 0.5)); }} onCommit={(v) => void showAt(Math.max(0, v - 0.6))} />
            </View>
          </>
        ) : null}

        {tab === 'efeitos' ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 6, alignItems: 'center' }} style={{ maxHeight: 40, marginTop: 10 }} accessibilityRole="tablist" accessibilityLabel="Filtros">
              <Text style={[st.label, { paddingHorizontal: 0 }]}>Filtro</Text>
              {LOOKS.map((l, i) => chip(look === i, l.name, () => setLook(i), l.id))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }} style={{ maxHeight: 64, marginTop: 10 }} accessibilityLabel="Sticker">
              <Text style={[st.label, { paddingHorizontal: 0 }]}>Sticker</Text>
              <Pressable onPress={() => setCast(null)} style={[st.castBtn, cast === null && { borderColor: colors.brand }]} accessibilityRole="button" accessibilityLabel="Sem sticker"><Icon name="x" size={18} color="#fff" /></Pressable>
              {CAST.map((c) => (
                <Pressable key={c.id} onPress={() => setCast(c.id)} style={[st.castBtn, cast === c.id && { borderColor: colors.brand }]} accessibilityRole="button" accessibilityLabel={c.name} accessibilityState={{ selected: cast === c.id }}>
                  <Sticker id={c.id} size={40} />
                </Pressable>
              ))}
            </ScrollView>
          </>
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
  tabBtn: { paddingHorizontal: 10, height: 36, alignItems: 'center', justifyContent: 'center' },
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
