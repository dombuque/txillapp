import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { LOGO_BOX, LOGO_DOT_PATHS, LOGO_FILL_RULE, LOGO_INK_PATHS } from '@/lib/marca';
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
  // Em baixo fica acima da barra de gestos: no PWA do iPhone a margem segura vem a 0, por isso há sempre um mínimo.
  const bottom = panel ? inset : Math.max(insets.bottom, 18) + 12;
  const radius = panel ? 22 : 36;
  // O logótipo tem laçadas que descem: a etiqueta é um pouco mais alta para ele caber com folga.
  const markW = 64;
  const markH = (LOGO_BOX.h / LOGO_BOX.w) * markW;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[st.frame, { left: inset, right: inset, top, bottom, borderRadius: radius }]} />
      <View style={[st.label, { bottom: bottom - 15 }]}>
        <View style={st.pill}>
        <Svg width={markW} height={markH} viewBox={`${LOGO_BOX.x} ${LOGO_BOX.y} ${LOGO_BOX.w} ${LOGO_BOX.h}`}>
          {LOGO_INK_PATHS.map((d, i) => <Path key={i} d={d} fill="#fff" fillRule={LOGO_FILL_RULE} />)}
          {LOGO_DOT_PATHS.map((d, i) => <Path key={`d${i}`} d={d} fill={colors.brand} fillRule={LOGO_FILL_RULE} />)}
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
  pill: { height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: '#0b0b0c', borderWidth: 1.5, borderColor: 'rgba(255,92,108,0.85)', alignItems: 'center', justifyContent: 'center' },
});
