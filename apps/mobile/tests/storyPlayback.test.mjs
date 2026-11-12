// Testes do visor dos mimos (src/lib/storyPlayback.ts e src/app/stories/[username].tsx).
// - Com a app em segundo plano a barra continuava a correr e, ao voltar, já tinha passado o mimo (ou a pessoa).
// - Sem rede dizia "Este mimo já não está disponível"; agora deixa tentar outra vez.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const s = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'storyPlayback.ts')).href);
const base = { held: false, typing: false, panelOpen: false, away: false, background: false };

test('corre só sem nada a pará-lo', () => {
  assert.equal(s.storyPaused(base), false);
  for (const k of Object.keys(base)) assert.equal(s.storyPaused({ ...base, [k]: true }), true, k);
});

test('o visor pára quando a app sai do ecrã e tem Tentar outra vez sem rede', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'app', 'stories', '[username].tsx'), 'utf8');
  assert.match(src, /AppState\.addEventListener\('change', \(s\) => setBackground\(s !== 'active'\)\)/);
  assert.match(src, /const paused = storyPaused\(\{ held, typing, panelOpen: panel !== null, away, background \}\);/);
  assert.match(src, /const offline = q\.isError && !isGone\(q\.error\);/);
  assert.match(src, /Tentar outra vez/);
});
