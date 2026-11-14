/**
 * Tempo real do chat: a lógica pura (sem React nem módulos nativos; os testes em tests/streamEvents.test.mjs importam
 * este ficheiro diretamente). Quem a usa é src/lib/realtime.ts.
 *
 * - `planChatEvent`: o que fazer com um evento do canal. Os eventos com `self: true` são o eco do que EU fiz noutro
 *   aparelho (ou neste: o aparelho que enviou também recebe o eco). Só põem os dados em dia: não passam pelo
 *   "a escrever…" (que se desligaria com a minha própria mensagem), nem por quem se inscreve nos eventos (som, avisos,
 *   banners). Um 'read' com self ("li eu") só muda a lista: a conversa não muda e voltar a pedi-la marcaria como lido.
 * - `startWatchdog`: o vigia do stream. O servidor manda um ping a cada 25 s; se não chegar nada em STALL_MS (o stream
 *   caiu em silêncio: proxy, rede móvel, iOS em segundo plano breve), avisa para abortar e voltar a ligar.
 */

/** `id` e `what`: só nos eventos 'mixar' ({ type: 'mixar', id, what }). */
export interface StreamChatEvent { type: string; from?: string; group?: string; self?: boolean; id?: string; what?: string }
export type QueryKey = readonly unknown[];

export interface EventPlan {
  /** Passa ao "a escrever…" e a quem se inscreveu nos eventos (useChatStream(onEvent)). */
  notify: boolean;
  /** Queries a invalidar (por prefixo, como no TanStack Query). */
  keys: QueryKey[];
}

/** Sem dados do stream há mais do que isto (o ping vem de 25 em 25 s): está pendurado. */
export const STALL_MS = 60_000;
/** De quanto em quanto tempo o vigia confere. */
export const WATCH_EVERY_MS = 5_000;

/** O que pôr em dia por causa de um evento (sem evento: tudo, ex. ao voltar a ligar ou à app). */
export function refreshKeys(e?: StreamChatEvent): QueryKey[] {
  const keys: QueryKey[] = [['chat-list'], ['chat-unread'], ['chat-groups']];
  if (e?.group) keys.push(['chat-group', e.group]);
  else if (!e) keys.push(['chat-group']);
  if (e?.from) keys.push(['chat-thread', e.from]);
  else if (!e) keys.push(['chat-thread']);
  // Ao voltar a ligar: também a faixa dos Zás (pode ter chegado um enquanto o stream estava em baixo).
  if (!e) keys.push(...ZAS_KEYS);
  return keys;
}

/** A faixa dos Zás e a lista do visor em pilha (components/Instants.tsx). */
export const ZAS_KEYS: QueryKey[] = [['instants'], ['instants-feed']];

/**
 * Mixar (docs/mixar-contrato.md): `{ type: 'mixar', id, what }` para o outro e o eco (self) para os meus outros aparelhos.
 * Só põe em dia o que mudou nesse Mixar (as chaves de lib/api.mixar, mixarKeys), sem som nem aviso (o push trata disso):
 * - 'reaction': o feed (a reação do outro);
 * - 'pick' / 'result': o desafio, e o resumo (o «desafio à espera» da lista);
 * - 'daily': a seleção nova (feed, desafio e lista);
 * - 'invite' / 'accepted': o Mixar, a lista, o «com esta pessoa» e as conversas (o cartão do chat muda de estado).
 */
export function mixarEventKeys(e: StreamChatEvent): QueryKey[] {
  if (!e.id) return [['mixar-list']];
  const one = ['mixar', e.id];
  switch (e.what) {
    case 'reaction': return [[...one, 'feed']];
    case 'pick':
    case 'result': return [[...one, 'challenge'], ['mixar-list']];
    case 'daily': return [[...one, 'feed'], [...one, 'challenge'], ['mixar-list']];
    case 'invite':
    case 'accepted': return [one, ['mixar-list'], ['mixar-with'], ['chat-list'], ['chat-thread']];
    default: return [one, ['mixar-list']];
  }
}

/** O que fazer com um evento de chat (não 'call' nem 'group': esses têm o seu caminho em realtime.ts). */
export function planChatEvent(e: StreamChatEvent): EventPlan {
  if (e.type === 'ping') return { notify: false, keys: [] };
  // Zás novo (ou apagado) de alguém que posso ver, ou o eco de um meu noutro aparelho: só a faixa dos Zás se põe em dia
  // (sem som, sem aviso, sem mexer nas conversas).
  if (e.type === 'zas') return { notify: false, keys: ZAS_KEYS };
  // Mixar: só os dados desse Mixar (sem som, aviso nem "a escrever…"), venha do outro ou seja o meu eco.
  if (e.type === 'mixar') return { notify: false, keys: mixarEventKeys(e) };
  if (e.self) {
    // O meu próprio "a escrever" nunca devia chegar; se chegar, ignora-se.
    if (e.type === 'typing') return { notify: false, keys: [] };
    if (e.type === 'read') return { notify: false, keys: [['chat-list'], ['chat-unread'], ['chat-groups']] };
    return { notify: false, keys: refreshKeys(e) };
  }
  if (e.type === 'typing') return { notify: true, keys: [] };
  return { notify: true, keys: refreshKeys(e) };
}

export interface Watchdog {
  /** Chegaram dados (qualquer pedaço do stream, também o ping). */
  feed(): void;
  stop(): void;
}

/**
 * Vigia: chama `onStall` uma vez se não houver `feed()` durante `limitMs`. Os relógios são injetáveis (testes).
 * Começa a contar logo (apanha também um pedido que nunca chega a responder).
 */
export function startWatchdog(
  onStall: () => void,
  opts: { limitMs?: number; everyMs?: number; now?: () => number; setInterval?: (f: () => void, ms: number) => unknown; clearInterval?: (h: unknown) => void } = {},
): Watchdog {
  const limit = opts.limitMs ?? STALL_MS;
  const now = opts.now ?? Date.now;
  const set = opts.setInterval ?? ((f: () => void, ms: number) => setInterval(f, ms));
  const clear = opts.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  let last = now();
  let done = false;
  const h = set(() => {
    if (done || now() - last <= limit) return;
    done = true;
    clear(h);
    onStall();
  }, opts.everyMs ?? WATCH_EVERY_MS);
  return {
    feed() { last = now(); },
    stop() {
      if (done) return;
      done = true;
      clear(h);
    },
  };
}
