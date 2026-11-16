import type { QueryClient } from '@tanstack/react-query';
import { mixarKeys, type Mixar, type MixarSummary } from '@/lib/api.mixar';
import { mixarAvisosApi } from '@/lib/api.mixarAvisos';

/** No máximo um POST /open por Mixar a cada 30 s (o ecrã volta a correr o efeito quando o Mixar muda). */
const EVERY_MS = 30_000;
const last = new Map<string, number>();

/**
 * Abri o Mixar (o feed, ou a conversa com o convite que recebi): diz ao servidor (POST /mixar/:id/open, 0170) para a bolinha
 * azul sumir em todos os aparelhos e põe o `openedAt` devolvido na lista e no Mixar em cache (sem esperar pelo próximo
 * pedido). Num servidor antigo (404) ou sem rede não faz mal: fica a reserva deste aparelho (lib/mixarSeen).
 */
export function markMixarOpened(qc: QueryClient, id: string, now = Date.now()) {
  if (!id) return;
  const prev = last.get(id);
  if (prev && now - prev < EVERY_MS) return;
  last.set(id, now);
  void mixarAvisosApi
    .open(id)
    .then(({ openedAt }) => {
      if (!openedAt) return;
      qc.setQueryData<{ items: MixarSummary[] }>(mixarKeys.list(), (d) => (d ? { ...d, items: d.items.map((s) => (s.id === id ? { ...s, openedAt } : s)) } : d));
      qc.setQueryData<Mixar>(mixarKeys.one(id), (m) => (m ? { ...m, openedAt } : m));
    })
    .catch(() => {
      last.delete(id);
    });
}
