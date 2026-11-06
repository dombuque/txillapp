import { useEffect, useRef } from 'react';

const listeners = new Set<(name: string) => void>();

/** Tocar no separador em que já estás (por exemplo, no Início): o ecrã decide (voltar ao topo, atualizar…). */
export const emitTabPress = (name: string) => listeners.forEach((l) => l(name));

export function useTabPress(name: string, cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const l = (n: string) => n === name && ref.current();
    listeners.add(l);
    return () => void listeners.delete(l);
  }, [name]);
}
