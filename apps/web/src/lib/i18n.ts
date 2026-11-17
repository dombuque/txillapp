import i18next from 'i18next';
import { LANGS as SHARED_LANGS } from '@txillapp/shared';

/**
 * Traduções do site e do backoffice (docs/idiomas.md). O português de Moçambique é a língua-base (os textos do código); os
 * outros idiomas vêm dos catálogos gerados em src/locales/<idioma>.json por `node scripts/i18n/translate.mjs` (nunca à
 * mão). O que não estiver no catálogo aparece em português (nunca falta texto). Mudar de idioma recarrega a página, por
 * isso `t` é uma função simples.
 *
 *   tr('Guardar')   tr('Olá, {nome}.', { nome })   tr('{count} gosto', { count: n, other: '{count} gostos' })
 *   tk('Texto')     só marca a frase para a extração (tabelas que depois passam por `tr(valor)`)
 */
export type Lang = 'pt-MZ' | (string & {});

/** Os idiomas (a lista é a de packages/shared). O português guarda o id antigo, «pt-MZ». */
export const LANGS: { id: Lang; code: string; label: string; native: string; locale: string }[] = SHARED_LANGS.map((l) => ({
  id: l.code === 'pt' ? 'pt-MZ' : l.code,
  code: l.code,
  label: l.code === 'pt' ? 'Português (Moçambique)' : l.name,
  native: l.name,
  locale: l.locale,
}));

const KEY = 'txill_lang';

/** Os catálogos gerados (um por idioma, menos o português). */
const CATALOGS = Object.fromEntries(
  Object.entries(import.meta.glob<Record<string, string>>('../locales/*.json', { eager: true, import: 'default' })).map(([file, cat]) => [file.replace(/^.*\/(.+)\.json$/, '$1'), cat]),
);

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    const hit = LANGS.find((l) => l.id === saved || l.code === saved);
    if (hit) return hit.id;
    // Sem escolha guardada fica em português: o inglês só entra se a pessoa o escolher (não misturamos idiomas).
  } catch {
    /* sem armazenamento: usa a base */
  }
  return 'pt-MZ';
}

export const lang: Lang = detect();
const active = LANGS.find((l) => l.id === lang) ?? LANGS[0];
const SOURCE = active.code === 'pt';

/** Locale para datas e números (por exemplo, toLocaleDateString). O português usa as regras de Portugal, como antes. */
export const locale = active.code === 'en' ? 'en-GB' : SOURCE ? 'pt-PT' : active.locale;

if (typeof document !== 'undefined') document.documentElement.lang = SOURCE ? 'pt-MZ' : active.locale;

const i18n = i18next.createInstance();
void i18n.init({
  lng: active.locale,
  resources: CATALOGS[active.code] ? { [active.code]: { translation: CATALOGS[active.code] } } : {},
  fallbackLng: false,
  keySeparator: false,
  nsSeparator: false,
  returnNull: false,
  returnEmptyString: false,
  initAsync: false,
  showSupportNotice: false,
  interpolation: { prefix: '{', suffix: '}', escapeValue: false },
});

/** Muda de idioma e recarrega (tudo passa a ser desenhado no novo idioma). */
export function setLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* sem armazenamento: só vale agora */
  }
  window.location.reload();
}

export type Vars = Record<string, string | number | null | undefined> & { count?: number; other?: string };

/** Traduz um texto em português. Aceita {variáveis}: t('Tens {n} gostos', { n: 3 }); plural com `count` e `other`. */
export function t(pt: string, vars?: Vars): string {
  if (!vars) return i18n.t(pt);
  const { other, ...rest } = vars;
  if (typeof rest.count !== 'number') return i18n.t(pt, rest);
  if (SOURCE) return i18n.t(pt, { ...rest, defaultValue: Math.abs(rest.count) === 1 ? pt : (other ?? pt) });
  return i18n.t(pt, { ...rest, defaultValue_one: pt, defaultValue_other: other ?? pt, defaultValue: other ?? pt });
}

/** Só marca uma frase para a extração (scripts/i18n/extract.mjs) e devolve-a igual: para tabelas que depois passam por `tr(valor)`. */
export const tk = <S extends string>(pt: S): S => pt;

/** Mesmo que `t`, com um nome que não se confunde com variáveis locais (por exemplo, `t` de um toque). */
export const tr = t;

/** O código do idioma para o cabeçalho Accept-Language («pt», «en»). */
export const langCode = active.code;
