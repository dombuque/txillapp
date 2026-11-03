import { EN } from './i18n/en';

/**
 * Traduções. O português de Moçambique é a língua-base (os textos do código); cada outro idioma é um dicionário
 * "texto em português → tradução". O que não estiver no dicionário aparece em português (nunca falta texto).
 * Mudar de idioma recarrega a app, por isso `t` pode ser uma função simples.
 */
export type Lang = 'pt-MZ' | 'en';
export const LANGS: { id: Lang; label: string; native: string }[] = [
  { id: 'pt-MZ', label: 'Português (Moçambique)', native: 'Português' },
  { id: 'en', label: 'English', native: 'English' },
];

const KEY = 'txill_lang';
const DICTS: Record<Lang, Record<string, string>> = { 'pt-MZ': {}, en: EN };

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'pt-MZ' || saved === 'en') return saved;
    // Sem escolha guardada fica em português: o inglês só entra se a pessoa o escolher (não misturamos idiomas).
  } catch {
    /* sem armazenamento: usa a base */
  }
  return 'pt-MZ';
}

export const lang: Lang = detect();
if (typeof document !== 'undefined') document.documentElement.lang = lang === 'en' ? 'en' : 'pt-MZ';

/** Locale para datas e números (por exemplo, toLocaleDateString). */
export const locale = lang === 'en' ? 'en-GB' : 'pt-PT';

/** Muda de idioma e recarrega (tudo passa a ser desenhado no novo idioma). */
export function setLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* sem armazenamento: só vale agora */
  }
  window.location.reload();
}

/** Traduz um texto em português. Aceita {variáveis}: t('Tens {n} gostos', { n: 3 }). */
export function t(pt: string, vars?: Record<string, string | number>): string {
  const base = DICTS[lang][pt] ?? pt;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Mesmo que `t`, com um nome que não se confunde com variáveis locais (por exemplo, `t` de um toque). */
export const tr = t;
