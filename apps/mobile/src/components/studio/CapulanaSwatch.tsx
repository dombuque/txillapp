import { useMemo } from 'react';
import { Image, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { capulanaDataUri, type CapulanaSpec } from '@/lib/studio/capulana';

/**
 * Um bocado de pano a encher a caixa (miniaturas do seletor, cartões das ondas, fundos). O azulejo vem do gerador como
 * imagem (`data:` URI), por isso funciona na web e no nativo sem canvas; `tile` é o lado do motivo em px do ecrã.
 */
export function CapulanaSwatch({ spec, tile = 48, style, radius = 0 }: { spec: CapulanaSpec; tile?: number; style?: StyleProp<ViewStyle>; radius?: number }) {
  // Na web o azulejo gera-se com o dobro dos pixels (ecrãs de alta densidade) e o CSS encolhe-o; no nativo vai à medida.
  const px = Platform.OS === 'web' ? Math.min(192, tile * 2) : tile;
  const uri = useMemo(() => capulanaDataUri(spec, px), [spec.pattern, spec.palette, spec.seed, px]); // eslint-disable-line react-hooks/exhaustive-deps
  if (Platform.OS === 'web') {
    return <View accessibilityElementsHidden style={[{ borderRadius: radius, overflow: 'hidden' }, style, { backgroundImage: `url(${uri})`, backgroundSize: `${tile}px ${tile}px`, backgroundRepeat: 'repeat', backgroundPosition: 'center' } as never]} />;
  }
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
      <Image source={{ uri }} resizeMode="repeat" style={StyleSheet.absoluteFill} />
    </View>
  );
}
