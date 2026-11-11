import type { StyleProp, ViewStyle } from 'react-native';
import type { MapMarker } from './mapRuntime';

export type { MapMarker, MapMarkerKind } from './mapRuntime';

/** As mesmas propriedades no site (Leaflet direto) e na app (Leaflet dentro de uma WebView). */
export interface NearbyMapProps {
  center: { lat: number; lng: number };
  radiusKm: number;
  markers: MapMarker[];
  onMarkerPress: (id: string) => void;
  selectedId?: string | null;
  /** Botões + e − (no computador). */
  zoomControl?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** "Marcar no mapa": o mapa vai até `center` sempre que muda; `onMove` diz o centro (onde está o alfinete) quando o mapa para. */
export interface PlacePickMapProps {
  center: { lat: number; lng: number };
  onMove?: (c: { lat: number; lng: number }) => void;
  zoomControl?: boolean;
  /** O círculo da zona gravada (~750 m), para os TxillGroups. Os locais vão com o ponto exato: `zone={false}`. */
  zone?: boolean;
  /** Só para ver: não se mexe, não apanha toques (a página rola por cima) e não tem botões de zoom. */
  readOnly?: boolean;
  /** O zoom da primeira vista (15 por omissão). */
  zoom?: number;
  style?: StyleProp<ViewStyle>;
}
