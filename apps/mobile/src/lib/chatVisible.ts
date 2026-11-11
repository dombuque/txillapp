import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { canMarkRead } from './chatRead';

function docFocus(): boolean {
  try {
    return typeof document === 'undefined' || document.hasFocus();
  } catch {
    return true;
  }
}

/**
 * Devolve uma função que diz, no momento do pedido, se a conversa está à vista. `onVisible` corre quando volta a ficar
 * à vista (voltar a este ecrã, à app ou à janela): é aí que se pede outra vez para marcar como lidas.
 */
export function useChatVisible(onVisible: () => void): () => boolean {
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const cb = useRef(onVisible);
  cb.current = onVisible;
  const web = Platform.OS === 'web';
  const visible = () => canMarkRead({ focused: focusedRef.current, appState: String(AppState.currentState), web, hasFocus: docFocus() });

  const was = useRef(false);
  useEffect(() => {
    const check = () => {
      const now = visible();
      if (now && !was.current) cb.current();
      was.current = now;
    };
    check();
    const sub = AppState.addEventListener('change', check);
    const w = web && typeof window !== 'undefined' ? window : null;
    w?.addEventListener('focus', check);
    w?.addEventListener('blur', check);
    return () => {
      sub.remove();
      w?.removeEventListener('focus', check);
      w?.removeEventListener('blur', check);
    };
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps
  return visible;
}
