import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

type Box = { top: number; height: number };

const read = (): Box | null => {
  const v = Platform.OS === 'web' && typeof window !== 'undefined' ? window.visualViewport : null;
  return v ? { top: v.offsetTop, height: v.height } : null;
};

/**
 * A parte do ecrã que está mesmo visível (só na web). No iPhone (Safari) o teclado não encolhe a página: tapa-a.
 * Com isto o ecrã ajusta-se à zona visível e a legenda que escreves fica sempre à vista. No nativo devolve null.
 */
export function useVisibleViewport(): Box | null {
  const [box, setBox] = useState<Box | null>(read);
  useEffect(() => {
    const v = Platform.OS === 'web' && typeof window !== 'undefined' ? window.visualViewport : null;
    if (!v) return;
    const on = () => setBox(read());
    on();
    v.addEventListener('resize', on);
    v.addEventListener('scroll', on);
    return () => {
      v.removeEventListener('resize', on);
      v.removeEventListener('scroll', on);
    };
  }, []);
  return box;
}
