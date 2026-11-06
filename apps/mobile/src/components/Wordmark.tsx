import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '@/lib/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Logótipo "txillapp": traço grosso e arredondado, com o ponto do i a coral (igual ao do site). `height` em px. Com `loading`, o ponto do i salta como uma bola. */
export function Wordmark({ height = 32, color = colors.zinc900, loading = false }: { height?: number; color?: string; loading?: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!loading) return;
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 950, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [loading, t]);
  const cy = t.interpolate({ inputRange: [0, 0.38, 0.62, 0.78, 1], outputRange: [3.5, -9.5, 2.5, 3.5, 3.5] });
  return (
    <Svg viewBox={loading ? '-4 -14 154 65' : '-4 -3 154 54'} width={(height * 154) / 54} height={(height * (loading ? 65 : 54)) / 54} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" accessibilityLabel="txillapp">
      <Path d="M7 5V27Q7 34 14 34M0 14H14" />
      <Path d="M20 14Q27 24 34 34M34 14Q27 24 20 34" />
      <Path d="M42 14V34" />
      {loading ? <AnimatedCircle cx={42} cy={cy} r={4.2} strokeWidth={0} fill={colors.brand} /> : <Circle cx={42} cy={3.5} r={4.2} strokeWidth={0} fill={colors.brand} />}
      <Path d="M51 3V34" />
      <Path d="M61 3V34" />
      <Circle cx={77} cy={24} r={9.5} />
      <Path d="M86.5 14V34" />
      <Circle cx={106} cy={24} r={9.5} />
      <Path d="M96.5 14V46" />
      <Circle cx={135} cy={24} r={9.5} />
      <Path d="M125.5 14V46" />
    </Svg>
  );
}
