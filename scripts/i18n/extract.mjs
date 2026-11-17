#!/usr/bin/env node
/**
 * Extração das frases (docs/idiomas.md): lê o código de cada parte de scripts/i18n/config.json com o TypeScript e recolhe a
 * frase de cada `t('…')` (e `tr`, `tk` no site). Só contam as funções importadas de um módulo cujo caminho tem «i18n»,
 * por isso uma variável local chamada `t` não entra.
 *
 *   node scripts/i18n/extract.mjs           mostra quantas frases há em cada parte e os problemas
 *   node scripts/i18n/extract.mjs --json    imprime tudo em JSON
 *
 * Problemas: a frase (ou o `other` do plural) não é um texto literal, ou a mesma frase com dois plurais diferentes.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

export function loadConfig() {
  return JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'i18n', 'config.json'), 'utf8'));
}

const SKIP_DIRS = new Set(['node_modules', 'locales', 'dist', 'build', '.expo', 'android', 'ios', '__tests__']);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) yield* walk(full);
    } else if (/\.(tsx?|jsx?|mjs)$/.test(name) && !/\.(test|spec|d)\.[a-z]+$/.test(name)) {
      yield full;
    }
  }
}

/** O texto de um nó se for literal (aspas ou crase sem `${}`); senão undefined. */
function literal(node) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return literal(node.expression);
  return undefined;
}

/** Os textos possíveis de um nó: um literal, ou `cond ? 'a' : 'b'` com literais nos dois ramos; senão undefined. */
function literals(node) {
  if (node && ts.isParenthesizedExpression(node)) return literals(node.expression);
  if (node && ts.isConditionalExpression(node)) {
    const a = literals(node.whenTrue);
    const b = literals(node.whenFalse);
    return a && b ? [...a, ...b] : undefined;
  }
  const one = literal(node);
  return one === undefined ? undefined : [one];
}

/** Os nomes locais de `functions` e `markers` importados de um módulo «i18n» neste ficheiro. */
function importedNames(sf, wanted) {
  const direct = new Map(); // nome local → nome original
  const namespaces = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!/i18n/.test(st.moduleSpecifier.text)) continue;
    const clause = st.importClause;
    if (!clause || !clause.namedBindings) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) namespaces.add(clause.namedBindings.name.text);
    else
      for (const el of clause.namedBindings.elements) {
        const original = (el.propertyName ?? el.name).text;
        if (wanted.has(original)) direct.set(el.name.text, original);
      }
  }
  return { direct, namespaces };
}

/**
 * Recolhe as frases de um ficheiro. Devolve { phrases: [{ key, other, plural, line }], problems: [{ line, msg }] }.
 */
export function extractFile(file, { functions = ['t'], markers = [] } = {}) {
  const code = readFileSync(file, 'utf8');
  const wanted = new Set([...functions, ...markers]);
  // Atalho: sem «i18n» no ficheiro não há nada importado de lá.
  if (!code.includes('i18n')) return { phrases: [], problems: [] };
  const kind = file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
  const { direct, namespaces } = importedNames(sf, wanted);
  if (!direct.size && !namespaces.size) return { phrases: [], problems: [] };
  const phrases = [];
  const problems = [];
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      let fn;
      const callee = node.expression;
      if (ts.isIdentifier(callee) && direct.has(callee.text)) fn = direct.get(callee.text);
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) && wanted.has(callee.name.text)) fn = callee.name.text;
      if (fn) {
        const [first, second] = node.arguments;
        const keys = literals(first);
        if (keys === undefined) {
          problems.push({ line: lineOf(node), msg: `${fn}() com um argumento que não é texto literal: ${first ? first.getText(sf).slice(0, 80) : '(nada)'}` });
        } else {
          let other;
          let plural = false;
          if (second && ts.isObjectLiteralExpression(second)) {
            for (const p of second.properties) {
              const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined;
              if (name === 'count') plural = true;
              if (name === 'other') {
                if (ts.isPropertyAssignment(p) && literal(p.initializer) !== undefined) other = literal(p.initializer);
                else problems.push({ line: lineOf(p), msg: `${fn}() com um «other» que não é texto literal` });
              }
            }
          } else if (second) {
            // Objeto vindo de fora: não se sabe se é plural. Só conta como problema se for preciso o plural (não dá para saber).
          }
          if (other !== undefined) plural = true;
          for (const key of keys) phrases.push({ key, other, plural, line: lineOf(node) });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { phrases, problems };
}

/**
 * Extrai todas as partes. Devolve:
 *   parts: { [parte]: { keys: Map<frase, { other, plural }>, problems: [{ file, line, msg }], strict } }
 *   all:   Map<frase, { other, plural, parts: Set }>
 *   conflicts: [{ key, a, b }]
 */
export function extractAll(config = loadConfig()) {
  const parts = {};
  const all = new Map();
  const conflicts = [];
  for (const [name, part] of Object.entries(config.parts)) {
    const keys = new Map();
    const problems = [];
    for (const dir of part.src) {
      for (const file of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        const r = extractFile(file, part);
        for (const p of r.problems) problems.push({ file: rel, ...p });
        for (const p of r.phrases) {
          const prev = keys.get(p.key);
          if (prev && prev.other !== undefined && p.other !== undefined && prev.other !== p.other) conflicts.push({ key: p.key, a: prev.other, b: p.other, file: rel, line: p.line });
          keys.set(p.key, { other: p.other ?? prev?.other, plural: p.plural || !!prev?.plural });
          const g = all.get(p.key) ?? { other: undefined, plural: false, parts: new Set() };
          if (g.other !== undefined && p.other !== undefined && g.other !== p.other && !conflicts.some((c) => c.key === p.key)) conflicts.push({ key: p.key, a: g.other, b: p.other, file: rel, line: p.line });
          g.other = g.other ?? p.other;
          g.plural = g.plural || p.plural;
          g.parts.add(name);
          all.set(p.key, g);
        }
      }
    }
    parts[name] = { keys, problems, strict: !!part.strict, out: part.out };
  }
  return { parts, all, conflicts };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const r = extractAll();
  if (process.argv.includes('--json')) {
    const out = {};
    for (const [k, v] of r.all) out[k] = { ...(v.other !== undefined ? { other: v.other } : {}), ...(v.plural ? { plural: true } : {}), parts: [...v.parts] };
    console.log(JSON.stringify(out, null, 2));
  } else {
    for (const [name, p] of Object.entries(r.parts)) {
      console.log(`${name}: ${p.keys.size} frases${p.problems.length ? `, ${p.problems.length} problemas${p.strict ? '' : ' (avisos)'}` : ''}`);
      for (const pr of p.problems.slice(0, 50)) console.log(`  ${pr.file}:${pr.line}  ${pr.msg}`);
      if (p.problems.length > 50) console.log(`  … e mais ${p.problems.length - 50}`);
    }
    for (const c of r.conflicts) console.log(`plural diferente para «${c.key}»: «${c.a}» e «${c.b}» (${c.file}:${c.line})`);
    console.log(`total: ${r.all.size} frases`);
    const bad = Object.values(r.parts).some((p) => p.strict && p.problems.length) || r.conflicts.length;
    process.exitCode = bad ? 1 : 0;
  }
}
