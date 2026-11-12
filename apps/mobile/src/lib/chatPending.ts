/**
 * Mensagens a caminho (envio otimista), sem React nem imports da app (testado em tests/chatPending.test.mjs).
 *
 * Ao tocar em Enviar (texto, sticker ou GIF), a bolha aparece logo na conversa; o servidor confirma depois. Fica aqui,
 * fora da cache do react-query, para um refetch que já ia a caminho não a apagar (e a voltar a pôr: piscava). A lista
 * junta-as às do servidor com `mergePending`:
 *  - ainda sem resposta: em cima (são as mais recentes), sem "A enviar…" no primeiro instante (SLOW_MS) para não piscar;
 *  - confirmada (o servidor deu o id): já com o id verdadeiro, à espera que o refetch a traga;
 *  - quando o servidor a traz: sai daqui e a do servidor fica com a MESMA chave na lista (`listKey`), sem remontar;
 *  - falhou: fica com "Não enviada · Tentar de novo" (e "Apagar"); o texto nunca se perde;
 *  - mensagens temporárias: a resposta do servidor traz `expiresAt`; passada essa hora a confirmada sai também daqui
 *    (o servidor já não a manda e não pode ficar à vista para sempre). "Limpar conversa" esquece as da conversa.
 * Ficam guardadas por conversa (`u:<username>` ou `g:<id>`) enquanto a app estiver aberta, também ao sair e voltar.
 */

export type PendingState = 'sending' | 'failed' | 'sent';

/** A citação da resposta, já no formato das bolhas (ChatMessage['replyTo']). */
export interface PendingReply { id: string; gone: false; fromMe: boolean; name: string; kind: string; body: string }

export interface PendingMsg {
  /** `tmp-…`: a chave da bolha na lista do princípio ao fim. */
  id: string;
  kind: 'text' | 'sticker' | 'gif';
  body: string;
  gif?: unknown;
  replyTo?: PendingReply | null;
  at: string;
  state: PendingState;
  /** Já passou SLOW_MS a enviar: mostra "A enviar…". */
  slow: boolean;
  /** O id que o servidor deu (depois de confirmar). */
  realId?: string;
  /** Mensagens temporárias: quando a confirmada expira (da resposta do servidor; null = fica). */
  expiresAt?: string | null;
  send: () => Promise<SentReply>;
  /** Depois de confirmada (a conversa vai buscar as mensagens outra vez). */
  onSent?: () => void;
}

/** Antes disto a bolha a enviar parece já enviada (sem "A enviar…" nem esbatida): a maioria chega antes. */
export const SLOW_MS = 900;

/** O que o servidor responde ao envio (o `expiresAt` com as mensagens temporárias ligadas). */
export interface SentReply { id: string; expiresAt?: string | null }

type Listener = () => void;
const byConv = new Map<string, readonly PendingMsg[]>();
const listeners = new Set<Listener>();
let seq = 0;
const EMPTY: readonly PendingMsg[] = Object.freeze([]);
/** id do servidor → a chave `tmp-…` com que a bolha nasceu (fica depois de sair daqui; só as últimas KEEP_KEYS). */
const keys = new Map<string, string>();
const KEEP_KEYS = 300;

/** A chave de uma mensagem na lista: a de quando estava a caminho, se foi enviada daqui; senão o próprio id. */
export function listKey(id: string): string {
  return keys.get(id) ?? id;
}

function emit() {
  listeners.forEach((f) => f());
}
function put(conv: string, list: readonly PendingMsg[]) {
  if (list.length) byConv.set(conv, list);
  else byConv.delete(conv);
  emit();
}
function patch(conv: string, id: string, f: (p: PendingMsg) => PendingMsg | null) {
  const list = byConv.get(conv);
  if (!list || !list.some((p) => p.id === id)) return;
  put(conv, list.flatMap((p) => (p.id === id ? (f(p) ?? []) : [p])));
}

/** As mensagens a caminho de uma conversa (a mais recente primeiro). A mesma referência enquanto nada muda. */
export function pendingOf(conv: string): readonly PendingMsg[] {
  return byConv.get(conv) ?? EMPTY;
}

export function subscribePending(f: Listener): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

export interface PendingInput { kind: PendingMsg['kind']; body?: string; gif?: unknown; replyTo?: PendingReply | null }

/**
 * O que a bolha a caminho mostra, a partir do que se vai enviar e da resposta da barra de escrever ({ id, text, who },
 * com who "ti" quando respondo a uma minha). Só texto, sticker e GIF (o resto tem de subir primeiro: foto, voz…): null.
 */
export function pendingFrom(msg: { kind?: string; body?: string; gif?: unknown }, reply?: { id: string; text: string; who?: string } | null): PendingInput | null {
  const kind = msg.kind ?? 'text';
  if (kind !== 'text' && kind !== 'sticker' && kind !== 'gif') return null;
  if (kind === 'gif' ? !msg.gif : !msg.body?.trim()) return null;
  const replyTo: PendingReply | null = reply ? { id: reply.id, gone: false, fromMe: reply.who === 'ti', name: reply.who === 'ti' ? '' : reply.who ?? '', kind: 'text', body: reply.text } : null;
  return { kind, body: msg.body ?? '', ...(msg.gif ? { gif: msg.gif } : null), replyTo };
}

async function run(conv: string, id: string): Promise<boolean> {
  const p = pendingOf(conv).find((x) => x.id === id);
  if (!p) return false;
  const t = setTimeout(() => patch(conv, id, (x) => (x.state === 'sending' ? { ...x, slow: true } : x)), SLOW_MS);
  try {
    const r = await p.send();
    clearTimeout(t);
    if (r?.id) {
      keys.set(r.id, id);
      if (keys.size > KEEP_KEYS) keys.delete(keys.keys().next().value as string);
    }
    patch(conv, id, (x) => ({ ...x, state: 'sent', slow: false, realId: r?.id, expiresAt: r?.expiresAt ?? null }));
    p.onSent?.();
    return true;
  } catch {
    clearTimeout(t);
    patch(conv, id, (x) => ({ ...x, state: 'failed', slow: false }));
    return false;
  }
}

/**
 * Põe a mensagem na conversa já e envia-a. Devolve se o servidor a aceitou (se não, a bolha fica com "Tentar de novo").
 * `send` é o pedido (com a resposta e o resto já lá dentro): serve também para tentar de novo.
 */
export function sendPending(conv: string, msg: PendingInput, send: () => Promise<SentReply>, opts: { onSent?: () => void; now?: Date } = {}): Promise<boolean> {
  const p: PendingMsg = {
    id: `tmp-${Date.now().toString(36)}-${++seq}`,
    kind: msg.kind,
    body: msg.body ?? '',
    gif: msg.gif,
    replyTo: msg.replyTo ?? null,
    at: (opts.now ?? new Date()).toISOString(),
    state: 'sending',
    slow: false,
    send,
    onSent: opts.onSent,
  };
  put(conv, [p, ...pendingOf(conv)]);
  return run(conv, p.id);
}

/** "Tentar de novo" numa que falhou. */
export function retryPending(conv: string, id: string): Promise<boolean> {
  const p = pendingOf(conv).find((x) => x.id === id);
  if (!p || p.state !== 'failed') return Promise.resolve(false);
  patch(conv, id, (x) => ({ ...x, state: 'sending', slow: false }));
  return run(conv, id);
}

/** "Apagar" numa que falhou (nunca chegou ao servidor: sai só daqui). */
export function dropPending(conv: string, id: string): void {
  patch(conv, id, () => null);
}

/**
 * As confirmadas que o servidor já trouxe saem daqui (a lista passa a mostrar a do servidor, com a mesma chave); as
 * confirmadas que já expiraram (mensagens temporárias) também.
 */
export function prunePending(conv: string, serverIds: ReadonlySet<string>, now: number = Date.now()): void {
  const list = pendingOf(conv);
  const gone = (p: PendingMsg) => (!!p.realId && serverIds.has(p.realId)) || expired(p, now);
  if (!list.some(gone)) return;
  put(conv, list.filter((p) => !gone(p)));
}

/** "Limpar conversa": esquece as que iam a caminho ou à espera do servidor nesta conversa. */
export function clearPending(conv: string): void {
  if (byConv.has(conv)) put(conv, []);
}

/** A confirmada já expirou (mensagens temporárias): sai da lista, mesmo que o servidor ainda não tenha respondido. */
function expired(p: PendingMsg, now: number): boolean {
  if (!p.expiresAt) return false;
  const t = Date.parse(p.expiresAt);
  return !Number.isNaN(t) && t <= now;
}

/** Para os testes: esquece tudo. */
export function resetPending(): void {
  byConv.clear();
  keys.clear();
  emit();
}

/** A bolha de uma mensagem a caminho, no formato das do servidor (ChatMessage + `state`). */
export interface PendingBubble {
  id: string;
  fromMe: true;
  kind: PendingMsg['kind'];
  body: string;
  gif?: unknown;
  replyTo: PendingReply | null;
  at: string;
  expiresAt: string | null;
  state?: 'sending' | 'failed';
  storyUrl: null;
  mediaUrl: null;
  durationMs: null;
  reactions: [];
}

function bubbleOf(p: PendingMsg): PendingBubble {
  const sent = p.state === 'sent' && !!p.realId;
  return {
    // Confirmada: já com o id verdadeiro (menu, vistos); a chave na lista continua a mesma (listKey).
    id: sent ? p.realId! : p.id,
    fromMe: true,
    kind: p.kind,
    body: p.body,
    ...(p.gif ? { gif: p.gif } : null),
    replyTo: p.replyTo ?? null,
    at: p.at,
    expiresAt: p.expiresAt ?? null,
    state: p.state === 'failed' ? 'failed' : p.state === 'sending' && p.slow ? 'sending' : undefined,
    storyUrl: null,
    mediaUrl: null,
    durationMs: null,
    reactions: [],
  };
}

/**
 * Junta as mensagens do servidor (a mais recente primeiro) com as que vão a caminho: as que o servidor ainda não tem
 * ficam em cima; as que já tem são as do servidor (com a mesma chave na lista, `listKey`: não remonta, não pisca).
 * Sem nada a caminho devolve a própria lista do servidor.
 */
export function mergePending<T extends { id: string }>(server: readonly T[], pending: readonly PendingMsg[], now: number = Date.now()): (T | PendingBubble)[] {
  if (!pending.length) return server as T[];
  const ids = new Set(server.map((m) => m.id));
  const head = pending.filter((p) => !(p.realId && ids.has(p.realId)) && !expired(p, now)).map(bubbleOf);
  return head.length ? [...head, ...server] : (server as T[]);
}
