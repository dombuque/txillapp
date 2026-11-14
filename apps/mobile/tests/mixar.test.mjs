// Testes do Mixar (src/lib/mixar.ts, com os dados de exemplo do contrato docs/mixar-contrato.md): os textos da razão,
// o estado do cartão do chat, quando mandar /seen (no máximo um por item e por visita), o Mixa Challenge, as páginas do
// feed, o fim do dia (05:00 de Maputo), o acesso nas Mensagens, os erros, o tempo real e as entradas nos ecrãs.
// Correr em apps/mobile:  node --test tests/mixar.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const x = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'mixar.ts')).href);
const se = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'streamEvents.ts')).href);
const im = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'inboxMenu.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');

// Dados de exemplo com a forma do contrato.
const post = (id, kind = 'video') => ({ id, code: id, body: '', locationLabel: null, media: [{ url: `/m/${id}.mp4`, kind, posterUrl: `/m/${id}.jpg` }], createdAt: '2026-11-14T08:00:00Z', author: { id: `a-${id}`, username: `autor_${id}`, displayName: `Autor ${id}` }, cheers: 0, comments: 0, cheered: false, reposts: 0, reposted: false, gifts: 0, canGift: false, kind: 'post', gift: null });
const item = (id, o = {}) => ({ post: post(id), from: 'both', topic: { topic: 'musica', label: 'Música' }, mine: null, theirs: null, seenByThem: false, ...o });
const challenge = (o = {}) => ({ id: 'c1', kind: 'mais_engracado', question: 'Qual é o mais engraçado?', day: '2026-11-14', options: [post('p1'), post('p2'), post('p3')], myPick: null, theirPicked: false, theirPick: null, match: null, ...o });
const summary = (o = {}) => ({ id: 'm1', status: 'active', invitedByMe: false, partner: { username: 'ana', displayName: 'Ana Maria', hasAvatar: true }, name: 'Dom + Ana', newToday: 0, challengePending: false, updatedAt: '2026-11-14T06:00:00Z', ...o });

test('primeiro nome: «Ana Maria» → «Ana»; sem nome, «a outra pessoa»', () => {
  assert.equal(x.firstName('Ana Maria'), 'Ana');
  assert.equal(x.firstName('  Dom  '), 'Dom');
  assert.equal(x.firstName(''), 'a outra pessoa');
  assert.equal(x.firstName(undefined), 'a outra pessoa');
});

test('a razão: «Porque gostas de…», «Porque Ana gosta de…», «Os dois gostam de…»', () => {
  assert.equal(x.reasonText('me', { topic: 'musica', label: 'Música' }, 'Ana'), 'Porque gostas de Música');
  assert.equal(x.reasonText('them', { topic: 'futebol', label: 'Futebol' }, 'Ana'), 'Porque Ana gosta de Futebol');
  assert.equal(x.reasonText('both', { topic: 'comedia', label: 'Comédia' }, 'Ana'), 'Os dois gostam de Comédia');
});

test('a razão sem tema (topic null ou etiqueta vazia): uma frase genérica, nunca «de undefined»', () => {
  assert.equal(x.reasonText('me', null, 'Ana'), 'Escolhido pelos teus gostos');
  assert.equal(x.reasonText('them', null, 'Ana'), 'Escolhido pelos gostos de Ana');
  assert.equal(x.reasonText('both', { topic: 't', label: '  ' }, 'Ana'), 'Escolhido para os dois');
  for (const from of ['me', 'them', 'both']) assert.doesNotMatch(x.reasonText(from, undefined, 'Ana'), /undefined|null/);
  assert.equal(x.reasonIcon('me'), 'user');
  assert.equal(x.reasonIcon('them'), 'heart');
  assert.equal(x.reasonIcon('both'), 'users');
});

test('as seis reações, pela ordem do contrato; tocar na minha tira-a, noutra troca', () => {
  assert.deepEqual(x.MIXAR_REACTIONS.map((r) => r.id), ['kkk', 'fogo', 'amor', 'uau', 'brinde', 'nah']);
  assert.equal(x.reactionOf('fogo').label, 'Fogo');
  assert.equal(x.reactionOf('outra'), null);
  assert.equal(x.nextReaction(null, 'kkk'), 'kkk');
  assert.equal(x.nextReaction('kkk', 'kkk'), null);
  assert.equal(x.nextReaction('kkk', 'amor'), 'amor');
  // Nada de copos de álcool na barra (os menores também usam o Mixar).
  assert.ok(x.MIXAR_REACTIONS.every((r) => !/🍺|🍻|🍷|🥂|🥃|🍹/.test(r.emoji)));
  assert.equal(x.reactionA11y(x.reactionOf('kkk'), true, true, 'Ana'), 'Kkk (tu e Ana). Toca para tirar');
  assert.equal(x.reactionA11y(x.reactionOf('uau'), false, true, 'Ana'), 'Uau (Ana)');
  assert.equal(x.reactionA11y(x.reactionOf('nah'), false, false, 'Ana'), 'Nah');
});

test('o match: inteiro entre 0 e 100, com texto curto e uma frase', () => {
  assert.equal(x.matchPercent(72.6), 73);
  assert.equal(x.matchPercent(140), 100);
  assert.equal(x.matchPercent(-3), 0);
  assert.equal(x.matchPercent(NaN), 0);
  assert.equal(x.matchPercent(undefined), 0);
  assert.equal(x.matchLabel(72), '72% de match');
  assert.equal(x.matchLine(85), 'Almas gémeas do feed');
  assert.equal(x.matchLine(5), 'Mundos diferentes: vão descobrir muita coisa');
  assert.equal(x.daysLabel(1), '1 dia');
  assert.equal(x.daysLabel(3), '3 dias');
  assert.equal(x.timesLabel(1), '1 vez');
  assert.equal(x.timesLabel(0), '0 vezes');
});

test('cartão do chat: quem recebe vê «Aceitar» e «Agora não»; quem convidou, «À espera de Ana»', () => {
  const recv = x.mixarCardState({ id: 'm1', status: 'pending', invitedByMe: false, name: 'Dom + Ana' }, 'Dom');
  assert.equal(recv.tone, 'invite');
  assert.equal(recv.title, 'Dom convidou-te para um Mixar');
  assert.deepEqual(recv.actions, ['accept', 'decline']);
  assert.deepEqual(recv.actions.map((a) => x.CARD_ACTION_LABEL[a]), ['Aceitar', 'Agora não']);
  const sent = x.mixarCardState({ id: 'm1', status: 'pending', invitedByMe: true, name: 'Dom + Ana' }, 'Ana');
  assert.equal(sent.tone, 'waiting');
  assert.equal(sent.line, 'À espera de Ana');
  assert.deepEqual(sent.actions, []);
});

test('cartão do chat: ativo abre o Mixar; recusado, terminado ou apagado ficam discretos (sem botões)', () => {
  const on = x.mixarCardState({ id: 'm1', status: 'active', invitedByMe: true, name: 'Dom + Ana' }, 'Ana');
  assert.equal(on.tone, 'active');
  assert.equal(on.title, 'Dom + Ana');
  assert.deepEqual(on.actions, ['open']);
  assert.equal(x.CARD_ACTION_LABEL.open, 'Abrir o Mixar');
  const declinedByMe = x.mixarCardState({ id: 'm1', status: 'declined', invitedByMe: false, name: 'Dom + Ana' }, 'Dom');
  const declinedForMe = x.mixarCardState({ id: 'm1', status: 'declined', invitedByMe: true, name: 'Dom + Ana' }, 'Ana');
  assert.equal(declinedByMe.line, 'Recusaste este Mixar');
  // Quem convidou não lê «recusou»: só que o convite já não está ativo.
  assert.equal(declinedForMe.line, 'Este convite já não está ativo');
  assert.doesNotMatch(declinedForMe.line, /recus/i);
  const ended = x.mixarCardState({ id: 'm1', status: 'ended', invitedByMe: false, name: 'Dom + Ana' }, 'Dom');
  assert.equal(ended.line, 'Este Mixar terminou');
  for (const s of [declinedByMe, declinedForMe, ended]) { assert.equal(s.tone, 'off'); assert.deepEqual(s.actions, []); }
  const gone = x.mixarCardState(null, 'Ana');
  assert.equal(gone.tone, 'gone');
  assert.deepEqual(gone.actions, []);
});

test('lista das conversas: a última mensagem «mixar» lê-se do lado de quem vê', () => {
  assert.equal(x.mixarPreview({ fromMe: true, body: 'Convidou-te para um Mixar' }), 'Convidaste para um Mixar');
  assert.equal(x.mixarPreview({ fromMe: false, body: '' }), 'Convidou-te para um Mixar');
});

test('/seen: o vídeo acaba → um pedido com done; as repetições e a saída já não mandam nada', () => {
  const t = x.createSeenTracker();
  t.enter('p1');
  assert.deepEqual(t.done('p1', 15_200.4), { postId: 'p1', watchedMs: 15200, done: true });
  assert.equal(t.done('p1', 30_000), null); // repetiu: nada
  assert.equal(t.leave('p1', 45_000), null); // saiu: nada (já mandou nesta visita)
});

test('/seen: sem chegar ao fim manda à saída (watchedMs, done false); menos de 1 s é passar à frente', () => {
  const t = x.createSeenTracker();
  t.enter('p1');
  assert.deepEqual(t.leave('p1', 4200), { postId: 'p1', watchedMs: 4200, done: false });
  assert.equal(t.leave('p1', 4200), null); // a mesma saída duas vezes: um só pedido
  t.enter('p2');
  assert.equal(t.leave('p2', 400), null);
  assert.equal(t.leave('p2', 5000), null);
  assert.equal(x.SEEN_MIN_MS, 1000);
});

test('/seen: voltar ao mesmo item é outra visita; sem visita (nunca entrou) não manda nada', () => {
  const t = x.createSeenTracker();
  assert.equal(t.done('p9', 9000), null);
  assert.equal(t.leave('p9', 9000), null);
  t.enter('p1');
  assert.ok(t.leave('p1', 2000));
  t.enter('p1');
  assert.deepEqual(t.done('p1', 8000), { postId: 'p1', watchedMs: 8000, done: true });
});

test('/seen: o tempo vai inteiro e com teto (um vídeo esquecido a repetir não vale horas)', () => {
  const t = x.createSeenTracker();
  t.enter('p1');
  assert.equal(t.leave('p1', 5 * 60 * 60 * 1000).watchedMs, x.SEEN_MAX_MS);
  t.enter('p2');
  assert.equal(t.done('p2', -50).watchedMs, 0);
});

test('/seen: uma sessão inteira a deslizar manda no máximo um pedido por item e por visita', () => {
  const t = x.createSeenTracker();
  const sent = [];
  const visit = (id, events) => { t.enter(id); for (const [k, ms] of events) { const p = k === 'done' ? t.done(id, ms) : t.leave(id, ms); if (p) sent.push(p); } };
  visit('a', [['done', 10_000], ['done', 20_000], ['leave', 25_000]]);
  visit('b', [['leave', 300]]);
  visit('c', [['leave', 3000], ['leave', 3000]]);
  visit('a', [['leave', 2000]]);
  assert.deepEqual(sent.map((p) => `${p.postId}:${p.done}`), ['a:true', 'c:false', 'a:false']);
});

test('Mixa Challenge: ainda não escolhi → escolher (diz se o outro já escolheu)', () => {
  const v = x.challengeView(challenge(), 'Ana');
  assert.equal(v.phase, 'pick');
  assert.match(v.line, /^Escolhe um\./);
  assert.equal(x.challengeView(challenge({ theirPicked: true }), 'Ana').line, 'Ana já escolheu. Agora tu!');
  assert.equal(x.canPick(challenge()), true);
  assert.equal(x.canPick(challenge({ myPick: 'p1' })), false);
  assert.equal(x.canPick(null), false);
});

test('Mixa Challenge: escolhi e o outro ainda não → «À espera de Ana…»', () => {
  const v = x.challengeView(challenge({ myPick: 'p2' }), 'Ana');
  assert.equal(v.phase, 'waiting');
  assert.equal(v.line, 'À espera de Ana…');
  assert.equal(v.match, null);
  // O outro escolheu mas o resultado ainda não veio (theirPick/match null): continua à espera, sem adivinhar.
  assert.equal(x.challengeView(challenge({ myPick: 'p2', theirPicked: true }), 'Ana').phase, 'waiting');
  assert.equal(x.optionBadge(challenge({ myPick: 'p2', theirPicked: true }), 'p2'), 'mine');
});

test('Mixa Challenge: o resultado — match 🎉 ou «Ana escolheu esta», com os selos certos', () => {
  const same = challenge({ myPick: 'p2', theirPicked: true, theirPick: 'p2', match: true });
  assert.deepEqual(x.challengeView(same, 'Ana'), { phase: 'result', line: 'Escolheram o mesmo! 🎉', match: true });
  assert.equal(x.optionBadge(same, 'p2'), 'both');
  assert.equal(x.optionBadge(same, 'p1'), null);
  const diff = challenge({ myPick: 'p1', theirPicked: true, theirPick: 'p3', match: false });
  assert.deepEqual(x.challengeView(diff, 'Ana'), { phase: 'result', line: 'Ana escolheu esta', match: false });
  assert.equal(x.optionBadge(diff, 'p1'), 'mine');
  assert.equal(x.optionBadge(diff, 'p3'), 'theirs');
  assert.equal(x.optionBadge(diff, 'p2'), null);
});

test('Mixa Challenge: as perguntas fixas servem de recurso quando a API manda a pergunta vazia', () => {
  assert.equal(x.challengeQuestion({ kind: 'mais_txilado', question: '' }), 'Qual tem mais vibe?');
  assert.equal(x.challengeQuestion({ kind: 'partilhavas', question: '  ' }), 'Qual mandavas ao grupo?');
  assert.equal(x.challengeQuestion({ kind: 'repetias', question: 'Qual vias outra vez?' }), 'Qual vias outra vez?');
  assert.equal(x.CHALLENGE_QUESTION.mais_engracado, 'Qual é o mais engraçado?');
});

test('páginas do feed: o desafio primeiro, os itens sem repetir e o fim só quando não há mais', () => {
  const pages = x.buildPages(challenge(), [item('a'), item('b'), item('a')], false);
  assert.deepEqual(pages.map((p) => p.key), ['c:c1', 'i:a', 'i:b', 'end']);
  assert.deepEqual(x.buildPages(null, [item('a')], true).map((p) => p.kind), ['item']);
  // Desafio sem opções não aparece; sem itens e sem mais, fica só o fim.
  assert.deepEqual(x.buildPages(challenge({ options: [] }), [], false).map((p) => p.kind), ['end']);
});

test('fim do dia: antes das 05:00 de Maputo a próxima é hoje; depois, amanhã às 05:00', () => {
  // Maputo = UTC+2: 02:30 UTC são 04:30 em Maputo; 03:00 UTC já são 05:00.
  assert.deepEqual(x.nextRefresh(new Date('2026-11-14T02:30:00Z')), { when: 'hoje', at: '05:00' });
  assert.deepEqual(x.nextRefresh(new Date('2026-11-14T03:00:00Z')), { when: 'amanhã', at: '05:00' });
  assert.deepEqual(x.nextRefresh(new Date('2026-11-14T22:30:00Z')), { when: 'hoje', at: '05:00' }); // 00:30 em Maputo
  const e = x.endOfDay(new Date('2026-11-14T15:00:00Z'));
  assert.equal(e.title, 'Volta amanhã para mais');
  assert.match(e.line, /amanhã às 05:00/);
  assert.match(x.endOfDay(new Date('2026-11-14T01:00:00Z')).line, /hoje às 05:00/);
});

test('lista dos Mixar: a linha de cada um e a ordem (ativos, recebidos, enviados; o mais recente primeiro)', () => {
  assert.equal(x.summaryLine(summary({ newToday: 1 }), 'Ana'), '1 novo hoje');
  assert.equal(x.summaryLine(summary({ newToday: 5, challengePending: true }), 'Ana'), '5 novos hoje · Mixa Challenge à tua espera');
  assert.equal(x.summaryLine(summary(), 'Ana'), 'Tudo visto por hoje');
  assert.equal(x.summaryLine(summary({ status: 'pending', invitedByMe: true }), 'Ana'), 'À espera de Ana');
  assert.equal(x.summaryLine(summary({ status: 'pending' }), 'Ana'), 'Convidou-te para um Mixar');
  const g = x.sortSummaries([
    summary({ id: 'old', updatedAt: '2026-11-13T00:00:00Z' }),
    summary({ id: 'sent', status: 'pending', invitedByMe: true }),
    summary({ id: 'new', updatedAt: '2026-11-14T09:00:00Z' }),
    summary({ id: 'recv', status: 'pending' }),
  ]);
  assert.deepEqual(g.active.map((s) => s.id), ['new', 'old']);
  assert.deepEqual(g.received.map((s) => s.id), ['recv']);
  assert.deepEqual(g.sent.map((s) => s.id), ['sent']);
});

test('acesso nas Mensagens: escondido sem Mixar (fica a dica); convites, desafio e novos primeiro', () => {
  const none = x.inboxEntry([]);
  assert.equal(none.show, false);
  assert.match(none.line, /Mixar/);
  assert.equal(x.inboxEntry(null).show, false);
  assert.deepEqual(x.inboxEntry([summary({ status: 'pending' }), summary({ newToday: 3 })]), { show: true, line: '1 convite por responder', hot: true });
  assert.equal(x.inboxEntry([summary({ challengePending: true, newToday: 2 })]).line, 'Mixa Challenge à tua espera');
  assert.equal(x.inboxEntry([summary({ newToday: 2 }), summary({ id: 'm2', newToday: 4 })]).line, '6 novos hoje');
  assert.deepEqual(x.inboxEntry([summary()]), { show: true, line: 'O vosso feed a dois', hot: false });
  assert.deepEqual(x.inboxEntry([summary({ status: 'pending', invitedByMe: true })]), { show: true, line: 'Convite enviado', hot: false });
});

test('erros: 403, 404 e 429 com texto próprio; 409 dá o id do Mixar que já existe', () => {
  assert.match(x.mixarErrorText({ status: 403 }), /Não podes/);
  assert.equal(x.mixarErrorText({ status: 404 }), 'Este Mixar já não existe.');
  assert.match(x.mixarErrorText({ status: 429 }), /limite/);
  assert.equal(x.mixarErrorText({ status: 500 }, 'Outra coisa'), 'Outra coisa');
  assert.equal(x.existingMixarId({ status: 409, extra: { id: 'm7' } }), 'm7');
  assert.equal(x.existingMixarId({ status: 409, extra: {} }), null);
  assert.equal(x.existingMixarId({ status: 403, extra: { id: 'm7' } }), null);
});

test('tempo real: o evento mixar só põe em dia esse Mixar (sem som nem aviso), também o eco', () => {
  assert.deepEqual(se.planChatEvent({ type: 'mixar', id: 'm1', what: 'reaction' }), { notify: false, keys: [['mixar', 'm1', 'feed']] });
  assert.deepEqual(se.planChatEvent({ type: 'mixar', id: 'm1', what: 'pick', self: true }), { notify: false, keys: [['mixar', 'm1', 'challenge'], ['mixar-list']] });
  assert.deepEqual(se.planChatEvent({ type: 'mixar', id: 'm1', what: 'result' }).keys, [['mixar', 'm1', 'challenge'], ['mixar-list']]);
  assert.deepEqual(se.planChatEvent({ type: 'mixar', id: 'm1', what: 'daily' }).keys, [['mixar', 'm1', 'feed'], ['mixar', 'm1', 'challenge'], ['mixar-list']]);
  // Convite e aceite mudam o cartão do chat: a lista e as conversas também.
  for (const what of ['invite', 'accepted']) {
    const k = se.planChatEvent({ type: 'mixar', id: 'm1', what }).keys;
    assert.deepEqual(k, [['mixar', 'm1'], ['mixar-list'], ['mixar-with'], ['chat-list'], ['chat-thread']], what);
  }
  assert.deepEqual(se.planChatEvent({ type: 'mixar', what: 'daily' }).keys, [['mixar-list']]);
  // As chaves batem com as de lib/api.mixar (mixarKeys).
  const keys = read('lib', 'api.mixar.ts');
  assert.match(keys, /feed: \(id: string\) => \['mixar', id, 'feed'\]/);
  assert.match(keys, /challenge: \(id: string\) => \['mixar', id, 'challenge'\]/);
  assert.match(keys, /list: \(\) => \['mixar-list'\]/);
});

test('menu da lista de Mensagens: «Mixar com Ana» só quando pedido, nunca num pedido de mensagem nem num grupo', () => {
  const row = { group: false, unread: 0, username: 'ana', me: 'eu', mixar: true, name: 'Ana Maria' };
  const labels = im.inboxMenuItems(row).map((i) => i.label);
  assert.deepEqual(labels, ['Marcar como por ler', 'Ver perfil', 'Mixar com Ana', 'Mensagens temporárias', 'Limpar conversa', 'Apagar conversa', 'Cancelar']);
  assert.equal(im.inboxMenuItems(row).find((i) => i.id === 'mixar').icon, 'sparkles');
  assert.ok(!im.inboxDeskMenu({ ...row, request: true }).includes('mixar'));
  assert.ok(!im.inboxDeskMenu({ ...row, mixar: false }).includes('mixar'));
  assert.ok(!im.inboxDeskMenu({ group: true, unread: 0, me: 'eu', mixar: true }).includes('mixar'));
  assert.equal(im.actionLabel('mixar', false), 'Mixar');
});

test('as entradas nos ecrãs: cartão no chat, menu da conversa, menu «+», acesso nas Mensagens e o ecrã do Mixar', () => {
  const bubbles = read('components', 'ChatBubbles.tsx');
  assert.match(bubbles, /m\.kind === 'mixar'[\s\S]*<MixarCard mixar=\{m\.mixar\}/);
  const thread = read('app', 'messages', '[username].tsx');
  assert.match(thread, /label: `Mixar com \$\{firstName\}`/);
  assert.match(thread, /onMixar=\{/);
  const attach = read('components', 'ChatAttachSheet.tsx');
  assert.match(attach, /item\('sparkles', 'Mixar', onMixar/);
  const inbox = read('app', '(tabs)', 'messages.tsx');
  assert.match(inbox, /<MixarEntry \/>/);
  assert.match(inbox, /m\.kind === 'mixar'\) return mixarPreview\(m\)/);
  const screen = read('app', 'mixar', '[id].tsx');
  // Reutiliza o leitor e o cartão das tchekas (não reinventa o leitor).
  assert.match(screen, /import \{ Reel \} from '\.\.\/\(tabs\)\/reels'/);
  assert.match(screen, /useDeskReels\(.*\{ arrowsStep: true \}\)/);
  assert.match(screen, /createSeenTracker\(\)/);
  const shell = read('components', 'DesktopShell.tsx');
  assert.match(shell, /path\.startsWith\('\/mixar\/'\)/);
});

test('o leitor das tchekas diz quanto se viu (onWatch) sem mudar nada para quem não o usa', () => {
  const reels = read('app', '(tabs)', 'reels.tsx');
  assert.match(reels, /onWatch\?: \(w: \{ ms: number; done: boolean \}\) => void/);
  assert.match(reels, /playToEnd[\s\S]{0,120}onWatchRef\.current\?\.\(\{ ms: watch\.current\.ms, done: true \}\)/);
  assert.match(reels, /\{infoExtra\}/);
  const hooks = read('lib', 'desktopHooks.ts');
  // ←/→ continuam a recuar e avançar 5 s nas tchekas; só com `arrowsStep` (o Mixar) passam de item.
  assert.match(hooks, /prev: \(\) => setSeekSignal\(\(s\) => \(\{ n: s\.n \+ 1, by: -5 \}\)\),/);
  assert.match(hooks, /\.\.\.\(step \? \{ prev: \(\) => fns\.current\.goTo\(fns\.current\.active\(\) - 1\)/);
});

// Visto no emulador (Chrome, web): o feed do Mixar ficava preto. A coluna do feed está dentro de uma linha
// (flexDirection 'row', por causa das setas do computador); com alignSelf 'center' ficava com 0 de altura, o onLayout
// dava 0 e a lista nunca aparecia. Na linha, a coluna tem de esticar (alignSelf 'stretch').
test('ecrã do Mixar: a coluna do feed estica na altura dentro da linha (não fica com 0 de altura)', () => {
  const src = read('app', 'mixar', '[id].tsx');
  assert.match(src, /style=\{\{ flex: 1, flexDirection: 'row', justifyContent: 'center' \}\}/, 'a coluna está dentro de uma linha');
  const column = src.match(/^\s*column: \{[^}]*\}/m)?.[0] ?? '';
  assert.ok(column, 'há o estilo column');
  assert.doesNotMatch(column, /alignSelf: 'center'/);
  assert.match(column, /alignSelf: 'stretch'/);
});
