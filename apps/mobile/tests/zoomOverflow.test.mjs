// PWA do iPhone: o editor do mimo (e o visor) aparecia encolhido a ~87%, preso ao canto de cima, com uma faixa cinzenta à
// direita e em baixo. Causa: o fundo desfocado da foto está ampliado (scale 1,3 / 1,25) e passava para fora do ecrã; o
// Safari encolhe a página toda para caber o que sai pela direita e por baixo. Correção: recortar (overflow hidden).
// Com a página encolhida, a «zona visível» também fica diferente da janela, e a folha lia isso como teclado aberto.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'sheetViewport.ts')).href);

function* files(dir) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.tsx$/.test(n)) yield p;
  }
}

test('fundos ampliados a ecrã inteiro (absoluteFill + scale > 1) ficam dentro de um contentor com overflow hidden', () => {
  const bad = [];
  for (const f of files(path.join(ROOT, 'src'))) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/StyleSheet\.absoluteFill/.test(line) || !/transform: \[\{ scale: 1\.\d+ \}\]/.test(line) || /pressed/.test(line)) return;
      // O contentor é a View absoluteFill mais próxima acima (até 10 linhas).
      const above = lines.slice(Math.max(0, i - 10), i).reverse().find((l) => /<View style=\{.*StyleSheet\.absoluteFill/.test(l));
      if (!above || !/overflow: 'hidden'/.test(above)) bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('o editor do mimo recorta a cena e o próprio ecrã', () => {
  const s = readFileSync(path.join(ROOT, 'src', 'app', 'stories', 'new.tsx'), 'utf8');
  assert.match(s, /<View style=\{\[StyleSheet\.absoluteFill, \{ overflow: 'hidden' \}\]\}>\s*\{asset\.video \?/);
  assert.match(s, /<KeyboardAvoidingView style=\{\{ flex: 1, backgroundColor: '#000', overflow: 'hidden' \}\}/);
});

test('sheetViewport: página encolhida ou ampliada não é teclado aberto', () => {
  // A página encolhida a 87% (como no bug): a janela fica com 449 x 972 e a zona visível 449 x 844 em CSS, escala 0,87.
  assert.equal(m.sheetViewport({ top: 0, height: 844, width: 449, scale: 0.869 }, 972, 449), null);
  // Ampliada com dois dedos: zona visível mais estreita do que a janela.
  assert.equal(m.sheetViewport({ top: 100, height: 400, width: 200, scale: 1 }, 844, 390), null);
  // Teclado a sério: mesma largura, escala 1, altura bem mais baixa.
  assert.deepEqual(m.sheetViewport({ top: 0, height: 420, width: 390, scale: 1 }, 844, 390), { top: 0, height: 420 });
  // Sem largura nem escala (chamadas antigas): continua a funcionar como antes.
  assert.deepEqual(m.sheetViewport({ top: 0, height: 420 }, 844), { top: 0, height: 420 });
});

test('a folha e o visor dos mimos passam a largura da janela à deteção do teclado', () => {
  assert.match(readFileSync(path.join(ROOT, 'src', 'components', 'Sheet.tsx'), 'utf8'), /sheetViewport\(vv, window\.innerHeight, window\.innerWidth\)/);
  assert.match(readFileSync(path.join(ROOT, 'src', 'app', 'stories', '[username].tsx'), 'utf8'), /!!sheetViewport\(vv, window\.innerHeight, window\.innerWidth\)/);
  assert.match(readFileSync(path.join(ROOT, 'src', 'components', 'zas', 'useVisibleViewport.ts'), 'utf8'), /width: v\.width, scale: v\.scale/);
});
