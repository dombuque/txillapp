// No telemóvel (Android / iOS nativo) o «voltar» da web (src/lib/webBack.ts) não pode fazer nada: no React Native há um
// `window` global mas não há `document` nem `history` do browser. installWebBack() tem de devolver null sem mexer em nada,
// webBack() fica null e o useWebBack do Modal não abre camadas fora da web.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(path.join(ROOT, 'src', 'lib', 'webBack.ts')).href;
/** Cada import com uma query nova traz o módulo do zero (o `shared` lá dentro começa a null). */
let n = 0;
const fresh = () => import(`${url}?n=${++n}`);

test('nativo sem window (node): installWebBack devolve null e webBack() fica null', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  const wb = await fresh();
  assert.equal(wb.installWebBack(), null);
  assert.equal(wb.webBack(), null);
});

test('nativo como o React Native (window sem document): não instala nada nem mexe no history', async () => {
  const calls = [];
  const history = {
    state: null,
    pushState: () => calls.push('push'),
    replaceState: () => calls.push('replace'),
    go: () => calls.push('go'),
    back: () => calls.push('back'),
    forward: () => calls.push('forward'),
  };
  const orig = { ...history };
  const listeners = [];
  globalThis.window = { history, location: { href: 'app://local/' }, addEventListener: (...a) => listeners.push(a), setTimeout, clearTimeout };
  try {
    assert.equal(typeof globalThis.document, 'undefined');
    const wb = await fresh();
    assert.equal(wb.installWebBack(), null);
    assert.equal(wb.installWebBack(), null, 'chamar outra vez também não');
    assert.equal(wb.webBack(), null);
    for (const k of Object.keys(orig)) assert.equal(history[k], orig[k], `history.${k} não foi trocado`);
    assert.equal(listeners.length, 0, 'sem ouvinte de popstate');
    assert.deepEqual(calls, []);
  } finally {
    delete globalThis.window;
  }
});

test('nativo com window sem history (outro ambiente RN): também devolve null', async () => {
  globalThis.window = {};
  globalThis.document = {};
  try {
    const wb = await fresh();
    assert.equal(wb.installWebBack(), null);
    assert.equal(wb.webBack(), null);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test('useWebBack só abre camadas na web; fora dela o Modal é o do React Native sem mais nada', () => {
  const modal = readFileSync(path.join(ROOT, 'src', 'components', 'Modal.tsx'), 'utf8');
  assert.match(modal, /if \(Platform\.OS !== 'web' \|\| !on\) return;/);
  // E mesmo na web, sem installWebBack (webBack() null) não rebenta: usa `?.`.
  assert.match(modal, /webBack\(\)\?\.open\(/);
});
