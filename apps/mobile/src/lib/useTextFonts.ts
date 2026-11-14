import { useEffect, useState } from 'react';
import { loadTextFont, textFontReady } from './textFonts';

/**
 * Pede as fontes `ids` (só as que faltam) e volta a desenhar quando chegam. Devolve quantas já chegaram desde que montou
 * (serve só para mudar o desenho; o estilo vem de `textFontStyle`).
 */
export function useTextFonts(ids: readonly (string | null | undefined)[]): number {
  const [tick, setTick] = useState(0);
  const key = ids.filter(Boolean).join(',');
  useEffect(() => {
    let alive = true;
    for (const id of key ? key.split(',') : []) {
      if (textFontReady(id)) continue;
      void loadTextFont(id).then((ok) => { if (ok && alive) setTick((t) => t + 1); });
    }
    return () => { alive = false; };
  }, [key]);
  return tick;
}
