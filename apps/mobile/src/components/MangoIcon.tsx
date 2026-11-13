import { forwardRef } from 'react';
import Svg, { Path } from 'react-native-svg';
import type { LucideIcon } from 'lucide-react-native';

/**
 * Uma manga, no traço dos ícones lucide (que não têm manga: antes a «Manga com sal» aparecia como banana). A fruta em
 * forma de rim, o pé e uma folha. Aceita os mesmos `size`, `color` e `strokeWidth` dos lucide.
 */
export const Mango = forwardRef<unknown, { size?: number; color?: string; strokeWidth?: number }>(function Mango({ size = 24, color = 'currentColor', strokeWidth = 2 }, _ref) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12.5 7.5c4.2-.6 7.4 2.4 7 6.6-.4 4.6-4.7 7.6-9.3 6.7C5.8 20 3.3 16.4 4.3 12.6c.6-2.3 2.4-3.5 4.2-3.5 1.6 0 2.4-1.3 4-1.6Z" />
      <Path d="M12.5 7.5 13 5" />
      <Path d="M13 5c1.2-1.8 3.4-2.4 5.5-1.8-.8 2-2.9 3.1-5.5 1.8Z" />
    </Svg>
  );
}) as unknown as LucideIcon;
