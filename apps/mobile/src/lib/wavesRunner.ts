// Só umas ondas de som a correr de cada vez: as do som que começou a tocar por último (sem React, para os testes em Node:
// tests/musicLook.test.mjs). As outras ficam em fila, apagadas e sem desenhar; quando a da frente pára (o visor de fotos
// fecha, a nota de voz acaba), a seguinte volta a correr.

const queue: symbol[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Estas ondas querem correr (passam para a frente). */
export function claimWaves(id: symbol): void {
  const i = queue.indexOf(id);
  if (i === queue.length - 1 && i >= 0) return;
  if (i >= 0) queue.splice(i, 1);
  queue.push(id);
  emit();
}

/** Estas ondas pararam (ou saíram do ecrã). */
export function releaseWaves(id: symbol): void {
  const i = queue.indexOf(id);
  if (i < 0) return;
  queue.splice(i, 1);
  emit();
}

/** As ondas que estão a correr agora (ou nenhumas). */
export const runningWaves = (): symbol | null => queue[queue.length - 1] ?? null;

export function subscribeWaves(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}
