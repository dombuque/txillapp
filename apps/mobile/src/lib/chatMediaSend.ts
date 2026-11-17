import { uploadChatMedia } from './api';
import { newClientId, pendingOnline, pendingWaiting, replyOf, sendPending, shouldRetry } from './chatPending';
import { chatMediaSize, keepChatMedia } from './chatMediaStore';
import { sendChatRequest } from './chatOutbox';
import { confirm } from './confirm';

/**
 * Enviar uma mensagem de voz, foto ou vídeo numa conversa (`u:<username>`) ou num TxillGroup (`g:<id>`). Com rede vai já,
 * como sempre (sobe e envia). Sem rede, se o envio falhar a meio por falta de rede, ou se já há mensagens à espera nesta
 * conversa (para não passar à frente delas): o ficheiro fica guardado neste aparelho e a mensagem entra na fila
 * (lib/chatPending), com o reloginho na conversa, e vai sozinha quando a rede voltar. O `clientId` é o mesmo do envio
 * direto: se esse chegou ao servidor, o reenvio não duplica. Um ficheiro grande (BIG_BYTES) pede confirmação antes.
 * Devolve 'sent' (foi já), 'queued' (fica à espera) ou 'cancelled' (não quis guardar o ficheiro grande).
 */
export const BIG_BYTES = 25 * 1024 * 1024;

export interface ChatMediaItem {
  kind: 'voice' | 'image' | 'video';
  uri: string;
  mime: string;
  body?: string;
  durationMs?: number;
  once?: boolean;
  /** A resposta da barra de escrever ({ id, text, who }). */
  reply?: { id: string; text: string; who?: string } | null;
}

/** O aviso quando não deu para guardar o ficheiro sem rede. */
export const KEEP_FAILED_TEXT = 'Sem rede, e não consegui guardar o ficheiro neste aparelho. Tenta outra vez quando a rede voltar.';

export function bigLabel(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export async function sendChatMedia(conv: string, item: ChatMediaItem, onSent: () => void): Promise<'sent' | 'queued' | 'cancelled'> {
  const clientId = newClientId();
  const req = {
    conv, kind: item.kind, body: item.body ?? '', clientId,
    ...(item.reply ? { replyTo: item.reply.id } : null),
  };
  const media = { mime: item.mime, ...(item.durationMs ? { durationMs: item.durationMs } : null), ...(item.once ? { once: true } : null) };
  let mediaId: string | undefined;
  if (pendingOnline() && !pendingWaiting(conv)) {
    try {
      mediaId = await uploadChatMedia(item.uri, item.mime);
      await sendChatRequest({ ...req, mediaId, media: { ref: '', ...media } });
      onSent();
      return 'sent';
    } catch (e) {
      if (!shouldRetry(e)) throw e;
    }
  }
  // Sem rede: guarda o ficheiro e põe na fila.
  if (!mediaId) {
    const size = await chatMediaSize(item.uri);
    if (size && size > BIG_BYTES) {
      const ok = await confirm({
        title: 'Guardar para enviar depois?',
        message: `Estás sem rede. Este ${item.kind === 'video' ? 'vídeo' : 'ficheiro'} tem ${bigLabel(size)}: fica guardado neste aparelho e vai sozinho quando houver rede.`,
        confirm: 'Tentar quando houver rede',
      });
      if (!ok) return 'cancelled';
    }
  }
  let kept: { ref: string; uri: string };
  try {
    kept = await keepChatMedia(item.uri, item.mime);
  } catch {
    throw new Error(KEEP_FAILED_TEXT);
  }
  void sendPending(conv, { kind: item.kind, body: item.body ?? '', replyTo: replyOf(item.reply), media: { ref: kept.ref, ...media }, localUri: kept.uri }, { onSent, clientId, mediaId });
  return 'queued';
}
