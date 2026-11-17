#!/usr/bin/env node
/**
 * Extração das frases da API (docs/idiomas-api.md). Na API a maior parte do texto não passa por `t()`: são as mensagens
 * dos erros (`new BadRequestException('…')`), os títulos e corpos dos pushes e as mensagens das validações (zod). O
 * filtro dos erros e o push traduzem esse texto à saída, pelo catálogo; por isso a frase tem de estar no catálogo, e é
 * isto que a recolhe. Junta-se às frases de `t()` e `msg()` que o extract.mjs da base recolhe (config.json, parte «api»).
 *
 * O que entra:
 *   - `new XxxException('…')` e `new XxxException({ message: '…', hint: '…' })`;
 *   - em objetos com `url` e `title` ou `body` (o formato de um push e das tabelas de avisos): o `title` e o `body`;
 *   - nas validações zod (ficheiros que importam «zod»): os textos de `.min(1, '…')`, `.refine(fn, '…')`, `{ message: '…' }`
 *     e de `ctx.addIssue({ message: '…' })`;
 *   - `errorMessage: '…'` (o limite de pedidos);
 *   - `t('…')` e `msg('…')` (com o plural de `{ count, other: '…' }`), como o extract.mjs da base, para este script também
 *     servir sozinho.
 * Um texto com `${}` vira uma frase com `{nome}` (o nome vem da expressão: `${user.name}` dá `{name}`), que o servidor
 * reconhece no texto montado. Os textos dentro das expressões (`${x ?? 'o teu local'}`, `${a ? 'b' : 'c'}`) também
 * entram, como frases à parte. `'a' ? 'b' : 'c'` e `x ?? 'y'` entram pelos dois lados.
 *
 *   node scripts/i18n/extract-api.cjs          mostra quantas frases há (e onde)
 *   node scripts/i18n/extract-api.cjs --json   imprime as frases em JSON
 */
const { readFileSync, readdirSync, statSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const ts = require(require.resolve('typescript', { paths: [ROOT] }));

const ZOD_METHODS = new Set(['min', 'max', 'length', 'regex', 'email', 'url', 'uuid', 'refine', 'superRefine', 'int', 'positive', 'nonnegative', 'negative', 'nonpositive', 'gte', 'gt', 'lte', 'lt', 'nonempty', 'datetime', 'date', 'time', 'multipleOf', 'finite', 'safe', 'check']);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules' && name !== 'locales' && !name.startsWith('.')) yield* walk(full);
    } else if (/\.ts$/.test(name) && !/\.(spec|test|d)\.ts$/.test(name)) yield full;
  }
}

const unwrap = (n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression?.(n) || ts.isSatisfiesExpression?.(n))) n = n.expression;
  return n;
};

/** O nome de um `{nome}` a partir da expressão do `${}`. */
function nameOf(expr) {
  const e = unwrap(expr);
  if (!e) return 'v';
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e)) return ts.isStringLiteral(e.argumentExpression) ? e.argumentExpression.text : nameOf(e.expression);
  if (ts.isCallExpression(e)) {
    const callee = unwrap(e.expression);
    const fn = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
    if ((fn === 'String' || fn === 'Number' || fn === 'trim' || fn === 'toString') && e.arguments[0]) return nameOf(e.arguments[0]);
    if (ts.isPropertyAccessExpression(callee) && ['join', 'slice', 'trim', 'toLowerCase', 'toUpperCase', 'toFixed', 'toLocaleString', 'split'].includes(fn)) return nameOf(callee.expression);
    return fn || 'v';
  }
  if (ts.isBinaryExpression(e)) return nameOf(e.left);
  if (ts.isConditionalExpression(e)) return 'v';
  return 'v';
}

const hasWords = (s) => /\p{L}{2,}/u.test(s.replace(/\{\w+\}/g, ''));

function extractSource(file, code, rel) {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const usesZod = /from ['"]zod['"]/.test(code);
  // t() e msg() importados de um módulo «i18n» (uma variável local `t` não conta).
  const i18nNames = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !/i18n/.test(st.moduleSpecifier.text)) continue;
    const nb = st.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (['t', 'msg'].includes((el.propertyName ?? el.name).text)) i18nNames.add(el.name.text);
  }
  const phrases = [];
  const problems = [];
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const add = (key, node, extra = {}) => {
    if (!key.trim() || !hasWords(key)) return;
    phrases.push({ key, file: rel, line: lineOf(node), ...extra });
  };

  /** Os textos de uma expressão: literais, `${}` com nomes, os dois ramos de `?:`, `??` e `||`. */
  function collect(node, depth = 0) {
    const e = unwrap(node);
    if (!e || depth > 6) return;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return add(e.text, e);
    if (ts.isTemplateExpression(e)) {
      let key = e.head.text;
      const used = new Map();
      for (const span of e.templateSpans) {
        let name = nameOf(span.expression).replace(/\W/g, '') || 'v';
        const n = (used.get(name) ?? 0) + 1;
        used.set(name, n);
        if (n > 1) name = `${name}${n}`;
        key += `{${name}}${span.literal.text}`;
        collect(span.expression, depth + 1);
      }
      return add(key, e);
    }
    if (ts.isConditionalExpression(e)) {
      collect(e.whenTrue, depth + 1);
      collect(e.whenFalse, depth + 1);
      return;
    }
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
        collect(e.left, depth + 1);
        collect(e.right, depth + 1);
      } else if (op === ts.SyntaxKind.PlusToken && (ts.isStringLiteral(unwrap(e.left)) || ts.isStringLiteral(unwrap(e.right)))) {
        problems.push({ file: rel, line: lineOf(e), msg: `texto juntado com + (usa uma crase): ${e.getText(sf).slice(0, 80)}` });
      }
      return;
    }
    if (ts.isCallExpression(e) && depth > 0) {
      // Dentro de um `${}`: String(x ?? 'texto'), plural(n, 'brinde', 'brindes') e afins.
      for (const a of e.arguments) collect(a, depth + 1);
    }
  }

  const propName = (p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined);
  const props = (obj) => {
    const m = new Map();
    for (const p of obj.properties) {
      const n = propName(p);
      if (n && ts.isPropertyAssignment(p)) m.set(n, p.initializer);
      else if (n && ts.isShorthandPropertyAssignment(p)) m.set(n, null);
    }
    return m;
  };

  const visit = (node) => {
    if (ts.isNewExpression(node)) {
      const c = unwrap(node.expression);
      if (ts.isIdentifier(c) && /Exception$/.test(c.text) && node.arguments?.[0]) {
        const a = unwrap(node.arguments[0]);
        if (ts.isObjectLiteralExpression(a)) {
          const m = props(a);
          for (const k of ['message', 'hint']) if (m.get(k)) collect(m.get(k));
        } else collect(a);
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      const m = props(node);
      if ((m.has('url') && (m.has('title') || m.has('body'))) || (m.has('title') && m.has('body'))) {
        for (const k of ['title', 'body']) if (m.get(k)) collect(m.get(k));
      }
      if (m.get('errorMessage')) collect(m.get('errorMessage'));
    } else if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee) && i18nNames.has(callee.text)) {
        const [first, second] = node.arguments;
        const f = unwrap(first);
        let other;
        let plural = false;
        if (second && ts.isObjectLiteralExpression(second)) {
          const m = props(second);
          plural = m.has('count') || m.has('other');
          const o = m.get('other') && unwrap(m.get('other'));
          if (o && (ts.isStringLiteral(o) || ts.isNoSubstitutionTemplateLiteral(o))) other = o.text;
        }
        const lits = (n) => {
          const x = unwrap(n);
          if (x && (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x))) return [x.text];
          if (x && ts.isConditionalExpression(x)) {
            const a = lits(x.whenTrue);
            const b = lits(x.whenFalse);
            return a && b ? [...a, ...b] : undefined;
          }
          return undefined;
        };
        const keys = lits(f);
        if (!keys) problems.push({ file: rel, line: lineOf(node), msg: `${callee.text}() com um argumento que não é texto literal: ${first ? first.getText(sf).slice(0, 80) : '(nada)'}` });
        else for (const k of keys) add(k, node, plural ? { plural, other } : {});
      } else if (ts.isPropertyAccessExpression(callee)) {
        const fn = callee.name.text;
        if (fn === 'addIssue') {
          const a = unwrap(node.arguments[0]);
          if (a && ts.isObjectLiteralExpression(a) && props(a).get('message')) collect(props(a).get('message'));
        } else if (usesZod && ZOD_METHODS.has(fn)) {
          for (const arg of node.arguments) {
            const a = unwrap(arg);
            if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) || ts.isTemplateExpression(a)) collect(a);
            else if (ts.isObjectLiteralExpression(a)) {
              const m = props(a);
              for (const k of ['message', 'error']) if (m.get(k)) collect(m.get(k));
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { phrases, problems };
}

/** Todas as frases da API: { phrases: [{ key, file, line }], problems: [{ file, line, msg }] }. */
function extract(root = ROOT, part = { src: ['apps/api/src'] }) {
  const phrases = [];
  const problems = [];
  for (const dir of part.src ?? ['apps/api/src']) {
    for (const file of walk(path.join(root, dir))) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (rel.includes('/i18n/') && rel.endsWith('i18n.ts')) continue;
      const r = extractSource(file, readFileSync(file, 'utf8'), rel);
      phrases.push(...r.phrases);
      problems.push(...r.problems);
    }
  }
  return { phrases, problems };
}

module.exports = { extract, extractSource };

if (require.main === module) {
  const r = extract();
  const keys = new Map();
  for (const p of r.phrases) if (!keys.has(p.key)) keys.set(p.key, `${p.file}:${p.line}`);
  if (process.argv.includes('--json')) console.log(JSON.stringify(Object.fromEntries(keys), null, 2));
  else {
    console.log(`api (erros, pushes, validações): ${keys.size} frases`);
    for (const pr of r.problems.slice(0, 30)) console.log(`  ${pr.file}:${pr.line}  ${pr.msg}`);
  }
}
