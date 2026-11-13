/**
 * Os atalhos do teclado do estúdio no computador (testados em tests/studioTimeline.test.mjs): espaço (tocar/pausar),
 * S (dividir no cursor), Delete (apagar o clipe), Ctrl+Z (desfazer), Ctrl+Shift+Z ou Ctrl+Y (refazer), setas (um frame;
 * com Shift, um segundo). Nada acontece a escrever num campo (o texto da tcheka, a pesquisa da música).
 */
export type StudioAction = 'play' | 'split' | 'delete' | 'undo' | 'redo' | 'next-frame' | 'prev-frame' | 'next-second' | 'prev-second';

interface KeyLike { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; target: unknown }

const typing = (t: unknown) => {
  const el = t as { tagName?: string; isContentEditable?: boolean; type?: string } | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? '').toUpperCase();
  return tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !/^(range|checkbox|radio|button)$/i.test(el.type ?? ''));
};

export function studioKey(e: KeyLike): StudioAction | null {
  if (typing(e.target) || e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod) {
    if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (k === 'y') return 'redo';
    return null;
  }
  if (k === ' ' || e.code === 'Space') return 'play';
  if (k === 's') return 'split';
  if (k === 'Delete' || k === 'Backspace') return 'delete';
  if (k === 'ArrowRight') return e.shiftKey ? 'next-second' : 'next-frame';
  if (k === 'ArrowLeft') return e.shiftKey ? 'prev-second' : 'prev-frame';
  return null;
}
