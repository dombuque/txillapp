import { useSyncExternalStore } from 'react';
import type { IconName } from '../components/Icon';
import { tr } from './i18n';

/**
 * Novidades que as pessoas ainda não descobriram. Cada função nova entra aqui; enquanto alguém não a usar
 * (ou a dispensar), aparece um "Novo" no botão dela e um cartão no feed. Guarda-se neste aparelho.
 * Para anunciar uma função: acrescenta uma linha a FEATURES e chama `markSeen(id)` onde ela é usada.
 */
export interface Feature {
  id: string;
  icon: IconName;
  title: string;
  text: string;
  /** Para onde vai ao tocar no cartão. */
  path: string;
}

export const FEATURES: Feature[] = [
  { id: 'zas', icon: 'bolt', title: tr('Zás!'), text: tr('Fotos na hora que duram 24 h e só se veem uma vez. Está no canto das mensagens.'), path: '/messages' },
  { id: 'reacoes', icon: 'heart', title: tr('Reage e responde nas mensagens'), text: tr('Segura numa mensagem para reagir ou responder.'), path: '/messages' },
  { id: 'stickers', icon: 'sticker', title: tr('Mais de 550 stickers'), text: tr('Desenhos novos e mais engraçados para as conversas.'), path: '/messages' },
  { id: 'video-longo', icon: 'video', title: tr('Grava vídeo com o dedo'), text: tr('Na câmara, segura o botão para gravar e larga para parar.'), path: '/new' },
];

const KEY = 'tx_seen_features';
const EVENT = 'tx-features';

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// O snapshot tem de ser estável entre leituras iguais.
let cache = '';
let cached: string[] = [];
function snapshot() {
  const raw = (() => {
    try {
      return localStorage.getItem(KEY) ?? '[]';
    } catch {
      return '[]';
    }
  })();
  if (raw !== cache) {
    cache = raw;
    cached = read();
  }
  return cached;
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Já descobriu / usou esta função. */
export function markSeen(...ids: string[]) {
  const now = read();
  const next = [...new Set([...now, ...ids])];
  if (next.length === now.length) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* sem armazenamento: o aviso volta a aparecer, nada de grave */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Funções novas que esta pessoa ainda não descobriu. */
export function useUnseenFeatures(): Feature[] {
  const seen = useSyncExternalStore(subscribe, snapshot, () => []);
  return FEATURES.filter((f) => !seen.includes(f.id));
}

export const useIsNew = (id: string) => useUnseenFeatures().some((f) => f.id === id);
