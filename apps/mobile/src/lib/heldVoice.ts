import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { newClientId, shouldRetry } from './chatPending';

/**
 * Mensagens de voz gravadas sem rede: não se perdem. Ficam guardadas na barra de escrever (enquanto a conversa está aberta)
 * e vão sozinhas, pela ordem, quando a rede volta (evento 'online' no browser, a app volta ao primeiro plano, e a cada
 * tanto). Levam um `clientId` (como as de texto, lib/chatPending): repetir o envio não as duplica; o ficheiro só sobe uma
 * vez (`mediaId`). Só uma recusa do servidor (4xx) deita uma fora, com o erro.
 */
export interface HeldVoice { uri: string; mime: string; durationMs: number; once?: boolean; replyTo?: string; clientId: string; mediaId?: string }

/** Entre tentativas automáticas (a última repete-se para sempre). */
const DELAYS = [5_000, 10_000, 30_000, 60_000];

export function newHeldVoice(v: Omit<HeldVoice, 'clientId'>): HeldVoice {
  return { ...v, clientId: newClientId() };
}

/** O texto por cima da barra: quantas estão à espera e se está a tentar agora. */
export function heldVoiceLabel(n: number, trying: boolean): string {
  if (trying) return n > 1 ? `A enviar as mensagens de voz (${n})…` : 'A enviar a mensagem de voz…';
  return n > 1
    ? `Sem rede. ${n} mensagens de voz ficam guardadas aqui e vão sozinhas quando a rede voltar.`
    : 'Sem rede. A mensagem de voz fica guardada aqui e vai sozinha quando a rede voltar.';
}

const online = () => !(Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false);

/**
 * `send` sobe o ficheiro (se ainda não tem `mediaId`, guarda-o em `v.mediaId`) e envia; lança o erro se não conseguir.
 * `submit(v)`: envia já, ou fica guardada (atrás das que já estão à espera, para não passar à frente).
 */
export function useHeldVoice(send: (v: HeldVoice) => Promise<void>, onError: (msg: string) => void) {
  const [held, setHeld] = useState<HeldVoice[]>([]);
  const [trying, setTrying] = useState(false);
  const heldRef = useRef(held);
  heldRef.current = held;
  const sendRef = useRef(send);
  sendRef.current = send;
  const errRef = useRef(onError);
  errRef.current = onError;
  const busy = useRef(false);

  /** Envia as guardadas pela ordem até uma ficar outra vez à espera. */
  const flush = useCallback(async () => {
    if (busy.current || !online()) return;
    busy.current = true;
    setTrying(true);
    try {
      while (heldRef.current.length) {
        const v = heldRef.current[0];
        try {
          await sendRef.current(v);
        } catch (e) {
          if (shouldRetry(e)) return;
          errRef.current((e as Error).message || 'Não consegui enviar a mensagem de voz');
        }
        heldRef.current = heldRef.current.filter((x) => x.clientId !== v.clientId);
        setHeld(heldRef.current);
      }
    } finally {
      busy.current = false;
      setTrying(false);
    }
  }, []);

  const submit = useCallback(async (v: HeldVoice) => {
    heldRef.current = [...heldRef.current, v];
    setHeld(heldRef.current);
    await flush();
  }, [flush]);

  const waiting = held.length > 0;
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const again = () => { if (alive) void flush(); };
    const next = () => {
      t = setTimeout(() => {
        again();
        n++;
        if (alive) next();
      }, DELAYS[Math.min(n, DELAYS.length - 1)]);
    };
    next();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') again(); });
    const web = Platform.OS === 'web' && typeof window !== 'undefined';
    if (web) window.addEventListener('online', again);
    return () => {
      alive = false;
      if (t) clearTimeout(t);
      sub.remove();
      if (web) window.removeEventListener('online', again);
    };
  }, [waiting, flush]);

  /** «Apagar»: esquece as guardadas (as que ainda não foram). */
  const drop = useCallback(() => {
    heldRef.current = [];
    setHeld([]);
  }, []);

  return { held, trying, submit, drop };
}
