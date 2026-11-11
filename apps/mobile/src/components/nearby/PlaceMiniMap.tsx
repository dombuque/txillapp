import { useMemo } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { PlacePickMap } from './PlacePickMap';

/**
 * O mapa pequeno só de ver, com o alfinete no sítio (o sítio de um local, o que se escolheu no campo "Onde fica?").
 * Não se arrasta nem faz zoom: a página rola por cima dele. O mesmo no telemóvel e no site.
 */
export function PlaceMiniMap({ lat, lng, height = 160, label, style }: { lat: number; lng: number; height?: number; label?: string; style?: StyleProp<ViewStyle> }) {
  // O mapa só volta a centrar quando o ponto muda (e não a cada desenho do ecrã).
  const center = useMemo(() => ({ lat, lng }), [lat, lng]);
  return (
    <View
      style={[{ height, borderRadius: 16, overflow: 'hidden', backgroundColor: '#f2efe9' }, style]}
      accessible={Platform.OS !== 'web'}
      accessibilityRole="image"
      accessibilityLabel={label ?? 'Mapa com o sítio marcado'}
    >
      <PlacePickMap center={center} readOnly zone={false} zoom={16} style={{ flex: 1 }} />
    </View>
  );
}
