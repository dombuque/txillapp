// Testes dos GIFs do GIPHY na app (src/lib/gifs.ts): validar o url, montar a mensagem, a grelha em colunas pela
// proporção, o tamanho da bolha, juntar páginas sem repetir e o que o leitor de ecrã diz. E: o painel tem a atribuição
// "Powered by GIPHY" e só aparece quando o servidor diz que os GIFs estão ligados.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const g = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'gifs.ts')).href);
const read = (f) => readFileSync(path.join(ROOT, 'src', f), 'utf8').replace(/\r\n/g, '\n');

const item = (id, w = 200, h = 150, title = 'Brinde') => ({ id, title, w, h, preview: `https://media2.giphy.com/media/${id}/100w.webp`, full: `https://media2.giphy.com/media/v1.Y2lk/${id}/200w.webp`, still: `https://media2.giphy.com/media/v1.Y2lk/${id}/200w_s.gif` });

test('isGiphyUrl: só https de media*.giphy.com, com o id no caminho, .gif ou .webp', () => {
  assert.equal(g.isGiphyUrl('https://media.giphy.com/media/AbC123/giphy.gif', 'AbC123'), true);
  assert.equal(g.isGiphyUrl('https://media3.giphy.com/media/v1.Y2lk/AbC123/200w.webp', 'AbC123'), true);
  assert.equal(g.isGiphyUrl('http://media.giphy.com/media/AbC123/giphy.gif', 'AbC123'), false);
  assert.equal(g.isGiphyUrl('https://media.giphy.com.evil.com/media/AbC123/giphy.gif', 'AbC123'), false);
  assert.equal(g.isGiphyUrl('https://evil.com/media/AbC123/giphy.gif'), false);
  assert.equal(g.isGiphyUrl('https://media.giphy.com/media/Outro1/giphy.gif', 'AbC123'), false);
  assert.equal(g.isGiphyUrl('https://media.giphy.com/media/AbC123/giphy.mp4', 'AbC123'), false);
  assert.equal(g.isGiphyUrl(null), false);
});

test('validGif: só mostra GIFs bem formados', () => {
  assert.equal(g.validGif({ id: 'AbC123', w: 200, h: 150, url: 'https://media.giphy.com/media/AbC123/200w.webp' }), true);
  assert.equal(g.validGif({ id: 'AbC123', w: 0, h: 150, url: 'https://media.giphy.com/media/AbC123/200w.webp' }), false);
  assert.equal(g.validGif({ id: 'AbC123', w: 200, h: 150, url: 'https://x.com/media/AbC123/200w.webp' }), false);
  assert.equal(g.validGif(null), false);
});

test('gifMessage: tocar num GIF envia kind gif com o full (WebP), as medidas, a parada e o título', () => {
  assert.deepEqual(g.gifMessage(item('AbC123')), {
    kind: 'gif',
    gif: { id: 'AbC123', w: 200, h: 150, url: 'https://media2.giphy.com/media/v1.Y2lk/AbC123/200w.webp', still: 'https://media2.giphy.com/media/v1.Y2lk/AbC123/200w_s.gif', title: 'Brinde' },
  });
  const { still: _s, ...noStill } = item('XyZ789', 200, 200, '  ');
  assert.deepEqual(g.gifPayload(noStill), { id: 'XyZ789', w: 200, h: 200, url: 'https://media2.giphy.com/media/v1.Y2lk/XyZ789/200w.webp' });
});

test('columnsFor: 2 colunas no telemóvel, 3 e 4 em ecrãs mais largos', () => {
  assert.equal(g.columnsFor(0), 2);
  assert.equal(g.columnsFor(360), 2);
  assert.equal(g.columnsFor(480), 3);
  assert.equal(g.columnsFor(800), 4);
});

test('gifColumns: cada GIF vai para a coluna mais baixa, com a altura pela proporção (limitada)', () => {
  const cols = g.gifColumns([item('a1', 200, 200), item('b2', 200, 100), item('c3', 200, 100), item('d4', 100, 1000), item('e5', 1000, 10)], 2, 100, 4);
  assert.equal(cols.length, 2);
  assert.deepEqual(cols[0].items.map((x) => [x.item.id, x.height]), [['a1', 100], ['d4', 250]]);
  assert.deepEqual(cols[1].items.map((x) => [x.item.id, x.height]), [['b2', 50], ['c3', 50], ['e5', 40]]);
  assert.equal(cols[0].height, 100 + 4 + 250 + 4);
  // Nenhum fica de fora, a ordem mantém-se dentro de cada coluna.
  assert.equal(cols.flatMap((c) => c.items).length, 5);
  assert.equal(g.gifColumns([], 3, 100).length, 3);
});

test('gifSize: a bolha tem a proporção do GIF, dentro do máximo', () => {
  assert.deepEqual(g.gifSize(200, 150), { width: 240, height: 180 });
  assert.deepEqual(g.gifSize(200, 400), { width: 140, height: 280 });
  assert.deepEqual(g.gifSize(100, 1000), { width: 120, height: 280 }); // muito estreito: largura mínima, corta em altura
  assert.deepEqual(g.gifSize(480, 270, 240, 280), { width: 240, height: 135 });
  assert.deepEqual(g.gifSize(0, 0), { width: 240, height: 180 });
});

test('mergeGifs: a página seguinte junta-se sem repetir', () => {
  const a = [item('a1'), item('b2')];
  assert.deepEqual(g.mergeGifs(a, [item('b2'), item('c3'), item('c3')]).map((x) => x.id), ['a1', 'b2', 'c3']);
});

test('gifLabel e gifQuery', () => {
  assert.equal(g.gifLabel('Gato a dançar'), 'GIF: Gato a dançar');
  assert.equal(g.gifLabel(''), 'GIF');
  assert.equal(g.gifLabel(undefined), 'GIF');
  assert.equal(g.gifQuery('  bom   dia  '), 'bom dia');
  assert.equal(g.gifQuery('x'.repeat(80)).length, 50);
});

test('o painel: "Powered by GIPHY", só com os GIFs ligados, toques ≥ 44 e GIFs com o título no leitor de ecrã', () => {
  const panel = read('components/GifPanel.tsx');
  assert.match(panel, /Powered by GIPHY/);
  assert.match(panel, /accessibilityLabel=\{`Enviar \$\{gifLabel\(item\.title\)\}`\}/);
  assert.match(panel, /height: Math\.max\(h, 44\)/);
  assert.match(panel, /autoplay=\{!reduce\}/);
  const stickers = read('components/StickerPanel.tsx');
  assert.match(stickers, /const withGif = !!onGif && gifs\.enabled;/);
  // Os compositores do chat e dos grupos e os comentários passam o onGif.
  for (const f of ['components/ChatComposer.tsx', 'components/GroupComposer.tsx']) assert.match(read(f), /onGif=\{\(g\) => \{ setPanel\(null\); void dispatch\(gifMessage\(g\)\); \}\}/);
  assert.match(read('components/CommentsSheet.tsx'), /\{gifs\.enabled && \(/);
});
