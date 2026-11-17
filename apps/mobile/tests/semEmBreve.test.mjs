// Lojas (App Store 2.1/2.2, Google Play): nada de funcionalidades «em breve», ecrãs que prometem coisas por vir nem botões
// que não fazem nada. Este teste lê o código das apps (apps/mobile/src e apps/web/src) sem os comentários e falha se
// aparecer «em breve», «brevemente», «ainda não existe», «coming soon» ou o componente «Soon» fora das exceções:
// a fila «Em breve» das Txilladas agendadas (uma funcionalidade que existe) e os textos de tempo real («Começa em breve»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPS = path.resolve(MOBILE, '..');
const ROOTS = [path.join(APPS, 'mobile', 'src'), path.join(APPS, 'web', 'src')];

/** Ficheiros da Txillada agendada: lá «Em breve» é o nome da fila e «Começa em breve» é a hora real. */
const TXILLADA_AGENDADA = [
  /^mobile\/src\/app\/txillada\//,
  /^mobile\/src\/components\/txillada\/(ScheduleCards|TxilladaSchedule)\.tsx$/,
  /^mobile\/src\/lib\/txillada[^/]*\.ts$/,
];

/** Outras exceções, ficheiro a ficheiro: o que se tira da linha antes de procurar. */
const ALLOW = {
  // Sinónimos da pesquisa das Definições para os avisos das Txilladas (a fila «Em breve» existe); não se veem.
  'mobile/src/lib/settingsIndex.ts': [/'em breve'/g],
};

/** As palavras que anunciam o que ainda não existe. */
const PROMISE = /\b[Ee]m breve\b|\b[Bb]revemente\b|\b[Aa]inda não existe|\b[Cc]oming soon\b|\bSOON\b/;
/** O componente e as regras antigas do «em breve». */
const SOON_CODE = /\b(Soon|ComingSoon|showComingSoon)\b/;

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const BS = String.fromCharCode(92);

/** O código sem comentários (// e /* *\/), com as strings e o texto do JSX intactos. Linhas mantêm-se. */
export function stripComments(src) {
  let out = '';
  let i = 0;
  let mode = 'code';
  let quote = '';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { mode = 'str'; quote = c; }
      out += c; i += 1; continue;
    }
    if (mode === 'str') {
      out += c;
      if (c === BS) { out += n ?? ''; i += 2; continue; }
      if (c === quote || (c === '\n' && quote !== '`')) mode = 'code';
      i += 1; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i += 1; continue; }
    if (c === '*' && n === '/') { mode = 'code'; i += 2; continue; }
    if (c === '\n') out += c;
    i += 1;
  }
  return out;
}

const rel = (f) => path.relative(APPS, f).split(path.sep).join('/');

function offenders() {
  const hits = [];
  for (const root of ROOTS) {
    for (const f of files(root)) {
      const r = rel(f);
      const code = stripComments(readFileSync(f, 'utf8')).split(/\r?\n/);
      const txillada = TXILLADA_AGENDADA.some((re) => re.test(r));
      code.forEach((line, i) => {
        // A fila das Txilladas agendadas citada pelo nome («Em breve») é uma funcionalidade que existe.
        const clean = (ALLOW[r] ?? []).reduce((s, re) => s.replace(re, ''), line.replace(/«Em breve»/g, ''));
        if (!txillada && PROMISE.test(clean)) hits.push(`${r}:${i + 1}: ${line.trim().slice(0, 140)}`);
        if (SOON_CODE.test(line)) hits.push(`${r}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
    }
  }
  return hits;
}

test('stripComments: tira os comentários e deixa as strings e o JSX', () => {
  assert.equal(stripComments("a // em breve\nb"), 'a \nb');
  assert.equal(stripComments('x /* em breve */ y'), 'x  y');
  assert.equal(stripComments("'https://txillapp.com' // c"), "'https://txillapp.com' ");
  assert.equal(stripComments('<Text>Em breve</Text>{/* nota */}'), '<Text>Em breve</Text>{}');
});

test('o detetor apanha as promessas e deixa a fila da Txillada', () => {
  const probe = (s) => PROMISE.test(s.replace(/«Em breve»/g, ''));
  assert.ok(probe("value=\"Em breve: M-Pesa\""));
  assert.ok(probe("'Brevemente'"));
  assert.ok(probe("'O modo escuro ainda não existe na app.'"));
  assert.ok(probe("'Coming soon: translate'"));
  assert.ok(!probe("'na fila «Em breve» de quem te segue'"));
  assert.ok(!probe("'Try again soon'"));
});

test('lojas: nenhum texto visível promete funcionalidades «em breve» (fora da Txillada agendada)', () => {
  assert.deepEqual(offenders(), []);
});

test('lojas: sem o componente «Soon», o «ComingSoon» do site nem o showComingSoon', () => {
  assert.equal(existsSync(path.join(APPS, 'mobile', 'src', 'components', 'Soon.tsx')), false);
  assert.equal(existsSync(path.join(APPS, 'web', 'src', 'pages', 'Simple.tsx')), false);
  assert.doesNotMatch(readFileSync(path.join(MOBILE, 'src', 'lib', 'storeRules.ts'), 'utf8'), /showComingSoon/);
});

test('Definições: o grupo do idioma não tem tema nem traduções por vir, e a pesquisa não leva a elas', () => {
  const idx = readFileSync(path.join(MOBILE, 'src', 'lib', 'settingsIndex.ts'), 'utf8');
  assert.doesNotMatch(idx, /id: 'theme'|modo escuro|'traduzir'/);
  assert.match(idx, /\{ id: 'aparencia', title: 'Idioma',/);
  const ap = readFileSync(path.join(MOBILE, 'src', 'app', 'settings', 'aparencia.tsx'), 'utf8');
  assert.doesNotMatch(ap, /\blocked\b|Tema/);
});
