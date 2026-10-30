import { useSyncExternalStore } from 'react';

/** Largura a partir da qual a app passa a ter o formato de computador (menu à esquerda, painel à direita). */
export const DESKTOP_QUERY = '(min-width: 1024px)';

const subscribe = (cb: () => void) => {
  const m = window.matchMedia(DESKTOP_QUERY);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};

export const useDesktop = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );

/** A app instalada (PWA) abre direto no login/feed: a página de apresentação é para quem chega pelo navegador. */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
