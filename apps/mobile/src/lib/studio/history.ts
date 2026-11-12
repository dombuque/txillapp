/**
 * Desfazer e refazer do estúdio (até 50 passos), puro e testado em tests/studioHistory.test.mjs.
 * - `push` guarda o estado de agora e passa ao novo (o refazer perde-se, como em todo o lado).
 * - Um gesto (arrastar uma pega, reordenar) conta como um passo só: o primeiro movimento faz `push` e os seguintes
 *   `{ merge: true }`, que só trocam o estado de agora.
 * - `mapAll` acerta todos os estados de uma vez (ex.: soube-se a duração verdadeira de um vídeo ou se tem som); não é um passo.
 */
export const HISTORY_LIMIT = 50;

export interface History<T> { past: T[]; present: T; future: T[] }

export const initHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

export function pushHistory<T>(h: History<T>, next: T, opts: { merge?: boolean; limit?: number } = {}): History<T> {
  if (Object.is(next, h.present)) return h;
  if (opts.merge) return { ...h, present: next, future: [] };
  const limit = Math.max(1, opts.limit ?? HISTORY_LIMIT);
  const past = [...h.past, h.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest };
}

/**
 * Troca só o estado de agora, sem passo nem perder o refazer (o que o estúdio acerta sozinho, como o trecho sugerido da
 * música quando a duração muda).
 */
export function replacePresent<T>(h: History<T>, next: T): History<T> {
  return Object.is(next, h.present) ? h : { ...h, present: next };
}

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;

/** Aplica `fn` a todos os estados guardados (não conta como passo). Se nada mudar, devolve o mesmo histórico. */
export function mapAll<T>(h: History<T>, fn: (s: T) => T): History<T> {
  let changed = false;
  const f = (s: T) => { const n = fn(s); if (!Object.is(n, s)) changed = true; return n; };
  const out = { past: h.past.map(f), present: f(h.present), future: h.future.map(f) };
  return changed ? out : h;
}
