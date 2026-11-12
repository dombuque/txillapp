import { useEffect, useRef } from 'react';

const listeners = new Set<(name: string) => void>();

/** Tocar no separador em que já estás (por exemplo, no Início): o ecrã decide (voltar ao topo, atualizar…). */
export const emitTabPress = (name: string) => listeners.forEach((l) => l(name));

/**
 * Barra lateral do computador: tocar no item do ecrã em que já estás dá o mesmo que tocar outra vez no separador do telemóvel
 * (devolve o nome do separador). Só no próprio ecrã: com uma conversa aberta (/messages/x), «Mensagens» volta à lista.
 */
export function sameTabPress(key: string, path: string): string | null {
  if (key === 'home' && path === '/') return 'index';
  if (key === 'messages' && path === '/messages') return 'messages';
  if (key === 'profile' && path === '/profile') return 'profile';
  return null;
}

export function useTabPress(name: string, cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const l = (n: string) => n === name && ref.current();
    listeners.add(l);
    return () => void listeners.delete(l);
  }, [name]);
}
