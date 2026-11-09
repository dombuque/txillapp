import { post, raw } from './api';

/**
 * Chamadas no browser: quem mostra a notificação a tocar é o service worker (public/push-sw.js), com Atender e Recusar.
 * Atender abre /call/<id>?from=<username>&video=<0|1>. Recusar não abre nada: o service worker pede a uma janela
 * aberta do Txillapp que recuse (só a página tem a sessão); sem janela aberta a chamada acaba como perdida.
 */

export const CALL_CHANNEL = 'calls';
export const CALL_CATEGORY = 'call';
export const CALL_ANSWER = 'answer';
export const CALL_DECLINE = 'decline';

export interface IncomingCall { callId: string; from: string; video: boolean }
type Opener = (c: IncomingCall) => unknown;

export function callFromData(data: unknown): IncomingCall | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.kind !== 'call' || typeof d.callId !== 'string' || !d.callId) return null;
  const v = d.video;
  return { callId: d.callId, from: typeof d.from === 'string' ? d.from : '', video: v === true || v === '1' || v === 1 || v === 'true' };
}

export const isMissedCall = (data: unknown) => ((data ?? {}) as Record<string, unknown>).kind === 'missed_call';

export const callPath = (c: IncomingCall) => `/call/${encodeURIComponent(c.callId)}?from=${encodeURIComponent(c.from)}&video=${c.video ? 1 : 0}`;

export function registerIncomingCallOpener(_fn: Opener | null) {
  /* no browser o service worker abre a página da chamada */
}

export function openIncomingCallFromPush(c: IncomingCall, go: (url: string) => void) {
  go(callPath(c));
}

export async function declineCall(callId: string, message?: string): Promise<void> {
  try {
    await raw(`/calls/${encodeURIComponent(callId)}/decline`, post(message ? { message } : {}));
  } catch {
    /* sem rede ou a chamada já acabou */
  }
}

/** Fecha a notificação a tocar desta chamada (por exemplo, quando se atende ou ela acaba dentro da app). */
export async function dismissCallNotification(callId?: string): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const list = (await reg?.getNotifications()) ?? [];
    for (const n of list) {
      const c = callFromData(n.data);
      if (c && (!callId || c.callId === callId)) n.close();
    }
  } catch {
    /* nada a fechar */
  }
}

export async function setupCallNotifications(): Promise<void> {
  /* no browser não há canais nem categorias */
}

export function handleCallResponse(_r: unknown, _go: (url: string) => void): boolean {
  return false;
}

export const isForegroundCall = (_n: unknown) => false;

/** Ouve o service worker: "recusar esta chamada" (botão Recusar da notificação). Devolve a função para desligar. */
export function installCallRing(_go?: (url: string) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
  const onMessage = (e: MessageEvent) => {
    const d = (e.data ?? {}) as { type?: string; callId?: string };
    if (d.type === 'tx-call-decline' && typeof d.callId === 'string' && d.callId) void declineCall(d.callId);
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}
