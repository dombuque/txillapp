import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { currentDevicePosition } from './watchPosition';

export type LatLng = { lat: number; lng: number };

/** A permissão de localização, sem a pedir: 'granted', 'ask' (ainda se pode pedir) ou 'blocked' (recusada para sempre). */
export async function locationPermission(): Promise<'granted' | 'ask' | 'blocked'> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.granted) return 'granted';
    return perm.canAskAgain === false ? 'blocked' : 'ask';
  } catch {
    return 'ask';
  }
}

/** A posição do aparelho, só se já houver permissão (`ask` = pedir se ainda não houver). null se não der. */
export async function devicePosition(ask: boolean): Promise<LatLng | null> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && ask && perm.canAskAgain !== false) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const last = Platform.OS === 'web' ? null : await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
    if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
    // Com tempo-limite (lib/watchPosition): no site o expo-location podia ficar à espera para sempre.
    const pos = await currentDevicePosition(false);
    return { lat: pos.lat, lng: pos.lng };
  } catch {
    return null;
  }
}

/** A posição agora (para pôr o pino de um local onde estou): mais precisa e sem a última guardada. null se não der. */
export async function preciseDevicePosition(): Promise<LatLng | null> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain !== false) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await currentDevicePosition(true);
    return { lat: pos.lat, lng: pos.lng };
  } catch {
    return null;
  }
}
