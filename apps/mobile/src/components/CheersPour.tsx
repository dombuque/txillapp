import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const INK = '#3b2a1a';
const FOAM = '#fffaf0';
const DUR = 1900;

/** Faíscas que saltam do ponto do brinde: ângulo, distância, cor, tamanho e atraso. */
const SPARKS: { a: number; d: number; c: string; r: number; delay: number }[] = [
  { a: -90, d: 62, c: '#ffd23f', r: 5, delay: 0 },
  { a: -130, d: 56, c: '#ff5c6c', r: 4, delay: 0.01 },
  { a: -50, d: 58, c: '#ff5c6c', r: 4, delay: 0.015 },
  { a: -160, d: 46, c: '#ffd23f', r: 3.5, delay: 0.02 },
  { a: -20, d: 48, c: '#ffd23f', r: 3.5, delay: 0.02 },
  { a: -110, d: 74, c: FOAM, r: 4.5, delay: 0.03 },
  { a: -70, d: 72, c: FOAM, r: 4.5, delay: 0.03 },
  { a: -145, d: 30, c: '#38bdf8', r: 3, delay: 0.04 },
  { a: -35, d: 30, c: '#38bdf8', r: 3, delay: 0.04 },
];

/**
 * O brinde, ao jeito das reações do Teams: os dois copos entram com mola, tocam no meio do post (esticam e encolhem
 * com o choque, abre-se um anel e saltam faíscas), o da esquerda inclina e despeja cerveja para o outro, que enche;
 * no fim tudo sobe um pouco e desvanece. `n` muda a cada brinde. Fica por cima do conteúdo, sem apanhar toques.
 */
export function CheersPour({ n, size = 200 }: { n: number; size?: number }) {
  const t = useSharedValue(0);
  const pop = useSharedValue(0);
  const squash = useSharedValue(1);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (n === 0) return;
    setOn(true);
    t.value = 0;
    t.value = withTiming(1, { duration: DUR, easing: Easing.linear });
    pop.value = 0;
    pop.value = withSpring(1, { damping: 9, stiffness: 180, mass: 0.7 });
    // O choque dos copos (aos ~19% do tempo): achata e volta com mola.
    squash.value = 1;
    squash.value = withSequence(withTiming(1, { duration: DUR * 0.19 }), withTiming(0.82, { duration: 70 }), withSpring(1, { damping: 6, stiffness: 260 }));
    const id = setTimeout(() => setOn(false), DUR + 60);
    return () => clearTimeout(id);
  }, [n, t, pop, squash]);

  const wrap = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.05, 0.84, 1], [0, 1, 1, 0], 'clamp'),
    transform: [
      { translateY: interpolate(t.value, [0.8, 1], [0, -size * 0.12], 'clamp') },
      { scale: interpolate(pop.value, [0, 1], [0.35, 1]) },
    ],
  }));
  const left = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 0.19, 0.25, 0.32], [-size * 0.5, 0, -size * 0.05, 0], 'clamp') },
      { translateY: interpolate(t.value, [0.32, 0.44, 0.74, 0.84], [0, -size * 0.12, -size * 0.12, 0], 'clamp') },
      { rotate: `${interpolate(t.value, [0, 0.19, 0.32, 0.44, 0.74, 0.84], [-30, -10, -12, 58, 58, -10], 'clamp')}deg` },
      { scaleX: 2 - squash.value },
      { scaleY: squash.value },
    ],
  }));
  const right = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 0.19, 0.25, 0.32, 0.44], [size * 0.5, 0, size * 0.05, 0, size * 0.05], 'clamp') },
      { rotate: `${interpolate(t.value, [0, 0.19, 0.32, 0.44, 0.8, 0.88], [30, 10, 12, 0, 0, -6], 'clamp')}deg` },
      { scaleX: 2 - squash.value },
      { scaleY: squash.value },
    ],
  }));
  const shadow = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0, 0.15, 0.84, 1], [0, 0.22, 0.22, 0], 'clamp') }));

  if (!on) return null;
  const w = size * 0.42;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, st.center]}>
      <Animated.View style={[{ width: size, height: size }, wrap]}>
        {/* Sombra suave por baixo dos copos (dá volume). */}
        <Animated.View style={[st.shadow, { left: size * 0.15, right: size * 0.15, top: size * 0.86, height: size * 0.06, borderRadius: size }, shadow]} />
        <Stream t={t} size={size} />
        <Animated.View style={[st.mug, { left: size * 0.07, top: size * 0.3, width: w, height: w * 1.2 }, left]}>
          {/* Espelhado: a asa fica do lado de fora, os dois copos frente a frente. */}
          <View style={{ transform: [{ scaleX: -1 }] }}><Mug t={t} side="left" w={w} /></View>
        </Animated.View>
        <Animated.View style={[st.mug, { right: size * 0.07, top: size * 0.3, width: w, height: w * 1.2 }, right]}>
          <Mug t={t} side="right" w={w} />
        </Animated.View>
        <Sparks t={t} size={size} />
      </Animated.View>
    </View>
  );
}

/** Nível da cerveja (0 a 1): o da esquerda esvazia ao despejar, o da direita enche. */
function levelOf(t: number, side: 'left' | 'right') {
  'worklet';
  return side === 'left'
    ? interpolate(t, [0, 0.46, 0.74], [0.82, 0.82, 0.22], 'clamp')
    : interpolate(t, [0, 0.46, 0.78], [0.3, 0.3, 0.9], 'clamp');
}

/** Um copo de cerveja com volume: vidro com brilho, cerveja em gradiente, bolhas e espuma que acompanha o nível. */
function Mug({ t, side, w }: { t: SharedValue<number>; side: 'left' | 'right'; w: number }) {
  const id = `mug-${side}`;
  const beer = useAnimatedProps(() => {
    const h = 70 * levelOf(t.value, side);
    return { y: 92 - h, height: h };
  });
  const foam = useAnimatedProps(() => {
    const top = 92 - 70 * levelOf(t.value, side);
    // A espuma ondula um pouco enquanto a cerveja mexe.
    const wob = Math.sin(t.value * 40) * 1.5 * interpolate(t.value, [0.4, 0.5, 0.8, 0.9], [0, 1, 1, 0], 'clamp');
    return { d: `M10 ${top + 3} q7 ${-10 + wob} 15 -2 q8 ${-9 - wob} 16 -1 q8 ${-9 + wob} 16 0 q7 -7 9 3 v7 h-56 z` };
  });
  return (
    <Svg viewBox="0 0 100 120" width={w} height={w * 1.2}>
      <Defs>
        <ClipPath id={`${id}-clip`}><Rect x={12} y={18} width={52} height={74} rx={7} /></ClipPath>
        <LinearGradient id={`${id}-beer`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#ffcf4a" />
          <Stop offset="0.55" stopColor="#ffab1f" />
          <Stop offset="1" stopColor="#e8890c" />
        </LinearGradient>
        <LinearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <Stop offset="0.4" stopColor="#ffffff" stopOpacity="0.12" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0.3" />
        </LinearGradient>
      </Defs>
      {/* Asa */}
      <Path d="M64 38h10a12 12 0 0 1 12 12v16a12 12 0 0 1-12 12H64" fill="none" stroke={INK} strokeWidth={5.5} strokeLinecap="round" />
      <Path d="M64 44h9a7 7 0 0 1 7 7v14a7 7 0 0 1-7 7h-9" fill="none" stroke="#ffffff" strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" />
      <G clipPath={`url(#${id}-clip)`}>
        <Rect x={12} y={18} width={52} height={74} fill="#fde7c2" opacity={0.45} />
        <AnimatedRect x={12} width={52} fill={`url(#${id}-beer)`} animatedProps={beer} />
        <Circle cx={30} cy={78} r={2.6} fill="#fff" opacity={0.75} />
        <Circle cx={44} cy={66} r={2.1} fill="#fff" opacity={0.65} />
        <Circle cx={36} cy={56} r={1.7} fill="#fff" opacity={0.6} />
        <Circle cx={50} cy={82} r={1.5} fill="#fff" opacity={0.6} />
        <AnimatedPath fill={FOAM} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" animatedProps={foam} />
        <Rect x={12} y={18} width={52} height={74} fill={`url(#${id}-glass)`} />
        <Rect x={19} y={26} width={7} height={58} rx={3.5} fill="#fff" opacity={0.55} />
      </G>
      <Rect x={12} y={18} width={52} height={74} rx={7} fill="none" stroke={INK} strokeWidth={5.5} strokeLinejoin="round" />
      <Rect x={8} y={90} width={60} height={9} rx={4.5} fill="#f59e0b" stroke={INK} strokeWidth={4.5} />
    </Svg>
  );
}

/** O fio de cerveja do copo inclinado para o outro, e as gotas que saltam ao cair. */
function Stream({ t, size }: { t: SharedValue<number>; size: number }) {
  const stream = useAnimatedProps(() => {
    const k = interpolate(t.value, [0.44, 0.5, 0.72, 0.78], [0, 1, 1, 0], 'clamp');
    return { opacity: k, strokeWidth: 4 + 5 * k };
  });
  const shine = useAnimatedProps(() => ({ opacity: 0.7 * interpolate(t.value, [0.46, 0.52, 0.7, 0.76], [0, 1, 1, 0], 'clamp') }));
  const drop = (dx: number, delay: number) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedProps(() => {
      const p = interpolate(t.value, [0.5 + delay, 0.8 + delay], [0, 1], 'clamp');
      return { cx: 116 + dx * p * 44, cy: 100 + p * 40 + p * p * 26, opacity: p > 0 && p < 1 ? 1 - p : 0, r: 3.4 - p * 1.6 };
    });
  const d1 = drop(-1, 0), d2 = drop(1, 0.05), d3 = drop(0.4, 0.1), d4 = drop(-0.6, 0.14);
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size} style={StyleSheet.absoluteFill}>
      <AnimatedPath d="M94 66 C112 70 118 88 119 106" fill="none" stroke="#ffab1f" strokeLinecap="round" animatedProps={stream} />
      <AnimatedPath d="M98 68 C110 72 114 86 115 100" fill="none" stroke="#fff3c4" strokeWidth={1.6} strokeLinecap="round" animatedProps={shine} />
      <AnimatedCircle fill="#ffab1f" animatedProps={d1} />
      <AnimatedCircle fill="#ffcf4a" animatedProps={d2} />
      <AnimatedCircle fill={FOAM} stroke={INK} strokeWidth={1} animatedProps={d3} />
      <AnimatedCircle fill="#ffab1f" animatedProps={d4} />
    </Svg>
  );
}

/** As faíscas do toque: saltam do ponto onde os copos se encontram, abrandam e desaparecem. */
function Sparks({ t, size }: { t: SharedValue<number>; size: number }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size} style={StyleSheet.absoluteFill}>
      {SPARKS.map((s, i) => <Spark key={i} t={t} s={s} />)}
      <Ring t={t} />
    </Svg>
  );
}

function Spark({ t, s }: { t: SharedValue<number>; s: (typeof SPARKS)[number] }) {
  const props = useAnimatedProps(() => {
    const p = interpolate(t.value, [0.19 + s.delay, 0.46 + s.delay], [0, 1], 'clamp');
    const e = 1 - (1 - p) * (1 - p) * (1 - p); // abranda no fim
    const rad = (s.a * Math.PI) / 180;
    return { cx: 100 + Math.cos(rad) * s.d * e, cy: 74 + Math.sin(rad) * s.d * e, r: s.r * (p < 0.15 ? p / 0.15 : 1 - (p - 0.15) * 0.6), opacity: p > 0 && p < 1 ? 1 - p * p : 0 };
  });
  return <AnimatedCircle fill={s.c} stroke={s.c === FOAM ? INK : 'none'} strokeWidth={s.c === FOAM ? 1 : 0} animatedProps={props} />;
}

/** Um anel que se abre a partir do toque (o "tchin"). */
function Ring({ t }: { t: SharedValue<number> }) {
  const props = useAnimatedProps(() => {
    const p = interpolate(t.value, [0.19, 0.38], [0, 1], 'clamp');
    return { r: 6 + 34 * p, opacity: p > 0 && p < 1 ? 0.8 * (1 - p) : 0, strokeWidth: 5 * (1 - p) + 0.5 };
  });
  return <AnimatedCircle cx={100} cy={74} fill="none" stroke="#ffd23f" animatedProps={props} />;
}

const st = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  mug: { position: 'absolute' },
  shadow: { position: 'absolute', backgroundColor: '#000' },
});
