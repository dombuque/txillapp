import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Um `View` que ocupa o resto do ecrã, com altura em píxeis na web. No Safari do iPhone uma cadeia de `flex: 1` com
 * irmãos (cabeçalho, pesquisa, separadores) resolve-se muitas vezes como a altura do conteúdo, e a lista lá dentro
 * fica sem nada para rolar. Aqui mede-se onde o `View` começa no ecrã e dá-se-lhe `altura da janela − topo`
 * (a altura da janela na web é a zona visível: encolhe com o teclado). No nativo é só `flex: 1`.
 */
/** Espaço (px) que fica por baixo do FillView e não é dele: nos separadores, a barra de baixo. */
export const FillReserve = createContext(0);

export function FillView({ children, style, min = 160 }: { children: ReactNode; style?: StyleProp<ViewStyle>; min?: number }) {
  const { height: winH, width: winW } = useWindowDimensions();
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const [top, setTop] = useState<number | null>(null);
  const measure = useCallback(() => {
    if (Platform.OS !== 'web') return;
    ref.current?.measureInWindow((_x: number, y: number) => { if (Number.isFinite(y)) setTop(Math.max(0, Math.round(y))); });
  }, []);
  const reserve = useContext(FillReserve);
  const h = Platform.OS === 'web' && top !== null ? Math.max(min, winH - top - reserve) : null;
  // Re-mede quando o tamanho da janela muda (rodar, teclado, barra do Safari), sem remontar o que está dentro.
  useEffect(() => { const t = setTimeout(measure, 50); return () => clearTimeout(t); }, [winW, winH, measure]);
  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={[h !== null ? { height: h, flexGrow: 0, flexShrink: 0 } : { flex: 1 }, style]}>
      {children}
    </View>
  );
}
