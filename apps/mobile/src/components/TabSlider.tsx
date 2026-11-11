import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, makeMutable, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { colors } from '@/lib/theme';

/** A mesma curva de abrir/fechar as linhas (SwipeRow): curta e decidida. */
const SLIDE = { duration: 220, easing: Easing.bezier(0.2, 0.8, 0.2, 1) };
/** O fade com que o conteúdo novo entra ao mudar de separador. */
const FADE_MS = 180;

/**
 * O traço por baixo do separador ativo, que desliza de um separador para o outro (em vez de saltar).
 * Cada separador mede-se com `layout(chave)` no onLayout; os que estão dentro de uma caixa (uma View no meio) dizem o
 * nome da caixa, e a caixa mede-se com `box(nome)` (o x do separador conta a partir dela). `bar` vai dentro da View que
 * tem os separadores, por último. `active = null` esconde o traço (ex.: a pesquisar, com "Resultados").
 * `barStyle` acerta o traço a cada ecrã (no Perfil é o de 2 px colado à linha de baixo, da largura do separador).
 */
export function useTabSlider<K extends string>(active: K | null, barStyle?: StyleProp<ViewStyle>) {
  const spots = useRef<Partial<Record<K, { x: number; w: number; box?: string }>>>({});
  const boxes = useRef<Record<string, number>>({});
  const activeRef = useRef(active);
  activeRef.current = active;
  const placed = useRef(false);
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const shown = useSharedValue(0);

  const place = (animate: boolean) => {
    const k = activeRef.current;
    const s = k ? spots.current[k] : undefined;
    if (!s) {
      shown.value = 0;
      placed.current = false;
      return;
    }
    const to = s.x + (s.box ? boxes.current[s.box] ?? 0 : 0);
    if (animate && placed.current) {
      x.value = withTiming(to, SLIDE);
      w.value = withTiming(s.w, SLIDE);
    } else {
      x.value = to;
      w.value = s.w;
    }
    shown.value = 1;
    placed.current = true;
  };
  useEffect(() => place(true), [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const layout = (k: K, box?: string) => (e: LayoutChangeEvent) => {
    const { x: lx, width } = e.nativeEvent.layout;
    spots.current[k] = { x: lx, w: width, box };
    // Só o separador ativo mexe no traço (um vizinho a medir-se não corta a animação a meio).
    if (k === activeRef.current || !placed.current) place(false);
  };
  const box = (name: string) => (e: LayoutChangeEvent) => {
    boxes.current[name] = e.nativeEvent.layout.x;
    place(false);
  };

  const style = useAnimatedStyle(() => ({ opacity: shown.value, width: w.value, transform: [{ translateX: x.value }] }));
  const bar = <Animated.View pointerEvents="none" style={[st.bar, barStyle, style]} />;
  return { layout, box, bar };
}

/** A opacidade das linhas da lista: ao mudar de separador as linhas novas entram com um fade rápido. */
const cellFade = makeMutable(1);

/** Chamar ao mudar de separador (antes de mudar o estado): as linhas que aparecem entram a partir de transparente. */
export function fadeCellsIn() {
  cellFade.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: FADE_MS }));
}

/**
 * O mesmo fade de `fadeCellsIn`, mas só para um bloco (ex.: a grelha do Perfil, que não é uma FlatList): `style` vai numa
 * Animated.View à volta do conteúdo e `fadeIn()` chama-se ao mudar de separador (antes de mudar o estado).
 */
export function useFadeIn() {
  const o = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  const fadeIn = useCallback(() => {
    o.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: FADE_MS }));
  }, [o]);
  return { style, fadeIn };
}

/**
 * Para o CellRendererComponent da FlatList: cada linha numa Animated.View com a opacidade de `fadeCellsIn`
 * (o cabeçalho da lista, com os separadores, não é uma célula e não pisca).
 */
export function FadeCell({ style, onLayout, children }: { style?: StyleProp<ViewStyle>; onLayout?: (e: LayoutChangeEvent) => void; children?: ReactNode }) {
  const a = useAnimatedStyle(() => ({ opacity: cellFade.value }));
  return <Animated.View style={[style, a]} onLayout={onLayout}>{children}</Animated.View>;
}

const st = StyleSheet.create({
  // O mesmo traço que cada separador tinha (3 px, 2 px acima do fundo), agora um só que desliza.
  bar: { position: 'absolute', left: 0, bottom: 2, height: 3, borderRadius: 2, backgroundColor: colors.zinc900 },
});
