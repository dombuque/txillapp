// Capturas de ecrã no telemóvel (expo-screen-capture): bloquear nos Zás dos outros e avisar nas conversas.
// - Android: bloquear é a FLAG_SECURE da janela (a captura é recusada e a gravação sai preta). Saber que houve captura
//   só no Android 14+ (o sistema avisa; DETECT_SCREEN_CAPTURE é uma permissão normal, sem pedido). Antes disso o módulo
//   precisava de ler as fotos da galeria, e isso a app não pede (regras do Google Play).
// - iPhone: no 13+ a captura sai em branco; o aviso de captura funciona sempre.
// - Web/PWA: não há forma de bloquear nem de saber. O módulo na web é um objeto vazio (chamar addListener partia):
//   aqui tudo fica sem efeito fora do Android e do iPhone.
import { useIsFocused } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { takeScreenshotSlot } from './screenshotNotice';

/** Só o Android e o iPhone têm bloqueio e aviso de captura. */
export const captureNative = Platform.OS === 'android' || Platform.OS === 'ios';

/** A chave do bloqueio do visor dos Zás dos outros (as chaves do módulo não chocam com outros bloqueios). */
export const ZAS_CAPTURE_KEY = 'zas-others';

/** Bloqueia as capturas (com uma chave própria). Na web não faz nada. Nunca rejeita. */
export async function blockCapture(key: string): Promise<void> {
  if (!captureNative) return;
  try {
    await ScreenCapture.preventScreenCaptureAsync(key);
  } catch {
    // Sem atividade ou módulo indisponível: o visor abre na mesma.
  }
}

/** Volta a deixar capturar (sai só quando não houver mais nenhuma chave a bloquear). Na web não faz nada. */
export async function allowCapture(key: string): Promise<void> {
  if (!captureNative) return;
  try {
    await ScreenCapture.allowScreenCaptureAsync(key);
  } catch {
    // idem
  }
}

/** Corre `listener` quando se faz uma captura com a app à frente. Devolve o que desliga. Na web não faz nada. */
export function onScreenshot(listener: () => void): () => void {
  if (!captureNative) return () => undefined;
  try {
    const sub = ScreenCapture.addScreenshotListener(() => {
      if (AppState.currentState === 'active') listener();
    });
    return () => sub.remove();
  } catch {
    return () => undefined;
  }
}

/** A última vez que se mandou o aviso de cada conversa ou Zás (para não mandar mais de um a cada 5 s). */
const lastSent = new Map<string, number>();

/** Manda o aviso desta `key` se já passaram 5 s desde o último; os erros ficam por aqui (o aviso não é essencial). */
export function sendScreenshotNotice(key: string, send: () => Promise<unknown>): boolean {
  if (!takeScreenshotSlot(lastSent, key, Date.now())) return false;
  send().catch(() => undefined);
  return true;
}

/**
 * Numa conversa: enquanto o ecrã está focado (e a app à frente), uma captura chama `send` (no máximo uma vez a cada
 * 5 s por `key`). `key` null (a conversa ainda não carregou, ou não sou membro) não escuta. Na web não faz nada.
 */
export function useScreenshotNotice(key: string | null, send: () => Promise<unknown>) {
  const focused = useIsFocused();
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!captureNative || !focused || !key) return;
    return onScreenshot(() => void sendScreenshotNotice(key, () => sendRef.current()));
  }, [focused, key]);
}
