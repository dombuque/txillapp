import { useEffect, useState, type CSSProperties } from 'react';

interface Box {
  top: number;
  height: number;
}

const read = (): Box | null => {
  const v = typeof window !== 'undefined' ? window.visualViewport : null;
  return v ? { top: v.offsetTop, height: v.height } : null;
};

/**
 * A parte do ecrã que está mesmo visível. No iPhone (Safari) o teclado não encolhe a página:
 * tapa-a. Com isto, folhas e conversas ajustam-se à zona visível e o que escreves fica sempre à vista.
 */
export function useVisualViewport(): Box | null {
  const [box, setBox] = useState<Box | null>(read);
  useEffect(() => {
    const v = window.visualViewport;
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

/** Estilo para um contentor `fixed` ocupar só a zona visível (sem teclado por cima). */
export function visibleStyle(box: Box | null): CSSProperties | undefined {
  return box ? { top: box.top, height: box.height, bottom: 'auto' } : undefined;
}
