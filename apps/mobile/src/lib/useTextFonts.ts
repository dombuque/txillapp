import { useEffect, useState } from 'react';
import type { TextStyle } from 'react-native';
import { loadTextFont, textFontReady, textFontStyle } from './textFonts';

/**
 * Pede as fontes `ids` (só as que faltam) e volta a desenhar quando chegam. Devolve quantas já chegaram desde que montou
 * (serve só para mudar o desenho; para o estilo, `useTextFontStyle`).
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

/**
 * O estilo de uma letra (null enquanto não carregou, ou sem `id`), e volta a desenhar quando ela chega. É isto que se usa
 * no desenho, e nunca `textFontStyle` direto: com o React Compiler, uma leitura de fora do React (o conjunto das fontes
 * já carregadas) fica guardada com o primeiro valor, e o texto ficava para sempre na letra do sistema (no visor dos mimos,
 * na fila das letras…). Aqui o «já carregou» é estado do React, por isso o estilo calcula-se outra vez quando muda.
 */
export function useTextFontStyle(id: string | null | undefined): TextStyle | null {
  const [ready, setReady] = useState(() => !!id && textFontReady(id));
  useEffect(() => {
    let alive = true;
    if (!id) setReady(false);
    else if (textFontReady(id)) setReady(true);
    else {
      setReady(false);
      void loadTextFont(id).then((ok) => { if (alive) setReady(ok); });
    }
    return () => { alive = false; };
  }, [id]);
  return id && ready ? textFontStyle(id) : null;
}
