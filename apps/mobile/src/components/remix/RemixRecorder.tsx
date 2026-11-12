import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { coverRect, duetLayout, duetLimitMs, type Rect } from '@/lib/remix';
import { colors } from '@/lib/theme';
import { sealOf } from '@/lib/wordmark';
import { Icon } from '../Icon';
import { stampTxillapp, type Shot } from '../TxCamera';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const W = 1080;
const H = 1920;
const MAX_MS = 60_000;

const recorderType = () => ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';

/** O vídeo original, para tocar e desenhar no canvas: o servidor manda-o como blob (o canvas não fica "sujo" e não há CORS). */
async function localCopy(url: string): Promise<string> {
  try {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(String(r.status));
    return URL.createObjectURL(await r.blob());
  } catch {
    return url;
  }
}

export interface RemixOriginal { url: string; durationMs: number | null; posterUrl?: string | null }
export type Problem = 'denied' | 'unsupported' | 'nocamera' | 'video' | null;

/**
 * Grava no browser o vídeo de um dueto (o original à direita, a câmara à esquerda, os dois a tocar ao mesmo tempo) ou, sem
 * original, uma tcheka simples com a câmara (a resposta com tcheka). Como no TchekaStudio: a montagem final é desenhada num
 * canvas 9:16 enquanto se grava e o MediaRecorder grava o canvas com o som misturado por Web Audio (o som do original e,
 * se ligado, o microfone). Sai já com a assinatura do Txillapp (`signed`).
 */
export function RemixRecorder({ original, title, overlay, onDone, onClose }: { original: RemixOriginal | null; title: string; /** Por cima da pré-visualização (não entra no vídeo): o autocolante do comentário. */ overlay?: ReactNode; onDone: (s: Shot, info: { mic: boolean }) => void; onClose: () => void }) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const cam = useRef<HTMLVideoElement | null>(null);
  const orig = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ac = useRef<AudioContext | null>(null);
  const origNode = useRef<MediaElementAudioSourceNode | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [mic, setMic] = useState(true);
  const [ready, setReady] = useState(false);
  const [origSrc, setOrigSrc] = useState<string | null>(null);
  const [origReady, setOrigReady] = useState(!original);
  const [problem, setProblem] = useState<Problem>(null);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const limit = original ? duetLimitMs(original.durationMs) : MAX_MS;

  // O original, copiado para a memória do browser (uma vez).
  useEffect(() => {
    if (!original) return;
    let alive = true;
    let made: string | null = null;
    void localCopy(original.url).then((u) => { if (!alive) { if (u.startsWith('blob:')) URL.revokeObjectURL(u); return; } made = u; setOrigSrc(u); });
    return () => { alive = false; if (made?.startsWith('blob:')) URL.revokeObjectURL(made); };
  }, [original]);

  const stopStream = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  // A câmara (e o microfone, se ligado). Muda-se de câmara ou de microfone só antes de gravar.
  useEffect(() => {
    let alive = true;
    setReady(false);
    (async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return setProblem('unsupported');
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 } },
          audio: mic ? { echoCancellation: true, noiseSuppression: true } : false,
        });
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stopStream();
        stream.current = s;
        const v = cam.current;
        if (v) { v.srcObject = s; v.muted = true; await v.play().catch(() => undefined); }
        setProblem(null);
        setReady(true);
      } catch (e) {
        const n = (e as DOMException)?.name;
        setProblem(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'nocamera' : 'unsupported');
      }
    })();
    return () => { alive = false; };
  }, [facing, mic]);
  useEffect(() => () => { stopRef.current?.(); stopStream(); void ac.current?.close(); }, []);

  const record = useCallback(async () => {
    const v = cam.current;
    const o = orig.current;
    if (!v || phase !== 'idle' || (original && !o)) return;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const out = (canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream }).captureStream?.(30);
    if (!out || typeof MediaRecorder === 'undefined') return setProblem('unsupported');
    // O som: o original (que também se ouve, para acompanhar) e o microfone (só para a gravação, sem eco nas colunas).
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (AC && !ac.current) ac.current = new AC();
    const ctx = ac.current;
    const dest = ctx ? ctx.createMediaStreamDestination() : null;
    let micNode: MediaStreamAudioSourceNode | null = null;
    if (ctx && dest) {
      await ctx.resume().catch(() => undefined);
      if (o) {
        try {
          if (!origNode.current) origNode.current = ctx.createMediaElementSource(o); // só se pode criar uma vez por vídeo
          origNode.current.disconnect();
          origNode.current.connect(dest);
          origNode.current.connect(ctx.destination);
        } catch { /* sem som do original */ }
      }
      const at = mic ? stream.current?.getAudioTracks()[0] : undefined;
      if (at) { micNode = ctx.createMediaStreamSource(new MediaStream([at])); micNode.connect(dest); }
      dest.stream.getAudioTracks().forEach((t) => out.addTrack(t));
    }
    const type = recorderType();
    const rec = new MediaRecorder(out, type ? { mimeType: type, videoBitsPerSecond: 6_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<Blob>((res) => { rec.onstop = () => res(new Blob(chunks, { type: (rec.mimeType || type || 'video/mp4').split(';')[0] })); });
    const lay = original ? duetLayout(W, H) : null;
    const full: Rect = { x: 0, y: 0, w: W, h: H };
    const mirror = facing === 'user';
    const seal = sealOf(user);
    const drawCam = (box: Rect) => {
      const r = coverRect(v.videoWidth || 9, v.videoHeight || 16, box);
      g.save();
      g.beginPath();
      g.rect(box.x, box.y, box.w, box.h);
      g.clip();
      if (mirror) { g.translate(box.x * 2 + box.w, 0); g.scale(-1, 1); }
      g.drawImage(v, r.x, r.y, r.w, r.h);
      g.restore();
    };
    let stopped = false;
    const stop = () => { stopped = true; };
    stopRef.current = stop;
    setPhase('recording');
    setElapsed(0);
    if (o) { o.currentTime = 0; o.muted = false; await o.play().catch(() => undefined); }
    rec.start(500);
    const t0 = performance.now();
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    while (!stopped) {
      const t = performance.now() - t0;
      if (t >= limit || (o && o.ended)) break;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      if (lay && o) {
        drawCam(lay.left);
        const r = coverRect(o.videoWidth || 9, o.videoHeight || 16, lay.right);
        g.save(); g.beginPath(); g.rect(lay.right.x, lay.right.y, lay.right.w, lay.right.h); g.clip();
        g.drawImage(o, r.x, r.y, r.w, r.h);
        g.restore();
      } else drawCam(full);
      stampTxillapp(g, W, H, user?.username, seal);
      setElapsed(t);
      await frame();
    }
    const durationMs = Math.round(performance.now() - t0);
    setPhase('saving');
    rec.stop();
    o?.pause();
    try { micNode?.disconnect(); } catch { /* já saiu */ }
    try { origNode.current?.disconnect(); origNode.current?.connect(ctx!.destination); } catch { /* já saiu */ }
    const blob = await done;
    stopRef.current = null;
    setPhase('idle');
    if (!blob.size || durationMs < 600) return;
    onDone({ uri: URL.createObjectURL(blob), video: true, mime: blob.type || 'video/mp4', durationMs, signed: true }, { mic: !!micNode });
  }, [facing, limit, mic, onDone, original, phase, user]);

  const recording = phase === 'recording';
  const canRecord = ready && origReady && phase === 'idle' && !problem;
  const msg = problem === 'denied' ? 'O Txillapp não tem acesso à câmara. Dá permissão no browser e volta a tentar.'
    : problem === 'nocamera' ? 'Não encontrei uma câmara neste aparelho.'
    : problem === 'video' ? 'Não consegui carregar a tcheka original.'
    : problem === 'unsupported' ? 'Este browser não consegue gravar vídeo. Experimenta o Chrome ou o Safari mais recentes.' : '';
  const tile = (child: ReactNode, key: string, label: string) => (
    <View key={key} style={original ? st.tileHalf : st.tileFull} accessibilityLabel={label}>{child}</View>
  );
  return (
    <View style={[st.root, { paddingTop: Math.max(insets.top, 10), paddingBottom: Math.max(insets.bottom, 14) }]} accessibilityViewIsModal>
      <View style={st.top}>
        <Pressable onPress={onClose} disabled={recording} style={st.round} accessibilityRole="button" accessibilityLabel="Fechar"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        <Text style={st.title} numberOfLines={1}>{title}</Text>
        <Pressable onPress={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} disabled={recording} style={[st.round, recording && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Virar a câmara"><Icon name="flip-camera" size={22} color="#fff" /></Pressable>
      </View>

      <View style={st.stage}>
        <View style={st.frame}>
          {tile(
            <>
              {dom('video', { ref: cam, playsInline: true, muted: true, autoPlay: true, style: { width: '100%', height: '100%', objectFit: 'cover', transform: facing === 'user' ? 'scaleX(-1)' : undefined, background: '#111' } })}
              {!ready && !problem ? <View style={st.center} pointerEvents="none"><Text style={st.hint}>A ligar a câmara…</Text></View> : null}
            </>,
            'cam', 'A tua câmara',
          )}
          {original ? tile(
            <>
              {origSrc ? dom('video', {
                ref: orig, src: origSrc, playsInline: true, preload: 'auto', crossOrigin: 'anonymous', poster: original.posterUrl ?? undefined,
                onLoadedData: () => setOrigReady(true), onError: () => setProblem('video'),
                style: { width: '100%', height: '100%', objectFit: 'cover', background: '#111' },
              }) : <View style={st.center}><Text style={st.hint}>A carregar a tcheka…</Text></View>}
            </>,
            'orig', 'A tcheka original',
          ) : null}
          {overlay ? <View style={StyleSheet.absoluteFill} pointerEvents="none">{overlay}</View> : null}
        </View>
        {recording ? (
          <View style={st.bar} pointerEvents="none"><View style={[st.barFill, { width: `${Math.min(100, (elapsed / limit) * 100)}%` }]} /></View>
        ) : null}
      </View>

      {msg ? <Text style={st.err} accessibilityRole="alert">{msg}</Text> : null}
      <View style={st.controls}>
        <Pressable onPress={() => setMic((m) => !m)} disabled={recording} style={[st.pill, !mic && st.pillOff, recording && { opacity: 0.5 }]} accessibilityRole="switch" accessibilityState={{ checked: mic }} accessibilityLabel="Microfone">
          <Icon name="mic" size={18} color={mic ? colors.zinc900 : '#fff'} />
          <Text style={[st.pillText, mic && { color: colors.zinc900 }]}>{mic ? 'Microfone ligado' : 'Sem microfone'}</Text>
        </Pressable>
        <Pressable
          onPress={() => (recording ? stopRef.current?.() : void record())}
          disabled={!recording && !canRecord}
          style={[st.shutter, !recording && !canRecord && { opacity: 0.45 }]}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Parar de gravar' : 'Gravar'}
        >
          <View style={recording ? st.stopSq : st.recDot} />
        </Pressable>
        <Text style={st.time} accessibilityLiveRegion="polite">{phase === 'saving' ? 'A guardar…' : `${Math.floor(elapsed / 1000)} / ${Math.round(limit / 1000)} s`}</Text>
      </View>
      {original ? <Text style={st.tip}>Grava ao mesmo tempo que a tcheka toca. Com auscultadores fica sem eco.</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, gap: 10 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  frame: { width: '100%', maxWidth: 520, aspectRatio: 9 / 16, maxHeight: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: '#000', borderRadius: 18, overflow: 'hidden' },
  tileHalf: { flex: 1, aspectRatio: 9 / 16, overflow: 'hidden', backgroundColor: '#111' },
  tileFull: { flex: 1, height: '100%', overflow: 'hidden', backgroundColor: '#111' },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 12 },
  hint: { color: 'rgba(255,255,255,0.8)', fontSize: 13, textAlign: 'center' },
  bar: { position: 'absolute', top: 6, left: 16, right: 16, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: colors.brand },
  err: { color: '#fecaca', fontSize: 13, textAlign: 'center', paddingHorizontal: 24, marginTop: 8 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 12 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#fff', width: 150 },
  pillOff: { backgroundColor: 'rgba(255,255,255,0.16)' },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brand },
  stopSq: { width: 28, height: 28, borderRadius: 6, backgroundColor: colors.brand },
  time: { width: 150, color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  tip: { color: 'rgba(255,255,255,0.65)', fontSize: 12, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 },
});
