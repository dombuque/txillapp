// Testes do «Paga-me uma» (src/lib/gelada.ts): os textos para adultos, para menores (refresco) e para quem vê uma bebida
// escondida, os estados dos pedidos e do livro, o título do post e a ordem dos amigos.
// Correr em apps/mobile:  node --test tests/gelada.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const g = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'gelada.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

const beer = { slug: 'beb-2m', name: '2M', category: 'cerveja', alcoholic: true };
const soda = { slug: 'beb-coca-cola', name: 'Coca-Cola', category: 'refrigerante', alcoholic: false };
const masked = { slug: 'beb-agua', name: 'Uma bebida', category: 'refrigerante', alcoholic: false, masked: true };
const ana = { username: 'ana', displayName: 'Ana' };
const rui = { username: 'rui', displayName: 'Rui' };
const gone = { username: '', displayName: 'Conta eliminada' };
const ALCOHOL = /🍺|🍻|🍷|🥃|🍹|🥂|cerveja|gelada|2M/;

test('adulto: «uma 2M 🍺»; vinho, destilado, cocktail e espumante com o seu copo', () => {
  assert.equal(g.drinkPhrase(beer), 'uma 2M');
  assert.equal(g.drinkEmoji(beer), '🍺');
  assert.equal(g.drinkEmoji({ ...beer, category: 'vinho', slug: 'beb-vinho-tinto' }), '🍷');
  assert.equal(g.drinkEmoji({ ...beer, category: 'vinho', slug: 'beb-espumante' }), '🥂');
  assert.equal(g.drinkEmoji({ ...beer, category: 'destilado' }), '🥃');
  assert.equal(g.drinkEmoji({ ...beer, category: 'cocktail' }), '🍹');
});

test('refresco (menores) e bebida escondida: nunca álcool no texto', () => {
  assert.equal(g.drinkPhrase(soda), 'um refresco');
  assert.equal(g.drinkEmoji(soda), '🥤');
  assert.equal(g.drinkPhrase(masked), 'uma bebida');
  assert.equal(g.drinkEmoji(masked), '🥤');
  assert.equal(g.drinkLabel(masked), 'Uma bebida');
  assert.equal(g.drinkLabel(soda), 'Coca-Cola');
  for (const d of [soda, masked]) {
    assert.doesNotMatch(g.cardTitle({ mine: false, requester: ana, recipient: rui, drink: d }), ALCOHOL);
    assert.doesNotMatch(g.postTitle([rui], d), ALCOHOL);
    assert.doesNotMatch(g.debtLine({ iOwe: true, owedToMe: false, debtor: rui, creditor: ana, drink: d }), ALCOHOL);
    assert.doesNotMatch(g.momentText({ iOwe: true, debtor: rui, creditor: ana, drink: d }), ALCOHOL);
  }
  assert.doesNotMatch(g.statusLine('accepted', '@rui', false, true), ALCOHOL);
  assert.doesNotMatch(g.debtState({ status: 'paid', claimed: false, iOwe: true }), ALCOHOL);
});

test('o cartão do chat: quem recebe e quem pediu; conta eliminada', () => {
  assert.equal(g.cardTitle({ mine: false, requester: ana, recipient: rui, drink: beer }), '@ana pede-te uma 2M 🍺');
  assert.equal(g.cardTitle({ mine: true, requester: ana, recipient: rui, drink: beer }), 'Pediste a @rui uma 2M 🍺');
  assert.equal(g.cardTitle({ mine: false, requester: gone, recipient: rui, drink: soda }), 'Conta eliminada pede-te um refresco 🥤');
  assert.equal(g.handleOf(null), 'Conta eliminada');
});

test('o post: «@ana, @rui, paga-me uma 2M 🍺»; sem ninguém, só o pedido', () => {
  assert.equal(g.postTitle([ana, rui], beer), '@ana, @rui, paga-me uma 2M 🍺');
  assert.equal(g.postTitle([ana, null, gone], soda), '@ana, paga-me um refresco 🥤');
  assert.equal(g.postTitle([], beer), 'Paga-me uma 2M 🍺');
});

test('statusLine: o estado visto por todos e por quem recebeu', () => {
  assert.equal(g.statusLine('accepted', '@rui'), '@rui pagou 🍻');
  assert.equal(g.statusLine('accepted', '@rui', false, true), '@rui pagou 🥤');
  assert.equal(g.statusLine('accepted', '@rui', true), 'Disseste «Bora!» 🍻');
  assert.equal(g.statusLine('owed', '@rui'), '@rui ficou a dever');
  assert.equal(g.statusLine('owed', '@rui', true), 'Ficaste a dever');
  assert.equal(g.statusLine('declined', '@rui'), 'Hoje não');
  assert.equal(g.statusLine('untagged', '@rui'), '@rui saiu do pedido');
  assert.equal(g.statusLine('pending', '@rui'), 'À espera de @rui');
  assert.equal(g.statusLine('pending', '@rui', true), 'À tua espera');
  assert.deepEqual(g.ANSWERS.map((a) => a.label), ['Bora!', 'Hoje não', 'Fica a dever']);
});

test('o livro: resumo, linhas e estados (com a confirmação dos dois)', () => {
  assert.equal(g.bookSummary(2, 3), 'Deves 2 · Devem-te 3');
  assert.equal(g.bookSummary(1, 0, false), 'Deve 1 · Devem-lhe 0');
  assert.equal(g.bookSummary(0, 0), 'Tudo em dia 🙌');
  assert.equal(g.debtLine({ iOwe: true, owedToMe: false, debtor: rui, creditor: ana, drink: beer }), 'Deves uma 2M a @ana');
  assert.equal(g.debtLine({ iOwe: false, owedToMe: true, debtor: rui, creditor: ana, drink: soda }), '@rui deve-te um refresco');
  assert.equal(g.debtLine({ iOwe: false, owedToMe: false, debtor: rui, creditor: ana, drink: beer }), '@rui deve uma 2M a @ana');
  assert.equal(g.debtState({ status: 'open', claimed: false, iOwe: true }), 'Por pagar');
  assert.equal(g.debtState({ status: 'open', claimed: true, iOwe: true }), 'À espera que confirme');
  assert.equal(g.debtState({ status: 'open', claimed: true, iOwe: false }), 'Diz que já pagou');
  assert.equal(g.debtState({ status: 'forgiven', claimed: false, iOwe: false }), 'Perdoada');
  assert.equal(g.momentText({ iOwe: true, debtor: rui, creditor: ana, drink: beer }), 'Paguei a 2M que devia a @ana 🍺 Dívida saldada!');
  assert.equal(g.momentText({ iOwe: false, debtor: rui, creditor: ana, drink: soda }), '@rui pagou o refresco que me devia 🥤 Saúde!');
});

test('pickable: mútuos primeiro; no post só os mútuos', () => {
  const list = [{ username: 'a', mutual: false }, { username: 'b', mutual: true }, { username: 'c', mutual: false }, { username: 'd', mutual: true }];
  assert.deepEqual(g.pickable(list, 'chat').map((p) => p.username), ['b', 'd', 'a', 'c']);
  assert.deepEqual(g.pickable(list, 'post').map((p) => p.username), ['b', 'd']);
  assert.equal(list[0].username, 'a', 'não mexe na lista original');
});

test('ligações: o ecrã do livro existe e a folha do pedido tem a assinatura combinada', () => {
  assert.match(read('app', 'geladas.tsx'), /export default function GeladasScreen/);
  assert.match(read('app', 'geladas.tsx'), /pedir === '1'/);
  assert.match(read('components', 'gelada', 'AskSheet.tsx'), /export function AskSheet\(\{ to, itemId, lockTo = false, defaultChannel = 'chat', onClose \}/);
  assert.match(read('components', 'GeleiraShelf.tsx'), /GeladaSection/);
  assert.match(read('components', 'ProfileView.tsx'), /Pede uma gelada/);
});

test('avisos da gelada na lista: sem álcool no texto quando é refresco, e para onde levam', () => {
  assert.equal(g.geladaNoticeText('gelada_tag', { soft: false }), 'pede-te uma gelada numa publicação 🍻');
  assert.equal(g.geladaNoticeText('gelada_tag', { soft: true }), 'pede-te um refresco numa publicação 🥤');
  for (const answer of ['accept', 'decline', 'owe']) {
    const t = g.geladaNoticeText('gelada_answer', { soft: true, answer });
    assert.doesNotMatch(t, /🍻|🍺|gelada/);
  }
  assert.equal(g.geladaNoticeText('gelada_answer', { answer: 'owe' }), 'ficou a dever-te uma');
  assert.equal(g.geladaNoticeText('gelada_paid', { step: 'claimed' }), 'diz que já te pagou. Confirmas?');
  assert.equal(g.geladaNoticeTarget('gelada_tag', { postId: 'abc' }), '/p/abc');
  assert.equal(g.geladaNoticeTarget('gelada_paid', {}), '/geladas');
});
