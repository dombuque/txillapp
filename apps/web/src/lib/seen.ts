import { api } from './api';

/**
 * Regista o que apareceu no ecrã (para o feed não repetir sempre o mesmo). Junta os ids e envia de tempos a tempos,
 * e também ao sair da página. Falhas são ignoradas: é só uma ajuda para o ranking.
 */
const pending = new Set<string>();
const sent = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function flushSeen() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!pending.size) return;
  const ids = [...pending].slice(0, 40);
  ids.forEach((id) => pending.delete(id));
  void api.markSeen(ids).catch(() => ids.forEach((id) => sent.delete(id)));
  if (pending.size) timer = setTimeout(flushSeen, 1000);
}

export function trackSeen(id: string) {
  if (sent.has(id)) return;
  sent.add(id);
  pending.add(id);
  if (pending.size >= 10) flushSeen();
  else timer ??= setTimeout(flushSeen, 4000);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushSeen());
}
