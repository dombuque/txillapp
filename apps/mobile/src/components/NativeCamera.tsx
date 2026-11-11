import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Haptics from 'expo-haptics';
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Animated, AppState, BackHandler, Easing, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, useLongPressGesture, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import {
  Camera, CommonResolutions, useCameraDevice, useCameraPermission, useMicrophonePermission, usePhotoOutput, useVideoOutput,
  type CameraRef, type Constraint, type DeviceFilter, type InterruptionReason, type Recorder,
} from 'react-native-vision-camera';
import {
  activeStop, cameraProblem, createValueStore, crossedStop, crossedZero, displayMultiplier, exposureBarOrigin, exposureFromDrag,
  exposureRange, exposureStep, flashA11y, focusBoxOrigin, formatStop, formatZoom, isLowLight, isMinorCameraError, maxDisplayZoom,
  meteringModes, needsScreenFlash, nextFlash, permissionView, photoFlashMode, photoPriority, pickStabilization, pickVideoFps,
  pinchZoom, previewPoint, recTime, slideZoom, sunOffset, torchFor, zoomA11y, zoomAnimationArg, zoomStops,
  type CamPlatform, type CamProblem, type ExposureRange, type FlashChoice, type LensInfo, type ValueStore,
} from '@/lib/cameraControls';
import { colors } from '@/lib/theme';
import { GalleryPicker } from './GalleryPicker';
import { Icon } from './Icon';
import { PhotoEditor } from './PhotoEditor';
import type { Shot } from './TxCamera';

const IOS = Platform.OS === 'ios';
const PLATFORM: CamPlatform = IOS ? 'ios' : 'android';
const MAX_VIDEO_S = 60;
const HOLD_MS = 350;
// Manter o dedo no visor este tempo bloqueia o foco e a exposição (AE/AF), como no iPhone.
const LOCK_MS = 600;
// Quadrado de foco e barra da exposição (ao lado do quadrado): altura, largura (área de toque) e tamanho do sol.
const BOX = 76;
const EXPO_H = 160;
const EXPO_W = 44;
const SUN = 28;
// Quantos pt de arrasto percorrem a exposição toda (de -2 EV a +2 EV no iPhone).
const EXPO_TRAVEL = 220;
// No iPhone de trás pede-se a câmara virtual com todas as lentes: o zoom passa de uma lente para outra sem saltar
// (0,5× → 1× → 3×), tal como na câmara do iPhone. No Android a câmara lógica do CameraX (a de defeito) já faz isso.
const BACK_LENSES: DeviceFilter = { physicalDevices: ['ultra-wide-angle', 'wide-angle', 'telephoto'] };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const tap = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
const tick = () => void Haptics.selectionAsync().catch(() => undefined);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Lê uma propriedade nativa sem rebentar (os objetos da câmara podem já ter sido largados). */
function safe<T>(f: () => T): T | undefined {
  try { return f(); } catch { return undefined; }
}
// A VisionCamera devolve caminhos do sistema de ficheiros; o editor (Skia, expo-file-system) e o vídeo querem file://.
const fileUri = (p: string) => (p.startsWith('file://') ? p : `file://${p}`);
// A grelha fica como a pessoa a deixou enquanto a app estiver aberta (sem gravar em disco).
let gridPref = false;

/**
 * Câmara do Txillapp no telemóvel (Android/iPhone), ao estilo da câmara do iPhone e do Instagram. Em cima, só o
 * essencial: fechar à esquerda, flash e opções (temporizador, grelha, só texto) à direita. O visor ocupa o ecrã até aos
 * modos (PUBLICAÇÃO · MIMO · TCHEKA · ZÁS) e, por baixo, a fila do obturador: última foto da galeria, obturador e virar.
 *
 * - Lentes: pílulas 0,5× · 1× · 2×/3× (as que o telemóvel tem) que trocam de lente com o zoom animado; a pinça amplia
 *   suavemente e a pílula acesa mostra o valor ("1,6×"); um toque leve ao passar por cada lente.
 * - Foco: tocar foca e mede a luz nesse ponto (quadrado amarelo); manter o dedo bloqueia (AE/AF BLOQUEADO); arrastar
 *   para cima ou para baixo (no visor ou na barra do sol) clareia ou escurece.
 * - Flash: automático / ligado / desligado; na frontal sem flash, o ecrã acende-se em branco; a gravar, a lanterna.
 * - Obturador: tocar = foto (abre o editor), manter = vídeo (até 60 s; deslizar para cima aproxima). Dois toques no
 *   visor viram a câmara, deslizar para a direita abre a galeria.
 * A lógica pura (lentes, zoom, foco, exposição, flash, mensagens) está em lib/cameraControls.ts, com testes.
 * Por baixo está a react-native-vision-camera (v5).
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
  const [refused, setRefused] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const device = useCameraDevice(facing, facing === 'back' && IOS ? BACK_LENSES : undefined);
  const [flash, setFlash] = useState<FlashChoice>('off');
  const [delay, setDelay] = useState<0 | 3 | 10>(0);
  const [grid, setGrid] = useState(gridPref);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const [lowLightRec, setLowLightRec] = useState(false);
  const [busy, setBusy] = useState(false);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const [review, setReview] = useState<Shot | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  // Miniatura da última foto/vídeo da galeria (só se já houver licença; sem ela mostra-se o ícone).
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  // Problemas da câmara (ocupada, quente, erro) e a chave para a montar de novo ("Tentar outra vez").
  const [problem, setProblem] = useState<CamProblem | null>(null);
  const [camKey, setCamKey] = useState(0);
  const [noDevice, setNoDevice] = useState(false);
  // Sobe a cada configuração nova da câmara: o controlador novo só existe depois de o ecrã se redesenhar.
  const [cfgTick, setCfgTick] = useState(0);
  // O que o controlador diz da câmara atual (os limites reais do zoom e o rácio do zoom mostrado).
  const [ctrlInfo, setCtrlInfo] = useState<{ id: string; min: number; max: number; ratio: number } | null>(null);
  // Focar: quadrado no ponto do toque (coordenadas do visor); some ao fim de 4 s sem mexer na exposição.
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const [aeLocked, setAeLocked] = useState(false);
  const boxAnim = useRef(new Animated.Value(0)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;
  const screenAnim = useRef(new Animated.Value(0)).current;
  const pressAnim = useRef(new Animated.Value(1)).current;
  const rotAnim = useRef(new Animated.Value(0)).current;
  const hideT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const errT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const expoDrag = useRef<{ y: number; v: number } | null>(null);
  const expoPanOn = useRef(false);
  const lastFocus = useRef<{ x: number; y: number; locked: boolean } | null>(null);
  const running = useRef(false);
  // A câmara só trabalha com o ecrã à vista e a app em primeiro plano.
  const screenFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  // ——— Lentes e zoom ———
  const lens = useMemo(() => {
    if (!device) return null;
    const hasUltraWide = !!safe(() => device.physicalDevices.some((d) => d.type === 'ultra-wide-angle'));
    const switchFactors = safe(() => [...device.zoomLensSwitchFactors]) ?? [];
    return { id: device.id, hasUltraWide, switchFactors, back: device.position === 'back', minZoom: device.minZoom, maxZoom: device.maxZoom };
  }, [device]);
  const info: LensInfo = {
    platform: PLATFORM,
    minZoom: (ctrlInfo?.id === lens?.id ? ctrlInfo?.min : undefined) ?? lens?.minZoom ?? 1,
    maxZoom: (ctrlInfo?.id === lens?.id ? ctrlInfo?.max : undefined) ?? lens?.maxZoom ?? 1,
    switchFactors: lens?.switchFactors ?? [],
    hasUltraWide: !!lens?.hasUltraWide,
    back: !!lens?.back,
    ctrlRatio: ctrlInfo?.id === lens?.id ? ctrlInfo?.ratio : undefined,
  };
  const mult = displayMultiplier(info);
  const minZoom = info.minZoom;
  const maxZoom = Math.max(minZoom, Math.min(info.maxZoom, maxDisplayZoom(info, mult) / mult));
  const stops = useMemo(() => zoomStops(info, mult), [info.minZoom, info.maxZoom, info.back, info.hasUltraWide, info.switchFactors.join(), mult]); // eslint-disable-line react-hooks/exhaustive-deps
  // O 1× (a lente principal) em unidades do aparelho.
  const neutralZoom = clamp(1 / mult, minZoom, maxZoom);
  // Zoom "assente" (vai para a prop `zoom` da câmara); a pinça e as pílulas mexem no controlador diretamente
  // (`zoomLive`) e só assentam no fim, para a câmara inteira não se redesenhar a cada movimento dos dedos.
  const [zoomC, setZoomC] = useState<{ id: string; z: number } | null>(null);
  const zoom = device && zoomC?.id === device.id ? zoomC.z : neutralZoom;
  const zoomLive = useRef(zoom);
  const zoomOp = useRef(0);
  const zoomStore = useRef(createValueStore(1)).current as ValueStore<number>;
  const z0 = useRef(1);

  // ——— Exposição ———
  const expoR: ExposureRange | null = device?.supportsExposureBias ? exposureRange(PLATFORM, device.minExposureBias, device.maxExposureBias) : null;
  const expoOk = !!expoR;
  // Compensação da exposição assente (0 = a câmara decide; positivo = mais claro) e a que se vê enquanto se arrasta.
  const [exposure, setExposure] = useState(0);
  const expoLive = useRef(0);
  const expoStore = useRef(createValueStore(0)).current as ValueStore<number>;

  const recordingRef = useRef(false);
  recordingRef.current = recording;
  const focusRef = useRef(focus);
  focusRef.current = focus;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setAppActive(s === 'active');
      if (s !== 'active') {
        // Para segundo plano: a gravação fecha-se (o vídeo fica e aparece ao voltar) e o temporizador cancela-se.
        if (recordingRef.current) stopRec();
        clearInterval(countTimer.current);
        setCountdown(null);
      }
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      const p = await MediaLibrary.requestPermissionsAsync(true);
      if (!p.granted) { Alert.alert('Sem acesso à galeria', 'Dá acesso às fotos nas definições do telemóvel para guardar.'); return; }
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

  // Saídas da câmara. A câmara trabalha sempre em 16:9 (vertical 9:16): o visor enche o ecrã e o que se vê é o que fica
  // (a publicação 4:5 é o meio da foto, com faixas escuras a mostrar o corte). Foto: a maior resolução 16:9 da câmara,
  // JPEG a 95 % e prioridade 'balanced' (rápida, com o HDR automático do iPhone). Vídeo: 1080p em MP4 (também no
  // iPhone, para o `mime` bater certo), com som só se houver licença do microfone.
  const photoOutput = usePhotoOutput({ targetResolution: CommonResolutions.HIGHEST_16_9, containerFormat: 'jpeg', quality: 0.95, qualityPrioritization: photoPriority(PLATFORM) });
  const videoOutput = useVideoOutput({ targetResolution: CommonResolutions.FHD_16_9, enableAudio: mic.hasPermission, fileType: 'mp4' });
  // Uma saída de cada vez (como antes): com foto e vídeo juntos, muitos Android baixam a resolução da foto.
  const outputs = useMemo(() => (mode === 'video' ? [videoOutput] : [photoOutput]), [mode, videoOutput, photoOutput]);
  // O "formato" na VisionCamera 5 escolhe-se com restrições, por ordem de importância. Primeiro a resolução da saída
  // em uso (senão a da pré-visualização, que a biblioteca junta sozinha, puxava a foto para baixo); no vídeo, depois,
  // 30 fps e a melhor estabilização que a câmara tiver.
  const constraints = useMemo<Constraint[]>(() => {
    if (!device) return [];
    if (mode !== 'video') return [{ resolutionBias: photoOutput }];
    const out: Constraint[] = [{ resolutionBias: videoOutput }];
    const fps = pickVideoFps((f) => device.supportsFPS(f));
    if (fps) out.push({ fps });
    out.push({ videoStabilizationMode: pickStabilization(PLATFORM, (m) => device.supportsVideoStabilizationMode(m)) });
    return out;
  }, [mode, device, photoOutput, videoOutput]);

  useEffect(() => () => {
    clearTimeout(holdT.current); clearInterval(recTimer.current); clearInterval(countTimer.current); clearTimeout(hideT.current); clearTimeout(errT.current);
    // A sair a meio de uma gravação, deita-se fora (a câmara larga-se sozinha quando a sessão é desmontada).
    void recorder.current?.cancelRecording().catch(() => undefined);
  }, []);
  // Câmara nova (abrir ou virar): zoom no 1×, exposição a zero, sem foco nem bloqueio.
  useEffect(() => {
    if (!device) return;
    zoomOp.current += 1;
    zoomLive.current = neutralZoom;
    zoomStore.set(neutralZoom * mult);
    setZoomC({ id: device.id, z: neutralZoom });
    expoLive.current = 0;
    expoStore.set(0);
    setExposure(0);
  }, [device?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // O rácio do zoom mostrado pode chegar depois (Android): o número acompanha.
  useEffect(() => { zoomStore.set(zoomLive.current * mult); }, [mult, zoomStore]);
  // Sem câmara ao fim de uns segundos (emulador, ou a frontal não existe): diz-se em vez de ficar preto.
  useEffect(() => {
    if (device) { setNoDevice(false); return; }
    const t = setTimeout(() => setNoDevice(true), 2500);
    return () => clearTimeout(t);
  }, [!!device]); // eslint-disable-line react-hooks/exhaustive-deps
  // O microfone pede-se ao abrir a câmara (não a meio de manter o obturador). Sem ele, os vídeos gravam sem som.
  useEffect(() => {
    if (perm.hasPermission && !mic.hasPermission && mic.canRequestPermission) void mic.requestPermission();
  }, [perm.hasPermission, mic.hasPermission]); // eslint-disable-line react-hooks/exhaustive-deps

  // Depois de cada configuração (abrir, virar, foto ↔ vídeo): lê os limites do controlador novo, volta a pôr o foco
  // onde estava (o controlador novo não o sabe) e prepara a foto no iPhone (o primeiro disparo fica mais rápido).
  useEffect(() => {
    if (!cfgTick) return;
    const c = cam.current?.controller;
    if (!c) return;
    const id = safe(() => c.device.id);
    const min = safe(() => c.minZoom), max = safe(() => c.maxZoom), z = safe(() => c.zoom), dz = safe(() => c.displayableZoomFactor);
    if (id && typeof min === 'number' && typeof max === 'number' && max >= min) {
      setCtrlInfo({ id, min, max, ratio: z && dz ? dz / z : 1 });
    }
    const lf = lastFocus.current;
    if (lf) runFocus(lf.x, lf.y, lf.locked);
    if (IOS && mode === 'picture') {
      const modes: FlashChoice[] = device?.hasFlash ? ['off', 'auto', 'on'] : ['off'];
      void photoOutput.prepareSettings(modes.map((flashMode) => ({ flashMode }))).catch(() => undefined);
    }
  }, [cfgTick]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pára a gravação (se ainda estiver a arrancar, pára logo que arranque). */
  function stopRec() {
    stopAsked.current = true;
    void recorder.current?.stopRecording().catch(() => undefined);
  }

  // Botão de voltar do Android: fecha as opções, sai da pré-visualização, pára a gravação, ou fecha a câmara.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editing || galleryOpen) return false; // o editor e a galeria tratam
      if (review) { setReview(null); return true; }
      if (recording) { stopRec(); return true; }
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [editing, galleryOpen, review, recording, onClose]);

  // ——— Zoom ———

  /** Põe o zoom já (no controlador), com o número à vista e um toque leve ao passar por cada lente. */
  function liveZoom(z: number) {
    const next = clamp(z, minZoom, maxZoom);
    const prevD = zoomLive.current * mult;
    zoomLive.current = next;
    zoomStore.set(next * mult);
    if (crossedStop(prevD, next * mult, stops) !== null) tick();
    const c = cam.current?.controller;
    if (c) void c.setZoom(next).catch(() => undefined);
  }
  /** Assenta o zoom na prop da câmara (no fim da pinça, do deslizar ou da animação). */
  function commitZoom(z = zoomLive.current) {
    if (!device) return;
    const id = device.id;
    setZoomC((cur) => (cur && cur.id === id && cur.z === z ? cur : { id, z }));
  }
  /** Tocar numa pílula: zoom animado até essa lente (a câmara virtual troca de lente sozinha, sem saltar). */
  function zoomToStop(stopD: number) {
    tap();
    const target = clamp(stopD / mult, minZoom, maxZoom);
    const from = zoomLive.current;
    const op = (zoomOp.current += 1);
    zoomLive.current = target;
    zoomStore.set(target * mult);
    const c = cam.current?.controller;
    if (!c) { commitZoom(target); return; }
    c.startZoomAnimation(target, zoomAnimationArg(PLATFORM, from, target)).then(
      () => { if (zoomOp.current === op) commitZoom(target); },
      () => {
        // Sem animação (ou foi interrompida por outra): se ainda for a última ordem, vai direto.
        if (zoomOp.current === op) { void c.setZoom(target).catch(() => undefined); commitZoom(target); }
      },
    );
  }

  // ——— Foco e exposição ———

  /** Esconde o quadrado e a barra da exposição ao fim de 4 s sem mexer (o aviso do bloqueio fica). */
  function armHide() {
    clearTimeout(hideT.current);
    hideT.current = setTimeout(() => setFocus(null), 4000);
  }
  function liveExpo(v: number) {
    if (!expoR) return;
    if (crossedZero(expoLive.current, v)) tap(); // um toque leve ao passar pelo zero
    expoLive.current = v;
    expoStore.set(v);
    const c = cam.current?.controller;
    if (c) void c.setExposureBias(v).catch(() => undefined);
  }
  function commitExpo() { setExposure(expoLive.current); }
  function resetExpo() {
    expoLive.current = 0;
    expoStore.set(0);
    setExposure(0);
  }

  /**
   * Foco, exposição e equilíbrio de brancos medidos no ponto (`focusTo` da VisionCamera, em coordenadas da vista da
   * câmara: a VisionCamera trata da rotação, do espelho da frontal e do corte). Bloqueado: fica assim até ao próximo
   * toque, mesmo que a cena mude. A gravar, o foco anda devagar ('steady') para não "respirar" no vídeo.
   */
  function runFocus(x: number, y: number, locked: boolean) {
    const c = cam.current;
    if (!c || !device) return;
    const modes = meteringModes({ af: device.supportsFocusMetering, ae: device.supportsExposureMetering, awb: device.supportsWhiteBalanceMetering });
    if (!modes.length) return;
    const p = previewPoint(x, y, view, { w: camW, h: camH });
    c.focusTo(p, { responsiveness: recordingRef.current ? 'steady' : 'snappy', adaptiveness: locked ? 'locked' : 'continuous', autoResetAfter: null, modes }).catch(() => undefined);
  }

  /** Tocar (ou manter, para bloquear) no visor: o quadrado amarelo no sítio e a medição nesse ponto. */
  function focusAt(x: number, y: number, locked: boolean) {
    setFocus({ x, y });
    setAeLocked(locked);
    lastFocus.current = { x, y, locked };
    boxAnim.stopAnimation();
    boxAnim.setValue(0);
    // Entra grande e encolhe; ao bloquear, pisca duas vezes (como no iPhone); depois fica meio apagado.
    const steps: Animated.CompositeAnimation[] = [Animated.timing(boxAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true })];
    if (locked) {
      for (let i = 0; i < 2; i++) {
        steps.push(Animated.timing(boxAnim, { toValue: 1.5, duration: 120, useNativeDriver: true }), Animated.timing(boxAnim, { toValue: 1, duration: 120, useNativeDriver: true }));
      }
    }
    steps.push(Animated.delay(900), Animated.timing(boxAnim, { toValue: 2, duration: 260, useNativeDriver: true }));
    Animated.sequence(steps).start();
    armHide();
    if (locked) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    // A luz mede-se de novo: a compensação volta a zero (a barra do sol ajusta-a).
    if (expoLive.current !== 0) resetExpo();
    runFocus(x, y, locked);
  }

  /** Larga o foco tocado (volta ao automático no centro). */
  function clearFocus(resetNative: boolean) {
    clearTimeout(hideT.current);
    setFocus(null);
    setAeLocked(false);
    lastFocus.current = null;
    if (resetNative) void cam.current?.resetFocus().catch(() => undefined);
  }

  // Barra do sol: arrastar para cima clareia, para baixo escurece (dentro dos limites da câmara).
  function expoBegin() {
    clearTimeout(hideT.current);
    expoDrag.current = { y: 0, v: expoLive.current };
  }
  function expoDragTo(dyUp: number) {
    const d = expoDrag.current;
    if (!d || !expoR) return;
    const v = exposureFromDrag(d.v, dyUp, expoR, EXPO_TRAVEL);
    if (v !== expoLive.current) liveExpo(v);
  }
  function expoEnd() {
    if (!expoDrag.current) return;
    expoDrag.current = null;
    commitExpo();
    armHide();
  }
  function barStart(e: GestureResponderEvent) { expoBegin(); if (expoDrag.current) expoDrag.current.y = e.nativeEvent.pageY; }
  function barMove(e: GestureResponderEvent) { const d = expoDrag.current; if (d) expoDragTo(d.y - e.nativeEvent.pageY); }

  // ——— Gestos no visor ———
  // Um toque = focar; manter = bloquear AE/AF; dois dedos = zoom; dois toques = virar; arrastar na vertical com o
  // quadrado à vista = exposição; deslizar para a direita = galeria.
  const pinch = usePinchGesture({
    runOnJS: true,
    onBegin: () => {
      zoomOp.current += 1;
      void cam.current?.cancelZoomAnimation().catch(() => undefined);
      z0.current = zoomLive.current;
    },
    onUpdate: (e) => liveZoom(pinchZoom(z0.current, e.scale, minZoom, maxZoom)),
    onFinalize: () => commitZoom(),
  });
  const doubleTap = useTapGesture({ numberOfTaps: 2, runOnJS: true, onActivate: () => { if (!recordingRef.current) flip(); } });
  // O toque simples espera que o duplo falhe (senão cada "virar" focava antes).
  const singleTap = useTapGesture({ numberOfTaps: 1, runOnJS: true, requireToFail: doubleTap, onActivate: (e) => focusAt(e.x, e.y, false) });
  const longPress = useLongPressGesture({ runOnJS: true, minDuration: LOCK_MS, maxDistance: 12, onActivate: (e) => focusAt(e.x, e.y, true) });
  const expoPan = usePanGesture({
    runOnJS: true,
    maxPointers: 1,
    activeOffsetY: [-10, 10],
    failOffsetX: [-20, 20],
    onActivate: () => {
      expoPanOn.current = !!focusRef.current && expoOk;
      if (expoPanOn.current) expoBegin();
    },
    onUpdate: (e) => { if (expoPanOn.current) expoDragTo(-e.translationY); },
    onFinalize: () => { if (expoPanOn.current) { expoPanOn.current = false; expoEnd(); } },
  });
  // Deslizar para a direita no visor abre a galeria (como no Instagram).
  const swipe = usePanGesture({
    runOnJS: true,
    maxPointers: 1,
    activeOffsetX: 30,
    failOffsetY: [-40, 40],
    onDeactivate: (e) => { if (!recordingRef.current && e.translationX > 80) setGalleryOpen(true); },
  });
  const gestures = useSimultaneousGestures(pinch, doubleTap, singleTap, longPress, expoPan, swipe);

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
    clearFocus(false);
    setCtrlInfo(null);
    setProblem(null);
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
  }

  /** Clarão branco rápido no visor, como o "clique" da câmara. */
  function shutterFlash() {
    flashAnim.stopAnimation();
    flashAnim.setValue(0.85);
    Animated.timing(flashAnim, { toValue: 0, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }

  /** Pouca luz agora (só o iPhone sabe dizer: ISO e tempo de exposição). */
  function lowLightNow() {
    const c = cam.current?.controller;
    return isLowLight({ iso: safe(() => c?.iso), exposureDuration: safe(() => c?.exposureDuration) });
  }

  async function takePhoto() {
    if (busy || !ready || mode !== 'picture') return;
    setBusy(true);
    const front = device?.position === 'front';
    const hasFlash = !!device?.hasFlash;
    const screen = needsScreenFlash(flash, hasFlash, front, lowLightNow());
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      if (screen) {
        // Flash de ecrã: o ecrã fica branco um instante antes, para a exposição da frontal se ajustar à luz.
        screenAnim.stopAnimation();
        screenAnim.setValue(1);
        await wait(320);
      } else {
        shutterFlash();
      }
      // Flash só se a câmara o tiver (a da frente normalmente não tem, e pedir 'on' sem flash dá erro).
      const photo = await photoOutput.capturePhoto({ flashMode: photoFlashMode(flash, hasFlash) }, {});
      if (screen) Animated.timing(screenAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start();
      try {
        // A VisionCamera só marca a rotação no EXIF; o `toImageAsync` aplica a rotação (a do telemóvel na mão, mesmo
        // com o ecrã bloqueado em vertical) e o espelho da frontal de verdade, para o editor receber a foto direita.
        // A frontal sai espelhada, tal como se via no visor (como no Instagram e no Snapchat).
        const img = await photo.toImageAsync();
        try {
          const path = await img.saveToTemporaryFileAsync('jpg', 100);
          // Mesmo que a app tenha ido para segundo plano entretanto, a foto fica: o editor está à espera ao voltar.
          setEditing(fileUri(path));
        } finally {
          img.dispose();
        }
      } finally {
        photo.dispose();
      }
    } catch {
      /* a câmara falhou a meio: fica no visor */
      Animated.timing(screenAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start();
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
    setLowLightRec(lowLightNow());
    setRecording(true);
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
    setCfgTick((t) => t + 1);
    if (pendingRecord.current && mode === 'video') void startRecording();
  }
  useEffect(() => {
    if (mode !== 'video' || !pendingRecord.current) return;
    const t = setTimeout(() => { if (pendingRecord.current) void startRecording(); }, 1500);
    return () => clearTimeout(t);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ——— Problemas da câmara ———
  function onCamError(e: Error) {
    // O zoom, a exposição e a lanterna também mandam erros para aqui; esses não param a câmara.
    if (isMinorCameraError(e?.message)) return;
    clearTimeout(errT.current);
    // Só se avisa se a câmara não voltar sozinha (o CameraX tenta outra vez nos erros recuperáveis).
    errT.current = setTimeout(() => {
      if (running.current) return;
      setReady(false);
      setProblem(cameraProblem('error', { message: e?.message, usedByAnotherApp: safe(() => cam.current?.controller?.isUsedByAnotherApp) }));
    }, 1200);
  }
  function onInterruption(reason: InterruptionReason) {
    if (reason === 'video-device-not-available-in-background') return; // é a app a ir para segundo plano
    setProblem(cameraProblem('interruption', { reason, usedByAnotherApp: safe(() => cam.current?.controller?.isUsedByAnotherApp) }));
  }
  function retryCamera() {
    tap();
    setProblem(null);
    setReady(false);
    setCtrlInfo(null);
    setCamKey((k) => k + 1); // sessão nova
  }

  const press = (to: number) => Animated.spring(pressAnim, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  // Obturador: tocar = foto (com o temporizador, se houver); manter = vídeo; a gravar, deslizar para cima aproxima.
  function shutterStart(e: GestureResponderEvent) {
    holding.current = false;
    if (!ready || busy || countdown !== null || recording) return;
    press(0.9);
    slide.current = { y: e.nativeEvent.pageY, z: zoomLive.current };
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
    zoomOp.current += 1; // manda mais do que uma animação de pílula que ainda esteja a meio
    liveZoom(slideZoom(sl.z, sl.y - e.nativeEvent.pageY, minZoom, maxZoom));
  }
  function shutterEnd() {
    clearTimeout(holdT.current);
    press(1);
    const slid = !!slide.current && holding.current;
    slide.current = null;
    if (slid) commitZoom();
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
  const front = device?.position === 'front';
  const screenFlash = front && !device?.hasFlash;
  // A câmara desliga-se enquanto o editor, a galeria ou a revisão do vídeo estão por cima, com o ecrã fora de vista ou
  // com a app em segundo plano: poupa bateria e larga a câmara para outras apps. A meio de uma foto ou de uma gravação
  // espera que acabe (a foto não se perde e o vídeo fecha-se direito).
  const camActive = !editing && !galleryOpen && !review && screenFocused && (appActive || busy || recording);
  const boxAt = focus ? focusBoxOrigin(focus.x, focus.y, BOX, view) : null;
  const expoAt = boxAt ? exposureBarOrigin(boxAt.left, boxAt.top, BOX, EXPO_W, EXPO_H, view) : null;
  const rot = { transform: [{ rotate: rotAnim.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] }) }] };

  if (!perm.hasPermission) {
    const pv = permissionView(perm.status, refused);
    return (
      <View style={[st.root, st.center, { paddingHorizontal: 32 }]}>
        <Pressable onPress={onClose} style={[st.round, { position: 'absolute', top: insets.top + 10, left: 12 }]} accessibilityRole="button" accessibilityLabel="Fechar câmara"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        <Icon name={pv.action === 'request' ? 'camera' : 'lock'} size={52} color="rgba(255,255,255,0.8)" />
        <Text style={st.pTitle} accessibilityRole="header">{pv.title}</Text>
        <Text style={st.pSub}>{pv.body}</Text>
        {pv.action !== 'none' ? (
          <Pressable
            onPress={async () => {
              if (pv.action === 'settings') { void Linking.openSettings(); return; }
              const ok = await perm.requestPermission();
              if (!ok) setRefused(true);
            }}
            style={st.cta}
            accessibilityRole="button"
          >
            <Text style={st.ctaText}>{pv.label}</Text>
          </Pressable>
        ) : null}
        {refused && perm.canRequestPermission ? (
          <Pressable onPress={async () => { const ok = await perm.requestPermission(); if (ok) setRefused(false); }} style={{ marginTop: 10, padding: 12 }} accessibilityRole="button"><Text style={st.linkText}>Pedir outra vez</Text></Pressable>
        ) : null}
        <Pressable onPress={() => setGalleryOpen(true)} style={{ marginTop: 6, padding: 12 }} accessibilityRole="button"><Text style={st.linkText}>Escolher da galeria</Text></Pressable>
        {galleryOpen ? <GalleryPicker title={galleryTitle} multi={multi} onPick={picked} onCamera={() => setGalleryOpen(false)} onClose={() => setGalleryOpen(false)} /> : null}
        {editing ? (
          <PhotoEditor uri={editing} aspect={aspect} onCancel={() => setEditing(null)} onDone={(file) => { setEditing(null); onShot({ uri: file, video: false, mime: 'image/jpeg' }); }} />
        ) : null}
      </View>
    );
  }

  const boxScale = boxAnim.interpolate({ inputRange: [0, 1, 1.5, 2], outputRange: [1.5, 1, 1, 0.97] });
  // Com a barra da exposição, o quadrado fica meio apagado em vez de desaparecer (some com ela, ao fim de 4 s).
  const boxOpacity = boxAnim.interpolate({ inputRange: [0, 0.4, 1, 1.5, 2], outputRange: [0, 1, 1, 0.35, expoOk || aeLocked ? 0.6 : 0] });
  const problemCard = problem ?? (noDevice && !device ? { title: 'Sem câmara', body: facing === 'front' ? 'Não encontrei a câmara da frente.' : 'Não encontrei nenhuma câmara neste telemóvel.', retry: false } : null);

  return (
    <View style={st.root} onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {area.w > 0 ? (
        <>
          {/* Visor: só quando já se sabe o tamanho. Limpo: a imagem, a grelha (se ligada) e o quadrado de foco. */}
          <GestureDetector gesture={gestures}>
            <View style={[st.view, { left: view.x, top: view.y, width: view.w, height: view.h }]} collapsable={false}>
              {device ? (
                <Camera
                  key={camKey}
                  ref={cam}
                  style={{ position: 'absolute', left: (view.w - camW) / 2, top: (view.h - camH) / 2, width: camW, height: camH }}
                  resizeMode="cover"
                  device={device}
                  outputs={outputs}
                  constraints={constraints}
                  isActive={camActive}
                  // A frontal sai espelhada na foto e no vídeo, como no visor (WYSIWYG, como o Instagram); a de trás não.
                  mirrorMode="auto"
                  // A orientação da foto e do vídeo segue o telemóvel na mão (mesmo com a rotação do ecrã bloqueada).
                  orientationSource="device"
                  onUIRotationChanged={(deg) => Animated.timing(rotAnim, { toValue: deg, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()}
                  zoom={zoom}
                  exposure={expoOk ? exposure : undefined}
                  torchMode={torchFor(flash, recording, !!device.hasTorch, lowLightRec)}
                  // No iPhone, sem isto a câmara cala as vibrações do obturador enquanto está ligada.
                  allowHapticsAndSystemSoundsPlayback
                  onConfigured={onReady}
                  onStarted={() => { running.current = true; clearTimeout(errT.current); setProblem(null); }}
                  onStopped={() => { running.current = false; }}
                  onError={onCamError}
                  onInterruptionStarted={onInterruption}
                  onInterruptionEnded={() => setProblem(null)}
                  // iPhone: a cena mudou (a pessoa apontou para outro lado) → o foco tocado volta ao automático, como
                  // na câmara do iPhone. Com AE/AF bloqueado fica.
                  onSubjectAreaChanged={() => {
                    if (!lastFocus.current || lastFocus.current.locked) return;
                    clearFocus(true);
                    if (expoLive.current !== 0) resetExpo();
                  }}
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
              {focus && boxAt ? (
                <Animated.View pointerEvents="none" style={[st.focusBox, { left: boxAt.left, top: boxAt.top, opacity: boxOpacity, transform: [{ scale: boxScale }] }]}>
                  <View style={[st.tick, st.tickT]} />
                  <View style={[st.tick, st.tickB]} />
                  <View style={[st.tick, st.tickL]} />
                  <View style={[st.tick, st.tickR]} />
                </Animated.View>
              ) : null}
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flashAnim }]} />
            </View>
          </GestureDetector>

          {/* A câmara parou (ocupada, quente, erro): o aviso por cima do visor, fora dos gestos dele. */}
          {problemCard ? (
            <View style={[st.problem, { top: view.y + view.h * 0.3, left: view.x + 24, width: Math.max(0, view.w - 48) }]} accessibilityRole="alert">
              <Icon name="alert" size={30} color="#fcd34d" />
              <Text style={st.problemTitle}>{problemCard.title}</Text>
              <Text style={st.problemBody}>{problemCard.body}</Text>
              {problemCard.retry ? (
                <Pressable onPress={retryCamera} style={[st.cta, { marginTop: 14 }]} accessibilityRole="button"><Text style={st.ctaText}>Tentar outra vez</Text></Pressable>
              ) : null}
              {!device && facing === 'front' ? (
                <Pressable onPress={flip} style={[st.cta, { marginTop: 14 }]} accessibilityRole="button"><Text style={st.ctaText}>Usar a de trás</Text></Pressable>
              ) : null}
            </View>
          ) : null}

          {/* AE/AF bloqueado: o aviso amarelo em cima, até ao próximo toque. */}
          {aeLocked ? (
            <View pointerEvents="none" style={[st.lockWrap, { top: view.y + 66, left: view.x, width: view.w }]}>
              <Text style={st.lockText} accessibilityRole="text" accessibilityLiveRegion="polite">AE/AF BLOQUEADO</Text>
            </View>
          ) : null}

          {/* Exposição: o sol ao lado do quadrado; arrastar para cima clareia, para baixo escurece. Fica fora do visor
              para os gestos dele (toque, deslizar) não apanharem o arrasto; no visor também se pode arrastar. */}
          {focus && expoAt && expoR && !recording ? (
            <View
              style={[st.expo, { left: view.x + expoAt.left, top: view.y + expoAt.top }]}
              onTouchStart={barStart}
              onTouchMove={barMove}
              onTouchEnd={expoEnd}
              onTouchCancel={expoEnd}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Exposição"
              accessibilityHint="Desliza para cima para clarear, para baixo para escurecer"
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={(ev) => {
                const step = exposureStep(expoR);
                const v = clamp(expoLive.current + (ev.nativeEvent.actionName === 'increment' ? step : -step), expoR.min, expoR.max);
                liveExpo(expoR.integer ? Math.round(v) : v);
                commitExpo();
                armHide();
              }}
            >
              <ExposureTrack store={expoStore} range={expoR} />
            </View>
          ) : null}

          {/* Barra de cima: fechar à esquerda; flash, temporizador, grelha e texto à direita (a gravar, só o tempo). */}
          <View style={[st.controls, { left: view.x, top: view.y, width: view.w }]} pointerEvents="box-none">
            <Pressable onPress={onClose} style={st.round} accessibilityRole="button" accessibilityLabel="Fechar câmara" hitSlop={4}><Animated.View style={rot}><Icon name="x" size={22} color="#fff" strokeWidth={2.2} /></Animated.View></Pressable>
            {recording ? (
              <View style={st.rec} accessibilityLabel={`A gravar, ${recTime(recMs)}`}><View style={st.recDot} /><Text style={st.recText}>{recTime(recMs)}{!mic.hasPermission ? ' · sem som' : ''}</Text></View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8, minWidth: 44, justifyContent: 'flex-end' }}>
              {!recording && (
                <>
                  <Pressable onPress={() => { tap(); setFlash((f) => nextFlash(f)); }} style={[st.round, flash !== 'off' && st.roundOn]} accessibilityRole="button" accessibilityLabel={flashA11y(flash, screenFlash)} hitSlop={4}>
                    <Animated.View style={rot}>
                      <Icon name="bolt" size={20} solid={flash !== 'off'} color={flash !== 'off' ? colors.zinc900 : '#fff'} />
                      {flash === 'off' && <View pointerEvents="none" style={st.slash} />}
                      {flash === 'auto' && <Text style={st.auto}>A</Text>}
                    </Animated.View>
                  </Pressable>
                  <TopTool on={delay > 0} label={delay ? `Temporizador: ${delay} s` : 'Temporizador desligado'} onPress={() => { tap(); setDelay((d) => (d === 0 ? 3 : d === 3 ? 10 : 0)); }} rot={rot}>
                    <Icon name="clock" size={20} color={delay ? colors.zinc900 : '#fff'} />
                    {delay > 0 && <View style={st.delayBadge}><Text style={st.delayText}>{delay}</Text></View>}
                  </TopTool>
                  <TopTool on={grid} label="Grelha" onPress={() => { tap(); setGrid((g) => { gridPref = !g; return !g; }); }} rot={rot}>
                    <Icon name="grid" size={20} color={grid ? colors.zinc900 : '#fff'} />
                  </TopTool>
                  {onText ? (
                    <TopTool label="Só texto" onPress={onText} rot={rot}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Aa</Text></TopTool>
                  ) : null}
                </>
              )}
            </View>
          </View>

          {/* Em baixo no visor: exposição mexida (toca para repor), as lentes e a dica nas primeiras vezes. */}
          <View pointerEvents="box-none" style={[st.viewFoot, { top: view.y + view.h - 100, left: view.x, width: view.w }]}>
            <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 40 }}>
              {/* Exposição mexida e barra escondida: um sol pequeno lembra-o (toca para repor). */}
              {exposure !== 0 && !focus ? (
                <Pressable onPress={() => { tap(); resetExpo(); }} style={st.zoomBadge} accessibilityRole="button" accessibilityLabel="Repor exposição" hitSlop={8}>
                  <Icon name="sun" size={16} color="#fcd34d" strokeWidth={2.2} />
                </Pressable>
              ) : null}
              {device ? <ZoomPills stops={stops} store={zoomStore} onPick={zoomToStop} rot={rot} /> : null}
            </View>
            {!recording && count === 0 ? <Text style={st.hint}>Toca para foto · mantém para vídeo</Text> : <View style={{ height: 18 }} />}
          </View>
          {countdown !== null ? <View pointerEvents="none" style={[st.countWrap, { left: view.x, top: view.y, width: view.w, height: view.h }]}><Animated.Text style={[st.countText, rot]}>{countdown}</Animated.Text></View> : null}

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
                {kinds.map((kd) => (
                  <Pressable key={kd.id} onPress={() => { if (kind !== kd.id) tap(); onKind?.(kd.id); }} style={st.kindPill} accessibilityRole="tab" accessibilityLabel={kd.label} accessibilityState={{ selected: kind === kd.id }} hitSlop={6}>
                    <Text style={[st.kindText, kind === kd.id && st.kindOn]}>{kd.label.toUpperCase()}</Text>
                    <View style={[st.kindDot, kind !== kd.id && { opacity: 0 }]} />
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
                  <Animated.View style={[StyleSheet.absoluteFill, st.center, rot]}>
                    {lastThumb ? <Image source={{ uri: lastThumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} /> : <Icon name="images" size={22} color="#fff" strokeWidth={2} />}
                  </Animated.View>
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
              accessibilityLabel={recording ? 'Parar de gravar' : countdown !== null ? 'Cancelar o temporizador' : 'Tirar foto'}
              accessibilityHint={recording || countdown !== null ? undefined : 'Mantém premido para gravar vídeo'}
              accessibilityState={{ disabled: !ready && !recording, busy }}
              // Com o leitor de ecrã (dois toques), nas duas plataformas: foto, ou parar de gravar.
              accessibilityActions={[{ name: 'activate' }]}
              onAccessibilityAction={(ev) => {
                if (ev.nativeEvent.actionName !== 'activate') return;
                if (recording) stopRec();
                else if (countdown === null) void takePhoto();
              }}
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
              {!recording && <Pressable onPress={flip} style={st.flipBtn} accessibilityRole="button" accessibilityLabel={front ? 'Virar para a câmara de trás' : 'Virar para a câmara da frente'} hitSlop={6}><Animated.View style={rot}><Icon name="flip-camera" size={24} color="#fff" /></Animated.View></Pressable>}
            </View>
          </View>
        </>
      ) : null}

      {/* Flash de ecrã (frontal sem flash): o ecrã todo branco no instante da foto. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 30, backgroundColor: '#fff', opacity: screenAnim }]} />

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

type RotStyle = { transform: { rotate: Animated.AnimatedInterpolation<string> }[] };

/**
 * As lentes por baixo do visor (0,5 · 1× · 3): a acesa mostra o zoom atual ("1,6×") e muda enquanto se faz a pinça,
 * sem redesenhar a câmara. Na frontal (uma só lente) só aparece o número quando há zoom (toca para repor).
 */
function ZoomPills({ stops, store, onPick, rot }: { stops: number[]; store: ValueStore<number>; onPick: (stop: number) => void; rot: RotStyle }) {
  const d = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (stops.length <= 1) {
    if (Math.abs(d - 1) < 0.04) return null;
    return (
      <Pressable onPress={() => onPick(1)} style={st.zoomBadge} accessibilityRole="button" accessibilityLabel={`${zoomA11y(d)}. Toca para repor`} hitSlop={8}>
        <Animated.Text style={[st.zoomText, rot]}>{formatZoom(d)}</Animated.Text>
      </Pressable>
    );
  }
  const on = activeStop(stops, d);
  return (
    <View style={st.pills}>
      {stops.map((s) => {
        const act = s === on;
        return (
          <Pressable key={s} onPress={() => onPick(s)} style={[st.pill, act && st.pillOn]} hitSlop={5} accessibilityRole="button" accessibilityLabel={act ? zoomA11y(d) : `Lente ${formatStop(s)} vezes`} accessibilityState={{ selected: act }}>
            <Animated.Text style={[st.pillText, act && st.pillTextOn, rot]} numberOfLines={1}>{act ? formatZoom(d) : formatStop(s)}</Animated.Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** O sol na barra da exposição: sobe e desce com o valor, sem redesenhar a câmara. */
function ExposureTrack({ store, range }: { store: ValueStore<number>; range: ExposureRange }) {
  const v = useSyncExternalStore(store.subscribe, store.get, store.get);
  const sunY = sunOffset(v, range, EXPO_H, SUN);
  return (
    <>
      {sunY > 6 ? <View pointerEvents="none" style={[st.expoLine, { top: 0, height: sunY - 4 }]} /> : null}
      {EXPO_H - SUN - sunY > 6 ? <View pointerEvents="none" style={[st.expoLine, { top: sunY + SUN + 4, bottom: 0 }]} /> : null}
      <View pointerEvents="none" style={[st.sun, { top: sunY }]}><Icon name="sun" size={22} color="#fcd34d" strokeWidth={2.2} /></View>
    </>
  );
}

/** Um botão da barra de cima (temporizador, grelha, texto): sempre à vista, amarelo quando ligado. */
function TopTool({ on, label, onPress, rot, children }: { on?: boolean; label: string; onPress: () => void; rot?: RotStyle; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} style={[st.round, on && st.roundOn]} accessibilityRole="button" accessibilityState={{ selected: !!on }} accessibilityLabel={label} hitSlop={4}>
      <Animated.View style={rot}>{children}</Animated.View>
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
        <Pressable onPress={onRetake} style={st.ghostBtn} accessibilityRole="button" accessibilityLabel="Repetir o vídeo"><Icon name="undo" size={20} color="#fff" /><Text style={st.ghostText}>Repetir</Text></Pressable>
        <Pressable onPress={onSave} style={[st.ghostBtn, { paddingHorizontal: 14 }]} accessibilityRole="button" accessibilityLabel="Guardar na galeria"><Icon name="download" size={20} color="#fff" /></Pressable>
        <Pressable onPress={onUse} style={st.useBtn} accessibilityRole="button" accessibilityLabel="Usar vídeo"><Text style={st.useText}>Usar vídeo</Text><Icon name="check" size={20} color="#fff" strokeWidth={2.6} /></Pressable>
      </View>
    </View>
  );
}
function ReviewVideo({ uri }: { uri: string }) {
  const p = useVideoPlayer(uri, (x) => { x.loop = true; x.play(); });
  return <VideoView player={p} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />;
}

const YELLOW = '#fcd34d';
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  view: { position: 'absolute', overflow: 'hidden', borderRadius: 22, backgroundColor: '#111' },
  band: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  topShade: { position: 'absolute', left: 0, right: 0, top: 0, height: 80, backgroundColor: 'rgba(0,0,0,0.14)' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.45)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.45)' },
  // Quadrado de foco amarelo com as marcas a meio de cada lado (como no iPhone).
  focusBox: { position: 'absolute', width: BOX, height: BOX, borderWidth: 1.5, borderColor: YELLOW },
  tick: { position: 'absolute', backgroundColor: YELLOW },
  tickT: { top: 0, left: BOX / 2 - 2.25, width: 1.5, height: 7 },
  tickB: { bottom: 0, left: BOX / 2 - 2.25, width: 1.5, height: 7 },
  tickL: { left: 0, top: BOX / 2 - 2.25, height: 1.5, width: 7 },
  tickR: { right: 0, top: BOX / 2 - 2.25, height: 1.5, width: 7 },
  lockWrap: { position: 'absolute', zIndex: 6, alignItems: 'center' },
  lockText: { overflow: 'hidden', borderRadius: 4, backgroundColor: YELLOW, color: colors.zinc900, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 3 },
  // Área de toque larga (44 pt) à volta da linha fina; o fundo quase invisível faz dela alvo de toque no Android.
  expo: { position: 'absolute', zIndex: 6, width: EXPO_W, height: EXPO_H, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.001)' },
  expoLine: { position: 'absolute', width: 1.5, borderRadius: 1, backgroundColor: 'rgba(252,211,77,0.85)' },
  sun: { position: 'absolute', width: SUN, height: SUN, alignItems: 'center', justifyContent: 'center' },
  controls: { position: 'absolute', zIndex: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 10 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center' },
  roundOn: { backgroundColor: YELLOW },
  slash: { position: 'absolute', top: 9, left: -3, height: 2, borderRadius: 1, width: 26, backgroundColor: '#fff', transform: [{ rotate: '-45deg' }] },
  auto: { position: 'absolute', right: -8, bottom: -6, fontSize: 10, fontWeight: '900', color: colors.zinc900 },
  delayBadge: { position: 'absolute', right: -6, bottom: -6, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  delayText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 7 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  recText: { color: '#fff', fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] },
  doneBtn: { position: 'absolute', zIndex: 6, height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.brand, paddingLeft: 16, paddingRight: 8 },
  doneCount: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  viewFoot: { position: 'absolute', zIndex: 5, alignItems: 'center', gap: 10 },
  zoomBadge: { height: 34, minWidth: 44, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  zoomText: { color: YELLOW, fontSize: 13, fontWeight: '800' },
  // As lentes: uma cápsula escura com bolinhas; a acesa é maior, com o número amarelo.
  pills: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, paddingHorizontal: 3, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.32)' },
  pill: { minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.38)' },
  pillOn: { minWidth: 36, height: 36, borderRadius: 18, paddingHorizontal: 5 },
  pillText: { color: '#fff', fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  pillTextOn: { color: YELLOW, fontSize: 12.5 },
  countWrap: { position: 'absolute', zIndex: 5, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 120, fontWeight: '900', color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 20 },
  hint: { height: 18, color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  problem: { position: 'absolute', zIndex: 8, alignItems: 'center', borderRadius: 18, padding: 20, backgroundColor: 'rgba(0,0,0,0.78)' },
  problemTitle: { marginTop: 10, color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  problemBody: { marginTop: 6, color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  modes: { position: 'absolute', left: 0, right: 0, zIndex: 4, justifyContent: 'center' },
  kinds: { flexGrow: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingHorizontal: 12 },
  kindPill: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 4, alignItems: 'center', justifyContent: 'center', gap: 4 },
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
  linkText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  reviewBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.35)' },
  ghostBtn: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 24, paddingHorizontal: 18, backgroundColor: 'rgba(255,255,255,0.14)' },
  ghostText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  useBtn: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 24, paddingHorizontal: 22, backgroundColor: colors.brand },
  useText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
