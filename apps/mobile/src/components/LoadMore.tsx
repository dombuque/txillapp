import { useEffect, useRef, type ComponentRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { colors } from '@/lib/theme';
import { t } from '@/lib/i18n';

/**
 * O fim de uma lista que continua (feed): na web, pede a página seguinte quando este bocado entra no ecrã (um
 * IntersectionObserver do browser, que funciona seja qual for o elemento que desliza). No PWA do iPhone o
 * `onEndReached` da FlatList muitas vezes não dispara e a lista ficava pelas primeiras publicações. Há também um botão,
 * para o caso de nada disparar. No telemóvel nativo o `onEndReached` chega; aqui só fica o botão, discreto.
 *
 * Fica sempre montado enquanto houver mais (a carregar mostra a roda no mesmo sítio): se desmontasse a cada página, o
 * observador novo dizia logo «está no ecrã» e pedia todas as páginas de seguida. Só pede quando *entra* no ecrã, e no
 * máximo uma vez a cada 1,5 s.
 */
export function LoadMore({ onLoad, loading, label = t('Ver mais publicações') }: { onLoad: () => void; loading: boolean; label?: string }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const load = useRef(onLoad);
  const last = useRef(0);
  useEffect(() => {
    load.current = onLoad;
  }, [onLoad]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof IntersectionObserver === 'undefined') return;
    const el = ref.current as unknown as Element | null;
    if (!el || typeof (el as Element).getBoundingClientRect !== 'function') return;
    let inside = false;
    // Começa a pedir um pouco antes de chegar ao fim (400 px), para não se ver a espera.
    const io = new IntersectionObserver((entries) => {
      const now = entries.some((e) => e.isIntersecting);
      if (now && !inside && Date.now() - last.current > 1500) {
        last.current = Date.now();
        load.current();
      }
      inside = now;
    }, { rootMargin: '0px 0px 400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <View ref={ref} style={s.wrap}>
      {loading ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <Pressable onPress={() => load.current()} style={(st) => [s.btn, st.pressed && { opacity: 0.6 }]} accessibilityRole="button">
          <Text style={s.text}>{label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', minHeight: 56, paddingTop: 4, paddingBottom: 24 },
  btn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.zinc100 },
  text: { fontSize: 14, fontWeight: '600', color: colors.zinc700 },
});
