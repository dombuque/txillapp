import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '@/lib/theme';

/** Logótipo "txillapp": traço grosso e arredondado, com o ponto do i a coral (igual ao do site). `height` em px. */
export function Wordmark({ height = 32, color = colors.zinc900 }: { height?: number; color?: string }) {
  return (
    <Svg viewBox="-4 -3 154 54" width={(height * 154) / 54} height={height} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" accessibilityLabel="txillapp">
      <Path d="M7 5V27Q7 34 14 34M0 14H14" />
      <Path d="M20 14Q27 24 34 34M34 14Q27 24 20 34" />
      <Path d="M42 14V34" />
      <Circle cx={42} cy={3.5} r={4.2} strokeWidth={0} fill={colors.brand} />
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
