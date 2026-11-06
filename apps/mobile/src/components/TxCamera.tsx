import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { acquireCamera, releaseCamera } from './zas/cameraSession';
import { FUN_FX, createFunRenderer, type FunRenderer } from './zas/funFilters';

/**
 * A câmara oficial do Txillapp no browser (publicações, status). Ecrã inteiro, com a identidade da marca:
 * obturador com anel coral em degradê, filtros divertidos ao deslizar (os mesmos dos Zás), flash/lanterna, temporizador,
 * virar câmara, foto ou vídeo (até 60 s), e a galeria lá dentro. Precisa de HTTPS ou localhost (regra dos browsers).
 * Só deve ser montada quando `liveCameraSupported()`.
 */
export const liveCameraSupported = () => Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export interface Shot { uri: string; video: boolean; mime: string; durationMs?: number }
export type CamMode = 'photo' | 'video' | 'text';
type Problem = null | 'denied' | 'unsupported' | 'failed';
const MAX_VIDEO_S = 60;
const recorderType = () => ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const web = (o: Record<string, unknown>) => o as never;
const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* sem vibração */ } };

export function TxCamera({
  count, max, modes = ['photo', 'video', 'text'], onShot, onGallery, onClose, onDone, onText, doneLabel = 'Feito',
}: {
  count: number; max: number; modes?: CamMode[]; onShot: (s: Shot) => void; onGallery: (files: File[]) => void; onClose: () => void; onDone?: () => void; onText?: () => void; doneLabel?: string;
}) {
  const insets = useSafeAreaInsets();
  const video = useRef<HTMLVideoElement | null>(null);
  const fxCanvas = useRef<HTMLCanvasElement | null>(null);
  const fxRenderer = useRef<FunRenderer | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const countTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const startedAt = useRef(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const pausedForPicker = useRef(false);
  const [mode, setMode] = useState<CamMode>(modes.includes('photo') ? 'photo' : modes[0]);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [canFlip, setCanFlip] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [light, setLight] = useState(false);
  const [lit, setLit] = useState(false);
  const [flash, setFlash] = useState(false);
  const [delay, setDelay] = useState<0 | 3 | 10>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [fx, setFx] = useState(0);
  const [fxOk, setFxOk] = useState(true);
  const [fxName, setFxName] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const full = mode === 'photo' && count >= max;

  const start = useCallback(async () => {
    setReady(false);
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia) return setProblem('unsupported');
    try {
      const s = await acquireCamera(facing, mode === 'video');
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setCanTorch(!!caps.torch);
      setReady(true);
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1);
    } catch (e) {
      setProblem((e as DOMException).name === 'NotAllowedError' ? 'denied' : 'failed');
    }
  }, [facing, mode]);

  useEffect(() => { void start(); }, [start]);
  useEffect(() => () => {
    releaseCamera(2_000);
    clearInterval(timer.current);
    clearInterval(countTimer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    fxRenderer.current?.dispose();
  }, []);
  // No iPhone, o seletor de fotos não devolve nada enquanto a câmara está ligada: desliga-se ao abrir a galeria e religa-se quando o seletor fecha.
  useEffect(() => {
    const back = () => {
      if (!pausedForPicker.current) return;
      pausedForPicker.current = false;
      void start();
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
  }, [start]);
  const openGallery = () => { pausedForPicker.current = true; releaseCamera(0); setReady(false); };

  // Filtros em direto: o canvas mostra o resultado e é dele que sai a foto.
  useEffect(() => {
    if (!ready || fx === 0 || !fxCanvas.current) return;
    fxRenderer.current ??= createFunRenderer(fxCanvas.current);
    const r = fxRenderer.current;
    if (!r) { setFxOk(false); setFx(0); return; }
    const t0 = performance.now();
    let raf = 0;
    const loop = () => { if (video.current) r.render(video.current, fx, (performance.now() - t0) / 1000); raf = requestAnimationFrame(loop); };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [ready, fx]);
  const cycleFx = (dir: 1 | -1) => {
    setFx((f) => {
      const n = (f + dir + FUN_FX.length) % FUN_FX.length;
      setFxName(FUN_FX[n].name);
      return n;
    });
    buzz(6);
  };
  useEffect(() => {
    if (fxName === null) return;
    const t = setTimeout(() => setFxName(null), 900);
    return () => clearTimeout(t);
  }, [fxName]);

  async function shoot() {
    const v = video.current;
    if (!v || !ready || full || !v.videoWidth) return;
    const vtrack = stream.current?.getVideoTracks()[0];
    let torchOn = false;
    if (light) {
      if (canTorch && vtrack) {
        try { await vtrack.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }); torchOn = true; } catch { /* sem lanterna: ecrã aceso */ }
      }
      if (!torchOn) setLit(true);
      await new Promise((r) => setTimeout(r, 420));
    }
    const c = document.createElement('canvas');
    const fxc = fx > 0 && fxCanvas.current && fxCanvas.current.width > 0 ? fxCanvas.current : null;
    if (fxc && fxRenderer.current) fxRenderer.current.render(v, fx, performance.now() / 1000);
    const src: CanvasImageSource = fxc ?? v;
    c.width = fxc ? fxc.width : v.videoWidth;
    c.height = fxc ? fxc.height : v.videoHeight;
    const g = c.getContext('2d')!;
    if (facing === 'user') { g.translate(c.width, 0); g.scale(-1, 1); } // selfie: sai como a viste (espelhada)
    g.drawImage(src, 0, 0);
    setLit(false);
    if (torchOn && vtrack) vtrack.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => undefined);
    buzz(15);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
    c.toBlob((blob) => blob && onShot({ uri: URL.createObjectURL(blob), video: false, mime: 'image/jpeg' }), 'image/jpeg', 0.9);
  }

  function record() {
    if (recording) return recorder.current?.stop();
    const s = stream.current;
    if (!s || !ready || typeof MediaRecorder === 'undefined') return;
    const type = recorderType();
    const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      clearInterval(timer.current);
      setRecording(false);
      setSeconds(0);
      const mime = (r.mimeType || type || 'video/mp4').split(';')[0];
      const blob = new Blob(chunks.current, { type: mime });
      if (blob.size) onShot({ uri: URL.createObjectURL(blob), video: true, mime, durationMs: Date.now() - startedAt.current });
    };
    recorder.current = r;
    startedAt.current = Date.now();
    r.start(1000);
    setRecording(true);
    buzz(10);
    timer.current = setInterval(() => {
      const t = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(t);
      if (t >= MAX_VIDEO_S) r.stop();
    }, 250);
  }

  /** Obturador: com temporizador faz a contagem e só depois dispara; tocar outra vez cancela. */
  function press() {
    if (countdown !== null) { clearInterval(countTimer.current); return setCountdown(null); }
    const fire = () => (mode === 'photo' ? void shoot() : record());
    if (!delay || recording) return fire();
    let n: number = delay;
    setCountdown(n);
    countTimer.current = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(countTimer.current); setCountdown(null); fire(); } else setCountdown(n);
    }, 1000);
  }

  const mm = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const mirror = facing === 'user' ? 'scaleX(-1)' : 'none';
  const fill = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover' };
  const topPad = Math.max(insets.top, 12);
  const botPad = Math.max(insets.bottom, 20);

  return (
    <View style={st.root} accessibilityViewIsModal>
      {dom(
        'div',
        {
          style: { position: 'absolute', inset: 0, backgroundColor: '#000', touchAction: 'pan-y' },
          onTouchStart: (e: TouchEvent) => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; },
          onTouchEnd: (e: TouchEvent) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s || !fxOk || !ready || recording) return;
            const dx = e.changedTouches[0].clientX - s.x;
            const dy = e.changedTouches[0].clientY - s.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) cycleFx(dx < 0 ? 1 : -1);
          },
        },
        dom('video', { ref: video, playsInline: true, muted: true, autoPlay: true, style: { ...fill, transform: mirror, visibility: ready ? 'visible' : 'hidden' } }),
        dom('canvas', { ref: fxCanvas, 'aria-hidden': true, style: { ...fill, transform: mirror, display: fx > 0 ? 'block' : 'none' } }),
      )}
      {/* Sombras suaves em cima e em baixo, para os controlos se lerem sobre qualquer cena. */}
      <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, top: 0, height: 140, backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)' })} />
      <View pointerEvents="none" style={web({ position: 'absolute', left: 0, right: 0, bottom: 0, height: 260, backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' })} />
      {lit ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }]} /> : null}
      {flash ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }]} /> : null}

      {/* Em cima: fechar; flash, temporizador, virar. */}
      <View style={[st.top, { paddingTop: topPad }]}>
        <Pressable onPress={onClose} style={st.round} accessibilityRole="button" accessibilityLabel="Fechar câmara"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        {recording ? (
          <View style={st.rec}><View style={st.recDot} /><Text style={st.recText}>{mm}</Text></View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setLight((v) => !v)} style={[st.round, light && { backgroundColor: '#fcd34d' }]} accessibilityRole="button" accessibilityState={{ selected: light }} accessibilityLabel={canTorch ? 'Lanterna' : 'Flash de ecrã'}>
              <View>
                <Icon name="bolt" size={22} solid={light} color={light ? colors.zinc900 : '#fff'} />
                {!light && <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: -3, height: 2, borderRadius: 1, width: 28, backgroundColor: '#fff', transform: [{ rotate: '-45deg' }] }} />}
              </View>
            </Pressable>
            {mode !== 'text' && (
              <Pressable onPress={() => setDelay((d) => (d === 0 ? 3 : d === 3 ? 10 : 0))} style={[st.round, delay > 0 && { backgroundColor: '#fff' }]} accessibilityRole="button" accessibilityLabel={delay ? `Temporizador: ${delay} segundos` : 'Temporizador'}>
                <Icon name="clock" size={22} color={delay ? colors.zinc900 : '#fff'} />
                {delay > 0 && <View style={st.delayBadge}><Text style={st.delayText}>{delay}</Text></View>}
              </Pressable>
            )}
            {canFlip && ready ? (
              <Pressable onPress={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} style={st.round} accessibilityRole="button" accessibilityLabel="Virar câmara"><Icon name="flip-camera" size={22} color="#fff" /></Pressable>
            ) : null}
          </View>
        )}
      </View>

      {/* Nome do filtro ao deslizar; contagem do temporizador. */}
      {fxName ? <View pointerEvents="none" style={st.center}><Text style={st.fxName}>{fxName}</Text></View> : null}
      {countdown !== null ? <View pointerEvents="none" style={st.center}><Text accessibilityLiveRegion="assertive" style={st.countText}>{countdown}</Text></View> : null}

      {!ready && (
        <View style={st.center}>
          {problem === null ? (
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16 }}>A acordar a câmara…</Text>
          ) : (
            <View style={{ alignItems: 'center', paddingHorizontal: 32 }}>
              <Icon name="alert" size={48} color="rgba(255,255,255,0.7)" />
              <Text style={st.pTitle}>{problem === 'denied' ? 'Sem permissão para a câmara' : problem === 'unsupported' ? 'A câmara precisa de ligação segura' : 'Não consegui abrir a câmara'}</Text>
              <Text style={st.pSub}>{problem === 'denied' ? 'Ativa a câmara nas definições do browser, ou escolhe da galeria.' : 'Podes sempre escolher da galeria.'}</Text>
              <GalleryPick onFiles={onGallery} onOpen={openGallery} style={st.open}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Abrir galeria</Text></GalleryPick>
            </View>
          )}
        </View>
      )}

      <View style={[st.bottom, { paddingBottom: botPad }]}>
        {ready && fxOk && !recording && (
          <View pointerEvents="none" style={st.dots}>
            {FUN_FX.map((f) => <View key={f.id} style={{ height: 5, width: fx === f.id ? 16 : 5, borderRadius: 3, backgroundColor: fx === f.id ? '#fff' : 'rgba(255,255,255,0.45)' }} />)}
          </View>
        )}
        {!recording && modes.length > 1 ? (
          <View style={st.modes} accessibilityRole="tablist">
            {modes.map((m) => (
              <Pressable key={m} onPress={() => (m === 'text' ? onText?.() : setMode(m))} style={[st.mode, mode === m && { backgroundColor: 'rgba(255,255,255,0.92)' }]} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
                <Text style={[st.modeText, mode === m && { color: colors.zinc900 }]}>{m === 'photo' ? 'Foto' : m === 'video' ? 'Vídeo' : 'Texto'}</Text>
              </Pressable>
            ))}
          </View>
        ) : <View style={{ height: 34 }} />}
        <View style={st.row}>
          <View style={st.side}>
            {!recording && (
              <GalleryPick onFiles={onGallery} onOpen={openGallery} style={st.gallery}><Icon name="images" size={24} color="#fff" strokeWidth={2} /></GalleryPick>
            )}
          </View>
          <Pressable
            onPress={press}
            disabled={!ready || full}
            accessibilityRole="button"
            accessibilityLabel={countdown !== null ? 'Cancelar' : mode === 'photo' ? 'Tirar foto' : recording ? 'Parar de gravar' : 'Gravar vídeo'}
            style={({ pressed }) => [st.shutter, (!ready || full) && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.92 }] }]}
          >
            <View style={web({ position: 'absolute', inset: 0, borderRadius: 44, padding: 4, backgroundImage: recording ? 'conic-gradient(#ef4444, #ff8a80, #ef4444)' : 'conic-gradient(from 200deg, #d6334f, #ff9a5b, #ffd166, #d6334f)' })}>
              <View style={{ flex: 1, borderRadius: 40, backgroundColor: 'rgba(0,0,0,0.65)' }} />
            </View>
            {recording ? (
              <View style={st.stopSq} />
            ) : (
              <View style={[st.shutterIn, mode === 'video' && { backgroundColor: colors.brand }]} />
            )}
          </Pressable>
          <View style={[st.side, { alignItems: 'flex-end' }]}>
            {count > 0 && onDone && !recording ? (
              <Pressable onPress={onDone} style={st.doneBtn} accessibilityRole="button" accessibilityLabel={`${doneLabel}, ${count}`}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{doneLabel}</Text>
                <View style={st.doneCount}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{count}</Text></View>
              </Pressable>
            ) : null}
          </View>
        </View>
        {full ? <Text style={st.full} accessibilityRole="alert">Máximo de {max} fotos</Text> : null}
      </View>
    </View>
  );
}

/** Botão que abre o seletor de ficheiros do browser (fotos e vídeos). */
export function GalleryPick({ onFiles, onOpen, style, children }: { onFiles: (f: File[]) => void; onOpen?: () => void; style?: object; children: ReactNode }) {
  return (
    <View style={style as never} accessibilityRole="button" accessibilityLabel="Galeria">
      {children}
      {createElement('input', {
        type: 'file',
        multiple: true,
        accept: 'image/*,video/*',
        onClick: () => onOpen?.(),
        'aria-label': 'Escolher da galeria',
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' },
        onChange: (e: { target: HTMLInputElement }) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        },
      })}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  delayBadge: { position: 'absolute', right: -4, bottom: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  delayText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 8 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  recText: { color: '#fff', fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  fxName: { color: '#fff', fontSize: 22, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 18, paddingVertical: 8, overflow: 'hidden' },
  countText: { fontSize: 120, fontWeight: '900', color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 20 },
  pTitle: { marginTop: 12, color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  pSub: { marginTop: 4, color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center' },
  open: { marginTop: 20, height: 48, borderRadius: 24, backgroundColor: colors.brand, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 4, marginBottom: 12 },
  modes: { flexDirection: 'row', gap: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', padding: 3, marginBottom: 18 },
  mode: { borderRadius: 999, paddingHorizontal: 18, paddingVertical: 6 },
  modeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  row: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28 },
  side: { width: 92, alignItems: 'flex-start' },
  gallery: { width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
  stopSq: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#ef4444' },
  doneBtn: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 23, backgroundColor: colors.brand, paddingHorizontal: 16 },
  doneCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  full: { marginTop: 10, color: '#fff', fontSize: 14, fontWeight: '600' },
});
