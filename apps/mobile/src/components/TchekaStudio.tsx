import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Track } from '@/lib/api.music';
import { useAuth } from '@/lib/auth';
import { abs } from '@/lib/config';
import { useDesktop } from '@/lib/desktop';
import { stickerById } from '@/lib/stickers';
import { debounce, DRAFT_DEBOUNCE_MS, newDraftId, studioDrafts } from '@/lib/studio/drafts';
import {
  animState, fxSeconds, newSticker, newText, playbackRateAt, resolveFx, restingTime, reverseFrameIndex, sanitizeFx, sanitizeOverlay, sourceOffset, transitionFor,
  type ClipFx, type Overlay, type StickerContent, type StickerOverlay, type TextOverlay,
} from '@/lib/studio/effects';
import { canRedo, canUndo, initHistory, mapAll, pushHistory, redo as redoH, replacePresent, undo as undoH, type History } from '@/lib/studio/history';
import { setStudioFull } from '@/lib/studio/immersive';
import { studioKey } from '@/lib/studio/keys';
import { duplicateClip, makeClip, moveClip, removeClip, replaceMedia, setPhoto, setSpeed, splitAt, startsOf, trimEdge, type ProjectClip, type TrimEdge } from '@/lib/studio/project';
import { loadStudioFonts } from '@/lib/studio/renderFonts';
import { drawClip, FxGL } from '@/lib/studio/renderGL';
import { drawOverlays, type OverlayBox } from '@/lib/studio/renderOverlays';
import { ReverseFrames } from '@/lib/studio/renderReverse';
import { drawTransition, type Scratch } from '@/lib/studio/renderTransitions';
import { dropThumbVideo } from '@/lib/studio/thumbs';
import { stepFrame } from '@/lib/studio/timeline';
import { createUrlKeeper, urlsInUse, type UrlKeeper } from '@/lib/studio/urls';
import {
  beatGrid, checkTcheka, clampTrim, detectBeats, editLocked, fmtS, previewClock, previewResume, rhythmDurations, speedLabel, studioSignature, TCHEKA_MAX_S,
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
import { Timeline, type TimelineLayer } from './studio/Timeline';
import { TimelineActions } from './studio/TimelineActions';
import { GalleryPick, stampTxillapp, type Shot } from './TxCamera';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const W = 1080;
const H = 1920;
/** No computador: a largura da coluna dos painéis, à direita. */
const PANEL_W = 400;
/** A barra do tempo por baixo da imagem. */
const BAR_H = 36;
type Tab = 'clipes' | 'som' | 'texto' | 'stickers' | 'efeitos' | 'capa';

export interface Clip { uri: string; video: boolean; mime: string; durationMs?: number; /** Velocidade a que foi gravado na câmara (0,5× a 3×). */ speed?: number }
/** Um clipe da sequência: o modelo do projeto (lib/studio/project), com o corte, a duração, a velocidade e os efeitos (`fx`). */
type Item = ProjectClip;
/**
 * O projeto (um passo do desfazer/refazer): os clipes, as camadas por cima (textos e stickers) e os URLs dos outros ficheiros
 * que ele usa (`uris`, para não se libertarem enquanto algum passo precisar deles).
 */
interface Project { clips: Item[]; overlays: Overlay[]; uris: string[] }
/** O resto do estúdio que vai no rascunho (e volta ao abri-lo). As camadas vão em `overlays`. */
export interface StudioSettings {
  music: Track | null; rhythm: boolean; origVol: number; musicVol: number; coverAt: number; overlays?: Overlay[];
}
/** Um rascunho aberto: os clipes (já com URLs) e o resto. */
export interface StudioDraftIn { id: string; clips: ProjectClip[]; settings: Partial<StudioSettings> }
/** Um bocado da sequência já montada: onde começa, quanto dura e de onde vem. */
interface Seg { key: string; uri: string; video: boolean; start: number; dur: number; from: number; speed: number; /** segundos do corte (nos vídeos) */ len: number; fx?: ClipFx }
/** Como acabou uma volta da sequência: até ao fim ou interrompida; e o vídeo, se se gravou e ainda vale. */
interface RunOut { finished: boolean; blob: Blob | null }

const recorderType = () => ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const makeItem = (c: Clip): Item => makeClip(c);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** Quanto um clipe dura (sem o ritmo): o corte à velocidade e com a rampa, ou os segundos da foto. */
const clipDur = (it: Item) => (it.video ? fxSeconds(it.trim.end - it.trim.start, it.speed, it.fx) : it.seconds);
/** O clipe com estes efeitos (sem efeitos, o campo sai). */
const withFx = (it: Item, fx: ClipFx | undefined): Item => { if (fx) return { ...it, fx }; if (!('fx' in it)) return it; const { fx: _fx, ...rest } = it; return rest; };
/** A entrada do clipe passa a ser um corte seco (sem transição): o que dividir e congelar fazem na junção nova. */
const hardCut = (it: Item): Item => withFx(it, sanitizeFx({ ...it.fx, transition: { type: 'corte', dur: 0.5 } }));
/** Nenhuma camada passa do fim da tcheka (a lista guardada fica como está: a duração pode voltar a crescer ao desfazer). */
function fitOverlays(list: Overlay[], total: number): Overlay[] {
  if (!total) return list;
  let changed = false;
  const n = list.map((o) => {
    if (o.end <= total + 1e-3) return o;
    changed = true;
    const end = Math.max(Math.min(o.end, total), Math.min(total, o.start + 0.5));
    return { ...o, start: Math.min(o.start, Math.max(0, end - 0.5)), end };
  });
  return changed ? n : list;
}
/** O nome curto de uma camada na linha do tempo. */
function layerLabel(o: Overlay): string {
  if (o.kind === 'text') return o.text.trim().split('\n')[0].slice(0, 40) || 'Texto';
  const s = o.sticker;
  if (s.type === 'mention') return `@${s.username}`;
  if (s.type === 'location') return s.name;
  if (s.type === 'gif') return 'GIF';
  if (s.type === 'time') return 'Hora';
  if (s.type === 'txill') return 'Sticker';
  return 'Emoji';
}
/** Uma miniatura pequena do frame que está no canvas (para a lista dos rascunhos). */
function posterOf(c: HTMLCanvasElement | null): string | undefined {
  try {
    if (!c) return undefined;
    const p = document.createElement('canvas');
    p.width = 90; p.height = 160;
    p.getContext('2d')?.drawImage(c, 0, 0, 90, 160);
    return p.toDataURL('image/jpeg', 0.6);
  } catch { return undefined; }
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
 * - Linha do tempo (components/studio/Timeline) ao nível do CapCut: cortar pelas pontas, dividir, duplicar, reordenar,
 *   velocidade, substituir, zoom; as camadas (textos e stickers) em faixas por cima dos clipes, com o início e o fim a
 *   arrastar; desfazer/refazer até 50 passos (↶ ↷ e Ctrl+Z), para os clipes, os efeitos e as camadas; atalhos no
 *   computador (lib/studio/keys).
 * - Efeitos por clipe (components/studio, lib/studio): 16 filtros com intensidade e miniaturas ao vivo, ajustes (WebGL),
 *   transições por junção, rampas de velocidade, inverter e congelar; textos e stickers (emoji, Txillapp, GIF, @, local,
 *   hora) com animações, a mexer na pré-visualização, com zona segura e guias. O contrato está em docs/estudio-efeitos.md.
 * - Pré-visualização fiel: é o próprio canvas da montagem a tocar, com o som misturado. A primeira volta inteira fica
 *   gravada; se nada mudar, «Seguinte» já não espera pela montagem.
 * - `reference`: um vídeo de referência ao lado (dueto): fica na metade esquerda e a tcheka na direita; o som dele conta
 *   como o som da tcheka.
 * - Rascunho automático (lib/studio/drafts): cada mudança guarda-se no IndexedDB (`draftId`); `draft` abre um guardado.
 */
export function TchekaStudio({ clips, initialMusic, reference, onDone, onClose, draft, draftId, draftContext }: {
  clips: Clip[];
  initialMusic: Track | null;
  reference?: { uri: string } | null;
  onDone: (shot: Shot, music: Track | null) => void;
  onClose: () => void;
  /** Um rascunho a continuar (os clipes dele em vez de `clips`, e o resto do estúdio como estava). */
  draft?: StudioDraftIn | null;
  /** Onde se guarda o rascunho desta sessão (o ecrã de criar apaga-o depois de publicar). */
  draftId?: string;
  /** Vai com o rascunho (o som de outra tcheka, o dueto) para o ecrã de criar repor. */
  draftContext?: Record<string, unknown>;
}) {
  const { user } = useAuth();
  const username = user?.username;
  const seal = sealOf(user);
  const insets = useSafeAreaInsets();
  const init = (draft?.settings ?? {}) as Partial<StudioSettings>;
  const initMusic = init.music !== undefined ? init.music : initialMusic;
  // ---------------------------------------------------------------- o projeto, com desfazer/refazer
  const [hist, setHist] = useState<History<Project>>(() => {
    // Do rascunho: os efeitos e as camadas voltam a passar pela validação do contrato (docs/estudio-efeitos.md).
    const fromDraft = (draft?.clips ?? []).map((c) => withFx(c, sanitizeFx(c.fx)));
    const ovs = (Array.isArray(init.overlays) ? init.overlays : []).map(sanitizeOverlay).filter((o): o is Overlay => !!o);
    return initHistory<Project>({ clips: fromDraft.length ? fromDraft : clips.map(makeItem), overlays: ovs, uris: [] });
  });
  const items = hist.present.clips;
  const lastCommit = useRef<{ tag: string; at: number }>({ tag: '', at: 0 });
  /** Uma mudança do projeto (um passo para desfazer). `merge`: continua o passo anterior (um gesto); `coalesce`: junta as do mesmo controlo seguidas. */
  const commit = (fn: (p: Project) => Project, opts: { merge?: boolean; coalesce?: string } = {}) => {
    const now = Date.now();
    const merge = !!opts.merge || (!!opts.coalesce && lastCommit.current.tag === opts.coalesce && now - lastCommit.current.at < 900);
    lastCommit.current = { tag: opts.coalesce ?? '', at: now };
    setHist((h) => pushHistory(h, fn(h.present), { merge }));
  };
  const setItems = (fn: (l: Item[]) => Item[], opts: { merge?: boolean; coalesce?: string } = {}) => commit((p) => { const c = fn(p.clips); return c === p.clips ? p : { ...p, clips: c }; }, opts);
  const setOverlays = (fn: (l: Overlay[]) => Overlay[], opts: { merge?: boolean; coalesce?: string } = {}) => commit((p) => { const o = fn(p.overlays); return o === p.overlays ? p : { ...p, overlays: o }; }, opts);
  /** O que se descobre dos ficheiros (duração, se têm som): acerta todos os passos e não conta para desfazer. */
  const fixItems = (fn: (l: Item[]) => Item[]) => setHist((h) => mapAll(h, (p) => { const c = fn(p.clips); return c === p.clips ? p : { ...p, clips: c }; }));
  /** O que o estúdio acerta sozinho no estado de agora (não é um passo e não perde o refazer). */
  const fixPresent = (fn: (p: Project) => Project) => setHist((h) => replacePresent(h, fn(h.present)));
  void fixPresent;
  const [selKey, setSelKey] = useState<string | null>(() => hist.present.clips[0]?.key ?? null);
  const sel = items.findIndex((it) => it.key === selKey);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (s: string) => { setNote(s); if (noteTimer.current) clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => setNote(null), 2200); };
  const [tab, setTab] = useState<Tab>('clipes');
  const [selOv, setSelOv] = useState<string | null>(null);
  const [editTick, setEditTick] = useState(0);
  const [stageTick, setStageTick] = useState(0);
  /** Sobe quando chega uma coisa que o desenho esperava (fontes, frames do inverso, imagens dos stickers). */
  const [assetTick, setAssetTick] = useState(0);
  const [revState, setRevState] = useState<Record<string, ReverseState>>({});
  const [freezing, setFreezing] = useState(false);
  const [music, setMusic] = useState<Track | null>(initMusic ?? null);
  const [pickMusic, setPickMusic] = useState(false);
  const pickOpen = useRef(false);
  pickOpen.current = pickMusic;
  const [rhythm, setRhythm] = useState(init.rhythm ?? true);
  const [beatInfo, setBeatInfo] = useState<{ url: string; bpm: number | null; offset: number; detected: boolean } | null>(null);
  // Com um som de outra tcheka (que costuma ser para dobrar), o original começa calado; com música, mais baixo.
  const [origVol, setOrigVol] = useState(num(init.origVol, initMusic ? (initMusic.kind === 'sound' ? 0 : 0.4) : 1));
  const [musicVol, setMusicVol] = useState(num(init.musicVol, 1));
  const [coverAt, setCoverAt] = useState(num(init.coverAt, 0.5));
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
  /** A caixa da linha do tempo (fora dos painéis: no computador fica em baixo, com a largura toda): bloqueia-se igual. */
  const timelineBox = useRef<HTMLElement | null>(null);
  useEffect(() => {
    for (const box of [editBox.current, timelineBox.current]) {
      const el = box as (HTMLElement & { inert?: boolean }) | null;
      if (!el || typeof el.setAttribute !== 'function') continue;
      el.inert = progress !== null;
      if (progress !== null) el.setAttribute('inert', ''); else el.removeAttribute('inert');
      // Quem estava a escrever no texto sai do campo (o teclado deixa de mexer na montagem).
      if (progress !== null && typeof document !== 'undefined' && el.contains(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur?.();
    }
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
  /** As camadas como se veem (nenhuma passa do fim). */
  const overlays = useMemo(() => fitOverlays(hist.present.overlays, playTotal), [hist.present.overlays, playTotal]);
  // Um vídeo ao contrário fica com o som original calado (não conta para o som obrigatório).
  const rules = checkTcheka({ clips: items.map((it, i) => ({ video: it.video, seconds: durations[i], hasAudio: it.fx?.reverse ? false : it.hasAudio })), music: !!music || !!reference, originalVolume: origVol });
  const cur = sel >= 0 ? items[sel] : undefined;

  // A capa nunca passa do fim.
  useEffect(() => { setCoverAt((v) => Math.min(v, Math.max(0, playTotal - 0.1))); }, [playTotal]);

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
      if (!it.video || it.hasAudio !== undefined || probing.current.has(it.media)) continue;
      probing.current.add(it.media);
      void probeAudio(it.uri).then((has) => { if (alive.current) fixItems((l) => l.map((x) => (x.media === it.media ? { ...x, hasAudio: has ?? true } : x))); });
    }
  }, [items]);

  // A duração verdadeira dos vídeos (quando não veio): o corte acompanha.
  useEffect(() => {
    for (const it of items) {
      if (!it.video || it.durationMs) continue;
      const v = videoFor(it.key, it.uri);
      const fix = () => {
        if (!Number.isFinite(v.duration) || v.duration <= 0) return;
        fixItems((l) => l.map((x) => (x.media === it.media && !x.durationMs ? { ...x, durationMs: Math.round(v.duration * 1000), length: v.duration, trim: clampTrim({ start: x.trim.start, end: x.trim.end >= x.length - 0.01 ? v.duration : x.trim.end }, v.duration) } : x)));
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
    setItems((l) => l.map((it, k) => (target === 'all' || k === target ? withFx(it, patch(it.fx, k)) : it)), { coalesce: `fx:${target}` });
  };
  /** Escolher um clipe no painel dos efeitos: a pré-visualização vai para dentro dele (já depois da transição). */
  const pickFxClip = (i: number) => {
    setSelKey(items[i]?.key ?? null);
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
    const k = cur?.key;
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
   * Congelar: o frame que está na pré-visualização vira uma foto parada. A meio de um vídeo divide-o nesse ponto
   * (`splitAt`, como a tesoura) e a foto fica entre as duas partes, com cortes secos; perto das pontas, a foto entra a seguir.
   * É um passo só para desfazer.
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
    const base = items;
    const baseDurs = durations;
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
      if (!alive.current) return;
      const uri = URL.createObjectURL(blob);
      urls.current?.own(uri);
      const photo = withFx({ ...makeItem({ uri, video: false, mime: 'image/jpeg' }), seconds: 2 }, sanitizeFx({ filter: fx?.filter, adjust: fx?.adjust, transition: { type: 'corte', dur: 0.5 }, freeze: { from: s.key, at } }));
      // Sem rampa nem inverso, o ponto do ficheiro e o da tesoura são o mesmo.
      const plain = !fx?.reverse && !fx?.ramp;
      restartFrom.current = s.start;
      setItems((l) => {
        const k = l.findIndex((x) => x.key === s.key);
        if (k < 0) return l;
        const split = plain && l === base ? splitAt(l, t, { durations: baseDurs }) : null;
        if (!split) return [...l.slice(0, k + 1), photo, ...l.slice(k + 1)];
        const j = split.clips.findIndex((x) => x.key === split.right);
        return [...split.clips.slice(0, j), photo, hardCut(split.clips[j]), ...split.clips.slice(j + 1)];
      });
      setSelKey(photo.key);
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
  /** Um gesto no palco (mover, rodar, escalar): as mudanças pelo meio juntam-se num passo só. */
  const ovGesture = useRef<{ on: boolean; pushed: boolean }>({ on: false, pushed: false });
  const changeOverlay = (o: Overlay) => {
    if (locked) return;
    const g = ovGesture.current;
    const opts = g.on ? { merge: g.pushed } : { coalesce: `ov:${o.id}` };
    if (g.on) g.pushed = true;
    setOverlays((l) => l.map((x) => (x.id === o.id ? o : x)), opts);
  };
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
  /** As faixas da linha do tempo (as camadas, de baixo para cima como se desenham). */
  const layers: TimelineLayer[] = useMemo(() => overlays.map((o) => ({ id: o.id, kind: o.kind, label: layerLabel(o), start: o.start, end: o.end, trim: true })), [overlays]);
  /** Arrastar uma faixa na linha do tempo: um passo só; em pausa, mostra o instante em que a camada entra (ou sai). */
  const layerGesture = useRef<{ pushed: boolean; wasPlaying: boolean } | null>(null);
  const onLayer = (id: string, start: number, end: number, phase: 'start' | 'move' | 'end') => {
    if (locked) return;
    if (phase === 'start') { layerGesture.current = { pushed: false, wasPlaying: playingRef.current }; if (playingRef.current) pause(); return; }
    const gst = layerGesture.current;
    if (!gst) return;
    const o = hist.present.overlays.find((x) => x.id === id);
    if (o && (o.start !== start || o.end !== end)) {
      setOverlays((l) => l.map((x) => (x.id === id ? { ...x, start, end } : x)), { merge: gst.pushed });
      gst.pushed = true;
    }
    if (phase === 'end') {
      layerGesture.current = null;
      const n = o ? { ...o, start, end } : null;
      if (gst.wasPlaying) play(Math.max(0, start - 0.3)); else if (n) void showAt(restingTime(n));
    }
  };

  // ---------------------------------------------------------------- edição
  const edit = (i: number, patch: (it: Item) => Item) => { restartFrom.current = segs[i]?.start ?? 0; setItems((l) => l.map((it, k) => (k === i ? patch(it) : it)), { coalesce: `edit:${items[i]?.key ?? i}` }); };
  const addFiles = async (files: File[]) => { const more = await filesToClips(files); more.forEach((c) => urls.current?.own(c.uri)); if (!alive.current) urls.current?.releaseAll(); if (alive.current && more.length) { restartFrom.current = total; setItems((l) => [...l, ...more.map(makeItem)]); } };
  /** A duração de uma batida (ao ritmo), para cortar as fotos nas batidas. */
  const beatPeriod = useRhythm && grid.length > 1 ? grid[1] - grid[0] : undefined;
  const indexOf = (key: string) => items.findIndex((it) => it.key === key);
  /** Apagar um clipe: fica escolhido o que vem a seguir (ou o anterior). */
  const remove = (key: string) => {
    const i = indexOf(key);
    if (i < 0) return;
    restartFrom.current = segs[i]?.start ?? 0;
    const n = removeClip(items, key);
    setItems(() => n);
    setSelKey(n[Math.min(i, n.length - 1)]?.key ?? null);
  };
  /**
   * Dividir no cursor (S): o clipe que lá está fica em dois; fica escolhida a parte da direita, com um corte seco na junção
   * nova (sem transição a meio do mesmo plano). Ao contrário, a primeira parte é o fim do ficheiro.
   */
  const splitHere = () => {
    const t = nowT();
    const r = splitAt(items, t, { durations });
    if (!r) { say('Põe o cursor dentro de um clipe, longe das pontas'); return; }
    restartFrom.current = t;
    setItems(() => r.clips.map((c) => {
      if (c.key !== r.left && c.key !== r.right) return c;
      const src = items.find((x) => x.key === r.left);
      let out = c;
      if (src?.video && src.fx?.reverse) {
        const T = src.trim, cut = r.clips.find((x) => x.key === r.left)!.trim.end;
        const mid = Math.round((T.end - (cut - T.start)) * 1000) / 1000;
        out = { ...c, trim: c.key === r.left ? { start: mid, end: T.end } : { start: T.start, end: mid } };
      }
      return c.key === r.right ? hardCut(out) : out;
    }));
    setSelKey(r.right);
  };
  const duplicate = (key: string) => {
    const r = duplicateClip(items, key, { durations });
    if (!r) { say(`Não cabe: a tcheka vai até ${TCHEKA_MAX_S} s`); return; }
    const i = indexOf(key);
    restartFrom.current = (segs[i]?.start ?? 0) + (durations[i] ?? 0);
    setItems(() => r.clips);
    setSelKey(r.key);
  };
  const reorderClips = (from: number, to: number) => {
    const n = moveClip(items, from, to);
    if (n === items) return;
    restartFrom.current = startsOf(n.map(clipDur))[to] ?? 0;
    setItems(() => n);
    setSelKey(items[from]?.key ?? null);
  };
  const replace = async (key: string, f: File) => {
    const [c] = await filesToClips([f]);
    urls.current?.own(c?.uri);
    if (!c || !alive.current) { if (c) try { URL.revokeObjectURL(c.uri); } catch { /* já livre */ } return; }
    restartFrom.current = segs[indexOf(key)]?.start ?? 0;
    setItems((l) => replaceMedia(l, key, c, { durations }));
  };
  const changeSpeed = (key: string, sp: number) => { restartFrom.current = segs[indexOf(key)]?.start ?? 0; setItems((l) => setSpeed(l, key, sp)); };
  const changePhoto = (key: string, v: { seconds?: number; beats?: number }) => { restartFrom.current = segs[indexOf(key)]?.start ?? 0; setItems((l) => setPhoto(l, key, v)); };
  /** Desfazer e refazer (↶ ↷, Ctrl+Z, Ctrl+Shift+Z): a pré-visualização fica no ponto onde estava. */
  const undo = () => { if (editLocked(progressRef.current) || !canUndo(hist)) return; restartFrom.current = nowT(); setHist(undoH); };
  const redo = () => { if (editLocked(progressRef.current) || !canRedo(hist)) return; restartFrom.current = nowT(); setHist(redoH); };

  // A linha do tempo: escolher, procurar (scrub) e cortar pelas pontas.
  const onSelectClip = (key: string | null) => {
    setSelKey(key);
    if (!key) return;
    setSelOv(null);
    if (tab !== 'efeitos') setTab('clipes');
    const s = segs[indexOf(key)];
    const t = nowT();
    if (s && (t < s.start || t >= s.start + s.dur)) seekTo(s.start);
  };
  const scrubWasPlaying = useRef(false);
  const onSeek = (t: number, phase: 'start' | 'move' | 'end') => {
    if (phase === 'start') scrubWasPlaying.current = playingRef.current;
    if (phase !== 'end') { void showAt(t); return; }
    if (scrubWasPlaying.current) play(t); else void showAt(t);
    scrubWasPlaying.current = false;
  };
  const trimOrigin = useRef<{ clips: Item[]; durations: number[]; starts: number[]; wasPlaying: boolean; pushed: boolean } | null>(null);
  /** Durante o corte, o frame da ponta que se arrasta (mostra-se depois de a sequência mudar). */
  const peek = useRef<number | null>(null);
  const onTrim = (key: string, edge: TrimEdge, delta: number, phase: 'start' | 'move' | 'end'): 'min' | 'max' | null => {
    const i = indexOf(key);
    if (phase === 'start') {
      trimOrigin.current = { clips: items, durations, starts: segs.map((s) => s.start), wasPlaying: playingRef.current, pushed: false };
      if (playingRef.current) pause();
      return null;
    }
    const o = trimOrigin.current;
    if (!o || i < 0) return null;
    // Com rampa, o ficheiro anda à taxa média dela (corte / duração), não só à velocidade do clipe.
    const c0 = o.clips[i];
    const rate = c0?.video && o.durations[i] > 0 ? (c0.trim.end - c0.trim.start) / o.durations[i] : undefined;
    const r = trimEdge(o.clips, key, edge, delta, { durations: o.durations, beatPeriod, rate });
    if (r.clips !== o.clips || o.pushed) { setItems(() => r.clips, { merge: o.pushed }); o.pushed = true; }
    const start = o.starts[i] ?? 0;
    const d = useRhythm && !r.clips[i].video ? o.durations[i] : clipDur(r.clips[i]);
    peek.current = edge === 'start' ? start : Math.max(start, start + d - 1 / 30);
    restartFrom.current = peek.current;
    if (phase === 'end') {
      // Largou: a tocar, continua do início do clipe; em pausa, fica no frame da ponta.
      trimOrigin.current = null;
      if (o.wasPlaying) { peek.current = null; restartFrom.current = start; if (o.pushed) resumeAfterPick.current = true; else play(start); }
    }
    return r.hit;
  };
  useEffect(() => { const t = peek.current; if (t === null || progress !== null) return; peek.current = null; void showAt(t); }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Os atalhos do teclado (computador). Com a montagem em curso, nada.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    if (editLocked(progressRef.current) || pickOpen.current) return;
    const a = studioKey(e);
    if (!a) return;
    e.preventDefault();
    // Um botão com o foco não carrega também (espaço ou Delete iam ativá-lo).
    const el = e.target as HTMLElement | null;
    if (el && el.tagName === 'BUTTON') el.blur();
    if (a === 'play') togglePlay();
    else if (a === 'split') splitHere();
    else if (a === 'delete') { if (selOv) deleteOverlay(selOv); else if (cur) remove(cur.key); }
    else if (a === 'undo') undo();
    else if (a === 'redo') redo();
    else void showAt(stepFrame(nowT(), a === 'next-frame' ? 1 : a === 'prev-frame' ? -1 : a === 'next-second' ? 30 : -30, playTotal));
  };
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // O rascunho: guarda-se a cada mudança (com debounce); sem clipes, apaga-se.
  const draftKey = useRef(draftId ?? draft?.id ?? newDraftId());
  const saver = useMemo(() => debounce((snap: { clips: Item[]; settings: StudioSettings; seconds: number; context?: Record<string, unknown> }) => {
    void studioDrafts().save({ id: draftKey.current, ...snap, settings: { ...snap.settings }, poster: posterOf(canvasRef.current) }).catch(() => undefined);
  }, DRAFT_DEBOUNCE_MS), []);
  const settingsNow: StudioSettings = { music, rhythm, origVol, musicVol, coverAt, overlays: hist.present.overlays };
  const settingsSig = studioSignature(settingsNow);
  useEffect(() => {
    if (progress !== null) return;
    if (!items.length) { saver.cancel(); if (hist.past.length) void studioDrafts().remove(draftKey.current).catch(() => undefined); return; }
    saver({ clips: items, settings: settingsNow, seconds: Math.round(playTotal * 100) / 100, context: draftContext });
  }, [items, settingsSig, progress !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => saver.flush(), [saver]);

  // Os object URLs do estúdio (rascunho reaberto, ficheiros juntados ou substituídos, fotos congeladas): saem quando nenhum
  // passo do histórico os usa e todos ao sair, sempre depois das gravações do rascunho que ainda os possam ler.
  const urls = useRef<UrlKeeper | null>(null);
  if (!urls.current) {
    urls.current = createUrlKeeper((u) => { dropThumbVideo(u); try { URL.revokeObjectURL(u); } catch { /* já livre */ } });
    for (const c of draft?.clips ?? []) urls.current.own(c.uri);
  }
  const histRef = useRef(hist);
  histRef.current = hist;
  useEffect(() => {
    void studioDrafts().idle().then(() => { const h = histRef.current; if (alive.current) urls.current?.sweep(urlsInUse([...h.past, h.present, ...h.future])); });
  }, [hist]);
  useEffect(() => () => { saver.flush(); const k = urls.current; void studioDrafts().idle().then(() => k?.releaseAll()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
  // No computador (≥ 1024 px de largura) o estúdio usa a janela toda (o DesktopShell larga a coluna e a barra lateral).
  const wide = useDesktop();
  useEffect(() => { if (!wide) return; setStudioFull(true); return () => setStudioFull(false); }, [wide]);
  const [stage, setStage] = useState({ y: 0, w: 0, h: 0 });
  /** A pré-visualização 9:16 com a maior altura que cabe (com a margem de 16 de cada lado). */
  const previewW = Math.max(220, Math.min(stage.w - PANEL_W - 24, (stage.h - BAR_H) * (9 / 16) + 32));
  /** O tamanho da pré-visualização (medido) e onde fica a imagem 9:16 dentro dela (a barra do tempo tem a largura dela). */
  const [pv, setPv] = useState({ w: 0, h: 0 });
  const imgW = Math.max(0, Math.min(pv.w, (pv.h - BAR_H) * (9 / 16)));
  const imgBox = { w: imgW || pv.w, left: imgW ? (pv.w - imgW) / 2 : 0 };
  /** Tocar ou pausar (o botão e o toque no vídeo): no fim recomeça do princípio. */
  const togglePlay = () => { if (busy) return; if (playingRef.current) pause(); else play(pausedAt.current >= playTotal - 0.05 ? 0 : pausedAt.current); };

  return (
    <View style={[st.root, { paddingTop: topPad, paddingBottom: botPad }]} accessibilityViewIsModal>
      <View style={st.top}>
        <Pressable onPress={close} style={st.round} accessibilityRole="button" accessibilityLabel="Voltar"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        <Text style={st.title} numberOfLines={1}>Nova tcheka</Text>
        <View style={st.history}>
          <Pressable onPress={undo} disabled={locked || !canUndo(hist)} style={[st.histBtn, (locked || !canUndo(hist)) && st.histOff]} accessibilityRole="button" accessibilityLabel="Desfazer" accessibilityHint="Ctrl+Z">
            <Icon name="undo" size={20} color="#fff" strokeWidth={2.1} />
          </Pressable>
          <Pressable onPress={redo} disabled={locked || !canRedo(hist)} style={[st.histBtn, (locked || !canRedo(hist)) && st.histOff]} accessibilityRole="button" accessibilityLabel="Refazer" accessibilityHint="Ctrl+Shift+Z">
            <View style={{ transform: [{ scaleX: -1 }] }}><Icon name="undo" size={20} color="#fff" strokeWidth={2.1} /></View>
          </Pressable>
        </View>
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

      {/* No computador (≥ 1024 px) o palco fica numa linha: a pré-visualização 9:16 ao centro, com a altura toda, e o espaço
          dos painéis à direita; a linha do tempo vai para baixo, com a largura toda. No telemóvel fica tudo em coluna. */}
      <View style={wide ? st.stageWide : st.stage} onLayout={(e) => { const l = e.nativeEvent.layout; setStage((s) => (s.y === l.y && s.w === l.width && s.h === l.height ? s : { y: l.y, w: l.width, h: l.height })); }}>
      <View style={wide ? [st.previewSlotWide, { width: previewW }] : st.previewSlot}>
      {/* A pré-visualização é o próprio canvas da montagem (o que se vê é o que sai). Tocar na imagem alterna tocar/pausa.
          A barra do tempo fica logo por baixo da imagem, com a largura dela: não tapa o texto nem a assinatura. Um só play
          à vista: o grande ao centro só em pausa; a tocar, o pequeno da barra é a pausa. */}
      <Pressable style={st.preview} onPress={togglePlay} onLayout={(e) => { const l = e.nativeEvent.layout; setPv((p) => (p.w === l.width && p.h === l.height ? p : { w: l.width, h: l.height })); }} accessibilityRole="button" accessibilityLabel={playing ? 'Pausa' : 'Tocar'}>
        {dom('canvas', { ref: (el: HTMLCanvasElement | null) => { canvasRef.current = el; }, width: W, height: H, 'aria-label': 'Pré-visualização da tcheka', style: { position: 'absolute', left: 0, top: 0, width: '100%', height: `calc(100% - ${BAR_H}px)`, objectFit: 'contain', display: 'block', backgroundColor: '#000' } })}
        {/* Os GIFs dos stickers ficam aqui (quase invisíveis) para o browser os animar; o canvas desenha o frame de agora. */}
        {dom('div', { ref: (el: HTMLDivElement | null) => { gifBox.current = el; }, 'aria-hidden': true, style: { position: 'absolute', left: 0, top: 0, width: 2, height: 2, overflow: 'hidden', opacity: 0.01, pointerEvents: 'none' } })}
        {/* Mexer nos textos e stickers (mover, rodar, escalar), com a zona segura e as guias; fora deles, tocar pausa. */}
        <View style={[st.center, { bottom: BAR_H }]} pointerEvents={locked ? 'none' : 'box-none'}>
          <FxStage locked={locked} overlays={overlays} selId={selOv} boxes={() => engine.current.boxes} onSelect={selectOverlay} onChange={changeOverlay} onDelete={deleteOverlay}
            onGesture={(ph) => { ovGesture.current = ph === 'start' ? { on: true, pushed: false } : { on: false, pushed: false }; }}
            onEdit={(id) => { selectOverlay(id); setEditTick((n) => n + 1); }} showSafe={tab === 'texto' || tab === 'stickers'} tick={stageTick} />
        </View>
        {loading && items.length ? <View style={[st.center, { bottom: BAR_H }]} pointerEvents="none"><Text style={st.loadText}>A preparar…</Text></View> : null}
        {!playing && !busy && !selOv ? <View style={[st.center, { bottom: BAR_H }]} pointerEvents="none"><View style={st.playBig}><Icon name="play" size={34} color="#fff" solid /></View></View> : null}
        <View style={[st.controls, { left: imgBox.left, width: imgBox.w }]} pointerEvents="box-none">
          {!busy && playing ? (
            <Pressable onPress={togglePlay} style={({ pressed }) => [st.playBtn, pressed && { transform: [{ scale: 0.92 }] }]} hitSlop={8} accessibilityRole="button" accessibilityLabel={playing ? 'Pausar a pré-visualização' : 'Tocar a pré-visualização'}>
              <Icon name={playing ? 'pause' : 'play'} size={16} color="#fff" solid />
            </Pressable>
          ) : null}
          {!busy ? <Text style={st.clock} pointerEvents="none">{previewClock(playT, playTotal)}{prepared && rules.ok ? ' · pronto' : ''}</Text> : null}
          <View style={st.timeline} pointerEvents="none">
            <View style={[st.timeFill, { width: `${playTotal ? Math.min(100, (playT / playTotal) * 100) : 0}%` }]} />
            {useRhythm ? segs.slice(0, -1).map((s) => <View key={s.key} style={[st.beatTick, { left: `${((s.start + s.dur) / Math.max(0.1, playTotal)) * 100}%` }]} />) : null}
          </View>
        </View>
        {busy && (
          <View style={st.building} pointerEvents="none">
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18 }}>A montar a tcheka…</Text>
            <View style={st.track}><View style={[st.fill, { width: `${Math.round((progress ?? 0) * 100)}%` }]} /></View>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, textAlign: 'center' }}>Faltam {left} s. Não feches a app.</Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, textAlign: 'center' }}>Dica: vê a pré-visualização até ao fim e fica logo pronto.</Text>
          </View>
        )}
      </Pressable>
      </View>
      {wide ? <View style={{ width: PANEL_W + 24 }} /> : null}
      </View>

      {/* A linha do tempo (sempre à vista, em todos os separadores): bloqueada durante a montagem, como os painéis. */}
      <View
        ref={(el) => { timelineBox.current = el as unknown as HTMLElement | null; }}
        style={[{ flexShrink: 0 }, locked && st.locked]}
        pointerEvents={locked ? 'none' : 'auto'}
        accessibilityState={{ disabled: locked }}
        aria-disabled={locked}
      >
      <Timeline
        clips={items}
        durations={durations}
        time={playT}
        playing={playing}
        selected={cur?.key ?? null}
        locked={locked}
        beats={useRhythm ? grid : undefined}
        note={note}
        addButton={<GalleryPick onFiles={(f) => void addFiles(f)} style={st.addClip}><Icon name="plus" size={22} color="#fff" strokeWidth={2.4} /></GalleryPick>}
        onSelect={onSelectClip}
        onSeek={onSeek}
        onTrim={onTrim}
        onMove={reorderClips}
        layers={layers}
        selectedLayer={selOv}
        onSelectLayer={selectOverlay}
        onLayer={onLayer}
      />
      </View>

      {/* Os painéis (clipes, som, texto, efeitos, capa): por baixo no telemóvel; numa coluna à direita no computador. */}
      <View style={wide ? [st.panelWide, { top: stage.y, height: stage.h }] : null}>
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

      <ScrollView style={{ maxHeight: wide ? Math.max(160, stage.h - 56) : 250 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {tab === 'clipes' ? (
          <>
            {/* As ações do clipe escolhido na linha do tempo. */}
            <TimelineActions
              clip={cur ?? null}
              duration={sel >= 0 ? durations[sel] ?? 0 : 0}
              rhythm={useRhythm}
              locked={locked}
              onSplit={splitHere}
              onDuplicate={() => { if (cur) duplicate(cur.key); }}
              onSpeed={(sp) => { if (cur) changeSpeed(cur.key, sp); }}
              onPhoto={(v) => { if (cur) changePhoto(cur.key, v); }}
              onDelete={() => { if (cur) remove(cur.key); }}
              onReplace={(f) => { if (cur) void replace(cur.key, f); }}
            />
            <Text style={st.meta}>{items.length} {items.length === 1 ? 'clipe' : 'clipes'} · {fmtS(total)} s de {TCHEKA_MAX_S} s · arrasta as pontas para cortar, toque longo para mudar a ordem</Text>

            {music && items.some((i) => !i.video) ? (
              <View style={st.rowWrap}>
                <Text style={st.label}>Fotos</Text>
                {chip(useRhythm, 'Ao ritmo', () => { restartFrom.current = nowT(); setRhythm(true); })}
                {chip(!useRhythm, 'Manual', () => { restartFrom.current = nowT(); setRhythm(false); })}
                <Text style={st.small}>{useRhythm ? `${beatInfo ? `${Math.round(beatInfo.bpm ?? 120)} BPM${beatInfo.detected ? '' : ' (fixo)'}` : 'a ouvir a música…'} · a duração de uma foto está em Duração` : 'a duração de uma foto está em Duração ou nas pontas'}</Text>
              </View>
            ) : null}

            {cur?.video ? (
              <>
                <View style={st.trimBox}>
                  <Text style={st.label}>Cortar com precisão · clipe {sel + 1}</Text>
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
            sel={Math.max(0, sel)}
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
      </View>
      {pickMusic ? <MusicPicker allowLocal onClose={closePicker} onPick={pickedMusic} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 6 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minWidth: 0, color: '#fff', fontSize: 17, fontWeight: '800', marginLeft: 12 },
  history: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 10, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', padding: 3 },
  histBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  histOff: { opacity: 0.32 },
  addClip: { width: '100%', height: '100%', borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,79,109,0.7)', backgroundColor: 'rgba(214,51,79,0.12)', alignItems: 'center', justifyContent: 'center' },
  cta: { height: 40, minWidth: 96, paddingHorizontal: 18, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  hintWrap: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: 'rgba(214,51,79,0.92)', paddingHorizontal: 12, paddingVertical: 6, maxWidth: '100%' },
  hintText: { color: '#fff', fontWeight: '700', fontSize: 13, flexShrink: 1 },
  stage: { flex: 1, minHeight: 0 },
  stageWide: { flex: 1, minHeight: 0, flexDirection: 'row', paddingTop: 4, paddingBottom: 10 },
  previewSlot: { flex: 1, minHeight: 0 },
  previewSlotWide: { minHeight: 0, height: '100%', marginLeft: 'auto', marginRight: 'auto' },
  panelWide: { position: 'absolute', right: 12, width: 400, borderRadius: 20, overflow: 'hidden', backgroundColor: '#0b0b11', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingTop: 4 },
  preview: { flex: 1, minHeight: 200, marginHorizontal: 16, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  loadText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700' },
  playBig: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  timeline: { flex: 1, minWidth: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  timeFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: '#fff' },
  beatTick: { position: 'absolute', top: -3, width: 2, height: 10, marginLeft: -1, borderRadius: 1, backgroundColor: '#ffd60a' },
  locked: { opacity: 0.35 },
  controls: { position: 'absolute', bottom: 0, height: BAR_H, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 },
  playBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  clock: { color: '#fff', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  building: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  track: { width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  tabs: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 6 },
  tabBtn: { paddingHorizontal: 8, height: 36, alignItems: 'center', justifyContent: 'center' },
  tabText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '800' },
  tabOn: { color: '#fff' },
  tabDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff', marginTop: 3 },
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
  musicRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14, paddingVertical: 10 },
  smallBtn: { height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  smallBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  err: { color: '#fecaca', textAlign: 'center', marginTop: 8, fontSize: 13 },
});
