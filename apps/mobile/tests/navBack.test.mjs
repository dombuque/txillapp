// «Voltar» com saída (src/lib/nav.ts): quem entra direto por uma ligação (/u/x, /p/id, /v/slug…) e carrega em «Voltar»
// tem de ir para algum lado. Um router.back() sozinho, sem ecrã anterior, não fazia nada.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nav = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'nav.ts')).href);

function router(canGoBack) {
  const log = [];
  return { log, canGoBack: () => canGoBack, back: () => log.push('back'), replace: (h) => log.push(`replace ${h}`) };
}

test('goBack: com ecrã anterior volta; aberto a frio vai para o sítio de reserva', () => {
  const a = router(true);
  nav.goBack(a, '/messages');
  assert.deepEqual(a.log, ['back']);
  const b = router(false);
  nav.goBack(b, '/locais');
  assert.deepEqual(b.log, ['replace /locais']);
  const c = router(false);
  nav.goBack(c);
  assert.deepEqual(c.log, ['replace /']);
});

function* files(dir) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.tsx?$/.test(n)) yield p;
  }
}

test('nenhum router.back() sem saída: ou vem com canGoBack(), ou passa por goBack()', () => {
  const bad = [];
  for (const f of files(path.join(ROOT, 'src'))) {
    readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const code = /^\s*(\*|\/\*|\{\/\*)/.test(line) ? '' : line.replace(/\/\/.*$/, '');
      if (/router\.back\(\)/.test(code) && !/canGoBack\(\)/.test(code) && !f.endsWith(path.join('lib', 'nav.ts'))) bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('os ecrãs que tinham um «Voltar» sem saída usam goBack com um sítio que faz sentido', () => {
  const src = (p) => readFileSync(path.join(ROOT, 'src', p), 'utf8');
  assert.match(src('components/ProfileView.tsx'), /onPress=\{\(\) => goBack\(router\)\}/);
  assert.match(src('app/u/[username]/connections.tsx'), /onPress=\{\(\) => goBack\(router\)\}/);
  assert.match(src('app/register.tsx'), /if \(i === 0\) goBack\(router, '\/login'\);/);
  assert.match(src('app/stories/new.tsx'), /else if \(!asset\) goBack\(router\);/);
  assert.match(src('app/v/[slug]/gerir.tsx'), /goBack\(router, '\/locais'\)/);
});
