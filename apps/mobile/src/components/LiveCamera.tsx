import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { colors } from '@/lib/theme';

/** Só na web: a câmara ao vivo do site (getUserMedia). No nativo usa-se o expo-image-picker. */
export const liveCameraSupported = () => Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export interface Shot { uri: string; video: boolean; mime: string; durationMs?: number }
type Problem = null | 'denied' | 'unsupported' | 'failed';
const MAX_VIDEO_S = 60;

/** Formato que este browser sabe gravar (Safari: mp4; Chrome/Android: webm). */
const recorderType = () => ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';

/**
 * Câmara do Txillapp no browser: ecrã de captura nosso, virar câmara, flash de ecrã, foto ou vídeo (até 60 s) e a galeria lá dentro.
 * Precisa de HTTPS ou localhost (regra dos browsers).
 */
export function LiveCamera({ count, max, onShot, onGallery, onClose, onDone, onText }: { count: number; max: number; onShot: (s: Shot) => void; onGallery: (files: File[]) => void; onClose: () => void; onDone?: () => void; onText?: () => void }) {
  const insets = useSafeAreaInsets();
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const startedAt = useRef(0);
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [canFlip, setCanFlip] = useState(false);
  const [flash, setFlash] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const full = mode === 'photo' && count >= max;
  // No iPhone, o seletor de fotos não devolve nada enquanto a câmara está ligada: desliga-se ao abrir a galeria e religa-se quando o seletor fecha.
  const pausedForPicker = useRef(false);

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  const start = useCallback(async () => {
    stop();
    setReady(false);
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia) return setProblem('unsupported');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: mode === 'video',
      });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setReady(true);
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1);
    } catch (e) {
      setProblem((e as DOMException).name === 'NotAllowedError' ? 'denied' : 'failed');
    }
  }, [facing, mode]);

  useEffect(() => {
    void start();
    return stop;
  }, [start]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const back = () => {
      if (!pausedForPicker.current) return;
      pausedForPicker.current = false;
      void start();
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
  }, [start]);
  const openGallery = () => { pausedForPicker.current = true; stop(); };
  useEffect(() => () => {
    clearInterval(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  function shoot() {
    const v = video.current;
    if (!v || !ready || full || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext('2d')!;
    // Selfie: a foto sai como a viste no ecrã (espelhada).
    if (facing === 'user') {
      g.translate(c.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(v, 0, 0);
    c.toBlob((blob) => blob && onShot({ uri: URL.createObjectURL(blob), video: false, mime: 'image/jpeg' }), 'image/jpeg', 0.9);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
    navigator.vibrate?.(15);
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
    timer.current = setInterval(() => {
      const t = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(t);
      if (t >= MAX_VIDEO_S) r.stop();
    }, 250);
  }

  const mm = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const round = styles.round;
  return (
    <View style={styles.root} accessibilityViewIsModal>
      {createElement('video', {
        ref: video,
        playsInline: true,
        muted: true,
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: facing === 'user' ? 'scaleX(-1)' : undefined, visibility: ready ? 'visible' : 'hidden' },
      })}
      {flash ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }]} /> : null}

      <View style={[styles.top, { paddingTop: Math.max(insets.top, 16) }]}>
        <Pressable onPress={onClose} style={round} accessibilityRole="button" accessibilityLabel="Fechar câmara"><Icon name="x" size={26} color="#fff" strokeWidth={2} /></Pressable>
        {recording ? <View style={styles.rec}><View style={styles.recDot} /><Text style={styles.recText}>{mm}</Text></View> : null}
        {canFlip && ready && !recording ? (
          <Pressable onPress={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} style={round} accessibilityRole="button" accessibilityLabel="Virar câmara"><Icon name="flip-camera" size={26} color="#fff" strokeWidth={2} /></Pressable>
        ) : <View style={{ width: 48 }} />}
      </View>

      {!ready ? (
        <View style={styles.center}>
          {problem === null ? (
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16 }}>A acordar a câmara…</Text>
          ) : (
            <>
              <Icon name="alert" size={48} color="rgba(255,255,255,0.7)" />
              <Text style={styles.pTitle}>{problem === 'denied' ? 'Sem permissão para a câmara' : problem === 'unsupported' ? 'A câmara precisa de ligação segura' : 'Não consegui abrir a câmara'}</Text>
              <Text style={styles.pSub}>{problem === 'denied' ? 'Ativa a câmara nas definições do browser, ou escolhe da galeria.' : 'Podes sempre escolher da galeria.'}</Text>
              <GalleryPick onFiles={onGallery} onOpen={openGallery} style={styles.open}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Abrir galeria</Text></GalleryPick>
            </>
          )}
        </View>
      ) : <View style={{ flex: 1 }} />}

      {!recording ? (
        <View style={styles.modes}>
          {(['photo', 'video', 'text'] as const).map((m) => (
            <Pressable key={m} onPress={() => (m === 'text' ? onText?.() : setMode(m))} style={[styles.mode, mode === m && { backgroundColor: 'rgba(255,255,255,0.9)' }]} accessibilityRole="button">
              <Text style={[styles.modeText, mode === m && { color: colors.zinc900 }]}>{m === 'photo' ? 'Foto' : m === 'video' ? 'Vídeo' : 'Texto'}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 28) }]}>
        <GalleryPick onFiles={onGallery} onOpen={openGallery} style={[round, { width: 56, height: 56, borderRadius: 16 }]}><Icon name="image" size={26} color="#fff" strokeWidth={2} /></GalleryPick>
        <Pressable onPress={mode === 'photo' ? shoot : record} disabled={!ready || full} style={[styles.shutter, (!ready || full) && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel={mode === 'photo' ? 'Tirar foto' : recording ? 'Parar de gravar' : 'Gravar vídeo'}>
          {mode === 'video' ? (recording ? <View style={styles.stopSq} /> : <View style={[styles.shutterIn, { backgroundColor: colors.brand }]} />) : <View style={styles.shutterIn} />}
        </Pressable>
        {count > 0 && onDone ? (
          <Pressable onPress={onDone} style={styles.doneBtn} accessibilityRole="button">
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Feito</Text>
            <View style={styles.doneCount}><Text style={{ color: '#fff', fontSize: 14 }}>{count}</Text></View>
          </Pressable>
        ) : <View style={{ width: 92 }} />}
      </View>
      {full ? <Text style={styles.full} accessibilityRole="alert">Máximo de {max} fotos</Text> : null}
    </View>
  );
}

/** Botão que abre o seletor de ficheiros do browser (fotos e vídeos). */
function GalleryPick({ onFiles, onOpen, style, children }: { onFiles: (f: File[]) => void; onOpen?: () => void; style?: object; children: React.ReactNode }) {
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { zIndex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  round: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 8 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  recText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, zIndex: 2 },
  pTitle: { marginTop: 12, color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  pSub: { marginTop: 4, color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center' },
  open: { marginTop: 20, height: 48, borderRadius: 24, backgroundColor: colors.brand, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  modes: { zIndex: 2, alignSelf: 'center', flexDirection: 'row', gap: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)', padding: 4 },
  mode: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 },
  modeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  bottom: { zIndex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 20 },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  stopSq: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.brand },
  doneBtn: { width: 92, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 24, backgroundColor: colors.brand },
  doneCount: { borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 8 },
  full: { position: 'absolute', left: 0, right: 0, bottom: 140, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: '600', zIndex: 3 },
});
