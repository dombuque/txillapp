import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { LOGO_BOX, LOGO_DOT, LOGO_DOT_COLOR, LOGO_DOT_PATHS, LOGO_FILL_RULE, LOGO_INK, LOGO_INK_PATHS } from '@/lib/marca';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Folga por cima do logótipo enquanto carrega (para o ponto do i saltar), em frações da altura. */
const LIFT = 0.2;

/**
 * O logótipo «txillapp» (o desenho oficial de lib/marca.ts, gerado de assets/marca): letras na cor `color` e o ponto do
 * i vermelho. `height` em px (a altura do desenho todo, das letras altas às laçadas de baixo). Com `loading`, o ponto do
 * i salta como uma bola.
 */
export function Wordmark({ height = 32, color = LOGO_INK, loading = false }: { height?: number; color?: string; loading?: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!loading) return;
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 950, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [loading, t]);
  const B = LOGO_BOX;
  const lift = loading ? B.h * LIFT : 0;
  const h = B.h;
  const cy = t.interpolate({ inputRange: [0, 0.38, 0.62, 0.78, 1], outputRange: [LOGO_DOT.cy, LOGO_DOT.cy - h * 0.24, LOGO_DOT.cy - h * 0.0185, LOGO_DOT.cy, LOGO_DOT.cy] });
  return (
    <Svg viewBox={`${B.x} ${B.y - lift} ${B.w} ${B.h + lift}`} width={(height * B.w) / B.h} height={(height * (B.h + lift)) / B.h} accessibilityLabel="txillapp">
      {LOGO_INK_PATHS.map((d, i) => <Path key={i} d={d} fill={color} fillRule={LOGO_FILL_RULE} />)}
      {loading
        ? <AnimatedCircle cx={LOGO_DOT.cx} cy={cy} r={LOGO_DOT.r} fill={LOGO_DOT_COLOR} />
        : LOGO_DOT_PATHS.map((d, i) => <Path key={`d${i}`} d={d} fill={LOGO_DOT_COLOR} fillRule={LOGO_FILL_RULE} />)}
    </Svg>
  );
}
