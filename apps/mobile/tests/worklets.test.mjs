// Worklets (Reanimated / react-native-worklets) como correm no telemóvel. Na thread da UI o worklet é o texto `code` que o
// plugin do Babel gera, e as variáveis de fora só chegam pelo `this.__closure`, desempacotado DENTRO do corpo. Um valor por
// omissão que use uma constante de fora (`behind = DECK_BEHIND`) corre antes disso e falha com «ReferenceError: Property
// 'DECK_BEHIND' doesn't exist»: no APK fecha a app sem aviso (aconteceu ao abrir a pilha do Zás, na 1.47.1). Na web e nos
// outros testes nada disto se vê, porque aí a função corre no JS normal.
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const { parseExpression } = require('@babel/parser');

/** Compila um ficheiro como o Metro (só o TypeScript/JSX e o plugin dos worklets). */
function compile(file) {
  return babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    babelrc: false,
    configFile: false,
    presets: [[require.resolve('@babel/preset-typescript'), { isTSX: file.endsWith('.tsx'), allExtensions: true }]],
    plugins: [require.resolve('@babel/plugin-syntax-jsx'), require.resolve('react-native-worklets/plugin')],
  }).code;
}

/** Os textos `code` de todos os worklets do ficheiro compilado. */
function workletCodes(out) {
  const codes = [];
  const re = /\bcode: ("(?:[^"\\]|\\.)*")/g;
  for (let m; (m = re.exec(out)); ) codes.push(JSON.parse(m[1]));
  return codes;
}

/** Identificadores usados numa expressão (sem os nomes de propriedades). */
function idsIn(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) idsIn(n, out);
    return out;
  }
  if (node.type === 'Identifier') out.add(node.name);
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'start' || k === 'end') continue;
    if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && k === 'property' && !node.computed) continue;
    if (node.type === 'ObjectProperty' && k === 'key' && !node.computed) continue;
    idsIn(v, out);
  }
  return out;
}

/** O que cada worklet usa de fora nos valores por omissão dos parâmetros (o que no telemóvel não existe ainda). */
function defaultsFromClosure(code) {
  const fn = parseExpression(code);
  const first = fn.body.body[0];
  const closure = new Set();
  const isClosure = first?.type === 'VariableDeclaration' && /this\.__closure/.test(code.slice(first.start, first.end));
  if (isClosure) for (const d of first.declarations) idsIn(d.id, closure);
  const bad = [];
  for (const p of fn.params) if (p.type === 'AssignmentPattern') for (const id of idsIn(p.right)) if (closure.has(id)) bad.push(`${fn.id?.name ?? '?'}: ${id}`);
  return bad;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && /['"]worklet['"]/.test(fs.readFileSync(p, 'utf8'))) out.push(p);
  }
  return out;
}

test('nenhum worklet da app usa variáveis de fora nos valores por omissão (no telemóvel ainda não existem)', () => {
  const files = walk(path.join(ROOT, 'src'));
  assert.ok(files.some((f) => f.endsWith('zasDeck.ts')), 'o zasDeck.ts tem worklets');
  const bad = [];
  let n = 0;
  for (const f of files) {
    for (const code of workletCodes(compile(f))) {
      n++;
      for (const b of defaultsFromClosure(code)) bad.push(`${path.relative(ROOT, f)} → ${b}`);
    }
  }
  assert.ok(n > 5, `encontrou ${n} worklets`);
  assert.deepEqual(bad, []);
});

/** Recria um worklet como a thread da UI: só o texto `code`, com o `__closure` (os worklets lá dentro também recriados). */
function onUi(fn) {
  const data = fn.__initData;
  assert.ok(data?.code, 'é um worklet');
  const body = (0, eval)(data.code);
  const closure = (fn.__closure ?? []).map((x) => (typeof x === 'function' && x.__initData ? onUi(x) : x));
  return (...args) => body.apply({ __closure: closure }, args);
}

test('zasDeck: a pose da pilha corre como worklet (thread da UI) e dá o mesmo que no JS', async () => {
  const src = path.join(ROOT, 'src', 'components', 'zas', 'zasDeck.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'txill-worklets-'));
  const out = path.join(tmp, 'zasDeck.mjs');
  // O plugin usa `global.Error` (como no Hermes).
  globalThis.global ??= globalThis;
  fs.writeFileSync(out, compile(src));
  try {
    const W = await import(pathToFileURL(out).href);
    const pose = onUi(W.deckPose);
    // Exatamente como o ZasDeckCard chama: 3 argumentos (o 4.º fica por omissão).
    for (const d of [-1, -0.4, 0, 0.5, 1, 1.7, 2, 2.6, 3, 5]) assert.deepEqual(pose(d, 400, 520), W.deckPose(d, 400, 520), `d = ${d}`);
    assert.deepEqual(pose(2.5, 400, 520, 1), W.deckPose(2.5, 400, 520, 1));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
