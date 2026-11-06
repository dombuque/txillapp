import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Pequeno armazenamento neste aparelho: localStorage na web, cofre do telemóvel no nativo. Nunca lança erros. */
export async function kvGet(key: string): Promise<string | null> {
  try {
    return Platform.OS === 'web' ? globalThis.localStorage?.getItem(key) ?? null : await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    /* sem armazenamento: só vale agora */
  }
}
