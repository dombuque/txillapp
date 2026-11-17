// Txillada agendada (docs/txillada-agendar.md): os dias e as horas que se podem escolher, os formatos («sáb., 20:00»,
// «Amanhã às 20:00»), a contagem, o estado do cartão, os textos das notificações, o cliente da API (com um servidor a
// fingir) e a presença das peças na app (preparar, cartão, perfil, «Em breve», notificações).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const src = (p) => new URL(`../src/${p}`, import.meta.url).href;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r/g, '');

const stubs = {
  '@/lib/api': `
    export class ApiError extends Error { constructor(status, message, code, extra) { super(message); this.status = status; this.code = code; this.extra = extra; } }
    export const post = (b) => ({ method: 'POST', body: JSON.stringify(b) });
    export async function raw(path, init = {}) {
      globalThis.__calls.push({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
      return globalThis.__reply(path, init);
    }`,
  '@tanstack/react-query': 'export const useQuery = () => ({ data: undefined });',
};
registerHooks({
  resolve(spec, ctx, next) {
    if (stubs[spec]) return { url: `data:text/javascript,${encodeURIComponent(stubs[spec])}`, shortCircuit: true };
    if (spec.startsWith('@/')) return { url: src(`${spec.slice(2)}.ts`), shortCircuit: true };
    return next(spec, ctx);
  },
});

const s = await import(src('lib/txilladaSchedule.ts'));
const { txilladaApi } = await import(src('lib/api.txillada.ts'));
const { groupKey } = await import(src('lib/notifList.ts'));
const tx = await import(src('lib/txillada.ts'));

// Terça, 17 de novembro de 2026 (hora local do telemóvel).
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const TUE_10 = at(17, 10, 0);
const host = { id: 'h1', username: 'zeca', displayName: 'Zeca', avatarUrl: null, verified: true, verifiedTier: 'verified' };
const sched = (o = {}) => ({
  id: 's1', host, title: 'Bom dia', audience: 'everyone', kind: 'public', price: null, goal: null, goalPurpose: '',
  startsAt: new Date(at(21, 20)).toISOString(), status: 'scheduled', txilladaId: null, live: false, isHost: false,
  reminded: false, reminders: null, createdAt: new Date(TUE_10).toISOString(), ...o,
});

test('a primeira hora: daqui a 15 min, no quarto de hora seguinte', () => {
  assert.equal(s.earliest(at(17, 10, 7)), at(17, 10, 30));
  assert.equal(s.earliest(at(17, 10, 0)), at(17, 10, 15));
  assert.equal(s.earliest(at(17, 10, 0) + 1000), at(17, 10, 30));
  assert.equal(s.earliest(at(17, 23, 50)), at(18, 0, 15));
  assert.equal(s.validStart(at(17, 10, 14), TUE_10), false);
  assert.equal(s.validStart(at(17, 10, 15), TUE_10), true);
  assert.equal(s.validStart(TUE_10 + 31 * 24 * 3600_000, TUE_10), false);
});

test('a grelha das horas: de 15 em 15, só as linhas com horas boas', () => {
  const today = s.daySlots(at(17, 0), at(17, 22, 40));
  assert.deepEqual(today.map((r) => r.map((x) => x.label)), [['23:00', '23:15', '23:30', '23:45']]);
  assert.ok(today[0].every((x) => x.ok));
  const mid = s.daySlots(at(17, 0), at(17, 10, 7));
  assert.deepEqual(mid[0].map((x) => [x.label, x.ok]), [['10:00', false], ['10:15', false], ['10:30', true], ['10:45', true]]);
  assert.equal(mid.length, 14);
  assert.equal(s.daySlots(at(18, 0), TUE_10).length, 24);
  assert.equal(s.daySlots(at(18, 0), TUE_10).flat().length, 96);
  // O último dia do prazo (30 dias) só até à hora de agora.
  const last = s.daySlots(at(17, 0) + 30 * 24 * 3600_000, TUE_10).flat().filter((x) => x.ok);
  assert.equal(last.at(-1).label, '10:00');
  assert.deepEqual(s.daySlots(at(17, 0), at(17, 23, 50)), []);
});

test('as pastilhas dos dias: Hoje, Amanhã e os 5 seguintes; Hoje sai quando já não há horas', () => {
  const p = s.offeredDays(TUE_10);
  assert.deepEqual(p.map((x) => x.label), ['Hoje', 'Amanhã', 'qui 19', 'sex 20', 'sáb 21', 'dom 22', 'seg 23']);
  const late = s.offeredDays(at(17, 23, 50));
  assert.equal(late[0].label, 'Amanhã');
  assert.equal(late.length, 6);
});

test('o calendário do mês: de segunda a domingo, com os dias fora do prazo apagados', () => {
  const nov = s.monthGrid(2026, 10, TUE_10);
  assert.equal(nov[0].filter((c) => c === null).length, 6);
  assert.equal(nov[0][6].date, 1);
  const cells = nov.flat().filter(Boolean);
  assert.equal(cells.length, 30);
  assert.equal(cells.find((c) => c.date === 16).ok, false);
  assert.equal(cells.find((c) => c.date === 17).today, true);
  assert.equal(cells.find((c) => c.date === 17).ok, true);
  const dec = s.monthGrid(2026, 11, TUE_10).flat().filter(Boolean);
  assert.equal(dec.find((c) => c.date === 17).ok, true);
  assert.equal(dec.find((c) => c.date === 18).ok, false);
  assert.equal(s.monthTitle(2026, 10), 'Novembro de 2026');
  assert.deepEqual(s.shiftMonth({ year: 2026, month: 10 }, 1, TUE_10), { year: 2026, month: 11 });
  assert.equal(s.shiftMonth({ year: 2026, month: 11 }, 1, TUE_10), null);
  assert.equal(s.shiftMonth({ year: 2026, month: 10 }, -1, TUE_10), null);
  assert.deepEqual(s.WEEK_INITIALS(), ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']);
});

test('a hora escolhida: a próxima hora certa, e mudar de dia mantém a hora', () => {
  assert.equal(s.defaultStart(at(17, 10, 7)), at(17, 11));
  assert.equal(s.defaultStart(at(17, 10, 45)), at(17, 11));
  assert.equal(s.defaultStart(at(17, 10, 46)), at(17, 12));
  assert.equal(s.moveToDay(at(21, 0), at(17, 20), TUE_10), at(21, 20));
  // Hoje às 8:00 já passou: fica a primeira hora boa de hoje.
  assert.equal(s.moveToDay(at(17, 0), at(18, 8), TUE_10), at(17, 10, 15));
  assert.equal(s.moveToDay(at(17, 0), null, at(17, 23, 50)), null);
});

test('os formatos: «sáb., 20:00», «sábado, 20:00», «Amanhã às 20:00»', () => {
  assert.equal(s.fmtWhen(at(21, 20), TUE_10), 'sáb., 20:00');
  assert.equal(s.fmtWhen(at(21, 20), TUE_10, true), 'sábado, 20:00');
  assert.equal(s.fmtWhen(new Date(at(21, 20)).toISOString(), TUE_10), 'sáb., 20:00');
  assert.equal(s.fmtWhen(at(28, 20), TUE_10), 'sáb., 28 nov., 20:00');
  assert.equal(s.fmtWhen(at(28, 20), TUE_10, true), 'sábado, 28 de novembro, 20:00');
  assert.equal(s.fmtDay(at(18, 20), TUE_10), 'Amanhã às 20:00');
  assert.equal(s.fmtDay(at(17, 20), TUE_10), 'Hoje às 20:00');
  assert.equal(s.fmtDay(at(21, 20), TUE_10), 'Sábado às 20:00');
  assert.equal(s.fmtShort(at(21, 20), TUE_10), 'Sáb., 20:00');
  assert.equal(s.fmtShort(at(18, 9, 5), TUE_10), 'Amanhã, 09:05');
  assert.equal(s.scheduledText(at(21, 20), TUE_10), 'Agendada para sábado, 20:00');
  assert.equal(s.scheduledText(at(18, 20), TUE_10), 'Agendada para amanhã às 20:00');
});

test('a contagem: «Começa daqui a 2 h 15 min» e, longe, o dia e a hora', () => {
  const min = 60_000;
  assert.equal(s.countdown(TUE_10 + 135 * min, TUE_10), 'Começa daqui a 2 h 15 min');
  assert.equal(s.countdown(TUE_10 + 45 * min, TUE_10), 'Começa daqui a 45 min');
  assert.equal(s.countdown(TUE_10 + 180 * min, TUE_10), 'Começa daqui a 3 h');
  assert.equal(s.countdown(TUE_10 + 30_000, TUE_10), 'Começa daqui a menos de 1 min');
  assert.equal(s.countdown(at(18, 20), TUE_10), 'Amanhã às 20:00');
  assert.equal(s.countdown(TUE_10 - 1, TUE_10), 'A qualquer momento');
  assert.equal(s.canStartNow(TUE_10 + 61 * min, TUE_10), false);
  assert.equal(s.canStartNow(TUE_10 + 60 * min, TUE_10), true);
  assert.equal(s.startIsEarly(TUE_10 + 2 * 60 * min, TUE_10), true);
});

test('o estado do cartão e os textos', () => {
  assert.equal(s.scheduleView(sched()), 'scheduled');
  assert.equal(s.scheduleView(sched({ status: 'started', txilladaId: 't1', live: true })), 'live');
  assert.equal(s.scheduleView(sched({ status: 'started', txilladaId: 't1', live: false })), 'ended');
  assert.equal(s.scheduleView(sched({ status: 'cancelled' })), 'cancelled');
  assert.equal(s.scheduleView(sched({ status: 'expired' })), 'expired');
  assert.equal(s.viewText('live'), 'Está a decorrer');
  assert.equal(s.viewText('ended'), 'Já acabou');
  assert.equal(s.viewText('cancelled'), 'O anfitrião cancelou esta Txillada');
  assert.equal(s.viewText('expired'), 'Não chegou a começar');
  assert.equal(s.viewText('scheduled'), null);
  assert.equal(s.remindersText(0), 'Ainda ninguém pediu para ser lembrado');
  assert.equal(s.remindersText(1), '1 pessoa pediu para ser lembrada');
  assert.equal(s.remindersText(12), '12 pessoas pediram para ser lembradas');
  assert.equal(s.scheduleKindText(sched()), 'Pública');
  assert.equal(s.scheduleKindText(sched({ audience: 'friends', kind: 'friends' })), 'Para amigos');
  assert.equal(s.scheduleKindText(sched({ audience: 'close', kind: 'friends' })), 'Só amigos próximos');
  assert.equal(s.scheduleKindText(sched({ audience: 'paid', kind: 'paid', price: 50 })), 'Privada, entrada de 50 vibes');
  assert.equal(s.scheduleGoalText(sched()), null);
  assert.equal(s.scheduleGoalText(sched({ goal: 1000, goalPurpose: 'para a escola' })), 'Angariação: meta de 1000 vibes, para a escola');
  assert.equal(s.scheduleTitle(sched({ title: '' })), 'Txillada de @zeca');
  assert.equal(s.scheduleRoute('a b'), '/txillada/agendada/a%20b');
  assert.equal(s.scheduleShareLink('s1', 'https://txillapp.com/'), 'https://txillapp.com/txillada/agendada/s1');
  assert.equal(s.scheduleShareMessage(sched(), TUE_10), '@zeca vai fazer uma Txillada no Txillapp sábado, 20:00: Bom dia');
});

test('«Lembrar-me» otimista: muda já e acerta o número do anfitrião', () => {
  const a = s.withReminded(sched(), true);
  assert.equal(a.reminded, true);
  assert.equal(a.reminders, null);
  const h = s.withReminded(sched({ reminders: 3 }), true);
  assert.equal(h.reminders, 4);
  assert.equal(s.withReminded(sched({ reminders: 0, reminded: true }), false).reminders, 0);
  const same = sched({ reminded: true });
  assert.equal(s.withReminded(same, true), same);
});

test('os erros em palavras', () => {
  assert.match(s.scheduleErrorText({ status: 409, code: 'too_many' }), /Já tens 5 Txilladas agendadas/);
  assert.match(s.scheduleErrorText({ status: 409, extra: { code: 'too_close' } }), /pelo menos 30 min/);
  assert.match(s.scheduleErrorText({ status: 409, code: 'too_early' }), /mais de uma hora/);
  assert.match(s.scheduleErrorText({ status: 400 }), /15 min/);
  assert.equal(s.scheduleErrorText({ status: 400, message: 'A hora tem de ser pelo menos daqui a 15 minutos.' }), 'A hora tem de ser pelo menos daqui a 15 minutos.');
  assert.match(s.scheduleErrorText({ status: 404 }), /não existe/);
  assert.match(s.scheduleErrorText(null), /internet/);
});

test('as notificações novas: texto, destino e o txillada_live de um lembrete', () => {
  const data = { scheduleId: 's1', startsAt: new Date(at(21, 20)).toISOString(), title: 'Bom dia' };
  assert.deepEqual(s.scheduleNoticeText('txillada_scheduled_soon', data, TUE_10), { text: 'A tua Txillada começa daqui a 15 min', sub: 'Bom dia. Toca para começar' });
  assert.equal(s.scheduleNoticeText('txillada_scheduled_now', { ...data, title: '' }, TUE_10).text, 'Está na hora da tua Txillada');
  assert.equal(s.scheduleNoticeText('txillada_scheduled_now', { ...data, title: '' }, TUE_10).sub, 'Toca para começar');
  assert.equal(s.scheduleNoticeText('txillada_scheduled_cancelled', data, TUE_10).text, 'cancelou a Txillada de sábado, 20:00');
  const moved = { ...data, moved: true, newStartsAt: new Date(at(22, 19)).toISOString() };
  assert.equal(s.scheduleNoticeText('txillada_scheduled_cancelled', moved, TUE_10).text, 'mudou a Txillada para domingo, 19:00');
  assert.equal(s.scheduleNoticeText('txillada_scheduled_cancelled', { moved: true }, TUE_10).text, 'mudou a hora da Txillada');
  assert.equal(s.scheduleNoticeTarget(data), '/txillada/agendada/s1');
  assert.equal(s.scheduleNoticeTarget({}), null);
  assert.equal(s.fromReminder({ fromReminder: true }), true);
  assert.equal(s.fromReminder({ title: 'x' }), false);
  assert.equal(s.REMINDER_LIVE_TEXT(), 'começou a Txillada que pediste para lembrar');
  assert.equal(tx.noticeText({ title: 'Bom dia', fromReminder: true }), 'começou a Txillada que pediste para lembrar');
  assert.equal(tx.noticeText({ title: 'Bom dia', fromReminder: true, reopened: true }), 'reabriu a Txillada: Bom dia');
  assert.equal(tx.noticeText({ title: 'Bom dia' }), 'abriu uma Txillada: Bom dia');
  assert.equal(s.isHostNotice('txillada_scheduled_soon'), true);
  assert.equal(s.isHostNotice('txillada_scheduled_cancelled'), false);
  assert.equal(s.isScheduleNotice('txillada_scheduled_now'), true);
  // Cada aviso fica na sua linha (não se juntam).
  for (const kind of s.SCHEDULE_KINDS) assert.equal(groupKey({ id: 'n', kind, createdAt: '', data, actor: { username: 'zeca' } }), null);
});

test('o cliente da API: agendar, listas, um, editar, cancelar, lembrar e começar com scheduleId', async () => {
  globalThis.__calls = [];
  globalThis.__reply = (path) => (path.startsWith('/txilladas/schedules') && !path.includes('remind') ? sched() : { reminded: true, reminders: null });
  await txilladaApi.schedule({ title: 'Bom dia', audience: 'paid', price: 50, startsAt: '2026-11-21T18:00:00.000Z' });
  await txilladaApi.schedules();
  await txilladaApi.schedules('zeca');
  await txilladaApi.upcoming();
  await txilladaApi.getSchedule('s1');
  await txilladaApi.editSchedule('s1', { startsAt: '2026-11-22T17:00:00.000Z' });
  await txilladaApi.cancelSchedule('s1');
  await txilladaApi.remind('s1', true);
  await txilladaApi.remind('s1', false);
  await txilladaApi.start('Bom dia', 'everyone', { scheduleId: 's1' });
  assert.deepEqual(globalThis.__calls.map((c) => `${c.method} ${c.path}`), [
    'POST /txilladas/schedules',
    'GET /txilladas/schedules',
    'GET /txilladas/schedules?username=zeca',
    'GET /txilladas/schedules/upcoming',
    'GET /txilladas/schedules/s1',
    'PATCH /txilladas/schedules/s1',
    'DELETE /txilladas/schedules/s1',
    'POST /txilladas/schedules/s1/remind',
    'DELETE /txilladas/schedules/s1/remind',
    'POST /txilladas',
  ]);
  assert.deepEqual(globalThis.__calls[0].body, { title: 'Bom dia', audience: 'paid', price: 50, startsAt: '2026-11-21T18:00:00.000Z' });
  assert.deepEqual(globalThis.__calls[5].body, { startsAt: '2026-11-22T17:00:00.000Z' });
  assert.deepEqual(globalThis.__calls[9].body, { title: 'Bom dia', audience: 'everyone', scheduleId: 's1' });
});

test('as peças na app: preparar, cartão, perfil, «Em breve» e notificações', () => {
  const prep = read('components/txillada/TxilladaPrep.tsx');
  assert.match(prep, /ScheduleSheet/);
  assert.match(prep, />\{t\('Agendar'\)\}</);
  const parts = read('components/txillada/TxilladaSchedule.tsx');
  for (const t of ['Outro dia', 'Agendar a Txillada', 'Partilhar', 'Ver no perfil', 'Editar a Txillada']) assert.ok(parts.includes(t), t);
  const route = 'app/txillada/agendada/[id].tsx';
  assert.ok(existsSync(new URL(`../src/${route}`, import.meta.url)));
  const card = read(route);
  for (const t of ['Lembrar-me', 'Vais ser lembrado', 'Começar agora', 'Cancelar a Txillada', 'Entrar', 'NameWithBadge', 'scheduleId']) assert.ok(card.includes(t), t);
  assert.match(card, /danger: true/);
  const cards = read('components/txillada/ScheduleCards.tsx');
  for (const t of ['A tua Txillada agendada', 'Txillada agendada', 'Ver todas (', 'Em breve', 'NameWithBadge']) assert.ok(cards.includes(t), t);
  assert.match(read('components/ProfileView.tsx'), /<NextTxilladaCard /);
  assert.match(read('app/(tabs)/index.tsx'), /<UpcomingRow \/>/);
  const notif = read('app/notifications.tsx');
  for (const k of ['txillada_scheduled_soon', 'txillada_scheduled_now', 'txillada_scheduled_cancelled', 'scheduleNoticeTarget']) assert.ok(notif.includes(k), k);
  assert.match(read('lib/api.ts'), /'txillada_scheduled_soon' \| 'txillada_scheduled_now' \| 'txillada_scheduled_cancelled'/);
});

test('diferenças da API: atraso na fila, not_scheduled, lembrete com reminded e o número no aviso «é agora»', () => {
  const min = 60_000;
  assert.equal(s.lateText(TUE_10 + min, TUE_10), null);
  assert.equal(s.lateText(TUE_10 - 2 * min, TUE_10), 'A qualquer momento');
  assert.equal(s.lateText(at(17, 9, 30), TUE_10), 'Devia ter começado às 09:30');
  assert.equal(s.fmtSoon(at(17, 9, 30), TUE_10), 'Devia ter começado às 09:30');
  assert.equal(s.fmtSoon(at(21, 20), TUE_10), 'Sáb., 20:00');
  assert.equal(s.countdown(at(17, 9, 30), TUE_10), 'Devia ter começado às 09:30');
  assert.equal(s.isNotScheduled({ status: 409, code: 'not_scheduled' }), true);
  assert.equal(s.isNotScheduled({ status: 409, extra: { code: 'not_scheduled' } }), true);
  assert.equal(s.isNotScheduled({ status: 409, code: 'too_early' }), false);
  assert.equal(s.scheduleErrorText({ status: 409, code: 'not_scheduled', message: 'Esta Txillada já não está agendada.' }), 'Esta Txillada já não está agendada.');
  assert.equal(s.fromReminder({ txilladaId: 't1', title: 'x', scheduleId: 's1', reminded: true }), true);
  assert.equal(tx.noticeText({ txilladaId: 't1', title: 'x', scheduleId: 's1', reminded: true }), 'começou a Txillada que pediste para lembrar');
  const now = s.scheduleNoticeText('txillada_scheduled_now', { scheduleId: 's1', title: 'Bom dia', reminders: 12 }, TUE_10);
  assert.equal(now.sub, 'Bom dia. 12 pessoas pediram para ser lembradas. Toca para começar');
  assert.equal(s.scheduleNoticeText('txillada_scheduled_now', { scheduleId: 's1', reminders: 0 }, TUE_10).sub, 'Toca para começar');
});

test('frases e capa: «hoje às 11:00», «Amanhã, 20:00», a contagem só nas últimas 12 h, lembretes curtos', () => {
  assert.equal(s.fmtFor(at(17, 11), TUE_10), 'hoje às 11:00');
  assert.equal(s.fmtFor(at(18, 20), TUE_10), 'amanhã às 20:00');
  assert.equal(s.fmtFor(at(21, 20), TUE_10), 'sáb., 20:00');
  assert.equal(s.fmtFor(at(21, 20), TUE_10, true), 'sábado, 20:00');
  assert.equal(s.coverWhen(at(17, 12), TUE_10), 'Hoje, 12:00');
  assert.equal(s.coverWhen(at(18, 11, 45), TUE_10), 'Amanhã, 11:45');
  assert.equal(s.coverWhen(at(21, 20), TUE_10), 'Sábado, 20:00');
  assert.equal(s.showCountdown(at(17, 12), TUE_10), true);
  assert.equal(s.showCountdown(at(18, 11), TUE_10), false);
  assert.equal(s.showCountdown(at(17, 9), TUE_10), true);
  assert.equal(s.remindersShort(0), 'Sem lembretes');
  assert.equal(s.remindersShort(1), '1 lembrete');
  assert.equal(s.remindersShort(12), '12 lembretes');
});

test('os textos novos: sem emojis nem travessões', () => {
  const files = ['lib/txilladaSchedule.ts', 'components/txillada/TxilladaSchedule.tsx', 'components/txillada/ScheduleCards.tsx', 'app/txillada/agendada/[id].tsx'];
  for (const f of files) {
    const t = read(f);
    assert.doesNotMatch(t, /[–—]/, `${f}: travessão`);
    assert.doesNotMatch(t, /\p{Extended_Pictographic}/u, `${f}: emoji`);
  }
});

test('denunciar e retirar: o estado do cartão, o aviso de retirada e o cliente da API', async () => {
  assert.equal(s.scheduleView(sched({ status: 'removed' })), 'removed');
  assert.equal(s.viewText('removed'), 'Esta Txillada foi retirada por não cumprir as regras');
  assert.equal(s.viewText('removed', true), 'Esta Txillada foi retirada por não cumprir as regras');
  assert.equal(s.GONE_TITLE(), 'Esta Txillada já não existe');
  const data = { scheduleId: 's1', startsAt: new Date(at(21, 20)).toISOString(), title: 'Bom dia', moved: false, removed: true };
  assert.deepEqual(s.scheduleNoticeText('txillada_scheduled_cancelled', data, TUE_10, 'zeca'), { text: 'A Txillada de @zeca foi retirada', sub: 'Bom dia' });
  assert.equal(s.scheduleNoticeText('txillada_scheduled_cancelled', { ...data, title: '' }, TUE_10).text, 'Uma Txillada agendada foi retirada');
  assert.equal(s.isRemovedNotice('txillada_scheduled_cancelled', data), true);
  assert.equal(s.isRemovedNotice('txillada_scheduled_cancelled', { ...data, removed: false }), false);
  assert.equal(s.isRemovedNotice('txillada_scheduled_soon', data), false);
  // Sem `removed`, continua a ser o cancelamento.
  assert.equal(s.scheduleNoticeText('txillada_scheduled_cancelled', { ...data, removed: undefined }, TUE_10, 'zeca').text, 'cancelou a Txillada de sábado, 20:00');
  assert.equal(s.scheduleNoticeTarget(data), '/txillada/agendada/s1');

  globalThis.__calls = [];
  globalThis.__reply = () => undefined;
  await txilladaApi.reportSchedule('s1', 'hate', 'O título ofende');
  await txilladaApi.reportSchedule('s 2', 'spam');
  assert.deepEqual(globalThis.__calls.map((c) => `${c.method} ${c.path}`), ['POST /txilladas/schedules/s1/report', 'POST /txilladas/schedules/s%202/report']);
  assert.deepEqual(globalThis.__calls[0].body, { reason: 'hate', note: 'O título ofende' });
  assert.deepEqual(globalThis.__calls[1].body, { reason: 'spam' });
});

test('o cartão: «Denunciar» abre o ReportSheet só a quem não é anfitrião, sai do cartão depois; retirada e «já não existe»', () => {
  const card = read('app/txillada/agendada/[id].tsx');
  assert.match(card, /<ReportSheet type="txillada_schedule" id=\{s\.id\}/);
  assert.match(card, /view === 'scheduled' && !s\.isHost \? \(\s*<Pressable onPress=\{\(\) => setReporting\(true\)\}/);
  assert.ok(card.includes(">{t('Denunciar')}</Text>"));
  // Depois de denunciar: esquece o cartão, volta a pedir as listas e sai.
  assert.match(card, /qc\.removeQueries\(\{ queryKey: scheduleKey\(id\) \}\)/);
  assert.match(card, /router\.back\(\)/);
  assert.match(card, /title=\{GONE_TITLE\(\)\}/);
  const sheet = read('components/ReportSheet.tsx');
  assert.match(sheet, /type === 'txillada_schedule'\) await txilladaApi\.reportSchedule\(id, reason, note\.trim\(\) \|\| undefined\)/);
  assert.ok(sheet.includes("get txillada_schedule() { return t('esta Txillada agendada'); }"));
  const notif = read('app/notifications.tsx');
  assert.match(notif, /scheduleNoticeText\(n\.kind, n\.data, Date\.now\(\), n\.actor\.username\)/);
  assert.match(notif, /zasRecap \|\| hostNotice \|\| removedNotice \? null/);
  assert.match(read('lib/moderationNotice.ts'), /case 'txillada_schedule': return t\('a tua Txillada agendada'\);/);
});
