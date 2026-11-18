// Comentários dos mimos com GIFs e autocolantes (0181), como nos comentários das publicações: o painel de autocolantes/GIF,
// a reação «Txillapp» e, na lista, o autocolante, o GIF (ou «GIF escondido» a menores).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/StoryParts.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');

test('mimo: o campo de comentar tem autocolantes, GIF e a reação Txillapp, e envia o GIF', () => {
  assert.match(src, /<StickerPanel key=\{stickers\} start=\{stickers\} onPick=\{\(id\) => void send\(`\[sticker:\$\{id\}\]`\)\} onGif=\{\(g\) => void send\('', gifPayload\(g\)\)\} \/>/);
  assert.match(src, /<TxillappReaction onDark width=\{40\}/);
  assert.match(src, /accessibilityLabel="GIF"/);
  assert.match(api, /commentStory: \(id: string, body: string, gif\?: import\('\.\/gifs'\)\.ChatGif\)/);
});

test('mimo: a lista mostra o autocolante, o GIF ou «GIF escondido»', () => {
  assert.match(src, /stickerOf\(c\.body\) \? <View style=\{\{ marginTop: 2 \}\}><Sticker id=\{stickerOf\(c\.body\)!\} size=\{88\} \/><\/View>/);
  assert.match(src, /c\.gifHidden \? <View style=\{\{ marginTop: 6 \}\}><GifHiddenCard \/><\/View> : validGif\(c\.gif\) \? <View style=\{\{ marginTop: 6 \}\}><GifView gif=\{c\.gif\} onDark \/><\/View>/);
});
