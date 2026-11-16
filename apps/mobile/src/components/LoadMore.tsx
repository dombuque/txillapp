import { useEffect, useRef, type ComponentRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';

/**
 * O fim de uma lista que continua (feed): na web, pede a página seguinte quando este bocado entra no ecrã (um
 * IntersectionObserver do browser, que funciona seja qual for o elemento que desliza). No PWA do iPhone o
 * `onEndReached` da FlatList muitas vezes não dispara e a lista ficava pelas primeiras publicações. Há também um botão,
 * para o caso de nada disparar. No telemóvel nativo o `onEndReached` chega; aqui só fica o botão, discreto.
 */
export function LoadMore({ onLoad, label = 'Ver mais publicações' }: { onLoad: () => void; label?: string }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const load = useRef(onLoad);
  useEffect(() => {
    load.current = onLoad;
  }, [onLoad]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof IntersectionObserver === 'undefined') return;
    const el = ref.current as unknown as Element | null;
    if (!el || typeof (el as Element).getBoundingClientRect !== 'function') return;
    // Começa a pedir um pouco antes de chegar ao fim (600 px), para não se ver a espera.
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) load.current();
    }, { rootMargin: '0px 0px 600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <View ref={ref} style={s.wrap}>
      <Pressable onPress={() => load.current()} style={(st) => [s.btn, st.pressed && { opacity: 0.6 }]} accessibilityRole="button">
        <Text style={s.text}>{label}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 4, paddingBottom: 24 },
  btn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.zinc100 },
  text: { fontSize: 14, fontWeight: '600', color: colors.zinc700 },
});
