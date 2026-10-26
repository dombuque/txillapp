import { authHeader } from './api';

/**
 * Estatísticas de utilização próprias (nada vai para terceiros). Junta os eventos e envia em lotes.
 * Respeita o "não rastrear" do browser e a definição de cada pessoa (Definições → Ajudar a melhorar).
 */
type Props = Record<string, string | number | boolean>;
interface Queued {
  name: string;
  props?: Props;
  t: number;
}

const queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = true;
let started = false;

const session = (() => {
  try {
    let id = sessionStorage.getItem('txill_sid');
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
      sessionStorage.setItem('txill_sid', id);
    }
    return id;
  } catch {
    return `s${Date.now()}${Math.random().toString(36).slice(2)}`;
  }
})();

const standalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
const dnt = () => typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || (window as unknown as { doNotTrack?: string }).doNotTrack === '1');

/** Ligar/desligar (vem da definição da pessoa). */
export function setAnalyticsEnabled(on: boolean) {
  enabled = on;
  if (!on) queue.length = 0;
}

export function track(name: string, props?: Props) {
  if (!enabled || dnt()) return;
  queue.push({ name, props, t: Date.now() });
  if (queue.length >= 20) void flush();
  else timer ??= setTimeout(() => void flush(), 10_000);
}

export async function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  const headers = authHeader();
  if (!queue.length || !headers.Authorization) return; // ainda sem sessão: espera
  const batch = queue.splice(0, 40);
  const now = Date.now();
  try {
    const res = await fetch('/api/v1/analytics/events', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        sessionId: session,
        platform: standalone() ? 'pwa' : 'browser',
        events: batch.map((e) => ({ name: e.name, props: e.props, ago: Math.min(now - e.t, 3_600_000) })),
      }),
    });
    if (!res.ok && res.status !== 400 && res.status !== 401) queue.unshift(...batch); // erro do servidor: tenta mais tarde
  } catch {
    /* sem rede: perde-se este lote, não faz mal */
  }
  if (queue.length) timer ??= setTimeout(() => void flush(), 10_000);
}

/** Caminho sem ids nem nomes (para contar ecrãs, não pessoas). */
export const screenOf = (path: string) =>
  path
    .replace(/^\/u\/[^/]+\/connections/, '/u/:username/connections')
    .replace(/^\/u\/[^/]+/, '/u/:username')
    .replace(/^\/p\/[^/]+/, '/p/:id')
    .replace(/^\/tag\/[^/]+/, '/tag/:tag')
    .replace(/^\/messages\/[^/]+/, '/messages/:username');

/** Arranque: abertura da app, desempenho (Core Web Vitals) e erros. Chama-se uma vez. */
export function startAnalytics() {
  if (started || typeof window === 'undefined') return;
  started = true;
  track('app_open', { standalone: standalone() });

  void import('web-vitals').then(({ onLCP, onINP, onCLS, onFCP, onTTFB }) => {
    const report = (m: { name: string; value: number; rating: string }) => track('perf', { metric: m.name, value: m.name === 'CLS' ? Math.round(m.value * 1000) / 1000 : Math.round(m.value), rating: m.rating });
    onLCP(report);
    onINP(report);
    onCLS(report);
    onFCP(report);
    onTTFB(report);
  });

  window.addEventListener('error', (e) => track('client_error', { message: String(e.message || 'erro').slice(0, 150), where: screenOf(location.pathname) }));
  window.addEventListener('unhandledrejection', (e) => track('client_error', { message: `rejeição: ${String((e.reason as Error)?.message ?? e.reason).slice(0, 130)}`, where: screenOf(location.pathname) }));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flush());
  window.addEventListener('pagehide', () => void flush());
}
