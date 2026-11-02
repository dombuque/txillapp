/** Ficheiros escolhidos na câmara que o ecrã de publicar vai buscar ao abrir (os ficheiros não cabem num URL). */
export interface Handoff {
  photos?: File[];
  video?: File;
}

let pending: Handoff | null = null;
export const setHandoff = (h: Handoff) => {
  pending = h;
};
/** Entrega e esquece logo a seguir (no mesmo ciclo pode ser pedido mais de uma vez, como faz o React em desenvolvimento). */
export const takeHandoff = (): Handoff | null => {
  const h = pending;
  if (h) queueMicrotask(() => { if (pending === h) pending = null; });
  return h;
};
