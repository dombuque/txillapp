import { Image } from 'expo-image';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { atRest, doubleTapTarget, DOUBLE_TAP_MS, panStep, pinchStep, ringOpacity, settle, type Box, type Zoom } from '@/lib/zoomMath';

export type ZoomableImageProps = {
  /** A foto boa (grande). */
  uri: string;
  /** A foto pequena, já na cache: fica por baixo enquanto a grande carrega (não pisca). */
  placeholderUri?: string;
  /** Diâmetro do círculo a 1×. */
  size: number;
  /** Um toque a 1× (ou o «voltar») fecha. */
  onClose: () => void;
  accessibilityLabel?: string;
};

const EASE = { duration: 220 };

/**
 * Foto redonda que se amplia com dois dedos (1× a 5×), se arrasta quando ampliada (sem sair dos limites), amplia/reduz com
 * dois toques (2,5×, no ponto tocado) e fecha com um toque a 1×. Ao largar abaixo de 1× volta suavemente a 1×.
 * Ocupa o espaço todo do pai (os gestos apanham-se em todo o ecrã, não só no círculo). As contas estão em lib/zoomMath.
 * Telemóvel: gesture-handler + reanimated (no UI thread). A web tem a sua versão (ZoomableImage.web.tsx).
 * O GestureHandlerRootView é preciso dentro de um Modal no Android.
 */
export function ZoomableImage({ uri, placeholderUri, size, onClose, accessibilityLabel }: ZoomableImageProps) {
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const vw = useSharedValue(0);
  const vh = useSharedValue(0);
  // Ponto médio dos dois dedos no passo anterior (a partir do centro do visor).
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const pinching = useSharedValue(false);
  // Ao tirar um dos dois dedos, o ponto do arrastar salta para o dedo que fica: o primeiro passo a seguir ignora-se.
  const skipPan = useSharedValue(false);

  const read = (): Zoom => {
    'worklet';
    return { scale: scale.value, x: x.value, y: y.value };
  };
  const box = (): Box => {
    'worklet';
    return { base: size, w: vw.value, h: vh.value };
  };
  const set = (z: Zoom) => {
    'worklet';
    scale.value = z.scale;
    x.value = z.x;
    y.value = z.y;
  };
  const animateTo = (z: Zoom) => {
    'worklet';
    scale.value = withTiming(z.scale, EASE);
    x.value = withTiming(z.x, EASE);
    y.value = withTiming(z.y, EASE);
  };

  const pinch = usePinchGesture({
    onActivate: (e) => {
      pinching.value = true;
      fx.value = e.focalX - vw.value / 2;
      fy.value = e.focalY - vh.value / 2;
    },
    onUpdate: (e) => {
      const f = { x: e.focalX - vw.value / 2, y: e.focalY - vh.value / 2 };
      set(pinchStep(read(), e.scaleChange, f, { x: fx.value, y: fy.value }));
      fx.value = f.x;
      fy.value = f.y;
    },
    onDeactivate: () => {
      pinching.value = false;
      skipPan.value = true;
      animateTo(settle(read(), box()));
    },
  });
  const pan = usePanGesture({
    averageTouches: true,
    onUpdate: (e) => {
      if (pinching.value || atRest(scale.value)) return;
      if (skipPan.value) {
        skipPan.value = false;
        return;
      }
      set(panStep(read(), e.changeX, e.changeY, box()));
    },
    onDeactivate: () => {
      if (!pinching.value) animateTo(settle(read(), box()));
    },
  });
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    maxDelay: DOUBLE_TAP_MS,
    onActivate: (e) => animateTo(doubleTapTarget(read(), e.x - vw.value / 2, e.y - vh.value / 2, box())),
  });
  // O toque simples espera que o duplo falhe; ampliada, um toque não fecha (só a 1×).
  const singleTap = useTapGesture({
    numberOfTaps: 1,
    runOnJS: true,
    requireToFail: doubleTap,
    onActivate: () => {
      if (atRest(scale.value)) onClose();
    },
  });
  const gestures = useSimultaneousGestures(pinch, pan, doubleTap, singleTap);

  const photo = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));
  const ring = useAnimatedStyle(() => ({ opacity: ringOpacity(scale.value) }));
  const onLayout = (e: LayoutChangeEvent) => {
    vw.value = e.nativeEvent.layout.width;
    vh.value = e.nativeEvent.layout.height;
  };
  const r = size / 2;

  return (
    <GestureHandlerRootView style={st.root}>
      <GestureDetector gesture={gestures}>
        <View
          style={st.root}
          collapsable={false}
          onLayout={onLayout}
          accessible
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Dois dedos para ampliar. Um toque fecha."
          onAccessibilityTap={onClose}
          onAccessibilityEscape={onClose}
        >
          <Animated.View style={[st.circle, { width: size, height: size, borderRadius: r }, photo]}>
            {placeholderUri ? <Image source={{ uri: placeholderUri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors /> : null}
            <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} priority="high" accessibilityIgnoresInvertColors />
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, borderWidth: 4, borderColor: '#fff' }, ring]} />
          </Animated.View>
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  circle: { overflow: 'hidden', backgroundColor: '#27272a' },
});
