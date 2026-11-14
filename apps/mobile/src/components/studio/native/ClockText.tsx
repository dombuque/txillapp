/**
 * O tempo da pré-visualização nos sítios pequenos (o relógio «0:07 / 0:20», a barra do tempo, o tempo do cursor e o painel
 * do som). Cada um ouve o relógio sozinho e só se volta a desenhar quando o que mostra muda: antes o estúdio inteiro (e a
 * linha do tempo inteira) voltava a desenhar-se 4 a 20 vezes por segundo só para mudar estes números, e esse trabalho no
 * JS atrasava o relógio e via-se como soluços na imagem.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { ClockStore } from './clockStore';

/** Um valor tirado do tempo do relógio (`pick`), que só muda o estado quando muda de facto. */
export function useClockValue<T>(clock: ClockStore, pick: (t: number) => T): T {
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const [v, setV] = useState(() => pick(clock.time()));
  const last = useRef(v);
  useEffect(() => clock.subscribe((t) => { const n = pickRef.current(t); if (!Object.is(last.current, n)) { last.current = n; setV(n); } }), [clock]);
  return v;
}

export function ClockText({ clock, format, style, numberOfLines = 1 }: { clock: ClockStore; format: (t: number) => string; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const text = useClockValue(clock, format);
  return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;
}

/** A parte cheia da barra do tempo (em %, aos quartos de segundo). */
export function ClockFill({ clock, total, style }: { clock: ClockStore; total: number; style?: StyleProp<ViewStyle> }) {
  const q = useClockValue(clock, (t) => Math.round(t * 4) / 4);
  return <View style={[style, { width: `${total ? Math.min(100, (q / total) * 100) : 0}%` }]} />;
}

/** O tempo (aos `step` segundos) para um painel que precisa dele: só o painel se volta a desenhar. */
export function WithClockTime({ clock, step, children }: { clock: ClockStore; step: number; children: (t: number) => ReactNode }) {
  const t = useClockValue(clock, (x) => Math.round(x / step) * step);
  return <>{children(t)}</>;
}
