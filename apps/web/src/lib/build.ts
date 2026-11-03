/**
 * Versão para as lojas de aplicações (App Store / Play Store): construir com VITE_STORE_BUILD=1.
 * Esconde tudo o que é "em breve" (a Apple recusa botões que não fazem nada).
 */
export const STORE_BUILD = import.meta.env.VITE_STORE_BUILD === '1';
