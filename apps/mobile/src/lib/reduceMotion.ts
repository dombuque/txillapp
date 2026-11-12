import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

const QUERY = '(prefers-reduced-motion: reduce)';

/** «Reduzir movimento» já ligado (a primeira leitura, sem esperar): na web pela media query; no telemóvel começa a falso. */
function initial(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try { return window.matchMedia(QUERY).matches; } catch { return false; }
}

/**
 * A pessoa pediu para reduzir o movimento? Na web: `prefers-reduced-motion`; no telemóvel:
 * `AccessibilityInfo.isReduceMotionEnabled`. Segue as mudanças enquanto o ecrã está aberto.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(initial);
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      const mq = window.matchMedia(QUERY);
      const on = () => setReduce(mq.matches);
      on();
      mq.addEventListener?.('change', on);
      return () => mq.removeEventListener?.('change', on);
    }
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduce(v); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => setReduce(v));
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduce;
}
