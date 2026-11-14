/**
 * As medidas de exibição (já rodadas) de cada ficheiro do estúdio nativo, aprendidas por quem o abre (a foto reduzida ao
 * palco, o vídeo da Skia, as miniaturas). Servem para o automático do «Encher»/«Inteiro» (lib/studio/fit.ts) no painel do
 * clipe e no caminho antigo dos vídeos, sem voltar a abrir o ficheiro.
 */
import { useEffect, useState } from 'react';

const sizes = new Map<string, { w: number; h: number }>();
const subs = new Set<() => void>();

export function rememberSize(uri: string, w: number, h: number) {
  if (!uri || !(w > 0) || !(h > 0)) return;
  const have = sizes.get(uri);
  if (have && have.w === w && have.h === h) return;
  sizes.set(uri, { w, h });
  if (sizes.size > 200) sizes.delete(sizes.keys().next().value as string);
  for (const f of subs) f();
}
export const mediaSize = (uri: string) => sizes.get(uri) ?? null;

/** Volta a desenhar quando se fica a saber as medidas de mais um ficheiro. */
export function useMediaSizes(): number {
  const [n, setN] = useState(0);
  useEffect(() => { const f = () => setN((x) => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return n;
}
