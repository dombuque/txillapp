// Testes de quando toca uma tcheka (src/lib/reelPlayback.ts). Ao mudar de separador ou abrir o perfil do autor por cima,
// a tcheka parava E voltava ao início (perdia o sítio e a pausa). Agora só pára e, ao voltar, continua.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'reelPlayback.ts')).href);
const base = { active: true, onScreen: true, appVisible: true, userPaused: false, ended: false, sharing: false };

test('toca só em cena, com o ecrã à frente e a app à vista', () => {
  assert.equal(r.reelShouldPlay(base), true);
  for (const k of ['active', 'onScreen', 'appVisible']) assert.equal(r.reelShouldPlay({ ...base, [k]: false }), false, k);
  for (const k of ['userPaused', 'ended', 'sharing']) assert.equal(r.reelShouldPlay({ ...base, [k]: true }), false, k);
});

test('volta ao início só quando sai de cena, não quando o ecrã fica por trás', () => {
  assert.equal(r.reelResets({ active: false, onScreen: true }), true);
  assert.equal(r.reelResets({ active: true, onScreen: false }), false, 'outro separador: só pára');
  assert.equal(r.reelResets({ active: true, onScreen: true }), false);
});

test('os ecrãs passam o foco à parte (onScreen), em vez de o meter no active', () => {
  for (const f of [['app', '(tabs)', 'reels.tsx'], ['app', 'r', '[id].tsx']]) {
    const src = readFileSync(path.join(ROOT, 'src', ...f), 'utf8');
    assert.doesNotMatch(src, /active=\{focused && index === active\}/, f.join('/'));
    assert.match(src, /active=\{index === active\} onScreen=\{focused\}/, f.join('/'));
  }
  const reels = readFileSync(path.join(ROOT, 'src', 'app', '(tabs)', 'reels.tsx'), 'utf8');
  assert.match(reels, /reelShouldPlay\(\{ active, onScreen,/);
  assert.match(reels, /if \(!reelResets\(\{ active, onScreen \}\)\) return;/);
  assert.match(reels, /Tentar outra vez/, 'erro com tentar outra vez');
});
