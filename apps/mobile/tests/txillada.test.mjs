// A Txillada (o live, docs/txillada-contrato.md): o estado do live, a fila dos comentários e dos balões, os eventos do
// canal, o que cada um pode fazer, o «enabled» e o cliente da API (com um servidor a fingir).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const src = (p) => new URL(`../src/${p}`, import.meta.url).href;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r/g, '');

// O cliente da API fala com um servidor a fingir: cada pedido fica em globalThis.__calls e a resposta vem de __reply.
const stubs = {
  '@/lib/api': `
    export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
    export const post = (b) => ({ method: 'POST', body: JSON.stringify(b) });
    export async function raw(path, init = {}) {
      globalThis.__calls.push({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
      const r = globalThis.__reply(path, init);
      if (r instanceof Error) throw r;
      return r;
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

const t = await import(src('lib/txillada.ts'));
const { txilladaApi } = await import(src('lib/api.txillada.ts'));

const host = { id: 'h1', username: 'zeca', displayName: 'Zeca', avatarUrl: '/a.jpg', verified: true, verifiedTier: 'verified' };
const dto = (o = {}) => ({ id: 't1', host, title: 'Bom dia Maputo', audience: 'everyone', status: 'live', startedAt: '2026-11-15T10:00:00.000Z', endedAt: null, viewers: 3, peakViewers: 5, cheers: 10, comments: 2, isHost: false, canComment: true, ...o });
const person = (u) => ({ id: `id-${u}`, username: u, displayName: u.toUpperCase(), avatarUrl: null });
const cm = (id, at, u = 'ana', body = `olá ${id}`) => ({ id, author: person(u), body, createdAt: `2026-11-15T10:${String(at).padStart(2, '0')}:00.000Z` });

// ── enabled ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('enabled: só com { enabled: true } do servidor; sem resposta ou outra coisa, nada da Txillada aparece', () => {
  assert.equal(t.txilladaEnabled({ enabled: true }), true);
  for (const c of [undefined, null, {}, { enabled: false }, { enabled: 'true' }, { enabled: 1 }, 'enabled']) assert.equal(t.txilladaEnabled(c), false);
});

test('Criar: o modo TXILLADA entra no fim (depois do Zás) só quando está ligada', () => {
  const base = [{ id: 'mimo', label: 'Mimo' }, { id: 'post', label: 'Publicação' }, { id: 'tcheka', label: 'Tcheka' }, { id: 'zas', label: 'Zás' }];
  assert.deepEqual(t.withTxilladaKind(base, false).map((k) => k.id), ['mimo', 'post', 'tcheka', 'zas']);
  assert.deepEqual(t.withTxilladaKind(base, true).map((k) => k.id), ['mimo', 'post', 'tcheka', 'zas', 'txillada']);
  assert.equal(t.withTxilladaKind(base, true).at(-1).label, 'Txillada');
  assert.equal(t.withTxilladaKind([...base, { id: 'txillada', label: 'x' }], true).filter((k) => k.id === 'txillada').length, 1, 'sem repetir');
});

test('Criar usa a configuração (React Query) e o ecrã de preparar na câmara do telemóvel e na do site', () => {
  const s = read('src/app/(tabs)/new.tsx');
  assert.match(s, /useTxilladaEnabled\(\)/);
  assert.match(s, /withTxilladaKind\(/);
  assert.equal((s.match(/kindSel === 'txillada'\) return <TxilladaPrep/g) ?? []).length, 2, 'no site e no telemóvel');
  const api = read('src/lib/api.txillada.ts');
  assert.match(api, /queryKey: TXILLADA_CONFIG_KEY, queryFn: txilladaApi\.config, staleTime: 5 \* 60_000/);
});

// ── título e público ─────────────────────────────────────────────────────────────────────────────────────────────────

test('título: opcional, até 80 letras, espaços limpos', () => {
  assert.equal(t.titleError(''), null);
  assert.equal(t.titleError('   '), null);
  assert.equal(t.titleError('Bom dia'), null);
  assert.equal(t.titleError('a'.repeat(80)), null);
  assert.match(t.titleError('a'.repeat(81)), /80/);
  assert.equal(t.cleanTitle('  Bom   dia\n Maputo  '), 'Bom dia Maputo');
  assert.equal(t.cleanTitle('x'.repeat(100)).length, 80);
});

test('público: Todos / Seguidores / Amigos próximos, com os valores do contrato', () => {
  assert.deepEqual(t.AUDIENCES.map((a) => [a.id, a.label]), [['everyone', 'Todos'], ['followers', 'Seguidores'], ['close', 'Amigos próximos']]);
});

// ── eventos do canal ─────────────────────────────────────────────────────────────────────────────────────────────────

test('eventos: só os txillada.* bem formados e desta Txillada passam', () => {
  const c = cm('c1', 1);
  assert.deepEqual(t.parseTxilladaEvent({ type: 'txillada.comment', txilladaId: 't1', comment: c }, 't1'), { type: 'txillada.comment', txilladaId: 't1', comment: c });
  assert.equal(t.parseTxilladaEvent({ type: 'txillada.comment', txilladaId: 't2', comment: c }, 't1'), null, 'de outra Txillada');
  assert.equal(t.parseTxilladaEvent({ type: 'txillada.comment', txilladaId: 't1', comment: { id: 'x' } }, 't1'), null, 'comentário partido');
  assert.deepEqual(t.parseTxilladaEvent({ type: 'txillada.cheer', txilladaId: 't1', cheers: 12, from: { username: 'ana' } }, 't1'), { type: 'txillada.cheer', txilladaId: 't1', cheers: 12, from: { username: 'ana' } });
  assert.equal(t.parseTxilladaEvent({ type: 'txillada.cheer', txilladaId: 't1', cheers: 'x' }, 't1'), null);
  assert.deepEqual(t.parseTxilladaEvent({ type: 'txillada.viewers', txilladaId: 't1', viewers: 7 }, 't1'), { type: 'txillada.viewers', txilladaId: 't1', viewers: 7 });
  assert.equal(t.parseTxilladaEvent({ type: 'txillada.viewers', txilladaId: 't1', viewers: -3 }, 't1').viewers, 0);
  assert.deepEqual(t.parseTxilladaEvent({ type: 'txillada.ended', txilladaId: 't1', status: 'cut' }, 't1'), { type: 'txillada.ended', txilladaId: 't1', status: 'cut' });
  assert.equal(t.parseTxilladaEvent({ type: 'txillada.ended', txilladaId: 't1', status: 'live' }, 't1').status, 'ended', 'um fim nunca diz live');
  assert.deepEqual(t.parseTxilladaEvent({ type: 'txillada.comment_removed', txilladaId: 't1', commentId: 'c1' }, 't1'), { type: 'txillada.comment_removed', txilladaId: 't1', commentId: 'c1' });
  assert.equal(t.parseTxilladaEvent({ type: 'txillada.novo', txilladaId: 't1' }, 't1'), null, 'tipo desconhecido não parte nada');
  assert.equal(t.parseTxilladaEvent({ type: 'message', from: 'ana' }, 't1'), null);
  assert.equal(t.isTxilladaEvent({ type: 'txillada.cheer' }), true);
  assert.equal(t.isTxilladaEvent({ type: 'call' }), false);
  assert.equal(t.isTxilladaEvent(null), false);
});

test('o canal da app entrega os txillada.* ao ecrã da Txillada e não mexe no chat', async () => {
  const rt = read('src/lib/realtime.ts');
  assert.match(rt, /export function onTxilladaEvent/);
  assert.match(rt, /e\.type\.startsWith\('txillada\.'\)\) \{\n\s+txilladaSubs\.forEach\(\(f\) => f\(e\)\);\n\s+return;/);
  const se = await import(src('lib/streamEvents.ts'));
  for (const type of ['txillada.comment', 'txillada.cheer', 'txillada.viewers', 'txillada.ended', 'txillada.comment_removed']) {
    assert.deepEqual(se.planChatEvent({ type }), { notify: false, keys: [] }, type);
  }
  const room = read('src/lib/txilladaRoom.ts');
  assert.match(room, /onTxilladaEvent\(\(raw\) => \{\n\s+const ev = parseTxilladaEvent\(raw, id\);/);
});

// ── estado do live ───────────────────────────────────────────────────────────────────────────────────────────────────

test('estado: os números da API, sem andar para trás nos brindes e no pico; um fim não volta a live', () => {
  let s = t.initialLive(dto());
  assert.deepEqual([s.status, s.viewers, s.peak, s.cheers, s.commentCount], ['live', 3, 5, 10, 2]);
  s = t.applyEvent(s, { type: 'txillada.cheer', txilladaId: 't1', cheers: 14, from: { username: 'ana' } });
  s = t.withDto(s, dto({ cheers: 12, viewers: 2, peakViewers: 5 }));
  assert.equal(s.cheers, 14, 'a resposta atrasada não tira brindes');
  assert.equal(s.viewers, 2);
  s = t.applyEvent(s, { type: 'txillada.viewers', txilladaId: 't1', viewers: 9 });
  assert.deepEqual([s.viewers, s.peak], [9, 9]);
  s = t.applyEvent(s, { type: 'txillada.viewers', txilladaId: 't1', viewers: 4 });
  assert.deepEqual([s.viewers, s.peak], [4, 9]);
  s = t.applyEvent(s, { type: 'txillada.ended', txilladaId: 't1', status: 'ended' });
  s = t.withDto(s, dto({ status: 'live' }));
  assert.equal(s.status, 'ended');
});

test('estado: os brindes dos outros fazem os copos; os meus já os fizeram ao tocar', () => {
  let s = t.initialLive(dto());
  s = t.applyEvent(s, { type: 'txillada.cheer', txilladaId: 't1', cheers: 11, from: { username: 'ana' } }, 'eu');
  assert.deepEqual([s.cheerBurst, s.lastCheerFrom], [1, 'ana']);
  s = t.applyEvent(s, { type: 'txillada.cheer', txilladaId: 't1', cheers: 12, from: { username: 'eu' } }, 'eu');
  assert.deepEqual([s.cheerBurst, s.cheers], [1, 12]);
});

test('comentários: sem repetidos, por hora, os últimos 50, e um apagado não volta num pedido atrasado', () => {
  let s = t.initialLive(dto({ comments: 0 }));
  s = t.withComments(s, [cm('a', 1), cm('b', 2)]);
  s = t.applyEvent(s, { type: 'txillada.comment', txilladaId: 't1', comment: cm('c', 3) });
  s = t.applyEvent(s, { type: 'txillada.comment', txilladaId: 't1', comment: cm('c', 3) });
  assert.deepEqual(s.comments.map((c) => c.id), ['a', 'b', 'c']);
  assert.equal(s.commentCount, 1, 'o eco do mesmo comentário não conta duas vezes');
  s = t.withComments(s, [cm('z', 0)]);
  assert.deepEqual(s.comments.map((c) => c.id), ['z', 'a', 'b', 'c'], 'pela hora');
  s = t.applyEvent(s, { type: 'txillada.comment_removed', txilladaId: 't1', commentId: 'b' });
  assert.deepEqual(s.comments.map((c) => c.id), ['z', 'a', 'c']);
  s = t.withComments(s, [cm('b', 2)]);
  s = t.applyEvent(s, { type: 'txillada.comment', txilladaId: 't1', comment: cm('b', 2) });
  assert.deepEqual(s.comments.map((c) => c.id), ['z', 'a', 'c'], 'o apagado não volta');
  const many = Array.from({ length: 70 }, (_, i) => ({ ...cm(`m${i}`, 10), createdAt: new Date(Date.UTC(2026, 10, 15, 11, 0, i)).toISOString() }));
  s = t.withComments(s, many);
  assert.equal(s.comments.length, 50);
  assert.equal(s.comments.at(-1).id, 'm69');
  assert.equal(t.lastCommentId(s), 'm69');
  const same = t.withComments(s, [many[69]]);
  assert.equal(same, s, 'nada de novo: o mesmo estado (sem redesenhar)');
});

test('o que se vê: a carregar, ao vivo, erro, e acabada (a Txillada não se grava: acabada já não se vê)', () => {
  const s = t.initialLive();
  assert.equal(t.viewKind(null, s, false), 'loading');
  assert.equal(t.viewKind(null, s, true), 'error');
  assert.equal(t.viewKind(dto(), t.initialLive(dto()), false), 'live');
  assert.equal(t.viewKind(dto({ status: 'ended' }), t.initialLive(), false), 'ended');
  assert.equal(t.viewKind(dto({ status: 'cut' }), t.initialLive(), false), 'ended');
  const ended = t.applyEvent(t.initialLive(dto()), { type: 'txillada.ended', txilladaId: 't1', status: 'ended' });
  assert.equal(t.viewKind(dto(), ended, false), 'ended', 'o evento chega antes da API');
});

// ── permissões da UI ─────────────────────────────────────────────────────────────────────────────────────────────────

test('UI: quem vê comenta (se o anfitrião deixa), brinda, partilha e denuncia; o anfitrião transmite', () => {
  assert.deepEqual(t.liveUi(dto()), { host: false, canComment: true, canCheer: true, canReport: true, canShare: true, canBroadcast: false });
  assert.equal(t.liveUi(dto({ canComment: false })).canComment, false);
  assert.deepEqual(t.liveUi(dto({ isHost: true })), { host: true, canComment: true, canCheer: false, canReport: false, canShare: true, canBroadcast: true });
  const off = t.liveUi(dto({ status: 'ended' }));
  assert.deepEqual([off.canComment, off.canCheer, off.canShare, off.canBroadcast], [false, false, false, false]);
  assert.equal(t.liveUi(null).canComment, false);
});

test('toque longo num comentário: o anfitrião apaga e expulsa (menos a si); o autor só apaga o seu', () => {
  const mine = cm('a', 1, 'eu');
  const other = cm('b', 1, 'ana');
  const hostC = cm('c', 1, 'zeca');
  assert.deepEqual(t.commentActions(dto({ isHost: true }), other, 'zeca'), ['remove', 'ban']);
  assert.deepEqual(t.commentActions(dto({ isHost: true }), hostC, 'zeca'), ['remove']);
  assert.deepEqual(t.commentActions(dto(), mine, 'eu'), ['remove']);
  assert.deepEqual(t.commentActions(dto(), other, 'eu'), []);
  assert.deepEqual(t.commentActions(dto({ isHost: true, status: 'ended' }), other, 'zeca'), []);
  assert.deepEqual(t.commentActions(null, other, 'zeca'), []);
});

test('limites: 1 comentário de 2 em 2 s; no máximo 5 brindes por segundo', () => {
  assert.deepEqual(t.commentGate(null, 1000), { ok: true, wait: 0 });
  assert.deepEqual(t.commentGate(1000, 2500), { ok: false, wait: 500 });
  assert.deepEqual(t.commentGate(1000, 3000), { ok: true, wait: 0 });
  let times = [];
  const oks = [];
  for (let i = 0; i < 8; i++) { const g = t.cheerGate(times, 10_000 + i * 50); times = g.times; oks.push(g.ok); }
  assert.deepEqual(oks, [true, true, true, true, true, false, false, false]);
  assert.equal(t.cheerGate(times, 11_100).ok, true, 'passado o segundo, volta a dar');
});

// ── tempo, números, resumo, partilha, notificação, roda ───────────────────────────────────────────────────────────────

test('o tempo e os números', () => {
  assert.equal(t.liveClock(0), '0:00');
  assert.equal(t.liveClock(247_000), '4:07');
  assert.equal(t.liveClock(3_729_000), '1:02:09');
  assert.equal(t.elapsed('2026-11-15T10:00:00.000Z', Date.parse('2026-11-15T10:04:07.000Z')), 247_000);
  assert.equal(t.elapsed('2026-11-15T10:00:00.000Z', Date.parse('2026-11-15T12:00:00.000Z'), '2026-11-15T10:01:00.000Z'), 60_000, 'acabada: até ao fim');
  assert.equal(t.elapsed(null, 5), 0);
  assert.equal(t.viewersLabel(1), '1 a ver');
  assert.equal(t.viewersLabel(1234), '1,2 mil a ver');
});

test('resumo do anfitrião: duração, pico, brindes e comentários; diz que não fica gravada', () => {
  const s = t.applyEvent(t.initialLive(dto({ peakViewers: 5 })), { type: 'txillada.viewers', txilladaId: 't1', viewers: 8 });
  const sum = t.liveSummary(dto({ status: 'ended', endedAt: '2026-11-15T10:12:30.000Z', cheers: 40, comments: 17 }), s, Date.now());
  assert.deepEqual(sum, { duration: '12:30', peak: 8, cheers: 40, comments: 17 });
  assert.match(read('src/components/txillada/TxilladaParts.tsx'), /A Txillada acabou e não fica gravada/);
  assert.match(read('src/components/txillada/TxilladaParts.tsx'), /A Txillada acabou/);
});

test('partilhar: o link txillapp.com/txillada/<id>', () => {
  assert.equal(t.shareLink('t1'), 'https://txillapp.com/txillada/t1');
  assert.equal(t.shareLink('t1', 'https://txillapp.com/'), 'https://txillapp.com/txillada/t1');
  assert.equal(t.shareLink('t1', ''), 'https://txillapp.com/txillada/t1');
  assert.equal(t.shareMessage(dto()), '@zeca está ao vivo no Txillapp: Bom dia Maputo');
});

test('notificação txillada_live: «abriu uma Txillada: <título>» e tocar entra', () => {
  assert.equal(t.noticeText({ title: 'Bom dia Maputo' }), 'abriu uma Txillada: Bom dia Maputo');
  assert.equal(t.noticeText({}), 'abriu uma Txillada');
  assert.equal(t.noticeTarget({ txilladaId: 't1' }), '/txillada/t1');
  assert.equal(t.noticeTarget({ id: 't2' }), '/txillada/t2');
  assert.equal(t.noticeTarget({}), null);
  // A lista junta `txillada: { status }`: acabada (ou já não existe) diz «Já acabou»; a decorrer ou sem o campo, nada.
  assert.equal(t.noticeSub({ status: 'live' }), undefined);
  assert.equal(t.noticeSub({ status: 'ended' }), 'Já acabou');
  assert.equal(t.noticeSub({ status: 'cut' }), 'Já acabou');
  assert.equal(t.noticeSub({ status: null }), 'Já acabou');
  assert.equal(t.noticeSub(undefined), undefined);
  const n = read('src/app/notifications.tsx');
  assert.match(n, /case 'txillada_live': return \{ text: txilladaNoticeText\(n\.data\), sub: txilladaNoticeSub\(n\.txillada\) \};/);
  assert.match(n, /case 'txillada_live': return txilladaNoticeTarget\(n\.data\);/);
});

test('roda AO VIVO: só com live.id; na fila e no perfil, tocar abre /txillada/<id> (e só com a Txillada ligada)', () => {
  assert.equal(t.liveId({ live: { id: 't1' } }), 't1');
  for (const u of [{}, { live: null }, { live: {} }, { live: { id: '' } }, null]) assert.equal(t.liveId(u), null);
  const tray = read('src/components/StoriesTray.tsx');
  assert.match(tray, /const others = trayOthers\(users, txilladaOn\);/);
  assert.match(tray, /onPress=\{\(\) => \(live \? watch\(live\) : view\(u\.username\)\)\}/);
  assert.match(tray, /router\.push\(`\/txillada\/\$\{id\}`/);
  const prof = read('src/components/ProfileStoryAvatar.tsx');
  assert.match(prof, /const live = txilladaOn && !isMe \? liveId \?\? null : null;/);
  assert.match(prof, /router\.push\(`\/txillada\/\$\{live\}`/);
});

test('fila dos mimos: os amigos ao vivo primeiro, também sem mimos; ao acabar saem; o visor salta as entradas só ao vivo', () => {
  const me = { username: 'eu', isMe: true, count: 1, live: null };
  const a = { username: 'a', isMe: false, count: 2, live: null };
  const b = { username: 'b', isMe: false, count: 0, live: { id: 'tb' } };
  const c = { username: 'c', isMe: false, count: 1, live: { id: 'tc' } };
  const d = { username: 'd', isMe: false, count: 3 };
  const users = [me, a, b, c, d];
  assert.deepEqual(t.trayOthers(users, true).map((r) => [r.u.username, r.live]), [['b', 'tb'], ['c', 'tc'], ['a', null], ['d', null]]);
  // Txillada desligada: a entrada só ao vivo sai (não há nada para abrir), as outras ficam pela ordem do servidor.
  assert.deepEqual(t.trayOthers(users, false).map((r) => [r.u.username, r.live]), [['a', null], ['c', null], ['d', null]]);
  // Acabou: a de b sai, a de c fica sem a roda; uma que não está na fila não mexe em nada.
  assert.deepEqual(t.trayWithoutLive(users, 'tb').map((u) => u.username), ['eu', 'a', 'c', 'd']);
  assert.deepEqual(t.trayWithoutLive(users, 'tc').find((u) => u.username === 'c'), { username: 'c', isMe: false, count: 1, live: null });
  assert.deepEqual(t.trayWithoutLive(users, 'zz'), users);
  assert.equal(t.trayWithoutLive(undefined, 'tb'), undefined);
  assert.deepEqual(t.withStories(users).map((u) => u.username), ['eu', 'a', 'c', 'd']);
  // O pedido manda ?live=1 (a app 1.51 não manda e o servidor não lhe dá entradas sem mimos).
  assert.match(read('src/lib/api.ts'), /stories: \(\): Promise<TrayUser\[\]> => raw\('\/stories\?live=1'\),/);
  const tray = read('src/components/StoriesTray.tsx');
  assert.match(tray, /onTxilladaEvent\(/);
  assert.match(tray, /trayWithoutLive\(old, id\)/);
  assert.match(tray, /useFocusEffect\(/);
  assert.match(read('src/app/stories/[username].tsx'), /const order = withStories\(/);
});

// ── os balões a flutuar ──────────────────────────────────────────────────────────────────────────────────────────────

test('balões: entram um de cada vez, no máximo 4 à vista (o 5.º sai a desvanecer), e cada um fica 9 s', () => {
  let s = t.floatAdd(t.floatInit(), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(s.queue, ['a', 'b', 'c', 'd', 'e', 'f']);
  let now = 0;
  for (let i = 0; i < 6; i++) { now += t.FLOAT_STEP_MS; s = t.floatStep(s, now); }
  assert.deepEqual(s.queue, []);
  const v = t.floatView(s, now);
  assert.deepEqual(v.map((e) => [e.id, e.age, e.leaving]), [['b', 4, true], ['c', 3, false], ['d', 2, false], ['e', 1, false], ['f', 0, false]]);
  assert.ok(t.floatBusy(s));
  const late = now + t.FLOAT_TTL_MS;
  assert.ok(t.floatView(s, late).every((e) => e.leaving), 'passados 9 s saem todos');
  s = t.floatStep(s, late + 700);
  assert.deepEqual(s.shown, []);
  assert.equal(t.floatBusy(s), false, 'sem nada, o relógio pára');
});

test('balões: o mesmo comentário não entra duas vezes; numa enxurrada saltam-se os que esperam demais', () => {
  let s = t.floatAdd(t.floatInit(), ['a']);
  s = t.floatAdd(s, ['a', 'b']);
  assert.deepEqual(s.queue, ['a', 'b']);
  s = t.floatAdd(s, Array.from({ length: 20 }, (_, i) => `x${i}`));
  assert.equal(s.queue.length, t.FLOAT_QUEUE_MAX);
  assert.equal(s.queue.at(-1), 'x19');
  const skipped = t.floatSkip(t.floatInit(), ['old1', 'old2']);
  assert.deepEqual(t.floatAdd(skipped, ['old1', 'new']).queue, ['new'], 'quem entra não vê os antigos');
});

test('balões: um comentário apagado sai da fila e do ecrã logo', () => {
  let s = t.floatStep(t.floatAdd(t.floatInit(), ['a', 'b']), 100);
  s = t.floatRemove(s, 'a');
  s = t.floatRemove(s, 'b');
  assert.deepEqual([s.queue, s.shown], [[], []]);
  assert.equal(t.floatRemove(s, 'zz'), s);
});

test('balões: a altura de cada um empilha os mais novos em baixo', () => {
  const entries = [{ id: 'a', age: 2, leaving: false }, { id: 'b', age: 1, leaving: false }, { id: 'c', age: 0, leaving: false }];
  assert.deepEqual(t.floatLift(entries, { c: 40, b: 60 }, 44, 8), { c: 0, b: 48, a: 116 });
});

// ── o cliente da API (com um servidor a fingir) ─────────────────────────────────────────────────────────────────────

test('API: as rotas, os métodos e os corpos do contrato', async () => {
  globalThis.__calls = [];
  globalThis.__reply = (path) => {
    if (path === '/txilladas/config') return { enabled: true };
    if (path === '/txilladas') return { txillada: dto({ isHost: true }), token: 'tok', url: 'ws://localhost:7880' };
    if (path.endsWith('/join')) return { token: 'v', url: 'ws://localhost:7880' };
    if (path.endsWith('/cheer')) return { cheers: 11 };
    if (path.includes('/comments') && !path.includes('?') && !path.includes('/comments/')) return cm('n', 5);
    if (path.includes('/comments')) return { items: [cm('a', 1)] };
    return undefined;
  };
  assert.deepEqual(await txilladaApi.config(), { enabled: true });
  const started = await txilladaApi.start('Bom dia', 'followers');
  assert.equal(started.token, 'tok');
  await txilladaApi.live();
  await txilladaApi.get('t1');
  assert.deepEqual(await txilladaApi.join('t1'), { token: 'v', url: 'ws://localhost:7880' });
  await txilladaApi.end('t1');
  await txilladaApi.comments('t1');
  await txilladaApi.comments('t1', 'c 9');
  await txilladaApi.comment('t1', 'olá');
  await txilladaApi.removeComment('t1', 'c1');
  assert.deepEqual(await txilladaApi.cheer('t1'), { cheers: 11 });
  await txilladaApi.ban('t1', 'ana');
  await txilladaApi.report('t1', 'spam');
  assert.deepEqual(globalThis.__calls.map((c) => [c.method, c.path, c.body]), [
    ['GET', '/txilladas/config', undefined],
    ['POST', '/txilladas', { title: 'Bom dia', audience: 'followers' }],
    ['GET', '/txilladas/live', undefined],
    ['GET', '/txilladas/t1', undefined],
    ['POST', '/txilladas/t1/join', {}],
    ['POST', '/txilladas/t1/end', {}],
    ['GET', '/txilladas/t1/comments', undefined],
    ['GET', '/txilladas/t1/comments?after=c%209', undefined],
    ['POST', '/txilladas/t1/comments', { body: 'olá' }],
    ['DELETE', '/txilladas/t1/comments/c1', undefined],
    ['POST', '/txilladas/t1/cheer', {}],
    ['POST', '/txilladas/t1/ban/ana', {}],
    ['POST', '/txilladas/t1/report', { reason: 'spam' }],
  ]);
});

test('API: um servidor sem a rota (404) ou sem resposta diz que a Txillada está desligada', async () => {
  const { ApiError } = await import('@/lib/api');
  globalThis.__calls = [];
  globalThis.__reply = () => new ApiError(404, 'Não encontrado');
  assert.deepEqual(await txilladaApi.config(), { enabled: false });
  globalThis.__reply = () => ({ enabled: 'sim' });
  assert.deepEqual(await txilladaApi.config(), { enabled: false });
  globalThis.__reply = () => new ApiError(503, 'A Txillada ainda não está disponível.');
  await assert.rejects(txilladaApi.start('x', 'everyone'), (e) => e.status === 503);
});

test('erros em palavras: o servidor primeiro; senão um texto por cada caso', () => {
  assert.equal(t.errorText(403, 'Só a partir dos 18 anos.'), 'Só a partir dos 18 anos.');
  assert.equal(t.errorText(403), 'Não podes ver esta Txillada.');
  assert.equal(t.errorText(404, 'Not found'), 'Esta Txillada não existe ou não a podes ver.');
  assert.equal(t.errorText(409), 'Já tens uma Txillada a decorrer.');
  assert.equal(t.errorText(410), 'A Txillada já acabou.');
  assert.match(t.errorText(429), /Espera um bocadinho/);
  assert.equal(t.errorText(503), 'A Txillada ainda não está disponível.');
  assert.match(t.errorText(undefined, 'Erro inesperado'), /internet/);
});

// ── pacotes e plataforma ──────────────────────────────────────────────────────────────────────────────────────────────

test('pacotes: LiveKit no telemóvel e no site; o react-native-webrtc saiu (o fork serve também as chamadas)', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const p of ['@livekit/react-native', '@livekit/react-native-webrtc', '@livekit/react-native-expo-plugin', 'livekit-client']) assert.ok(pkg.dependencies[p], p);
  // Os dois juntos davam classes repetidas (com.oney.WebRTCModule) no Android e no iPhone.
  assert.equal(pkg.dependencies['react-native-webrtc'], undefined);
  const app = JSON.parse(read('app.json'));
  assert.ok(app.expo.plugins.some((p) => (Array.isArray(p) ? p[0] : p) === '@livekit/react-native-expo-plugin'));
  const calls = read('src/lib/calls/webrtc.ts');
  assert.match(calls, /require\('@livekit\/react-native-webrtc'\)/);
  assert.doesNotMatch(calls, /require\('react-native-webrtc'\)/);
  // O site nunca importa os módulos nativos; o telemóvel só os carrega ao entrar numa Txillada.
  assert.doesNotMatch(read('src/lib/txilladaLive.web.ts'), /(from |require\(|import\()'@livekit\/react-native/);
  assert.doesNotMatch(read('src/components/txillada/TxilladaVideo.web.tsx'), /(from |require\(|import\()'@livekit\/react-native/);
  assert.doesNotMatch(read('src/lib/txilladaLive.ts'), /^import .*@livekit\/react-native/m);
});

test('a Txillada não se grava: nada de gravar, replay ou «guardar como tcheka» no código da app', () => {
  for (const f of ['src/lib/txilladaRoom.ts', 'src/app/txillada/[id].tsx', 'src/components/txillada/TxilladaPrep.tsx', 'src/lib/api.txillada.ts']) {
    const s = read(f);
    assert.doesNotMatch(s, /replay|egress|startRecording|guardar como tcheka/i, f);
  }
});

test('as ligações das Txilladas não entram nos motores de busca (página, robots.txt e nginx)', () => {
  const exp = read('scripts/post-export-web.mjs');
  // Sem Disallow de propósito (5d2fa9c): os motores têm de ler a página para verem o «noindex».
  assert.doesNotMatch(exp, /'Disallow: \/txillada/);
  assert.match(exp, /rel\.startsWith\('txillada\/'\)\) page\.robots = 'noindex, nofollow, noarchive'/);
  assert.match(read('src/lib/noIndex.ts'), /noindex, nofollow, noarchive/);
  assert.match(read('src/app/txillada/[id].tsx'), /useNoIndex\(\)/);
  const ngx = readFileSync(new URL('../../../infra/prod/nginx/conf.d/txillapp.conf', import.meta.url), 'utf8');
  assert.match(ngx, /map "\$host\$request_uri" \$robots_tag/);
  assert.match(ngx, /txillada\(\[\/\?\]\|\$\)" "noindex, nofollow, noarchive"/);
});

// ── brindar os comentários (0161) ───────────────────────────────────────────────────────────────────────────────────

test('brindes aos comentários: o evento da sala, a contagem no balão e a pastilha «🍻 N»', () => {
  assert.deepEqual(
    t.parseTxilladaEvent({ type: 'txillada.comment_cheer', txilladaId: 't1', commentId: 'c1', cheers: 3.7 }, 't1'),
    { type: 'txillada.comment_cheer', txilladaId: 't1', commentId: 'c1', cheers: 3 },
  );
  assert.equal(t.parseTxilladaEvent({ type: 'txillada.comment_cheer', txilladaId: 't1', commentId: 'c1', cheers: -2 }, 't1').cheers, 0);
  assert.equal(t.parseTxilladaEvent({ type: 'txillada.comment_cheer', txilladaId: 't1', commentId: 'c1' }, 't1'), null, 'sem contagem');
  assert.equal(t.parseTxilladaEvent({ type: 'txillada.comment_cheer', txilladaId: 't1', cheers: 2 }, 't1'), null, 'sem comentário');
  assert.equal(t.parseTxilladaEvent({ type: 'txillada.comment_cheer', txilladaId: 't2', commentId: 'c1', cheers: 2 }, 't1'), null, 'de outra Txillada');

  let s = t.withComments(t.initialLive(dto({ comments: 0 })), [cm('a', 1), cm('b', 2)]);
  s = t.applyEvent(s, { type: 'txillada.comment_cheer', txilladaId: 't1', commentId: 'b', cheers: 4 });
  assert.equal(s.comments.find((c) => c.id === 'b').cheers, 4);
  assert.equal(s.comments.find((c) => c.id === 'b').cheered, undefined, 'o evento não diz quem brindou');
  assert.equal(t.applyEvent(s, { type: 'txillada.comment_cheer', txilladaId: 't1', commentId: 'b', cheers: 4 }), s, 'a mesma contagem: o mesmo estado');
  assert.equal(t.applyEvent(s, { type: 'txillada.comment_cheer', txilladaId: 't1', commentId: 'zz', cheers: 9 }), s, 'um comentário que já não está à vista');
  s = t.withCommentCheer(s, 'a', 1, true);
  assert.deepEqual([s.comments[0].cheers, s.comments[0].cheered], [1, true]);
  s = t.applyEvent(s, { type: 'txillada.comment_cheer', txilladaId: 't1', commentId: 'a', cheers: 2 });
  assert.deepEqual([s.comments[0].cheers, s.comments[0].cheered], [2, true], 'o meu brinde fica marcado com a contagem dos outros');

  assert.equal(t.commentCheersLabel(0), '');
  assert.equal(t.commentCheersLabel(undefined), '');
  assert.equal(t.commentCheersLabel(Number.NaN), '');
  assert.equal(t.commentCheersLabel(3), '🍻 3');
  assert.equal(t.commentCheersLabel(999), '🍻 999');
  assert.equal(t.commentCheersLabel(1250), '🍻 1,3 mil');
});

test('brindes aos comentários: a rota do contrato, o ecrã e os balões', async () => {
  globalThis.__calls = [];
  globalThis.__reply = () => ({ cheered: true, cheers: 2 });
  assert.deepEqual(await txilladaApi.cheerComment('t1', 'c 1'), { cheered: true, cheers: 2 });
  assert.deepEqual(globalThis.__calls.map((c) => [c.method, c.path, c.body]), [['POST', '/txilladas/t1/comments/c%201/cheer', {}]]);
  // A sala: só põe (já brindado não manda nada), no máximo 5 por segundo, a contagem sobe logo.
  const room = read('src/lib/txilladaRoom.ts');
  assert.match(room, /function cheerComment\(c: TxilladaComment\): boolean \{\n\s+if \(c\.cheered \|\| kind !== 'live'\) return false;/);
  assert.match(room, /cheerGate\(commentCheerTimes\.current, Date\.now\(\)\)/);
  assert.match(room, /cheerComment, removeComment/);
  // O ecrã liga os dois toques; o toque longo do anfitrião fica.
  const screen = read('src/app/txillada/[id].tsx');
  assert.match(screen, /onHold=\{host \|\| tx\.me \? hold : undefined\} onCheer=\{tx\.me && tx\.kind === 'live' \? tx\.cheerComment : undefined\}/);
  const live = read('src/components/txillada/LiveFloatComments.tsx');
  assert.match(live, /onDoubleTap=\{onCheer \? \(\) => onCheer\(c\) : undefined\}/);
  assert.match(live, /cheers=\{c\.cheers \?\? 0\}/);
  // O balão: duplo toque, os copos (72 px) e a pastilha que salta quando a contagem sobe.
  const bubble = read('src/components/StoryFloatComments.tsx');
  assert.match(bubble, /<CheersPour n=\{burst\} size=\{72\} \/>/);
  assert.match(bubble, /commentCheersLabel\(cheers\)/);
  assert.match(bubble, /if \(cheers <= before \|\| reduce\) return;/);
});
