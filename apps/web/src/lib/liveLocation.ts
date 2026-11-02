import { api } from './api';

/**
 * Localização em direto: enquanto a partilha dura e a app está aberta, vai enviando a posição de 20 em 20 segundos.
 * (Numa app web o telemóvel não deixa seguir a posição com a app fechada: a partilha só atualiza com a app aberta.)
 */
const active = new Map<string, number>(); // id da mensagem → fim (ms)
let watch: number | null = null;
let last: { lat: number; lng: number } | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

async function push() {
  if (!last) return;
  const now = Date.now();
  for (const [id, until] of [...active]) {
    if (until <= now) {
      active.delete(id);
      continue;
    }
    try {
      await api.chatLiveUpdate(id, last.lat, last.lng);
    } catch {
      active.delete(id); // a partilha terminou (parada ou expirou)
    }
  }
  if (active.size === 0) stop();
}

function stop() {
  if (watch !== null) navigator.geolocation.clearWatch(watch);
  if (timer) clearInterval(timer);
  watch = null;
  timer = null;
}

/** Começa a atualizar esta partilha até `until`. */
export function startLive(messageId: string, until: number) {
  if (!navigator.geolocation) return;
  active.set(messageId, until);
  if (watch === null) {
    watch = navigator.geolocation.watchPosition(
      (p) => {
        last = { lat: p.coords.latitude, lng: p.coords.longitude };
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    timer = setInterval(() => void push(), 20_000);
  }
}

export function stopLive(messageId: string) {
  active.delete(messageId);
  if (active.size === 0) stop();
}

export const isSharing = (messageId: string) => active.has(messageId);
