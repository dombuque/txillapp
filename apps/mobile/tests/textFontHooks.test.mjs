// As letras ao publicar no desenho (contrato `fontes`): com o React Compiler, ler `textFontStyle` direto num componente
// fica guardado com o primeiro valor (a fonte ainda não tinha chegado) e o texto ficava na letra do sistema para sempre —
// no visor dos mimos os textos com Praia/Elegante saíam em negrito do sistema, ao contrário da cópia guardada. Os
// componentes usam `useTextFontStyle` (src/lib/useTextFonts.ts), que guarda o «já carregou» em estado do React.
// Correr em apps/mobile:  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
});
const rel = (p) => path.relative(SRC, p).split(path.sep).join('/');
const ALLOWED = new Set(['lib/textFonts.ts', 'lib/textFonts.web.ts', 'lib/useTextFonts.ts']);

test('nenhum componente lê textFontStyle direto no desenho (usa useTextFontStyle)', () => {
  const offenders = files(SRC)
    .filter((p) => !ALLOWED.has(rel(p)))
    .filter((p) => /\btextFontStyle\s*\(/.test(readFileSync(p, 'utf8')))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test('useTextFontStyle guarda o «já carregou» em estado e só depois lê o estilo', () => {
  const src = readFileSync(path.join(SRC, 'lib', 'useTextFonts.ts'), 'utf8').replace(/\r\n/g, '\n');
  const body = src.slice(src.indexOf('export function useTextFontStyle'));
  assert.match(body, /useState\(/);
  assert.match(body, /loadTextFont\(id\)\.then/);
  assert.match(body, /return id && ready \? textFontStyle\(id\) : null;/);
});
