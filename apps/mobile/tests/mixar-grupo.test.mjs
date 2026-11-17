// Mixar de grupo (0173, docs/mixar-contrato.md «Mixar de grupo»): a razão de quem é o gosto, o «visto por», o convite e a
// entrada, a lista, a bolinha azul (no cabeçalho do grupo e na linha do grupo nas Mensagens), o desafio com a contagem, os
// avisos e as entradas nos ecrãs.
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

const g = await import(src('lib/mixarGrupo.ts'));
const av = await import(src('lib/mixarAvisos.ts'));

const person = (displayName, username = displayName.toLowerCase()) => ({ username, displayName, hasAvatar: false, verified: false, verifiedTier: null });
const ana = person('Ana Maria', 'ana');
const zeca = person('Zeca', 'zeca');
const rui = person('Rui', 'rui');
const dom = person('Dom', 'dom');
const info = (o = {}) => ({ groupId: 'g1', groupName: 'Malta do Bonsai', people: [dom, ana, zeca], members: 4, myState: 'in', canJoin: false, need: 0, proposedBy: dom, ...o });
const summary = (o = {}, gi = {}) => ({ id: 'm1', status: 'active', invitedByMe: false, partner: ana, name: 'Malta do Bonsai', newToday: 0, challengePending: false, updatedAt: '2026-11-17T03:00:00.000Z', openedAt: null, group: info(gi), ...o });

test('só grupos de 3 a 5 pessoas', () => {
  assert.equal(g.groupCanMixar(2), false);
  assert.equal(g.groupCanMixar(3), true);
  assert.equal(g.groupCanMixar(5), true);
  assert.equal(g.groupCanMixar(6), false);
  assert.equal(g.groupCanMixar(undefined), false);
});

test('a razão diz de quem é o gosto, sem artigo antes dos nomes', () => {
  const t = { topic: 'musica', label: 'Música' };
  assert.equal(g.groupReasonText({ fans: [ana, zeca], mine: true, everyone: true }, t), 'Música, do gosto de todos');
  assert.equal(g.groupReasonText({ fans: [ana, zeca], mine: true, everyone: true }, null), 'Do gosto de todos');
  assert.equal(g.groupReasonText({ fans: [ana, zeca], mine: false, everyone: false }, null), 'Do gosto de Ana e Zeca');
  assert.equal(g.groupReasonText({ fans: [ana, zeca], mine: false, everyone: false }, t), 'Música, do gosto de Ana e Zeca');
  assert.equal(g.groupReasonText({ fans: [ana], mine: true, everyone: false }, t), 'Música, do teu gosto e de Ana');
  assert.equal(g.groupReasonText({ fans: [], mine: true, everyone: false }, null), 'Do teu gosto');
  assert.equal(g.groupReasonText({ fans: [], mine: false, everyone: false }, null), 'Escolhido para o grupo');
  assert.equal(g.joinNames(['Ana', 'Zeca', 'Rui']), 'Ana, Zeca e Rui');
  assert.equal(g.groupReasonIcon({ fans: [], mine: true, everyone: false }), 'user');
  assert.equal(g.groupReasonIcon({ fans: [ana], mine: false, everyone: false }), 'heart');
  assert.equal(g.groupReasonIcon({ fans: [ana], mine: true, everyone: true }), 'users');
  for (const s of [g.groupReasonText({ fans: [ana, zeca], mine: false, everyone: false }, t), g.GROUP_COMMENTS.private, g.GROUP_SAVED_EMPTY.line]) {
    assert.doesNotMatch(s, /[—–]/);
    assert.doesNotMatch(s, /\b(o|a) (Ana|Zeca)\b/);
  }
});

test('visto por: os nomes, ou «todos» quando todos os outros viram', () => {
  assert.equal(g.groupSeenText([], 2), null);
  assert.equal(g.groupSeenText([ana], 2), 'Visto por Ana');
  assert.equal(g.groupSeenText([ana, zeca], 2), 'Visto por todos');
  assert.equal(g.groupSeenText([ana, zeca], 3), 'Visto por Ana e Zeca');
});

test('o convite: entrar (com quem já está), à espera de gente, cheio; quem não entrou não vê gostos', () => {
  const join = g.groupInviteView({ status: 'pending', invitedByMe: false, group: info({ myState: null, canJoin: true, need: 1, people: [dom, ana] }) });
  assert.equal(join.tone, 'join');
  assert.equal(join.title, 'Dom propôs um Mixar do grupo');
  assert.match(join.line, /Já estão: Dom e Ana\./);
  const wait = g.groupInviteView({ status: 'pending', invitedByMe: true, group: info({ myState: 'in', need: 2, people: [dom] }) });
  assert.deepEqual([wait.tone, wait.title], ['waiting', 'Faltam 2 pessoas para começar']);
  assert.equal(g.groupInviteView({ status: 'pending', invitedByMe: true, group: info({ myState: 'in', need: 1, people: [dom, ana] }) }).title, 'Falta 1 pessoa para começar');
  const later = g.groupInviteView({ status: 'active', invitedByMe: false, group: info({ myState: 'declined', canJoin: true }) });
  assert.equal(later.tone, 'join');
  assert.match(later.line, /Os teus gostos só contam se entrares/);
  assert.equal(g.groupInviteView({ status: 'active', invitedByMe: false, group: info({ myState: null, canJoin: false, people: [dom, ana, zeca, rui, person('Eva')] }) }).tone, 'full');
});

test('a lista e a bolinha azul (openedAt): convite por responder, novidades de quem está; some ao abrir', () => {
  assert.equal(g.groupSummaryLine(summary({ newToday: 3, challengePending: true })), '3 novos hoje · Mixa Challenge à tua espera');
  assert.equal(g.groupSummaryLine(summary({}, {})), 'Tudo visto por hoje');
  assert.equal(g.groupSummaryLine(summary({ status: 'pending' }, { need: 1 })), 'Falta 1 pessoa para começar');
  assert.equal(g.groupSummaryLine(summary({ status: 'pending' }, { myState: null })), 'Propuseram um Mixar do grupo');
  // Convite por responder: bolinha até abrir.
  assert.equal(g.groupShowDot(summary({ status: 'pending' }, { myState: null })), true);
  assert.equal(g.groupShowDot(summary({ status: 'pending', openedAt: '2026-11-17T04:00:00.000Z' }, { myState: null })), false);
  // Quem está: só com novidades de hoje (e até abrir); «Agora não» e quem saiu, nada.
  assert.equal(g.groupShowDot(summary({ newToday: 2 })), true);
  assert.equal(g.groupShowDot(summary({ newToday: 2 }), '2026-11-17T03:00:00.000Z'), false);
  assert.equal(g.groupShowDot(summary({ newToday: 0 })), false);
  assert.equal(g.groupShowDot(summary({ newToday: 2 }, { myState: 'declined' })), false);
  assert.equal(g.groupShowDot(summary({ newToday: 2 }, { myState: 'left' })), false);
  assert.equal(g.groupShowDot(null), false);
  assert.equal(g.mixarOfGroup([summary()], 'g1').id, 'm1');
  assert.equal(g.mixarOfGroup([summary()], 'g2'), null);
});

test('Mixa Challenge em grupo: a fase, a linha e quantos escolheram cada opção', () => {
  const c = (o = {}, gi = {}) => ({ myPick: null, match: null, ...o, group: { picked: 0, total: 3, pickedBy: [], counts: null, ...gi } });
  assert.equal(g.groupChallengeLine(c()).line, 'Escolhe um. O resultado abre quando todos escolherem.');
  assert.equal(g.groupChallengeLine(c({}, { picked: 2 })).line, 'Já escolheram 2 de 3. Agora tu!');
  assert.deepEqual(g.groupChallengeLine(c({ myPick: 'p1' }, { picked: 1 })), { phase: 'waiting', line: 'Já escolheram 1 de 3' });
  const done = c({ myPick: 'p1', match: false }, { picked: 3, counts: [{ postId: 'p1', n: 2 }, { postId: 'p2', n: 1 }] });
  assert.deepEqual(g.groupChallengeLine(done), { phase: 'result', line: 'Vê quantos escolheram cada um' });
  assert.equal(g.groupChallengeLine({ ...done, match: true }).line, 'Escolheram todos o mesmo!');
  assert.equal(g.countOf(done, 'p1'), 2);
  assert.equal(g.countOf(done, 'p3'), 0);
  assert.equal(g.countOf(c(), 'p1'), null);
  assert.equal(g.pickedLabel(1), '1 escolheu');
  assert.equal(g.pickedLabel(2), '2 escolheram');
});

test('Guardados, conversa e sair no grupo', () => {
  assert.equal(g.groupSavedByText('me', null), 'Guardaste tu');
  assert.equal(g.groupSavedByText('them', ana), 'Guardado por Ana');
  assert.equal(g.groupSavedByText('both', null), 'A maioria reagiu');
  assert.match(g.groupLeaveText(3).line, /acaba para todos/);
  assert.match(g.groupLeaveText(4).line, /podes voltar a entrar/);
  assert.equal(g.groupProposeError({ status: 409, message: 'O Mixar de grupo é para grupos de 3 a 5 pessoas' }), 'O Mixar de grupo é para grupos de 3 a 5 pessoas');
  assert.match(g.groupProposeError({ status: 429 }), /amanhã/);
});

test('avisos: «propôs um Mixar do grupo» e as variantes do grupo', () => {
  const data = { mixarId: '0190a1b2-0000-7000-8000-000000000001', name: 'Malta do Bonsai', groupId: 'g1' };
  assert.equal(av.isMixarNotice('mixar_group'), true);
  assert.deepEqual(av.mixarNoticeText('mixar_group', data), { text: 'propôs um Mixar do grupo', sub: 'Mixar do grupo Malta do Bonsai' });
  assert.equal(av.mixarNoticeText('mixar_daily', { ...data, group: true }).text, 'e o resto do grupo: a vossa seleção de hoje está pronta');
  assert.equal(av.mixarNoticeText('mixar_result', { ...data, group: true, match: true }).text, 'também escolheu: escolheram todos o mesmo');
  assert.equal(av.mixarNoticeTarget(data), `/mixar/${data.mixarId}`);
  // O Mixar a dois fica igual.
  assert.equal(av.mixarNoticeText('mixar_daily', { mixarId: data.mixarId, name: 'Dom + Ana' }).text, 'e tu: a vossa seleção de hoje está pronta');
});

test('entradas nos ecrãs: cabeçalho e menu do grupo, linha do grupo nas Mensagens, secção na lista, convite e feed do grupo', () => {
  const grp = read('app/messages/g/[id].tsx');
  assert.match(grp, /useGroupMixar\(id, group\?\.members\.length\)/);
  assert.match(grp, /label: 'Mixar do grupo', onPress: gmixar\.run/);
  assert.match(grp, /gmixar\.dot \? <MixarDot size=\{8\} \/> : null/);
  const hook = read('components/mixar/useGroupMixar.ts');
  assert.match(hook, /const show = !!here \|\| groupCanMixar\(members\);/);
  assert.match(hook, /mixarApi\.proposeGroup\(groupId\)/);
  assert.match(read('app/(tabs)/messages.tsx'), /<GroupCard \{\.\.\.groupCardData\(r\.g\)\} mixarNew=\{mixarGroupNew\.has\(r\.g\.id\)\}/);
  assert.match(read('components/groups/GroupCard.tsx'), /p\.mixarNew \? <View style=\{s\.mixar\}>/);
  const list = read('app/mixar/index.tsx');
  assert.match(list, /Os vossos Mixar de grupo/);
  const screen = read('app/mixar/[id].tsx');
  assert.match(screen, /const live = mixar\?\.status === 'active' && joined;/);
  assert.match(screen, /<GroupJoinView /);
  assert.match(screen, /groupReasonText\(it\.group, it\.topic\)/);
  assert.match(read('components/mixar/MixarPages.tsx'), /pickedLabel\(n\)/);
  assert.match(read('lib/api.mixar.ts'), /raw\(`\/mixar\/grupo\/\$\{groupId\}`, post\(\{\}\)\)/);
});
