import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * "Já vi os meus mimos": o servidor não conta o autor como espectador, por isso fica guardado neste aparelho
 * (a hora do último story visto). Quando publicas outro, o anel volta a cores.
 */
const KEY = 'txill_own_story_seen';
const listeners = new Set<(v: string) => void>();
let cache: string | null = null;

async function read(): Promise<string> {
  if (cache !== null) return cache;
  try {
    cache = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) ?? '' : (await SecureStore.getItemAsync(KEY)) ?? '';
  } catch {
    cache = '';
  }
  return cache;
}

export async function writeOwnSeen(at: string) {
  cache = at;
  listeners.forEach((l) => l(at));
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, at);
    else await SecureStore.setItemAsync(KEY, at);
  } catch {
    /* sem armazenamento: o anel volta a cores */
  }
}

/** A hora do último story meu que já vi neste aparelho (atualiza sozinha). */
export function useOwnSeen(): string {
  const [v, setV] = useState(cache ?? '');
  useEffect(() => {
    let off = false;
    void read().then((x) => !off && setV(x));
    listeners.add(setV);
    return () => {
      off = true;
      listeners.delete(setV);
    };
  }, []);
  return v;
}
