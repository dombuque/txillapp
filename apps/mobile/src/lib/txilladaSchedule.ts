/**
 * A Txillada agendada (docs/txillada-agendar.md), em contas puras: os dias e as horas que se podem escolher, os formatos da
 * hora («sáb., 20:00», «Amanhã às 20:00»), a contagem («Começa daqui a 2 h 15 min»), o estado do cartão e os textos das
 * notificações. Tudo com o fuso do telemóvel (os métodos locais de Date; Moçambique não muda a hora no verão).
 *
 * Os testes em tests/txilladaAgendar.test.mjs importam este ficheiro diretamente.
 */
import { formatVibes } from '@/lib/vibes';
import { t } from '@/lib/i18n';

/** Pelo menos 15 min à frente, no máximo 30 dias; a grelha de 15 em 15 min; «Começar» a partir de 60 min antes. */
export const LEAD_MIN = 15;
export const STEP_MIN = 15;
export const MAX_DAYS = 30;
export const START_EARLY_MIN = 60;
/** As pastilhas: Hoje, Amanhã e os 5 dias seguintes. */
export const PILL_DAYS = 7;
/** No máximo 5 agendamentos à espera por anfitrião (o servidor responde 409 `too_many`). */
export const MAX_SCHEDULED = 5;

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export const WEEKDAYS = () => ['domingo', 'segunda-feira', t('terça-feira'), 'quarta-feira', 'quinta-feira', 'sexta-feira', t('sábado')] as const;
export const WEEKDAYS_SHORT = () => [t('dom.'), t('seg.'), t('ter.'), t('qua.'), t('qui.'), t('sex.'), t('sáb.')] as const;
export const MONTHS = () => [t('janeiro'), t('fevereiro'), t('março'), t('abril'), t('maio'), t('junho'), t('julho'), t('agosto'), t('setembro'), t('outubro'), t('novembro'), t('dezembro')] as const;
export const MONTHS_SHORT = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'] as const;
/** A semana do calendário começa à segunda (como em Moçambique e em Portugal). */
export const WEEK_INITIALS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const ms = (at: number | string | Date): number => (typeof at === 'number' ? at : new Date(at).getTime());
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** «20:00». */
export const hhmm = (at: number | string | Date): string => { const d = new Date(ms(at)); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** A meia-noite (local) desse dia. */
export const startOfDay = (at: number | string | Date): number => { const d = new Date(ms(at)); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
/** «2026-11-21» (local). */
export const dayKey = (at: number | string | Date): string => { const d = new Date(ms(at)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Quantos dias do calendário vão de `from` a `to` (0 hoje, 1 amanhã, -1 ontem). */
export const dayDiff = (from: number | string | Date, to: number | string | Date): number => Math.round((startOfDay(to) - startOfDay(from)) / DAY);

/** A primeira hora que se pode escolher: daqui a 15 min, arredondada para o quarto de hora seguinte. */
export function earliest(now: number): number {
  const t = now + LEAD_MIN * MIN;
  const d = new Date(t);
  d.setSeconds(0, 0);
  if (d.getTime() < t) d.setMinutes(d.getMinutes() + 1);
  const m = d.getMinutes() % STEP_MIN;
  if (m) d.setMinutes(d.getMinutes() + (STEP_MIN - m));
  return d.getTime();
}
/** A última: daqui a 30 dias. */
export const latest = (now: number): number => now + MAX_DAYS * DAY;
/** A hora pode ir para o servidor? (pelo menos 15 min à frente e no máximo 30 dias). */
export const validStart = (at: number, now: number): boolean => at >= now + LEAD_MIN * MIN && at <= latest(now);

export interface Slot { at: number; label: string; ok: boolean }

/**
 * A grelha das horas de um dia: uma linha por hora (00, 15, 30, 45). As horas que já passaram (ou que ficam a menos de
 * 15 min) vêm com `ok: false`; as linhas sem nenhuma hora boa ficam de fora.
 */
export function daySlots(day: number, now: number): Slot[][] {
  const d = new Date(startOfDay(day));
  const lo = earliest(now);
  const hi = latest(now);
  const rows: Slot[][] = [];
  for (let h = 0; h < 24; h++) {
    const row: Slot[] = [];
    for (let m = 0; m < 60; m += STEP_MIN) {
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
      row.push({ at, label: `${pad(h)}:${pad(m)}`, ok: at >= lo && at <= hi });
    }
    if (row.some((s) => s.ok)) rows.push(row);
  }
  return rows;
}
export const dayHasSlots = (day: number, now: number): boolean => daySlots(day, now).length > 0;

/** «Hoje», «Amanhã» ou «sáb. 21». */
export function dayLabel(day: number, now: number): string {
  const diff = dayDiff(now, day);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  const d = new Date(day);
  return `${WEEKDAYS_SHORT()[d.getDay()].replace('.', '')} ${d.getDate()}`;
}

export interface DayPill { key: string; day: number; label: string }

/** As pastilhas dos dias: Hoje (se ainda houver horas), Amanhã e os 5 dias seguintes. */
export function offeredDays(now: number): DayPill[] {
  const today = new Date(startOfDay(now));
  const out: DayPill[] = [];
  for (let i = 0; i < PILL_DAYS; i++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i).getTime();
    if (dayHasSlots(day, now)) out.push({ key: dayKey(day), day, label: dayLabel(day, now) });
  }
  return out;
}

export interface CalendarCell { day: number; date: number; key: string; ok: boolean; today: boolean }

/** O calendário simples do mês (`month` de 0 a 11): semanas de segunda a domingo; os dias fora do prazo ficam apagados. */
export function monthGrid(year: number, month: number, now: number): (CalendarCell | null)[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (CalendarCell | null)[] = Array.from({ length: lead }, () => null);
  for (let n = 1; n <= days; n++) {
    const day = new Date(year, month, n).getTime();
    cells.push({ day, date: n, key: dayKey(day), ok: dayHasSlots(day, now), today: dayDiff(now, day) === 0 });
  }
  while (cells.length % 7) cells.push(null);
  const weeks: (CalendarCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
/** «Novembro de 2026». */
export const monthTitle = (year: number, month: number): string => `${cap(MONTHS()[((month % 12) + 12) % 12])} de ${year}`;
/** Os meses que o calendário mostra: do de hoje ao de daqui a 30 dias. */
export function monthRange(now: number): { first: { year: number; month: number }; last: { year: number; month: number } } {
  const a = new Date(now);
  const b = new Date(latest(now));
  return { first: { year: a.getFullYear(), month: a.getMonth() }, last: { year: b.getFullYear(), month: b.getMonth() } };
}
/** Andar um mês para a frente ou para trás, sem sair do prazo (null quando já não dá). */
export function shiftMonth(cur: { year: number; month: number }, by: 1 | -1, now: number): { year: number; month: number } | null {
  const d = new Date(cur.year, cur.month + by, 1);
  const next = { year: d.getFullYear(), month: d.getMonth() };
  const { first, last } = monthRange(now);
  const idx = (x: { year: number; month: number }) => x.year * 12 + x.month;
  return idx(next) < idx(first) || idx(next) > idx(last) ? null : next;
}

/** A hora que vem escolhida: a primeira hora certa (HH:00) depois da primeira que se pode escolher. */
export function defaultStart(now: number): number {
  const lo = earliest(now);
  const d = new Date(lo);
  if (d.getMinutes()) d.setHours(d.getHours() + 1, 0, 0, 0);
  return validStart(d.getTime(), now) ? d.getTime() : lo;
}
/** Mudar de dia: fica a mesma hora (20:00) se der nesse dia; senão a primeira hora boa desse dia. */
export function moveToDay(day: number, prev: number | null, now: number): number | null {
  const rows = daySlots(day, now);
  if (!rows.length) return null;
  if (prev != null) {
    const p = new Date(prev);
    const d = new Date(day);
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), p.getHours(), p.getMinutes()).getTime();
    if (validStart(at, now) && new Date(at).getMinutes() % STEP_MIN === 0) return at;
  }
  for (const r of rows) for (const s of r) if (s.ok) return s.at;
  return null;
}

// ─── Formatos ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * «sáb., 20:00» (curto) ou «sábado, 20:00» (`long`). Para lá de uma semana junta o dia do mês: «sáb., 28 nov., 20:00» /
 * «sábado, 28 de novembro, 20:00».
 */
export function fmtWhen(at: number | string, now: number, long = false): string {
  const d = new Date(ms(at));
  const diff = dayDiff(now, d);
  const wd = long ? WEEKDAYS()[d.getDay()] : WEEKDAYS_SHORT()[d.getDay()];
  if (diff >= -1 && diff <= 6) return `${wd}, ${hhmm(d)}`;
  return long ? `${wd}, ${d.getDate()} de ${MONTHS()[d.getMonth()]}, ${hhmm(d)}` : `${wd}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${hhmm(d)}`;
}
/** «Hoje às 20:00», «Amanhã às 20:00», «Sábado às 20:00» ou «Sábado, 28 de novembro às 20:00». */
export function fmtDay(at: number | string, now: number): string {
  const d = new Date(ms(at));
  const diff = dayDiff(now, d);
  if (diff === 0) return t('Hoje às {hhmm}', { hhmm: hhmm(d) });
  if (diff === 1) return t('Amanhã às {hhmm}', { hhmm: hhmm(d) });
  if (diff === -1) return t('Ontem às {hhmm}', { hhmm: hhmm(d) });
  if (diff > 1 && diff <= 6) return t('{cap} às {hhmm}', { cap: cap(WEEKDAYS()[d.getDay()]), hhmm: hhmm(d) });
  return t('{cap}, {date} de {month} às {hhmm}', { cap: cap(WEEKDAYS()[d.getDay()]), date: d.getDate(), month: MONTHS()[d.getMonth()], hhmm: hhmm(d) });
}
/** Numa frase: «hoje às 20:00», «amanhã às 20:00» ou «sáb., 20:00» (`long`: «sábado, 20:00»). */
export function fmtFor(at: number | string, now: number, long = false): string {
  const diff = dayDiff(now, at);
  if (diff === 0) return t('hoje às {hhmm}', { hhmm: hhmm(at) });
  if (diff === 1) return t('amanhã às {hhmm}', { hhmm: hhmm(at) });
  return fmtWhen(at, now, long);
}
/** A linha grande da capa do cartão: «Hoje, 20:00», «Amanhã, 20:00» ou «Sábado, 20:00». */
export function coverWhen(at: number | string, now: number): string {
  const diff = dayDiff(now, at);
  if (diff === 0) return t('Hoje, {hhmm}', { hhmm: hhmm(at) });
  if (diff === 1) return t('Amanhã, {hhmm}', { hhmm: hhmm(at) });
  return cap(fmtWhen(at, now, true));
}
/** A contagem só nas últimas 12 h (ou já passada a hora): antes, a capa já diz o dia e a hora. */
export const showCountdown = (at: number | string, now: number): boolean => ms(at) - now < 12 * 60 * MIN;
/** «Sem lembretes», «1 lembrete», «12 lembretes» (a lista das minhas). */
export function remindersShort(n: number | null | undefined): string {
  const v = Math.max(0, Math.round(n ?? 0));
  return v === 0 ? t('Sem lembretes') : v === 1 ? '1 lembrete' : `${v.toLocaleString('pt-PT')} lembretes`;
}
/** A pastilha do perfil e da fila «Em breve»: «Hoje, 20:00», «Amanhã, 20:00» ou «Sáb., 20:00». */
export function fmtShort(at: number | string, now: number): string {
  const d = new Date(ms(at));
  const diff = dayDiff(now, d);
  if (diff === 0) return t('Hoje, {hhmm}', { hhmm: hhmm(d) });
  if (diff === 1) return t('Amanhã, {hhmm}', { hhmm: hhmm(d) });
  return cap(fmtWhen(d.getTime(), now));
}
/** «2 h 15 min», «45 min», «3 h», «menos de 1 min». */
export function durationText(msLeft: number): string {
  if (msLeft < MIN) return t('menos de 1 min');
  const mins = Math.ceil(msLeft / MIN);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}
/**
 * Já passou da hora e ainda não começou (a fila «Em breve» e o cartão podem trazê-la até expirar, 2 h depois): nos primeiros
 * 5 min «A qualquer momento»; depois «Devia ter começado às 20:00» (null antes da hora).
 */
export function lateText(at: number | string, now: number): string | null {
  const past = now - ms(at);
  if (past < 0) return null;
  return past < 5 * MIN ? t('A qualquer momento') : t('Devia ter começado às {hhmm}', { hhmm: hhmm(at) });
}
/** A hora curta, ou o atraso se já passou: para a fila «Em breve» e o cartão do perfil. */
export const fmtSoon = (at: number | string, now: number): string => lateText(at, now) ?? fmtShort(at, now);
/** A contagem: «Começa daqui a 2 h 15 min» nas próximas 12 h; depois «Amanhã às 20:00»; passada a hora, o atraso. */
export function countdown(at: number | string, now: number): string {
  const left = ms(at) - now;
  if (left <= 0) return lateText(at, now) ?? t('A qualquer momento');
  if (left < 12 * 60 * MIN) return t('Começa daqui a {durationText}', { durationText: durationText(left) });
  return fmtDay(at, now);
}
/** A confirmação depois de agendar: «Agendada para sábado, 20:00» (ou «para hoje às 20:00», «para amanhã às 20:00»). */
export function scheduledText(at: number | string, now: number): string {
  const diff = dayDiff(now, at);
  if (diff === 0) return t('Agendada para hoje às {hhmm}', { hhmm: hhmm(at) });
  if (diff === 1) return t('Agendada para amanhã às {hhmm}', { hhmm: hhmm(at) });
  return t('Agendada para {when}', { when: fmtWhen(at, now, true) });
}
/** O anfitrião pode carregar em «Começar» (a partir de 60 min antes). */
export const canStartNow = (at: number | string, now: number): boolean => now >= ms(at) - START_EARLY_MIN * MIN;
/** Falta mais de 60 min: «Começar agora» pede confirmação (e muda a hora para agora). */
export const startIsEarly = (at: number | string, now: number): boolean => !canStartNow(at, now);

/** «Ainda ninguém pediu para ser lembrado», «1 pessoa pediu para ser lembrada», «12 pessoas pediram para ser lembradas». */
export function remindersText(n: number | null | undefined): string {
  const v = Math.max(0, Math.round(n ?? 0));
  if (v === 0) return t('Ainda ninguém pediu para ser lembrado');
  if (v === 1) return t('1 pessoa pediu para ser lembrada');
  return t('{v} pessoas pediram para ser lembradas', { v: v.toLocaleString('pt-PT') });
}

// ─── O agendamento ──────────────────────────────────────────────────────────────────────────────────────────────────

/** 'removed': retirada pela moderação (denunciada e decidida na fila de queixas). */
export type ScheduleStatus = 'scheduled' | 'started' | 'cancelled' | 'expired' | 'removed';
type Tier = 'verified' | 'official' | 'paid' | null;
type Audience = 'everyone' | 'followers' | 'close' | 'friends' | 'paid';

/** O agendamento como vem da API (`ScheduledTxillada`, docs/txillada-agendar.md). */
export interface ScheduledTxillada {
  id: string;
  host: { id: string; username: string; displayName: string; avatarUrl: string | null; verified?: boolean; verifiedTier?: Tier };
  title: string;
  audience: Audience;
  kind: 'public' | 'friends' | 'paid';
  price: number | null;
  goal: number | null;
  goalPurpose: string;
  startsAt: string;
  status: ScheduleStatus;
  /** Só em 'started': a Txillada que nasceu dele. */
  txilladaId: string | null;
  /** A Txillada que nasceu dele ainda está a decorrer. */
  live: boolean;
  isHost: boolean;
  reminded: boolean;
  /** Quantos pediram lembrete: só para o anfitrião (null para os outros). Depois de começar, o número de quando começou. */
  reminders: number | null;
  createdAt: string;
}
/** O que o perfil traz (`nextTxillada`): o próximo agendamento que eu posso ver. */
export interface NextTxillada { id: string; startsAt: string; title: string; reminded: boolean }

/** O que se escolhe ao agendar (o mesmo do preparar, mais a hora). */
export interface ScheduleInput { title?: string; audience: Audience; price?: number; goal?: number; goalPurpose?: string; startsAt: string }

export type ScheduleView = 'scheduled' | 'live' | 'ended' | 'cancelled' | 'expired' | 'removed';

/** O estado do cartão: à espera, a decorrer, já acabou, cancelada, não chegou a começar ou retirada pela moderação. */
export function scheduleView(s: Pick<ScheduledTxillada, 'status' | 'live' | 'txilladaId'>): ScheduleView {
  if (s.status === 'started') return s.live && s.txilladaId ? 'live' : 'ended';
  if (s.status === 'cancelled') return 'cancelled';
  if (s.status === 'expired') return 'expired';
  if (s.status === 'removed') return 'removed';
  return 'scheduled';
}
/** O cartão de uma Txillada retirada pela moderação. */
export const REMOVED_TEXT = () => t('Esta Txillada foi retirada por não cumprir as regras');
/** O cartão quando a ligação já não abre nada (404: apagada, a conta foi eliminada, ou não a podes ver). */
export const GONE_TITLE = () => t('Esta Txillada já não existe');
/** O texto do estado (fora de 'scheduled'). */
export function viewText(v: ScheduleView, isHost = false): string | null {
  switch (v) {
    case 'live': return t('Está a decorrer');
    case 'ended': return t('Já acabou');
    case 'cancelled': return isHost ? t('Cancelaste esta Txillada') : t('O anfitrião cancelou esta Txillada');
    case 'expired': return t('Não chegou a começar');
    case 'removed': return REMOVED_TEXT();
    default: return null;
  }
}
/** O tipo, como no preparar: «Pública», «Para amigos», «Só amigos próximos» ou «Privada, entrada de 50 vibes». */
export function scheduleKindText(s: Pick<ScheduledTxillada, 'audience' | 'kind' | 'price'>): string {
  if (s.audience === 'paid' || s.kind === 'paid') return s.price != null ? t('Privada, entrada de {vibes}', { vibes: formatVibes(s.price) }) : t('Privada');
  if (s.audience === 'close') return t('Só amigos próximos');
  if (s.audience === 'friends' || s.kind === 'friends') return t('Para amigos');
  return t('Pública');
}
/** O ícone do tipo. */
export const scheduleKindIcon = (s: Pick<ScheduledTxillada, 'audience' | 'kind'>): 'lock' | 'users' | 'star' | 'globe' =>
  s.audience === 'paid' || s.kind === 'paid' ? 'lock' : s.audience === 'close' ? 'star' : s.audience === 'friends' || s.kind === 'friends' ? 'users' : 'globe';
/** A Angariação: «Angariação: meta de 1000 vibes, para a escola» (null sem ela). */
export function scheduleGoalText(s: Pick<ScheduledTxillada, 'goal' | 'goalPurpose'>): string | null {
  if (s.goal == null) return null;
  const why = (s.goalPurpose ?? '').trim();
  return why ? t('Angariação: meta de {vibes}, {why}', { vibes: formatVibes(s.goal), why }) : t('Angariação: meta de {vibes}', { vibes: formatVibes(s.goal) });
}
/** O título que se mostra (sem título: «Txillada de @zeca»). */
export const scheduleTitle = (s: { title?: string | null; host?: { username: string } | null }): string =>
  (s.title ?? '').trim() || (s.host ? t('Txillada de @{username}', { username: s.host.username }) : 'Txillada');

/** A rota do cartão e a ligação para partilhar. */
export const scheduleRoute = (id: string): string => `/txillada/agendada/${encodeURIComponent(id)}`;
export function scheduleShareLink(id: string, base = 'https://txillapp.com'): string {
  return `${(base || 'https://txillapp.com').replace(/\/$/, '')}${scheduleRoute(id)}`;
}
/** «@zeca vai fazer uma Txillada no Txillapp sábado, 20:00: Bom dia». */
export function scheduleShareMessage(s: Pick<ScheduledTxillada, 'host' | 'title' | 'startsAt'>, now: number): string {
  const txt = (s.title ?? '').trim();
  return t('@{username} vai fazer uma Txillada no Txillapp {when}{value}', { username: s.host.username, when: fmtWhen(s.startsAt, now, true), value: txt ? `: ${txt}` : '' });
}

/** O `code` de um erro da API (vem no próprio erro ou no resto da resposta). */
export function errorCode(e: { code?: string; extra?: Record<string, unknown> } | null | undefined): string | undefined {
  return e?.code ?? (typeof e?.extra?.code === 'string' ? (e.extra.code as string) : undefined);
}
/** 409 `not_scheduled`: o agendamento já não está à espera (começou, foi cancelado, expirou ou foi retirado): recarrega-se o cartão. */
export const isNotScheduled = (e: { status?: number; code?: string; extra?: Record<string, unknown> } | null | undefined): boolean => e?.status === 409 && errorCode(e) === 'not_scheduled';

/** Os erros da API em palavras (o servidor também manda a mensagem; o `code` vale mais). */
export function scheduleErrorText(e: { status?: number; code?: string; message?: string; extra?: Record<string, unknown> } | null | undefined): string {
  const code = errorCode(e);
  const m = e?.message && e.message !== 'Erro inesperado' ? e.message : '';
  if (code === 'too_many') return t('Já tens {maxScheduled} Txilladas agendadas. Cancela uma para agendares outra.', { maxScheduled: MAX_SCHEDULED });
  if (code === 'too_close') return t('Já tens uma Txillada agendada perto dessa hora. Escolhe uma hora com pelo menos 30 min de diferença.');
  if (code === 'too_early') return t('Ainda falta mais de uma hora para a hora marcada.');
  if (code === 'not_scheduled') return m || t('Esta Txillada já não está agendada.');
  switch (e?.status) {
    case 400: return m || t('Escolhe uma hora pelo menos 15 min à frente e no máximo daqui a 30 dias.');
    case 403: return m || t('Não podes agendar uma Txillada.');
    case 404: return t('Esta Txillada agendada não existe ou não a podes ver.');
    case 409: return m || t('Esta Txillada já não está agendada.');
    case 422: return m || t('Não deu. Verifica o que escreveste e tenta outra vez.');
    case 429: return m || t('Calma! Espera um bocadinho e tenta outra vez.');
    case 503: return m || t('A Txillada ainda não está disponível.');
    default: return m || t('Não consegui ligar. Verifica a internet e tenta outra vez.');
  }
}

/** Lembrar-me, já, sem esperar pelo servidor (e o número para o anfitrião, se o houver). */
export function withReminded<T extends { reminded: boolean; reminders?: number | null }>(s: T, on: boolean): T {
  if (s.reminded === on) return s;
  const n = s.reminders;
  return { ...s, reminded: on, reminders: n == null ? n : Math.max(0, n + (on ? 1 : -1)) };
}

// ─── Notificações ───────────────────────────────────────────────────────────────────────────────────────────────────

export const SCHEDULE_KINDS = ['txillada_scheduled_soon', 'txillada_scheduled_now', 'txillada_scheduled_cancelled'] as const;
export type ScheduleNoticeKind = typeof SCHEDULE_KINDS[number];
export const isScheduleNotice = (kind: string): kind is ScheduleNoticeKind => (SCHEDULE_KINDS as readonly string[]).includes(kind);
/** Os avisos que são para o próprio anfitrião (a linha não leva o nome dele à frente, como os avisos do sistema). */
export const isHostNotice = (kind: string): boolean => kind === 'txillada_scheduled_soon' || kind === 'txillada_scheduled_now';

type NoticeData = { scheduleId?: unknown; startsAt?: unknown; title?: unknown; moved?: unknown; newStartsAt?: unknown; reminders?: unknown; removed?: unknown } | null | undefined;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * O texto de cada aviso novo:
 * - soon (ao anfitrião): «A tua Txillada começa daqui a 15 min»;
 * - now (ao anfitrião): «Está na hora da tua Txillada»;
 * - cancelled (a quem pediu lembrete, com o @ à frente): «cancelou a Txillada de sábado, 20:00», ou, com `moved`, «mudou a
 *   Txillada para domingo, 19:00»; com `removed` (a moderação retirou-a; a linha não leva o nome à frente, ver
 *   isRemovedNotice): «A Txillada de @x foi retirada» (`actor` = o @ do anfitrião).
 * Por baixo vai o título (e, ao anfitrião, «Toca para começar»).
 */
export function scheduleNoticeText(kind: string, data: NoticeData, now: number, actor?: string): { text: string; sub?: string } {
  const title = str(data?.title);
  const at = str(data?.startsAt);
  const when = at && !Number.isNaN(new Date(at).getTime()) ? fmtWhen(at, now, true) : '';
  switch (kind) {
    case 'txillada_scheduled_soon': return { text: t('A tua Txillada começa daqui a 15 min'), sub: title ? t('{title}. Toca para começar', { title }) : t('Toca para começar') };
    case 'txillada_scheduled_now': {
      // A API junta `data.reminders` (quantos pediram lembrete): «Está na hora da tua Txillada. 12 pessoas pediram para ser lembradas.»
      const n = typeof data?.reminders === 'number' && data.reminders > 0 ? `${remindersText(data.reminders)}. ` : '';
      return { text: t('Está na hora da tua Txillada'), sub: t('{value}{n}Toca para começar', { value: title ? `${title}. ` : '', n }) };
    }
    case 'txillada_scheduled_cancelled': {
      if (data?.removed === true) {
        const who = str(actor);
        return { text: who ? t('A Txillada de @{who} foi retirada', { who }) : t('Uma Txillada agendada foi retirada'), sub: title || undefined };
      }
      if (data?.moved === true) {
        const to = str(data?.newStartsAt);
        const whenTo = to && !Number.isNaN(new Date(to).getTime()) ? fmtWhen(to, now, true) : '';
        return { text: whenTo ? t('mudou a Txillada para {whenTo}', { whenTo }) : t('mudou a hora da Txillada'), sub: title || undefined };
      }
      return { text: when ? t('cancelou a Txillada de {when}', { when }) : t('cancelou a Txillada'), sub: title || undefined };
    }
    default: return { text: t('tem novidades para ti') };
  }
}
/** O aviso de uma Txillada retirada pela moderação: a linha não leva o nome à frente (o texto já diz de quem era). */
export const isRemovedNotice = (kind: string, data: NoticeData): boolean => kind === 'txillada_scheduled_cancelled' && data?.removed === true;
/** Para onde leva: o cartão do agendamento (o anfitrião tem lá o «Começar»). */
export function scheduleNoticeTarget(data: NoticeData): string | null {
  const id = str(data?.scheduleId);
  return id ? scheduleRoute(id) : null;
}
/**
 * O `txillada_live` que veio de um lembrete («@x começou a Txillada que pediste para lembrar»): a API manda
 * `data.reminded: true` (com `scheduleId`); aceita-se também `data.fromReminder` ou `data.reminder`.
 */
export function fromReminder(data: { fromReminder?: unknown; reminder?: unknown; reminded?: unknown } | null | undefined): boolean {
  return data?.fromReminder === true || data?.reminder === true || data?.reminded === true;
}
export const REMINDER_LIVE_TEXT = () => t('começou a Txillada que pediste para lembrar');
