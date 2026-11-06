import { Platform, type ViewStyle } from 'react-native';

/** Forma "squircle" dos Zás (cantos muito redondos e lados ligeiramente abaulados), a mesma do site: superelipse de expoente 3.4. */
export const SQ_N = 3.4;
export const sup = (c: number) => Math.sign(c) * Math.abs(c) ** (2 / SQ_N);

const POLY = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 90; i++) {
    const t = (i / 90) * 2 * Math.PI;
    pts.push(`${((0.5 + 0.5 * sup(Math.cos(t))) * 100).toFixed(2)}% ${((0.5 + 0.5 * sup(Math.sin(t))) * 100).toFixed(2)}%`);
  }
  return `polygon(${pts.join(',')})`;
})();

/** Recorte squircle: na web o mesmo clip-path do site; no nativo, cantos grandes e contínuos (sem dependências novas). */
export function squircle(w: number): ViewStyle {
  if (Platform.OS === 'web') return { overflow: 'hidden', clipPath: POLY, WebkitClipPath: POLY } as unknown as ViewStyle;
  return { overflow: 'hidden', borderRadius: Math.round(w * 0.28), borderCurve: 'continuous' } as ViewStyle;
}

/** Pontos do troço da curva onde corre a legenda ('top' sobe pela esquerda e segue pelo topo). */
export function arcPoints(w: number, h: number, arc: 'top' | 'bottom' = 'top', steps = 80) {
  const inset = Math.min(w, h) * 0.1;
  const a = arc === 'top' ? Math.PI + 0.22 : Math.PI - 0.5;
  const b = arc === 'top' ? 2 * Math.PI - 0.3 : 0.45;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = a + ((b - a) * i) / steps;
    pts.push({ x: w / 2 + (w / 2 - inset) * sup(Math.cos(t)), y: h / 2 + (h / 2 - inset) * sup(Math.sin(t)) });
  }
  return pts;
}
