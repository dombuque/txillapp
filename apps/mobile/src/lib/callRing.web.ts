import { post, raw } from './api';
import { dropIncoming, getCall, onCallState, openIncomingCall } from './calls';

/**
 * Chamadas no browser: quem mostra a notificação a tocar é o service worker (public/push-sw.js), com Atender e Recusar.
 * Atender (ou tocar na notificação) abre /call/<id>?from=<username>&video=<0|1>&accept=1 e a app atende logo.
 * Recusar recusa a partir do service worker (com o código que vem no aviso); sem ele, pede a uma janela aberta que recuse.
 * Com a app aberta, o service worker avisa a página ('tx-call-ring', 'tx-call-end') e, ao voltar à app, uma chamada que
 * ainda está a tocar (notificação aberta) passa para o ecrã de chamada.
 */

/** Uma notificação de chamada com mais do que isto já não toca (o toque do servidor é de 45 s). */
const RING_MAX_MS = 60_000;

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
      if ((c && (!callId || c.callId === callId)) || (callId && n.tag === `call-${callId}` && !isMissedCall(n.data))) n.close();
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

/** A chamada de uma notificação (com o nome que veio no aviso), ou null se não for de chamada ou já for antiga. */
export function ringingFromNotification(n: { data?: unknown; timestamp?: number }, now = Date.now()): (IncomingCall & { name: string }) | null {
  const c = callFromData(n.data);
  if (!c) return null;
  const d = (n.data ?? {}) as Record<string, unknown>;
  const at = Number(d.at ?? n.timestamp ?? 0);
  if (at && now - at > RING_MAX_MS) return null;
  return { ...c, name: typeof d.name === 'string' && d.name ? d.name : c.from };
}

/** Passa a tocar no ecrã de chamada da app (se não estiver já noutra). */
function adopt(c: { callId: string; from: string; name?: string; video: boolean }) {
  if (!c.callId || !c.from) return;
  const cur = getCall();
  if (cur.phase !== 'idle' && cur.callId !== c.callId) return;
  openIncomingCall({ callId: c.callId, from: { username: c.from, displayName: c.name || c.from, hasAvatar: true }, video: c.video });
}

/** Ao voltar à app (ou ao abri-la): uma chamada que ainda toca na notificação passa para o ecrã de chamada. */
async function adoptFromNotifications() {
  try {
    if (getCall().phase !== 'idle') return;
    const reg = await navigator.serviceWorker.getRegistration();
    for (const n of (await reg?.getNotifications()) ?? []) {
      const c = ringingFromNotification(n);
      if (!c) continue;
      adopt(c);
      n.close();
      return;
    }
  } catch {
    /* sem service worker */
  }
}

/**
 * Ouve o service worker (Recusar da notificação; chamada a tocar ou terminada noutro sítio), mostra o ecrã de chamada
 * quando se volta à app com uma chamada a tocar e fecha a notificação quando a chamada é atendida aqui.
 * Devolve a função para desligar.
 */
export function installCallRing(_go?: (url: string) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
  const later = (id: string) => setTimeout(() => void dismissCallNotification(id), 1500);
  const onMessage = (e: MessageEvent) => {
    const d = (e.data ?? {}) as { type?: string; callId?: string; call?: { callId?: string; from?: string; name?: string; video?: boolean } };
    if (d.type === 'tx-call-decline' && typeof d.callId === 'string' && d.callId) void declineCall(d.callId);
    else if (d.type === 'tx-call-end' && typeof d.callId === 'string' && d.callId) {
      dropIncoming(d.callId);
      later(d.callId);
    } else if (d.type === 'tx-call-ring' && d.call && typeof d.call.callId === 'string') {
      // O canal em tempo real pode ter falhado o aviso (separador congelado em segundo plano).
      adopt({ callId: d.call.callId, from: String(d.call.from ?? ''), name: d.call.name, video: !!d.call.video });
      if (document.visibilityState === 'visible') later(d.call.callId);
    }
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') void adoptFromNotifications();
  };
  // Atendida, a ligar ou já em curso aqui (ou a tocar com a app à vista): a notificação já não faz falta.
  let closedFor: string | null = null;
  const offState = onCallState(() => {
    const s = getCall();
    if (!s.callId || s.phase === 'idle') return;
    const seen = s.phase !== 'incoming' || document.visibilityState === 'visible';
    if (seen && closedFor !== `${s.callId}:${s.phase}`) {
      closedFor = `${s.callId}:${s.phase}`;
      void dismissCallNotification(s.callId);
    }
  });
  navigator.serviceWorker.addEventListener('message', onMessage);
  document.addEventListener('visibilitychange', onVisible);
  onVisible();
  return () => {
    navigator.serviceWorker.removeEventListener('message', onMessage);
    document.removeEventListener('visibilitychange', onVisible);
    offState();
  };
}
