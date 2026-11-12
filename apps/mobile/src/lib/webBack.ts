/**
 * «Voltar» do browser (e arrastar para trás no Safari / PWA do iPhone, e o gesto de voltar do Android no Chrome) a fechar
 * folhas e visores abertos por cima de um ecrã, em vez de tirar o ecrã que está por baixo.
 *
 * Como funciona: ao abrir uma folha junta-se ao histórico uma entrada com o MESMO endereço e o mesmo `id` do expo-router
 * (mais a nossa marca `__txb`). Carregar em «voltar» sai dessa entrada: o nosso ouvinte de `popstate` (registado antes do
 * do expo-router) fecha a folha e engole o evento, e o expo-router nem dá por nada. Fechar a folha de outra maneira (×, fundo,
 * arrastar para baixo) tira a entrada com um `history.go(-1)` nosso, também engolido.
 *
 * Para não baralhar o expo-router (que guarda o histórico à parte e chama pushState / replaceState / go):
 * - enquanto um `go` nosso não chega, as chamadas dele esperam numa fila (senão o pushState caía antes do recuo e o recuo
 *   desfazia a navigação nova);
 * - se ele navegar com uma folha aberta (tocar numa opção da folha que abre outro ecrã), primeiro tiram-se as nossas entradas
 *   e só depois se faz a navegação dele: no histórico nunca ficam entradas nossas pelo meio;
 * - se ele recuar (`router.back()`) com folhas abertas, o recuo salta também as nossas entradas.
 *
 * Só depende de um «window» mínimo (ver WinLike), para se poder testar em node (tests/webBack.test.mjs).
 */

export const MARK = '__txb';
const DEPTH = '__txd';

type State = Record<string, unknown> | null | undefined;
interface PopEvent { stopImmediatePropagation(): void }
export interface HistLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
  go(delta?: number): void;
  back(): void;
  forward(): void;
}
export interface WinLike {
  history: HistLike;
  location: { href: string };
  addEventListener(type: 'popstate', fn: (e: PopEvent) => void, capture?: boolean): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(t: unknown): void;
}

interface Entry { tok: number; onBack: () => void; done: boolean; baseId: unknown; baseHref: string }

export interface WebBack {
  /** Abre uma camada (folha, visor…): «voltar» chama `onBack`. Devolve a função que a fecha (chamá-la duas vezes não faz mal). */
  open(onBack: () => void): () => void;
  /** Quantas camadas têm agora uma entrada no histórico (para testes). */
  depth(): number;
}

/** Quanto se espera pelo `popstate` de um recuo nosso antes de desistir e seguir com a fila. */
const WAIT_MS = 1000;

export function createWebBack(win: WinLike): WebBack {
  const h = win.history;
  const orig = { push: h.pushState.bind(h), replace: h.replaceState.bind(h), go: h.go.bind(h) };
  let stack: Entry[] = [];
  let seq = 0;
  let swallow = 0;
  let queue: (() => void)[] = [];
  let timer: unknown = null;

  const state = (): State => (h.state && typeof h.state === 'object' ? (h.state as Record<string, unknown>) : null);
  const sameHref = (url?: string | URL | null) => {
    if (url == null) return true;
    try { return new URL(String(url), win.location.href).href === win.location.href; } catch { return false; }
  };

  function flush() {
    while (swallow === 0 && queue.length) queue.shift()!();
  }
  /** Um recuo nosso: o `popstate` que provoca não chega a mais ninguém. */
  function ownGo(n: number) {
    swallow++;
    if (timer != null) win.clearTimeout(timer);
    timer = win.setTimeout(() => { timer = null; swallow = 0; flush(); }, WAIT_MS);
    orig.go(n);
  }
  /** Tira do topo as camadas já fechadas (as entradas delas saem do histórico). */
  function prune() {
    let k = 0;
    while (stack.length && stack[stack.length - 1].done) { stack.pop(); k++; }
    if (k) ownGo(-k);
  }
  /** Antes de uma navegação do expo-router: tira todas as nossas entradas (as camadas ficam sem «voltar»). */
  function rewind(then: () => void) {
    const k = stack.length;
    for (const e of stack) e.done = true;
    stack = [];
    queue.push(then);
    ownGo(-k);
  }

  function push(data: unknown, unused: string, url?: string | URL | null) {
    if (swallow > 0) return void queue.push(() => push(data, unused, url));
    if (stack.length) return rewind(() => push(data, unused, url));
    orig.push(data, unused, url);
  }
  function replace(data: unknown, unused: string, url?: string | URL | null) {
    if (swallow > 0) return void queue.push(() => replace(data, unused, url));
    if (stack.length) {
      const cur = state();
      const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
      // A mesma entrada e o mesmo endereço (o expo-router a reescrever o que já lá está): fica na nossa, com a marca.
      if (sameHref(url) && d && d.id === stack[0].baseId) return orig.replace({ ...d, [MARK]: cur?.[MARK], [DEPTH]: cur?.[DEPTH] }, unused, url);
      return rewind(() => replace(data, unused, url));
    }
    orig.replace(data, unused, url);
  }
  function go(n = 0) {
    if (swallow > 0) return void queue.push(() => go(n));
    // `router.back()` com uma folha aberta: o expo-router acha que está no ecrã, por isso salta também as nossas entradas.
    if (stack.length && n < 0) {
      const k = stack.length;
      for (const e of stack) e.done = true;
      stack = [];
      return orig.go(n - k);
    }
    orig.go(n);
  }
  h.pushState = push;
  h.replaceState = replace;
  h.go = go;
  h.back = () => go(-1);
  h.forward = () => go(1);

  win.addEventListener('popstate', (ev) => {
    if (swallow > 0) {
      swallow--;
      ev.stopImmediatePropagation();
      if (swallow === 0) {
        if (timer != null) win.clearTimeout(timer);
        timer = null;
        flush();
      }
      return;
    }
    const st = state();
    const tok = st?.[MARK];
    if (stack.length) {
      // Saiu-se da entrada de cima (o «voltar»): fecham-se as camadas acima da entrada onde se chegou.
      const j = tok == null ? -1 : stack.findIndex((e) => e.tok === tok);
      const onBase = j >= 0 || (st?.id === stack[0].baseId && win.location.href === stack[0].baseHref);
      const gone = stack.splice(j + 1);
      // Chegou-se ao ecrã de baixo (ou a outra camada nossa): é só fechar. Se o recuo foi mais longe, o expo-router trata dele.
      if (onBase) ev.stopImmediatePropagation();
      for (let i = gone.length - 1; i >= 0; i--) {
        const e = gone[i];
        if (e.done) continue;
        e.done = true;
        try { e.onBack(); } catch { /* uma camada com erro não estraga o «voltar» */ }
      }
      prune();
      return;
    }
    // Uma entrada nossa que já não tem camada (por exemplo, «avançar» depois de fechar com «voltar»): o expo-router
    // trata-a como o ecrã de baixo (tem o mesmo id e endereço) e nós passamos para a entrada verdadeira.
    if (tok != null) ownGo(-(Number(st?.[DEPTH]) || 1));
  }, true); // em captura: mesmo que o expo-router se registe primeiro, nós ouvimos antes dele

  return {
    open(onBack) {
      const e: Entry = { tok: ++seq, onBack, done: false, baseId: undefined, baseHref: '' };
      const doPush = () => {
        if (e.done) return;
        const base = state();
        if (!stack.length) { e.baseId = base?.id; e.baseHref = win.location.href; } else { e.baseId = stack[0].baseId; e.baseHref = stack[0].baseHref; }
        orig.push({ ...(base ?? {}), [MARK]: e.tok, [DEPTH]: stack.length + 1 }, '', win.location.href);
        stack.push(e);
      };
      if (swallow > 0) queue.push(doPush);
      else doPush();
      return () => {
        if (e.done) return;
        e.done = true;
        if (!stack.includes(e)) return; // ainda na fila: já não entra
        if (swallow > 0) return void queue.push(prune);
        prune();
      };
    },
    depth: () => stack.length,
  };
}

let shared: WebBack | null = null;
/** Liga o «voltar» das camadas na web (chamar uma vez, cedo: antes de o expo-router ouvir o `popstate`). */
export function installWebBack(): WebBack | null {
  if (shared) return shared;
  if (typeof window === 'undefined' || typeof document === 'undefined' || !window.history?.pushState) return null;
  shared = createWebBack(window as unknown as WinLike);
  return shared;
}
export const webBack = (): WebBack | null => shared;
