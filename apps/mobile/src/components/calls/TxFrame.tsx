import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { WORDMARK_BOX, WORDMARK_DOT, WORDMARK_PATHS, WORDMARK_STROKE } from '@/lib/wordmark';
import { colors } from '@/lib/theme';

/**
 * A moldura do Txillapp nas chamadas: um contorno coral que acompanha os cantos do ecrã e, encaixada na borda de baixo,
 * uma etiqueta com o logótipo (branco, com o ponto do i a coral). Fica por cima de tudo e não apanha toques.
 * `panel`: dentro do painel do computador (sem entalhe nem barra de baixo).
 */
export function TxFrame({ panel = false }: { panel?: boolean }) {
  const insets = useSafeAreaInsets();
  const inset = panel ? 8 : 6;
  const top = panel ? inset : Math.max(inset, insets.top - 6);
  const bottom = panel ? inset : Math.max(inset, insets.bottom - 4);
  const radius = panel ? 22 : 36;
  const markW = 74;
  const markH = (WORDMARK_BOX.h / WORDMARK_BOX.w) * markW;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[st.frame, { left: inset, right: inset, top, bottom, borderRadius: radius }]} />
      <View style={[st.label, { bottom: bottom - 12 }]}>
        <View style={st.pill}>
        <Svg width={markW} height={markH} viewBox={`${WORDMARK_BOX.x} ${WORDMARK_BOX.y} ${WORDMARK_BOX.w} ${WORDMARK_BOX.h}`}>
          <G fill="none" stroke="#fff" strokeWidth={WORDMARK_STROKE} strokeLinecap="round" strokeLinejoin="round">
            {WORDMARK_PATHS.map((d, i) => <Path key={i} d={d} />)}
          </G>
          <Circle cx={WORDMARK_DOT.cx} cy={WORDMARK_DOT.cy} r={WORDMARK_DOT.r} fill={colors.brand} />
        </Svg>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  frame: { position: 'absolute', borderWidth: 2.5, borderColor: 'rgba(255,92,108,0.85)' },
  label: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  // A etiqueta "corta" o contorno, como numa moldura de fotografia.
  pill: { height: 24, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#0b0b0c', borderWidth: 1.5, borderColor: 'rgba(255,92,108,0.85)', alignItems: 'center', justifyContent: 'center' },
});
