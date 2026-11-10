/**
 * Arrumação das bolhas do chat (lógica pura, sem React, testada em tests/chatLayout.test.mjs):
 *  - grupos: mensagens seguidas da mesma pessoa, com ≤ 3 min entre elas e sem separador de hora pelo meio;
 *  - separadores de hora ("Hoje 11:40", "Ontem 21:03", "Seg 09:12", "12 nov 09:12") quando passa > 1 h ou muda o dia;
 *  - cantos (20 por fora, 6 nos cantos interiores do lado de quem envia) e onde vai o avatar (na última bolha do grupo dela);
 *  - a hora por baixo da última bolha de cada grupo e, nas minhas, os vistos "✓" (entregue) / "✓✓" (visto).
 */

/** O que a arrumação precisa de cada mensagem (a `Msg` do chat tem tudo isto). */
export interface LayoutMsg {
  id: string;
  fromMe: boolean;
  kind: string;
  at: string;
  state?: 'sending' | 'failed';
  sender?: { username: string } | null;
}

export const GROUP_MS = 3 * 60_000;
/** Com a hora já por baixo de cada grupo, o separador central só aparece num dia novo ou depois de 1 h de silêncio. */
export const STAMP_MS = 60 * 60_000;
export const RADIUS = 20;
export const INNER = 6;
/** Espaço entre bolhas do mesmo grupo e entre grupos. */
export const GAP_IN = 2;
export const GAP_OUT = 12;
/** Avatar da outra pessoa e o espaço até à bolha. */
export const AVATAR = 28;
export const AVATAR_GAP = 8;

const t = (iso: string) => new Date(iso).getTime();
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
export const sameDayIso = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b));

/** Estas não se juntam a nada (são cartões ou reações soltas). */
const LONERS = new Set(['story_reaction', 'call']);

/** A mesma pessoa? Nos grupos conta quem enviou; nas conversas diretas, se fui eu ou não. */
export function sameAuthor(a: LayoutMsg, b: LayoutMsg, group: boolean): boolean {
  if (a.fromMe !== b.fromMe) return false;
  if (!group || a.fromMe) return true;
  return !!a.sender && !!b.sender && a.sender.username === b.sender.username;
}

/** Separador de hora antes de `item` (a mais antiga é `older`): a primeira de todas, dia novo ou > 15 min de silêncio. */
export function needsStamp(older: LayoutMsg | undefined, item: LayoutMsg): boolean {
  if (!older) return true;
  if (!sameDayIso(older.at, item.at)) return true;
  return t(item.at) - t(older.at) > STAMP_MS;
}

/** `a` (mais antiga) e `b` (mais recente) ficam no mesmo grupo de bolhas. */
export function joined(a: LayoutMsg, b: LayoutMsg, group: boolean): boolean {
  if (!sameAuthor(a, b, group)) return false;
  if (LONERS.has(a.kind) || LONERS.has(b.kind)) return false;
  if (needsStamp(a, b)) return false;
  return Math.abs(t(b.at) - t(a.at)) <= GROUP_MS;
}

export interface Place {
  /** Separador de hora por cima desta mensagem. */
  stamp: boolean;
  /** Primeira e última bolha do seu grupo (uma bolha sozinha é as duas). */
  first: boolean;
  last: boolean;
}

/** Onde fica `item` entre a mensagem mais antiga (`older`) e a mais recente (`newer`). */
export function place(older: LayoutMsg | undefined, item: LayoutMsg, newer: LayoutMsg | undefined, group: boolean): Place {
  return {
    stamp: needsStamp(older, item),
    first: !older || !joined(older, item, group),
    last: !newer || !joined(item, newer, group),
  };
}

export interface Corners { borderTopLeftRadius: number; borderTopRightRadius: number; borderBottomLeftRadius: number; borderBottomRightRadius: number }

/** Cantos da bolha: 20 por fora; do lado de quem envia, 6 em cima nas do meio/fim e 6 em baixo nas do início/meio. */
export function corners(mine: boolean, first: boolean, last: boolean): Corners {
  const top = first ? RADIUS : INNER;
  const bottom = last ? RADIUS : INNER;
  return mine
    ? { borderTopLeftRadius: RADIUS, borderBottomLeftRadius: RADIUS, borderTopRightRadius: top, borderBottomRightRadius: bottom }
    : { borderTopRightRadius: RADIUS, borderBottomRightRadius: RADIUS, borderTopLeftRadius: top, borderBottomLeftRadius: bottom };
}

/** O avatar da outra pessoa vai só na última bolha de cada grupo dela (nas outras fica o espaço). */
export const showAvatar = (mine: boolean, p: Pick<Place, 'last'>) => !mine && p.last;

const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Texto do separador de hora: "Hoje 11:40", "Ontem 21:03", "Seg 09:12" (na última semana), "12 nov 09:12", "12 nov 2025 09:12". */
export function stampLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (days === 0) return `Hoje ${hhmm(d)}`;
  if (days === 1) return `Ontem ${hhmm(d)}`;
  if (days > 1 && days < 7) return `${DOW[d.getDay()]} ${hhmm(d)}`;
  const year = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MON[d.getMonth()]}${year} ${hhmm(d)}`;
}

export type Ticks = 'seen' | 'sent';

/**
 * Os vistos das minhas mensagens: "✓" (entregue) ou "✓✓" (visto). `items` vem do mais recente para o mais antigo (como a
 * lista invertida); `seenId` é a minha última mensagem quando a outra pessoa já a leu (então todas as minhas anteriores
 * também estão vistas). Uma minha seguida de uma mensagem da outra pessoa também conta como vista (ela respondeu).
 * As que estão a enviar ou falharam ficam de fora (dizem isso elas próprias). Nos grupos não há vistos: mapa vazio.
 */
export function ticksFor(items: LayoutMsg[], seenId: string | null, group: boolean): Map<string, Ticks> {
  const out = new Map<string, Ticks>();
  if (group) return out;
  let seen = false;
  for (const m of items) {
    if (!m.fromMe) {
      seen = true;
      continue;
    }
    if (m.id === seenId) seen = true;
    if (m.state || m.id.startsWith('tmp-')) continue;
    out.set(m.id, seen ? 'seen' : 'sent');
  }
  return out;
}
