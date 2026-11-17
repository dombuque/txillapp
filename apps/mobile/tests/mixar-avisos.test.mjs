// Mixar: avisos e descoberta (0170, docs/mixar-contrato.md «Avisos e descoberta»): a bolinha azul com a abertura do servidor
// (openedAt) e a do aparelho, a linha do Mixar nas Mensagens só com novidades, os avisos na lista das notificações, a
// opção «Mixar» nas definições e as sugestões «Faz um Mixar com…».
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const src = (p) => new URL(`../src/${p}`, import.meta.url).href;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r/g, '');

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) return { url: src(`${spec.slice(2)}.ts`), shortCircuit: true };
    return next(spec, ctx);
  },
});

const x = await import(src('lib/mixar.ts'));
const a = await import(src('lib/mixarAvisos.ts'));

const summary = (o = {}) => ({ id: 'm1', status: 'active', invitedByMe: false, partner: { username: 'ana', displayName: 'Ana Maria', hasAvatar: true }, name: 'Dom + Ana', newToday: 3, challengePending: false, updatedAt: '2026-11-16T03:00:00.000Z', ...o });

test('bolinha: conta a abertura do servidor (openedAt) e a deste aparelho, a mais recente das duas', () => {
  // Aberto noutro aparelho depois da seleção: sem bolinha, mesmo sem nada guardado aqui.
  assert.equal(x.mixarShowDot(summary({ openedAt: '2026-11-16T09:00:00.000Z' }), undefined), false);
  // Aberto ontem (servidor), mas visto aqui depois da seleção de hoje: sem bolinha.
  assert.equal(x.mixarShowDot(summary({ openedAt: '2026-11-15T09:00:00.000Z' }), '2026-11-16T03:00:00.000Z'), false);
  // Aberto ontem nos dois sítios: a seleção nova de hoje traz a bolinha.
  assert.equal(x.mixarShowDot(summary({ openedAt: '2026-11-15T09:00:00.000Z' }), '2026-11-15T03:00:00.000Z'), true);
  // Servidor antigo (sem openedAt) ou null: só conta o aparelho, como antes.
  assert.equal(x.mixarShowDot(summary({ openedAt: null }), undefined), true);
  assert.equal(x.mixarShowDot(summary(), '2026-11-16T03:00:00.000Z'), false);
  // Sem novidade não há bolinha, abra-se ou não.
  assert.equal(x.mixarShowDot(summary({ newToday: 0, openedAt: null }), undefined), false);
  assert.equal(x.latestIso(null, undefined), null);
  assert.equal(x.latestIso('2026-11-16T01:00:00.000Z', '2026-11-16T02:00:00.000Z'), '2026-11-16T02:00:00.000Z');
  assert.equal(x.latestIso('2026-11-16T03:00:00.000Z', null), '2026-11-16T03:00:00.000Z');
});

test('os Mixar com bolinha: convite recebido, novidades por abrir; nunca o convite que mandei', () => {
  const items = [
    summary({ id: 'a' }),
    summary({ id: 'b', openedAt: '2026-11-16T10:00:00.000Z' }),
    summary({ id: 'c', status: 'pending', invitedByMe: true, newToday: 0 }),
    summary({ id: 'd', status: 'pending', invitedByMe: false, newToday: 0 }),
    summary({ id: 'e', newToday: 0, challengePending: true }),
  ];
  assert.deepEqual(x.mixarsWithDot(items).map((s) => s.id), ['a', 'd', 'e']);
  assert.deepEqual(x.mixarsWithDot(items, { a: '2026-11-16T03:00:00.000Z' }).map((s) => s.id), ['d', 'e']);
  assert.deepEqual(x.mixarsWithDot(null), []);
});

test('a linha do Mixar nas Mensagens só aparece com novidades, com a bolinha, por cima dos separadores', () => {
  const entry = read('components/mixar/MixarEntry.tsx');
  assert.match(entry, /const fresh = mixarsWithDot\(q\.data\?\.items, seen\);\s*if \(!fresh\.length\) return null;/);
  assert.match(entry, /const e = inboxEntry\(fresh\)/);
  assert.match(entry, /<MixarDot inline label=\{t\('Há novidades'\)\} \/>/);
  // A dica de antes («Junta os teus gostos…») já não aparece.
  assert.doesNotMatch(entry, /st\.hint/);
  const inbox = read('app/(tabs)/messages.tsx');
  assert.match(inbox, /\{!term && view !== 'requests' \? <MixarEntry \/> : null\}\s*<View style=\{styles\.tabs\} accessibilityRole="tablist">/);
});

test('abrir o Mixar diz ao servidor (POST /open) no ecrã do Mixar e na conversa com um convite recebido', () => {
  const open = read('lib/mixarOpen.ts');
  assert.match(open, /mixarAvisosApi\s*\.open\(id\)/);
  assert.match(open, /setQueryData<\{ items: MixarSummary\[\] \}>\(mixarKeys\.list\(\)/);
  assert.match(read('lib/api.mixarAvisos.ts'), /raw\(`\/mixar\/\$\{id\}\/open`, post\(\{\}\)\)/);
  assert.match(read('app/mixar/[id].tsx'), /markMixarSeen\(mixar\.id, mixar\.updatedAt\);\s*if \(!preview\) markMixarOpened\(qc, mixar\.id\);/);
  assert.match(read('app/messages/[username].tsx'), /markMixarSeen\(mixarHere\.id, mixarHere\.updatedAt\);\s*markMixarOpened\(qc, mixarHere\.id\);/);
  // O aparelho continua de reserva (servidores antigos).
  assert.match(read('lib/mixarSeen.ts'), /kvSet\(KEY/);
});

test('os avisos na lista: textos, o nome do Mixar por baixo e para onde levam', () => {
  const data = { mixarId: '0190a1b2-0000-7000-8000-000000000001', name: 'Dom + Ana' };
  assert.deepEqual(a.mixarNoticeText('mixar_daily', data), { text: 'e tu: a vossa seleção de hoje está pronta', sub: 'Mixar Dom + Ana' });
  assert.deepEqual(a.mixarNoticeText('mixar_pick', data), { text: 'já escolheu no Mixa Challenge, falta tu', sub: 'Mixar Dom + Ana' });
  assert.equal(a.mixarNoticeText('mixar_result', { ...data, match: true }).text, 'também escolheu: acertaram no mesmo');
  assert.equal(a.mixarNoticeText('mixar_result', { ...data, match: false }).text, 'também escolheu: escolheram diferente');
  assert.equal(a.mixarNoticeText('mixar_daily', {}).sub, undefined);
  assert.equal(a.mixarNoticeTarget(data), `/mixar/${data.mixarId}`);
  assert.equal(a.mixarNoticeTarget({ mixarId: '../x' }), null);
  assert.equal(a.mixarNoticeTarget(null), null);
  assert.equal(a.isMixarNotice('mixar_pick'), true);
  assert.equal(a.isMixarNotice('txillada_live'), false);
  const screen = read('app/notifications.tsx');
  assert.match(screen, /case 'mixar_result':\s*case 'mixar_group': return mixarNoticeText\(n\.kind, n\.data\);/);
  assert.match(screen, /case 'mixar_result':\s*case 'mixar_group': return mixarNoticeTarget\(n\.data\);/);
  // O nome de quem vem à frente com o selo (Names), como nos outros avisos.
  assert.match(screen, /<Names actors=\{people\.actors\} total=\{people\.total\} \/>/);
  const api = read('lib/api.ts');
  assert.match(api, /\| 'mixar_daily' \| 'mixar_pick' \| 'mixar_result'\n/);
  assert.match(api, /\| 'mixar_group';/);
});

test('definições: uma opção «Mixar» (as mensagens já não falam do Mixar)', () => {
  const idx = read('lib/settingsIndex.ts');
  assert.match(idx, /mixar: \['Mixar', '[^']+'\]/);
  assert.doesNotMatch(idx.match(/messages: \['Mensagens', '([^']+)'\]/)[1], /Mixar/);
  assert.match(read('components/settings/device.tsx'), /c === 'mixar' \? 'mixar'/);
});

test('sugestões: «Faz um Mixar com Lina», o match, e sem quem já tem Mixar comigo ou dispensei', () => {
  assert.equal(a.suggestionTitle('Lina Sitoe'), 'Faz um Mixar com Lina');
  assert.equal(a.suggestionLine(78.4), 'Falam muito e os gostos batem 78%');
  assert.equal(a.suggestionLine(140), 'Falam muito e os gostos batem 100%');
  const s = (username) => ({ username, displayName: username, hasAvatar: false, match: 80, common: [], verified: false, verifiedTier: null });
  const items = [s('lina'), s('Zeca'), s('bia'), s('jo')];
  assert.deepEqual(a.visibleSuggestions(items, [{ partner: { username: 'zeca' } }]).map((x) => x.username), ['lina', 'bia', 'jo']);
  assert.deepEqual(a.visibleSuggestions(items, [], new Set(['lina'])).map((x) => x.username), ['Zeca', 'bia', 'jo']);
  assert.deepEqual(a.visibleSuggestions(items, null).map((x) => x.username), ['lina', 'Zeca', 'bia']);
  assert.deepEqual(a.visibleSuggestions(undefined, null), []);
  const card = read('components/mixar/MixarSuggestions.tsx');
  assert.match(card, /<NameWithBadge name=\{suggestionTitle\(s\.displayName\)\} who=\{s\}/);
  assert.match(card, /mixar\.run\(s\.username, s\.displayName\)/);
  assert.match(card, /mixarAvisosApi\.dismiss\(s\.username\)/);
  assert.match(card, />\{t\('Convidar'\)\}</);
  assert.match(card, />\{t\('Agora não'\)\}</);
  assert.match(read('app/mixar/index.tsx'), /<MixarSuggestions \/>/);
});

test('os textos novos: sem emojis nem travessões', () => {
  const files = ['lib/mixarAvisos.ts', 'components/mixar/MixarSuggestions.tsx', 'components/mixar/MixarEntry.tsx', 'lib/mixarOpen.ts', 'lib/api.mixarAvisos.ts'];
  for (const f of files) {
    const t = read(f);
    assert.doesNotMatch(t, /[—–]/, f);
    assert.doesNotMatch(t, /\p{Extended_Pictographic}/u, f);
  }
});
