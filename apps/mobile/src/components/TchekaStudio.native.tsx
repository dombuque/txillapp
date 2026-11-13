import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Pause, Play, Redo2, Undo2, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/lib/api';
import { musicPayload, type Track } from '@/lib/api.music';
import { abs } from '@/lib/config';
import { shotsFromPicker } from '@/lib/mediaAccess';
import { clampFade, isSfx, SFX, type SfxId } from '@/lib/studio/audioDsp';
import { defaultMix, voiceSecondsIn, type StudioMix, type Template, type VoiceTake } from '@/lib/studio/audioMix';
import { planRhythm, type BeatState } from '@/lib/studio/audioRhythm';
import type { CapulanaSpec } from '@/lib/studio/capulana';
import { isCapulanaTransition, type CapulanaShapeId, type CapulanaTransitionId } from '@/lib/studio/capulanaShapes';
import {
  composeProblem, emptyRecord, preparingState, requestingState, resumeOf, uploadFiles, withJob, withoutJob,
  type ComposeProblem, type JobRecord, type RunState,
} from '@/lib/studio/composeJob';
import { buildComposeRequest, compatRequest, composeBlocker, requestSignature } from '@/lib/studio/composeRequest';
import { Cancelled, pollJob, requestCompose, uploadAll, type Signal } from '@/lib/studio/composeRunner';
import { debounce, DRAFT_DEBOUNCE_MS, newDraftId } from '@/lib/studio/drafts';
import {
  animState, fxSeconds, sourceOffset, newSticker, newText, restingTime, sanitizeFx, sanitizeOverlay, sanitizePano, transitionFor,
  type ClipFx, type Overlay, type StickerContent, type StickerOverlay, type TextOverlay, type TransitionId,
} from '@/lib/studio/effects';
import { canRedo, canUndo, initHistory, pushHistory, redo as redoH, replacePresent, undo as undoH, type History } from '@/lib/studio/history';
import type { MagicResult, MagicSource } from '@/lib/studio/magic';
import { clearNativeMagicCache } from '@/lib/studio/magicAnalyzeNative';
import { cancelMagicUploads, settleMagicUploads } from '@/lib/studio/magicUploads';
import { analyzeMusicNative, type MusicAnalysis } from '@/lib/studio/nativeAudio';
import { loadNativeStudioFonts } from '@/lib/studio/nativeFonts';
import { probeVideoAudio } from '@/lib/studio/nativeVideoAudio';
import { duplicateClip, makeClip, moveClip, normalizeClips, removeClip, replaceMedia, setPhoto, setSpeed, splitAt, startsOf, trimEdge, type ProjectClip, type TrimEdge } from '@/lib/studio/project';
import { clearJobRecord, loadJobRecord, saveJobRecord, studioStore } from '@/lib/studio/studioStore';
import { beatGrid, checkTcheka, clampTrim, editLocked, FALLBACK_BPM, fmtS, previewClock, rhythmDurations, speedLabel, TCHEKA_MAX_S } from '@/lib/tchekaRules';
import { colors } from '@/lib/theme';
import { MusicPicker } from './MusicPicker';
import { RangeSlider } from './RangeSlider';
import { CapulanaPanel } from './studio/CapulanaPanel';
import type { FxTarget, ReverseState } from './studio/FxPanel';
import { MagicButton } from './studio/MagicButton';
import { StickerTray } from './studio/StickerTray';
import { TextPanel } from './studio/TextPanel';
import type { TimelineLayer } from './studio/Timeline';
import { AudioMarks } from './studio/native/AudioMarks';
import { createClockStore } from './studio/native/clockStore';
import { fitStage, GRAB_H, studioLayout, TABS_H, TOP_H } from '@/lib/studio/nativeLayout';
import { NativeClipActions } from './studio/native/NativeClipActions';
import { NativeComposeOverlay } from './studio/native/NativeComposeOverlay';
import { NativeFxPanel } from './studio/native/NativeFxPanel';
import { NativeMagic } from './studio/native/NativeMagic';
import { NativeOverlays } from './studio/native/NativeOverlays';
import { NativeSoundPanel, type ClipSound } from './studio/native/NativeSoundPanel';
import { LookNote, NativeStage, type StageSeg } from './studio/native/NativeStage';
import { cachedVideoThumb, NativeTimeline } from './studio/native/NativeTimeline';
import { useFrameGrab } from './studio/native/useFrameGrab';
import { usePreviewAudio } from './studio/native/usePreviewAudio';
import type { Shot } from './TxCamera';

type Tab = 'clipes' | 'som' | 'texto' | 'stickers' | 'efeitos' | 'capa';
type SheetH = 'baixa' | 'media' | 'alta';
export interface Clip { uri: string; video: boolean; mime: string; durationMs?: number; speed?: number }
type Item = ProjectClip;
interface Project { clips: Item[]; overlays: Overlay[]; mix: StudioMix; origVol: number; musicVol: number; applied: string | null; uris: string[] }
export interface StudioSettings {
  music: Track | null; rhythm: boolean; origVol: number; musicVol: number; coverAt: number; overlays?: Overlay[]; mix?: StudioMix; applied?: string | null; pano?: CapulanaSpec;
}
export interface StudioDraftIn { id: string; clips: ProjectClip[]; settings: Partial<StudioSettings>; media?: Record<string, string> }

const DEFAULT_PANO: CapulanaSpec = { pattern: 'losangos', palette: 'coral', seed: 1 };
const TEMPLATE_TRANSITION: Record<Template['transition'], TransitionId> = { none: 'corte', fade: 'fundido', slide: 'deslizar-esquerda' };
const TABS: { id: Tab; label: string }[] = [{ id: 'clipes', label: 'Clipes' }, { id: 'som', label: 'Som' }, { id: 'texto', label: 'Texto' }, { id: 'stickers', label: 'Stickers' }, { id: 'efeitos', label: 'Efeitos' }, { id: 'capa', label: 'Capa' }];
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clipDur = (it: Item) => (it.video ? fxSeconds(it.trim.end - it.trim.start, it.speed, it.fx) : it.seconds);
const withFx = (it: Item, fx: ClipFx | undefined): Item => { if (fx) return { ...it, fx }; if (!('fx' in it)) return it; const { fx: _fx, ...rest } = it; return rest; };
const hardCut = (it: Item): Item => withFx(it, sanitizeFx({ ...it.fx, transition: { type: 'corte', dur: 0.5 } }));
const soundOn = (it: Item) => it.sound !== false && (it.volume ?? 1) > 0;
function mixFromDraft(raw: unknown, media: Record<string, string> | undefined): StudioMix {
  const base = defaultMix();
  if (!raw || typeof raw !== 'object') return base;
  const m = { ...base, ...(raw as Partial<StudioMix>) };
  const v = m.voice;
  const uri = v ? media?.[v.id] : undefined;
  return { ...m, sfx: Array.isArray(m.sfx) ? m.sfx.filter((s) => isSfx(s?.id)) : [], voice: v && uri ? { ...v, uri } : null };
}
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
function layerLabel(o: Overlay): string {
  if (o.kind === 'text') return o.text.trim().split('\n')[0].slice(0, 40) || 'Texto';
  const s = o.sticker;
  if (s.type === 'mention') return `@${s.username}`;
  if (s.type === 'location') return s.name;
  if (s.type === 'gif') return 'GIF';
  if (s.type === 'time') return 'Hora';
  if (s.type === 'txill') return 'Sticker';
  if (s.type === 'capulana') return 'Capulana';
  return s.emoji;
}
const videoMime = (t?: string | null) => (t && ['video/mp4', 'video/quicktime', 'video/webm'].includes(t) ? t : 'video/mp4');
async function pickFiles(multi: boolean, max: number): Promise<Clip[]> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: multi, selectionLimit: multi ? Math.max(1, max) : 1, quality: 1, videoMaxDuration: 60 });
  if (r.canceled || !r.assets?.length) return [];
  const { shots, tooLong } = shotsFromPicker(r.assets);
  if (tooLong) Alert.alert('Vídeo longo demais', 'Os vídeos têm de ter até 60 segundos. Deixei de fora os mais longos.');
  return shots.map((s) => ({ uri: s.uri, video: s.video, mime: s.video ? videoMime(s.mime) : s.mime, durationMs: s.durationMs }));
}

/**
 * O estúdio das tchekas no telemóvel (Android e iPhone), com o que o site tem (TchekaStudio.tsx): a imagem grande em cima, a
 * linha do tempo (lib/studio/project, desfazer/refazer), os separadores numa folha com três alturas (só os separadores; o
 * painel no lugar da linha do tempo; o painel por cima de parte da imagem) e «Seguinte», que monta no servidor
 * (POST /tchekas/compose, docs/montagem.md) e mostra o vídeo montado para publicar. Ver docs/estudio-nativo.md.
 */
export function TchekaStudio({ clips, initialMusic, reference, onDone, onClose, draft, draftId, draftContext, startMagic, soundId, soundTrackId, duetPostId }: {
  clips: Clip[];
  initialMusic: Track | null;
  reference?: { uri: string } | null;
  onDone: (shot: Shot, music: Track | null) => void;
  onClose: () => void;
  draft?: StudioDraftIn | null;
  draftId?: string;
  draftContext?: Record<string, unknown>;
  startMagic?: boolean;
  soundId?: string | null;
  soundTrackId?: string | null;
  duetPostId?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const init = (draft?.settings ?? {}) as Partial<StudioSettings>;
  const initMusic = init.music !== undefined ? init.music : initialMusic;
  // ---------------------------------------------------------------- o projeto, com desfazer/refazer
  const [hist, setHist] = useState<History<Project>>(() => {
    const fromDraft = (draft?.clips ?? []).map((c) => withFx(c, sanitizeFx(c.fx)));
    const ovs = (Array.isArray(init.overlays) ? init.overlays : []).map(sanitizeOverlay).filter((o): o is Overlay => !!o);
    const list = fromDraft.length ? fromDraft : clips.map((c) => makeClip(c));
    const mix = mixFromDraft(init.mix, draft?.media);
    const withVideo = list.some((c) => c.video);
    const origVol = num(init.origVol, initMusic?.kind === 'sound' ? 0 : 1);
    const musicVol = num(init.musicVol, initMusic && initMusic.kind !== 'sound' && withVideo ? 0.7 : 1);
    return initHistory<Project>({ clips: list, overlays: ovs, mix, origVol, musicVol, applied: typeof init.applied === 'string' ? init.applied : null, uris: mix.voice?.uri ? [mix.voice.uri] : [] });
  });
  const items = hist.present.clips;
  const lastCommit = useRef<{ tag: string; at: number }>({ tag: '', at: 0 });
  const commit = (fn: (p: Project) => Project, opts: { merge?: boolean; coalesce?: string } = {}) => {
    const now = Date.now();
    const merge = !!opts.merge || (!!opts.coalesce && lastCommit.current.tag === opts.coalesce && now - lastCommit.current.at < 900);
    lastCommit.current = { tag: opts.coalesce ?? '', at: now };
    setHist((h) => pushHistory(h, fn(h.present), { merge }));
  };
  const setItems = (fn: (l: Item[]) => Item[], opts: { merge?: boolean; coalesce?: string } = {}) => commit((p) => { const c = fn(p.clips); return c === p.clips ? p : { ...p, clips: c }; }, opts);
  const setOverlays = (fn: (l: Overlay[]) => Overlay[], opts: { merge?: boolean; coalesce?: string } = {}) => commit((p) => { const o = fn(p.overlays); return o === p.overlays ? p : { ...p, overlays: o }; }, opts);
  const fixPresent = (fn: (p: Project) => Project) => setHist((h) => replacePresent(h, fn(h.present)));
  const [selKey, setSelKey] = useState<string | null>(() => hist.present.clips[0]?.key ?? null);
  const sel = items.findIndex((it) => it.key === selKey);
  const cur = sel >= 0 ? items[sel] : undefined;
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (s: string) => { setNote(s); if (noteTimer.current) clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => setNote(null), 2400); };
  const [tab, setTab] = useState<Tab>('clipes');
  const [sheet, setSheet] = useState<SheetH>('media');
  const [selOv, setSelOv] = useState<string | null>(null);
  const [selSound, setSelSound] = useState<string | null>(null);
  const [editTick, setEditTick] = useState(0);
  const [pano, setPano] = useState<CapulanaSpec>(() => sanitizePano(init.pano) ?? DEFAULT_PANO);
  const [magic, setMagic] = useState(!!startMagic);
  const [fxMode, setFxMode] = useState<'efeitos' | 'capulana'>('efeitos');
  const [music, setMusic] = useState<Track | null>(initMusic ?? null);
  const [pickMusic, setPickMusic] = useState(false);
  const [rhythm, setRhythm] = useState(init.rhythm ?? true);
  const [coverAt, setCoverAt] = useState(num(init.coverAt, 0.5));
  const [freezing, setFreezing] = useState(false);
  const { origVol, musicVol, applied, mix } = hist.present;
  const setOrigVol = (v: number) => commit((p) => (p.origVol === v ? p : { ...p, origVol: v }), { coalesce: 'vol:orig' });
  const setMusicVol = (v: number) => commit((p) => (p.musicVol === v ? p : { ...p, musicVol: v }), { coalesce: 'vol:music' });
  const setMix = (fn: (m: StudioMix) => StudioMix, coalesce = 'mix') => commit((p) => { const m = fn(p.mix); return m === p.mix ? p : { ...p, mix: m, uris: m.voice?.uri ? [m.voice.uri] : [] }; }, { coalesce });
  const setClipSound = (key: string, v: { on?: boolean; volume?: number }) => setItems((l) => l.map((c) => {
    if (c.key !== key || !c.video) return c;
    const n: Item = { ...c };
    if (v.on !== undefined) { if (v.on) delete n.sound; else n.sound = false; }
    if (v.volume !== undefined) { const vol = Math.round(Math.max(0, Math.min(1, v.volume)) * 100) / 100; if (vol === 1) delete n.volume; else n.volume = vol; }
    return n;
  }), { coalesce: `snd:${key}` });

  // ---------------------------------------------------------------- a montagem («Seguinte»)
  const [run, setRun] = useState<RunState | null>(null);
  const [problem, setProblem] = useState<ComposeProblem | null>(null);
  const [result, setResult] = useState<{ mediaId: string; durationMs?: number } | null>(null);
  const [resultNote, setResultNote] = useState<string | null>(null);
  const signal = useRef<Signal | null>(null);
  const locked = editLocked(run || result ? 1 : null);

  // ---------------------------------------------------------------- a música (onda e ritmo)
  const musicUrl = music?.url ? abs(music.url) ?? music.url : null;
  const [analysis, setAnalysis] = useState<MusicAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  useEffect(() => {
    setAnalysis(null);
    if (!musicUrl || music?.kind === 'sound') return;
    let off = false;
    setAnalyzing(true);
    void analyzeMusicNative(musicUrl).then((a) => { if (!off) { setAnalysis(a); setAnalyzing(false); } });
    return () => { off = true; };
  }, [musicUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- a sequência
  const photosOnly = items.length > 0 && items.every((i) => !i.video);
  const useRhythm = rhythm && !!music && items.some((i) => !i.video);
  const beatInfo: BeatState | null = useMemo(() => {
    if (!music) return null;
    if (analysis) return analysis.beats(mix.musicStartMs);
    const bpm = (music as Track & { bpm?: number }).bpm ?? null;
    return { url: music.url, start: mix.musicStartMs, bpm, offset: 0, detected: false };
  }, [analysis, music, mix.musicStartMs]);
  const grid = useMemo(() => (useRhythm ? beatGrid(beatInfo?.bpm ?? null, beatInfo?.offset ?? 0, TCHEKA_MAX_S + 30) : []), [useRhythm, beatInfo]);
  const durations = useMemo(() => {
    const base = items.map(clipDur);
    return useRhythm ? rhythmDurations(items.map((it, i) => ({ video: it.video, seconds: base[i], beats: it.beats })), grid) : base;
  }, [items, useRhythm, grid]);
  const total = durations.reduce((n, d) => n + d, 0);
  const playTotal = Math.min(total, TCHEKA_MAX_S);
  const overlays = useMemo(() => fitOverlays(hist.present.overlays, playTotal), [hist.present.overlays, playTotal]);
  const segs: StageSeg[] = useMemo(() => {
    let t = 0;
    return items.map((it, i) => {
      const s: StageSeg = { key: it.key, uri: it.uri, video: it.video, start: t, dur: durations[i], from: it.video ? it.trim.start : 0, len: it.video ? Math.max(0, it.trim.end - it.trim.start) : durations[i], speed: it.video ? it.speed : 1, fx: it.fx, volume: it.video && soundOn(it) ? it.volume ?? 1 : 0 };
      t += durations[i];
      return s;
    });
  }, [items, durations]);
  const rules = checkTcheka({ clips: items.map((it, i) => ({ video: it.video, seconds: durations[i], hasAudio: it.fx?.reverse || !soundOn(it) ? false : it.hasAudio })), music: !!music || !!reference, originalVolume: origVol, voiceSeconds: voiceSecondsIn(mix.voice, playTotal) });

  // A sugestão do trecho entra sozinha enquanto ninguém mexer nele (como no site).
  const suggestion = useMemo(() => (analysis && analysis.duration >= playTotal + 4 ? analysis.suggest(Math.max(3, playTotal)) : null), [analysis, Math.round(playTotal)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!suggestion || !mix.musicStartAuto) return;
    const ms = Math.round(suggestion.start * 1000);
    if (ms !== mix.musicStartMs) fixPresent((p) => ({ ...p, mix: { ...p.mix, musicStartMs: ms } }));
  }, [suggestion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCoverAt((v) => Math.min(v, Math.max(0, playTotal - 0.1))); }, [playTotal]);

  // ---------------------------------------------------------------- o relógio da pré-visualização
  const clock = useMemo(() => createClockStore(playTotal), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clock.dispose(), [clock]);
  useEffect(() => { clock.resize(playTotal); }, [clock, playTotal]);
  const [playing, setPlaying] = useState(false);
  const [playT, setPlayT] = useState(0);
  useEffect(() => {
    let last = 0;
    return clock.subscribe((t, on) => {
      setPlaying((o) => (o === on ? o : on));
      const ms = Date.now();
      if (on && ms - last < 250) return;
      last = ms;
      setPlayT(t);
    });
  }, [clock]);
  const nowT = () => clock.time();
  const [voiceRec, setVoiceRec] = useState(false);
  usePreviewAudio({ clock, musicUrl: music?.kind === 'sound' || music ? musicUrl : null, mix, musicVol, total: playTotal, muteVoice: voiceRec, muted: !!result });
  useEffect(() => { void loadNativeStudioFonts(); return () => clearNativeMagicCache(); }, []);
  // Começa a tocar quando abre (como no site).
  useEffect(() => { if (items.length && !startMagic) setTimeout(() => clock.play(0), 400); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Em segundo plano a pré-visualização pára.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') clock.pause(); });
    return () => sub.remove();
  }, [clock]);

  // ---------------------------------------------------------------- edição dos clipes
  const indexOf = (key: string) => items.findIndex((it) => it.key === key);
  const startOf = (key: string) => segs[indexOf(key)]?.start ?? 0;
  const beatPeriod = useRhythm && grid.length > 1 ? grid[1] - grid[0] : undefined;
  const edit = (i: number, patch: (it: Item) => Item) => { setItems((l) => l.map((it, k) => (k === i ? patch(it) : it)), { coalesce: `edit:${items[i]?.key ?? i}` }); };
  const remove = (key: string) => {
    const i = indexOf(key);
    if (i < 0) return;
    const n = removeClip(items, key);
    setItems(() => n);
    setSelKey(n[Math.min(i, n.length - 1)]?.key ?? null);
    clock.seek(segs[i]?.start ?? 0);
  };
  const splitHere = () => {
    const t = nowT();
    const r = splitAt(items, t, { durations });
    if (!r) { say('Põe o cursor dentro de um clipe, longe das pontas'); return; }
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
    void Haptics.selectionAsync().catch(() => undefined);
  };
  const duplicate = (key: string) => {
    const r = duplicateClip(items, key, { durations });
    if (!r) { say(`Não cabe: a tcheka vai até ${TCHEKA_MAX_S} s`); return; }
    setItems(() => r.clips);
    setSelKey(r.key);
  };
  const reorderClips = (from: number, to: number) => {
    const n = moveClip(items, from, to);
    if (n === items) return;
    setItems(() => n);
    setSelKey(items[from]?.key ?? null);
    clock.seek(startsOf(n.map(clipDur))[to] ?? 0);
  };
  const addFiles = async () => {
    if (locked) return;
    clock.pause();
    const more = await pickFiles(true, Math.max(1, 30 - items.length)).catch(() => []);
    if (more.length) setItems((l) => [...l, ...more.map((c) => makeClip(c))]);
  };
  const replace = async (key: string) => {
    if (locked) return;
    clock.pause();
    const [c] = await pickFiles(false, 1).catch(() => [] as Clip[]);
    if (c) setItems((l) => replaceMedia(l, key, c, { durations }));
  };
  const changeSpeed = (key: string, sp: number) => setItems((l) => setSpeed(l, key, sp));
  const changePhoto = (key: string, v: { seconds?: number; beats?: number }) => setItems((l) => setPhoto(l, key, v));
  const undo = () => { if (locked || !canUndo(hist)) return; setHist(undoH); };
  const redo = () => { if (locked || !canRedo(hist)) return; setHist(redoH); };

  const onSelectClip = (key: string | null) => {
    setSelKey(key);
    if (!key) return;
    setSelOv(null);
    setSelSound(null);
    // As ações do clipe estão no separador Clipes (nos Efeitos, o clipe escolhido é o que se edita).
    if (tab !== 'efeitos') setTab('clipes');
    setSheet((h) => (h === 'baixa' ? 'media' : h));
    const s = segs[indexOf(key)];
    const t = nowT();
    if (s && (t < s.start || t >= s.start + s.dur)) clock.seek(s.start + 0.01);
  };
  const scrubWasPlaying = useRef(false);
  const onSeek = (t: number, phase: 'start' | 'move' | 'end') => {
    if (phase === 'start') { scrubWasPlaying.current = playing; clock.pause(); return; }
    clock.seek(t);
    if (phase === 'end' && scrubWasPlaying.current) { scrubWasPlaying.current = false; clock.play(t); }
  };
  const trimOrigin = useRef<{ clips: Item[]; durations: number[]; starts: number[]; wasPlaying: boolean; pushed: boolean } | null>(null);
  const onTrim = (key: string, edge: TrimEdge, delta: number, phase: 'start' | 'move' | 'end'): 'min' | 'max' | null => {
    const i = indexOf(key);
    if (phase === 'start') {
      trimOrigin.current = { clips: items, durations, starts: segs.map((s) => s.start), wasPlaying: clock.playing(), pushed: false };
      clock.pause();
      return null;
    }
    const o = trimOrigin.current;
    if (!o || i < 0) return null;
    const c0 = o.clips[i];
    const rate = c0?.video && o.durations[i] > 0 ? (c0.trim.end - c0.trim.start) / o.durations[i] : undefined;
    const r = trimEdge(o.clips, key, edge, delta, { durations: o.durations, beatPeriod, rate });
    if (r.clips !== o.clips || o.pushed) { setItems(() => r.clips, { merge: o.pushed }); o.pushed = true; }
    const start = o.starts[i] ?? 0;
    const d = useRhythm && !r.clips[i].video ? o.durations[i] : clipDur(r.clips[i]);
    clock.seek(edge === 'start' ? start : Math.max(start, start + d - 1 / 30));
    if (phase === 'end') { trimOrigin.current = null; if (o.wasPlaying) setTimeout(() => clock.play(start), 120); }
    return r.hit;
  };

  // ---------------------------------------------------------------- efeitos e camadas
  const setFx = (target: FxTarget, patch: (fx: ClipFx | undefined, i: number) => ClipFx | undefined) => {
    if (locked) return;
    setItems((l) => l.map((it, k) => (target === 'all' || k === target ? withFx(it, patch(it.fx, k)) : it)), { coalesce: `fx:${target}` });
  };
  const pickFxClip = (i: number) => {
    setSelKey(items[i]?.key ?? null);
    const s = segs[i];
    if (!s) return;
    const tr = transitionFor(s.fx, i, s.dur);
    clock.seek(s.start + Math.min(s.dur * 0.5, (tr?.dur ?? 0) + 0.05));
  };
  const previewJunction = (i: number) => clock.play(Math.max(0, (segs[i]?.start ?? 0) - 0.6));
  const frameGrab = useFrameGrab();
  async function freezeFrame() {
    if (locked || freezing) return;
    const t = nowT();
    const k = segs.findIndex((s) => t < s.start + s.dur);
    const s = segs[k < 0 ? segs.length - 1 : k];
    if (!s?.video) { say('Põe a pré-visualização num vídeo para congelar um frame.'); return; }
    clock.pause();
    setFreezing(true);
    try {
      const tl = Math.max(0, Math.min(s.dur - 0.01, t - s.start));
      const off = sourceOffset(tl, s.dur, s.len, s.speed, s.fx);
      const at = s.fx?.reverse ? s.from + s.len - off : s.from + off;
      const shot = await frameGrab.grab(s.uri, at);
      if (!shot) { say('Não consegui congelar este frame.'); return; }
      const fx = s.fx;
      const photo = withFx({ ...makeClip({ uri: shot.uri, video: false, mime: 'image/jpeg' }), seconds: 2 }, sanitizeFx({ filter: fx?.filter, adjust: fx?.adjust, transition: { type: 'corte', dur: 0.5 }, freeze: { from: s.key, at: Math.round(at * 1000) / 1000 } }));
      const plain = !fx?.reverse && !fx?.ramp;
      setItems((l) => {
        const j = l.findIndex((x) => x.key === s.key);
        if (j < 0) return l;
        const split = plain ? splitAt(l, t, { durations }) : null;
        if (!split) return [...l.slice(0, j + 1), photo, ...l.slice(j + 1)];
        const r = split.clips.findIndex((x) => x.key === split.right);
        return [...split.clips.slice(0, r), photo, hardCut(split.clips[r]), ...split.clips.slice(r + 1)];
      });
      setSelKey(photo.key);
    } finally {
      setFreezing(false);
    }
  }
  const texts = overlays.filter((o): o is TextOverlay => o.kind === 'text');
  const stickerOvs = overlays.filter((o): o is StickerOverlay => o.kind === 'sticker');
  const openSheet = (h: SheetH) => setSheet((s) => (s === 'alta' && h === 'media' ? s : h));
  const selectOverlay = (id: string | null) => {
    const o = id ? overlays.find((x) => x.id === id) : null;
    setSelOv(o ? o.id : null);
    if (!o) return;
    setSelSound(null);
    setTab(o.kind === 'text' ? 'texto' : 'stickers');
    if (!clock.playing() && !animState(o, nowT()).visible) clock.seek(restingTime(o));
  };
  const changeOverlay = (o: Overlay) => { if (!locked) setOverlays((l) => l.map((x) => (x.id === o.id ? o : x)), { coalesce: `ov:${o.id}` }); };
  const deleteOverlay = (id: string) => { if (locked) return; setOverlays((l) => l.filter((x) => x.id !== id)); setSelOv((s) => (s === id ? null : s)); };
  const addText = () => {
    if (locked) return;
    clock.pause();
    const o = newText(nowT(), playTotal);
    setOverlays((l) => [...l, o]);
    setSelOv(o.id);
    setEditTick((n) => n + 1);
    setSheet('alta');
  };
  const addSticker = (c: StickerContent) => {
    if (locked) return;
    const o = newSticker(c, 0, playTotal);
    const pic = (t: string) => t === 'emoji' || t === 'txill' || t === 'gif' || t === 'capulana';
    const same = stickerOvs.filter((s) => pic(s.sticker.type) === pic(c.type)).length;
    if (pic(c.type)) { o.x = 0.28 + (same % 3) * 0.2; o.y = 0.24 + Math.floor(same / 3) * 0.12; }
    else { o.x = 0.46; o.y = Math.min(0.72, 0.5 + same * 0.115); }
    setOverlays((l) => [...l, o]);
    setSelOv(o.id);
  };
  const addLayer = (o: Overlay) => { if (locked) return; clock.pause(); setOverlays((l) => [...l, o]); setSelOv(o.id); };
  const layers: TimelineLayer[] = useMemo(() => {
    const out: TimelineLayer[] = overlays.map((o) => ({ id: o.id, kind: o.kind, label: layerLabel(o), start: o.start, end: o.end, trim: true }));
    const v = mix.voice;
    if (v) out.push({ id: 'voice', kind: 'voice', label: 'Voz-off', start: v.at, end: Math.min(playTotal || v.at + v.duration, v.at + v.duration) });
    for (const x of mix.sfx) out.push({ id: `sfx:${x.key}`, kind: 'sfx', label: SFX.find((d) => d.id === x.id)?.name ?? 'Efeito sonoro', start: x.at, end: x.at, point: true });
    return out;
  }, [overlays, mix.voice, mix.sfx, playTotal]);
  const selectLayer = (id: string | null) => {
    if (id === 'voice' || id?.startsWith('sfx:')) { setSelSound(id); setSelOv(null); setTab('som'); setSheet((h) => (h === 'baixa' ? 'media' : h)); return; }
    setSelSound(null);
    selectOverlay(id);
  };
  const layerGesture = useRef<{ pushed: boolean; wasPlaying: boolean } | null>(null);
  const onLayer = (id: string, start: number, end: number, phase: 'start' | 'move' | 'end') => {
    if (locked) return;
    if (phase === 'start') { layerGesture.current = { pushed: false, wasPlaying: clock.playing() }; clock.pause(); return; }
    const g = layerGesture.current;
    if (!g) return;
    if (id === 'voice' || id.startsWith('sfx:')) {
      const at = Math.round(start * 1000) / 1000;
      const k = id.slice(4);
      commit((p) => ({ ...p, mix: id === 'voice' ? (p.mix.voice ? { ...p.mix, voice: { ...p.mix.voice, at } } : p.mix) : { ...p.mix, sfx: p.mix.sfx.map((x) => (x.key === k ? { ...x, at } : x)) } }), { merge: g.pushed });
      g.pushed = true;
      clock.seek(at);
    } else {
      setOverlays((l) => l.map((x) => (x.id === id ? { ...x, start, end } : x)), { merge: g.pushed });
      g.pushed = true;
      clock.seek(phase === 'end' ? Math.min(end - 0.05, start + 0.5) : start);
    }
    if (phase === 'end') { layerGesture.current = null; if (g.wasPlaying) clock.play(Math.max(0, start - 0.3)); }
  };
  const deleteSound = (id: string) => {
    if (locked) return;
    if (id === 'voice') setMix((m) => ({ ...m, voice: null }));
    else { const k = id.slice(4); setMix((m) => ({ ...m, sfx: m.sfx.filter((x) => x.key !== k) })); }
    setSelSound(null);
  };

  // ---------------------------------------------------------------- som
  function rhythmFit(tpl?: Template | null) {
    if (locked) return;
    const tr = tpl ? TEMPLATE_TRANSITION[tpl.transition] : null;
    const withTransition = (l: Item[]) => (tr ? l.map((it) => withFx(it, sanitizeFx({ ...it.fx, transition: { type: tr, dur: it.fx?.transition?.dur ?? 0.5 } }))) : l);
    if (!music) {
      if (!tpl) return;
      commit((p) => {
        let l = p.clips;
        for (const it of l) if (!it.video) l = setPhoto(l, it.key, { seconds: tpl.photoSeconds });
        return { ...p, clips: withTransition(l), applied: tpl.id };
      });
      return;
    }
    const startMs = tpl && analysis && music.kind !== 'sound' ? Math.round(analysis.suggest(playTotal, tpl.start).start * 1000) : mix.musicStartMs;
    const beat: BeatState = analysis ? analysis.beats(startMs) : { url: music.url, start: startMs, bpm: (music as Track & { bpm?: number }).bpm ?? FALLBACK_BPM, offset: 0, detected: false };
    const rateOf = (it: Item) => { const d = clipDur(it); return it.video && d > 0 ? (it.trim.end - it.trim.start) / d : it.speed; };
    const plan = planRhythm(items.map((it) => ({ video: it.video, seconds: clipDur(it), trim: it.trim, length: it.length, speed: rateOf(it) })), beat, tpl);
    commit((p) => {
      let l = p.clips;
      p.clips.forEach((it, i) => {
        if (!it.video) { const b = plan.beats[i]; if (b != null) l = setPhoto(l, it.key, { beats: b }); return; }
        const want = plan.trims[i];
        if (!want) return;
        for (const edge of ['start', 'end'] as const) {
          const c = l.find((x) => x.key === it.key)!;
          const delta = (want[edge] - c.trim[edge]) / rateOf(c);
          if (Math.abs(delta) > 1e-4) l = trimEdge(l, c.key, edge, delta, { durations: l.map(clipDur), rate: rateOf(c) }).clips;
        }
      });
      return { ...p, clips: withTransition(l), applied: tpl ? tpl.id : p.applied, mix: { ...p.mix, musicStartMs: plan.musicStartMs, musicStartAuto: false, ...(tpl ? { fadeIn: tpl.fadeIn, fadeOut: tpl.fadeOut } : {}) } };
    });
    setRhythm(true);
    setTimeout(() => clock.play(0), 300);
  }
  const fitNote = !music ? 'Escolhe uma música primeiro' : `${Math.round(beatInfo?.bpm ?? FALLBACK_BPM)} BPM${beatInfo && !beatInfo.detected ? ' (fixo: o servidor lê as batidas na montagem)' : ''}: as fotos e os cortes dos vídeos caem nas batidas do trecho`;
  const pickedMusic = (t: Track) => {
    setMusic(t);
    setRhythm(true);
    // A música nova volta a ter o trecho sugerido.
    commit((p) => ({ ...p, mix: { ...p.mix, musicStartMs: 0, musicStartAuto: true }, musicVol: t.kind !== 'sound' && p.musicVol === 1 && items.some((i) => i.video && soundOn(i) && i.hasAudio !== false) ? 0.7 : p.musicVol }));
    setPickMusic(false);
  };
  const clipSounds: ClipSound[] = items.flatMap((it, i) => (it.video ? [{ key: it.key, label: `Vídeo ${i + 1}`, on: it.sound !== false, volume: it.volume ?? 1, hasAudio: it.hasAudio }] : []));
  const voiceCtl = { nowT, total: playTotal, playForVoice: (at: number) => { setVoiceRec(true); clock.play(at); }, stop: () => { clock.pause(); setVoiceRec(false); } };
  const onVoice = (t: VoiceTake | null) => { setVoiceRec(false); setMix((m) => ({ ...m, voice: t }), `voice:${Date.now()}`); if (t) setTimeout(() => clock.play(Math.max(0, t.at - 0.3)), 300); };

  // ---------------------------------------------------------------- Montagem mágica
  const magicSources: MagicSource[] = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((c) => !seen.has(c.media) && !!seen.add(c.media) && !c.fx?.freeze).map((c) => ({ key: c.key, media: c.media, uri: c.uri, video: c.video, mime: c.mime, durationMs: c.durationMs, speed: c.speed }));
  }, [items]);
  const openMagic = () => { if (locked) return; clock.pause(); setMagic(true); };
  /** «Tem som?» de um vídeo (pela chave `media`): a regra do som obrigatório e o «Som do vídeo» contam com isto (fora do desfazer). */
  const markAudio = (media: string, has: boolean) => fixPresent((p) => (p.clips.some((c) => c.video && c.media === media && c.hasAudio !== has) ? { ...p, clips: p.clips.map((c) => (c.video && c.media === media ? { ...c, hasAudio: has } : c)) } : p));
  // Se os vídeos têm pista de áudio (como o site faz): no Android o leitor diz; no iPhone fica para o servidor (Montagem mágica).
  const probing = useRef(new Set<string>());
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    for (const it of items) {
      if (!it.video || it.hasAudio !== undefined || probing.current.has(it.media)) continue;
      probing.current.add(it.media);
      void probeVideoAudio(it.uri).then((r) => { if (r.hasAudio === false) markAudio(it.media, false); });
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  function applyMagic(r: MagicResult) {
    const before = new Map(items.map((c) => [c.key, c]));
    const list = normalizeClips(r.clips.map((c) => ({ ...before.get(c.key), ...c, fx: sanitizeFx(c.fx) }))).map((c) => withFx(c, sanitizeFx(c.fx)));
    if (!list.length) return;
    const ovs = r.overlays.map(sanitizeOverlay).filter((x): x is Overlay => !!x);
    commit((p) => ({
      ...p, clips: list, overlays: [...p.overlays.filter((x) => !x.id.startsWith('magica-')), ...ovs],
      mix: r.music ? { ...p.mix, musicStartMs: r.music.startMs, musicStartAuto: false, fadeIn: clampFade(r.music.fadeIn), fadeOut: clampFade(r.music.fadeOut), sfx: r.sfx.filter((x) => isSfx(x.id)).map((x, i) => ({ key: `magica-${i}`, id: x.id as SfxId, at: x.at })) } : p.mix,
    }));
    if (r.pano) setPano(sanitizePano(r.pano) ?? pano);
    setRhythm(false);
    setSelKey(list[0]?.key ?? null);
    setTab('clipes');
    setTimeout(() => clock.play(0), 400);
    if (r.left.length) say(`${r.left.length} ${r.left.length === 1 ? 'ficheiro não coube' : 'ficheiros não couberam'} nos 60 s`);
  }

  // ---------------------------------------------------------------- rascunhos (ficheiros no telemóvel)
  const draftKey = useRef(draftId ?? draft?.id ?? newDraftId());
  const saver = useMemo(() => debounce((snap: { clips: Item[]; extra: { key: string; uri: string; mime: string }[]; settings: StudioSettings; seconds: number; context?: Record<string, unknown> }) => {
    void studioStore().save({ id: draftKey.current, ...snap, settings: { ...snap.settings } }).catch(() => undefined);
  }, DRAFT_DEBOUNCE_MS), []);
  const settingsNow: StudioSettings = { music, rhythm, origVol, musicVol, coverAt, overlays: hist.present.overlays, mix: mix.voice ? { ...mix, voice: { ...mix.voice, uri: undefined } } : mix, applied, pano };
  const voiceFile = mix.voice?.uri ? [{ key: mix.voice.id, uri: mix.voice.uri, mime: mix.voice.mime ?? 'audio/mp4' }] : [];
  const settingsSig = JSON.stringify(settingsNow).length + ':' + JSON.stringify(settingsNow).slice(-200);
  useEffect(() => {
    if (run) return;
    if (!items.length) { saver.cancel(); if (hist.past.length) void studioStore().remove(draftKey.current).catch(() => undefined); return; }
    saver({ clips: items, extra: voiceFile, settings: settingsNow, seconds: Math.round(playTotal * 100) / 100, context: draftContext });
  }, [items, settingsSig, !!run]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => saver.flush(), [saver]);
  // Fechar o estúdio pára os envios da Montagem mágica que estejam a meio.
  useEffect(() => () => cancelMagicUploads(draftKey.current), []);

  // ---------------------------------------------------------------- «Seguinte»: enviar, montar no servidor, mostrar
  const useSound = !!soundId && !!music && (!soundTrackId || music.id === soundTrackId);
  function composeBody(ids: Record<string, string>) {
    return buildComposeRequest({
      clips: items, mediaIds: ids, overlays, mix, voiceMediaId: mix.voice ? ids[`voz:${mix.voice.id}`] ?? null : null,
      music: music && !useSound && music.kind !== 'sound' ? (musicPayload(music) as unknown as Record<string, unknown>) : null,
      soundId: useSound ? soundId : null, origVol, musicVol, rhythm: useRhythm, bpm: beatInfo?.bpm ?? null, total: playTotal, coverAt,
      duetPostId: duetPostId ?? null, pano,
    });
  }
  async function follow(jobId: string, rec: JobRecord, sig: string, s: Signal) {
    const started = Date.now();
    setRun(requestingState());
    const end = await pollJob(jobId, { signal: s, onState: setRun, startedAt: started, paused: () => AppState.currentState !== 'active' });
    if (end.kind === 'done') {
      await saveJobRecord(withoutJob(rec));
      setRun(null);
      setResult({ mediaId: end.mediaId, durationMs: end.durationMs });
      return;
    }
    if (end.kind === 'lost') { setRun(null); setProblem({ kind: 'rede', message: 'Perdi a ligação ao servidor. A montagem continua lá: toca em «Tentar outra vez» para a retomar.' }); return; }
    await saveJobRecord(withoutJob(rec));
    setRun(null);
    setProblem(end.kind === 'failed' ? { kind: 'servidor', message: end.message } : { kind: 'servidor', message: 'A montagem já não existe no servidor. Tenta outra vez.' });
    void sig;
  }
  async function build() {
    if (!rules.ok || run || result || voiceRec) return;
    const block = composeBlocker(items);
    if (block) { setProblem({ kind: 'corrigir', message: block }); return; }
    clock.pause();
    Keyboard.dismiss();
    setSheet('baixa');
    setProblem(null);
    setResultNote(null);
    const s: Signal = { cancelled: false };
    signal.current = s;
    // Os vídeos que a Montagem mágica já está a enviar: espera-se por eles (com o progresso à vista) e não vão outra vez.
    await settleMagicUploads(draftKey.current, setRun);
    if (s.cancelled) return;
    let rec: JobRecord = (await loadJobRecord(draftKey.current)) ?? emptyRecord(draftKey.current);
    try {
      saver.flush();
      const files = uploadFiles(items, mix.voice);
      const up = await uploadAll(files, rec, { signal: s, onState: setRun, onRecord: (r) => { rec = r; void saveJobRecord(r); } });
      rec = up.rec;
      let body = composeBody(up.ids);
      const sig = requestSignature(body);
      // Uma montagem deste mesmo projeto já pedida (a app saiu a meio, ou parou-se de esperar): retoma-se.
      const resume = resumeOf(rec, sig, Date.now());
      if (resume.action === 'poll' && resume.same) { await follow(resume.jobId, rec, sig, s); return; }
      setRun(preparingState());
      let jobId: string;
      try {
        jobId = await requestCompose(body);
      } catch (e) {
        const pr = composeProblem((e as ApiError).status ?? 0, (e as Error).message);
        // Um servidor que ainda não conhece os panos ou o som por clipe: vai outra vez sem eles (e diz-se o que ficou de fora).
        if (pr.unknownField) {
          const c = compatRequest(body);
          if (!c.changed.length) throw e;
          body = c.request;
          jobId = await requestCompose(body);
          setResultNote(`O servidor ainda não sabe fazer ${c.changed.join(', ')}: a tcheka saiu sem isso.`);
        } else if (pr.kind === 'ocupado' && resume.action === 'poll') {
          // A montagem que ocupa a vez é uma anterior desta tcheka: espera-se por ela e depois pede-se a nova.
          setRun({ ...preparingState(), title: 'A acabar a montagem anterior…', detail: 'Mudaste a tcheka depois de pedires a montagem: quando a anterior acabar, monto a nova.' });
          await pollJob(resume.jobId, { signal: s, onState: () => undefined, startedAt: Date.now(), paused: () => AppState.currentState !== 'active' });
          jobId = await requestCompose(body);
        } else throw e;
      }
      rec = withJob(rec, jobId, sig, Date.now());
      await saveJobRecord(rec);
      await follow(jobId, rec, sig, s);
    } catch (e) {
      setRun(null);
      if (e instanceof Cancelled || s.cancelled) return;
      setProblem(composeProblem((e as ApiError).status ?? 0, (e as Error).message));
    } finally {
      if (signal.current === s) signal.current = null;
    }
  }
  function cancelBuild() {
    Alert.alert('Parar a montagem?', 'A tcheka fica como está e podes tocar em «Seguinte» outra vez. Uma montagem que já tenha começado acaba no servidor e aproveita-se se não mudares nada.', [
      { text: 'Continuar', style: 'cancel' },
      { text: 'Parar', style: 'destructive', onPress: () => { if (signal.current) signal.current.cancelled = true; setRun(null); } },
    ]);
  }
  function publish() {
    if (!result) return;
    const shot: Shot = { uri: abs(`/api/v1/media/${result.mediaId}`) ?? '', video: true, mime: 'video/mp4', durationMs: result.durationMs ?? Math.round(playTotal * 1000), signed: true, posterMs: Math.round(coverAt * 1000), mediaId: result.mediaId };
    void clearJobRecord(draftKey.current);
    onDone(shot, useSound || music ? music : null);
  }
  // Ao abrir um rascunho com uma montagem a meio (a app fechou enquanto montava): retoma-se sozinha.
  useEffect(() => {
    let off = false;
    void loadJobRecord(draftKey.current).then((rec) => {
      if (off || !rec?.jobId || rec.cancelled) return;
      const r = resumeOf(rec, rec.sig ?? null, Date.now());
      if (r.action !== 'poll') return;
      const s: Signal = { cancelled: false };
      signal.current = s;
      clock.pause();
      void follow(r.jobId, rec, rec.sig ?? '', s).catch((e) => { setRun(null); if (!(e instanceof Cancelled)) setProblem(composeProblem((e as ApiError).status ?? 0, (e as Error).message)); });
    });
    return () => { off = true; if (signal.current) signal.current.cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- sair
  function close() {
    if (run) { cancelBuild(); return; }
    clock.pause();
    saver.flush();
    onClose();
  }
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pickMusic) { setPickMusic(false); return true; }
      if (magic) { setMagic(false); return true; }
      if (result) { setResult(null); return true; }
      if (sheet !== 'baixa') { setSheet('baixa'); return true; }
      close();
      return true;
    });
    return () => sub.remove();
  });

  // ---------------------------------------------------------------- o teclado e a folha
  const [kb, setKb] = useState(0);
  const baseH = useRef(win.height);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      // No Android a janela às vezes encolhe sozinha com o teclado: aí não é preciso guardar o espaço dele.
      const shrunk = Platform.OS === 'android' && baseH.current - win.height > 80;
      setKb(shrunk ? 0 : Math.max(0, e.endCoordinates.height - insets.bottom));
      setSheet('alta');
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, [win.height, insets.bottom]);
  useEffect(() => { if (kb === 0) baseH.current = win.height; }, [win.height, kb]);

  // ---------------------------------------------------------------- medidas (como no site: topo → imagem → linha do tempo → folha)
  const top = Math.max(insets.top, 6);
  const bottom = Math.max(insets.bottom, 4);
  const [tlH, setTlH] = useState(80);
  const lay = studioLayout({ winH: win.height, winW: win.width, top, bottom, kb, timelineH: tlH, sheet });
  const [dragH, setDragH] = useState<number | null>(null);
  const sheetH = dragH ?? lay.sheetH;
  /** Com a folha aberta, a linha do tempo fica densa (com o tocar/pausar e o tempo à esquerda) e a barra do tempo sai. */
  const dense = sheetH > 0;
  const pickTab = (id: Tab) => {
    if (id === tab) setSheet((s) => (s === 'baixa' ? 'media' : 'baixa'));
    else { setTab(id); openSheet('media'); }
  };
  const dragBase = useRef(0);
  const handlePan = usePanGesture({
    runOnJS: true, activeOffsetY: [-8, 8], failOffsetX: [-14, 14],
    onBegin: () => { dragBase.current = sheetH; },
    onUpdate: (e) => setDragH(Math.max(0, Math.min(lay.highH, dragBase.current - e.translationY))),
    onFinalize: () => {
      setDragH((h) => {
        if (h !== null) {
          // Larga na altura mais próxima.
          const next: SheetH = h < lay.midH / 2 ? 'baixa' : h < (lay.midH + lay.highH) / 2 ? 'media' : 'alta';
          if (next !== 'alta') Keyboard.dismiss();
          setSheet(next);
        }
        return null;
      });
    },
  });
  // Um toque na pega passa à altura seguinte (baixa → média → alta → média), como no site.
  const handleTap = useTapGesture({ runOnJS: true, onActivate: () => setSheet((s) => (s === 'baixa' ? 'media' : s === 'media' ? 'alta' : 'media')) });

  const [area, setArea] = useState({ w: 0, h: 0 });
  /** Um toque numa camada não conta também como tocar na imagem (pausa). */
  const ovTouch = useRef(0);
  /** A imagem 9:16 com a maior altura que cabe no espaço que sobra (nunca por trás da folha); sem espaço, recolhe. */
  const fit = fitStage(area.w, area.h);
  const lastFit = useRef(fit);
  if (fit.shown) lastFit.current = fit;
  const stageW = fit.shown ? fit.w : lastFit.current.w || 1;
  const realH = fit.shown ? fit.h : lastFit.current.h || 1;
  const timelineW = win.width;
  const videoFiltered = items.some((it) => it.video && (it.fx?.filter || it.fx?.adjust));
  const thumbOf = (key: string) => { const it = items.find((x) => x.key === key); return !it ? null : it.video ? cachedVideoThumb(it.uri, it.length, it.trim.start) : it.uri; };
  const reverseOf = (): ReverseState => ({ status: 'ready', progress: 1 });
  const selFx = cur?.fx;
  const capTransition = selFx?.transition && isCapulanaTransition(selFx.transition.type) ? (selFx.transition.type as CapulanaTransitionId) : null;
  const busy = !!run;
  /** «Seguinte» com a regra por cumprir: diz o que falta e abre o sítio certo (a música, se é ela que falta). */
  const showHint = () => {
    if (!rules.hint) return;
    say(rules.hint);
    if (rules.problem === 'som') { setTab('som'); openSheet('media'); if (!music && /música/i.test(rules.hint)) { clock.pause(); setPickMusic(true); } }
    else { setTab('clipes'); openSheet('media'); }
  };

  const chip = (on: boolean, label: string, onPress: () => void, key?: string) => (
    <Pressable key={key ?? label} onPress={onPress} disabled={locked} style={[st.chip, on && st.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[st.chipText, on && { color: colors.zinc900 }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[st.root, { paddingTop: top, paddingBottom: bottom + kb }]} accessibilityViewIsModal>
      {/* Em cima: fechar, o que falta (no lugar do nome), desfazer/refazer e «Seguinte». */}
      <View style={st.top}>
        <Pressable onPress={close} style={st.round} accessibilityRole="button" accessibilityLabel="Voltar"><X size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        {rules.hint ? (
          <Pressable onPress={showHint} disabled={locked} style={st.titleBox} accessibilityRole="button" accessibilityLabel={`Para seguir: ${rules.hint}`}>
            <Text style={st.hintText} numberOfLines={2} accessibilityLiveRegion="polite">{rules.hint}</Text>
          </Pressable>
        ) : (
          <View style={st.titleBox}><Text style={st.title} numberOfLines={1}>{win.width < 380 ? '' : 'Nova tcheka'}</Text></View>
        )}
        <View style={st.history}>
          <Pressable onPress={undo} disabled={locked || !canUndo(hist)} style={[st.histBtn, (locked || !canUndo(hist)) && { opacity: 0.32 }]} accessibilityRole="button" accessibilityLabel="Desfazer"><Undo2 size={20} color="#fff" /></Pressable>
          <Pressable onPress={redo} disabled={locked || !canRedo(hist)} style={[st.histBtn, (locked || !canRedo(hist)) && { opacity: 0.32 }]} accessibilityRole="button" accessibilityLabel="Refazer"><Redo2 size={20} color="#fff" /></Pressable>
        </View>
        <Pressable onPress={() => (rules.ok ? void build() : showHint())} disabled={busy} style={[st.cta, (!rules.ok || busy) && { opacity: 0.45 }]} accessibilityRole="button" accessibilityState={{ disabled: !rules.ok || busy }} accessibilityHint={rules.hint ?? undefined} accessibilityLabel="Seguinte">
          <Text style={st.ctaText}>Seguinte</Text>
        </Pressable>
      </View>

      {/* A imagem grande: o palco 9:16 com a altura que sobra. Tocar fora das camadas alterna tocar/pausa. */}
      <View style={st.stageArea} onLayout={(e) => { const l = e.nativeEvent.layout; setArea((a) => (Math.abs(a.w - l.width) < 1 && Math.abs(a.h - l.height) < 1 ? a : { w: l.width, h: l.height })); }}>
        {/* Recolhida (folha alta), a imagem fica montada mas sem altura: os vídeos e o som continuam no sítio. */}
        <View style={fit.shown ? null : { height: 0, overflow: 'hidden', opacity: 0 }}>
          <Pressable onPress={() => { if (busy || Date.now() - ovTouch.current < 400) return; if (selOv) setSelOv(null); else clock.toggle(); }} style={[st.stage, { width: stageW, height: realH }]} accessibilityRole="button" accessibilityLabel={playing ? 'Pausar a pré-visualização' : 'Tocar a pré-visualização'}>
            <NativeStage segs={segs} clock={clock} W={stageW} H={realH} origVol={origVol} pano={pano} reference={reference} refVolume={musicVol} />
            <NativeOverlays overlays={overlays} clock={clock} W={stageW} H={realH} selId={selOv} locked={locked} showSafe={tab === 'texto' || tab === 'stickers'} onSelect={(id) => { ovTouch.current = Date.now(); selectOverlay(id); }} onEdit={(id) => { ovTouch.current = Date.now(); selectOverlay(id); setEditTick((n) => n + 1); setSheet('alta'); }} onChange={(o) => { ovTouch.current = Date.now(); changeOverlay(o); }} />
            {!playing && !busy && !selOv ? <View style={st.center} pointerEvents="none"><View style={[st.playBig, stageW < 170 && { width: 48, height: 48 }]}><Play size={stageW < 170 ? 22 : 32} color="#fff" fill="#fff" /></View></View> : null}
          </Pressable>
        </View>
        {note ? <Text style={st.note} accessibilityLiveRegion="polite">{note}</Text> : null}
        {fit.shown && videoFiltered && tab === 'efeitos' && sheetH > 0 ? <View style={st.lookNote} pointerEvents="none"><LookNote show /></View> : null}
      </View>

      {/* Folha fechada: tocar/pausa e a barra do tempo por baixo da imagem. Aberta, o tocar e o tempo vão para a linha do tempo. */}
      {dense ? null : (
        <View style={st.controls}>
          <Pressable onPress={() => !busy && clock.toggle()} style={st.ctrlBtn} accessibilityRole="button" accessibilityLabel={playing ? 'Pausar' : 'Tocar'}>
            {playing ? <Pause size={20} color="#fff" fill="#fff" /> : <Play size={20} color="#fff" fill="#fff" />}
          </Pressable>
          <Text style={st.clock} numberOfLines={1}>{previewClock(playT, playTotal)}</Text>
          <View style={st.timeBar}>
            <View style={[st.timeFill, { width: `${playTotal ? Math.min(100, (playT / playTotal) * 100) : 0}%` }]} />
            <AudioMarks mix={mix} total={playTotal} />
          </View>
        </View>
      )}

      {/* A linha do tempo: sempre à vista (densa com a folha aberta). */}
      <View style={[st.timelineBox, locked && { opacity: 0.4 }]} pointerEvents={locked ? 'none' : 'auto'}>
        <NativeTimeline
          clips={items} durations={durations} total={playTotal} clock={clock} selected={cur?.key ?? null} locked={locked} beats={useRhythm ? grid : undefined}
          layers={layers} selectedLayer={selOv ?? selSound} width={timelineW} dense={dense} playing={playing} onTogglePlay={() => !busy && clock.toggle()}
          onHeight={(h) => setTlH((o) => (o === h ? o : h))}
          onSelect={onSelectClip} onSeek={onSeek} onTrim={onTrim} onMove={reorderClips} onSelectLayer={selectLayer} onLayer={onLayer} onAdd={() => void addFiles()}
        />
      </View>

      {/* A folha dos separadores (no fim da coluna): a pega, os separadores e o painel com a altura da posição. */}
      <View style={st.sheet}>
        <GestureDetector gesture={handlePan}>
          <View>
            <GestureDetector gesture={handleTap}>
              <View style={st.grabZone} accessibilityRole="adjustable" accessibilityLabel="Altura dos painéis" accessibilityValue={{ text: sheet === 'baixa' ? 'fechada' : sheet === 'media' ? 'média' : 'alta' }}>
                <View style={st.grab} />
              </View>
            </GestureDetector>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabsRow} style={{ height: TABS_H }}>
              {TABS.map((t) => (
                <Pressable key={t.id} onPress={() => pickTab(t.id)} style={st.tabBtn} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id, expanded: sheet !== 'baixa' }} accessibilityLabel={t.label}>
                  <Text style={[st.tabText, tab === t.id && st.tabOn]}>{t.label}</Text>
                  <View style={[st.tabDot, (tab !== t.id || sheetH === 0) && { opacity: 0 }]} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </GestureDetector>
        {sheetH > 0 ? (
          <ScrollView style={[{ height: sheetH }, locked && { opacity: 0.4 }]} pointerEvents={locked ? 'none' : 'auto'} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {selSound ? (
              <View style={st.soundBar}>
                <Text style={[st.chipText, { flex: 1 }]}>{selSound === 'voice' ? 'Voz-off escolhida' : 'Efeito sonoro escolhido'} · arrasta na linha do tempo</Text>
                <Pressable onPress={() => deleteSound(selSound)} style={[st.chip, { backgroundColor: 'rgba(220,38,38,0.25)' }]} accessibilityRole="button"><Text style={st.chipText}>Apagar</Text></Pressable>
              </View>
            ) : null}
            {tab === 'clipes' ? (
              <>
                <NativeClipActions
                  clip={cur ?? null} duration={sel >= 0 ? durations[sel] ?? 0 : 0} rhythm={useRhythm} locked={locked}
                  onSplit={splitHere} onDuplicate={() => { if (cur) duplicate(cur.key); }} onSpeed={(sp) => { if (cur) changeSpeed(cur.key, sp); }}
                  onPhoto={(v) => { if (cur) changePhoto(cur.key, v); }} onSound={(v) => { if (cur) setClipSound(cur.key, v); }}
                  onReplace={() => { if (cur) void replace(cur.key); }} onDelete={() => { if (cur) remove(cur.key); }}
                />
                <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
                  <MagicButton onPress={openMagic} disabled={magicSources.length < 2 || locked} hint={magicSources.length < 2 ? 'Junta pelo menos 2 fotos ou vídeos' : undefined} />
                </View>
                <Text style={st.meta}>{items.length} {items.length === 1 ? 'clipe' : 'clipes'} · {fmtS(total)} s de {TCHEKA_MAX_S} s · arrasta as pegas para cortar, toque longo e arrasta para mudar a ordem</Text>
                {music && items.some((i) => !i.video) ? (
                  <View style={st.rowWrap}>
                    <Text style={st.label}>Fotos</Text>
                    {chip(useRhythm, 'Ao ritmo', () => setRhythm(true))}
                    {chip(!useRhythm, 'Manual', () => setRhythm(false))}
                    <Text style={st.small}>{useRhythm ? `${Math.round(beatInfo?.bpm ?? FALLBACK_BPM)} BPM${beatInfo?.detected ? '' : ' (fixo)'}` : 'a duração está na barra do clipe'}</Text>
                  </View>
                ) : null}
                {cur?.video ? (
                  <View style={st.box}>
                    <Text style={st.label}>Cortar com precisão · clipe {sel + 1}</Text>
                    <Text style={st.small}>Início · {fmtS(cur.trim.start)} s</Text>
                    <RangeSlider label="Início do clipe" value={cur.trim.start} min={0} max={Math.max(0.1, cur.length - 0.5)} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => edit(sel, (it) => ({ ...it, trim: clampTrim({ start: v, end: it.trim.end }, it.length) }))} />
                    <Text style={st.small}>Fim · {fmtS(cur.trim.end)} s</Text>
                    <RangeSlider label="Fim do clipe" value={cur.trim.end} min={Math.min(cur.length, 0.5)} max={Math.max(0.6, cur.length)} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => edit(sel, (it) => ({ ...it, trim: clampTrim({ start: Math.min(it.trim.start, v - 0.5), end: v }, it.length) }))} />
                    <Text style={st.small}>Fica com {fmtS(durations[sel] ?? 0)} s{cur.speed !== 1 ? ` a ${speedLabel(cur.speed)}` : ''}</Text>
                  </View>
                ) : null}
              </>
            ) : null}
            {tab === 'som' ? (
              <NativeSoundPanel
                music={music} duet={!!reference} photosOnly={photosOnly} analysis={analysis} analyzing={analyzing} suggestion={suggestion} mix={mix} setMix={setMix}
                onStartMove={(ms) => fixPresent((p) => ({ ...p, mix: { ...p.mix, musicStartMs: ms, musicStartAuto: false } }))}
                onStartCommit={(ms) => { setMix((m) => ({ ...m, musicStartMs: ms, musicStartAuto: false })); clock.play(0); }}
                total={playTotal} playT={playT} hasVideo={items.some((i) => i.video)} origVol={origVol} setOrigVol={setOrigVol} musicVol={musicVol} setMusicVol={setMusicVol}
                clipSounds={clipSounds} onClipSound={setClipSound} onPickMusic={() => { clock.pause(); setPickMusic(true); }}
                onRemoveMusic={() => { setMusic(null); if (origVol === 0) setOrigVol(1); }}
                canFit={!!music && items.length > 0} fitNote={fitNote} onFit={() => rhythmFit()} onTemplate={(t) => rhythmFit(t)} applied={applied}
                voiceCtl={voiceCtl} onVoice={onVoice} locked={locked}
              />
            ) : null}
            {tab === 'texto' ? <TextPanel texts={texts} selId={selOv} onSelect={selectOverlay} onAdd={addText} onChange={changeOverlay} onDelete={deleteOverlay} total={playTotal} locked={locked} focusKey={editTick} /> : null}
            {tab === 'stickers' ? <StickerTray locked={locked} stickers={stickerOvs} selId={selOv} onSelect={(id) => selectOverlay(id || null)} onAdd={addSticker} onChange={changeOverlay} onDelete={deleteOverlay} total={playTotal} /> : null}
            {tab === 'efeitos' ? (
              <>
                <View style={st.rowWrap} accessibilityRole="tablist">
                  {chip(fxMode === 'efeitos', 'Efeitos do clipe', () => setFxMode('efeitos'), 'fxm-e')}
                  {chip(fxMode === 'capulana', 'Capulana', () => setFxMode('capulana'), 'fxm-c')}
                </View>
                {fxMode === 'capulana' ? (
                  <CapulanaPanel
                    pano={pano} onPano={(v) => { if (!locked) setPano(v); }} transition={capTransition}
                    onTransition={(id) => { if (sel > 0) setFx(sel, (f) => sanitizeFx({ ...f, transition: id ? { type: id, dur: 0.7, pano } : undefined })); if (id && sel > 0) previewJunction(sel); }}
                    frame={!!selFx?.moldura} canFrame={!!cur && !cur.video} onFrame={(on) => { if (sel >= 0) setFx(sel, (f) => sanitizeFx({ ...f, moldura: on ? pano : undefined })); }}
                    onBand={() => addLayer({ ...newText(nowT(), playTotal, 'O teu texto'), bg: 'pano', pano })}
                    onText={() => addLayer({ ...newText(nowT(), playTotal, 'TXILL'), pano, size: 150 })}
                    onSticker={(shape: CapulanaShapeId) => addLayer(newSticker({ type: 'capulana', shape, pano }, nowT(), playTotal))}
                  />
                ) : (
                  <NativeFxPanel
                    clips={segs.map((s) => ({ key: s.key, video: s.video, uri: s.uri, fx: s.fx, dur: s.dur, trimLen: s.len, start: s.start }))}
                    sel={Math.max(0, sel)} onSelect={pickFxClip} setFx={setFx} thumbOf={thumbOf} onPreviewJunction={previewJunction}
                    onFreeze={() => void freezeFrame()} freezing={freezing} reverseOf={reverseOf}
                  />
                )}
              </>
            ) : null}
            {tab === 'capa' ? (
              <View style={st.box}>
                <Text style={st.label}>Capa</Text>
                <RangeSlider label="Momento da capa" value={coverAt} min={0} max={Math.max(0.2, playTotal - 0.1)} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => { setCoverAt(v); clock.pause(); clock.seek(v); }} />
                <Text style={st.small}>A capa é o frame aos {fmtS(coverAt)} s: é o que aparece no feed e no perfil.</Text>
                <Pressable onPress={() => { clock.pause(); clock.seek(coverAt); }} style={[st.chip, { alignSelf: 'flex-start', marginTop: 6 }]} accessibilityRole="button"><Text style={st.chipText}>Ver a capa</Text></Pressable>
              </View>
            ) : null}
          </ScrollView>
        ) : null}
      </View>

      {frameGrab.node}
      <NativeComposeOverlay
        run={run} problem={problem} result={result} note={resultNote}
        onCancel={cancelBuild} onRetry={() => { setProblem(null); void build(); }} onDismiss={() => { const p = problem; setProblem(null); if (p?.kind === 'corrigir') { setTab(/música|som|voz/i.test(p.message) ? 'som' : 'clipes'); openSheet('media'); } }}
        onPublish={publish} onEdit={() => setResult(null)} topInset={top} bottomInset={bottom}
      />
      {pickMusic ? <MusicPicker allowLocal onClose={() => setPickMusic(false)} onPick={pickedMusic} /> : null}
      {magic ? (
        <View style={[StyleSheet.absoluteFill, { zIndex: 90, backgroundColor: '#000' }]}>
          <NativeMagic
            sources={magicSources}
            draftId={draftKey.current}
            music={musicUrl && music ? { url: musicUrl, title: music.title } : null}
            onHasAudio={markAudio}
            onApply={(r) => { applyMagic(r); setMagic(false); }}
            onClose={() => setMagic(false)}
            topInset={insets.top}
            bottomInset={insets.bottom}
          />
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, height: TOP_H },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  titleBox: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 16, fontWeight: '800' },
  history: { flexDirection: 'row', alignItems: 'center', borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)' },
  histBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  cta: { height: 44, minWidth: 92, paddingHorizontal: 14, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  hintText: { color: '#ff8fa0', fontWeight: '800', fontSize: 14, lineHeight: 17 },
  stageArea: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  lookNote: { position: 'absolute', left: 0, right: 0, bottom: 2 },
  timelineBox: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  stage: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  playBig: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 48 },
  ctrlBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  clock: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 84 },
  timeBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  timeFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: '#fff' },
  note: { position: 'absolute', bottom: 6, alignSelf: 'center', zIndex: 5, color: '#fff', fontSize: 14, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, overflow: 'hidden' },
  soundBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingTop: 6 },
  sheet: { backgroundColor: '#0b0b11', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  grabZone: { height: GRAB_H, alignItems: 'center', justifyContent: 'center' },
  grab: { width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.32)' },
  tabsRow: { flexGrow: 1, justifyContent: 'space-around', paddingHorizontal: 6 },
  tabBtn: { paddingHorizontal: 9, minHeight: 44, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  tabText: { color: 'rgba(255,255,255,0.62)', fontSize: 14, fontWeight: '800' },
  tabOn: { color: '#fff' },
  tabDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff', marginTop: 3 },
  meta: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', marginTop: 8, paddingHorizontal: 16 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginTop: 8 },
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '800', paddingRight: 4 },
  small: { color: 'rgba(255,255,255,0.68)', fontSize: 14, flexShrink: 1 },
  chip: { minHeight: 44, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  box: { paddingHorizontal: 16, marginTop: 8, gap: 2 },
});
