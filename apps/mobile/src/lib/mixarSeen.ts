import { useSyncExternalStore } from 'react';
import { kvGet, kvSet } from './kv';

/**
 * Quando abri cada Mixar pela última vez (neste aparelho): guarda o `updatedAt` do servidor que vi (sem depender do relógio
 * do telemóvel). A bolinha azul some depois de abrir e só volta quando o Mixar muda (a seleção das 05:00 ou um convite novo).
 */
const KEY = 'tx_mixar_seen';
const MAX = 60;
let seen: Record<string, string> = {};
let loaded = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function load() {
  if (loaded) return;
  loaded = true;
  void kvGet(KEY).then((s) => {
    if (!s) return;
    try {
      const got = JSON.parse(s) as Record<string, string>;
      if (got && typeof got === 'object') {
        // O que já se marcou nesta sessão (antes de ler) ganha ao guardado.
        const merged: Record<string, string> = { ...got };
        for (const [id, at] of Object.entries(seen)) if (!merged[id] || merged[id] < at) merged[id] = at;
        seen = merged;
        emit();
      }
    } catch {
      /* estragado: começa do zero */
    }
  });
}

/** Marca o Mixar como visto até `updatedAt` (o do servidor). */
export function markMixarSeen(id: string, updatedAt: string | null | undefined) {
  if (!id || !updatedAt) return;
  load();
  if (seen[id] && seen[id] >= updatedAt) return;
  const next = { ...seen, [id]: updatedAt };
  const ids = Object.keys(next);
  if (ids.length > MAX) ids.sort((a, b) => (next[a] < next[b] ? -1 : 1)).slice(0, ids.length - MAX).forEach((k) => delete next[k]);
  seen = next;
  emit();
  void kvSet(KEY, JSON.stringify(seen));
}

/** O mapa id → updatedAt visto (atualiza quando se marca). */
export function useMixarSeen(): Record<string, string> {
  load();
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => seen,
    () => seen,
  );
}
