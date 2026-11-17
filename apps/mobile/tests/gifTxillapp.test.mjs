// O GIF «Txillapp» (o logótipo animado, servido pelo nosso site em /marca/): a parte pura em src/lib/gifs.ts, onde aparece
// (painel dos GIFs, reações dos comentários e das notas, bolhas, autocolante dos mimos) e que os ficheiros existem e batem
// com a lista fechada da API (apps/api/src/gifs/gif.ts).
// Correr em apps/mobile:  node --test tests/gifTxillapp.test.mjs
import { test } from 'node:test';
import './fixtures/alias.mjs'; // o alias @/ (os módulos usam t() de @/lib/i18n)
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const g = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'gifs.ts')).href);
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const base = 'https://txillapp.com/marca/';

test('o item «Txillapp»: id logo, fonte txillapp, classificação g, WebP do nosso site; a mensagem leva a fonte', () => {
  assert.deepEqual(g.TXILLAPP_GIF, { id: 'logo', title: 'Txillapp', w: 480, h: 211, preview: `${base}txillapp-animado.webp`, full: `${base}txillapp-animado.webp`, still: `${base}txillapp-final.png`, rating: 'g', source: 'txillapp' });
  assert.deepEqual(g.gifMessage(g.TXILLAPP_GIF), { kind: 'gif', gif: { id: 'logo', w: 480, h: 211, url: `${base}txillapp-animado.webp`, still: `${base}txillapp-final.png`, title: 'Txillapp', rating: 'g', source: 'txillapp' } });
  // Os do GIPHY continuam sem fonte.
  const giphy = { id: 'AbC123', title: 'x', w: 200, h: 150, preview: 'https://media2.giphy.com/media/AbC123/100w.webp', full: 'https://media2.giphy.com/media/AbC123/200w.webp' };
  assert.equal('source' in g.gifPayload(giphy), false);
});

test('validGif: o do Txillapp só com id e ficheiro da lista', () => {
  const ok = g.gifPayload(g.TXILLAPP_GIF);
  assert.equal(g.validGif(ok), true);
  assert.equal(g.validGif({ ...ok, id: 'logo-branco', url: `${base}txillapp-animado-branco.gif` }), true);
  assert.equal(g.validGif({ ...ok, id: 'outro' }), false);
  assert.equal(g.validGif({ ...ok, url: `${base}txillapp-animado-branco.webp` }), false, 'o ficheiro de outro id');
  assert.equal(g.validGif({ ...ok, url: 'https://evil.example/marca/txillapp-animado.webp' }), false);
  assert.equal(g.validGif({ ...ok, source: 'outra' }), false);
  assert.equal(g.validGif({ ...ok, source: undefined }), false, 'sem a fonte, tem de ser do GIPHY');
});

test('gifShown: a variante pelo fundo (pretas no claro, brancas no escuro); a com fundo branco e os do GIPHY ficam iguais', () => {
  const logo = g.gifPayload(g.TXILLAPP_GIF);
  assert.deepEqual(g.gifShown(logo), { url: `${base}txillapp-animado.webp`, still: `${base}txillapp-final.png` });
  assert.deepEqual(g.gifShown(logo, true), { url: `${base}txillapp-animado-branco.webp`, still: `${base}txillapp-final-branco.png` });
  assert.deepEqual(g.gifShown({ ...logo, id: 'logo-branco', url: `${base}txillapp-animado-branco.gif` }), { url: `${base}txillapp-animado.gif`, still: `${base}txillapp-final.png` });
  const fundo = { ...logo, id: 'logo-fundo', url: `${base}txillapp-animado-fundo.webp`, still: `${base}txillapp-final-fundo.png` };
  assert.deepEqual(g.gifShown(fundo, true), { url: fundo.url, still: fundo.still });
  const giphy = { id: 'AbC123', w: 200, h: 150, url: 'https://media2.giphy.com/media/AbC123/200w.webp' };
  assert.deepEqual(g.gifShown(giphy, true), { url: giphy.url });
  assert.equal(g.gifFit(logo), 'contain', 'o logótipo nunca se corta');
  assert.equal(g.gifFit(giphy), 'cover');
});

test('os ficheiros existem (site e app) e a lista é a mesma da API', () => {
  const api = read('../api/src/gifs/gif.ts');
  for (const [id, file, still] of [['logo', 'txillapp-animado', 'txillapp-final.png'], ['logo-branco', 'txillapp-animado-branco', 'txillapp-final-branco.png'], ['logo-fundo', 'txillapp-animado-fundo', 'txillapp-final-fundo.png']]) {
    assert.match(api, new RegExp(`'?${id}'?: \\{ file: '${file}', still: '${still}' \\}`));
    assert.match(read('src/lib/gifs.ts'), new RegExp(`'?${id}'?: \\{ file: '${file}', still: '${still}' \\}`));
    for (const dir of ['public/marca', '../web/public/marca']) {
      for (const f of [`${file}.webp`, `${file}.gif`, still]) assert.ok(existsSync(path.join(ROOT, dir, f)), `${dir}/${f}`);
    }
  }
  assert.match(api, /export const TXILLAPP_GIF_ORIGIN = 'https:\/\/txillapp\.com';/);
  assert.match(api, /export const TXILLAPP_GIF_SIZE = \{ w: 480, h: 211 \}/);
});

test('onde aparece: no topo do painel dos GIFs, nas reações dos comentários e das notas, nas bolhas e nos comentários', () => {
  const panel = read('src/components/GifPanel.tsx');
  assert.match(panel, /\{!q \|\| \/txill\/i\.test\(q\) \? <BrandGifTile [^>]*onPick=\{onPick\}/);
  assert.ok(panel.indexOf('<BrandGifTile') < panel.indexOf('{list.isLoading ?'), 'antes dos resultados do GIPHY');
  assert.match(panel, /contentFit=\{gifFit\(gif\)\}/);
  const comments = read('src/components/CommentsSheet.tsx');
  assert.match(comments, /<TxillappReaction [^>]*onPress=\{\(\) => \{ setStickers\(null\); void submit\(undefined, gifPayload\(TXILLAPP_GIF\)\); \}\} \/>/);
  const notes = read('src/components/Notes.tsx');
  assert.match(notes, /<TxillappReaction [^>]*onPress=\{\(\) => void send\('', gifPayload\(TXILLAPP_GIF\)\)\} \/>/);
  assert.match(read('src/lib/api.notes.ts'), /post\(gif \? \{ text, gif \} : \{ text \}\)/);
  const bubbles = read('src/components/ChatBubbles.tsx');
  assert.match(bubbles, /backgroundColor: brand \? 'transparent' : colors\.zinc200/);
  assert.match(bubbles, /contentFit=\{gifFit\(gif\)\}/);
  // Nenhum emoji nos textos novos.
  for (const s of [panel, comments, notes]) for (const label of s.matchAll(/label="([^"]*Txillapp[^"]*)"/g)) assert.doesNotMatch(label[1], /\p{Extended_Pictographic}/u);
});

test('autocolante «Txillapp» nos mimos: o primeiro dos animados; por cima da foto ou do vídeo é o GIF animado branco', () => {
  const mimo = JSON.parse(read('src/assets/mimo-stickers.json'));
  assert.equal(mimo.items[0].id, 'm-txillapp');
  assert.equal(mimo.items[0].text, 'Txillapp');
  // O mesmo enquadramento do GIF (a caixa do logótipo com 14 de margem): trocar um pelo outro não mexe no tamanho.
  assert.match(mimo.items[0].svg, /viewBox="183\.964 252\.11 227\.348 99\.798"/);
  assert.match(read('../api/src/stories/sticker-art.ts'), /"m-txillapp":\{"vb":"183\.964 252\.11 227\.348 99\.798"/);
  const st = read('src/components/Stickers.tsx');
  assert.match(st, /if \(onMedia && animate && def\.id === BRAND_STICKER_ID\) return <BrandSticker /);
  assert.match(st, /<StickerArt def=\{def\} size=\{w\} animate=\{animate\} onMedia \/>/);
  assert.match(st, /<StickerArt def=\{def\} size=\{w\} onMedia \/>/);
  assert.deepEqual(g.TXILLAPP_GIF_WHITE, { url: `${base}txillapp-animado-branco.webp`, still: `${base}txillapp-final-branco.png` });
});
