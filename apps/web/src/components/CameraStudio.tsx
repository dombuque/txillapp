import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { tr } from '../lib/i18n';
import { markSeen } from '../lib/whatsNew';
import { useNavigate } from 'react-router-dom';
import { acquireCamera, releaseCamera } from '../lib/cameraSession';
import { useDesktop } from '../lib/useDesktop';
import { setHandoff } from '../lib/handoff';
import { FILTERS, bakeFilter, cssFilter, type Filter } from '../lib/filters';
import FlashIcon from './FlashIcon';
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
  // Enquadramento 3:4 inteiro na publicação (sem cortar o campo de visão: a imagem deixa de parecer ampliada).
  const framed = mode === 'post';
  // Filtro escolhido antes de tirar a foto (vê-se já no ecrã e segue para a revisão).
  const [liveFilter, setLiveFilter] = useState<Filter>(FILTERS[0]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Texto por cima da foto que vais tirar.
  const [textOn, setTextOn] = useState(false);
  const [overlay, setOverlay] = useState('');
  const [overlayY, setOverlayY] = useState(0.42);
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
  // Câmara "pro": zoom (do aparelho, ou digital se não tiver), foco por toque, exposição, grelha, temporizador e flash.
  const [zoom, setZoom] = useState(1);
  const [zoomCaps, setZoomCaps] = useState<{ min: number; max: number } | null>(null); // null = só zoom digital
  const [expoCaps, setExpoCaps] = useState<{ min: number; max: number; step: number } | null>(null);
  const [expo, setExpo] = useState(0);
  const [grid, setGrid] = useState(false);
  const [delay, setDelay] = useState<0 | 3 | 10>(0);
  const [count, setCount] = useState(0);
  const [screenFlash, setScreenFlash] = useState(false); // flash de ecrã (câmara da frente)
  const [whiteOut, setWhiteOut] = useState(false);
  const [focus, setFocus] = useState<{ x: number; y: number; id: number } | null>(null);
  const [zoomHud, setZoomHud] = useState(false);
  const zoomRef = useRef(1);
  const hudTimer = useRef<ReturnType<typeof setTimeout>>();
  // O microfone só se liga no Reel; na publicação pede-se apenas se segurares o botão para gravar vídeo.
  const wantsAudio = mode === 'reel';

  const start = useCallback(async () => {
    setReady(false);
    setProblem(null);
    setTorch(false);
    if (!navigator.mediaDevices?.getUserMedia) return setProblem('unsupported');
    try {
      // Reaproveita a câmara já ligada: não volta a pedir permissão ao mudar de modo ou voltar dos filtros.
      const s = await acquireCamera(facing, wantsAudio, framed);
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number }; exposureCompensation?: { min: number; max: number; step: number } };
      setCanTorch(!!caps.torch);
      setZoomCaps(caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max } : null);
      setExpoCaps(caps.exposureCompensation && caps.exposureCompensation.max > caps.exposureCompensation.min ? caps.exposureCompensation : null);
      zoomRef.current = caps.zoom?.min && caps.zoom.min > 1 ? caps.zoom.min : 1;
      setZoom(zoomRef.current);
      setExpo(0);
      setReady(true);
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1);
    } catch (e) {
      setProblem((e as DOMException).name === 'NotAllowedError' ? 'denied' : 'failed');
    }
  }, [facing, wantsAudio, framed]);

  // A câmara só fica à vista enquanto estás a captar; ao sair continua ligada uns instantes (ver cameraSession).
  const live = !captured && !story && !desktop;
  useEffect(() => {
    if (live) void start();
    else releaseCamera(3_000); // tirou a foto (ou entrou nos filtros): a câmara desliga-se logo, para sair o aviso de gravação
    return () => releaseCamera(4_000);
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

  // Zoom do aparelho quando existe; senão digital (vale para fotos; num vídeo só o zoom do aparelho entra na gravação).
  const hwZoom = !!zoomCaps;
  const zMin = zoomCaps?.min ?? 1;
  const zMax = zoomCaps ? Math.min(zoomCaps.max, 10) : 5;
  const canZoom = hwZoom || mode !== 'reel';
  function applyZoom(z: number) {
    const v = Math.min(zMax, Math.max(zMin, z));
    zoomRef.current = v;
    setZoom(v);
    setZoomHud(true);
    clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => setZoomHud(false), 1200);
    if (hwZoom) void stream.current?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ zoom: v } as MediaTrackConstraintSet] }).catch(() => undefined);
  }
  async function applyExpo(v: number) {
    setExpo(v);
    await stream.current?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ exposureCompensation: v } as MediaTrackConstraintSet] }).catch(() => undefined);
  }
  // Toque no ecrã: foco (e exposição, se o aparelho deixa). Toque duplo: vira a câmara.
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  function tapScreen(e: ReactPointerEvent<HTMLDivElement>) {
    if (!ready || recording) return;
    const now = Date.now();
    const lt = lastTap.current;
    const r = e.currentTarget.getBoundingClientRect();
    if (now - lt.t < 320 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 40) {
      lastTap.current = { t: 0, x: 0, y: 0 };
      if (canFlip) setFacing((f) => (f === 'user' ? 'environment' : 'user'));
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    setFocus({ x: e.clientX - r.left, y: e.clientY - r.top, id: now });
    setTimeout(() => setFocus((f) => (f && f.id === now ? null : f)), 2500);
    void stream.current?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ focusMode: 'single-shot', pointsOfInterest: [{ x, y }] } as MediaTrackConstraintSet] }).catch(() => undefined);
  }
  // Pinça com dois dedos.
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  async function shoot() {
    const v = video.current;
    if (!v || !ready || !v.videoWidth) return;
    // Câmara da frente sem lanterna: o ecrã faz de flash.
    if (screenFlash && facing === 'user' && !canTorch) {
      setWhiteOut(true);
      await new Promise((r) => setTimeout(r, 280));
    }
    const c = document.createElement('canvas');
    // Zoom digital: recorta o centro.
    const k = hwZoom ? 1 : zoomRef.current;
    const sw = v.videoWidth / k;
    const sh = v.videoHeight / k;
    c.width = Math.round(sw);
    c.height = Math.round(sh);
    const g = c.getContext('2d')!;
    // Selfie: a foto sai como a viste no ecrã (espelhada), e não ao contrário.
    if (facing === 'user') {
      g.translate(c.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    // Texto escrito por cima: entra na foto (posição relativa ao que se vê no ecrã).
    const txt = overlay.trim();
    if (txt) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      const frameH = framed ? Math.min(window.innerHeight, (window.innerWidth * 4) / 3) : window.innerHeight;
      const frameTop = (window.innerHeight - frameH) / 2;
      const yFrac = Math.min(0.92, Math.max(0.08, (overlayY * window.innerHeight - frameTop) / frameH));
      const fs = Math.round(c.width * 0.068);
      g.font = `800 ${fs}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const words = txt.split(/\s+/);
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        const t = cur ? `${cur} ${w}` : w;
        if (g.measureText(t).width > c.width * 0.8 && cur) {
          lines.push(cur);
          cur = w;
        } else cur = t;
      }
      if (cur) lines.push(cur);
      const lh = fs * 1.3;
      const bw = Math.min(c.width * 0.9, Math.max(...lines.map((l) => g.measureText(l).width)) + fs * 1.2);
      const bh = lines.length * lh + fs * 0.6;
      const cy = yFrac * c.height;
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.beginPath();
      g.roundRect(c.width / 2 - bw / 2, cy - bh / 2, bw, bh, fs * 0.5);
      g.fill();
      g.fillStyle = '#fff';
      lines.forEach((l, i) => g.fillText(l, c.width / 2, cy - bh / 2 + fs * 0.3 + lh * (i + 0.5)));
    }
    setWhiteOut(false);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
    navigator.vibrate?.(15);
    c.toBlob((blob) => {
      if (!blob) return;
      setCaptured({ photos: [new File([blob], `txill-${Date.now()}.jpg`, { type: 'image/jpeg' })] });
      setOverlay('');
      setTextOn(false);
    }, 'image/jpeg', 0.92);
  }

  const wantRec = useRef(false); // largaste o botão antes de o microfone ligar? então não chega a gravar
  async function startRecording() {
    let s = stream.current;
    if (!s || !ready) return;
    wantRec.current = true;
    // Sem som (publicação): liga o microfone só agora e desliga quando a gravação acabar.
    let extraAudio: MediaStreamTrack | null = null;
    if (!s.getAudioTracks().length) {
      try {
        const a = await navigator.mediaDevices.getUserMedia({ audio: true });
        extraAudio = a.getAudioTracks()[0] ?? null;
        if (extraAudio) s = new MediaStream([...s.getVideoTracks(), extraAudio]);
      } catch {
        /* sem microfone: grava só imagem */
      }
      if (!wantRec.current) {
        extraAudio?.stop();
        return;
      }
    }
    const type = recorderType();
    if (!type) return setErr(tr('Este browser não grava vídeo. Escolhe um da galeria.'));
    chunks.current = [];
    const rec = new MediaRecorder(s, { mimeType: type, videoBitsPerSecond: 4_000_000 });
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    rec.onstop = () => {
      extraAudio?.stop();
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
    wantRec.current = false;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  const countdown = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => () => clearInterval(countdown.current), []);
  function act() {
    if (mode === 'reel') return recording ? stopRecording() : void startRecording();
    void shoot();
  }
  function shutter() {
    setErr('');
    // Temporizador: conta para trás e depois tira (ou começa a gravar). Tocar outra vez cancela.
    if (count > 0) {
      clearInterval(countdown.current);
      return setCount(0);
    }
    if (delay > 0 && !recording) {
      let n: number = delay;
      setCount(n);
      countdown.current = setInterval(() => {
        n -= 1;
        if (n <= 0) {
          clearInterval(countdown.current);
          setCount(0);
          act();
        } else setCount(n);
      }, 1000);
      return;
    }
    act();
  }

  // Toque curto: foto (ou liga/desliga no Reel). Segurar: grava vídeo enquanto o dedo estiver no botão.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const dragFrom = useRef<{ y: number; z: number } | null>(null);
  function pressMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = dragFrom.current;
    if (!d || !held.current || !canZoom || (!hwZoom && mode === 'reel')) return;
    // Para cima aproxima, para baixo afasta (cada ~180 px dobra ou reduz a metade).
    applyZoom(d.z * Math.pow(2, (d.y - e.clientY) / 180));
  }
  function pressDown(e: ReactPointerEvent<HTMLButtonElement>) {
    held.current = false;
    dragFrom.current = { y: e.clientY, z: zoomRef.current };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (mode === 'story' || recording) return;
    holdTimer.current = setTimeout(() => {
      held.current = true;
      markSeen('video-longo');
      setErr('');
      startRecording();
    }, 350);
  }
  function pressUp() {
    dragFrom.current = null;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (held.current) {
      held.current = false;
      stopRecording();
      return;
    }
    shutter();
  }
  function pressCancel() {
    dragFrom.current = null;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (held.current) {
      held.current = false;
      stopRecording();
    }
  }

  function gallery(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    setErr('');
    if (!files.length) return;
    const vid = files.find((f) => f.type.startsWith('video/'));
    if (mode === 'reel' && !vid) return setErr(tr('No Reel só entram vídeos'));
    if (vid) {
      if (mode === 'story') return setErr(tr('Os stories são só de fotos por agora'));
      if (vid.size > 100 * 1024 * 1024) return setErr(tr('Vídeo pesado demais! Máximo 100 MB'));
      return setCaptured({ video: vid });
    }
    const imgs = files.filter((f) => IMAGE_TYPES.includes(f.type));
    if (!imgs.length) return setErr(tr('Usa fotos JPEG, PNG ou WebP'));
    if (imgs.some((f) => f.size > MAX_IMAGE_BYTES)) return setErr(tr('Uma das fotos é pesada demais! Máximo 8 MB'));
    setCaptured({ photos: mode === 'story' ? imgs.slice(0, 1) : imgs.slice(0, 10) });
  }

  // Deslizar para os lados na câmara muda de modo (publicação, story, reel).
  const touch = useRef<number | null>(null);
  const shift = (d: 1 | -1) => {
    if (recording) return;
    const i = MODES.findIndex((m) => m.id === mode) + d;
    if (i >= 0 && i < MODES.length) setMode(MODES[i].id);
    else if (i === -1) navigate('/new/post', { replace: true });
  };

  function proceed(files: File[] | File) {
    if (mode === 'story' && !(files instanceof File)) return setStory(files[0]);
    if (files instanceof File) setHandoff({ video: files });
    else setHandoff({ photos: files });
    navigate('/new/post', { replace: true });
  }

  const round = 'flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md transition active:scale-90';
  const accept = mode === 'reel' ? 'video/*' : mode === 'story' ? IMAGE_TYPES.join(',') : `${IMAGE_TYPES.join(',')},video/*`;
  const galleryInput = <input type="file" multiple={mode === 'post'} accept={accept} onChange={gallery} className="sr-only" aria-label={tr('Escolher da galeria')} />;
  const R = 41;
  const C = 2 * Math.PI * R;

  if (desktop) return null;
  if (story) return <StoryCreator file={story} onClose={() => navigate('/', { replace: true })} onBack={() => { setStory(null); setCaptured(null); }} />;
  if (captured) return <Review mode={mode} captured={captured} initialFilter={liveFilter} onBack={() => setCaptured(null)} onDone={proceed} />;

  return (
    <div
      role="dialog"
      aria-modal="true" data-swipe="off"
      aria-label={tr('Câmara')}
      className="fixed inset-0 z-[80] flex flex-col bg-black text-white"
      onTouchStart={(e) => {
        touch.current = e.touches.length === 1 ? e.touches[0].clientX : null;
        pinch.current = e.touches.length === 2 && canZoom ? { d: dist(e.touches), z: zoomRef.current } : null;
      }}
      onTouchMove={(e) => {
        if (e.touches.length === 2 && pinch.current) applyZoom(pinch.current.z * (dist(e.touches) / pinch.current.d));
      }}
      onTouchEnd={(e) => {
        if (pinch.current) {
          if (e.touches.length < 2) pinch.current = null;
          touch.current = null;
          return;
        }
        const x = touch.current;
        touch.current = null;
        if (x === null) return;
        const dx = e.changedTouches[0].clientX - x;
        if (Math.abs(dx) > 60) shift(dx < 0 ? 1 : -1);
      }}
    >
      <video ref={video} playsInline muted style={{ transform: `scaleX(${facing === 'user' ? -1 : 1}) scale(${hwZoom ? 1 : zoom})`, filter: cssFilter(liveFilter) }} className={`absolute object-cover ${framed ? 'inset-x-0 top-1/2 w-full -translate-y-1/2 aspect-[3/4]' : 'inset-0 h-full w-full'} ${ready ? '' : 'invisible'}`} />
      {liveFilter.tint && <div aria-hidden className="pointer-events-none absolute inset-0 mix-blend-soft-light" style={{ background: `rgba(${liveFilter.tint[0]},${liveFilter.tint[1]},${liveFilter.tint[2]},${Math.min(1, liveFilter.tint[3] * 3)})` }} />}
      {/* Toque: foco; toque duplo: vira a câmara. */}
      <div className="absolute inset-0" onPointerUp={tapScreen} aria-hidden />
      {grid && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <span className="absolute inset-y-0 left-1/3 w-px bg-white/35" /><span className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
          <span className="absolute inset-x-0 top-1/3 h-px bg-white/35" /><span className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
        </div>
      )}
      {focus && (
        <div className="pointer-events-none absolute z-10" style={{ left: focus.x - 36, top: focus.y - 36 }}>
          <span className="block h-[72px] w-[72px] animate-[rise_.25s_ease-out] rounded-[22px] border-2 border-amber-300" />
        </div>
      )}
      {focus && expoCaps && (
        <div className="absolute z-20 flex h-36 w-8 flex-col items-center" style={{ left: Math.min(focus.x + 48, window.innerWidth - 44), top: focus.y - 72 }}>
          <Icon name="sun" size={18} className="text-amber-300" />
          <input type="range" aria-label={tr('Exposição')} min={expoCaps.min} max={expoCaps.max} step={expoCaps.step || 0.1} value={expo} onChange={(e) => void applyExpo(Number(e.target.value))} className="mt-12 w-24 -rotate-90 accent-amber-300" />
        </div>
      )}
      {(textOn || overlay) && (
        <div className="absolute inset-x-5 z-20 flex items-center gap-2" style={{ top: `${overlayY * 100}%`, transform: 'translateY(-50%)' }}>
          <span
            role="slider"
            aria-label={tr('Mover o texto')}
            aria-valuenow={Math.round(overlayY * 100)}
            tabIndex={0}
            className="flex h-10 w-7 shrink-0 items-center justify-center rounded-full bg-black/50 text-white/80"
            style={{ touchAction: 'none' }}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => { e.stopPropagation(); setOverlayY(Math.min(0.85, Math.max(0.12, e.touches[0].clientY / window.innerHeight))); }}
          >
            <Icon name="chevron-right" size={18} className="rotate-90" />
          </span>
          <input
            value={overlay}
            onChange={(e) => setOverlay(e.target.value.slice(0, 80))}
            onFocus={() => setTextOn(true)}
            onBlur={() => setTextOn(false)}
            autoFocus={textOn}
            placeholder={tr('Escreve aqui…')}
            aria-label={tr('Texto por cima da foto')}
            className="min-w-0 flex-1 rounded-2xl bg-black/50 px-4 py-2.5 text-center text-[22px] font-extrabold text-white outline-none placeholder:text-white/60"
          />
        </div>
      )}
      {filtersOpen && (
        <div role="radiogroup" aria-label={tr('Filtros')} className="absolute inset-x-0 bottom-44 z-20 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ touchAction: 'pan-x' }} onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={liveFilter.id === f.id} onClick={() => setLiveFilter(f)} className={`h-9 shrink-0 rounded-full px-3.5 text-[13px] font-bold backdrop-blur-md transition active:scale-95 ${liveFilter.id === f.id ? 'bg-white text-zinc-900' : 'bg-black/45 text-white ring-1 ring-white/15'}`}>{f.name}</button>
          ))}
        </div>
      )}
      {whiteOut && <div className="pointer-events-none absolute inset-0 z-10 bg-white" />}
      {count > 0 && <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/30"><span className="text-[120px] font-black leading-none drop-shadow-lg">{count}</span></div>}
      {zoomHud && <div className="pointer-events-none absolute left-1/2 top-24 z-20 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-sm font-bold tabular-nums">{zoom.toFixed(1)}×</div>}
      {flash && <div className="pointer-events-none absolute inset-0 bg-white" />}

      <div className="relative z-10 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={() => navigate(-1)} aria-label={tr('Fechar câmara')} className={round}><Icon name="x" size={24} /></button>
        {recording ? (
          <span role="timer" className="flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-sm font-bold tabular-nums">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> {Math.floor(seconds / 60)}:{String(Math.floor(seconds % 60)).padStart(2, '0')}
          </span>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => setGrid((g) => !g)} aria-pressed={grid} aria-label={tr('Grelha')} className={`${round} ${grid ? '!bg-white !text-zinc-900' : ''}`}><Icon name="grid" size={22} /></button>
            <button type="button" onClick={() => setDelay((d) => (d === 0 ? 3 : d === 3 ? 10 : 0))} aria-label={tr('Temporizador')} className={`${round} relative ${delay ? '!bg-white !text-zinc-900' : ''}`}><Icon name="clock" size={22} />{delay > 0 && <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold text-white">{delay}</span>}</button>
            {!canTorch && ready && facing === 'user' && <button type="button" onClick={() => setScreenFlash((f) => !f)} aria-pressed={screenFlash} aria-label={tr('Flash de ecrã')} className={`${round} ${screenFlash ? '!bg-white !text-zinc-900' : ''}`}><FlashIcon on={screenFlash} size={22} /></button>}
            {canTorch && ready && <button type="button" onClick={toggleTorch} aria-pressed={torch} aria-label={tr('Lanterna')} className={`${round} ${torch ? '!bg-white !text-zinc-900' : ''}`}><FlashIcon on={torch} size={22} /></button>}
            {mode !== 'reel' && <button type="button" onClick={() => setTextOn((t) => !t)} aria-pressed={textOn} aria-label={tr('Escrever por cima da foto')} className={`${round} text-base font-bold ${textOn ? '!bg-white !text-zinc-900' : ''}`}>{tr('Aa')}</button>}
            {mode !== 'reel' && <button type="button" onClick={() => setFiltersOpen((o) => !o)} aria-pressed={filtersOpen} aria-label={tr('Filtros')} className={`${round} ${filtersOpen || liveFilter.id !== 'normal' ? '!bg-white !text-zinc-900' : ''}`}><Icon name="sparkles" size={22} /></button>}
            {canFlip && ready && <button type="button" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label={tr('Virar câmara')} className={round}><Icon name="flip-camera" size={24} /></button>}
          </div>
        )}
      </div>

      {!ready && (
        <div className="relative z-10 m-auto max-w-xs px-6 text-center">
          {problem === null ? (
            <p className="text-white/80">{tr('A acordar a câmara…')}</p>
          ) : (
            <>
              <Icon name="alert" size={48} className="mx-auto text-white/70" />
              <p className="mt-3 text-lg font-bold">{problem === 'denied' ? tr('Sem permissão para a câmara') : problem === 'unsupported' ? tr('A câmara precisa de ligação segura') : tr('Não consegui abrir a câmara')}</p>
              <p className="mt-1 text-sm text-white/70">{problem === 'denied' ? tr('Ativa a câmara nas definições do browser, ou escolhe da galeria.') : tr('Podes sempre escolher da galeria.')}</p>
              <label className="mt-5 inline-flex h-12 cursor-pointer items-center rounded-full bg-brand px-6 font-bold">{tr('Abrir galeria')}{galleryInput}</label>
            </>
          )}
        </div>
      )}
      {ready && <div className="flex-1" />}
      {err && <p role="alert" className="relative z-10 mx-auto mb-2 rounded-full bg-black/60 px-4 py-1.5 text-center text-sm font-semibold">{err}</p>}

      {ready && canZoom && !recording && (
        <div className="relative z-10 mb-2 flex justify-center gap-2" role="group" aria-label="Zoom">
          {[0.5, 1, 2, 3, 5].filter((z) => z >= zMin - 0.01 && z <= zMax + 0.01).map((z) => {
            const on = Math.abs(zoom - z) < 0.08;
            return <button key={z} type="button" onClick={() => applyZoom(z)} className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-[13px] font-bold tabular-nums backdrop-blur-md ${on ? 'bg-white text-zinc-900' : 'bg-black/40 text-white'}`}>{on ? `${z}×` : z}</button>;
          })}
          {!([0.5, 1, 2, 3, 5] as number[]).some((z) => Math.abs(zoom - z) < 0.08) && <span className="flex h-9 items-center rounded-full bg-white px-3 text-[13px] font-bold tabular-nums text-zinc-900">{zoom.toFixed(1)}×</span>}
        </div>
      )}

      {/* Modos: o ativo fica a branco; deslizar ou tocar muda. */}
      {!recording && (
        <div className="relative z-10 flex justify-center gap-6 pb-3" role="tablist" aria-label={tr('O que queres publicar')}>
          {[{ id: 'text' as const, label: 'Texto' }, ...MODES].map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => (m.id === 'text' ? navigate('/new/post', { replace: true }) : setMode(m.id))} className={`h-11 px-1 text-[15px] font-bold uppercase tracking-wide transition ${mode === m.id ? 'text-white' : 'text-white/55'}`}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="relative z-10 flex items-center justify-between px-8 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
        {recording ? (
          <span className="w-14" aria-hidden />
        ) : (
          <label className={`${round} h-14 w-14 cursor-pointer rounded-2xl`} title={tr('Galeria')} aria-label={tr('Galeria')}>
            <Icon name="image" size={26} />
            {galleryInput}
          </label>
        )}
        <button
          type="button"
          onPointerDown={pressDown}
          onPointerMove={pressMove}
          onPointerUp={pressUp}
          onPointerCancel={pressCancel}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), shutter())}
          disabled={!ready}
          aria-label={mode === 'reel' ? (recording ? 'Parar a gravação' : 'Gravar') : 'Tirar foto (segura para gravar vídeo)'}
          style={{ touchAction: 'none', WebkitTouchCallout: 'none', userSelect: 'none' }}
          className="relative flex h-[84px] w-[84px] items-center justify-center transition active:scale-90 disabled:opacity-40"
        >
          <svg viewBox="0 0 90 90" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="45" cy="45" r={R} fill="none" stroke="white" strokeWidth="5" opacity={recording ? 0.35 : 1} />
            {recording && <circle cx="45" cy="45" r={R} fill="none" stroke="#ef4444" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, seconds / MAX_REEL_S))} />}
          </svg>
          {mode === 'reel' ? (
            <span className={`bg-red-500 transition-all ${recording ? 'h-7 w-7 rounded-md' : 'h-[62px] w-[62px] rounded-full'}`} />
          ) : recording ? (
            <span className="h-7 w-7 rounded-md bg-red-500 transition-all" />
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
function Review({ mode, captured, initialFilter, onBack, onDone }: { mode: Mode; captured: Captured; initialFilter: Filter; onBack: () => void; onDone: (files: File[] | File) => void }) {
  const photos = 'photos' in captured ? captured.photos : null;
  const previews = useMemo(() => (photos ? photos.map((f) => URL.createObjectURL(f)) : []), [photos]);
  const videoUrl = useMemo(() => ('video' in captured ? URL.createObjectURL(captured.video) : null), [captured]);
  useEffect(() => () => { previews.forEach(URL.revokeObjectURL); if (videoUrl) URL.revokeObjectURL(videoUrl); }, [previews, videoUrl]);
  const [filter, setFilter] = useState<Filter>(initialFilter);
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
      setErr(tr('Não consegui aplicar o filtro. Tenta outro.'));
      setBusy(false);
    }
  }

  const tint = filter.tint;
  return (
    <div role="dialog" aria-modal="true" data-swipe="off" aria-label={tr('Filtros')} className="fixed inset-0 z-[80] flex flex-col bg-black text-white">
      <div className="relative min-h-0 flex-1">
        {videoUrl ? (
          <video src={videoUrl} autoPlay loop muted playsInline controls={false} className="h-full w-full object-contain" />
        ) : (
          <>
            <img src={previews[i]} alt={tr('Pré-visualização')} className="h-full w-full object-contain" style={{ filter: cssFilter(filter) }} />
            {tint && <div aria-hidden className="pointer-events-none absolute inset-0 mix-blend-soft-light" style={{ background: `rgba(${tint[0]},${tint[1]},${tint[2]},${Math.min(1, tint[3] * 3)})` }} />}
          </>
        )}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <button type="button" onClick={onBack} aria-label={tr('Voltar à câmara')} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur-md"><Icon name="back" size={24} /></button>
          {photos && photos.length > 1 && <span className="rounded-full bg-black/50 px-3 py-1 text-sm font-semibold">{i + 1}/{photos.length}</span>}
        </div>
        {photos && photos.length > 1 && (
          <>
            {i > 0 && <button type="button" onClick={() => setI(i - 1)} aria-label={tr('Foto anterior')} className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40"><Icon name="chevron-left" size={24} /></button>}
            {i < photos.length - 1 && <button type="button" onClick={() => setI(i + 1)} aria-label={tr('Foto seguinte')} className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40"><Icon name="chevron-right" size={24} /></button>}
          </>
        )}
      </div>

      <div className="bg-black px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {photos ? (
          <div role="radiogroup" aria-label={tr('Filtros')} className="flex gap-2.5 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          <p className="pb-3 text-center text-sm text-white/70">{tr('Os filtros são para fotos. O vídeo segue como foi gravado.')}</p>
        )}
        {err && <p role="alert" className="pb-2 text-center text-sm text-red-400">{err}</p>}
        <button type="button" onClick={next} disabled={busy} className="h-12 w-full rounded-full bg-brand text-lg font-bold text-white transition active:scale-[0.98] disabled:opacity-50">
          {busy ? tr('A aplicar…') : tr('Seguinte')}
        </button>
      </div>
    </div>
  );
}
