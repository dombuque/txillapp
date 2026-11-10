/**
 * A linha do tempo da conversa (1:1 e TxillGroups), sem React: onde entram os separadores (a pílula ao centro) — o dia
 * quando muda ("Hoje, 10 nov", "Ontem", "Seg, 9 nov", "12 nov") e a hora quando passam > 15 min no mesmo dia
 * ("Hoje, 11:40") —, o "Mensagens novas" e que bolhas seguidas se juntam. A hora de cada grupo vai nas bolhas.
 * Tudo em hora local e com textos em pt-PT feitos à mão (o mesmo resultado no telemóvel, no site e nos testes).
 *
 * As mensagens entram SEMPRE por ordem de tempo (da mais antiga para a mais recente). A lista do ecrã é invertida
 * (mais recente primeiro): quem a usa inverte o índice (`rows[items.length - 1 - index]`).
 */

/** Mais do que isto entre duas mensagens: separador de hora. */
export const GAP_MS = 15 * 60_000;
/** Mensagens seguidas da mesma pessoa até isto: juntam-se (cantos interiores e 2 pt entre elas). */
export const JOIN_MS = 3 * 60_000;

export interface TimelineMsg {
  id?: string;
  at: string;
  fromMe?: boolean;
  kind?: string;
  sender?: { username: string } | null;
}

export interface TimelineRow {
  /** Texto do separador a pôr ANTES desta mensagem (ou null): o dia, ou o dia e a hora num salto grande. */
  divider: string | null;
  /** "Mensagens novas" antes desta mensagem (a primeira por ler). */
  newMark: boolean;
  /** Junta-se à mensagem anterior (mesma pessoa, ≤ 3 min, sem separador no meio). */
  prevSame: boolean;
  /** Junta-se à mensagem seguinte. */
  nextSame: boolean;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const t = (iso: string) => new Date(iso).getTime();
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Dias de calendário entre `d` e `now` (0 = hoje, 1 = ontem; negativo = no futuro). Arredonda por causa da hora de verão. */
const daysAgo = (d: Date, now: Date) => Math.round((midnight(now) - midnight(d)) / 86_400_000);
const sameDay = (a: string, b: string) => midnight(new Date(a)) === midnight(new Date(b));
const dayMonth = (d: Date, now: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;

/** O dia (separador quando muda o dia): "Hoje, 10 nov", "Ontem", "Seg, 9 nov" (últimos 7 dias), "12 nov", "12 nov 2025". */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = daysAgo(d, now);
  if (days <= 0) return `Hoje, ${dayMonth(d, now)}`;
  if (days === 1) return 'Ontem';
  if (days < 7) return `${WEEKDAYS[d.getDay()]}, ${dayMonth(d, now)}`;
  return dayMonth(d, now);
}

/** Salto grande no mesmo dia (separador com hora): "Hoje, 11:40", "Ontem, 21:03", "Seg, 09:12", "12 nov, 14:05". */
export function timeLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = daysAgo(d, now);
  const day = days <= 0 ? 'Hoje' : days === 1 ? 'Ontem' : days < 7 ? WEEKDAYS[d.getDay()] : dayMonth(d, now);
  return `${day}, ${hhmm(d)}`;
}

/** Estado no cabeçalho quando a pessoa não está online: "Ativo agora", "Ativo há 5 min", "Ativo há 3 h", "Ativo ontem", "Ativo a 3 nov". */
export function activeLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return 'Ativo agora';
  if (mins < 60) return `Ativo há ${mins} min`;
  if (mins < 24 * 60) return `Ativo há ${Math.floor(mins / 60)} h`;
  if (daysAgo(d, now) <= 1) return 'Ativo ontem';
  return `Ativo a ${dayMonth(d, now)}`;
}

/** Duas mensagens seguidas (a antes de b) juntam-se: mesma pessoa, mesmo dia, ≤ 3 min. Reações a mimos ficam sempre sozinhas. */
export function joins(a: TimelineMsg, b: TimelineMsg, group = false): boolean {
  const same = group ? a.fromMe === b.fromMe && (a.fromMe || a.sender?.username === b.sender?.username) : a.fromMe === b.fromMe;
  if (!same || a.kind === 'story_reaction' || b.kind === 'story_reaction') return false;
  const gap = t(b.at) - t(a.at);
  return gap >= 0 && gap <= JOIN_MS && sameDay(a.at, b.at);
}

/**
 * A primeira mensagem por ler: a `unread`-ésima mais recente das que NÃO são minhas (o servidor dá só a contagem).
 * Null quando não há nada por ler ou quando tudo o que está carregado é novo (o separador não ajudaria).
 */
export function firstUnreadId(msgs: readonly TimelineMsg[], unread: number): string | null {
  if (!(unread > 0)) return null;
  let left = unread;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].fromMe) continue;
    if (--left === 0) return i > 0 ? msgs[i].id ?? null : null;
  }
  return null;
}

/**
 * Uma linha por mensagem (mesma ordem): separador de hora antes dela (primeira mensagem, mudança de dia ou > 15 min
 * desde a anterior), "Mensagens novas" antes da `newFrom`, e se se junta à anterior/seguinte. Um separador corta o grupo.
 */
export function chatTimeline(msgs: readonly TimelineMsg[], opts: { group?: boolean; newFrom?: string | null; now?: Date } = {}): TimelineRow[] {
  const now = opts.now ?? new Date();
  const rows: TimelineRow[] = msgs.map((m, i) => {
    const prev = msgs[i - 1];
    const newDay = !prev || !sameDay(prev.at, m.at);
    const gap = newDay || t(m.at) - t(prev.at) > GAP_MS;
    const newMark = !!opts.newFrom && m.id === opts.newFrom;
    return { divider: newDay ? dayLabel(m.at, now) : gap ? timeLabel(m.at, now) : null, newMark, prevSame: !!prev && !gap && !newMark && joins(prev, m, opts.group), nextSame: false };
  });
  for (let i = 0; i < rows.length - 1; i++) rows[i].nextSame = rows[i + 1].prevSame;
  return rows;
}
