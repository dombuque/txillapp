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
  /** O ponto azul "estou aqui" (só com a localização do telemóvel). */
  showMe?: boolean;
  /** Píxeis do fundo do mapa tapados pela lista (telemóvel): o raio e o item escolhido ficam na parte à vista. */
  coverBottom?: number;
  style?: StyleProp<ViewStyle>;
}

/** "Marcar no mapa": o mapa vai até `center` sempre que muda; `onMove` diz o centro (onde está o alfinete) quando o mapa para. */
export interface PlacePickMapProps {
  center: { lat: number; lng: number };
  onMove: (c: { lat: number; lng: number }) => void;
  zoomControl?: boolean;
  style?: StyleProp<ViewStyle>;
}
