import { useSyncExternalStore } from 'react';
import type { IconName } from '@/components/Icon';
import { kvGet, kvSet } from './kv';

/**
 * Novidades que as pessoas ainda não descobriram (igual ao site). Cada função nova entra aqui; enquanto alguém não a usar
 * (ou a dispensar), aparece um "Novo" no botão dela e um cartão no Início. Guarda-se neste aparelho.
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
  { id: 'zas', icon: 'bolt', title: 'Zás!', text: 'Fotos na hora que duram 24 h e só se veem uma vez. Está no canto das mensagens.', path: '/messages' },
  { id: 'reacoes', icon: 'heart', title: 'Reage e responde nas mensagens', text: 'Segura numa mensagem para reagir ou responder.', path: '/messages' },
  { id: 'stickers', icon: 'sticker', title: 'Mais de 550 stickers', text: 'Desenhos novos e mais engraçados para as conversas.', path: '/messages' },
  { id: 'video-longo', icon: 'video', title: 'Grava vídeo com o dedo', text: 'Na câmara, segura o botão para gravar e larga para parar.', path: '/new' },
];

const KEY = 'tx_seen_features';
const listeners = new Set<() => void>();
/** `null` até ler o que está guardado (assim o cartão não pisca antes de saber). */
let seen: string[] | null = null;
let loading = false;

function load() {
  if (seen !== null || loading) return;
  loading = true;
  void kvGet(KEY).then((raw) => {
    let v: string[] = [];
    try {
      const p = JSON.parse(raw ?? '[]');
      if (Array.isArray(p)) v = p.filter((x): x is string => typeof x === 'string');
    } catch {
      /* guardado estragado: começa do zero */
    }
    seen = [...new Set([...v, ...(seen ?? [])])];
    loading = false;
    listeners.forEach((l) => l());
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  load();
  return () => void listeners.delete(cb);
}
const snapshot = () => seen;

/** Já descobriu / usou esta função. */
export function markSeen(...ids: string[]) {
  const now = seen ?? [];
  const next = [...new Set([...now, ...ids])];
  if (seen !== null && next.length === now.length) return;
  seen = next;
  void kvSet(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

const NONE: Feature[] = [];
let lastSeen: string[] | null | undefined;
let lastOut: Feature[] = NONE;

/** Funções novas que esta pessoa ainda não descobriu. */
export function useUnseenFeatures(): Feature[] {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (s !== lastSeen) {
    lastSeen = s;
    lastOut = s === null ? NONE : FEATURES.filter((f) => !s.includes(f.id));
  }
  return lastOut;
}

export const useIsNew = (id: string) => {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  return s !== null && !s.includes(id);
};
