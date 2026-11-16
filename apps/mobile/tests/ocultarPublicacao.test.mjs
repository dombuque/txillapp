// Testes do «Ocultar publicação» / «Voltar a mostrar» (0169): quem pode ocultar, o que diz o menu e o aviso, os erros (o
// Bombar), tirar a publicação das listas em memória (src/lib/hidePost.ts), o separador «Ocultas» do perfil
// (src/lib/profileTabs.ts) e o aviso com «Desfazer» (src/lib/toast.ts). Também confirma no código que o menu, o cartão e o
// perfil usam estas peças.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const h = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'hidePost.ts')).href);
const tabs = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'profileTabs.ts')).href);
const toast = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'toast.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

const post = (id, extra = {}) => ({ id, body: '', kind: 'post', author: { id: 'eu' }, media: [], ...extra });

test('canHide: só o autor (nem sem sessão, nem de outra pessoa)', () => {
  assert.equal(h.canHide(post('a'), 'eu'), true);
  assert.equal(h.canHide(post('a'), 'outro'), false);
  assert.equal(h.canHide(post('a'), null), false);
  assert.equal(h.canHide(null, 'eu'), false);
  // Um post de um local, visto por quem não o publicou: a API manda o autor sem id.
  assert.equal(h.canHide(post('a', { author: { id: '' } }), 'eu'), false);
});

test('hideMenuRow: «Ocultar publicação» ou «Voltar a mostrar»; no repost, «Ocultar o repost»', () => {
  assert.equal(h.hideMenuRow(post('a')).title, 'Ocultar publicação');
  assert.equal(h.hideMenuRow(post('a', { hidden: true })).title, 'Voltar a mostrar');
  assert.equal(h.hideMenuRow(post('a'), true).title, 'Ocultar o repost');
  assert.equal(h.hideMenuRow(post('a', { hidden: true }), true).title, 'Voltar a mostrar');
  for (const r of [h.hideMenuRow(post('a')), h.hideMenuRow(post('a', { hidden: true })), h.hideMenuRow(post('a'), true)]) {
    assert.ok(r.text.length > 10);
  }
});

test('hideToastText: o aviso curto de cada caso', () => {
  assert.equal(h.hideToastText(true), 'Publicação ocultada. Só tu a vês.');
  assert.equal(h.hideToastText(false), 'A publicação voltou a aparecer.');
  assert.equal(h.hideToastText(true, true), 'Repost ocultado. Só tu o vês.');
  assert.equal(h.hideToastText(false, true), 'O repost voltou a aparecer.');
});

test('hideErrorText: o Bombar (409) diz porquê; 404, 429 e a falta de rede têm o seu texto', () => {
  assert.equal(h.hideErrorText(409, null), h.HIDE_BOOSTED);
  assert.equal(h.hideErrorText(409, 'Outra razão do servidor.'), 'Outra razão do servidor.');
  assert.equal(h.HIDE_BOOSTED, 'Esta publicação está a bombar. Podes ocultá-la quando o Bombar acabar.');
  assert.match(h.hideErrorText(404), /já não existe/);
  assert.match(h.hideErrorText(429), /Espera/);
  assert.match(h.hideErrorText(null), /ligação/);
  assert.match(h.hideErrorText(500), /ligação/);
});

test('dropPost: tira a publicação e os reposts dela das páginas e das listas; o resto fica igual', () => {
  const pages = { pages: [{ items: [post('a'), post('b'), post('r', { kind: 'repost', repostOf: post('b') })], nextCursor: 'x' }, { items: [post('c')], nextCursor: null }], pageParams: [undefined, 'x'] };
  const out = h.dropPost(pages, 'b');
  assert.deepEqual(out.pages[0].items.map((p) => p.id), ['a']);
  assert.equal(out.pages[0].nextCursor, 'x');
  assert.equal(out.pages[1], pages.pages[1]); // a página sem ela fica a mesma
  assert.deepEqual(out.pageParams, pages.pageParams);
  // Sem a publicação: devolve o mesmo objeto (não dispara novas renderizações).
  assert.equal(h.dropPost(pages, 'zzz'), pages);
  // Listas soltas: { items }, { posts } (a pesquisa) e arrays.
  assert.deepEqual(h.dropPost({ items: [post('a'), post('b')] }, 'a').items.map((p) => p.id), ['b']);
  assert.deepEqual(h.dropPost({ query: 'x', posts: [post('a'), post('b')], people: [] }, 'b').posts.map((p) => p.id), ['a']);
  assert.deepEqual(h.dropPost([post('a'), post('b')], 'a').map((p) => p.id), ['b']);
  // A página da publicação (uma publicação sozinha) não se apaga: lá aparece com o aviso «Oculta».
  const single = post('a');
  assert.equal(h.dropPost(single, 'a'), single);
  assert.equal(h.dropPost(undefined, 'a'), undefined);
});

test('HIDE_LIST_KEYS: as listas de publicações (e não a página da publicação, que fica com o aviso)', () => {
  for (const k of ['feed', 'profile-posts', 'reels', 'explore', 'saved', 'tag', 'place', 'search', 'venue-page-posts', 'remixes']) assert.ok(h.HIDE_LIST_KEYS.includes(k), k);
  assert.ok(!h.HIDE_LIST_KEYS.includes('post'));
  assert.ok(!h.HIDE_LIST_KEYS.includes('profile'));
});

test('separador «Ocultas»: só no meu perfil e só quando tenho ocultas; vem depois de «Guardados»', () => {
  assert.deepEqual(tabs.visibleProfileTabs(true), ['all', 'reels', 'reposts', 'gifts', 'saved']);
  assert.deepEqual(tabs.visibleProfileTabs(true, true), ['all', 'reels', 'reposts', 'gifts', 'saved', 'hidden']);
  assert.deepEqual(tabs.visibleProfileTabs(false, true), ['all', 'reels', 'reposts', 'gifts']);
  const mine = tabs.visibleProfileTabs(true, true);
  assert.equal(tabs.nextProfileTab(mine, 'saved', 1), 'hidden');
  assert.equal(tabs.nextProfileTab(mine, 'hidden', -1), 'saved');
  assert.equal(tabs.nextProfileTab(mine, 'hidden', 1), null);
  assert.equal(tabs.nextProfileTab(tabs.visibleProfileTabs(true), 'saved', 1), null);
});

test('toast: «Desfazer» fecha o aviso e corre a ação (uma vez)', () => {
  let undone = 0;
  toast.showToast('Publicação ocultada. Só tu a vês.', { label: 'Desfazer', onPress: () => { undone++; } });
  toast.pressToast({ id: 1, text: 'x', action: { label: 'Desfazer', onPress: () => { undone++; } }, ms: 6000 });
  assert.equal(undone, 1);
  toast.showToast('sem botão');
  toast.closeToast();
  assert.equal(undone, 1);
});

test('textos: português de Moçambique, sem travessões nem emojis', () => {
  const all = [h.HIDE_BOOSTED, h.HIDDEN_BANNER, h.hideToastText(true), h.hideToastText(false), h.hideToastText(true, true), h.hideMenuRow(post('a')).text, h.hideMenuRow(post('a', { hidden: true })).text, h.hideMenuRow(post('a'), true).text];
  for (const s of all) {
    assert.ok(!/[—–]/.test(s), s);
    assert.ok(!/\p{Extended_Pictographic}/u.test(s), s);
  }
});

test('o menu, o cartão, o perfil e a raiz usam estas peças', () => {
  const sheets = read('components', 'PostSheets.tsx');
  assert.match(sheets, /hideMenuRow\(post\)/);
  assert.match(sheets, /setPostHidden\(qc, target, !target\.hidden, repost\)/);
  assert.match(sheets, /myRepost/);
  const card = read('components', 'PostCard.tsx');
  assert.match(card, /post\.hidden && mine/);
  assert.match(card, /HIDDEN_BANNER/);
  assert.match(card, /myRepost=\{post\.author\.id === me \? post : null\}/);
  const profile = read('components', 'ProfileView.tsx');
  assert.match(profile, /api\.hiddenPosts\(pageParam\)/);
  assert.match(profile, /visibleProfileTabs\(isMine, hasHidden\)/);
  assert.match(profile, /Voltar a mostrar/);
  assert.match(read('app', '_layout.tsx'), /<ToastHost \/>/);
  const apiSrc = read('lib', 'api.ts');
  assert.match(apiSrc, /\/posts\/\$\{id\}\/hide/);
  assert.match(apiSrc, /\/posts\/\$\{id\}\/unhide/);
  assert.match(apiSrc, /\/me\/posts\/hidden/);
  // Pelo link, para os outros, é como uma apagada.
  assert.match(read('app', 'p', '[id].tsx'), /Esta publicação não está disponível/);
});
