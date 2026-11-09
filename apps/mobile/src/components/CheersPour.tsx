import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const INK = '#1f1b24';
const BEER = '#ffb020';
const BEER_DARK = '#f59e0b';
const FOAM = '#fff8e6';
const DUR = 1600;

/**
 * O brinde: dois copos de cerveja entram dos lados, tocam no meio do post (com um estalo de espuma), o da esquerda
 * inclina e despeja cerveja para o da direita, que enche; caem gotas e tudo desvanece. `n` muda a cada brinde.
 * Fica por cima do conteúdo, sem apanhar toques.
 */
export function CheersPour({ n, size = 200 }: { n: number; size?: number }) {
  const t = useSharedValue(0);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (n === 0) return;
    setOn(true);
    t.value = 0;
    t.value = withTiming(1, { duration: DUR, easing: Easing.linear });
    const id = setTimeout(() => setOn(false), DUR + 50);
    return () => clearTimeout(id);
  }, [n, t]);

  const wrap = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.06, 0.85, 1], [0, 1, 1, 0], 'clamp'),
    transform: [{ scale: interpolate(t.value, [0, 0.12, 0.2, 0.85, 1], [0.6, 1.06, 1, 1, 1.08], 'clamp') }],
  }));
  // Copo da esquerda: entra, toca, inclina para despejar e volta.
  const left = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 0.18, 0.24, 0.3], [-size * 0.45, 0, -size * 0.04, 0], 'clamp') },
      { translateY: interpolate(t.value, [0.3, 0.42, 0.75, 0.85], [0, -size * 0.12, -size * 0.12, 0], 'clamp') },
      { rotate: `${interpolate(t.value, [0, 0.18, 0.3, 0.42, 0.75, 0.85], [-25, -12, -12, 55, 55, -12], 'clamp')}deg` },
    ],
  }));
  const right = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 0.18, 0.24, 0.3, 0.42], [size * 0.45, 0, size * 0.04, 0, size * 0.05], 'clamp') },
      { rotate: `${interpolate(t.value, [0, 0.18, 0.3, 0.42], [25, 12, 12, 0], 'clamp')}deg` },
    ],
  }));

  if (!on) return null;
  const w = size * 0.42;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, st.center]}>
      <Animated.View style={[{ width: size, height: size }, wrap]}>
        {/* O fio de cerveja entre os copos e as gotas (por baixo dos copos). */}
        <Stream t={t} size={size} />
        <Animated.View style={[st.mug, { left: size * 0.08, top: size * 0.3, width: w, height: w * 1.2 }, left]}>
          {/* Espelhado: a asa fica do lado de fora, os dois copos frente a frente. */}
          <View style={{ transform: [{ scaleX: -1 }] }}><Mug t={t} side="left" w={w} /></View>
        </Animated.View>
        <Animated.View style={[st.mug, { right: size * 0.08, top: size * 0.3, width: w, height: w * 1.2 }, right]}>
          <Mug t={t} side="right" w={w} />
        </Animated.View>
        <Clink t={t} size={size} />
      </Animated.View>
    </View>
  );
}

/** Um copo de cerveja (caneca) cujo nível muda: o da esquerda esvazia ao despejar, o da direita enche. */
function Mug({ t, side, w }: { t: SharedValue<number>; side: 'left' | 'right'; w: number }) {
  const id = `clip-${side}`;
  const level = useAnimatedProps(() => {
    const full = side === 'left'
      ? interpolate(t.value, [0, 0.45, 0.75], [0.85, 0.85, 0.25], 'clamp')
      : interpolate(t.value, [0, 0.45, 0.78], [0.35, 0.35, 0.92], 'clamp');
    const h = 70 * full;
    return { y: 92 - h, height: h };
  });
  const foam = useAnimatedProps(() => {
    const full = side === 'left'
      ? interpolate(t.value, [0, 0.45, 0.75], [0.85, 0.85, 0.25], 'clamp')
      : interpolate(t.value, [0, 0.45, 0.78], [0.35, 0.35, 0.92], 'clamp');
    const top = 92 - 70 * full;
    return { d: `M12 ${top + 2} q6 -9 14 -2 q7 -8 15 -1 q7 -8 15 0 q6 -6 8 3 v6 h-52 z` };
  });
  return (
    <Svg viewBox="0 0 100 120" width={w} height={w * 1.2}>
      <Defs>
        <ClipPath id={id}><Rect x={12} y={18} width={52} height={74} rx={6} /></ClipPath>
      </Defs>
      {/* Asa */}
      <Path d="M64 38h10a12 12 0 0 1 12 12v16a12 12 0 0 1-12 12H64" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />
      <G clipPath={`url(#${id})`}>
        <Rect x={12} y={18} width={52} height={74} fill="#fde7c2" opacity={0.35} />
        <AnimatedRect x={12} width={52} fill={BEER} animatedProps={level} />
        <Rect x={20} y={30} width={6} height={56} rx={3} fill="#fff" opacity={0.35} />
        <AnimatedPath fill={FOAM} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" animatedProps={foam} />
        <Circle cx={36} cy={70} r={2.5} fill="#fff" opacity={0.7} />
        <Circle cx={46} cy={58} r={2} fill="#fff" opacity={0.6} />
        <Circle cx={30} cy={50} r={1.6} fill="#fff" opacity={0.6} />
      </G>
      <Rect x={12} y={18} width={52} height={74} rx={6} fill="none" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
      <Rect x={8} y={90} width={60} height={8} rx={4} fill={BEER_DARK} stroke={INK} strokeWidth={4} />
    </Svg>
  );
}

/** O fio de cerveja que cai do copo inclinado para o outro, e as gotas que saltam. */
function Stream({ t, size }: { t: SharedValue<number>; size: number }) {
  const stream = useAnimatedProps(() => {
    const k = interpolate(t.value, [0.42, 0.48, 0.72, 0.78], [0, 1, 1, 0], 'clamp');
    return { opacity: k, strokeWidth: 5 + 3 * k };
  });
  const drop = (dx: number, delay: number) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedProps(() => {
      const p = interpolate(t.value, [0.48 + delay, 0.8 + delay], [0, 1], 'clamp');
      return { cx: 112 + dx * p * 40, cy: 92 + p * 50 + p * p * 30, opacity: p > 0 && p < 1 ? 1 - p : 0, r: 3.2 - p * 1.5 };
    });
  const d1 = drop(-1, 0), d2 = drop(1, 0.05), d3 = drop(0.4, 0.1), d4 = drop(-0.6, 0.14);
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size} style={StyleSheet.absoluteFill}>
      <AnimatedPath d="M96 64 C112 70 116 86 118 104" fill="none" stroke={BEER} strokeLinecap="round" animatedProps={stream} />
      <AnimatedCircle fill={BEER} animatedProps={d1} />
      <AnimatedCircle fill={BEER} animatedProps={d2} />
      <AnimatedCircle fill={FOAM} stroke={INK} strokeWidth={1} animatedProps={d3} />
      <AnimatedCircle fill={BEER} animatedProps={d4} />
    </Svg>
  );
}

/** O estalo do toque entre os copos: riscos e espuma a saltar por cima. */
function Clink({ t, size }: { t: SharedValue<number>; size: number }) {
  const rays = useAnimatedProps(() => {
    const k = interpolate(t.value, [0.16, 0.2, 0.36], [0, 1, 0], 'clamp');
    return { opacity: k, strokeWidth: 4 * k + 0.5 };
  });
  const bubbles = useAnimatedProps(() => {
    const k = interpolate(t.value, [0.18, 0.4], [0, 1], 'clamp');
    return { opacity: k > 0 && k < 1 ? 1 - k : 0 };
  });
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size} style={StyleSheet.absoluteFill}>
      <AnimatedPath d="M100 40 v-16 M84 46 l-10 -12 M116 46 l10 -12 M76 60 h-14 M124 60 h14" fill="none" stroke={BEER_DARK} strokeLinecap="round" animatedProps={rays} />
      <AnimatedPath d="M92 56 a5 5 0 1 0 0.1 0 M104 50 a6 6 0 1 0 0.1 0 M112 60 a4 4 0 1 0 0.1 0" fill={FOAM} stroke={INK} strokeWidth={1.5} animatedProps={bubbles} />
    </Svg>
  );
}

const st = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  mug: { position: 'absolute' },
});
