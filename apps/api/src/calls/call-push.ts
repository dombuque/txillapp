import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PushPayload } from '../push/push.service';

/**
 * Avisos push de uma chamada a tocar (separado do serviço para se poder testar sem base de dados).
 *
 * Web Push (site instalado no telemóvel) não tem toque contínuo: o service worker mostra uma notificação. Para ela voltar
 * a vibrar e a soar como um telefone, o servidor reenvia o aviso de 9 em 9 s enquanto a chamada está a tocar (até 30 s),
 * só por Web Push (a app nativa tem o seu próprio toque). Quando a chamada é atendida ou recusada, vai um aviso
 * `call_end` que fecha a notificação em todos os browsers da pessoa; perdida ou cancelada, o aviso de chamada perdida
 * (mesma etiqueta) toma o lugar dela.
 */

/** De quanto em quanto tempo se reenvia o aviso a tocar (Web Push). */
export const RING_REPEAT_MS = 9_000;
/** Até quando se reenvia (mesmo que o toque dure mais): depois disso a notificação fica, sem voltar a tocar. */
export const RING_REPEAT_MAX_S = 30;

/** Quando (ms depois de começar a tocar) se reenvia o aviso: 9, 18 e 27 s com o toque de 45 s. */
export function ringRepeatDelays(ringSeconds: number, every = RING_REPEAT_MS, maxS = RING_REPEAT_MAX_S): number[] {
  const limit = Math.min(ringSeconds, maxS) * 1000;
  const out: number[] = [];
  if (!(every > 0)) return out;
  for (let t = every; t < limit; t += every) out.push(t);
  return out;
}

const tokenKey = (secret: string) => createHmac('sha256', secret).update('txillapp:call-decline').digest();

/**
 * Código que só serve para recusar ESTA chamada, por quem a recebe. Vai dentro do aviso Web Push (cifrado para o
 * browser da pessoa): o botão Recusar do service worker não tem a sessão (está num cookie e na memória da página).
 */
export function declineToken(secret: string, callId: string, calleeId: string): string {
  return createHmac('sha256', tokenKey(secret)).update(`${callId}:${calleeId}`).digest('base64url');
}

export function checkDeclineToken(secret: string, callId: string, calleeId: string, token: string): boolean {
  const want = Buffer.from(declineToken(secret, callId, calleeId));
  const got = Buffer.from(String(token ?? ''));
  return got.length === want.length && timingSafeEqual(got, want);
}

const ackKey = (secret: string) => createHmac('sha256', secret).update('txillapp:call-ack').digest();
const ackSig = (secret: string, callId: string, calleeId: string, exp: number) => createHmac('sha256', ackKey(secret)).update(`${callId}:${calleeId}:${exp}`).digest('base64url');

/** Folga do código «chegou» além do tempo de toque (reenvios atrasados e relógios um pouco desacertados). */
export const ACK_GRACE_S = 30;

/**
 * Código «a chamada chegou a este aparelho» (POST /calls/:id/ringing?ack=…, sem sessão). Vai no aviso push da chamada
 * para o service worker do browser e para o serviço de mensagens da app Android, que não têm a sessão. Só serve para
 * marcar ESTA chamada como entregue, por quem a recebe, e só até `exp` (segundos desde 1970). Formato: `<exp>.<assinatura>`.
 */
export function ackToken(secret: string, callId: string, calleeId: string, exp: number): string {
  return `${exp}.${ackSig(secret, callId, calleeId, exp)}`;
}

/** O código confere com esta chamada e esta pessoa e ainda não passou do prazo. */
export function checkAckToken(secret: string, callId: string, calleeId: string, token: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(String(token ?? ''));
  if (!m) return false;
  const exp = Number(m[1]);
  const want = Buffer.from(ackSig(secret, callId, calleeId, exp));
  const got = Buffer.from(m[2]);
  return got.length === want.length && timingSafeEqual(got, want) && nowS <= exp;
}

export interface RingInfo {
  id: string;
  video: boolean;
  caller: { username: string; displayName: string };
  ttlSeconds: number;
  /** Só no Web Push: o código para recusar a partir da notificação. */
  declineToken?: string;
  /** Reenvio (só Web Push). */
  repeat?: boolean;
  /** O código «chegou» (ver ackToken) e o endereço completo para o usar (a app Android não sabe sozinha onde está a API). */
  ackToken?: string;
  ackUrl?: string;
}

/** O aviso de chamada a tocar. O que vai para a app nativa (FCM) é sempre o mesmo; o resto só vai no Web Push. */
export function ringPush(r: RingInfo): PushPayload {
  return {
    title: r.caller.displayName,
    body: r.video ? 'Videochamada' : 'Está a ligar-te',
    url: `/call/${r.id}?from=${encodeURIComponent(r.caller.username)}&video=${r.video ? 1 : 0}`,
    tag: `call-${r.id}`,
    data: { kind: 'call', callId: r.id, from: r.caller.username, video: r.video ? '1' : '0', ...(r.ackToken ? { ackToken: r.ackToken } : {}), ...(r.ackUrl ? { ackUrl: r.ackUrl } : {}) },
    ...(r.declineToken || r.repeat ? { webData: { ...(r.declineToken ? { declineToken: r.declineToken } : {}), ...(r.repeat ? { repeat: '1' } : {}) } } : {}),
    ...(r.repeat ? { webOnly: true } : {}),
    dataOnly: true,
    channel: 'calls',
    actionCategory: 'call',
    ios: { sound: 'ring.wav', interruptionLevel: 'time-sensitive' },
    ttlSeconds: Math.max(1, Math.round(r.ttlSeconds)),
  };
}

/** A chamada deixou de tocar (atendida ou recusada, aqui ou noutro aparelho): o service worker fecha a notificação. */
export function endPush(callId: string, reason: 'accepted' | 'declined'): PushPayload {
  return {
    title: 'Txillapp',
    body: reason === 'accepted' ? 'Chamada atendida' : 'Chamada recusada',
    url: '/calls',
    tag: `call-${callId}`,
    data: { kind: 'call_end', callId, reason },
    webOnly: true,
    ttlSeconds: 60,
  };
}
