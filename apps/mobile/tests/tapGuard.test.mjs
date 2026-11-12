// Testes dos guardas de toques repetidos (src/lib/tapGuard.ts): dois toques rápidos no cartão abriam a publicação duas
// vezes; puxar para baixo na tcheka (iPhone) disparava vários router.back() e tirava também o ecrã de trás.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const g = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'tapGuard.ts')).href);
const read = (...p) => readFileSync(path.join(ROOT, 'src', ...p), 'utf8');

test('createTapGuard: o segundo toque no mesmo destino logo a seguir não passa', () => {
  let t = 1000;
  const ok = g.createTapGuard(700, () => t);
  assert.equal(ok('/p/abc'), true);
  t += 120;
  assert.equal(ok('/p/abc'), false, 'duplo toque');
  t += 300;
  assert.equal(ok('/p/abc'), false, 'ainda dentro da janela');
  t += 700;
  assert.equal(ok('/p/abc'), true, 'passado o tempo, volta a abrir');
});

test('createTapGuard: destinos diferentes passam sempre', () => {
  let t = 0;
  const ok = g.createTapGuard(700, () => t);
  assert.equal(ok('/p/abc'), true);
  t += 50;
  assert.equal(ok('/u/ana'), true);
  t += 50;
  assert.equal(ok('/p/abc'), true, 'voltar ao primeiro destino depois de outro também passa');
});

test('createOnce: só corre a primeira vez (até reset)', () => {
  const once = g.createOnce();
  let n = 0;
  for (let i = 0; i < 6; i++) once.run(() => { n += 1; });
  assert.equal(n, 1);
  assert.equal(once.done, true);
  once.reset();
  once.run(() => { n += 1; });
  assert.equal(n, 2);
});

test('o cartão da publicação abre os ecrãs pelo guarda (sem router.push direto para a publicação, o autor ou a tcheka)', () => {
  const src = read('components', 'PostCard.tsx');
  assert.match(src, /const openPost = \(o: Post\) => pushOnce\(router,/);
  assert.match(src, /const goAuthor = \(\) => pushOnce\(router,/);
  assert.doesNotMatch(src, /router\.push\(\(isTcheka\(o\)/);
  assert.doesNotMatch(src, /router\.push\(`\/r\/\$\{reelId\}`/);
});

test('a página da tcheka fecha uma vez só', () => {
  const src = read('app', 'r', '[id].tsx');
  assert.match(src, /const closing = useRef\(createOnce\(\)\)\.current;/);
  assert.match(src, /const close = \(\) => \{ closing\.run\(/);
});
