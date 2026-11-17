import { AppState, Platform } from 'react-native';
import { api } from './api';
import { gruposApi } from './api.grupos';
import { configurePending, forgetPendingUser, setPendingUser, wakePending, type PendingRequest, type SentReply } from './chatPending';
import { loadOutbox, saveOutbox } from './chatOutboxStore';
import type { ChatGif } from './gifs';

/**
 * A fila das mensagens a caminho (lib/chatPending) ligada à app: o pedido ao servidor (conversa a dois ou TxillGroup, com
 * o `clientId` para o servidor não duplicar), onde ficam guardadas por conta, e quando tentar outra vez: a rede volta
 * (só no browser: eventos 'online'), a app volta ao primeiro plano (AppState 'active' e, na web, visibilitychange).
 * No telemóvel não há módulo de rede: valem o recuo da fila e o primeiro plano.
 */
const web = Platform.OS === 'web';

function transport(r: PendingRequest): Promise<SentReply> {
  const body = { kind: r.kind, body: r.body, ...(r.gif ? { gif: r.gif as ChatGif } : null), ...(r.replyTo ? { replyTo: r.replyTo } : null), clientId: r.clientId };
  if (r.conv.startsWith('u:')) return api.chatSend(r.conv.slice(2), body);
  if (r.conv.startsWith('g:')) return gruposApi.send(r.conv.slice(2), body);
  return Promise.reject(Object.assign(new Error('Conversa desconhecida'), { status: 400 }));
}

/** No browser, `navigator.onLine === false` é de certeza sem rede (true pode enganar: aí tenta-se e vê-se). */
const online = () => !(web && typeof navigator !== 'undefined' && navigator.onLine === false);

let started = false;
/** Uma vez, ao arrancar a app (components do AuthProvider). */
export function startChatOutbox(): void {
  if (started) return;
  started = true;
  configurePending({ transport, online, store: { load: loadOutbox, save: saveOutbox } });
  AppState.addEventListener('change', (s) => { if (s === 'active') wakePending(); });
  if (web && typeof window !== 'undefined') {
    window.addEventListener('online', () => wakePending());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wakePending(); });
  }
}

/** A conta com sessão: carrega e envia as que ficaram à espera (null ao sair ou sem sessão). */
export const setOutboxUser = (id: string | null) => void setPendingUser(id);
/** Terminar sessão: as que estavam à espera desta conta são esquecidas (e já não se enviam). */
export const forgetOutboxUser = (id: string) => forgetPendingUser(id);
