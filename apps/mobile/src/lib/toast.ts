import { useEffect, useState } from 'react';

/**
 * Um aviso curto no fundo do ecrã (components/ToastHost), em qualquer ecrã, com um botão opcional («Desfazer»). Só um de cada
 * vez: um novo substitui o anterior. Sai sozinho ao fim de `ms` (4 s por omissão; com botão, 6 s).
 */
export type ToastAction = { label: string; onPress: () => void };
export type ToastRequest = { id: number; text: string; action?: ToastAction; ms: number };

let current: ToastRequest | null = null;
let n = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<(t: ToastRequest | null) => void>();
const emit = () => listeners.forEach((l) => l(current));

export function showToast(text: string, action?: ToastAction, ms?: number) {
  clearTimeout(timer);
  current = { id: ++n, text, action, ms: ms ?? (action ? 6000 : 4000) };
  const id = current.id;
  emit();
  timer = setTimeout(() => { if (current?.id === id) closeToast(); }, current.ms);
}

export function closeToast() {
  clearTimeout(timer);
  current = null;
  emit();
}

/** Carregar no botão do aviso: fecha-o e corre a ação. */
export function pressToast(t: ToastRequest) {
  closeToast();
  t.action?.onPress();
}

export function useToast(): ToastRequest | null {
  const [t, setT] = useState<ToastRequest | null>(current);
  useEffect(() => {
    listeners.add(setT);
    return () => void listeners.delete(setT);
  }, []);
  return t;
}
