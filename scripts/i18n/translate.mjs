#!/usr/bin/env node
/**
 * Tradução automática dos catálogos (docs/idiomas.md).
 *
 *   node scripts/i18n/translate.mjs              extrai as frases, traduz só as novas ou mudadas e escreve os catálogos
 *   node scripts/i18n/translate.mjs --check      não traduz: falha se faltar alguma tradução
 *   node scripts/i18n/translate.mjs --lang en    só esse idioma
 *
 * Fornecedor: LibreTranslate em LT_URL (por omissão http://localhost:5000, com LT_API_KEY se precisar) ou DeepL se houver
 * DEEPL_API_KEY. Os termos do glossário (scripts/i18n/glossary.json), as variáveis {nome}, os @, os links e os emojis vão
 * protegidos por marcadores e repõem-se depois; se um marcador se perder tenta-se outro formato, e se falhar sempre a frase
 * fica por traduzir (aparece no fim; corrige-se em locales/overrides/<lang>.json).
 *
 * Escreve:
 *   locales/<lang>.json            o catálogo de cada idioma, com todas as frases (app, site e API)
 *   locales/.hash.json             a memória: o hash do texto de origem de cada tradução (muda o texto, traduz-se de novo)
 *   locales/.phrases.json          as frases extraídas e onde aparecem
 *   <parte>/locales/<lang>.json    a cópia de cada parte, só com as suas frases (scripts/i18n/config.json)
 *   apps/mobile/src/lib/i18n.ts    o bloco gerado com LANGS e os catálogos que a app carrega
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, extractAll, loadConfig } from './extract.mjs';

const LOCALES = path.join(ROOT, 'locales');
const rel = (...p) => path.join(ROOT, ...p);

// ---------------------------------------------------------------------------------------------------------- utilitários

export const hashOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** JSON com as chaves por ordem (diffs pequenos), LF e uma linha no fim. */
function writeJson(file, obj) {
  mkdirSync(path.dirname(file), { recursive: true });
  const sorted = {};
  for (const k of Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) sorted[k] = obj[k];
  writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
}

/** Os idiomas de packages/shared/src/i18n.ts: [{ code, name, locale }]; o primeiro é a origem. */
export function readLangs() {
  const src = readFileSync(rel('packages', 'shared', 'src', 'i18n.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const LANGS'), src.indexOf('] as const'));
  return [...block.matchAll(/\{\s*code:\s*'([^']+)',\s*name:\s*'([^']+)',\s*locale:\s*'([^']+)'\s*\}/g)].map((m) => ({ code: m[1], name: m[2], locale: m[3] }));
}

/** As formas de plural de um idioma (en: one, other; ru: one, few, many, other…). */
export const pluralCategories = (locale) => new Intl.PluralRules(locale).resolvedOptions().pluralCategories;

/**
 * As chaves que um idioma precisa: { chave → texto em português a traduzir }. Nos plurais, «_one» traduz o singular e as
 * outras formas traduzem o `other` (ou o singular, se não houver).
 */
export function neededKeys(all, locale) {
  const out = new Map();
  for (const [key, v] of all) {
    if (!v.plural) out.set(key, key);
    else for (const cat of pluralCategories(locale)) out.set(`${key}_${cat}`, cat === 'one' ? key : (v.other ?? key));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------- proteção

const glossary = readJson(rel('scripts', 'i18n', 'glossary.json'), { keep: [] }).keep;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const terms = [...new Set(glossary)].sort((a, b) => b.length - a.length).map(esc).join('|');
/**
 * O que se protege: variáveis, os marcadores do <T> da app (`<b>`, `</b>`, `<badge/>`: components/Trans.tsx), links, @,
 * emojis e os termos do glossário (palavras inteiras, maiúsculas ou não).
 */
const PROTECT = new RegExp(
  [
    '\\{[\\w.]+\\}',
    '</?[a-z][\\w-]*\\s*/?>',
    'https?://\\S+',
    '@[\\p{L}\\p{N}_.]+',
    '\\p{Extended_Pictographic}(?:\\uFE0F|\\u200D\\p{Extended_Pictographic})*\\uFE0F?',
    ...(terms ? [`(?<![\\p{L}\\p{N}])(?:${terms})(?![\\p{L}\\p{N}])`] : []),
  ].join('|'),
  'giu',
);

/** Os formatos de marcador, do melhor para o pior com o LibreTranslate (ver docs/idiomas.md). */
const FORMATS = [
  { make: (i) => `XT${i}X`, find: /X\s?T\s?(\d+)\s?X/gi },
  { make: (i) => `<${i}>`, find: /<\s?(\d+)\s?>/g },
  { make: (i) => `#${i}`, find: /#\s?(\d+)/g },
];
const DEEPL_FORMAT = { make: (i) => `<x id="${i}"/>`, find: /<x id="(\d+)"\s*\/>/g };

export function protect(text, fmt) {
  const tokens = [];
  const out = text.replace(PROTECT, (m) => fmt.make(tokens.push(m) - 1));
  return { text: out, tokens };
}

/** Repõe os termos; null se algum marcador se perdeu ou apareceu duas vezes. */
export function restore(text, tokens, fmt) {
  const seen = new Map();
  const re = new RegExp(fmt.find.source, fmt.find.flags);
  const out = text.replace(re, (m, n) => {
    const i = Number(n);
    if (!(i in tokens)) return m;
    seen.set(i, (seen.get(i) ?? 0) + 1);
    return tokens[i];
  });
  for (let i = 0; i < tokens.length; i++) if (seen.get(i) !== 1) return null;
  return out;
}

// ----------------------------------------------------------------------------------------------------------- fornecedores

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw last;
}

function libreTranslate() {
  const url = (process.env.LT_URL || 'http://localhost:5000').replace(/\/$/, '');
  return {
    name: `LibreTranslate (${url})`,
    formats: FORMATS,
    async translate(texts, source, target) {
      return withRetry(async () => {
        const res = await fetch(`${url}/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: texts, source, target: target.code, format: 'text', ...(process.env.LT_API_KEY ? { api_key: process.env.LT_API_KEY } : {}) }),
        });
        if (!res.ok) throw new Error(`LibreTranslate ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const j = await res.json();
        return Array.isArray(j.translatedText) ? j.translatedText : [j.translatedText];
      });
    },
  };
}

function deepl(key) {
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  return {
    name: 'DeepL',
    formats: [DEEPL_FORMAT, ...FORMATS],
    async translate(texts, source, target, fmt) {
      const tgt = ['EN-GB', 'EN-US', 'PT-PT', 'PT-BR'].includes(target.locale.toUpperCase()) ? target.locale.toUpperCase() : target.code.toUpperCase();
      return withRetry(async () => {
        const res = await fetch(`${host}/v2/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `DeepL-Auth-Key ${key}` },
          body: JSON.stringify({ text: texts, source_lang: source.toUpperCase(), target_lang: tgt, ...(fmt === DEEPL_FORMAT ? { tag_handling: 'xml', ignore_tags: ['x'] } : {}) }),
        });
        if (!res.ok) throw new Error(`DeepL ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return (await res.json()).translations.map((x) => x.text);
      });
    },
  };
}

export const provider = () => (process.env.DEEPL_API_KEY ? deepl(process.env.DEEPL_API_KEY) : libreTranslate());

// ------------------------------------------------------------------------------------------------------------- tradução

const HAS_LETTER = /\p{L}/u;

/** Arranjos depois da máquina: as reticências, a minúscula inicial e os espaços e a pontuação das pontas. */
function polish(src, out) {
  let r = out.trim();
  if (src.endsWith('…') && /\.{2,3}$/.test(r)) r = r.replace(/\.{2,3}$/, '…');
  if (src.endsWith('…') && !r.endsWith('…') && !/[.!?]$/.test(r)) r += '…';
  if (!/[.!?:…]$/.test(src) && /\.$/.test(r) && !/\.$/.test(src)) r = r.replace(/\.$/, '');
  const a = src.trimStart()[0];
  if (a && a !== a.toUpperCase() && a === a.toLowerCase() && r[0] && r[0] === r[0].toUpperCase() && !/^I\b/.test(r)) r = r[0].toLowerCase() + r.slice(1);
  return capitalize(src, r);
}

/** Frase que começa por maiúscula começa por maiúscula na tradução (o termo protegido «geleira» pode ter ido para o início). */
export function capitalize(src, r) {
  const a = src.trimStart()[0];
  if (a && a === a.toUpperCase() && a !== a.toLowerCase() && r[0] && r[0] !== r[0].toUpperCase()) return r[0].toUpperCase() + r.slice(1);
  return r;
}

/**
 * Traduz uma lista de textos em português. Devolve Map(texto → tradução); os que falharam ficam de fora.
 * Cada linha traduz-se à parte; as pontas («, na barra», espaços) ficam como estão.
 */
export async function translateAll(texts, target, prov = provider(), { log = () => {} } = {}) {
  // Partir em segmentos: linhas, sem as pontas.
  const segs = new Map(); // segmento → tradução (ou null)
  const plan = texts.map((t) =>
    t.split('\n').map((line) => {
      const m = line.match(/^([\s,;:.·•\-–]*)(.*?)(\s*)$/su);
      const core = m[2];
      if (core && HAS_LETTER.test(core.replace(PROTECT, ''))) segs.set(core, undefined);
      return { lead: m[1], core, trail: m[3] };
    }),
  );
  const todo = [...segs.keys()];
  let pending = todo;
  for (const fmt of prov.formats) {
    if (!pending.length) break;
    const failed = [];
    for (let i = 0; i < pending.length; i += 25) {
      const batch = pending.slice(i, i + 25);
      const prot = batch.map((s) => protect(s, fmt));
      const outs = await prov.translate(prot.map((p) => p.text), 'pt', target, fmt);
      batch.forEach((s, j) => {
        const back = outs[j] == null ? null : restore(outs[j], prot[j].tokens, fmt);
        if (back && HAS_LETTER.test(back)) segs.set(s, polish(s, back));
        else failed.push(s);
      });
      log(`  ${target.code}: ${Math.min(i + 25, pending.length)}/${pending.length}${fmt === prov.formats[0] ? '' : ` (outra vez, marcadores ${fmt.make(0)})`}`);
    }
    pending = failed;
  }
  const result = new Map();
  for (const [t, lines] of texts.map((t, i) => [t, plan[i]])) {
    let ok = true;
    const out = lines
      .map(({ lead, core, trail }) => {
        if (!core || !HAS_LETTER.test(core.replace(PROTECT, ''))) return lead + core + trail;
        const tr = segs.get(core);
        if (!tr) ok = false;
        return lead + (tr ?? '') + trail;
      })
      .join('\n');
    if (ok) result.set(t, out);
  }
  return result;
}

// -------------------------------------------------------------------------------------------------------- geração (app)

const BEGIN = '// <gerado por scripts/i18n/translate.mjs: não editar à mão>';
const END = '// </gerado>';

/** O bloco do topo de apps/mobile/src/lib/i18n.ts: LANGS (cópia do shared) e os catálogos que a app carrega. */
export function mobileBlock(langs) {
  const lines = [
    BEGIN,
    '/** Os idiomas da app, com o nome de cada um no próprio idioma (cópia de packages/shared/src/i18n.ts). */',
    'export const LANGS = [',
    ...langs.map((l) => `  { code: '${l.code}', name: '${l.name.replace(/'/g, "\\'")}', locale: '${l.locale}' },`),
    '] as const;',
    '',
    'function loadCatalog(code: string): Record<string, string> | undefined {',
    '  switch (code) {',
    ...langs.slice(1).map((l) => `    case '${l.code}': return require('../locales/${l.code}.json');`),
    '    default: return undefined;',
    '  }',
    '}',
    END,
  ];
  return lines.join('\n');
}

function writeMobileBlock(langs) {
  const file = rel('apps', 'mobile', 'src', 'lib', 'i18n.ts');
  const src = readFileSync(file, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const a = src.indexOf(BEGIN);
  const b = src.indexOf(END, a);
  if (a < 0 || b < 0) throw new Error('apps/mobile/src/lib/i18n.ts sem o bloco gerado');
  const next = src.slice(0, a) + mobileBlock(langs).split('\n').join(eol) + src.slice(b + END.length);
  if (next !== src) writeFileSync(file, next);
}

// ----------------------------------------------------------------------------------------------------------------- main

export async function run({ check = false, only = null, log = console.log } = {}) {
  const config = loadConfig();
  const langs = readLangs();
  const [source, ...targets] = langs;
  if (source.code !== config.source) throw new Error(`O primeiro idioma de LANGS (${source.code}) tem de ser a origem (${config.source})`);
  const ex = extractAll(config);
  for (const [name, p] of Object.entries(ex.parts)) {
    if (p.strict && p.problems.length) log(`aviso: ${name} tem ${p.problems.length} t() com argumento não literal (node scripts/i18n/extract.mjs)`);
  }
  for (const c of ex.conflicts) log(`aviso: plural diferente para «${c.key}» (${c.file}:${c.line})`);

  const phrases = {};
  for (const [k, v] of ex.all) phrases[k] = { ...(v.other !== undefined ? { other: v.other } : {}), ...(v.plural ? { plural: true } : {}), parts: [...v.parts].sort() };

  const hashes = readJson(path.join(LOCALES, '.hash.json'), {});
  const missingAll = {};
  const prov = check ? null : provider();
  if (prov) log(`tradutor: ${prov.name}`);

  for (const target of targets) {
    if (only && target.code !== only) continue;
    const catFile = path.join(LOCALES, `${target.code}.json`);
    const catalog = readJson(catFile, {});
    const overrides = readJson(path.join(LOCALES, 'overrides', `${target.code}.json`), {});
    const memo = hashes[target.code] ?? {};
    const need = neededKeys(ex.all, target.locale);
    const next = {};
    const nextMemo = {};
    const todo = new Map(); // chave → texto pt
    for (const [key, src] of need) {
      if (key in overrides) {
        next[key] = overrides[key];
        continue;
      }
      const h = hashOf(src);
      if (key in catalog && memo[key] === h) {
        next[key] = catalog[key];
        nextMemo[key] = h;
      } else todo.set(key, src);
    }
    if (todo.size && !check) {
      log(`${target.code}: ${todo.size} por traduzir`);
      const texts = [...new Set(todo.values())];
      const done = await translateAll(texts, target, prov, { log });
      for (const [key, src] of todo) {
        if (!done.has(src)) continue;
        next[key] = done.get(src);
        nextMemo[key] = hashOf(src);
        todo.delete(key);
      }
    }
    if (todo.size) missingAll[target.code] = [...todo.keys()];
    if (!check) {
      writeJson(catFile, next);
      hashes[target.code] = nextMemo;
      for (const [name, part] of Object.entries(config.parts)) {
        const keys = ex.parts[name].keys;
        const copy = {};
        for (const [k, v] of keys) {
          if (!v.plural && !ex.all.get(k).plural) {
            if (k in next) copy[k] = next[k];
          } else for (const cat of pluralCategories(target.locale)) if (`${k}_${cat}` in next) copy[`${k}_${cat}`] = next[`${k}_${cat}`];
        }
        if (Object.keys(copy).length || existsSync(rel(part.out))) writeJson(rel(part.out, `${target.code}.json`), copy);
      }
    }
  }
  if (!check) {
    writeJson(path.join(LOCALES, '.hash.json'), hashes);
    // Uma linha por frase: diffs e merges pequenos.
    const keys = Object.keys(phrases).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    writeFileSync(path.join(LOCALES, '.phrases.json'), `{\n${keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(phrases[k])}`).join(',\n')}\n}\n`);
    writeMobileBlock(langs);
  }
  for (const [code, keys] of Object.entries(missingAll)) {
    log(`${code}: ${keys.length} frases sem tradução${check ? '' : ' (o tradutor falhou: corrige em locales/overrides/' + code + '.json)'}:`);
    for (const k of keys.slice(0, 40)) log(`  «${k}»`);
    if (keys.length > 40) log(`  … e mais ${keys.length - 40}`);
  }
  log(`${ex.all.size} frases; idiomas: ${langs.map((l) => l.code).join(', ')}`);
  return { missing: missingAll };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const li = args.indexOf('--lang');
  run({ check: args.includes('--check'), only: li >= 0 ? args[li + 1] : null })
    .then((r) => {
      process.exitCode = Object.keys(r.missing).length ? 1 : 0;
    })
    .catch((e) => {
      console.error(e.message ?? e);
      process.exitCode = 2;
    });
}
