// Testes de «Deixar repostar as minhas publicações» (0156) na app: o `canRepost` das publicações esconde «Repostar» e
// «Repostar com comentário» (src/lib/repost.ts, usado no cartão, no visor de fotos, nas Tchekas e na folha de repostar),
// a mensagem da API quando recusa (403), a linha nas Definições → Conteúdo e a pesquisa das Definições.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rp = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'repost.ts')).href);
const idx = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'settingsIndex.ts')).href);
const read = (...f) => readFileSync(path.join(ROOT, 'src', ...f), 'utf8').replace(/\r\n/g, '\n');

test('canRepost falso esconde a opção; sem o campo (servidor antigo, cache) continua a aparecer', () => {
  assert.equal(rp.canRepost({}), true);
  assert.equal(rp.canRepost({ canRepost: true }), true);
  assert.equal(rp.canRepost({ canRepost: false }), false);
  assert.equal(rp.canRepost(null), false);
  // O botão fica quando há um repost meu para desfazer.
  assert.equal(rp.showRepostButton({ canRepost: false }), false);
  assert.equal(rp.showRepostButton({ canRepost: false, reposted: true }), true);
  assert.equal(rp.showRepostButton({ canRepost: true }), true);
  assert.equal(rp.showRepostButton({}), true);
  assert.equal(rp.REPOST_BLOCKED, 'Quem publicou não deixa repostar as suas publicações.');
});

test('os botões de repostar usam showRepostButton (cartão, visor de fotos, Tchekas)', () => {
  const card = read('components', 'PostCard.tsx');
  assert.match(card, /\{showRepostButton\(post\) \? <B icon="repeat"/);
  assert.match(card, /\{showRepostButton\(post\) && <Btn label=\{post\.reposted \? 'Repostado' : 'Repostar'\}/);
  const reels = read('app', '(tabs)', 'reels.tsx');
  assert.match(reels, /\{showRepostButton\(post\) \? \(\n\s+<RailButton/);
});

test('a folha de repostar: sem licença não mostra «Repostar» nem «Repostar com comentário»; o 403 mostra a mensagem da API', () => {
  const sheet = read('components', 'PostSheets.tsx');
  assert.match(sheet, /const allowed = canRepost\(post\);/);
  assert.match(sheet, /\) : allowed \? \(\n\s+<MenuRow icon="repeat" title="Repostar"/);
  assert.match(sheet, /\{allowed \? <MenuRow icon="pencil" title="Repostar com comentário"/);
  assert.match(sheet, /setErr\(\(x as Error\)\.message/);
  assert.match(sheet, /x\.status === 403 && x\.message === REPOST_BLOCKED\) onChange\(\{ canRepost: false \}\)/);
  // O aviso antigo das contas privadas vinha da API; a app não o tem escrito.
  assert.doesNotMatch(sheet, /contas privadas não podem ser repostadas/);
});

test('a definição: ligada, desligada e numa conta privada', () => {
  const on = rp.repostSetting({ allow: true, private: false });
  assert.deepEqual([on.on, on.disabled], [true, false]);
  assert.match(on.description, /tal como estão ou com um comentário/);
  const priv = rp.repostSetting({ allow: true, private: true });
  assert.equal(priv.on, true);
  assert.match(priv.description, /privada: o repost só o vê quem te segue/);
  const off = rp.repostSetting({ allow: false, private: true });
  assert.deepEqual([off.on, off.disabled], [false, false]);
  assert.match(off.description, /só tu podes repostar/);
  assert.equal(rp.repostSetting(null).disabled, true);
});

test('Definições → Conteúdo: a linha com o interruptor, a âncora e o cliente da API', () => {
  const screen = read('app', 'settings', 'conteudo.tsx');
  assert.match(screen, /anchor="allowReposts" icon="repeat" title="Deixar repostar as minhas publicações"/);
  assert.match(screen, /toggle=\{\{ on: rpRow\.on, disabled: rpRow\.disabled, onChange: \(v\) => void setReposts\(v\) \}\}/);
  assert.match(screen, /queryFn: settingsApi\.repostSettings/);
  const api = read('lib', 'api.settings.ts');
  assert.match(api, /raw\('\/posts\/me\/repost-settings'\)/);
  assert.match(api, /raw\('\/posts\/me\/repost-settings', \{ method: 'PUT', body: JSON\.stringify\(\{ allow \}\) \}\)/);
  assert.match(read('lib', 'api.ts'), /\n  canRepost\?: boolean;/);
});

test('a pesquisa das Definições encontra a opção (repostar, citar, retweet, partilhar no perfil…)', () => {
  const e = idx.settingsEntry('allowReposts');
  assert.equal(e.group, 'conteudo');
  assert.equal(e.title, 'Deixar repostar as minhas publicações');
  const finds = (q) => idx.searchSettings(q).some((h) => h.id === 'allowReposts');
  for (const q of ['repostar', 'repost', 'reposts', 'partilhar no perfil', 'citar', 'citacao', 'retweet', 'repostar com comentario']) assert.ok(finds(q), q);
  assert.equal(idx.searchSettings('deixar repostar')[0].id, 'allowReposts');
  assert.equal(idx.searchSettings('citação')[0].id, 'allowReposts');
  assert.equal(idx.searchSettings('retweet')[0].id, 'allowReposts');
  assert.equal(idx.entryPath(e), '/settings/conteudo?o=allowReposts');
  // «Quem vê quem repostou» continua na Privacidade.
  assert.equal(idx.searchSettings('quem repostou')[0].id, 'repostsVisible');
});
