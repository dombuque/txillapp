import { useSyncExternalStore } from 'react';

/**
 * O estúdio das tchekas aberto no computador: o DesktopShell larga a coluna e a barra lateral (o estúdio usa a janela
 * toda) e os atalhos gerais do site ficam calados (o estúdio tem os dele). Muda só o estilo, não a estrutura: a navegação
 * não recomeça e o estúdio não perde nada.
 */
let on = false;
const listeners = new Set<() => void>();

export function setStudioFull(v: boolean) {
  if (on === v) return;
  on = v;
  listeners.forEach((f) => f());
}
export const isStudioFull = () => on;
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const useStudioFull = () => useSyncExternalStore(subscribe, () => on, () => false);
