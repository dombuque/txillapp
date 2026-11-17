// Testes do Mixar, social e guardados (src/lib/mixarSocial.ts, docs/mixar-contrato.md «Social e guardados»): a conversa do
// item, o «ver juntos», a reação do outro a subir, os Guardados, o «Mais 5», o tempo real (streamEvents → mixarLiveKeys)
// e as ligações nos ecrãs (carril, cabeçalho, fim do dia, rota dos Guardados, denúncia).
// Correr em apps/mobile:  node --test tests/mixarSocial.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const x = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'mixarSocial.ts')).href);
const se = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'streamEvents.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const item = (id, theirs = null) => ({ post: { id }, theirs });

test('o botão da conversa: o número (até 99+) e o texto para o leitor de ecrã', () => {
  assert.equal(x.commentBadge(0), null);
  assert.equal(x.commentBadge(undefined), null);
  assert.equal(x.commentBadge(3), '3');
  assert.equal(x.commentBadge(120), '99+');
  assert.equal(x.commentA11y(0, 'Zeca'), 'Conversa com Zeca sobre este vídeo');
  assert.equal(x.commentA11y(1, 'Zeca'), 'Conversa com Zeca sobre este vídeo, 1 comentário');
  assert.equal(x.commentA11y(4, 'Zeca'), 'Conversa com Zeca sobre este vídeo, 4 comentários');
});

test('escrever: até 500 caracteres (o contador aparece perto do fim), vazio não envia', () => {
  assert.equal(x.COMMENT_MAX, 500);
  assert.deepEqual(x.commentLeft('olá'), { left: 497, show: false, over: false });
  assert.equal(x.commentLeft('a'.repeat(400)).show, true);
  assert.deepEqual(x.commentLeft('a'.repeat(501)), { left: -1, show: true, over: true });
  assert.equal(x.canSend('   '), false);
  assert.equal(x.canSend('ok'), true);
  assert.equal(x.canSend('ok', true), false);
  assert.equal(x.canSend('a'.repeat(501)), false);
});

test('erros ao comentar: o texto do filtro (422), o item que saiu, o limite', () => {
  assert.equal(x.commentErrorText({ status: 422, message: 'Este texto não é permitido' }), 'Este texto não é permitido');
  assert.equal(x.commentErrorText({ status: 422 }), 'Este comentário não cumpre as regras do Txillapp.');
  assert.equal(x.commentErrorText({ status: 404 }), 'Este vídeo já não está no Mixar.');
  assert.match(x.commentErrorText({ status: 429 }), /depressa/);
  assert.equal(x.commentErrorText(new Error('x')), 'Não consegui enviar. Tenta outra vez.');
  assert.match(x.commentsEmpty('Zeca').line, /Só vocês os dois veem isto/);
});

test('ver juntos: «Zeca está a ver contigo», no mesmo vídeo, noutro (dá para ir) ou a abrir', () => {
  assert.equal(x.togetherLine('Zeca'), 'Zeca está a ver contigo');
  assert.equal(x.hereLine('Zeca'), 'Zeca está aqui');
  assert.deepEqual(x.togetherSub({ here: false, postId: null }, 'a', ['a']), { text: '', jump: null });
  assert.deepEqual(x.togetherSub({ here: true, postId: 'a' }, 'a', ['a', 'b']), { text: 'No mesmo vídeo que tu', jump: null });
  assert.deepEqual(x.togetherSub({ here: true, postId: 'b' }, 'a', ['a', 'b']), { text: 'Noutro vídeo. Toca para ir', jump: 'b' });
  assert.deepEqual(x.togetherSub({ here: true, postId: 'z' }, 'a', ['a', 'b']), { text: 'Acabou de abrir o Mixar', jump: null });
  assert.deepEqual(x.togetherSub({ here: true, postId: null }, 'a', ['a']), { text: 'Acabou de abrir o Mixar', jump: null });
  // A presença repete-se antes de expirar no servidor (45 s).
  assert.ok(x.PRESENCE_EVERY_MS < 45_000);
});

test('presença: os eventos do outro mudam o estado; o meu eco e os outros eventos não', () => {
  const none = { here: false, postId: null };
  assert.deepEqual(x.applyPresence(none, { what: 'presence', here: true, postId: 'a' }), { here: true, postId: 'a' });
  assert.deepEqual(x.applyPresence({ here: true, postId: 'a' }, { what: 'presence', here: false }), none);
  assert.deepEqual(x.applyPresence(none, { what: 'presence', here: true, postId: 'a', self: true }), none);
  assert.deepEqual(x.applyPresence(none, { what: 'comment', postId: 'a' }), none);
});

test('a reação do outro a subir: só o que mudou e nunca na primeira leitura', () => {
  const first = x.theirChanges(null, [item('a', 'fogo'), item('b')]);
  assert.deepEqual(first.changes, []);
  const second = x.theirChanges(first.next, [item('a', 'fogo'), item('b', 'kkk'), item('c', 'amor')]);
  // 'c' é novo (página nova): não anima; 'b' passou a ter reação.
  assert.deepEqual(second.changes, [{ postId: 'b', reaction: 'kkk' }]);
  const third = x.theirChanges(second.next, [item('a', 'uau'), item('b', null), item('c', 'amor')]);
  assert.deepEqual(third.changes, [{ postId: 'a', reaction: 'uau' }]);
  assert.ok(x.BURST_MS >= 800 && x.BURST_MS <= 2000);
});

test('guardados: entram sozinhos quando os dois reagem sem «nah»; quem guardou', () => {
  assert.equal(x.autoSaves('amor', 'fogo'), true);
  assert.equal(x.autoSaves('brinde', 'kkk'), true);
  assert.equal(x.autoSaves('amor', 'nah'), false);
  assert.equal(x.autoSaves('nah', 'nah'), false);
  assert.equal(x.autoSaves('amor', null), false);
  assert.equal(x.savedByText('me', 'Zeca'), 'Guardaste tu');
  assert.equal(x.savedByText('them', 'Zeca'), 'Guardado por Zeca');
  assert.equal(x.savedByText('both', 'Zeca'), 'Os dois reagiram');
  assert.equal(x.saveA11y(true), 'Tirar dos Guardados do Mixar');
  assert.match(x.savedEmpty('Zeca').line, /sem ser com nah/);
});

test('«Mais 5»: quantas vezes ainda dá, o resultado e o 429 com o texto do servidor', () => {
  assert.equal(x.MORE_PER_DAY, 3);
  assert.equal(x.moreLine(null), '');
  assert.equal(x.moreLine(3), 'Podes pedir mais 3 vezes hoje');
  assert.equal(x.moreLine(1), 'Podes pedir mais 1 vez hoje');
  assert.equal(x.moreLine(0), 'Hoje já não dá para pedir mais.');
  assert.equal(x.moreResult(5), '5 vídeos novos na vossa seleção');
  assert.equal(x.moreResult(1), '1 vídeo novo na vossa seleção');
  assert.match(x.moreResult(0), /Volta amanhã/);
  assert.equal(x.moreErrorText({ status: 429, message: 'Já pediram mais 3 vezes hoje. Amanhã às 05:00 há uma seleção nova' }), 'Já pediram mais 3 vezes hoje. Amanhã às 05:00 há uma seleção nova');
  assert.equal(x.moreErrorText({ status: 429, message: 'ThrottlerException: Too Many Requests' }), 'Já pediram mais 3 vezes hoje. Amanhã às 05:00 há uma seleção nova');
  assert.equal(x.moreErrorText({ status: 500 }), 'Não deu agora. Tenta outra vez.');
});

test('os textos visíveis: sem travessões nem emojis', () => {
  const src = read('lib', 'mixarSocial.ts') + read('components', 'mixar', 'MixarSocial.tsx');
  const strings = [...src.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2]);
  for (const s of strings) {
    assert.ok(!/[—–]/.test(s), `travessão em «${s}»`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(s), `emoji em «${s}»`);
  }
});

test('tempo real: mixar.live põe em dia a conversa, os contadores, os Guardados e o feed, sem som nem aviso', () => {
  assert.deepEqual(se.planChatEvent({ type: 'mixar.live', id: 'm1', what: 'comment', postId: 'p1' }), { notify: false, keys: [['mixar', 'm1', 'comments', 'p1'], ['mixar', 'm1', 'social']] });
  assert.deepEqual(se.planChatEvent({ type: 'mixar.live', id: 'm1', what: 'saved', postId: 'p1', saved: true }).keys, [['mixar', 'm1', 'social'], ['mixar', 'm1', 'saved']]);
  assert.deepEqual(se.planChatEvent({ type: 'mixar.live', id: 'm1', what: 'more' }).keys, [['mixar', 'm1', 'feed'], ['mixar', 'm1', 'more']]);
  assert.deepEqual(se.planChatEvent({ type: 'mixar.live', id: 'm1', what: 'presence', here: true, postId: 'p1' }), { notify: false, keys: [] });
  assert.deepEqual(se.planChatEvent({ type: 'mixar.live', id: 'm1', what: 'comment', postId: 'p1', self: true }).notify, false);
  // O realtime passa-os a quem se inscreve (a presença no ecrã do Mixar).
  const rt = read('lib', 'realtime.ts');
  assert.match(rt, /export function onMixarLive/);
  assert.match(rt, /e\.type === 'mixar\.live'\) mixarLiveSubs\.forEach/);
});

test('o ecrã do Mixar: carril com a conversa e o marcador, «está a ver contigo», a reação a subir, «Mais 5» e os Guardados', () => {
  const s = read('app', 'mixar', '[id].tsx');
  assert.match(s, /<MixarRailButtons /);
  assert.match(s, /<MixarCommentsSheet /);
  assert.match(s, /<TogetherBanner /);
  assert.match(s, /<HereChip /);
  assert.match(s, /<ReactionBurst /);
  assert.match(s, /<MoreButton /);
  assert.match(s, /<SavedHeaderButton onPress=\{\(\) => router\.push\(`\/mixar\/guardados\/\$\{id\}`/);
  assert.match(s, /mixarSocialApi\.saved\(id, pageParam\)/);
  const g = read('app', 'mixar', 'guardados', '[id].tsx');
  assert.match(g, /<MixarScreen saved \/>/);
  assert.match(read('app', '_layout.tsx'), /name="mixar\/guardados\/\[id\]"/);
  // A folha leva o selo (NameWithBadge) e denuncia pela fila de sempre.
  const c = read('components', 'mixar', 'MixarSocial.tsx');
  assert.match(c, /<NameWithBadge name=\{c\.author\.displayName\} who=\{c\.author\}/);
  assert.match(c, /<NameWithBadge name=\{partner\.name\} who=\{partner\}/);
  assert.match(c, /<ReportSheet type="mixar_comment"/);
  assert.match(read('components', 'ReportSheet.tsx'), /mixar_comment: 'este comentário'/);
  // O fim do dia tem um sítio para o «Mais 5».
  assert.match(read('components', 'mixar', 'MixarPages.tsx'), /\{children\}/);
});
