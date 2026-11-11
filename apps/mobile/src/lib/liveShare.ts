import * as Location from 'expo-location';
import { ApiError, raw } from '@/lib/api';

/**
 * Localização em direto (como no site, apps/web/src/lib/liveLocation.ts): enquanto a partilha dura e o Txillapp está aberto,
 * segue a posição e envia-a de 20 em 20 segundos (PUT /chat/messages/:id/location). Não pedimos a localização em segundo
 * plano: com a app fechada a partilha não se atualiza (a folha "Enviar localização" diz isso antes de começar).
 * Termina sozinha quando o tempo acaba, quando a pessoa toca em "Parar" (o servidor responde 404) ou com `forgetLive`.
 */
const EVERY_MS = 20_000;
const active = new Map<string, number>(); // id da mensagem → fim (ms)
let sub: Location.LocationSubscription | null = null;
let starting = false;
let timer: ReturnType<typeof setInterval> | null = null;
let last: { lat: number; lng: number } | null = null;

async function push() {
  if (!last) return;
  const now = Date.now();
  for (const [id, until] of [...active]) {
    if (until <= now) {
      active.delete(id);
      continue;
    }
    try {
      await raw(`/chat/messages/${id}/location`, { method: 'PUT', body: JSON.stringify(last) });
    } catch (e) {
      // 404: a partilha terminou (parada ou expirou) ou a mensagem foi apagada. Sem rede, tenta-se na próxima volta.
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) active.delete(id);
    }
  }
  if (active.size === 0) stop();
}

function stop() {
  sub?.remove();
  sub = null;
  if (timer) clearInterval(timer);
  timer = null;
  last = null;
}

/** Começa a atualizar esta partilha até `until` (ms). `from`: a posição com que a mensagem foi enviada. */
export function startLive(messageId: string, until: number, from?: { lat: number; lng: number }) {
  if (until <= Date.now()) return;
  active.set(messageId, until);
  if (from && !last) last = from;
  if (!timer) timer = setInterval(() => void push(), EVERY_MS);
  if (sub || starting) return;
  starting = true;
  Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 10 }, (p) => {
    last = { lat: p.coords.latitude, lng: p.coords.longitude };
  })
    .then((s) => {
      // Entretanto a partilha pode ter acabado.
      if (active.size === 0) s.remove();
      else sub = s;
    })
    .catch(() => undefined)
    .finally(() => {
      starting = false;
    });
}

/** Deixa de atualizar esta partilha (depois de "Parar"). */
export function forgetLive(messageId: string) {
  active.delete(messageId);
  if (active.size === 0) stop();
}

export const isLive = (messageId: string) => active.has(messageId);
