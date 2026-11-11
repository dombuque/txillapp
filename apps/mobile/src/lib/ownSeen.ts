import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { ownSeenFor, packOwnSeen } from './ownStorySeen';

/**
 * "Já vi os meus mimos" neste aparelho (a hora do último story meu visto). O servidor também o guarda na conta (o `seen`
 * dos meus na bandeja e na lista), para valer em todos os aparelhos; isto é só o reforço imediato, enquanto ele não
 * responde. Compara-se como data (ownStorySeen.ts), nunca como texto. Fica guardado com o @ da conta, para não passar
 * para outra conta no mesmo aparelho. Quando publicas outro, o anel volta a cores.
 */
const KEY = 'txill_own_story_seen';
const listeners = new Set<(raw: string) => void>();
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

export async function writeOwnSeen(username: string, at: string) {
  const raw = packOwnSeen(username, at);
  cache = raw;
  listeners.forEach((l) => l(raw));
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, raw);
    else await SecureStore.setItemAsync(KEY, raw);
  } catch {
    /* sem armazenamento: fica o que o servidor disser */
  }
}

/** A hora do último story meu (desta conta) que já vi neste aparelho, ou '' (atualiza sozinha). */
export function useOwnSeen(username: string | null | undefined): string {
  const [raw, setRaw] = useState(cache ?? '');
  useEffect(() => {
    let off = false;
    void read().then((x) => !off && setRaw(x));
    listeners.add(setRaw);
    return () => {
      off = true;
      listeners.delete(setRaw);
    };
  }, []);
  return ownSeenFor(raw, username);
}
