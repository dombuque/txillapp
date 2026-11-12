import { Image } from 'expo-image';
import { Platform } from 'react-native';
import { createPrefetcher } from './zasDeck';

/**
 * Pré-carregar as fotos dos próximos Zás (uma lista só para a app toda: a faixa e o visor partilham-na).
 * Telemóvel: `Image.prefetch` do expo-image, para a cache de memória e de disco (o <Image> do cartão usa a mesma).
 * Web: `new Image()` + decode(), e as últimas ficam seguras em memória (o browser não as larga nem as volta a pedir).
 */
const held = new Map<string, HTMLImageElement>();
const HOLD = 12;

function loadWeb(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.decoding = 'async';
    img.onload = () => {
      const done = () => resolve();
      if (typeof img.decode === 'function') img.decode().then(done, done);
      else done();
    };
    img.onerror = () => {
      held.delete(url);
      reject(new Error('não carregou'));
    };
    img.src = url;
    held.set(url, img);
    while (held.size > HOLD) held.delete(held.keys().next().value as string);
  });
}

async function loadNative(url: string): Promise<void> {
  const ok = await Image.prefetch(url, 'memory-disk');
  if (!ok) throw new Error('não carregou');
}

export const zasPrefetcher = createPrefetcher(Platform.OS === 'web' ? loadWeb : loadNative);
