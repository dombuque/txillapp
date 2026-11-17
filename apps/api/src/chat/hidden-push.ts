import type { PushPayload } from '../push/push.service';
import { msg } from '../i18n/i18n';

/**
 * Conversas escondidas (0160): o aviso no telemóvel de uma conversa (a dois ou TxillGroup) que a pessoa escondeu vai sem
 * pré-visualização: nem quem escreveu, nem o grupo, nem o que foi. Só «Txillapp · Nova mensagem», sem som de destaque:
 *  - Android: o canal «discreto» (a app cria-o com importância baixa: sem som nem faixa por cima);
 *  - iPhone: `interruption-level: passive` (vai para a lista sem acender o ecrã nem tocar);
 *  - browser: `quiet: '1'` nos dados (o service worker mostra-a com `silent`).
 * Todas as escondidas partilham a mesma etiqueta: a nova substitui a anterior. O endereço (para onde abre) fica.
 */
export const HIDDEN_PUSH_TITLE = 'Txillapp';
export const HIDDEN_PUSH_BODY = msg('Nova mensagem');
export const HIDDEN_PUSH_TAG = 'chat:hidden';
export const HIDDEN_PUSH_CHANNEL = 'discreto';

export function discreetPush(p: PushPayload): PushPayload {
  return {
    ...p,
    title: HIDDEN_PUSH_TITLE,
    body: HIDDEN_PUSH_BODY,
    tag: HIDDEN_PUSH_TAG,
    channel: HIDDEN_PUSH_CHANNEL,
    ios: { interruptionLevel: 'passive' },
    data: { ...(p.data ?? {}), quiet: '1' },
  };
}

/** O aviso normal ou, se a conversa está escondida para quem o recebe, o discreto. */
export const pushFor = (p: PushPayload, hidden: boolean): PushPayload => (hidden ? discreetPush(p) : p);
