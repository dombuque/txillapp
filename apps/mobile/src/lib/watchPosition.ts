import * as Location from 'expo-location';
import { Platform } from 'react-native';

/** Uma posição do aparelho. */
export interface DeviceFix { lat: number; lng: number; accuracy: number | null }
export type WatchError = 'denied' | 'unavailable' | 'timeout';
export interface WatchOptions {
  /** Alta precisão (GPS). Por omissão, sim. */
  high?: boolean;
  /** Só no telemóvel: de quanto em quanto tempo (ms) e a partir de quantos metros chega uma posição nova. */
  intervalMs?: number;
  distanceM?: number;
}

/** O código de erro do browser (GeolocationPositionError) em palavras. */
export const webGeoError = (code: number): WatchError => (code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable');

/**
 * A posição do aparelho, uma vez, com tempo-limite (por omissão 15 s). Rejeita se não der.
 * No site o `getCurrentPositionAsync` do expo-location não tem tempo-limite (`maximumAge: Infinity`, sem `timeout`) e no
 * iPhone podia ficar à espera para sempre; aqui o browser desiste e a promessa falha.
 */
export function currentDevicePosition(high = false, timeoutMs = 15_000): Promise<DeviceFix> {
  if (Platform.OS === 'web') {
    return new Promise((resolve, reject) => {
      const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
      if (!geo) return reject(new Error('unavailable'));
      geo.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null }),
        (e) => reject(new Error(webGeoError(e.code))),
        { enableHighAccuracy: high, maximumAge: 60_000, timeout: timeoutMs },
      );
    });
  }
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    Location.getCurrentPositionAsync({ accuracy: high ? Location.Accuracy.High : Location.Accuracy.Balanced })
      .then((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null }), reject)
      .finally(() => clearTimeout(t));
  });
}

/**
 * Segue a posição do aparelho; devolve a função que para de seguir.
 *
 * No site vai direto ao `navigator.geolocation`: o `watchPositionAsync` do expo-location na web troca o número da
 * subscrição pelo do browser, e as posições chegam com o número errado e nunca são entregues (no Safari do iPhone a folha
 * "Enviar localização" ficava para sempre em "A procurar a tua posição…"); além disso engolia os erros. Aqui os erros
 * chegam a `onError` e o browser tem um tempo-limite, em vez de esperar para sempre.
 */
export async function watchDevicePosition(opts: WatchOptions, onFix: (f: DeviceFix) => void, onError?: (e: WatchError) => void): Promise<() => void> {
  if (Platform.OS === 'web') {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      onError?.('unavailable');
      return () => undefined;
    }
    const id = geo.watchPosition(
      (p) => onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null }),
      (e) => onError?.(webGeoError(e.code)),
      { enableHighAccuracy: opts.high ?? true, maximumAge: 15_000, timeout: 20_000 },
    );
    return () => geo.clearWatch(id);
  }
  const sub = await Location.watchPositionAsync(
    { accuracy: opts.high === false ? Location.Accuracy.Balanced : Location.Accuracy.High, timeInterval: opts.intervalMs ?? 2_000, distanceInterval: opts.distanceM ?? 1 },
    (p) => onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
  );
  return () => sub.remove();
}
