import { useSyncExternalStore } from 'react';
import { api } from './api';

/**
 * Menções (@nome): só ganham link as contas que existem. Os nomes de todos os textos visíveis juntam-se num só pedido
 * (até 20 de cada vez) e a resposta fica em memória. Se o pedido falhar (sem rede), assume-se que existem, para não tirar links por engano.
 */
const known = new Map<string, boolean>();
const pending = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const batch = [...pending].slice(0, 20);
  batch.forEach((n) => pending.delete(n));
  try {
    const ok = new Set((await api.mentionsExist(batch)).map((n) => n.toLowerCase()));
    for (const n of batch) known.set(n, ok.has(n));
  } catch {
    for (const n of batch) known.set(n, true);
  }
  version++;
  subs.forEach((f) => f());
  if (pending.size) timer = setTimeout(flush, 30);
}

/** Pede a verificação destes nomes (os já conhecidos não voltam a ser pedidos). */
export function checkUsers(names: string[]) {
  for (const n of names) {
    const k = n.toLowerCase();
    if (!known.has(k) && !pending.has(k)) pending.add(k);
  }
  if (pending.size && !timer) timer = setTimeout(flush, 30);
}

/** true = existe, false = não existe, undefined = ainda a verificar. */
export const userKnown = (name: string) => known.get(name.toLowerCase());

/** Faz o componente voltar a desenhar quando chegam respostas. */
export const useUserChecks = () =>
  useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => version,
  );
