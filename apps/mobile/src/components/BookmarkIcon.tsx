import Svg, { Path } from 'react-native-svg';
import { colors } from '@/lib/theme';

/** Marcador de guardar (o mesmo desenho do site): cheio quando está guardada. */
export function BookmarkIcon({ on, size = 24, color }: { on: boolean; size?: number; color?: string }) {
  const c = color ?? (on ? colors.zinc900 : colors.zinc700);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={on ? c : 'none'} stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6.5 4.5h11a1 1 0 0 1 1 1V20l-6.5-4.2L5.5 20V5.5a1 1 0 0 1 1-1z" />
    </Svg>
  );
}
