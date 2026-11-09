import Svg, { G, Path } from 'react-native-svg';
import { colors } from '@/lib/theme';

/**
 * Ícones das chamadas que ainda não existem na biblioteca Tx (src/icons/tx.ts): auscultador, desligar, microfone e câmara
 * cortados, chamada perdida / recebida / feita e o chevron para baixo (minimizar). Mesma grelha 24×24 e o mesmo traço.
 */
export type CallIconName = 'handset' | 'hangup' | 'mic-off' | 'video-off' | 'missed' | 'incoming' | 'outgoing' | 'chevron-down';

const HANDSET = 'M21.5 16.9v2.8a1.9 1.9 0 0 1-2.1 1.9 18.8 18.8 0 0 1-8.2-2.9 18.5 18.5 0 0 1-5.7-5.7A18.8 18.8 0 0 1 2.6 4.7 1.9 1.9 0 0 1 4.5 2.6h2.8a1.9 1.9 0 0 1 1.9 1.6c.1.9.3 1.8.7 2.7a1.9 1.9 0 0 1-.4 2L8.3 10.1a15.2 15.2 0 0 0 5.7 5.7l1.2-1.2a1.9 1.9 0 0 1 2-.4c.9.3 1.8.6 2.7.7a1.9 1.9 0 0 1 1.6 1.9Z';
const MIC = ['M12 3h0a3 3 0 0 1 3 3v5.5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3v-5.5a3 3 0 0 1 3 -3Z', 'M5.5 11.5a6.5 6.5 0 0 0 13 0', 'M12 18v3'];
const VIDEO = ['M6.2 6h6.1a3.2 3.2 0 0 1 3.2 3.2v5.6a3.2 3.2 0 0 1 -3.2 3.2h-6.1a3.2 3.2 0 0 1 -3.2 -3.2v-5.6a3.2 3.2 0 0 1 3.2 -3.2Z', 'M15.5 10.6 21 7.4v9.2l-5.5-3.2'];
const SLASH = 'M3.5 3.5l17 17';

const PATHS: Record<Exclude<CallIconName, 'hangup'>, string[]> = {
  handset: [HANDSET],
  'mic-off': [...MIC, SLASH],
  'video-off': [...VIDEO, SLASH],
  missed: [HANDSET, 'M16 3l5 5', 'M21 3l-5 5'],
  incoming: [HANDSET, 'M15.5 3.5v5h5', 'M21 3l-5.5 5.5'],
  outgoing: [HANDSET, 'M20.5 8.5v-5h-5', 'M15 9l5.5-5.5'],
  'chevron-down': ['M5.5 9 12 15.5 18.5 9'],
};

export function CallIcon({ name, size = 24, color = colors.zinc900, strokeWidth = 1.9, solid = false }: { name: CallIconName; size?: number; color?: string; strokeWidth?: number; solid?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {name === 'hangup' ? (
        // O auscultador deitado (o "desligar" de todas as apps).
        <G transform="rotate(135 12 12)">
          <Path d={HANDSET} fill={solid ? color : 'none'} />
        </G>
      ) : (
        PATHS[name].map((d, i) => <Path key={i} d={d} fill={solid && i === 0 && name === 'handset' ? color : 'none'} />)
      )}
    </Svg>
  );
}
