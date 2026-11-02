import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { acquireCamera, releaseCamera } from '../lib/cameraSession';
import { useDesktop } from '../lib/useDesktop';
import { setHandoff } from '../lib/handoff';
import { FILTERS, bakeFilter, cssFilter, type Filter } from '../lib/filters';
import Icon from './Icon';
import { StoryCreator } from './Stories';

type Mode = 'post' | 'story' | 'reel';
const MODES: { id: Mode; label: string }[] = [
  { id: 'post', label: 'Publicação' },
  { id: 'story', label: 'Story' },
  { id: 'reel', label: 'Reel' },
];
const MAX_REEL_S = 60;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type Problem = null | 'denied' | 'unsupported' | 'failed';
type Captured = { photos: File[] } | { video: File };

/** Formato que este browser sabe gravar (Safari: mp4; Chrome/Android: webm). */
const recorderType = () => ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';

/**
 * O "+" abre a câmara: escolhe-se o que publicar (publicação, story ou reel), tira-se a foto ou grava-se (ou vem da galeria),
 * passa-se pelos filtros e só depois segue para a legenda e a publicação.
 */
export default function CameraStudio() {
  const navigate = useNavigate();
  // No computador não há câmara à frente: "Publicar" vai direto ao ecrã de escrever.
  const desktop = useDesktop();
  useEffect(() => {
    if (desktop) navigate('/new/post', { replace: true });
  }, [desktop, navigate]);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [mode, setMode] = useState<Mode>('post');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [canFlip, setCanFlip] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [torch, setTorch] = useState(false);
  const [flash, setFlash] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [story, setStory] = useState<File | null>(null);
  const [err, setErr] = useState('');
  const wantsAudio = mode === 'reel';

  const start = useCallback(async () => {
    setReady(false);
    setProblem(null);
    setTorch(false);
    if (!navigator.mediaDevices?.getUserMedia) return setProblem('unsupported');
    try {
      // Reaproveita a câmara já ligada: não volta a pedir permissão ao mudar de modo ou voltar dos filtros.
      const s = await acquireCamera(facing, wantsAudio);
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setCanTorch(!!caps.torch);
      setReady(true);
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1);
    } catch (e) {
      setProblem((e as DOMException).name === 'NotAllowedError' ? 'denied' : 'failed');
    }
  }, [facing, wantsAudio]);

  // A câmara só fica à vista enquanto estás a captar; ao sair continua ligada uns instantes (ver cameraSession).
  const live = !captured && !story && !desktop;
  useEffect(() => {
    if (live) void start();
    else releaseCamera();
    return () => releaseCamera(20_000);
  }, [live, start]);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state === 'recording') recorder.current.stop();
    },
    [],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !captured && !story && navigate(-1);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [captured, story, navigate]);

  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setCanTorch(false);
    }
  }

  function shoot() {
    const v = video.current;
    if (!v || !ready || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
    navigator.vibrate?.(15);
    c.toBlob((blob) => blob && setCaptured({ photos: [new File([blob], `txill-${Date.now()}.jpg`, { type: 'image/jpeg' })] }), 'image/jpeg', 0.92);
  }

  function startRecording() {
    const s = stream.current;
    if (!s || !ready) return;
    const type = recorderType();
    if (!type) return setErr('Este browser não grava vídeo. Escolhe um da galeria.');
    chunks.current = [];
    const rec = new MediaRecorder(s, { mimeType: type, videoBitsPerSecond: 4_000_000 });
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    rec.onstop = () => {
      const base = type.split(';')[0];
      const blob = new Blob(chunks.current, { type: base });
      if (blob.size > 0) setCaptured({ video: new File([blob], `txill-${Date.now()}.${base === 'video/mp4' ? 'mp4' : 'webm'}`, { type: base }) });
    };
    rec.start(500);
    recorder.current = rec;
    setSeconds(0);
    setRecording(true);
    navigator.vibrate?.(20);
    const t0 = Date.now();
    timer.current = setInterval(() => {
      const sec = (Date.now() - t0) / 1000;
      setSeconds(sec);
      if (sec >= MAX_REEL_S) stopRecording();
    }, 100);
  }
  function stopRecording() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  function shutter() {
    setErr('');
    if (mode === 'reel') return recording ? stopRecording() : startRecording();
    shoot();
  }

  function gallery(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    setErr('');
    if (!files.length) return;
    const vid = files.find((f) => f.type.startsWith('video/'));
    if (mode === 'reel' && !vid) return setErr('No Reel só entram vídeos');
    if (vid) {
      if (mode === 'story') return setErr('Os stories são só de fotos por agora');
      if (vid.size > 100 * 1024 * 1024) return setErr('Vídeo pesado demais! Máximo 100 MB');
      return setCaptured({ video: vid });
    }
    const imgs = files.filter((f) => IMAGE_TYPES.includes(f.type));
    if (!imgs.length) return setErr('Usa fotos JPEG, PNG ou WebP');
    if (imgs.some((f) => f.size > MAX_IMAGE_BYTES)) return setErr('Uma das fotos é pesada demais! Máximo 8 MB');
    setCaptured({ photos: mode === 'story' ? imgs.slice(0, 1) : imgs.slice(0, 10) });
  }

  // Deslizar para os lados na câmara muda de modo (publicação, story, reel).
  const touch = useRef<number | null>(null);
  const shift = (d: 1 | -1) => {
    if (recording) return;
    const i = MODES.findIndex((m) => m.id === mode) + d;
    if (i >= 0 && i < MODES.length) setMode(MODES[i].id);
  };

  function proceed(files: File[] | File) {
    if (mode === 'story' && !(files instanceof File)) return setStory(files[0]);
    if (files instanceof File) setHandoff({ video: files });
    else setHandoff({ photos: files });
    navigate('/new/post', { replace: true });
  }

  const round = 'flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md transition active:scale-90';
  const accept = mode === 'reel' ? 'video/*' : mode === 'story' ? IMAGE_TYPES.join(',') : `${IMAGE_TYPES.join(',')},video/*`;
  const galleryInput = <input type="file" multiple={mode === 'post'} accept={accept} onChange={gallery} className="sr-only" aria-label="Escolher da galeria" />;
  const R = 41;
  const C = 2 * Math.PI * R;

  if (desktop) return null;
  if (story) return <StoryCreator file={story} onClose={() => navigate('/', { replace: true })} onBack={() => { setStory(null); setCaptured(null); }} />;
  if (captured) return <Review mode={mode} captured={captured} onBack={() => setCaptured(null)} onDone={proceed} />;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Câmara"
      className="fixed inset-0 z-[80] flex flex-col bg-black text-white"
      onTouchStart={(e) => (touch.current = e.touches.length === 1 ? e.touches[0].clientX : null)}
      onTouchEnd={(e) => {
        const x = touch.current;
        touch.current = null;
        if (x === null) return;
        const dx = e.changedTouches[0].clientX - x;
        if (Math.abs(dx) > 60) shift(dx < 0 ? 1 : -1);
      }}
    >
      <video ref={video} playsInline muted className={`absolute inset-0 h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''} ${ready ? '' : 'invisible'}`} />
      {flash && <div className="pointer-events-none absolute inset-0 bg-white" />}

      <div className="relative z-10 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={() => navigate(-1)} aria-label="Fechar câmara" className={round}><Icon name="x" size={24} /></button>
        {recording ? (
          <span role="timer" className="flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-sm font-bold tabular-nums">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> {Math.floor(seconds / 60)}:{String(Math.floor(seconds % 60)).padStart(2, '0')}
          </span>
        ) : (
          <div className="flex gap-2">
            {canTorch && ready && <button type="button" onClick={toggleTorch} aria-pressed={torch} aria-label="Lanterna" className={`${round} ${torch ? '!bg-white !text-zinc-900' : ''}`}><Icon name="sun" size={22} /></button>}
            {mode === 'post' && <button type="button" onClick={() => navigate('/new/post', { replace: true })} aria-label="Só texto" className={`${round} text-base font-bold`}>Aa</button>}
            {canFlip && ready && <button type="button" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label="Virar câmara" className={round}><Icon name="flip-camera" size={24} /></button>}
          </div>
        )}
      </div>

      {!ready && (
        <div className="relative z-10 m-auto max-w-xs px-6 text-center">
          {problem === null ? (
            <p className="text-white/80">A acordar a câmara…</p>
          ) : (
            <>
              <Icon name="alert" size={48} className="mx-auto text-white/70" />
              <p className="mt-3 text-lg font-bold">{problem === 'denied' ? 'Sem permissão para a câmara' : problem === 'unsupported' ? 'A câmara precisa de ligação segura' : 'Não consegui abrir a câmara'}</p>
              <p className="mt-1 text-sm text-white/70">{problem === 'denied' ? 'Ativa a câmara nas definições do browser, ou escolhe da galeria.' : 'Podes sempre escolher da galeria.'}</p>
              <label className="mt-5 inline-flex h-12 cursor-pointer items-center rounded-full bg-brand px-6 font-bold">Abrir galeria{galleryInput}</label>
            </>
          )}
        </div>
      )}
      {ready && <div className="flex-1" />}
      {err && <p role="alert" className="relative z-10 mx-auto mb-2 rounded-full bg-black/60 px-4 py-1.5 text-center text-sm font-semibold">{err}</p>}

      {/* Modos: o ativo fica a branco; deslizar ou tocar muda. */}
      {!recording && (
        <div className="relative z-10 flex justify-center gap-6 pb-3" role="tablist" aria-label="O que queres publicar">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)} className={`h-11 px-1 text-[15px] font-bold uppercase tracking-wide transition ${mode === m.id ? 'text-white' : 'text-white/55'}`}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="relative z-10 flex items-center justify-between px-8 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
        {recording ? (
          <span className="w-14" aria-hidden />
        ) : (
          <label className={`${round} h-14 w-14 cursor-pointer rounded-2xl`} title="Galeria" aria-label="Galeria">
            <Icon name="image" size={26} />
            {galleryInput}
          </label>
        )}
        <button
          type="button"
          onClick={shutter}
          disabled={!ready}
          aria-label={mode === 'reel' ? (recording ? 'Parar a gravação' : 'Gravar') : 'Tirar foto'}
          className="relative flex h-[84px] w-[84px] items-center justify-center transition active:scale-90 disabled:opacity-40"
        >
          <svg viewBox="0 0 90 90" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="45" cy="45" r={R} fill="none" stroke="white" strokeWidth="5" opacity={recording ? 0.35 : 1} />
            {recording && <circle cx="45" cy="45" r={R} fill="none" stroke="#ef4444" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, seconds / MAX_REEL_S))} />}
          </svg>
          {mode === 'reel' ? (
            <span className={`bg-red-500 transition-all ${recording ? 'h-7 w-7 rounded-md' : 'h-[62px] w-[62px] rounded-full'}`} />
          ) : (
            <span className="h-[62px] w-[62px] rounded-full bg-white" />
          )}
        </button>
        <span className="w-14" aria-hidden />
      </div>
    </div>
  );
}

/** Passo dos filtros: a foto (ou o vídeo) tal como vai sair, com os filtros por baixo. */
function Review({ mode, captured, onBack, onDone }: { mode: Mode; captured: Captured; onBack: () => void; onDone: (files: File[] | File) => void }) {
  const photos = 'photos' in captured ? captured.photos : null;
  const previews = useMemo(() => (photos ? photos.map((f) => URL.createObjectURL(f)) : []), [photos]);
  const videoUrl = useMemo(() => ('video' in captured ? URL.createObjectURL(captured.video) : null), [captured]);
  useEffect(() => () => { previews.forEach(URL.revokeObjectURL); if (videoUrl) URL.revokeObjectURL(videoUrl); }, [previews, videoUrl]);
  const [filter, setFilter] = useState<Filter>(FILTERS[0]);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function next() {
    setBusy(true);
    setErr('');
    try {
      if (photos) onDone(await Promise.all(photos.map((f) => bakeFilter(f, filter))));
      else onDone((captured as { video: File }).video);
    } catch {
      setErr('Não consegui aplicar o filtro. Tenta outro.');
      setBusy(false);
    }
  }

  const tint = filter.tint;
  return (
    <div role="dialog" aria-modal="true" aria-label="Filtros" className="fixed inset-0 z-[80] flex flex-col bg-black text-white">
      <div className="relative min-h-0 flex-1">
        {videoUrl ? (
          <video src={videoUrl} autoPlay loop muted playsInline controls={false} className="h-full w-full object-contain" />
        ) : (
          <>
            <img src={previews[i]} alt="Pré-visualização" className="h-full w-full object-contain" style={{ filter: cssFilter(filter) }} />
            {tint && <div aria-hidden className="pointer-events-none absolute inset-0 mix-blend-soft-light" style={{ background: `rgba(${tint[0]},${tint[1]},${tint[2]},${Math.min(1, tint[3] * 3)})` }} />}
          </>
        )}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <button type="button" onClick={onBack} aria-label="Voltar à câmara" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur-md"><Icon name="back" size={24} /></button>
          {photos && photos.length > 1 && <span className="rounded-full bg-black/50 px-3 py-1 text-sm font-semibold">{i + 1}/{photos.length}</span>}
        </div>
        {photos && photos.length > 1 && (
          <>
            {i > 0 && <button type="button" onClick={() => setI(i - 1)} aria-label="Foto anterior" className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40"><Icon name="chevron-left" size={24} /></button>}
            {i < photos.length - 1 && <button type="button" onClick={() => setI(i + 1)} aria-label="Foto seguinte" className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40"><Icon name="chevron-right" size={24} /></button>}
          </>
        )}
      </div>

      <div className="bg-black px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {photos ? (
          <div role="radiogroup" aria-label="Filtros" className="flex gap-2.5 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={filter.id === f.id} onClick={() => setFilter(f)} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 active:scale-95">
                <span className={`relative block h-[68px] w-[68px] overflow-hidden rounded-xl ${filter.id === f.id ? 'ring-2 ring-white' : 'opacity-80'}`}>
                  <img src={previews[i]} alt="" className="h-full w-full object-cover" style={{ filter: cssFilter(f) }} />
                  {f.tint && <span aria-hidden className="absolute inset-0 mix-blend-soft-light" style={{ background: `rgba(${f.tint[0]},${f.tint[1]},${f.tint[2]},${Math.min(1, f.tint[3] * 3)})` }} />}
                </span>
                <span className={`w-full truncate text-center text-xs ${filter.id === f.id ? 'font-bold' : 'text-white/70'}`}>{f.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="pb-3 text-center text-sm text-white/70">Os filtros são para fotos. O vídeo segue como foi gravado.</p>
        )}
        {err && <p role="alert" className="pb-2 text-center text-sm text-red-400">{err}</p>}
        <button type="button" onClick={next} disabled={busy} className="h-12 w-full rounded-full bg-brand text-lg font-bold text-white transition active:scale-[0.98] disabled:opacity-50">
          {busy ? 'A aplicar…' : 'Seguinte'}
        </button>
      </div>
    </div>
  );
}
