import type { Queued } from './analytics';

/** Na web os eventos de uso por enviar (sem rede) ficam no localStorage deste browser, até 200 (ver analyticsStore.ts). */
const KEY = 'tx_analytics_queue';

export function saveQueue(items: Queued[]): void {
  try {
    if (items.length) globalThis.localStorage?.setItem(KEY, JSON.stringify(items));
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* cheio ou bloqueado: fica só em memória */
  }
}

export function loadQueue(): Queued[] {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as Queued[];
  } catch {
    return [];
  }
}
