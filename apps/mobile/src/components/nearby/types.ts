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
