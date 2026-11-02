/**
 * Ritmo das sugestões de pessoas: aparecem "às vezes", não sempre.
 * Cada sítio (feed, perfil…) decide uma vez por visita, com estas regras:
 *  - nunca duas vezes dentro de um intervalo mínimo (horas);
 *  - fora desse intervalo, a probabilidade começa baixa e sobe a cada visita em que não apareceu (para não desaparecerem de vez);
 *  - quem dispensa uma sugestão (ou segue alguém por ali) descansa um tempo: não voltam a aparecer durante o "soneca".
 * O estado fica só no aparelho (localStorage).
 */
const KEY = 'txill_sugg_pacing_v1';

interface Slot { last: number; skips: number }
interface State { slots: Record<string, Slot>; snoozeUntil: number }

function read(): State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as State | null;
    if (v && typeof v === 'object' && v.slots) return v;
  } catch {
    /* sem armazenamento: usa o valor por omissão */
  }
  return { slots: {}, snoozeUntil: 0 };
}
function write(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sem armazenamento: só vale agora */
  }
}

/** Decide (e regista) se as sugestões aparecem nesta visita. Chamar uma vez por visita. */
export function shouldShowSuggestions(slot: string, o: { minGapHours?: number; base?: number; step?: number; max?: number; random?: () => number; now?: number } = {}): boolean {
  const { minGapHours = 6, base = 0.3, step = 0.2, max = 0.9, random = Math.random, now = Date.now() } = o;
  const s = read();
  if (now < s.snoozeUntil) return false;
  const cur = s.slots[slot] ?? { last: 0, skips: 0 };
  if (now - cur.last < minGapHours * 3_600_000) return false;
  const p = Math.min(max, base + cur.skips * step);
  const show = random() < p;
  s.slots[slot] = show ? { last: now, skips: 0 } : { last: cur.last, skips: cur.skips + 1 };
  write(s);
  return show;
}

/** Dispensou uma sugestão: descansa um tempo em todos os sítios. */
export function snoozeSuggestions(hours = 24, now = Date.now()) {
  const s = read();
  s.snoozeUntil = now + hours * 3_600_000;
  write(s);
}
