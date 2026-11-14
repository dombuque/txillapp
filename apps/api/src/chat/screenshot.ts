import type { RateStore } from '../security/rate-store';

/**
 * Avisos de captura de ecrã (nas conversas a dois, nos TxillGroups e nos Zás): no máximo um por pessoa e por sítio a cada
 * 30 segundos, e no máximo 30 por hora no total. Os tempos ficam no store partilhado dos limites (RATE_STORE: Redis com
 * REDIS_URL, igual nas 3 réplicas; PostgreSQL sem ele), com janela fixa que começa no primeiro aviso.
 */
export const SCREENSHOT_EVERY_MS = 30_000;
export const SCREENSHOT_PER_HOUR = 30;
const HOUR_MS = 3_600_000;

/** As chaves no store: a de cada sítio (`c:<conversa>`, `g:<grupo>`, `z:<Zás>`) e o teto por hora de quem faz. */
export const screenshotKeys = (me: string, where: string) => ({ spot: `shot:${me}:${where}`, hour: `shot:${me}` });

/** Este aviso pode seguir? (false = é repetido ou passou do teto: o pedido responde na mesma, mas não faz nada.) */
export async function screenshotAllowed(store: RateStore, me: string, where: string): Promise<boolean> {
  const k = screenshotKeys(me, where);
  if ((await store.hit(k.spot, SCREENSHOT_EVERY_MS)) > 1) return false;
  return (await store.hit(k.hour, HOUR_MS)) <= SCREENSHOT_PER_HOUR;
}
