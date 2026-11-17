/**
 * Mensagens a caminho (envio otimista e fila sem rede), sem React nem imports da app (testado em tests/chatPending.test.mjs).
 * A ligação à app (o pedido ao servidor, onde se guarda, a rede e o primeiro plano) está em lib/chatOutbox.ts.
 *
 * Ao tocar em Enviar (texto, sticker ou GIF), a bolha aparece logo na conversa; o servidor confirma depois. Fica aqui,
 * fora da cache do react-query, para um refetch que já ia a caminho não a apagar (e a voltar a pôr: piscava). A lista
 * junta-as às do servidor com `mergePending`. Como no WhatsApp:
 *  - cada conversa tem a sua fila e envia pela ordem (a mais antiga primeiro); uma à espera segura as seguintes;
 *  - ainda sem resposta: em cima (são as mais recentes), sem "A enviar…" no primeiro instante (SLOW_MS) para não piscar;
 *  - sem rede (ou o servidor em baixo: 5xx, 408, 429, sem resposta): fica "à espera" com o reloginho e tenta sozinha,
 *    para sempre, com recuo (RETRY_DELAYS, ou `retryDelays`), e logo que a rede volta ou a app volta ao primeiro plano
 *    (`wakePending`); com a app em segundo plano (`active` false) não tenta nem gasta;
 *  - só uma recusa do servidor (4xx: bloqueado, conversa fechada, texto inválido) fica "Não enviada" (e "Apagar");
 *  - confirmada (o servidor deu o id): já com o id verdadeiro, à espera que o refetch a traga;
 *  - quando o servidor a traz: sai daqui e a do servidor fica com a MESMA chave na lista (`listKey`), sem remontar;
 *  - mensagens temporárias: a resposta do servidor traz `expiresAt`; passada essa hora a confirmada sai também daqui.
 * Voz, fotos e vídeos sem rede entram também na fila: o ficheiro fica guardado no aparelho (`media.ref`, ver
 * lib/chatMediaStore) e só sobe quando a rede volta; o id do ficheiro já subido (`mediaId`) fica guardado para não subir
 * duas vezes. O ficheiro local apaga-se depois de enviada, ao apagar a mensagem e ao terminar sessão.
 * Cada mensagem leva um `clientId` (uuid deste aparelho): ao repetir um envio cuja resposta se perdeu, o servidor devolve a
 * mesma mensagem em vez de criar outra. As que estão à espera (e as recusadas) ficam guardadas por conta (`setPendingUser`),
 * com o nome da conversa (`notePendingTitle`, para o cabeçalho sem rede), e voltam ao abrir a app.
 */

export type PendingState = 'sending' | 'waiting' | 'failed' | 'sent';
export type PendingKind = 'text' | 'sticker' | 'gif' | 'voice' | 'image' | 'video';
const KINDS: readonly PendingKind[] = ['text', 'sticker', 'gif', 'voice', 'image', 'video'];
const isMediaKind = (k: PendingKind) => k === 'voice' || k === 'image' || k === 'video';

/** A citação da resposta, já no formato das bolhas (ChatMessage['replyTo']). */
export interface PendingReply { id: string; gone: false; fromMe: boolean; name: string; kind: string; body: string }

/** O ficheiro de uma mensagem de voz, foto ou vídeo, guardado neste aparelho até subir. */
export interface PendingMedia { ref: string; mime: string; durationMs?: number; once?: boolean; waveform?: string }

export interface PendingMsg {
  /** `tmp-…`: a chave da bolha na lista do princípio ao fim. */
  id: string;
  /** Vai no pedido: o servidor não cria a mesma mensagem duas vezes. */
  clientId: string;
  kind: PendingKind;
  body: string;
  gif?: unknown;
  replyTo?: PendingReply | null;
  /** Voz, foto ou vídeo: o ficheiro guardado neste aparelho. */
  media?: PendingMedia;
  /** O ficheiro já subiu (não sobe outra vez). */
  mediaId?: string;
  /** Onde se vê o ficheiro guardado (só em memória: no browser muda a cada abertura). */
  localUri?: string;
  at: string;
  state: PendingState;
  /** Já passou SLOW_MS a enviar: mostra "A enviar…". */
  slow: boolean;
  /** À espera, mas a tentar agora mesmo ("A enviar…" ao lado do reloginho). */
  trying?: boolean;
  /** O id que o servidor deu (depois de confirmar). */
  realId?: string;
  /** Mensagens temporárias: quando a confirmada expira (da resposta do servidor; null = fica). */
  expiresAt?: string | null;
  /** Depois de confirmada (a conversa vai buscar as mensagens outra vez). Só enquanto a app está aberta. */
  onSent?: () => void;
}

/** Antes disto a bolha a enviar parece já enviada (sem "A enviar…" nem esbatida): a maioria chega antes. */
export const SLOW_MS = 900;
/** Sem resposta do servidor neste tempo: conta como sem rede (fica à espera e tenta outra vez com o mesmo clientId). */
export const SEND_TIMEOUT_MS = 20_000;
/** Com um ficheiro para subir, o tempo é maior (um vídeo numa rede fraca). */
export const MEDIA_TIMEOUT_MS = 180_000;
/** Recuo entre tentativas de uma conversa à espera (a última repete-se para sempre). */
export const RETRY_DELAYS = [2_000, 5_000, 10_000, 30_000, 60_000] as const;
/** No telemóvel não há módulo de rede: com a app à frente, nunca mais de 15 s entre tentativas. */
export const NATIVE_RETRY_DELAYS = [2_000, 5_000, 10_000, 15_000] as const;
/** Depois de enviada, o ficheiro local ainda serve a bolha até o servidor a trazer; apaga-se no máximo passado isto. */
export const MEDIA_KEEP_AFTER_SENT_MS = 120_000;

/** O que o servidor responde ao envio (o `expiresAt` com as mensagens temporárias ligadas). */
export interface SentReply { id: string; expiresAt?: string | null }

/** O pedido ao servidor (serializável): a conversa (`u:<username>` ou `g:<id>`) e o corpo. */
export interface PendingRequest { conv: string; kind: PendingKind; body: string; gif?: unknown; replyTo?: string; clientId: string; media?: PendingMedia; mediaId?: string }

export interface PendingConfig {
  /**
   * Faz o pedido (e, com `media` sem `mediaId`, sobe primeiro o ficheiro e avisa com `uploaded`). Erro com `status` 4xx
   * (menos 401, 408 e 429): recusada. Qualquer outro erro: à espera.
   */
  transport?: (req: PendingRequest, ctx: { uploaded: (mediaId: string) => void }) => Promise<SentReply>;
  /** Onde ficam as à espera, por conta. `save(user, null)` apaga. */
  store?: { load: (user: string) => string | null | Promise<string | null>; save: (user: string, data: string | null) => void };
  /** Os ficheiros guardados: onde se veem (ao abrir a app) e apagar. */
  media?: { resolve: (ref: string) => Promise<string | null>; drop: (ref: string) => void };
  /** false = de certeza sem rede (navigator.onLine na web); nem se tenta. */
  online?: () => boolean;
  /** false = a app está em segundo plano: não tenta (volta a tentar com `wakePending`). */
  active?: () => boolean;
  retryDelays?: readonly number[];
  uuid?: () => string;
}

type Listener = () => void;
const byConv = new Map<string, readonly PendingMsg[]>();
const listeners = new Set<Listener>();
let seq = 0;
const EMPTY: readonly PendingMsg[] = Object.freeze([]);
/** id do servidor → a chave `tmp-…` com que a bolha nasceu (fica depois de sair daqui; só as últimas KEEP_KEYS). */
const keys = new Map<string, string>();
const KEEP_KEYS = 300;
/** O nome de cada conversa (para o cabeçalho sem rede). */
const titles = new Map<string, PendingTitle>();

let cfg: PendingConfig = {};
/** A conta destas mensagens (null: nada se guarda). `gen` muda a cada troca: respostas de antes não mexem em nada. */
let user: string | null = null;
let gen = 0;
let lastSaved: string | null = null;
/** Por conversa: a tentativa em curso, o temporizador da próxima e quantas falharam seguidas. */
const flight = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const tries = new Map<string, number>();
let flightSeq = 0;
/** "A enviar…" depois de SLOW_MS, por mensagem. */
const slowTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Ficheiros de mensagens já enviadas, a apagar daqui a pouco (ref → temporizador). */
const dropTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Quem espera pelo resultado de sendPending/retryPending (true: aceite; false: recusada ou à espera). */
const waiters = new Map<string, (ok: boolean) => void>();

export function configurePending(c: PendingConfig): void {
  cfg = { ...cfg, ...c };
}

/** A chave de uma mensagem na lista: a de quando estava a caminho, se foi enviada daqui; senão o próprio id. */
export function listKey(id: string): string {
  return keys.get(id) ?? id;
}

let version = 0;
function emit() {
  version++;
  listeners.forEach((f) => f());
}
function put(conv: string, list: readonly PendingMsg[]) {
  if (list.length) byConv.set(conv, list);
  else byConv.delete(conv);
  persist();
  emit();
}
function patch(conv: string, id: string, f: (p: PendingMsg) => PendingMsg | null) {
  const list = byConv.get(conv);
  if (!list || !list.some((p) => p.id === id)) return;
  put(conv, list.flatMap((p) => (p.id === id ? (f(p) ?? []) : [p])));
}
function settle(id: string, ok: boolean) {
  const w = waiters.get(id);
  if (!w) return;
  waiters.delete(id);
  w(ok);
}
function stopSlow(id: string) {
  const t = slowTimers.get(id);
  if (t !== undefined) clearTimeout(t);
  slowTimers.delete(id);
}
function startSlow(conv: string, id: string) {
  stopSlow(id);
  slowTimers.set(id, setTimeout(() => {
    slowTimers.delete(id);
    patch(conv, id, (x) => (x.state === 'sending' ? { ...x, slow: true } : x));
  }, SLOW_MS));
}
/** Apaga já o ficheiro guardado de uma mensagem (se tiver). */
function dropMedia(p: Pick<PendingMsg, 'media'>) {
  const ref = p.media?.ref;
  if (!ref) return;
  const t = dropTimers.get(ref);
  if (t !== undefined) clearTimeout(t);
  dropTimers.delete(ref);
  try { cfg.media?.drop(ref); } catch { /* já não existe */ }
}
/** Depois de enviada: o ficheiro ainda serve a bolha um bocado; apaga-se quando o servidor a trouxer ou passado o prazo. */
function dropMediaLater(p: Pick<PendingMsg, 'media'>) {
  const ref = p.media?.ref;
  if (!ref || dropTimers.has(ref)) return;
  dropTimers.set(ref, setTimeout(() => dropMedia(p), MEDIA_KEEP_AFTER_SENT_MS));
}

/** As mensagens a caminho de uma conversa (a mais recente primeiro). A mesma referência enquanto nada muda. */
export function pendingOf(conv: string): readonly PendingMsg[] {
  return byConv.get(conv) ?? EMPTY;
}

export function subscribePending(f: Listener): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

export interface PendingInput { kind: PendingKind; body?: string; gif?: unknown; replyTo?: PendingReply | null; media?: PendingMedia; localUri?: string }

/** A citação da resposta da barra de escrever ({ id, text, who }, com who "ti" quando respondo a uma minha). */
export function replyOf(reply?: { id: string; text: string; who?: string } | null): PendingReply | null {
  return reply ? { id: reply.id, gone: false, fromMe: reply.who === 'ti', name: reply.who === 'ti' ? '' : reply.who ?? '', kind: 'text', body: reply.text } : null;
}

/**
 * O que a bolha a caminho mostra, a partir do que se vai enviar e da resposta da barra de escrever. Só texto, sticker e
 * GIF vão sempre pela fila; voz, fotos e vídeos só sem rede (ver lib/chatMediaSend): null.
 */
export function pendingFrom(msg: { kind?: string; body?: string; gif?: unknown }, reply?: { id: string; text: string; who?: string } | null): PendingInput | null {
  const kind = msg.kind ?? 'text';
  if (kind !== 'text' && kind !== 'sticker' && kind !== 'gif') return null;
  if (kind === 'gif' ? !msg.gif : !msg.body?.trim()) return null;
  return { kind, body: msg.body ?? '', ...(msg.gif ? { gif: msg.gif } : null), replyTo: replyOf(reply) };
}

/**
 * Tentar mais tarde (fica à espera) ou recusada de vez? Só um 4xx do servidor é recusa, menos 408 (demorou) e 429 (muitos
 * pedidos); 401 também espera (a sessão renova-se ou termina, e terminar limpa a fila). Erros sem `status` (sem rede,
 * sem resposta, resposta estragada) e 5xx: tentar mais tarde.
 */
export function shouldRetry(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status !== 'number' || !status) return true;
  if (status >= 500 || status === 408 || status === 429 || status === 401) return true;
  return !(status >= 400 && status < 500);
}

/** A fila de uma conversa: as que ainda não foram aceites nem recusadas, a mais antiga primeiro. */
function queueOf(conv: string): PendingMsg[] {
  return pendingOf(conv).filter((p) => p.state === 'sending' || p.state === 'waiting').reverse();
}

const isOnline = () => (cfg.online ? cfg.online() !== false : true);
const isActive = () => (cfg.active ? cfg.active() !== false : true);

/** Para quem envia voz e fotos: de certeza sem rede agora? */
export const pendingOnline = (): boolean => isOnline();
/** Há mensagens à espera nesta conversa (uma nova tem de ir atrás delas, pela fila)? */
export const pendingWaiting = (conv: string): boolean => queueOf(conv).some((p) => p.state === 'waiting');

function requestOf(conv: string, p: PendingMsg): PendingRequest {
  return {
    conv, kind: p.kind, body: p.body, clientId: p.clientId,
    ...(p.gif ? { gif: p.gif } : null),
    ...(p.replyTo?.id ? { replyTo: p.replyTo.id } : null),
    ...(p.media ? { media: p.media } : null),
    ...(p.mediaId ? { mediaId: p.mediaId } : null),
  };
}

/** Toda a fila da conversa passa a "à espera" (reloginho). */
function holdAll(conv: string) {
  const list = byConv.get(conv);
  if (!list) return;
  let changed = false;
  const next = list.map((p) => {
    if (p.state !== 'sending' && p.state !== 'waiting') return p;
    stopSlow(p.id);
    settle(p.id, false);
    if (p.state === 'waiting' && !p.trying && !p.slow) return p;
    changed = true;
    return { ...p, state: 'waiting' as const, slow: false, trying: false };
  });
  if (changed) put(conv, next);
}

function schedule(conv: string) {
  const old = timers.get(conv);
  if (old !== undefined) clearTimeout(old);
  timers.delete(conv);
  // Em segundo plano não se gasta: o primeiro plano (wakePending) volta a tentar.
  if (!isActive()) return;
  const delays = cfg.retryDelays?.length ? cfg.retryDelays : RETRY_DELAYS;
  const n = tries.get(conv) ?? 0;
  tries.set(conv, n + 1);
  const g = gen;
  timers.set(conv, setTimeout(() => {
    timers.delete(conv);
    if (g === gen) pump(conv);
  }, delays[Math.min(n, delays.length - 1)]));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((ok, ko) => {
    const t = setTimeout(() => ko(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); ko(e); });
  });
}

/** Envia a mais antiga da fila da conversa (uma de cada vez); as outras vão a seguir, pela ordem. */
function pump(conv: string): void {
  if (flight.has(conv)) return;
  const t = timers.get(conv);
  if (t !== undefined) { clearTimeout(t); timers.delete(conv); }
  const queue = queueOf(conv);
  if (!queue.length) { tries.delete(conv); return; }
  if (!cfg.transport || !isOnline() || !isActive()) {
    holdAll(conv);
    schedule(conv);
    return;
  }
  void attempt(conv, queue[0]);
}

async function attempt(conv: string, head: PendingMsg): Promise<void> {
  const token = ++flightSeq;
  const g = gen;
  flight.set(conv, token);
  if (head.state === 'waiting') patch(conv, head.id, (x) => ({ ...x, trying: true }));
  const stale = () => g !== gen || flight.get(conv) !== token;
  const ctx = { uploaded: (mediaId: string) => { if (g === gen) patch(conv, head.id, (x) => ({ ...x, mediaId })); } };
  const ms = head.media && !head.mediaId ? MEDIA_TIMEOUT_MS : SEND_TIMEOUT_MS;
  let r: SentReply;
  try {
    r = await withTimeout(Promise.resolve().then(() => cfg.transport!(requestOf(conv, head), ctx)), ms);
  } catch (e) {
    if (stale()) return;
    flight.delete(conv);
    stopSlow(head.id);
    if (shouldRetry(e)) {
      holdAll(conv);
      schedule(conv);
      return;
    }
    patch(conv, head.id, (x) => ({ ...x, state: 'failed', slow: false, trying: false }));
    settle(head.id, false);
    tries.delete(conv);
    pump(conv);
    return;
  }
  if (stale()) return;
  flight.delete(conv);
  tries.delete(conv);
  stopSlow(head.id);
  if (r?.id) {
    keys.set(r.id, head.id);
    if (keys.size > KEEP_KEYS) keys.delete(keys.keys().next().value as string);
  }
  const cur = pendingOf(conv).find((x) => x.id === head.id);
  patch(conv, head.id, (x) => ({ ...x, state: 'sent', slow: false, trying: false, realId: r?.id, expiresAt: r?.expiresAt ?? null }));
  if (cur) dropMediaLater(cur);
  else dropMedia(head);
  settle(head.id, true);
  cur?.onSent?.();
  pump(conv);
}

export function newClientId(): string {
  if (cfg.uuid) return cfg.uuid();
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  // uuid v4 com Math.random (o id não é segredo: só evita duplicados).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Põe a mensagem na conversa já e envia-a (pela ordem: se há outras à frente, vai a seguir a elas). Devolve true se o
 * servidor a aceitou à primeira; false se foi recusada ou ficou à espera de rede (aí envia-se sozinha mais tarde).
 * `clientId` e `mediaId`: de um envio direto (voz, foto) que falhou a meio, para não duplicar nem subir outra vez.
 */
export function sendPending(conv: string, msg: PendingInput, opts: { onSent?: () => void; now?: Date; clientId?: string; mediaId?: string } = {}): Promise<boolean> {
  const ahead = queueOf(conv);
  const wait = !isOnline() || !isActive() || !cfg.transport || ahead.some((p) => p.state === 'waiting');
  const p: PendingMsg = {
    id: `tmp-${Date.now().toString(36)}-${++seq}`,
    clientId: opts.clientId ?? newClientId(),
    kind: msg.kind,
    body: msg.body ?? '',
    gif: msg.gif,
    replyTo: msg.replyTo ?? null,
    ...(msg.media ? { media: msg.media } : null),
    ...(msg.localUri ? { localUri: msg.localUri } : null),
    ...(opts.mediaId ? { mediaId: opts.mediaId } : null),
    at: (opts.now ?? new Date()).toISOString(),
    state: wait ? 'waiting' : 'sending',
    slow: false,
    onSent: opts.onSent,
  };
  const done = new Promise<boolean>((ok) => waiters.set(p.id, ok));
  put(conv, [p, ...pendingOf(conv)]);
  if (wait) {
    settle(p.id, false);
    // Tocar em Enviar com mensagens à espera é boa altura para ver se a rede já voltou.
    if (isOnline() && isActive() && cfg.transport) kick(conv);
    else if (!timers.has(conv) && !flight.has(conv)) schedule(conv);
  } else {
    startSlow(conv, p.id);
    pump(conv);
  }
  return done;
}

/** Tenta já (sem esperar o recuo) a fila de uma conversa. */
function kick(conv: string) {
  tries.delete(conv);
  pump(conv);
}

/** A rede voltou ou a app voltou ao primeiro plano: todas as conversas com mensagens à espera tentam já. */
export function wakePending(): void {
  if (!isOnline() || !isActive()) return;
  for (const conv of [...byConv.keys()]) if (queueOf(conv).length) kick(conv);
}

/** "Tentar outra vez" numa recusada pelo servidor (volta à fila, no seu lugar). */
export function retryPending(conv: string, id: string): Promise<boolean> {
  const p = pendingOf(conv).find((x) => x.id === id);
  if (!p || p.state !== 'failed') return Promise.resolve(false);
  const done = new Promise<boolean>((ok) => waiters.set(id, ok));
  const blocked = !isOnline() || !isActive() || queueOf(conv).some((x) => x.state === 'waiting');
  patch(conv, id, (x) => ({ ...x, state: blocked ? 'waiting' : 'sending', slow: false, trying: false }));
  if (blocked) settle(id, false);
  kick(conv);
  return done;
}

/** "Apagar" numa recusada ou à espera (ainda não está no servidor: sai só daqui, não se envia e o ficheiro apaga-se). */
export function dropPending(conv: string, id: string): void {
  const p = pendingOf(conv).find((x) => x.id === id);
  stopSlow(id);
  settle(id, false);
  if (p) dropMedia(p);
  patch(conv, id, () => null);
}

/**
 * As confirmadas que o servidor já trouxe saem daqui (a lista passa a mostrar a do servidor, com a mesma chave); as
 * confirmadas que já expiraram (mensagens temporárias) também. O ficheiro local delas apaga-se.
 */
export function prunePending(conv: string, serverIds: ReadonlySet<string>, now: number = Date.now()): void {
  const list = pendingOf(conv);
  const gone = (p: PendingMsg) => (!!p.realId && serverIds.has(p.realId)) || expired(p, now);
  if (!list.some(gone)) return;
  for (const p of list) if (gone(p)) dropMedia(p);
  put(conv, list.filter((p) => !gone(p)));
}

/** "Limpar conversa": esquece as que iam a caminho ou à espera nesta conversa (as à espera já não se enviam). */
export function clearPending(conv: string): void {
  if (!byConv.has(conv)) return;
  for (const p of pendingOf(conv)) { stopSlow(p.id); settle(p.id, false); dropMedia(p); }
  const t = timers.get(conv);
  if (t !== undefined) clearTimeout(t);
  timers.delete(conv);
  flight.delete(conv);
  tries.delete(conv);
  put(conv, []);
}

/** A confirmada já expirou (mensagens temporárias): sai da lista, mesmo que o servidor ainda não tenha respondido. */
function expired(p: PendingMsg, now: number): boolean {
  if (!p.expiresAt) return false;
  const t = Date.parse(p.expiresAt);
  return !Number.isNaN(t) && t <= now;
}

// ---------- O nome das conversas (cabeçalho sem rede) ----------

/** O nome de uma conversa: a pessoa (nome e @) ou o TxillGroup (nome). */
export interface PendingTitle { name: string; username?: string; hasAvatar?: boolean }

/** O ecrã da conversa diz o nome (quando o servidor o manda): fica guardado com as que estão à espera. */
export function notePendingTitle(conv: string, t: PendingTitle | null | undefined): void {
  if (!t?.name) return;
  const cur = titles.get(conv);
  if (cur && cur.name === t.name && cur.username === t.username && cur.hasAvatar === t.hasAvatar) return;
  titles.set(conv, { name: t.name, ...(t.username ? { username: t.username } : null), ...(t.hasAvatar ? { hasAvatar: true } : null) });
  if (byConv.has(conv)) persist();
}

export function pendingTitle(conv: string): PendingTitle | null {
  return titles.get(conv) ?? null;
}

/** Uma conversa com mensagens por enviar (à espera ou recusadas), para a lista de Mensagens sem rede. */
export interface PendingConv { conv: string; title: PendingTitle | null; count: number; last: PendingMsg; failed: boolean }

let convsAt = -1;
let convsCache: readonly PendingConv[] = EMPTY as unknown as readonly PendingConv[];
/** As conversas com mensagens por enviar (a mais recente primeiro). A mesma referência enquanto nada muda. */
export function pendingConvs(): readonly PendingConv[] {
  if (convsAt === version) return convsCache;
  const out: PendingConv[] = [];
  for (const [conv, list] of byConv) {
    const open = list.filter((p) => p.state !== 'sent');
    if (!open.length) continue;
    out.push({ conv, title: titles.get(conv) ?? null, count: open.length, last: open[0], failed: open.some((p) => p.state === 'failed') });
  }
  out.sort((a, b) => (a.last.at < b.last.at ? 1 : a.last.at > b.last.at ? -1 : 0));
  convsAt = version;
  convsCache = out;
  return out;
}

// ---------- Guardar (por conta) ----------

interface Stored { id: string; clientId: string; kind: PendingKind; body: string; gif?: unknown; replyTo?: PendingReply | null; media?: PendingMedia; mediaId?: string; at: string; state: 'waiting' | 'failed' }

/** O que se guarda: as que ainda não chegaram ao servidor (à espera, a enviar e recusadas), por conversa, e o nome dela. */
function snapshot(): string | null {
  const convs: Record<string, Stored[]> = {};
  const names: Record<string, PendingTitle> = {};
  for (const [conv, list] of byConv) {
    const keep = list.filter((p) => p.state !== 'sent').map((p): Stored => ({
      id: p.id, clientId: p.clientId, kind: p.kind, body: p.body, ...(p.gif ? { gif: p.gif } : null), replyTo: p.replyTo ?? null,
      ...(p.media ? { media: p.media } : null), ...(p.mediaId ? { mediaId: p.mediaId } : null), at: p.at,
      state: p.state === 'failed' ? 'failed' : 'waiting',
    }));
    if (!keep.length) continue;
    convs[conv] = keep;
    const t = titles.get(conv);
    if (t) names[conv] = t;
  }
  if (!Object.keys(convs).length) return null;
  return JSON.stringify({ v: 1, convs, ...(Object.keys(names).length ? { titles: names } : null) });
}

function persist() {
  if (!user || !cfg.store) return;
  const data = snapshot();
  if (data === lastSaved) return;
  lastSaved = data;
  try { cfg.store.save(user, data); } catch { /* sem armazenamento: fica só em memória */ }
}

function validMedia(m: unknown): m is PendingMedia {
  const x = m as PendingMedia | null;
  return !!x && typeof x.ref === 'string' && !!x.ref && typeof x.mime === 'string';
}

/** Quanto tempo uma mensagem recusada («Não enviada») fica guardada no aparelho: 30 dias. */
export const FAILED_KEEP_MS = 30 * 24 * 3600_000;

function parseStored(raw: string | null): { convs: Map<string, PendingMsg[]>; names: Map<string, PendingTitle> } {
  const convs = new Map<string, PendingMsg[]>();
  const names = new Map<string, PendingTitle>();
  if (!raw) return { convs, names };
  try {
    const d = JSON.parse(raw) as { v?: number; convs?: Record<string, Stored[]>; titles?: Record<string, PendingTitle> };
    for (const [conv, items] of Object.entries(d?.convs ?? {})) {
      if (!/^(u|g):.+/.test(conv) || !Array.isArray(items)) continue;
      const list = items
        .filter((s) => s && typeof s.id === 'string' && typeof s.clientId === 'string' && typeof s.at === 'string' && KINDS.includes(s.kind) && (!isMediaKind(s.kind) || validMedia(s.media)))
        // As recusadas («Não enviada») não ficam no aparelho para sempre: passados FAILED_KEEP_MS saem (e o ficheiro com elas).
        .filter((s) => { const old = s.state === 'failed' && Date.now() - Date.parse(s.at) > FAILED_KEEP_MS; if (old && s.media) dropMedia(s); return !old; })
        .map((s): PendingMsg => ({
          id: s.id, clientId: s.clientId, kind: s.kind, body: String(s.body ?? ''), ...(s.gif ? { gif: s.gif } : null), replyTo: s.replyTo ?? null,
          ...(s.media ? { media: s.media } : null), ...(typeof s.mediaId === 'string' ? { mediaId: s.mediaId } : null),
          at: s.at, state: s.state === 'failed' ? 'failed' : 'waiting', slow: false,
        }));
      if (list.length) convs.set(conv, list);
    }
    for (const [conv, t] of Object.entries(d?.titles ?? {})) if (t && typeof t.name === 'string' && t.name) names.set(conv, t);
  } catch { /* estragado: começa vazio */ }
  return { convs, names };
}

function stopAll() {
  for (const t of timers.values()) clearTimeout(t);
  for (const t of slowTimers.values()) clearTimeout(t);
  timers.clear(); slowTimers.clear(); flight.clear(); tries.clear();
  for (const id of [...waiters.keys()]) settle(id, false);
}

/** Os ficheiros guardados das que voltaram: onde se veem agora (no browser, um endereço novo a cada abertura). */
function resolveMedia(conv: string, list: readonly PendingMsg[]) {
  const g = gen;
  for (const p of list) {
    if (!p.media || p.localUri || !cfg.media) continue;
    void cfg.media.resolve(p.media.ref).then((uri) => {
      if (uri && g === gen) patch(conv, p.id, (x) => ({ ...x, localUri: uri }));
    }, () => undefined);
  }
}

/**
 * A conta com sessão (null ao sair). Troca de conta: esquece da memória as da outra (ficam guardadas na dela) e carrega
 * as desta, que tentam logo. Devolve quando acabou de carregar.
 */
export async function setPendingUser(next: string | null): Promise<void> {
  if (next === user) return;
  gen++;
  stopAll();
  byConv.clear();
  titles.clear();
  user = next;
  lastSaved = null;
  emit();
  if (!next || !cfg.store) return;
  const g = gen;
  let raw: string | null = null;
  try { raw = await cfg.store.load(next); } catch { raw = null; }
  if (g !== gen) return;
  lastSaved = raw;
  const { convs: restored, names } = parseStored(raw);
  for (const [conv, t] of names) if (!titles.has(conv)) titles.set(conv, t);
  for (const [conv, list] of restored) {
    // Enviadas enquanto se carregava: são mais recentes (ficam por cima).
    const now = byConv.get(conv) ?? [];
    const seen = new Set(now.map((p) => p.id));
    byConv.set(conv, [...now, ...list.filter((p) => !seen.has(p.id))]);
  }
  persist();
  emit();
  for (const [conv, list] of restored) resolveMedia(conv, list);
  for (const conv of restored.keys()) {
    if (!queueOf(conv).length) continue;
    if (isOnline() && isActive() && cfg.transport) kick(conv);
    else schedule(conv);
  }
}

/** Terminar sessão: apaga as guardadas desta conta e os ficheiros delas (e da memória, se for a ativa). */
export async function forgetPendingUser(u: string): Promise<void> {
  const refs = new Set<string>();
  if (u === user) for (const list of byConv.values()) for (const p of list) if (p.media?.ref) refs.add(p.media.ref);
  try {
    const raw = await cfg.store?.load(u);
    for (const list of parseStored(raw ?? null).convs.values()) for (const p of list) if (p.media?.ref) refs.add(p.media.ref);
  } catch { /* sem armazenamento */ }
  if (u === user) await setPendingUser(null);
  for (const ref of refs) dropMedia({ media: { ref, mime: '' } });
  try { cfg.store?.save(u, null); } catch { /* nada */ }
}

/** Para os testes: esquece tudo (também a configuração). */
export function resetPending(): void {
  gen++;
  stopAll();
  for (const t of dropTimers.values()) clearTimeout(t);
  dropTimers.clear();
  byConv.clear();
  keys.clear();
  titles.clear();
  user = null;
  lastSaved = null;
  cfg = {};
  emit();
}

/** A bolha de uma mensagem a caminho, no formato das do servidor (ChatMessage + `state`). */
export interface PendingBubble {
  id: string;
  fromMe: true;
  kind: PendingKind;
  body: string;
  gif?: unknown;
  replyTo: PendingReply | null;
  at: string;
  expiresAt: string | null;
  /** 'waiting': reloginho (à espera de rede); 'sending': "A enviar…"; 'failed': "Não enviada". */
  state?: 'sending' | 'waiting' | 'failed';
  /** À espera e a tentar agora mesmo. */
  trying?: boolean;
  storyUrl: null;
  /** Voz, foto ou vídeo: o ficheiro guardado neste aparelho (até o servidor trazer a mensagem). */
  mediaUrl: string | null;
  durationMs: number | null;
  waveform?: string | null;
  viewOnce?: boolean;
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
    state: p.state === 'failed' ? 'failed' : p.state === 'waiting' ? 'waiting' : p.state === 'sending' && p.slow ? 'sending' : undefined,
    ...(p.state === 'waiting' && p.trying ? { trying: true } : null),
    storyUrl: null,
    mediaUrl: p.localUri ?? null,
    durationMs: p.media?.durationMs ?? null,
    ...(p.media?.waveform ? { waveform: p.media.waveform } : null),
    ...(p.media?.once ? { viewOnce: true } : null),
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

/** O texto curto de uma mensagem por enviar (na lista de Mensagens sem rede). */
export function pendingPreview(p: Pick<PendingMsg, 'kind' | 'body'>): string {
  if (p.kind === 'text') return p.body;
  if (p.kind === 'sticker') return 'Sticker';
  if (p.kind === 'gif') return 'GIF';
  if (p.kind === 'voice') return 'Mensagem de voz';
  if (p.kind === 'image') return p.body ? `Foto: ${p.body}` : 'Foto';
  return p.body ? `Vídeo: ${p.body}` : 'Vídeo';
}
