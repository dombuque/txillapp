// Testes dos idiomas (docs/idiomas.md): todas as frases de t() da app, do site e da API têm tradução nos catálogos de cada
// idioma, t() só recebe textos literais, as cópias de cada parte batem com o catálogo da raiz, a lista de idiomas da app é a
// de packages/shared, e o lib/i18n (t, plural, idioma no arranque, Intl) funciona.
// Correr em apps/mobile:  node --test tests/*.test.mjs
// Se faltar tradução:      node scripts/i18n/translate.mjs   (na raiz; com o LibreTranslate local ou DEEPL_API_KEY)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(MOBILE, '..', '..');
const { extractAll, loadConfig } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'i18n', 'extract.mjs')).href);
const { readLangs, neededKeys, protect, restore, mobileBlock } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'i18n', 'translate.mjs')).href);
const i18n = await import(pathToFileURL(path.join(MOBILE, 'src', 'lib', 'i18n.ts')).href);

const config = loadConfig();
const ex = extractAll(config);
const langs = readLangs();
const json = (...p) => JSON.parse(readFileSync(path.join(ROOT, ...p), 'utf8'));

test('t() só recebe textos literais (as partes que mudam vão em {nome}) na app e na API', () => {
  for (const [name, part] of Object.entries(ex.parts)) {
    if (!part.strict) continue;
    assert.deepEqual(part.problems.map((p) => `${p.file}:${p.line} ${p.msg}`), [], `t() com argumento não literal em ${name}`);
  }
  assert.deepEqual(ex.conflicts, [], 'a mesma frase com dois plurais diferentes');
});

test('cada frase usada no código tem tradução em cada idioma (catálogo da raiz)', () => {
  for (const lang of langs.slice(1)) {
    const cat = existsSync(path.join(ROOT, 'locales', `${lang.code}.json`)) ? json('locales', `${lang.code}.json`) : {};
    const missing = [...neededKeys(ex.all, lang.locale).keys()].filter((k) => typeof cat[k] !== 'string' || !cat[k].trim());
    assert.deepEqual(missing.slice(0, 30), [], `${missing.length} frases sem tradução em ${lang.code}: corre node scripts/i18n/translate.mjs`);
  }
});

test('as variáveis {nome} da frase estão todas na tradução', () => {
  for (const lang of langs.slice(1)) {
    const cat = json('locales', `${lang.code}.json`);
    const bad = [];
    for (const [k, v] of Object.entries(cat)) {
      const src = k.replace(/_(zero|one|two|few|many|other)$/, '');
      const vars = (s) => (s.match(/\{[\w.]+\}/g) ?? []).sort().join(' ');
      // O plural pode usar o `other`, que tem as mesmas variáveis do singular (mais {count}).
      if (!vars(v).split(' ').every((x) => !x || vars(src).includes(x) || x === '{count}')) bad.push(`${k} => ${v}`);
      if (vars(src).split(' ').some((x) => x && x !== '{count}' && !v.includes(x))) bad.push(`${k} => ${v}`);
    }
    assert.deepEqual(bad.slice(0, 20), [], `traduções sem as variáveis certas em ${lang.code}`);
  }
});

test('a cópia de cada parte tem as suas frases, iguais às do catálogo da raiz', () => {
  for (const lang of langs.slice(1)) {
    const root = json('locales', `${lang.code}.json`);
    for (const [name, part] of Object.entries(config.parts)) {
      const file = path.join(ROOT, part.out, `${lang.code}.json`);
      const keys = ex.parts[name].keys;
      if (!keys.size && !existsSync(file)) continue;
      const copy = JSON.parse(readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(copy)) assert.equal(v, root[k], `${name}/${lang.code}: «${k}»`);
      for (const k of keys.keys()) {
        const plural = ex.all.get(k).plural;
        assert.ok(plural ? Object.keys(copy).some((c) => c.startsWith(`${k}_`)) : k in copy, `${name}/${lang.code} sem «${k}»`);
      }
    }
  }
});

test('a lista de idiomas da app é a de packages/shared (bloco gerado em lib/i18n.ts)', () => {
  assert.equal(langs[0].code, 'pt');
  assert.ok(langs.some((l) => l.code === 'en'));
  assert.deepEqual(i18n.LANGS.map((l) => ({ ...l })), langs);
  const src = readFileSync(path.join(MOBILE, 'src', 'lib', 'i18n.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(src.includes(mobileBlock(langs)), 'bloco gerado desatualizado: corre node scripts/i18n/translate.mjs');
  for (const l of langs.slice(1)) assert.ok(existsSync(path.join(MOBILE, 'src', 'locales', `${l.code}.json`)), `src/locales/${l.code}.json`);
});

test('t(): {nome}, plural com count/other (em português só o 1 é singular) e sem separadores', () => {
  assert.equal(i18n.currentLanguage(), 'pt'); // no Node não há idioma guardado nem do sistema
  assert.equal(i18n.t('Guardar'), 'Guardar');
  assert.equal(i18n.t('Olá, {nome}.', { nome: 'Ana' }), 'Olá, Ana.');
  assert.equal(i18n.t('Regras: lê. Depois: escreve.'), 'Regras: lê. Depois: escreve.');
  const p = (n) => i18n.t('{count} amigo', { count: n, other: '{count} amigos' });
  assert.deepEqual([0, 1, 2, 10].map(p), ['0 amigos', '1 amigo', '2 amigos', '10 amigos']);
  assert.equal(i18n.t('{count} min', { count: 5 }), '5 min');
});

test('idioma no arranque: o guardado, senão o do sistema que exista, senão pt', () => {
  assert.equal(i18n.resolveLanguage('en', ['pt-MZ']), 'en');
  assert.equal(i18n.resolveLanguage('pt-MZ', ['en-US']), 'pt'); // o id antigo do site
  assert.equal(i18n.resolveLanguage(null, ['fr-FR', 'en-US']), 'en');
  assert.equal(i18n.resolveLanguage(null, ['fr-FR']), 'pt');
  assert.equal(i18n.resolveLanguage('xx', []), 'pt');
  assert.equal(i18n.matchLang('EN_gb'), 'en');
});

test('datas e números com o Intl do idioma ativo', () => {
  assert.equal(i18n.localeOf('pt'), 'pt-MZ');
  assert.match(i18n.formatDate(new Date(Date.UTC(2026, 10, 17, 12)), { dateStyle: 'long', timeZone: 'UTC' }), /17 de novembro de 2026/);
  assert.equal(i18n.formatNumber(0.5, { style: 'percent' }), '50%');
});

test('meses e dias: em português os da casa, sem t() nem listas à mão nos ecrãs', () => {
  assert.equal(i18n.monthNames()[10], 'novembro');
  assert.equal(i18n.monthNames('short')[1], 'fev');
  assert.equal(i18n.weekdayNames()[1], 'seg');
  assert.equal(i18n.weekdayNames('short', { capital: true })[6], 'Sáb');
  assert.equal(i18n.weekdayNames('long')[0], 'domingo');
  assert.equal(i18n.abbr('nov'), 'nov.');
  // Nenhuma lista de meses ou dias passa por t() (traduzir «seg» sozinho dá disparates): usa-se monthNames/weekdayNames.
  const app = [...ex.parts.app.keys.keys()];
  for (const k of ['janeiro', 'novembro', 'seg', 'Seg', 'sáb.', 'terça-feira']) assert.ok(!app.includes(k), `«${k}» em t()`);
});

test('marcadores do <T> (components/Trans.tsx): a tradução tem os mesmos que a frase', () => {
  const tags = (s) => (s.match(/<\/?[a-z][\w-]*\s*\/?>/g) ?? []).sort().join(' ');
  const fmt = { make: (i) => `XT${i}X`, find: /X\s?T\s?(\d+)\s?X/gi };
  assert.equal(protect('Li e aceito os <terms>Termos de Uso</terms>.', fmt).text, 'Li e aceito os XT0XTermos de UsoXT1X.');
  for (const lang of langs.slice(1)) {
    const cat = json('locales', `${lang.code}.json`);
    const bad = Object.entries(cat).filter(([k, v]) => tags(k.replace(/_(zero|one|two|few|many|other)$/, '')) !== tags(v)).map(([k, v]) => `${k} => ${v}`);
    assert.deepEqual(bad.slice(0, 20), [], `traduções sem os marcadores certos em ${lang.code}`);
  }
  const trans = readFileSync(path.join(MOBILE, 'src', 'components', 'Trans.tsx'), 'utf8');
  assert.match(trans, /export function T\(/);
});

test('o tradutor protege o glossário e as variáveis e repõe-nos; marcador perdido dá null', () => {
  const fmt = { make: (i) => `XT${i}X`, find: /X\s?T\s?(\d+)\s?X/gi };
  const p = protect('Abre a tua geleira, {nome}, e paga uma gelada à malta 🍺', fmt);
  assert.equal(p.text, 'Abre a tua XT0X, XT1X, e paga uma XT2X à XT3X XT4X');
  assert.equal(restore('Open your XT0X, XT1X, and buy a XT2X for the XT 3X XT4X', p.tokens, fmt), 'Open your geleira, {nome}, and buy a gelada for the malta 🍺');
  assert.equal(restore('Open your XT0X and buy a XT2X', p.tokens, fmt), null);
});

test('context: «Entrar» é «Log in» no login e «Join» no Mixar e na Txillada; em português fica «Entrar»', async () => {
  assert.equal(i18n.t('Entrar', { context: 'juntar' }), 'Entrar');
  const all = ex.all.get('Entrar_juntar');
  assert.equal(all?.src, 'Entrar');
  assert.equal(neededKeys(ex.all, 'en-GB').get('Entrar_juntar'), 'Entrar');
  const en = json('apps', 'mobile', 'src', 'locales', 'en.json');
  const { createRequire } = await import('node:module');
  const i18next = createRequire(path.join(MOBILE, 'package.json'))('i18next');
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false, nsSeparator: false, showSupportNotice: false });
  assert.equal(inst.t('Entrar'), 'Log in');
  assert.equal(inst.t('Entrar', { context: 'juntar' }), 'Join');
  for (const f of ['app/mixar/index.tsx', 'app/mixar/[id].tsx', 'app/txillada/agendada/[id].tsx']) {
    assert.match(readFileSync(path.join(MOBILE, 'src', f), 'utf8'), /t\('Entrar', \{ context: 'juntar' \}\)/, f);
  }
});

test('glossário por idioma: «malta» fica em português por omissão mas traduz-se em inglês', () => {
  const fmt = { make: (i) => `XT${i}X`, find: /Xs?Ts?(d+)s?X/gi };
  assert.equal(protect('Convida a malta para a geleira', fmt).text, 'Convida a XT0X para a XT1X');
  assert.equal(protect('Convida a malta para a geleira', fmt, 'en').text, 'Convida a malta para a XT0X');
  const en = json('locales', 'en.json');
  const left = Object.entries(en).filter(([, v]) => /(?<![p{L}])malta(?![p{L}])/iu.test(v)).map(([k, v]) => `${k} => ${v}`);
  assert.deepEqual(left.slice(0, 20), [], `${left.length} frases inglesas ainda com «malta»`);
});

test('ecrã «Idiomas»: LANGS com o nome próprio, visto no escolhido, guarda na conta e recarrega; sem «em breve» nem traduções', () => {
  const src = readFileSync(path.join(MOBILE, 'src', 'app', 'language.tsx'), 'utf8');
  assert.match(src, /title=\{t\('Idiomas'\)\}/);
  assert.match(src, /LANGS\.map/);
  assert.match(src, /\{l\.name\}/);
  assert.match(src, /api\.updateMe\(\{ language: lang \}\)/);
  assert.match(src, /setLanguage\(lang\)/);
  assert.doesNotMatch(src, /em breve|Traduções|Traduzir publicações|showComingSoon/i);
  const ap = readFileSync(path.join(MOBILE, 'src', 'app', 'settings', 'aparencia.tsx'), 'utf8');
  assert.match(ap, /title=\{t\('Idiomas'\)\} value=\{languageName\(\)\}/);
  const api = readFileSync(path.join(MOBILE, 'src', 'lib', 'api.ts'), 'utf8');
  assert.match(api, /'Accept-Language': currentLanguage\(\)/);
});
