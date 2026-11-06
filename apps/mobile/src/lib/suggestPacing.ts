import { kvGet, kvSet } from './kv';

/**
 * Ritmo das sugestões de pessoas (igual ao site): aparecem "às vezes", não sempre.
 *  - nunca duas vezes dentro de um intervalo mínimo (horas);
 *  - fora desse intervalo, a probabilidade começa baixa e sobe a cada visita em que não apareceu;
 *  - quem dispensa uma sugestão descansa um tempo (soneca).
 * O estado fica só neste aparelho.
 */
const KEY = 'txill_sugg_pacing_v1';

interface Slot { last: number; skips: number }
interface State { slots: Record<string, Slot>; snoozeUntil: number }

async function read(): Promise<State> {
  try {
    const v = JSON.parse((await kvGet(KEY)) ?? 'null') as State | null;
    if (v && typeof v === 'object' && v.slots) return v;
  } catch {
    /* valor por omissão */
  }
  return { slots: {}, snoozeUntil: 0 };
}

/** Decide (e regista) se as sugestões aparecem nesta visita. Chamar uma vez por visita. */
export async function shouldShowSuggestions(slot: string, o: { minGapHours?: number; base?: number; step?: number; max?: number } = {}): Promise<boolean> {
  const { minGapHours = 6, base = 0.3, step = 0.2, max = 0.9 } = o;
  const now = Date.now();
  const s = await read();
  if (now < s.snoozeUntil) return false;
  const cur = s.slots[slot] ?? { last: 0, skips: 0 };
  if (now - cur.last < minGapHours * 3_600_000) return false;
  const show = Math.random() < Math.min(max, base + cur.skips * step);
  s.slots[slot] = show ? { last: now, skips: 0 } : { last: cur.last, skips: cur.skips + 1 };
  await kvSet(KEY, JSON.stringify(s));
  return show;
}

/** Dispensou as sugestões há pouco? */
export async function isSnoozed(): Promise<boolean> {
  return Date.now() < (await read()).snoozeUntil;
}

/** Dispensou uma sugestão: descansa um tempo em todos os sítios. */
export async function snoozeSuggestions(hours = 24) {
  const s = await read();
  s.snoozeUntil = Date.now() + hours * 3_600_000;
  await kvSet(KEY, JSON.stringify(s));
}
