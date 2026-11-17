import { readFileSync } from 'fs';
import { join } from 'path';
import i18next, { type i18n as I18n } from 'i18next';
import { LANGS as SHARED_LANGS, pickLang as sharedPickLang, SOURCE_LANG as SHARED_SOURCE, type LangCode } from '@txillapp/shared';

/**
 * Idiomas no servidor (docs/idiomas-api.md). A chave é a própria frase em português, como no código; as variáveis vão
 * em `{nome}`. O catálogo é a cópia da API (`src/locales/<lang>.json`), gerada por scripts/i18n/translate.mjs a partir de
 * `locales/` na raiz (docs/idiomas.md), nunca escrita à mão.
 */

/** Os códigos dos idiomas (a lista é a de packages/shared). O primeiro é a origem (o texto do código). */
export const LANGS = SHARED_LANGS.map((l) => l.code) as unknown as readonly [LangCode, ...LangCode[]];
export type Lang = LangCode;
export const SOURCE_LANG: Lang = SHARED_SOURCE;

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/** O idioma guardado na conta, se for um dos da lista (null = não escolhido). */
export const storedLang = (v: unknown): Lang | null => (isLang(v) ? v : null);

/** O idioma de um cabeçalho Accept-Language («en-US,en;q=0.9»): o primeiro da lista da app; sem nenhum, português. */
export function pickLang(header: string | string[] | undefined | null): Lang {
  return sharedPickLang(Array.isArray(header) ? header.join(',') : header);
}

/* ───────────── catálogos ───────────── */

type Catalog = Record<string, string>;

/** A pasta da cópia da API: `src/locales` (ou `dist/locales`, copiada no build pelo nest-cli.json). LOCALES_DIR muda-a. */
const localesDir = () => process.env.LOCALES_DIR ?? join(__dirname, '..', 'locales');

function readJson(file: string): Catalog {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(data).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));
  } catch {
    return {};
  }
}

/** O catálogo de um idioma (o português não tem: a chave é o texto). As correções de `overrides/` já vêm aplicadas. */
function loadCatalog(lang: Lang): Catalog {
  return lang === SOURCE_LANG ? {} : readJson(join(localesDir(), `${lang}.json`));
}

/** Um texto com `{nome}` por preencher, pronto para reconhecer o texto já montado. */
interface Pattern {
  re: RegExp;
  names: string[];
  translation: string;
}

interface State {
  i18n: I18n;
  catalogs: Record<Lang, Catalog>;
  patterns: Record<Lang, Pattern[]>;
}

let state: State | null = null;

const PLACEHOLDER = /\{(\w+)\}/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compilePatterns(cat: Catalog): Pattern[] {
  const out: (Pattern & { weight: number })[] = [];
  for (const [key, translation] of Object.entries(cat)) {
    // As formas do plural (`frase_one`, `frase_other`) só servem o t() com `count`: os textos com número montam-se já no
    // idioma de quem recebe.
    if (!key.includes('{') || /_(zero|one|two|few|many|other)$/.test(key)) continue;
    const parts = key.split(PLACEHOLDER);
    // split com um grupo: [texto, nome, texto, nome, ..., texto]
    const literal = parts.filter((_, i) => i % 2 === 0).join('');
    // Só com texto à volta: «{nome}» sozinho apanhava tudo.
    if ((literal.match(/\p{L}/gu) ?? []).length < 3) continue;
    const names: string[] = [];
    let src = '^';
    parts.forEach((p, i) => {
      if (i % 2 === 0) src += escapeRe(p);
      else {
        names.push(p);
        src += '([\\s\\S]+?)';
      }
    });
    out.push({ re: new RegExp(`${src}$`, 'u'), names, translation, weight: literal.length });
  }
  // Os mais compridos primeiro: são os mais exatos.
  return out.sort((a, b) => b.weight - a.weight).map(({ weight: _w, ...p }) => p);
}

function init(): State {
  const catalogs = Object.fromEntries(LANGS.map((l) => [l, loadCatalog(l)])) as Record<Lang, Catalog>;
  const i18n = i18next.createInstance();
  void i18n.init({
    resources: Object.fromEntries(LANGS.map((l) => [l, { translation: catalogs[l] }])),
    lng: SOURCE_LANG,
    fallbackLng: false,
    supportedLngs: [...LANGS],
    keySeparator: false,
    nsSeparator: false,
    returnNull: false,
    returnEmptyString: false,
    interpolation: { prefix: '{', suffix: '}', escapeValue: false },
    initAsync: false,
    showSupportNotice: false,
  } as Parameters<I18n['init']>[0]);
  const patterns = Object.fromEntries(LANGS.map((l) => [l, compilePatterns(catalogs[l])])) as Record<Lang, Pattern[]>;
  return { i18n, catalogs, patterns };
}

const get = () => (state ??= init());

/** Volta a ler os catálogos (testes, ou depois de gerar uma tradução nova). */
export function reloadCatalogs(extra?: Partial<Record<Lang, Catalog>>) {
  state = init();
  if (extra) {
    for (const l of LANGS) {
      const more = extra[l];
      if (!more) continue;
      Object.assign(state.catalogs[l], more);
      state.i18n.addResources(l, 'translation', more);
      state.patterns[l] = compilePatterns(state.catalogs[l]);
    }
  }
}

/** As variáveis de um `t()`: `{nome}` e, no plural, `count` e `other` (a forma do plural em português, literal). */
export type TVars = Record<string, unknown> & { count?: number; other?: string };

/**
 * Traduz uma frase do código (a chave é o texto em português) para `lang`, com as variáveis `{nome}` preenchidas.
 * Sem tradução, fica o português. O plural é como na app (docs/idiomas.md): `t('{count} brinde', { count, other: '{count}
 * brindes' }, lang)`; em português só o 1 é singular. Sem `lang` sai em português: serve para montar um texto que se
 * traduz à saída (push, erro) e fica marcado para a extração.
 */
export function t(phrase: string, vars: TVars = {}, lang: Lang = SOURCE_LANG): string {
  const i18n = get().i18n;
  const { other, ...rest } = vars;
  const count = typeof rest.count === 'number' ? rest.count : undefined;
  if (count === undefined) return i18n.t(phrase, { ...rest, lng: lang, defaultValue: phrase }) as string;
  if (lang === SOURCE_LANG) {
    const form = Math.abs(count) === 1 ? phrase : (other ?? phrase);
    return i18n.t(phrase, { ...rest, lng: lang, defaultValue: form }) as string;
  }
  return i18n.t(phrase, { ...rest, lng: lang, defaultValue_one: phrase, defaultValue_other: other ?? phrase, defaultValue: other ?? phrase }) as string;
}

/**
 * Marca uma frase (ou `a ? 'x' : 'y'`, com textos literais) para a extração, sem a traduzir já: o texto segue em
 * português e traduz-se à saída (filtro dos erros, push, e-mail), no idioma de quem o recebe. Ver config.json («markers»).
 */
export const msg = (phrase: string): string => phrase;

/**
 * Traduz um texto JÁ MONTADO em português (a mensagem de um erro, o título ou o corpo de um push). Primeiro a frase
 * inteira; senão, reconhece-se uma frase do catálogo com `{nome}` (as partes variáveis passam como estão, ou traduzidas
 * se forem elas próprias uma frase do catálogo, como «o teu local»). Sem nada que bata certo, fica como está.
 */
export function translateText(text: string, lang: Lang, depth = 0): string {
  if (lang === SOURCE_LANG || !text) return text;
  const s = get();
  const cat = s.catalogs[lang];
  const exact = cat[text];
  if (exact) return exact;
  // Espaços à volta não mudam a frase.
  const trimmed = text.trim();
  if (trimmed !== text && cat[trimmed]) return text.replace(trimmed, cat[trimmed]);
  if (depth > 1) return text;
  for (const p of s.patterns[lang]) {
    const m = p.re.exec(text);
    if (!m) continue;
    const vars: Record<string, string> = {};
    p.names.forEach((n, i) => {
      vars[n] = translateText(m[i + 1], lang, depth + 1);
    });
    return p.translation.replace(PLACEHOLDER, (all, n: string) => (n in vars ? vars[n] : all));
  }
  // «Ana: criou uma sondagem» (os avisos dos grupos): o nome fica e traduz-se o resto.
  const colon = text.indexOf(': ');
  if (depth === 0 && colon > 0) {
    const rest = text.slice(colon + 2);
    const done = cat[rest];
    if (done) return `${text.slice(0, colon)}: ${done}`;
  }
  return text;
}

/** O código Intl de um idioma da app (as datas e os números dos textos). */
export const intlLocale = (lang: Lang): string => SHARED_LANGS.find((l) => l.code === lang)?.locale ?? lang;
