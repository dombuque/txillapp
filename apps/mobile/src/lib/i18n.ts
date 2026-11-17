import i18next from 'i18next';

/**
 * Idiomas da app (docs/idiomas.md). A chave é a própria frase em português de Moçambique, que é o texto do código:
 *
 *   t('Guardar')
 *   t('Olá, {nome}.', { nome })
 *   t('{count} seguidor', { count: n, other: '{count} seguidores' })
 *
 * - `t()` é síncrona: o idioma resolve-se quando este módulo carrega (o guardado neste aparelho, senão o do sistema, senão
 *   o português) e mudar de idioma recarrega a app.
 * - A frase tem de ser um texto literal (o teste tests/i18n.test.mjs falha se não for): as partes que mudam vão em `{nome}`.
 * - Plural: `count` e, se o plural for diferente, `other` com a forma do plural (também literal). Em português só o 1 é
 *   singular; nos outros idiomas o i18next escolhe a forma pelas regras do idioma (`_one`, `_other`… no catálogo).
 * - Os catálogos são gerados por `node scripts/i18n/translate.mjs` (nunca à mão) em src/locales/<idioma>.json.
 * - Datas e números: `formatDate` e `formatNumber` (Intl com o idioma ativo), nunca textos à mão.
 *
 * Funciona também fora da app (testes no Node): sem `require`, fica em português.
 */

// <gerado por scripts/i18n/translate.mjs: não editar à mão>
/** Os idiomas da app, com o nome de cada um no próprio idioma (cópia de packages/shared/src/i18n.ts). */
export const LANGS = [
  { code: 'pt', name: 'Português', locale: 'pt-MZ' },
  { code: 'en', name: 'English', locale: 'en-GB' },
] as const;

function loadCatalog(code: string): Record<string, string> | undefined {
  switch (code) {
    case 'en': return require('../locales/en.json');
    default: return undefined;
  }
}
// </gerado>

export type Lang = (typeof LANGS)[number]['code'];
export type Vars = Record<string, string | number | null | undefined> & { count?: number; other?: string };

/** A língua de origem: o texto do código. */
export const SOURCE_LANG: Lang = 'pt';
/** Onde se guarda a escolha neste aparelho (o site antigo usava a mesma chave, com «pt-MZ»). */
const KEY = 'txill_lang';

const hasRequire = typeof require === 'function';
const isWeb = typeof document !== 'undefined' && typeof window !== 'undefined';

/** O idioma da lista para um código como «en-US», «pt_MZ» ou «pt-MZ»; null se não houver. */
export function matchLang(input?: string | null): Lang | null {
  if (!input) return null;
  const code = String(input).trim().toLowerCase().split(/[-_]/)[0];
  return (LANGS.find((l) => l.code === code)?.code as Lang | undefined) ?? null;
}

/** O cofre do telemóvel (expo-secure-store, que tem leitura síncrona). Fora da app não existe. */
function secureStore(): { getItem(k: string): string | null; setItem(k: string, v: string): void } | null {
  if (isWeb || !hasRequire) return null;
  try {
    return require('expo-secure-store');
  } catch {
    return null;
  }
}

function readSaved(): string | null {
  try {
    if (isWeb) return globalThis.localStorage?.getItem(KEY) ?? null;
    return secureStore()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

function writeSaved(lang: Lang) {
  try {
    if (isWeb) globalThis.localStorage?.setItem(KEY, lang);
    else secureStore()?.setItem(KEY, lang);
  } catch {
    /* sem armazenamento: só vale até fechar a app */
  }
}

/** Os idiomas do sistema por ordem de preferência (o browser na web; o telemóvel com o expo-localization). */
function systemLanguages(): string[] {
  try {
    if (isWeb) return [...(navigator.languages ?? []), navigator.language].filter(Boolean);
    if (!hasRequire) return [];
    const loc = require('expo-localization') as { getLocales(): { languageTag: string; languageCode: string | null }[] };
    return loc.getLocales().map((l) => l.languageTag || l.languageCode || '').filter(Boolean);
  } catch {
    return [];
  }
}

/** O idioma com que a app arranca: o escolhido neste aparelho, senão o primeiro do sistema que exista na lista, senão pt. */
export function resolveLanguage(saved: string | null, system: string[]): Lang {
  const mine = matchLang(saved);
  if (mine) return mine;
  for (const s of system) {
    const hit = matchLang(s);
    if (hit) return hit;
  }
  return SOURCE_LANG;
}

let active: Lang = resolveLanguage(readSaved(), systemLanguages());

const i18n = i18next.createInstance();

function resourcesFor(lang: Lang) {
  if (lang === SOURCE_LANG || !hasRequire) return {};
  try {
    const cat = loadCatalog(lang);
    return cat ? { [lang]: { translation: cat } } : {};
  } catch {
    return {};
  }
}

void i18n.init({
  lng: localeOf(active),
  resources: resourcesFor(active),
  fallbackLng: false,
  keySeparator: false,
  nsSeparator: false,
  returnNull: false,
  returnEmptyString: false,
  initAsync: false,
  showSupportNotice: false,
  interpolation: { prefix: '{', suffix: '}', escapeValue: false },
});
if (isWeb) document.documentElement.lang = localeOf(active);

/** O código BCP 47 do idioma (para o Intl, o `lang` da página e o Accept-Language), por exemplo «pt-MZ». */
export function localeOf(lang: Lang = active): string {
  return LANGS.find((l) => l.code === lang)?.locale ?? lang;
}

/**
 * O locale para `toLocaleString`/`Intl` nos números e datas dos ecrãs: em português o de sempre («pt-PT», que dá o mesmo
 * texto que a app sempre mostrou), nos outros idiomas o do idioma («en-GB»…).
 */
export function intlLocale(lang: Lang = active): string {
  return lang === SOURCE_LANG ? 'pt-PT' : localeOf(lang);
}

/** O idioma ativo («pt», «en»…). */
export function currentLanguage(): Lang {
  return active;
}

/** O nome do idioma no próprio idioma («Português», «English»). */
export function languageName(lang: Lang = active): string {
  return LANGS.find((l) => l.code === lang)?.name ?? lang;
}

/**
 * Traduz uma frase em português (texto literal). `{nome}` troca-se pelo valor em `vars`. Com `count`, escolhe o singular
 * ou o plural (`other`). O que não estiver no catálogo aparece em português: nunca falta texto.
 */
export function t(frase: string, vars?: Vars): string {
  if (!vars) return i18n.t(frase);
  const { other, ...rest } = vars;
  const count = typeof rest.count === 'number' ? rest.count : undefined;
  if (count === undefined) return i18n.t(frase, rest);
  if (active === SOURCE_LANG) {
    // Regra de Moçambique e Portugal: só o 1 é singular (o Intl usa a do Brasil, em que o 0 também é).
    const form = Math.abs(count) === 1 ? frase : (other ?? frase);
    return i18n.t(frase, { ...rest, defaultValue: form });
  }
  return i18n.t(frase, { ...rest, defaultValue_one: frase, defaultValue_other: other ?? frase, defaultValue: other ?? frase });
}

/** Quem quer saber quando o idioma muda no nativo (a raiz da app volta a montar-se com outra `key`). */
const listeners = new Set<(lang: Lang) => void>();
export function onLanguageChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Muda de idioma: guarda neste aparelho e recarrega a app (na web recarrega a página; no nativo troca o catálogo e avisa a
 * raiz, que volta a montar todos os ecrãs). Guardar na conta (`PATCH /users/me { language }`) fica com quem chama.
 */
export function setLanguage(lang: Lang): void {
  const next = matchLang(lang) ?? SOURCE_LANG;
  writeSaved(next);
  if (isWeb) {
    window.location.reload();
    return;
  }
  if (next === active) return;
  const res = resourcesFor(next)[next as string];
  if (res) i18n.addResourceBundle(next, 'translation', res.translation, true, true);
  active = next;
  void i18n.changeLanguage(localeOf(next));
  for (const fn of listeners) fn(next);
}

/** Datas e horas no idioma ativo (Intl.DateTimeFormat). */
export function formatDate(date: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  const d = date instanceof Date ? date : new Date(date);
  try {
    return new Intl.DateTimeFormat(localeOf(), opts).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

/** Números no idioma ativo (Intl.NumberFormat). */
export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(localeOf(), opts).format(n);
  } catch {
    return String(n);
  }
}

const PT_MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const PT_WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const capital = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);

/** Os nomes pelo Intl (UTC, para o dia não mudar com o fuso); null se o Intl não os tiver. */
function intlNames(count: number, at: (i: number) => Date, opts: Intl.DateTimeFormatOptions): string[] | null {
  try {
    const f = new Intl.DateTimeFormat(localeOf(), { ...opts, timeZone: 'UTC' });
    return Array.from({ length: count }, (_, i) => f.format(at(i)));
  } catch {
    return null;
  }
}

/**
 * Os nomes dos meses (0 = janeiro) no idioma ativo. Em português são os da casa: «novembro», e curtos «nov» (sem ponto);
 * nos outros idiomas vêm do Intl («November», «Nov»). `capital` põe a primeira letra em maiúscula.
 */
export function monthNames(width: 'long' | 'short' = 'long', opts: { capital?: boolean } = {}): string[] {
  const pt = width === 'long' ? PT_MONTHS : PT_MONTHS.map((m) => m.slice(0, 3));
  const names = active === SOURCE_LANG ? pt : intlNames(12, (i) => new Date(Date.UTC(2024, i, 15)), { month: width }) ?? pt;
  return opts.capital ? names.map(capital) : names;
}

/**
 * Os nomes dos dias da semana (0 = domingo, como `Date.getDay()`) no idioma ativo. Em português: «segunda-feira», e
 * curtos «seg» (sem ponto); nos outros idiomas vêm do Intl («Monday», «Mon»). `capital` põe a primeira letra em maiúscula.
 */
export function weekdayNames(width: 'long' | 'short' = 'short', opts: { capital?: boolean } = {}): string[] {
  const pt = width === 'long' ? PT_WEEKDAYS : PT_WEEKDAYS.map((d) => d.slice(0, 3));
  // 7 de janeiro de 2024 foi um domingo.
  const names = active === SOURCE_LANG ? pt : intlNames(7, (i) => new Date(Date.UTC(2024, 0, 7 + i)), { weekday: width }) ?? pt;
  return opts.capital ? names.map(capital) : names;
}

/** As iniciais dos dias nos calendários, de segunda a domingo: «S T Q Q S S D» em português, o Intl nos outros. */
export function weekInitials(): string[] {
  const pt = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
  // 8 de janeiro de 2024 foi uma segunda-feira.
  return active === SOURCE_LANG ? pt : intlNames(7, (i) => new Date(Date.UTC(2024, 0, 8 + i)), { weekday: 'narrow' }) ?? pt;
}

/** Abreviatura com ponto só em português («seg.», «nov.»); nos outros idiomas fica como o Intl a dá. */
export const abbr = (s: string) => (active === SOURCE_LANG ? `${s}.` : s);
