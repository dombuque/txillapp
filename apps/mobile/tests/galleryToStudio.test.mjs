// Numa tcheka, o que se escolhe na galeria vai logo para o estúdio, já montado (no site como no telemóvel), em vez de
// voltar à câmara (src/app/(tabs)/new.tsx: addFiles na web, pickMany no telemóvel).
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nw = readFileSync(path.join(ROOT, 'src', 'app', '(tabs)', 'new.tsx'), 'utf8').replace(/\r\n/g, '\n');
const fn = (name) => {
  const i = nw.indexOf(`function ${name}(`);
  assert.ok(i >= 0, name);
  return nw.slice(i, nw.indexOf('\n  }\n', i));
};

test('site: a galeria numa tcheka abre o estúdio com os ficheiros (até 30)', () => {
  const add = fn('addFiles');
  assert.match(add, /const toStudio = kindSel === 'tcheka' && step !== 'write';/);
  assert.match(add, /const cap = toStudio \? MAX_CLIPS : MAX_PHOTOS;/);
  assert.match(add, /if \(next\.length && toStudio\) \{\s*setAssets\(\(cur\) => \[\.\.\.cur, \.\.\.next\]\.slice\(0, MAX_CLIPS\)\);[\s\S]*?setStudio\(true\);\s*return;/);
});

test('telemóvel: a galeria numa tcheka também abre o estúdio', () => {
  assert.match(fn('pickMany'), /if \(kindSel === 'tcheka' && step !== 'write'\) \{[\s\S]*?setStudio\(true\);/);
});
