import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '@/lib/theme';
import { GalleryPicker } from './GalleryPicker';
import { Icon } from './Icon';
import { PhotoEditor } from './PhotoEditor';
import type { Shot } from './TxCamera';

const MAX_VIDEO_S = 60;
const HOLD_MS = 350;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const tap = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

/**
 * Câmara do Txillapp no telemóvel (Android/iPhone). O visor tem exatamente a proporção da imagem da câmara (3:4 numa
 * publicação, 9:16 num mimo ou tcheka), com cantos arredondados e os controlos por cima: fechar, flash, temporizador e
 * só texto. Tocar = foto (abre o editor: filtros, ajustes, recorte), manter premido = vídeo (até 60 s, anel de progresso;
 * deslizar para cima aproxima). Dois dedos para o zoom, dois toques para virar. Em baixo: galeria, modos e virar câmara.
 */
export function NativeCamera({
  onShot, onPickMany, multi = false, galleryTitle = 'Galeria', onClose, onDone, onText, doneLabel = 'Seguinte', count = 0, kinds, kind, onKind, aspect = 9 / 16,
}: {
  onShot: (s: Shot) => void;
  /** Várias fotos e vídeos escolhidos de uma vez na galeria (só com `multi`). */
  onPickMany?: (shots: Shot[]) => void;
  multi?: boolean;
  /** Título da galeria (ex.: "Nova publicação", "Adicionar ao mimo"). */
  galleryTitle?: string;
  onClose: () => void;
  onDone?: () => void;
  onText?: () => void;
  doneLabel?: string;
  count?: number;
  kinds?: { id: string; label: string }[];
  kind?: string;
  onKind?: (id: string) => void;
  /** Proporção da foto final (4:5 numa publicação, 9:16 nos outros); o editor começa recortado nela. */
  aspect?: number;
}) {
  const insets = useSafeAreaInsets();
  const cam = useRef<CameraView | null>(null);
  const [perm, askPerm] = useCameraPermissions();
  const [mic, askMic] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<'off' | 'on' | 'auto'>('off');
  const [delay, setDelay] = useState<0 | 3 | 10>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [zoom, setZoom] = useState(0);
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const [review, setReview] = useState<Shot | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const pendingRecord = useRef(false);
  const holdT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holding = useRef(false);
  const slide = useRef<{ y: number; z: number } | null>(null);
  const recTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const countTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const startedAt = useRef(0);
  const z0 = useRef(0);

  // Proporção da imagem da câmara: 16:9 (vertical 9:16) para mimos e tchekas, 4:3 (vertical 3:4) para publicações.
  const tall = aspect < 0.7;
  const ratio = tall ? '16:9' : '4:3';
  const sensor = tall ? 9 / 16 : 3 / 4;

  useEffect(() => () => { clearTimeout(holdT.current); clearInterval(recTimer.current); clearInterval(countTimer.current); }, []);
  // O microfone pede-se ao abrir a câmara (não a meio de manter o obturador). Sem ele, os vídeos gravam sem som.
  useEffect(() => {
    if (perm?.granted && mic && !mic.granted && mic.canAskAgain) void askMic();
  }, [perm?.granted, mic?.granted]); // eslint-disable-line react-hooks/exhaustive-deps
  // Botão de voltar do Android: sai da pré-visualização, pára a gravação, ou fecha a câmara.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editing || galleryOpen) return false; // o editor e a galeria tratam
      if (review) { setReview(null); return true; }
      if (recording) { cam.current?.stopRecording(); return true; }
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [editing, galleryOpen, review, recording, onClose]);

  // Gestos no visor: dois dedos = zoom; dois toques = virar a câmara.
  const pinch = usePinchGesture({
    runOnJS: true,
    onBegin: () => { z0.current = zoom; },
    onUpdate: (e) => setZoom(clamp(z0.current + (e.scale - 1) * 0.35, 0, 1)),
  });
  const doubleTap = useTapGesture({ numberOfTaps: 2, runOnJS: true, onActivate: () => { if (!recording) flip(); } });
  // Deslizar para a direita no visor abre a galeria (como no Instagram).
  const swipe = usePanGesture({
    runOnJS: true,
    maxPointers: 1,
    activeOffsetX: 30,
    failOffsetY: [-40, 40],
    onDeactivate: (e) => { if (!recording && e.translationX > 80) setGalleryOpen(true); },
  });
  const gestures = useSimultaneousGestures(pinch, doubleTap, swipe);

  /** Da galeria: uma foto vai ao editor; um vídeo segue; várias juntam-se à publicação. */
  function picked(shots: Shot[]) {
    setGalleryOpen(false);
    if (shots.length > 1 && onPickMany) return onPickMany(shots);
    const s = shots[0];
    if (!s) return;
    if (s.video) onShot(s);
    else setEditing(s.uri);
  }

  function flip() {
    tap();
    setReady(false);
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
  }

  async function takePhoto() {
    if (!cam.current || busy || !ready) return;
    setBusy(true);
    tap();
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.95 });
      if (pic?.uri) setEditing(pic.uri);
    } catch {
      /* a câmara falhou a meio: fica no visor */
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    // Só uma vez por pedido (avisa a câmara e o tempo limite: o primeiro que chegar).
    if (!cam.current || !pendingRecord.current) return;
    pendingRecord.current = false;
    // Largou o dedo enquanto a câmara mudava para vídeo: não grava.
    if (!holding.current) { setMode('picture'); return; }
    setRecording(true);
    startedAt.current = Date.now();
    setRecMs(0);
    recTimer.current = setInterval(() => setRecMs(Date.now() - startedAt.current), 100);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      const v = await cam.current.recordAsync({ maxDuration: MAX_VIDEO_S });
      const durationMs = Date.now() - startedAt.current;
      if (v?.uri && durationMs > 400) setReview({ uri: v.uri, video: true, mime: 'video/mp4', durationMs });
    } catch {
      /* gravação interrompida */
    } finally {
      clearInterval(recTimer.current);
      setRecording(false);
      setRecMs(0);
      holding.current = false;
      setMode('picture');
    }
  }

  // O modo vídeo só fica pronto depois de a câmara se reconfigurar: começa a gravar quando ela avisa (ou ao fim de 1,5 s).
  function onReady() {
    setReady(true);
    if (pendingRecord.current && mode === 'video') void startRecording();
  }
  useEffect(() => {
    if (mode !== 'video' || !pendingRecord.current) return;
    const t = setTimeout(() => { if (pendingRecord.current) void startRecording(); }, 1500);
    return () => clearTimeout(t);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Obturador: tocar = foto (com o temporizador, se houver); manter = vídeo; a gravar, deslizar para cima aproxima.
  function shutterStart(e: GestureResponderEvent) {
    holding.current = false;
    if (!ready || busy || countdown !== null || recording) return;
    slide.current = { y: e.nativeEvent.pageY, z: zoom };
    holdT.current = setTimeout(() => {
      holding.current = true;
      pendingRecord.current = true;
      setMode('video');
    }, HOLD_MS);
  }
  function shutterMove(e: GestureResponderEvent) {
    const sl = slide.current;
    if (!sl || !holding.current) return;
    setZoom(clamp(sl.z + (sl.y - e.nativeEvent.pageY) / 260, 0, 1));
  }
  function shutterEnd() {
    clearTimeout(holdT.current);
    slide.current = null;
    if (holding.current) {
      holding.current = false;
      if (pendingRecord.current) { pendingRecord.current = false; setMode('picture'); return; } // largou antes de começar
      cam.current?.stopRecording();
      return;
    }
    if (countdown !== null) { clearInterval(countTimer.current); setCountdown(null); return; }
    if (recording) { cam.current?.stopRecording(); return; }
    if (!delay) return void takePhoto();
    let n: number = delay;
    setCountdown(n);
    countTimer.current = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(countTimer.current); setCountdown(null); void takePhoto(); } else setCountdown(n);
    }, 1000);
  }

  // Medidas: o visor (na proporção da câmara) logo abaixo do topo, com margens; o obturador por baixo, se couber.
  const barH = 64 + Math.max(insets.bottom, 12);
  const top = insets.top + 6;
  const freeH = Math.max(0, area.h - top - barH);
  let vw = Math.max(0, area.w - 16);
  let vh = vw / sensor;
  if (vh > freeH) { vh = freeH; vw = vh * sensor; }
  const view = { x: (area.w - vw) / 2, y: top, w: vw, h: vh };
  const below = freeH - vh; // espaço livre entre o visor e a barra de baixo
  const shutterInside = below < 120;
  const shutterY = shutterInside ? view.y + view.h - 84 - 22 : view.y + view.h + (below - 84) / 2;
  // A parte da foto que fica (para a publicação 4:5 dentro do 3:4): escurece-se o resto, sem molduras.
  const capH = Math.min(view.h, view.w / aspect);
  const band = Math.max(0, (view.h - capH) / 2);
  const mm = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  if (!perm) return <View style={st.root} />;
  if (!perm.granted) {
    return (
      <View style={[st.root, st.center, { paddingHorizontal: 32 }]}>
        <Pressable onPress={onClose} style={[st.round, { position: 'absolute', top: insets.top + 10, left: 12 }]} accessibilityRole="button" accessibilityLabel="Fechar câmara"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        <Icon name="camera" size={52} color="rgba(255,255,255,0.8)" />
        <Text style={st.pTitle}>A câmara do Txillapp</Text>
        <Text style={st.pSub}>{perm.canAskAgain ? 'Dá acesso à câmara para tirar fotos e gravar vídeos aqui mesmo.' : 'A câmara está bloqueada. Ativa-a nas definições do telemóvel.'}</Text>
        <Pressable onPress={() => void (perm.canAskAgain ? askPerm() : Linking.openSettings())} style={st.cta} accessibilityRole="button">
          <Text style={st.ctaText}>{perm.canAskAgain ? 'Permitir a câmara' : 'Abrir as definições'}</Text>
        </Pressable>
        <Pressable onPress={() => setGalleryOpen(true)} style={{ marginTop: 14, padding: 10 }} accessibilityRole="button"><Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Escolher da galeria</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={st.root} onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {area.w > 0 ? (
        <>
          {/* Visor: só quando já se sabe o tamanho, e com a proporção exata da imagem da câmara (preenche sem barras). */}
          <GestureDetector gesture={gestures}>
            <View style={[st.view, { left: view.x, top: view.y, width: view.w, height: view.h }]} collapsable={false}>
              <CameraView
                ref={cam}
                style={StyleSheet.absoluteFill}
                facing={facing}
                mode={mode}
                ratio={ratio}
                flash={flash}
                enableTorch={recording && flash === 'on' && facing === 'back'}
                zoom={zoom}
                mirror={facing === 'front'}
                mute={!mic?.granted}
                videoQuality="1080p"
                onCameraReady={onReady}
              />
              {band > 1 && !recording ? (
                <>
                  <View pointerEvents="none" style={[st.band, { top: 0, height: band }]} />
                  <View pointerEvents="none" style={[st.band, { bottom: 0, height: band }]} />
                </>
              ) : null}
              {/* Sombra suave em cima, para os controlos se lerem em qualquer cena. */}
              <View pointerEvents="none" style={st.topShade} />
            </View>
          </GestureDetector>

          {/* Controlos por cima do visor: fechar · wordmark · flash, temporizador, só texto. */}
          <View style={[st.controls, { left: view.x, top: view.y, width: view.w }]} pointerEvents="box-none">
            <Pressable onPress={onClose} style={st.round} accessibilityRole="button" accessibilityLabel="Fechar câmara"><Icon name="x" size={22} color="#fff" strokeWidth={2.2} /></Pressable>
            {recording ? (
              <View style={st.rec}><View style={st.recDot} /><Text style={st.recText}>{mm(recMs)}</Text></View>
            ) : (
              <Text style={st.wordmark} accessibilityLabel="Txillapp">txill<Text style={{ color: colors.brand }}>a</Text>pp</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {!recording && (
                <>
                  <Pressable onPress={() => setFlash((f) => (f === 'off' ? 'on' : f === 'on' ? 'auto' : 'off'))} style={[st.round, flash !== 'off' && st.roundOn]} accessibilityRole="button" accessibilityLabel={`Flash: ${flash === 'off' ? 'desligado' : flash === 'on' ? 'ligado' : 'automático'}`}>
                    <View>
                      <Icon name="bolt" size={20} solid={flash !== 'off'} color={flash !== 'off' ? colors.zinc900 : '#fff'} />
                      {flash === 'off' && <View pointerEvents="none" style={st.slash} />}
                      {flash === 'auto' && <Text style={st.auto}>A</Text>}
                    </View>
                  </Pressable>
                  <Pressable onPress={() => setDelay((d) => (d === 0 ? 3 : d === 3 ? 10 : 0))} style={[st.round, delay > 0 && st.roundOn]} accessibilityRole="button" accessibilityLabel={delay ? `Temporizador: ${delay} segundos` : 'Temporizador'}>
                    <Icon name="clock" size={20} color={delay ? colors.zinc900 : '#fff'} />
                    {delay > 0 && <View style={st.delayBadge}><Text style={st.delayText}>{delay}</Text></View>}
                  </Pressable>
                  {onText ? <Pressable onPress={onText} style={st.round} accessibilityRole="button" accessibilityLabel="Só texto"><Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Aa</Text></Pressable> : null}
                </>
              )}
            </View>
          </View>

          {zoom > 0.02 ? (
            <Pressable onPress={() => setZoom(0)} style={[st.zoomBadge, { top: view.y + 62 }]} accessibilityRole="button" accessibilityLabel="Repor zoom"><Text style={st.zoomText}>{(1 + zoom * 7).toFixed(1)}×</Text></Pressable>
          ) : null}
          {countdown !== null ? <View pointerEvents="none" style={[st.countWrap, { left: view.x, top: view.y, width: view.w, height: view.h }]}><Text style={st.countText}>{countdown}</Text></View> : null}

          {/* Obturador (e a dica por cima, nas primeiras vezes). */}
          <View style={[st.shutterWrap, { top: shutterY - 30 }]} pointerEvents="box-none">
            {!recording && count === 0 ? <Text style={st.hint}>Toca para foto · mantém para vídeo</Text> : <View style={{ height: 18 }} />}
            <View
              onTouchStart={shutterStart}
              onTouchMove={shutterMove}
              onTouchEnd={shutterEnd}
              onTouchCancel={shutterEnd}
              style={[st.shutter, (!ready || busy) && !recording && { opacity: 0.5 }, recording && { transform: [{ scale: 1.12 }] }]}
              accessible
              accessibilityRole="button"
              accessibilityLabel={recording ? 'Parar de gravar' : countdown !== null ? 'Cancelar' : 'Tirar foto; mantém premido para gravar vídeo'}
            >
              <View style={[st.shutterRing, recording && { borderColor: 'rgba(255,255,255,0.35)' }]} />
              {recording ? (
                <Svg width={84} height={84} style={StyleSheet.absoluteFill} pointerEvents="none">
                  <Circle cx={42} cy={42} r={40} stroke={colors.brand} strokeWidth={4} fill="none" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 40}`} strokeDashoffset={2 * Math.PI * 40 * (1 - Math.min(1, recMs / (MAX_VIDEO_S * 1000)))}
                    transform="rotate(-90 42 42)" />
                </Svg>
              ) : null}
              <View style={[st.shutterIn, recording && st.shutterRec]} />
            </View>
          </View>

          {/* Com fotos juntas: Seguinte. */}
          {!recording && count > 0 && onDone ? (
            <Pressable onPress={onDone} style={[st.doneBtn, { top: shutterY + 20, right: 20 }]} accessibilityRole="button" accessibilityLabel={`${doneLabel}, ${count}`}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{doneLabel}</Text>
              <View style={st.doneCount}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{count}</Text></View>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {/* Barra de baixo: galeria, modos e virar câmara (como no Instagram). */}
      <View style={[st.bar, { height: barH, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={{ width: 44 }}>
          {!recording && <Pressable onPress={() => setGalleryOpen(true)} style={st.galleryThumb} accessibilityRole="button" accessibilityLabel="Galeria"><Icon name="images" size={22} color="#fff" strokeWidth={2} /></Pressable>}
        </View>
        {kinds && !recording ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.kinds} style={{ flex: 1 }}>
            {kinds.map((k) => (
              <Pressable key={k.id} onPress={() => { tap(); onKind?.(k.id); }} accessibilityRole="tab" accessibilityState={{ selected: kind === k.id }} hitSlop={8}>
                <Text style={[st.kindText, kind === k.id && st.kindOn]}>{k.label.toUpperCase()}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : <View style={{ flex: 1 }} />}
        <View style={{ width: 44, alignItems: 'flex-end' }}>
          {!recording && <Pressable onPress={flip} style={st.round} accessibilityRole="button" accessibilityLabel="Virar câmara"><Icon name="flip-camera" size={22} color="#fff" /></Pressable>}
        </View>
      </View>

      {editing ? (
        <PhotoEditor
          uri={editing}
          aspect={aspect}
          onCancel={() => setEditing(null)}
          onDone={(file) => { setEditing(null); onShot({ uri: file, video: false, mime: 'image/jpeg' }); }}
        />
      ) : null}
      {galleryOpen ? <GalleryPicker title={galleryTitle} multi={multi} onPick={picked} onCamera={() => setGalleryOpen(false)} onClose={() => setGalleryOpen(false)} /> : null}
      {review ? <Review shot={review} onRetake={() => setReview(null)} onUse={() => { const s = review; setReview(null); onShot(s); }} /> : null}
    </View>
  );
}

/** Depois de gravar: ver o vídeo, repetir ou usar. */
function Review({ shot, onRetake, onUse }: { shot: Shot; onRetake: () => void; onUse: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 20 }]}>
      <ReviewVideo uri={shot.uri} />
      <View style={[st.reviewBar, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <Pressable onPress={onRetake} style={st.ghostBtn} accessibilityRole="button"><Icon name="undo" size={20} color="#fff" /><Text style={st.ghostText}>Repetir</Text></Pressable>
        <Pressable onPress={onUse} style={st.useBtn} accessibilityRole="button"><Text style={st.useText}>Usar vídeo</Text><Icon name="check" size={20} color="#fff" strokeWidth={2.6} /></Pressable>
      </View>
    </View>
  );
}
function ReviewVideo({ uri }: { uri: string }) {
  const p = useVideoPlayer(uri, (x) => { x.loop = true; x.play(); });
  return <VideoView player={p} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />;
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  view: { position: 'absolute', overflow: 'hidden', borderRadius: 24, backgroundColor: '#111' },
  band: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  topShade: { position: 'absolute', left: 0, right: 0, top: 0, height: 90, backgroundColor: 'rgba(0,0,0,0.18)' },
  controls: { position: 'absolute', zIndex: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 12 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  roundOn: { backgroundColor: '#fcd34d' },
  wordmark: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: -0.5, textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 6 },
  slash: { position: 'absolute', top: 9, left: -3, height: 2, borderRadius: 1, width: 26, backgroundColor: '#fff', transform: [{ rotate: '-45deg' }] },
  auto: { position: 'absolute', right: -8, bottom: -6, fontSize: 10, fontWeight: '900', color: colors.zinc900 },
  delayBadge: { position: 'absolute', right: -4, bottom: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  delayText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 7 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  recText: { color: '#fff', fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] },
  doneBtn: { position: 'absolute', zIndex: 6, height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.brand, paddingLeft: 16, paddingRight: 8 },
  doneCount: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  zoomBadge: { position: 'absolute', alignSelf: 'center', zIndex: 5, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 6 },
  zoomText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  countWrap: { position: 'absolute', zIndex: 5, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 120, fontWeight: '900', color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 20 },
  shutterWrap: { position: 'absolute', left: 0, right: 0, zIndex: 6, alignItems: 'center' },
  hint: { height: 18, color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', marginBottom: 12, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  shutter: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  shutterRing: { position: 'absolute', left: 0, top: 0, width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: '#fff' },
  shutterIn: { width: 66, height: 66, borderRadius: 33, backgroundColor: '#fff' },
  shutterRec: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#ef4444' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 6, backgroundColor: '#000' },
  galleryThumb: { width: 40, height: 40, borderRadius: 11, borderWidth: 2, borderColor: '#fff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  kinds: { flexGrow: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14, paddingHorizontal: 4 },
  kindText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  kindOn: { color: '#fff' },
  pTitle: { marginTop: 18, color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  pSub: { marginTop: 8, color: 'rgba(255,255,255,0.75)', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  cta: { marginTop: 22, height: 48, borderRadius: 24, paddingHorizontal: 26, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  reviewBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.35)' },
  ghostBtn: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 24, paddingHorizontal: 18, backgroundColor: 'rgba(255,255,255,0.14)' },
  ghostText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  useBtn: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 24, paddingHorizontal: 22, backgroundColor: colors.brand },
  useText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
