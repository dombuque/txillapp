import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/** `width` e `scale`: para distinguir o teclado (só baixa a altura) de a página estar encolhida ou ampliada (muda tudo). */
type Box = { top: number; height: number; width: number; scale: number };

const read = (): Box | null => {
  const v = Platform.OS === 'web' && typeof window !== 'undefined' ? window.visualViewport : null;
  return v ? { top: v.offsetTop, height: v.height, width: v.width, scale: v.scale } : null;
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
