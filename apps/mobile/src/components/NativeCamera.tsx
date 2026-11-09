import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Haptics from 'expo-haptics';
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, AppState, BackHandler, Easing, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import {
  Camera, CommonResolutions, useCameraDevice, useCameraPermission, useMicrophonePermission, usePhotoOutput, useVideoOutput,
  type CameraRef, type Constraint, type FlashMode, type Recorder,
} from 'react-native-vision-camera';
import { colors } from '@/lib/theme';
import { GalleryPicker } from './GalleryPicker';
import { Icon } from './Icon';
import { PhotoEditor } from './PhotoEditor';
import type { Shot } from './TxCamera';

const MAX_VIDEO_S = 60;
const HOLD_MS = 350;
const RING = 76;
// Barra da exposição (ao lado do anel de foco): altura total e tamanho do sol.
const EXPO_H = 160;
const SUN = 28;
// O zoom na interface vai até 10× (o resto do zoom digital da câmara só estraga a imagem).
const MAX_UI_ZOOM = 10;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const tap = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
// A VisionCamera devolve caminhos do sistema de ficheiros; o editor (Skia, expo-file-system) e o vídeo querem file://.
const fileUri = (p: string) => (p.startsWith('file://') ? p : `file://${p}`);
// A grelha fica como a pessoa a deixou enquanto a app estiver aberta (sem gravar em disco).
let gridPref = false;

/**
 * Câmara do Txillapp no telemóvel (Android/iPhone), ao estilo da câmara do iPhone e do Instagram. Em cima, só o
 * essencial: fechar à esquerda, flash e opções (temporizador, grelha, só texto) à direita. O visor ocupa o ecrã até aos
 * modos (PUBLICAÇÃO · MIMO · TCHEKA · ZÁS) e, por baixo, a fila do obturador: última foto da galeria, obturador e virar.
 * Tocar no visor foca e mede a luz nesse ponto (anel no sítio do toque, com a barra do sol ao lado para a exposição),
 * dois dedos para o zoom, dois toques para virar, deslizar para a direita abre a galeria. Tocar no obturador = foto
 * (abre o editor), manter premido = vídeo (até 60 s; deslizar para cima aproxima).
 * Por baixo está a react-native-vision-camera (v5): foco e exposição a sério, que o expo-camera não deixava escolher.
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
  const cam = useRef<CameraRef | null>(null);
  const perm = useCameraPermission();
  const mic = useMicrophonePermission();
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  // A lente "normal" de cada lado (no iPhone a grande angular; no Android a principal do CameraX).
  const device = useCameraDevice(facing);
  const [flash, setFlash] = useState<'off' | 'on' | 'auto'>('off');
  const [delay, setDelay] = useState<0 | 3 | 10>(0);
  const [grid, setGrid] = useState(gridPref);
  const [optsOpen, setOptsOpen] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  // Zoom em fator da câmara (1 = sem zoom; no Android pode descer abaixo de 1 se houver ultra grande angular).
  const [zoom, setZoom] = useState(1);
  // Compensação da exposição (0 = a câmara decide; positivo = mais claro).
  const [exposure, setExposure] = useState(0);
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const [review, setReview] = useState<Shot | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  // Miniatura da última foto/vídeo da galeria (só se já houver licença; sem ela mostra-se o ícone).
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  // Focar: anel no ponto do toque (coordenadas do visor); some ao fim de 4 s sem mexer na barra da exposição.
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const ringAnim = useRef(new Animated.Value(0)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;
  const pressAnim = useRef(new Animated.Value(1)).current;
  const hideT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const expoDrag = useRef<{ y: number; v: number } | null>(null);
  // A câmara só trabalha com o ecrã à vista e a app em primeiro plano.
  const screenFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  /** Lê a última foto ou vídeo da galeria para a miniatura (sem pedir licença: isso fica para quando se abre a galeria). */
  async function refreshThumb() {
    try {
      const p = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
      if (!p.granted) { setLastThumb(null); return; }
      const page = await MediaLibrary.getAssetsAsync({
        first: 1,
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });
      setLastThumb(page.assets[0]?.uri ?? null);
    } catch {
      setLastThumb(null);
    }
  }
  // Ao abrir e sempre que se fecha a galeria (a licença pode ter sido dada lá dentro).
  useEffect(() => { if (!galleryOpen) void refreshThumb(); }, [galleryOpen]);

  /** Guarda o vídeo gravado na galeria antes de publicar (tal como saiu da câmara). */
  async function saveVideo(s: Shot) {
    if (savingVideo) return;
    setSavingVideo(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) { Alert.alert('Sem acesso à galeria', 'Dá acesso às fotos nas definições do telemóvel para guardar.'); return; }
      await MediaLibrary.saveToLibraryAsync(s.uri);
      Alert.alert('Guardado', 'O vídeo está na tua galeria.');
      void refreshThumb();
    } catch (e) {
      Alert.alert('Não consegui guardar', (e as Error).message || 'Tenta outra vez.');
    } finally {
      setSavingVideo(false);
    }
  }
  const pendingRecord = useRef(false);
  const recorder = useRef<Recorder | null>(null);
  const stopAsked = useRef(false);
  const holdT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holding = useRef(false);
  const slide = useRef<{ y: number; z: number } | null>(null);
  const recTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const countTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const startedAt = useRef(0);
  const z0 = useRef(1);

  // Saídas da câmara. A câmara trabalha sempre em 16:9 (vertical 9:16); o visor enche o ecrã e a imagem é ampliada para
  // o cobrir. Foto: a maior resolução que a câmara tem em 16:9, JPEG a 100% e com tempo (qualidade acima da velocidade).
  // Vídeo: 1080p em MP4 (também no iPhone, para o `mime` bater certo), com som só se houver licença do microfone.
  const photoOutput = usePhotoOutput({ targetResolution: CommonResolutions.HIGHEST_16_9, containerFormat: 'jpeg', quality: 1, qualityPrioritization: 'quality' });
  const videoOutput = useVideoOutput({ targetResolution: CommonResolutions.FHD_16_9, enableAudio: mic.hasPermission, fileType: 'mp4' });
  // Uma saída de cada vez (como antes): com foto e vídeo juntos, muitos Android baixam a resolução da foto.
  const outputs = useMemo(() => (mode === 'video' ? [videoOutput] : [photoOutput]), [mode, videoOutput, photoOutput]);
  // Estabilização no vídeo: a "standard" se a câmara a tiver, senão a que ela escolher.
  const constraints = useMemo<Constraint[]>(() => {
    if (mode !== 'video' || !device) return [];
    return [{ videoStabilizationMode: device.supportsVideoStabilizationMode('standard') ? 'standard' : 'auto' }];
  }, [mode, device]);

  // Limites do zoom e da exposição da câmara atual (o controlador sabe os reais; o aparelho dá os teóricos).
  const ctrl = cam.current?.controller;
  const minZoom = ctrl?.minZoom ?? device?.minZoom ?? 1;
  const maxZoom = Math.max(minZoom, Math.min(ctrl?.maxZoom ?? device?.maxZoom ?? 1, MAX_UI_ZOOM));
  const neutralZoom = clamp(1, minZoom, maxZoom);
  // O número que se mostra (num iPhone com várias lentes, o fator da câmara não é o que as pessoas conhecem).
  const zoomShown = ctrl && ctrl.zoom > 0 ? zoom * (ctrl.displayableZoomFactor / ctrl.zoom) : zoom;
  const expoOk = !!device?.supportsExposureBias && device.maxExposureBias > device.minExposureBias;
  const expoMin = device?.minExposureBias ?? 0;
  const expoMax = device?.maxExposureBias ?? 0;

  useEffect(() => () => { clearTimeout(holdT.current); clearInterval(recTimer.current); clearInterval(countTimer.current); clearTimeout(hideT.current); }, []);
  // Câmara nova (abrir ou virar): zoom normal e exposição a zero.
  useEffect(() => {
    if (!device) return;
    setZoom(clamp(1, device.minZoom, Math.max(device.minZoom, device.maxZoom)));
    setExposure(0);
  }, [device?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // O microfone pede-se ao abrir a câmara (não a meio de manter o obturador). Sem ele, os vídeos gravam sem som.
  useEffect(() => {
    if (perm.hasPermission && !mic.hasPermission && mic.canRequestPermission) void mic.requestPermission();
  }, [perm.hasPermission, mic.hasPermission]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pára a gravação (se ainda estiver a arrancar, pára logo que arranque). */
  function stopRec() {
    stopAsked.current = true;
    void recorder.current?.stopRecording().catch(() => undefined);
  }

  // Botão de voltar do Android: fecha as opções, sai da pré-visualização, pára a gravação, ou fecha a câmara.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editing || galleryOpen) return false; // o editor e a galeria tratam
      if (optsOpen) { setOptsOpen(false); return true; }
      if (review) { setReview(null); return true; }
      if (recording) { stopRec(); return true; }
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [editing, galleryOpen, optsOpen, review, recording, onClose]);

  /** Esconde o anel e a barra da exposição ao fim de 4 s sem mexer. */
  function armHide() {
    clearTimeout(hideT.current);
    hideT.current = setTimeout(() => setFocus(null), 4000);
  }

  /**
   * Tocar para focar a sério: foco, exposição e equilíbrio de brancos medidos no ponto tocado (`focusTo` da VisionCamera,
   * em coordenadas da pré-visualização). O foco fica a seguir esse ponto até ao próximo toque ou até virar a câmara.
   * A exposição volta a zero em cada toque novo (a luz mede-se de novo); a barra do sol ao lado do anel ajusta-a.
   */
  function focusAt(x: number, y: number) {
    if (optsOpen) { setOptsOpen(false); return; }
    setFocus({ x, y });
    ringAnim.stopAnimation();
    ringAnim.setValue(0);
    Animated.sequence([
      Animated.timing(ringAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(ringAnim, { toValue: 2, duration: 260, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished && !expoOk) setFocus(null); });
    if (expoOk) armHide();
    else clearTimeout(hideT.current);
    if (exposure !== 0) setExposure(0);
    // O visor corta a imagem da câmara (que é maior): passa-se o ponto para as coordenadas da pré-visualização.
    const px = x - (view.w - camW) / 2;
    const py = y - (view.h - camH) / 2;
    cam.current?.focusTo({ x: px, y: py }, { responsiveness: 'snappy', adaptiveness: 'continuous', autoResetAfter: null }).catch(() => undefined);
  }

  // Barra da exposição: arrastar para cima clareia, para baixo escurece (dentro dos limites da câmara).
  function expoStart(e: GestureResponderEvent) {
    clearTimeout(hideT.current);
    expoDrag.current = { y: e.nativeEvent.pageY, v: exposure };
  }
  function expoMove(e: GestureResponderEvent) {
    const d = expoDrag.current;
    if (!d) return;
    let v = clamp(d.v + ((d.y - e.nativeEvent.pageY) / (EXPO_H - SUN)) * (expoMax - expoMin), expoMin, expoMax);
    // No Android a compensação vai em degraus inteiros (índice do CameraX).
    if (Platform.OS === 'android') v = Math.round(v);
    if (v !== exposure) {
      if ((exposure < 0 && v >= 0) || (exposure > 0 && v <= 0)) tap(); // um toque leve ao passar pelo zero
      setExposure(v);
    }
  }
  function expoEnd() {
    expoDrag.current = null;
    armHide();
  }

  // Gestos no visor: um toque = focar; dois dedos = zoom; dois toques = virar a câmara.
  const pinch = usePinchGesture({
    runOnJS: true,
    onBegin: () => { z0.current = zoom; },
    onUpdate: (e) => setZoom(clamp(z0.current * e.scale, minZoom, maxZoom)),
  });
  const doubleTap = useTapGesture({ numberOfTaps: 2, runOnJS: true, onActivate: () => { if (!recording) flip(); } });
  // O toque simples espera que o duplo falhe (senão cada "virar" focava antes).
  const singleTap = useTapGesture({ numberOfTaps: 1, runOnJS: true, requireToFail: doubleTap, onActivate: (e) => focusAt(e.x, e.y) });
  // Deslizar para a direita no visor abre a galeria (como no Instagram).
  const swipe = usePanGesture({
    runOnJS: true,
    maxPointers: 1,
    activeOffsetX: 30,
    failOffsetY: [-40, 40],
    onDeactivate: (e) => { if (!recording && e.translationX > 80) setGalleryOpen(true); },
  });
  const gestures = useSimultaneousGestures(pinch, doubleTap, singleTap, swipe);

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
    setFocus(null);
    clearTimeout(hideT.current);
    setExposure(0);
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
  }

  /** Clarão branco rápido no visor, como o "clique" da câmara do iPhone. */
  function shutterFlash() {
    flashAnim.stopAnimation();
    flashAnim.setValue(0.85);
    Animated.timing(flashAnim, { toValue: 0, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }

  async function takePhoto() {
    if (busy || !ready || mode !== 'picture') return;
    setBusy(true);
    shutterFlash();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      // Flash só se a câmara o tiver (a da frente normalmente não tem, e pedir 'on' sem flash dá erro).
      const flashMode: FlashMode = device?.hasFlash ? flash : 'off';
      const photo = await photoOutput.capturePhoto({ flashMode }, {});
      try {
        // A VisionCamera só marca a rotação no EXIF; o `toImageAsync` aplica a rotação e o espelho de verdade, para o
        // editor receber a foto já direita. Guarda-se outra vez em JPEG a 100.
        const img = await photo.toImageAsync();
        try {
          const path = await img.saveToTemporaryFileAsync('jpg', 100);
          setEditing(fileUri(path));
        } finally {
          img.dispose();
        }
      } finally {
        photo.dispose();
      }
    } catch {
      /* a câmara falhou a meio: fica no visor */
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    // Só uma vez por pedido (avisa a câmara e o tempo limite: o primeiro que chegar).
    if (!pendingRecord.current) return;
    pendingRecord.current = false;
    // Largou o dedo enquanto a câmara mudava para vídeo: não grava.
    if (!holding.current) { setMode('picture'); return; }
    let rec: Recorder;
    try {
      rec = await videoOutput.createRecorder({ maxDuration: MAX_VIDEO_S });
    } catch {
      holding.current = false;
      setMode('picture');
      return;
    }
    // Largou o dedo enquanto o gravador se preparava.
    if (!holding.current) { void rec.cancelRecording().catch(() => undefined); setMode('picture'); return; }
    recorder.current = rec;
    stopAsked.current = false;
    setRecording(true);
    setOptsOpen(false);
    startedAt.current = Date.now();
    setRecMs(0);
    recTimer.current = setInterval(() => setRecMs(Date.now() - startedAt.current), 100);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      // Acaba quando se pára ou chega aos 60 s; se pediram para parar enquanto arrancava, pára logo que arranque.
      const path = await new Promise<string>((resolve, reject) => {
        rec.startRecording((p) => resolve(p), (err) => reject(err)).then(() => {
          if (stopAsked.current) void rec.stopRecording().catch(() => undefined);
        }, reject);
      });
      const durationMs = Date.now() - startedAt.current;
      if (path && durationMs > 400) setReview({ uri: fileUri(path), video: true, mime: 'video/mp4', durationMs });
    } catch {
      /* gravação interrompida */
    } finally {
      recorder.current = null;
      stopAsked.current = false;
      clearInterval(recTimer.current);
      setRecording(false);
      setRecMs(0);
      holding.current = false;
      setMode('picture');
    }
  }

  // O modo vídeo só fica pronto depois de a câmara se reconfigurar: começa a gravar quando ela avisa (ou ao fim de 1,5 s).
  // (`onConfigured` da VisionCamera: chamado sempre que a sessão fica montada com a câmara e as saídas novas.)
  function onReady() {
    setReady(true);
    if (pendingRecord.current && mode === 'video') void startRecording();
  }
  useEffect(() => {
    if (mode !== 'video' || !pendingRecord.current) return;
    const t = setTimeout(() => { if (pendingRecord.current) void startRecording(); }, 1500);
    return () => clearTimeout(t);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const press = (to: number) => Animated.spring(pressAnim, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  // Obturador: tocar = foto (com o temporizador, se houver); manter = vídeo; a gravar, deslizar para cima aproxima.
  function shutterStart(e: GestureResponderEvent) {
    holding.current = false;
    if (!ready || busy || countdown !== null || recording) return;
    setOptsOpen(false);
    press(0.9);
    slide.current = { y: e.nativeEvent.pageY, z: zoom };
    holdT.current = setTimeout(() => {
      holding.current = true;
      // Sem licença para o microfone, pede-a agora (o pedido do sistema interrompe o toque: grava-se ao voltar a manter).
      if (!mic.hasPermission && mic.canRequestPermission) { void mic.requestPermission(); holding.current = false; return; }
      pendingRecord.current = true;
      setMode('video');
    }, HOLD_MS);
  }
  function shutterMove(e: GestureResponderEvent) {
    const sl = slide.current;
    if (!sl || !holding.current) return;
    // Cada 120 pt para cima duplica o zoom.
    setZoom(clamp(sl.z * Math.pow(2, (sl.y - e.nativeEvent.pageY) / 120), minZoom, maxZoom));
  }
  function shutterEnd() {
    clearTimeout(holdT.current);
    press(1);
    slide.current = null;
    if (holding.current) {
      holding.current = false;
      if (pendingRecord.current) { pendingRecord.current = false; setMode('picture'); return; } // largou antes de começar
      stopRec();
      return;
    }
    if (countdown !== null) { clearInterval(countTimer.current); setCountdown(null); return; }
    if (recording) { stopRec(); return; }
    if (!delay) return void takePhoto();
    let n: number = delay;
    setCountdown(n);
    countTimer.current = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(countTimer.current); setCountdown(null); void takePhoto(); } else { setCountdown(n); tap(); }
    }, 1000);
  }

  // Medidas: o visor do topo até aos modos (cantos arredondados); por baixo, os modos e a fila do obturador.
  const modesH = kinds ? 44 : 10;
  const rowH = 104;
  const bottomPad = Math.max(insets.bottom, 10);
  const top = insets.top + 4;
  const view = { x: 0, y: top, w: area.w, h: Math.max(0, area.h - top - modesH - rowH - bottomPad) };
  // A imagem da câmara (9:16) cobre o visor: ampliada até encher, cortando o que sobra dos lados (ou de cima e baixo).
  const k = Math.max(view.w / 9, view.h / 16);
  const camW = 9 * k, camH = 16 * k;
  // A parte da foto que fica (para a publicação 4:5): escurece-se o resto, sem molduras.
  const capH = Math.min(view.h, view.w / aspect);
  const band = Math.max(0, (view.h - capH) / 2);
  const mm = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const flashLabel = flash === 'off' ? 'desligado' : flash === 'on' ? 'ligado' : 'automático';
  // A câmara desliga-se enquanto o editor, a galeria ou a revisão do vídeo estão por cima, com o ecrã fora de vista ou
  // com a app em segundo plano: poupa bateria e larga a câmara para outras apps.
  const camActive = !editing && !galleryOpen && !review && screenFocused && appActive;
  // Barra da exposição: à direita do anel (ou à esquerda, se não couber), centrada na altura do toque.
  const expoLeft = focus ? (focus.x + RING / 2 + 8 + 40 <= view.w ? focus.x + RING / 2 + 8 : focus.x - RING / 2 - 8 - 40) : 0;
  const expoTop = focus ? clamp(focus.y - EXPO_H / 2, 8, Math.max(8, view.h - EXPO_H - 8)) : 0;
  const expoT = expoOk ? clamp((exposure - expoMin) / (expoMax - expoMin), 0, 1) : 0.5;
  const sunY = (1 - expoT) * (EXPO_H - SUN);

  if (!perm.hasPermission) {
    return (
      <View style={[st.root, st.center, { paddingHorizontal: 32 }]}>
        <Pressable onPress={onClose} style={[st.round, { position: 'absolute', top: insets.top + 10, left: 12 }]} accessibilityRole="button" accessibilityLabel="Fechar câmara"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        <Icon name="camera" size={52} color="rgba(255,255,255,0.8)" />
        <Text style={st.pTitle}>A câmara do Txillapp</Text>
        <Text style={st.pSub}>{perm.canRequestPermission ? 'Dá acesso à câmara para tirar fotos e gravar vídeos aqui mesmo.' : 'A câmara está bloqueada. Ativa-a nas definições do telemóvel.'}</Text>
        <Pressable onPress={() => void (perm.canRequestPermission ? perm.requestPermission() : Linking.openSettings())} style={st.cta} accessibilityRole="button">
          <Text style={st.ctaText}>{perm.canRequestPermission ? 'Permitir a câmara' : 'Abrir as definições'}</Text>
        </Pressable>
        <Pressable onPress={() => setGalleryOpen(true)} style={{ marginTop: 14, padding: 10 }} accessibilityRole="button"><Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Escolher da galeria</Text></Pressable>
        {galleryOpen ? <GalleryPicker title={galleryTitle} multi={multi} onPick={picked} onCamera={() => setGalleryOpen(false)} onClose={() => setGalleryOpen(false)} /> : null}
        {editing ? (
          <PhotoEditor uri={editing} aspect={aspect} onCancel={() => setEditing(null)} onDone={(file) => { setEditing(null); onShot({ uri: file, video: false, mime: 'image/jpeg' }); }} />
        ) : null}
      </View>
    );
  }

  const ringScale = ringAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [1.45, 1, 0.96] });
  // Com a barra da exposição, o anel fica meio apagado em vez de desaparecer (some com ela, ao fim de 4 s).
  const ringOpacity = ringAnim.interpolate({ inputRange: [0, 0.4, 1, 2], outputRange: [0, 1, 1, expoOk ? 0.6 : 0] });

  return (
    <View style={st.root} onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {area.w > 0 ? (
        <>
          {/* Visor: só quando já se sabe o tamanho. Limpo: a imagem, a grelha (se ligada) e o anel de foco. */}
          <GestureDetector gesture={gestures}>
            <View style={[st.view, { left: view.x, top: view.y, width: view.w, height: view.h }]} collapsable={false}>
              {device ? (
                <Camera
                  ref={cam}
                  style={{ position: 'absolute', left: (view.w - camW) / 2, top: (view.h - camH) / 2, width: camW, height: camH }}
                  resizeMode="cover"
                  device={device}
                  outputs={outputs}
                  constraints={constraints}
                  isActive={camActive}
                  // A câmara da frente sai espelhada (como num espelho), a de trás não.
                  mirrorMode="auto"
                  zoom={zoom}
                  exposure={expoOk ? exposure : undefined}
                  // A gravar com o flash ligado, a luz fica acesa (só onde há lanterna, normalmente a câmara de trás).
                  torchMode={recording && flash === 'on' && device.hasTorch ? 'on' : 'off'}
                  // No iPhone, sem isto a câmara cala as vibrações do obturador enquanto está ligada.
                  allowHapticsAndSystemSoundsPlayback
                  onConfigured={onReady}
                  onError={() => undefined}
                />
              ) : null}
              {band > 1 && !recording ? (
                <>
                  <View pointerEvents="none" style={[st.band, { top: 0, height: band }]} />
                  <View pointerEvents="none" style={[st.band, { bottom: 0, height: band }]} />
                </>
              ) : null}
              {/* Grelha dos terços, só na parte da foto que fica. */}
              {grid ? (
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: recording ? 0 : band, bottom: recording ? 0 : band }}>
                  <View style={[st.gridV, { left: '33.33%' }]} />
                  <View style={[st.gridV, { left: '66.66%' }]} />
                  <View style={[st.gridH, { top: '33.33%' }]} />
                  <View style={[st.gridH, { top: '66.66%' }]} />
                </View>
              ) : null}
              {/* Sombra suave em cima, para os botões se lerem em qualquer cena. */}
              <View pointerEvents="none" style={st.topShade} />
              {focus ? (
                <Animated.View pointerEvents="none" style={[st.focusRing, { left: focus.x - RING / 2, top: focus.y - RING / 2, opacity: ringOpacity, transform: [{ scale: ringScale }] }]}>
                  <View style={st.focusDot} />
                </Animated.View>
              ) : null}
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flashAnim }]} />
            </View>
          </GestureDetector>

          {/* Exposição: o sol ao lado do anel; arrastar para cima clareia, para baixo escurece. Fica fora do visor para os
              gestos dele (toque, deslizar) não apanharem o arrasto. */}
          {focus && expoOk && !recording ? (
            <View
              style={[st.expo, { left: view.x + expoLeft, top: view.y + expoTop }]}
              onTouchStart={expoStart}
              onTouchMove={expoMove}
              onTouchEnd={expoEnd}
              onTouchCancel={expoEnd}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Exposição"
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={(ev) => {
                const step = Platform.OS === 'android' ? 1 : (expoMax - expoMin) / 10;
                setExposure((v) => clamp(v + (ev.nativeEvent.actionName === 'increment' ? step : -step), expoMin, expoMax));
                armHide();
              }}
            >
              {sunY > 6 ? <View pointerEvents="none" style={[st.expoLine, { top: 0, height: sunY - 4 }]} /> : null}
              {EXPO_H - SUN - sunY > 6 ? <View pointerEvents="none" style={[st.expoLine, { top: sunY + SUN + 4, bottom: 0 }]} /> : null}
              <View pointerEvents="none" style={[st.sun, { top: sunY }]}><Icon name="sun" size={22} color="#fcd34d" strokeWidth={2.2} /></View>
            </View>
          ) : null}

          {/* Barra de cima: fechar à esquerda; flash e opções à direita (a gravar, só o tempo). */}
          <View style={[st.controls, { left: view.x, top: view.y, width: view.w }]} pointerEvents="box-none">
            <Pressable onPress={onClose} style={st.round} accessibilityRole="button" accessibilityLabel="Fechar câmara" hitSlop={6}><Icon name="x" size={22} color="#fff" strokeWidth={2.2} /></Pressable>
            {recording ? (
              <View style={st.rec}><View style={st.recDot} /><Text style={st.recText}>{mm(recMs)}{!mic.hasPermission ? ' · sem som' : ''}</Text></View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, minWidth: 40, justifyContent: 'flex-end' }}>
              {!recording && (
                <>
                  <Pressable onPress={() => { tap(); setFlash((f) => (f === 'off' ? 'on' : f === 'on' ? 'auto' : 'off')); }} style={[st.round, flash !== 'off' && st.roundOn]} accessibilityRole="button" accessibilityLabel={`Flash: ${flashLabel}`} hitSlop={6}>
                    <View>
                      <Icon name="bolt" size={20} solid={flash !== 'off'} color={flash !== 'off' ? colors.zinc900 : '#fff'} />
                      {flash === 'off' && <View pointerEvents="none" style={st.slash} />}
                      {flash === 'auto' && <Text style={st.auto}>A</Text>}
                    </View>
                  </Pressable>
                  <Pressable onPress={() => { tap(); setOptsOpen((o) => !o); }} style={[st.round, optsOpen && st.roundLight]} accessibilityRole="button" accessibilityLabel="Opções da câmara" accessibilityState={{ expanded: optsOpen }} hitSlop={6}>
                    <Icon name="sliders" size={20} color={optsOpen ? colors.zinc900 : '#fff'} />
                    {delay > 0 && <View style={st.delayBadge}><Text style={st.delayText}>{delay}</Text></View>}
                  </Pressable>
                </>
              )}
            </View>
          </View>

          {/* Opções: temporizador, grelha e só texto (fecha ao tocar fora). */}
          {optsOpen && !recording ? (
            <>
              <Pressable style={[StyleSheet.absoluteFill, { zIndex: 7 }]} onPress={() => setOptsOpen(false)} accessibilityLabel="Fechar opções" />
              <View style={[st.opts, { top: view.y + 62, right: 12 }]}>
                <OptRow icon="clock" label="Temporizador" value={delay ? `${delay} s` : 'Tempo'} on={delay > 0}
                  onPress={() => { tap(); setDelay((d) => (d === 0 ? 3 : d === 3 ? 10 : 0)); }} />
                <OptRow icon="grid" label="Grelha" value="Grelha" on={grid}
                  onPress={() => { tap(); setGrid((g) => { gridPref = !g; return !g; }); }} />
                {onText ? (
                  <Pressable onPress={() => { setOptsOpen(false); onText(); }} style={st.optRow} accessibilityRole="button" accessibilityLabel="Só texto">
                    <View style={st.optIcon}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Aa</Text></View>
                    <Text style={st.optValue}>Texto</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}

          {/* Em baixo no visor: zoom e exposição (toca para repor) e a dica nas primeiras vezes. */}
          <View pointerEvents="box-none" style={[st.viewFoot, { top: view.y + view.h - 78, left: view.x, width: view.w }]}>
            <View pointerEvents="box-none" style={{ flexDirection: 'row', gap: 8, height: 30 }}>
              {/* Exposição mexida e barra escondida: um sol pequeno lembra-o (toca para repor). */}
              {exposure !== 0 && !focus ? (
                <Pressable onPress={() => { tap(); setExposure(0); }} style={st.zoomBadge} accessibilityRole="button" accessibilityLabel="Repor exposição">
                  <Icon name="sun" size={16} color="#fcd34d" strokeWidth={2.2} />
                </Pressable>
              ) : null}
              {Math.abs(zoom - neutralZoom) > 0.04 ? (
                <Pressable onPress={() => { tap(); setZoom(neutralZoom); }} style={st.zoomBadge} accessibilityRole="button" accessibilityLabel="Repor zoom"><Text style={st.zoomText}>{zoomShown.toFixed(1)}×</Text></Pressable>
              ) : null}
            </View>
            {!recording && count === 0 ? <Text style={st.hint}>Toca para foto · mantém para vídeo</Text> : <View style={{ height: 18 }} />}
          </View>
          {countdown !== null ? <View pointerEvents="none" style={[st.countWrap, { left: view.x, top: view.y, width: view.w, height: view.h }]}><Text style={st.countText}>{countdown}</Text></View> : null}

          {/* Com fotos juntas: Seguinte (no canto do visor, por cima dos modos). */}
          {!recording && count > 0 && onDone ? (
            <Pressable onPress={onDone} style={[st.doneBtn, { top: view.y + view.h - 58, right: 14 }]} accessibilityRole="button" accessibilityLabel={`${doneLabel}, ${count}`}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{doneLabel}</Text>
              <View style={st.doneCount}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{count}</Text></View>
            </Pressable>
          ) : null}

          {/* Modos, logo por baixo do visor. */}
          <View style={[st.modes, { top: view.y + view.h, height: modesH }]}>
            {kinds && !recording ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.kinds} style={{ flex: 1 }}>
                {kinds.map((k) => (
                  <Pressable key={k.id} onPress={() => { if (kind !== k.id) tap(); onKind?.(k.id); }} style={st.kindPill} accessibilityRole="tab" accessibilityState={{ selected: kind === k.id }} hitSlop={6}>
                    <Text style={[st.kindText, kind === k.id && st.kindOn]}>{k.label.toUpperCase()}</Text>
                    <View style={[st.kindDot, kind !== k.id && { opacity: 0 }]} />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>

          {/* Fila do obturador: última foto da galeria · obturador · virar câmara. */}
          <View style={[st.row, { top: view.y + view.h + modesH, height: rowH }]}>
            <View style={st.side}>
              {!recording && (
                <Pressable onPress={() => { tap(); setGalleryOpen(true); }} style={st.galleryThumb} accessibilityRole="button" accessibilityLabel="Abrir a galeria" hitSlop={6}>
                  {lastThumb ? <Image source={{ uri: lastThumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} /> : <Icon name="images" size={22} color="#fff" strokeWidth={2} />}
                </Pressable>
              )}
            </View>
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
              <Animated.View style={[st.shutterIn, recording && st.shutterRec, !recording && { transform: [{ scale: pressAnim }] }]} />
            </View>
            <View style={[st.side, { alignItems: 'flex-end' }]}>
              {!recording && <Pressable onPress={flip} style={st.flipBtn} accessibilityRole="button" accessibilityLabel="Virar câmara" hitSlop={6}><Icon name="flip-camera" size={24} color="#fff" /></Pressable>}
            </View>
          </View>
        </>
      ) : null}

      {editing ? (
        <PhotoEditor
          uri={editing}
          aspect={aspect}
          onCancel={() => setEditing(null)}
          onDone={(file) => { setEditing(null); onShot({ uri: file, video: false, mime: 'image/jpeg' }); }}
        />
      ) : null}
      {galleryOpen ? <GalleryPicker title={galleryTitle} multi={multi} onPick={picked} onCamera={() => setGalleryOpen(false)} onClose={() => setGalleryOpen(false)} /> : null}
      {review ? <Review shot={review} onRetake={() => setReview(null)} onSave={() => void saveVideo(review)} onUse={() => { const s = review; setReview(null); onShot(s); }} /> : null}
    </View>
  );
}

/** Uma linha das opções: ícone, nome e o valor atual (toca para mudar). */
function OptRow({ icon, label, value, on, onPress }: { icon: 'clock' | 'grid'; label: string; value: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={st.optRow} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>
      <View style={[st.optIcon, on && { backgroundColor: '#fff' }]}><Icon name={icon} size={18} color={on ? colors.zinc900 : '#fff'} /></View>
      <Text style={[st.optValue, on && { color: '#fff' }]} numberOfLines={1}>{value}</Text>
    </Pressable>
  );
}

/** Depois de gravar: ver o vídeo, repetir ou usar. */
function Review({ shot, onRetake, onSave, onUse }: { shot: Shot; onRetake: () => void; onSave: () => void; onUse: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 20 }]}>
      <ReviewVideo uri={shot.uri} />
      <View style={[st.reviewBar, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <Pressable onPress={onRetake} style={st.ghostBtn} accessibilityRole="button"><Icon name="undo" size={20} color="#fff" /><Text style={st.ghostText}>Repetir</Text></Pressable>
        <Pressable onPress={onSave} style={[st.ghostBtn, { paddingHorizontal: 14 }]} accessibilityRole="button" accessibilityLabel="Guardar na galeria"><Icon name="download" size={20} color="#fff" /></Pressable>
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
  view: { position: 'absolute', overflow: 'hidden', borderRadius: 22, backgroundColor: '#111' },
  band: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  topShade: { position: 'absolute', left: 0, right: 0, top: 0, height: 80, backgroundColor: 'rgba(0,0,0,0.14)' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.45)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.45)' },
  focusRing: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: 1.5, borderColor: '#fcd34d', alignItems: 'center', justifyContent: 'center' },
  focusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fcd34d' },
  // Área de toque larga (40 pt) à volta da linha fina; o fundo quase invisível faz dela alvo de toque no Android.
  expo: { position: 'absolute', zIndex: 6, width: 40, height: EXPO_H, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.001)' },
  expoLine: { position: 'absolute', width: 1.5, borderRadius: 1, backgroundColor: 'rgba(252,211,77,0.85)' },
  sun: { position: 'absolute', width: SUN, height: SUN, alignItems: 'center', justifyContent: 'center' },
  controls: { position: 'absolute', zIndex: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 12 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center' },
  roundOn: { backgroundColor: '#fcd34d' },
  roundLight: { backgroundColor: '#fff' },
  slash: { position: 'absolute', top: 9, left: -3, height: 2, borderRadius: 1, width: 26, backgroundColor: '#fff', transform: [{ rotate: '-45deg' }] },
  auto: { position: 'absolute', right: -8, bottom: -6, fontSize: 10, fontWeight: '900', color: colors.zinc900 },
  delayBadge: { position: 'absolute', right: -4, bottom: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  delayText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  opts: { position: 'absolute', zIndex: 8, flexDirection: 'row', gap: 2, borderRadius: 22, paddingVertical: 8, paddingHorizontal: 6, backgroundColor: 'rgba(24,24,27,0.9)' },
  optRow: { width: 62, alignItems: 'center', gap: 5 },
  optIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  optLabel: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
  optValue: { color: 'rgba(255,255,255,0.72)', fontSize: 11, fontWeight: '700' },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 7 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  recText: { color: '#fff', fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] },
  doneBtn: { position: 'absolute', zIndex: 6, height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.brand, paddingLeft: 16, paddingRight: 8 },
  doneCount: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  viewFoot: { position: 'absolute', zIndex: 5, alignItems: 'center', gap: 12 },
  zoomBadge: { height: 30, minWidth: 44, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  zoomText: { color: '#fcd34d', fontSize: 13, fontWeight: '800' },
  countWrap: { position: 'absolute', zIndex: 5, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 120, fontWeight: '900', color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 20 },
  hint: { height: 18, color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  modes: { position: 'absolute', left: 0, right: 0, zIndex: 4, justifyContent: 'center' },
  kinds: { flexGrow: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingHorizontal: 12 },
  kindPill: { paddingHorizontal: 12, paddingVertical: 4, alignItems: 'center', gap: 4 },
  kindDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.brand },
  kindText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  kindOn: { color: '#fff' },
  row: { position: 'absolute', left: 0, right: 0, zIndex: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28 },
  side: { width: 52 },
  galleryThumb: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  flipBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  shutterRing: { position: 'absolute', left: 0, top: 0, width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: '#fff' },
  shutterIn: { width: 66, height: 66, borderRadius: 33, backgroundColor: '#fff' },
  shutterRec: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#ef4444' },
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
