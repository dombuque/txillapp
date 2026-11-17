import { AppState, Platform } from 'react-native';
import { api, uploadChatMedia } from './api';
import { gruposApi } from './api.grupos';
import { NATIVE_RETRY_DELAYS, configurePending, forgetPendingUser, setPendingUser, wakePending, type PendingRequest, type SentReply } from './chatPending';
import { chatMediaUri, dropChatMedia } from './chatMediaStore';
import { loadOutbox, saveOutbox } from './chatOutboxStore';
import type { ChatGif } from './gifs';

/**
 * A fila das mensagens a caminho (lib/chatPending) ligada à app: o pedido ao servidor (conversa a dois ou TxillGroup, com
 * o `clientId` para o servidor não duplicar; voz, fotos e vídeos sobem primeiro do ficheiro guardado, lib/chatMediaStore),
 * onde ficam guardadas por conta, e quando tentar outra vez: a rede volta (no browser: eventos 'online'), a app volta ao
 * primeiro plano (AppState 'active' e, na web, visibilitychange). Em segundo plano não se tenta (não gasta bateria nem
 * dados). No telemóvel não há módulo de rede: com a app à frente tenta-se no máximo de 15 em 15 s.
 */
const web = Platform.OS === 'web';

/** O ficheiro já não está neste aparelho: não dá para enviar (fica «Não enviada», com «Apagar»). */
const gone = () => Object.assign(new Error('O ficheiro desta mensagem já não está neste aparelho.'), { status: 410 });

/** Envia um pedido da fila (ou um envio direto de voz e fotos, já com o `mediaId`, no mesmo formato). */
export async function sendChatRequest(r: PendingRequest, ctx: { uploaded: (mediaId: string) => void } = { uploaded: () => undefined }): Promise<SentReply> {
  let mediaId = r.mediaId;
  if (r.media && !mediaId) {
    const uri = await chatMediaUri(r.media.ref);
    if (!uri) throw gone();
    mediaId = await uploadChatMedia(uri, r.media.mime);
    ctx.uploaded(mediaId);
  }
  const body = {
    kind: r.kind,
    body: r.body,
    clientId: r.clientId,
    ...(r.gif ? { gif: r.gif as ChatGif } : null),
    ...(r.replyTo ? { replyTo: r.replyTo } : null),
    ...(mediaId ? { mediaId } : null),
    ...(r.media?.durationMs ? { durationMs: r.media.durationMs } : null),
    ...(r.media?.waveform ? { waveform: r.media.waveform } : null),
    // «Ver uma vez» só existe nas conversas a dois.
    ...(r.media?.once && r.conv.startsWith('u:') ? { once: true } : null),
  };
  if (r.conv.startsWith('u:')) return api.chatSend(r.conv.slice(2), body);
  if (r.conv.startsWith('g:')) return gruposApi.send(r.conv.slice(2), body);
  throw Object.assign(new Error('Conversa desconhecida'), { status: 400 });
}

/** No browser, `navigator.onLine === false` é de certeza sem rede (true pode enganar: aí tenta-se e vê-se). */
const online = () => !(web && typeof navigator !== 'undefined' && navigator.onLine === false);
/** Em segundo plano (app minimizada, separador escondido) não se tenta. */
const active = () => (web && typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : AppState.currentState === 'active');

let started = false;
/** Uma vez, ao arrancar a app (no AuthProvider). */
export function startChatOutbox(): void {
  if (started) return;
  started = true;
  configurePending({
    transport: sendChatRequest,
    online,
    active,
    store: { load: loadOutbox, save: saveOutbox },
    media: { resolve: chatMediaUri, drop: dropChatMedia },
    ...(web ? null : { retryDelays: NATIVE_RETRY_DELAYS }),
  });
  AppState.addEventListener('change', (s) => { if (s === 'active') wakePending(); });
  if (web && typeof window !== 'undefined') {
    window.addEventListener('online', () => wakePending());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wakePending(); });
  }
}

/** A conta com sessão: carrega e envia as que ficaram à espera (null ao sair ou sem sessão). */
export const setOutboxUser = (id: string | null) => void setPendingUser(id);
/** Terminar sessão: as que estavam à espera desta conta são esquecidas (e já não se enviam), com os ficheiros. */
export const forgetOutboxUser = (id: string) => forgetPendingUser(id);
