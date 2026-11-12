import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useDesktop } from './desktop';
import { composerKey, type KeyLike } from './deskChatKeys';
import { colors } from './theme';

/**
 * Mensagens no computador: o browser largo (useDesktop) E um rato (`(hover: hover) and (pointer: fine)`). Num iPad deitado
 * (largo, mas de toque) e no telemóvel fica tudo como no telemóvel: deslizar, segurar, folhas de baixo.
 */
const FINE = '(hover: hover) and (pointer: fine)';

export function finePointer(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && !!window.matchMedia?.(FINE).matches;
}

export function useDeskChat(): boolean {
  const desktop = useDesktop();
  const [fine, setFine] = useState(finePointer);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(FINE);
    const on = () => setFine(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return desktop && fine;
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** O foco está numa caixa de texto (aí "?" é um "?" escrito, não a ajuda). */
export function typingNow(): boolean {
  if (typeof document === 'undefined') return false;
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
}

/**
 * O que as Mensagens no computador põem na página uma vez: o foco visível de quem usa o teclado (só dentro das zonas
 * marcadas com `dataSet={{ deskchat: '1' }}`, para não mexer no resto da app) e os tooltips (`title`) dos botões só com
 * ícone: o react-native-web não passa `title`, por isso copia-se o `aria-label` para o `title` quando o botão não tem texto.
 */
let chromeOn = 0;
let undo: (() => void) | null = null;
const CSS = `
[data-deskchat] [role="button"]:focus-visible, [data-deskchat] [role="link"]:focus-visible, [data-deskchat] [role="tab"]:focus-visible,
[data-deskchat] [role="menuitem"]:focus-visible, [data-deskchat] [role="switch"]:focus-visible, [data-deskchat] [role="imagebutton"]:focus-visible {
  outline: 2px solid ${colors.brand}; outline-offset: 2px;
}
[data-deskchat] [role="menuitem"]:focus-visible { outline-offset: -2px; }
`;
const SEL = '[role="button"],[role="link"],[role="menuitem"],[role="switch"],[role="tab"],[role="imagebutton"]';

function titles(root: ParentNode) {
  root.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
    if (!el.closest('[data-deskchat]')) return;
    const label = el.getAttribute('aria-label');
    if (!label || (el.textContent ?? '').trim()) return;
    if (el.title !== label) el.title = label;
  });
}

function install() {
  const style = document.createElement('style');
  style.setAttribute('data-deskchat-css', '');
  style.textContent = CSS;
  document.head.appendChild(style);
  let queued = false;
  const run = () => { queued = false; titles(document); };
  const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });
  run();
  return () => { mo.disconnect(); style.remove(); };
}

export function useDeskChatChrome(on: boolean) {
  useEffect(() => {
    if (!on || Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (chromeOn++ === 0) undo = install();
    return () => { if (--chromeOn === 0) { undo?.(); undo = null; } };
  }, [on]);
}

/** A marca das zonas das Mensagens no computador (foco visível e tooltips). */
export const DESK_CHAT = { deskchat: '1' } as const;

/**
 * Arrastar ficheiros para a conversa: a conversa (components/ChatScreen) mostra a zona de largar e entrega o que se largou
 * à caixa de escrever que estiver lá (ChatComposer ou GroupComposer), que faz o mesmo que ao colar uma imagem.
 */
export type DropHandler = (e: Event, dt: DataTransfer | null) => void;
export const ChatDropCtx = createContext<{ set: (fn: DropHandler | null) => void } | null>(null);

export function useChatDrop(handler: DropHandler) {
  const ctx = useContext(ChatDropCtx);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!ctx) return;
    const fn: DropHandler = (e, dt) => ref.current(e, dt);
    ctx.set(fn);
    return () => ctx.set(null);
  }, [ctx]);
}

/** Onde abrir um menu a partir de um botão (por baixo dele) ou de um clique (no ponteiro). */
export function anchorOf(e: unknown): { x: number; y: number } {
  const ev = e as { currentTarget?: Element | null; target?: Element | null; nativeEvent?: { clientX?: number; clientY?: number } };
  const el = (ev.currentTarget && typeof (ev.currentTarget as Element).getBoundingClientRect === 'function' ? ev.currentTarget : (ev.target as Element | null)?.closest?.('[role="button"]')) as Element | null;
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width || r.height) return { x: Math.round(r.left), y: Math.round(r.bottom + 4) };
  }
  return { x: ev.nativeEvent?.clientX ?? 0, y: ev.nativeEvent?.clientY ?? 0 };
}

/**
 * As teclas da caixa de escrever no computador (lib/deskChatKeys, composerKey): Enter envia, Shift+Enter muda de linha,
 * Esc cancela (devolve true se fechou alguma coisa) e ↑ com a caixa vazia edita a minha última mensagem. No telemóvel
 * devolve undefined: lá o Enter do teclado muda de linha, como sempre.
 */
export function useComposerKeys(o: { text: string; send: () => void; cancel: () => boolean; editLast?: () => void }) {
  const desk = useDeskChat();
  const ref = useRef(o);
  ref.current = o;
  if (!desk) return undefined;
  return (e: { preventDefault(): void; nativeEvent: unknown }) => {
    const n = e.nativeEvent as KeyLike;
    const k = composerKey(n, { text: ref.current.text, canEditLast: !!ref.current.editLast });
    if (k === 'send') { e.preventDefault(); ref.current.send(); }
    else if (k === 'cancel') { if (ref.current.cancel()) e.preventDefault(); }
    else if (k === 'edit-last') { e.preventDefault(); ref.current.editLast?.(); }
  };
}

/** As props que marcam uma zona das Mensagens no computador (`data-deskchat`): espalhar com `{...deskZone(desk)}`. */
export const deskZone = (on: boolean): object => (on ? { dataSet: DESK_CHAT } : {});
