import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { post, raw } from './api';

/**
 * Chamadas 1:1 a tocar com a app em segundo plano ou fechada (app nativa). Este ficheiro é a ponte entre as
 * notificações push e o ecrã de chamada (lib/calls, de outra equipa):
 *  - canal "calls" no Android (importância máxima, toque próprio em res/raw/ring.wav, vibração longa);
 *  - categoria "call" com os botões Atender e Recusar (Android e iPhone);
 *  - com a app à frente a notificação do sistema não aparece (o ecrã de chamada da app trata disso);
 *  - tocar na notificação ou em Atender abre a chamada com openIncomingCall; Recusar avisa o servidor.
 *
 * O servidor manda pelo FCM: data { kind: 'call', callId, caller, video: '1' | '0' } (quem liga vai em `caller`: "from"
 * é chave reservada do FCM, que recusava a mensagem; `from` ainda se aceita, de mensagens antigas), título com o nome de quem liga,
 * texto "Está a ligar-te" ou "Videochamada", canal "calls". A chamada perdida é kind: 'missed_call' e abre /calls.
 */

export const CALL_CHANNEL = 'calls';
export const CALL_CATEGORY = 'call';
export const CALL_ANSWER = 'answer';
export const CALL_DECLINE = 'decline';
/** Uma chamada que ninguém atendeu em 60 s já acabou: tocar numa notificação antiga leva à lista de chamadas. */
const RING_MAX_MS = 60_000;

export interface IncomingCall { callId: string; from: string; video: boolean }
type Opener = (c: IncomingCall) => unknown;

/**
 * Lê os dados de uma notificação de chamada (vêm como texto no FCM: video = '1' ou '0'). Quem liga vem em `caller`
 * (o FCM não aceita a chave "from" em data e recusava a mensagem inteira); `from` fica para o Web Push e mensagens antigas.
 */
export function callFromData(data: unknown): IncomingCall | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.kind !== 'call' || typeof d.callId !== 'string' || !d.callId) return null;
  const v = d.video;
  const who = typeof d.caller === 'string' ? d.caller : typeof d.from === 'string' ? d.from : '';
  return { callId: d.callId, from: who, video: v === true || v === '1' || v === 1 || v === 'true' };
}

export const isMissedCall = (data: unknown) => ((data ?? {}) as Record<string, unknown>).kind === 'missed_call';

export const callPath = (c: IncomingCall) => `/call/${encodeURIComponent(c.callId)}?from=${encodeURIComponent(c.from)}&video=${c.video ? 1 : 0}`;

let registered: Opener | null = null;
/** Opcional: o módulo das chamadas pode registar aqui a sua função (em vez de ser procurado em lib/calls). */
export function registerIncomingCallOpener(fn: Opener | null) {
  registered = fn;
}

/**
 * Procura openIncomingCall em lib/calls sem o importar de forma fixa: enquanto esse módulo não existir a app compila
 * na mesma (o Metro aceita require opcional dentro de try/catch) e cai no endereço /call/<id>.
 */
function opener(): Opener | null {
  if (registered) return registered;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./calls') as { openIncomingCall?: Opener };
    return typeof m?.openIncomingCall === 'function' ? m.openIncomingCall : null;
  } catch {
    return null;
  }
}

/** Abre a chamada que chegou: pelo openIncomingCall da app, ou pelo endereço da chamada se ele não existir. */
export function openIncomingCallFromPush(c: IncomingCall, go: (url: string) => void) {
  const fn = opener();
  if (fn) {
    try {
      void Promise.resolve(fn(c)).catch(() => go(callPath(c)));
      return;
    } catch {
      /* falhou logo: segue pelo endereço */
    }
  }
  go(callPath(c));
}

/** Recusar sem atender (botão Recusar da notificação). Sem rede, a chamada acaba sozinha como perdida. */
export async function declineCall(callId: string, message?: string): Promise<void> {
  try {
    await raw(`/calls/${encodeURIComponent(callId)}/decline`, post(message ? { message } : {}));
  } catch {
    /* sem rede ou a chamada já acabou */
  }
}

/** Tira da barra as notificações desta chamada (o toque também pára). O ecrã de chamada pode chamar isto ao atender ou desligar. */
export async function dismissCallNotification(callId?: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const list = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      list
        .filter((n) => { const c = callFromData(n.request.content.data); return !!c && (!callId || c.callId === callId); })
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    /* nada a tirar */
  }
}

/** Canal e categoria das chamadas. Têm de existir antes de a primeira chamada chegar (corre a cada arranque, é barato). */
export async function setupCallNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if (Platform.OS === 'android') {
      // Atenção: no Android o som e a vibração de um canal ficam fixos depois de criado. Para mudar, usar um id novo.
      await Notifications.setNotificationChannelAsync(CALL_CHANNEL, {
        name: 'Chamadas',
        description: 'Toca quando alguém te liga no Txillapp.',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'ring.wav',
        audioAttributes: { usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE, contentType: Notifications.AndroidAudioContentType.SONIFICATION },
        vibrationPattern: [0, 900, 700, 900, 700, 900, 700, 900, 700, 900],
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        lightColor: '#d6334f',
        bypassDnd: false,
      });
    }
    // Recusar também abre a app: o expo-notifications só corre código com a app fechada através do expo-task-manager,
    // que não está instalado. Assim a recusa chega sempre ao servidor (a app abre, recusa e fica no início).
    await Notifications.setNotificationCategoryAsync(CALL_CATEGORY, [
      { identifier: CALL_ANSWER, buttonTitle: 'Atender', options: { opensAppToForeground: true } },
      { identifier: CALL_DECLINE, buttonTitle: 'Recusar', options: { opensAppToForeground: true, isDestructive: true } },
    ]);
  } catch {
    /* sem suporte neste aparelho: as chamadas chegam pelo canal normal */
  }
}

const handled = new Set<string>();

/**
 * Trata o toque numa notificação de chamada ou de chamada perdida. Devolve true se era uma delas (o resto segue
 * o caminho normal das notificações, pelo url).
 */
export function handleCallResponse(r: Notifications.NotificationResponse, go: (url: string) => void): boolean {
  const content = r.notification.request.content;
  if (isMissedCall(content.data)) {
    go('/calls');
    return true;
  }
  const c = callFromData(content.data);
  if (!c) return false;
  // A mesma resposta pode chegar duas vezes (a última ao arrancar e o ouvinte): só se trata uma.
  const key = `${r.notification.request.identifier}:${r.actionIdentifier}`;
  if (handled.has(key)) return true;
  handled.add(key);
  void Notifications.dismissNotificationAsync(r.notification.request.identifier).catch(() => undefined);
  if (r.actionIdentifier === CALL_DECLINE) {
    void declineCall(c.callId);
    return true;
  }
  const at = typeof r.notification.date === 'number' ? r.notification.date : Date.now();
  // A data pode vir em segundos nalguns aparelhos.
  const ms = at < 1e12 ? at * 1000 : at;
  if (Date.now() - ms > RING_MAX_MS) {
    go('/calls');
    return true;
  }
  openIncomingCallFromPush(c, go);
  return true;
}

/** Com a app à frente, as chamadas não mostram a notificação do sistema (o ecrã da app já toca). */
export const isForegroundCall = (n: Notifications.Notification) => !!callFromData(n.request.content.data);

/** No browser é o service worker que trata os botões; na app nativa não há nada a ligar aqui. */
export function installCallRing(_go?: (url: string) => void): () => void {
  return () => undefined;
}
