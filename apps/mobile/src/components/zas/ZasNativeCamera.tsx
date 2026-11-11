import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Animated, AppState, Easing, Linking, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { GestureDetector, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput, type CameraRef } from 'react-native-vision-camera';
import { Icon } from '../Icon';
import { ZAS_MAX_ZOOM, coverCrop, inCaptionZone, needsMirror, outSize, pinchZoom, roundCrop } from './zasFrame';

/**
 * A câmara ao vivo do Zás no telemóvel (Android/iPhone), dentro do cartão squircle 3:4.
 *
 * Porque a VisionCamera (e não o expo-camera, que era usado antes):
 * - no Android, o expo-camera põe o PreviewView do CameraX dentro da vista do React Native, e o React Native não faz o
 *   layout das vistas que o CameraX acrescenta depois (a SurfaceView da imagem, criada quando a câmara arranca, ao virar ou
 *   ao voltar do segundo plano). Conforme quem chegava primeiro (o layout ou a câmara), a imagem ficava com o tamanho certo
 *   ou com um tamanho velho: às vezes enchia a forma, às vezes não. A VisionCamera refaz esse layout sempre que o CameraX
 *   acrescenta a vista (`installHierarchyFitter`), por isso o "cover" vale sempre;
 * - é a mesma câmara da NativeCamera, por isso passar da câmara da app para o Zás não põe duas bibliotecas a disputar o
 *   mesmo CameraX (o expo-camera faz `unbindAll()` e a outra desligava-lhe a imagem);
 * - dá foco num ponto, zoom e a foto como `Image` para recortar.
 *
 * A imagem: `resizeMode="cover"` num cartão 3:4 com uma câmara 4:3 (a do sensor, sem corte), em modo 'compatible'
 * (TextureView) para o recorte squircle (overflow + borderRadius na mesma vista) cortar mesmo os cantos.
 * A foto: `capturePhoto` com a prioridade 'balanced' a ~3 MP (rápida e de sobra para um Zás de 1080 × 1440), rodada e
 * espelhada como se viu, recortada a 3:4 com as mesmas contas da pré-visualização (zasFrame) e gravada em JPEG.
 * O `takeSnapshot` foi posto de parte: só existe no Android, tem a resolução do ecrã e não leva flash.
 */
export type ZasCamStatus = { granted: boolean; ready: boolean; hasFlash: boolean };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fileUri = (p: string) => (p.startsWith('file://') ? p : `file://${p}`);
const RING = 64;

export function ZasNativeCamera({
  w, h, facing, flash, style, swipe, shootRef, onStatus, onScreenLight, children,
}: {
  w: number;
  h: number;
  facing: 'back' | 'front';
  /** Flash ligado: o da câmara de trás; na da frente o ecrã acende-se (iluminação de ecrã). */
  flash: boolean;
  style: ViewStyle | ViewStyle[];
  /** O deslizar dos filtros (fica a funcionar junto com tocar para focar e a pinça). */
  swipe: Parameters<typeof useSimultaneousGestures>[0];
  /** Preenchido pelo componente: tira a foto e devolve o ficheiro (ou null se não deu). */
  shootRef: MutableRefObject<(() => Promise<string | null>) | null>;
  onStatus: (s: ZasCamStatus) => void;
  /** Pede ao ecrã do Zás para pôr o ecrã todo branco (o "flash" da câmara da frente). */
  onScreenLight: (on: boolean) => void;
  children?: ReactNode;
}) {
  const cam = useRef<CameraRef | null>(null);
  const perm = useCameraPermission();
  const device = useCameraDevice(facing);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const ringAnim = useRef(new Animated.Value(0)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;
  const z0 = useRef(1);
  const busy = useRef(false);

  // Foto: 4:3 (3:4 ao alto, a forma do Zás), ~3 MP, JPEG; 'balanced' é bem mais rápida do que 'quality'.
  const photoOutput = usePhotoOutput({ targetResolution: { width: 1536, height: 2048 }, containerFormat: 'jpeg', quality: 0.92, qualityPrioritization: 'balanced' });
  const outputs = useMemo(() => [photoOutput], [photoOutput]);

  // Segundo plano: a câmara desliga; ao voltar liga outra vez (e a imagem volta a encher a forma).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  // Câmara nova (abrir ou virar): zoom normal, sem anel de foco, à espera de estar pronta.
  const minZoom = device?.minZoom ?? 1;
  const maxZoom = Math.max(minZoom, Math.min(device?.maxZoom ?? 1, ZAS_MAX_ZOOM));
  useEffect(() => {
    setReady(false);
    setFocus(null);
    setZoom(Math.min(maxZoom, Math.max(minZoom, 1)));
  }, [device?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasFlash = !!device?.hasFlash;
  useEffect(() => { onStatus({ granted: perm.hasPermission, ready, hasFlash }); }, [perm.hasPermission, ready, hasFlash]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Clarão branco curto na forma e um toque no telemóvel: a foto foi tirada. */
  function shutter() {
    flashAnim.stopAnimation();
    flashAnim.setValue(0.9);
    Animated.timing(flashAnim, { toValue: 0, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  }

  function focusAt(x: number, y: number) {
    // Em cima fica a legenda (tocar lá é para escrever).
    if (!ready || !device?.supportsFocusMetering || inCaptionZone(y, h)) return;
    setFocus({ x, y });
    ringAnim.stopAnimation();
    ringAnim.setValue(0);
    Animated.sequence([
      Animated.timing(ringAnim, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(ringAnim, { toValue: 2, duration: 240, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) setFocus(null); });
    void Haptics.selectionAsync().catch(() => undefined);
    // A câmara enche o cartão todo, por isso o ponto do toque é já o ponto da pré-visualização.
    cam.current?.focusTo({ x, y }, { responsiveness: 'snappy', adaptiveness: 'continuous', autoResetAfter: null }).catch(() => undefined);
  }

  const pinch = usePinchGesture({
    runOnJS: true,
    enabled: ready,
    onBegin: () => { z0.current = zoom; },
    onUpdate: (e) => setZoom(pinchZoom(z0.current, e.scale, minZoom, maxZoom)),
  });
  const tap = useTapGesture({ numberOfTaps: 1, runOnJS: true, enabled: ready, onActivate: (e) => focusAt(e.x, e.y) });
  const gestures = useSimultaneousGestures(pinch, tap, swipe);

  shootRef.current = async () => {
    if (!perm.hasPermission) {
      await perm.requestPermission();
      return null;
    }
    if (!ready || busy.current || !device) return null;
    busy.current = true;
    const front = facing === 'front';
    // Na da frente (ou se a de trás não tiver flash), a luz é o ecrã todo branco por um instante.
    const screen = flash && (front || !hasFlash);
    try {
      if (screen) {
        onScreenLight(true);
        await wait(380);
      } else shutter();
      const photo = await photoOutput.capturePhoto({ flashMode: flash && !screen ? 'on' : 'off', enableShutterSound: false }, {});
      if (screen) {
        onScreenLight(false);
        shutter();
      }
      const mirrored = photo.isMirrored;
      let img = await photo.toImageAsync();
      photo.dispose();
      const swap = async (next: typeof img) => { const old = img; img = next; old.dispose(); };
      // O mesmo corte "cover" 3:4 da pré-visualização (com uma câmara 4:3 não corta nada).
      const c = roundCrop(coverCrop(img.width, img.height), img.width, img.height);
      if (c.sw !== img.width || c.sh !== img.height) await swap(await img.cropAsync(c.sx, c.sy, c.sx + c.sw, c.sy + c.sh));
      // A da frente sai espelhada, como se viu no ecrã.
      if (needsMirror(front, mirrored)) await swap(await img.mirrorHorizontallyAsync());
      const o = outSize(img.width, img.height);
      if (o.w < img.width) await swap(await img.resizeAsync(o.w, o.h));
      try {
        return fileUri(await img.saveToTemporaryFileAsync('jpg', 90));
      } finally {
        img.dispose();
      }
    } finally {
      if (screen) onScreenLight(false);
      busy.current = false;
    }
  };

  const ringScale = ringAnim.interpolate({ inputRange: [0, 1, 2], outputRange: [1.4, 1, 0.95] });
  const ringOpacity = ringAnim.interpolate({ inputRange: [0, 0.4, 1, 2], outputRange: [0, 1, 1, 0] });

  return (
    <GestureDetector gesture={gestures}>
      <View style={[style, { width: w, height: h }]} collapsable={false}>
        {perm.hasPermission && device ? (
          <Camera
            ref={cam}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            implementationMode="compatible"
            device={device}
            outputs={outputs}
            isActive={appActive}
            mirrorMode="auto"
            // A app é só ao alto: a foto sai sempre ao alto, como a forma que se vê.
            orientationSource="interface"
            zoom={zoom}
            allowHapticsAndSystemSoundsPlayback
            onConfigured={() => setReady(true)}
            onStarted={() => setReady(true)}
            onStopped={() => setReady(false)}
            onError={() => setReady(false)}
          />
        ) : (
          <Pressable
            onPress={() => void (perm.hasPermission ? undefined : perm.canRequestPermission ? perm.requestPermission() : Linking.openSettings())}
            accessibilityRole="button"
            accessibilityLabel="Permitir a câmara"
            style={{ alignItems: 'center', gap: 10, paddingHorizontal: 24 }}
          >
            <Icon name="camera" size={44} color="rgba(255,255,255,0.7)" />
            <Text style={{ fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.8)', textAlign: 'center' }}>
              {perm.hasPermission ? 'Este telemóvel não tem câmara disponível.' : perm.canRequestPermission ? 'Toca para ligar a câmara' : 'A câmara está bloqueada. Toca para abrir as definições.'}
            </Text>
          </Pressable>
        )}
        {children}
        {zoom > 1.05 ? (
          <View pointerEvents="none" style={st.zoom}><Text style={st.zoomText}>{zoom.toFixed(1).replace('.', ',')}×</Text></View>
        ) : null}
        {focus ? (
          <Animated.View pointerEvents="none" style={[st.ring, { left: focus.x - RING / 2, top: focus.y - RING / 2, opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
        ) : null}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 20, backgroundColor: '#fff', opacity: flashAnim }]} />
      </View>
    </GestureDetector>
  );
}

const st = StyleSheet.create({
  ring: { position: 'absolute', zIndex: 8, width: RING, height: RING, borderRadius: RING / 2, borderWidth: 2, borderColor: '#fcd34d' },
  zoom: { position: 'absolute', zIndex: 7, alignSelf: 'center', bottom: 44, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 4 },
  zoomText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
