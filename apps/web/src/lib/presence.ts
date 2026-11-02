import { useEffect, useSyncExternalStore } from 'react';
import { authHeader } from './api';

/**
 * Quem está online, para a bolinha verde nos posts. Cada avatar pede o seu @utilizador; um só relógio junta os pedidos e
 * pergunta ao servidor de uma vez (em lote) a cada 30 s e logo que aparece alguém novo. O servidor já aplica a privacidade
 * (quem esconde a presença não aparece nem vê os outros).
 */
const wanted = new Map<string, number>(); // @utilizador (minúsculas) → quantos avatares o pedem
let online = new Set<string>();
const subs = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let loop: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  const names = [...wanted.keys()].slice(0, 100);
  if (!names.length || document.visibilityState === 'hidden') return;
  try {
    const res = await fetch('/api/v1/presence/online', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ usernames: names }) });
    if (!res.ok) return;
    const next = new Set<string>(((await res.json()) as { online: string[] }).online.map((x) => x.toLowerCase()));
    const same = next.size === online.size && [...next].every((x) => online.has(x));
    if (!same) {
      online = next;
      subs.forEach((f) => f());
    }
  } catch {
    /* sem rede: mantém o que sabia */
  }
}
const soon = () => {
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), 400);
};

/** Está online? (só devolve verdadeiro se o servidor deixou ver). */
export function useOnline(username?: string | null): boolean {
  const key = username?.toLowerCase();
  useEffect(() => {
    if (!key) return;
    wanted.set(key, (wanted.get(key) ?? 0) + 1);
    if (!loop) loop = setInterval(() => void refresh(), 30_000);
    soon();
    return () => {
      const n = (wanted.get(key) ?? 1) - 1;
      if (n <= 0) wanted.delete(key);
      else wanted.set(key, n);
      if (!wanted.size && loop) {
        clearInterval(loop);
        loop = undefined;
      }
    };
  }, [key]);
  return useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => !!key && online.has(key),
  );
}
