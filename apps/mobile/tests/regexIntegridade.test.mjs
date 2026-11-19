// Expressões com as barras invertidas perdidas (\s\S → sS, \d → d) partem sem erro nenhum: a resposta a uma nota apareceu
// como texto em bruto (1.59.3). Este teste procura esses restos em src e confirma a resposta à nota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? (n === 'locales' ? [] : files(p)) : /\.(ts|tsx)$/.test(n) ? [p] : []; });

test('nenhuma expressão com [sS] (era [\s\S] sem as barras)', () => {
  const bad = files(SRC).filter((f) => /\[sS\]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});

test('a resposta a uma nota é reconhecida, com e sem texto', () => {
  const src = readFileSync(path.join(SRC, 'components', 'ChatBubbles.tsx'), 'utf8');
  const m = /const noteReply = m\.kind === 'text' \? (\/.*\/)\.exec\(m\.body\)/.exec(src);
  assert.ok(m, 'expressão da resposta à nota');
  const re = eval(m[1]);
  assert.deepEqual([...re.exec('Em resposta à tua nota “GIF”: 😂')].slice(1), ['GIF', '😂']);
  assert.deepEqual([...re.exec('Em resposta à tua nota “GIF”')].slice(1), ['GIF', undefined]);
  assert.deepEqual([...re.exec('Em resposta à tua nota “Bora\njantar”: sim\nclaro')].slice(1), ['Bora\njantar', 'sim\nclaro']);
});
