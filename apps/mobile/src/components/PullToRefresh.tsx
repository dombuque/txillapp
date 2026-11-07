import { useRef, useState, type ReactNode } from 'react';
import { Platform, RefreshControl, StyleSheet, View, type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { colors } from '@/lib/theme';
import { FillView } from './FillView';

const TRIGGER = 76;

/**
 * Puxar para atualizar com indicador visível, igual ao do site: uma bolinha coral que cresce ao puxar e, ao soltar, o carregador.
 * Nos telemóveis usa o gesto nativo (RefreshControl); na versão web (onde esse não existe) o gesto é nosso.
 * Uso: `const pull = usePullToRefresh(refetch)`; no FlatList `refreshControl={pull.control}` e `onScroll={pull.onScroll}`;
 * e envolve o conteúdo em `<PullView pull={pull}>`.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown> | void, refreshing = false) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const top = useRef(true);
  const start = useRef<number | null>(null);
  const cur = useRef(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    top.current = e.nativeEvent.contentOffset.y <= 0;
  };

  const web = Platform.OS === 'web';
  const touch = web
    ? {
        onTouchStart: (e: GestureResponderEvent) => {
          start.current = top.current && e.nativeEvent.touches.length === 1 ? e.nativeEvent.touches[0].pageY : null;
        },
        onTouchMove: (e: GestureResponderEvent) => {
          if (start.current === null) return;
          const dy = e.nativeEvent.touches[0].pageY - start.current;
          if (dy <= 0 || !top.current) {
            cur.current = 0;
            return setPull(0);
          }
          cur.current = Math.min(dy * 0.5, 110); // resistência
          setPull(cur.current);
        },
        onTouchEnd: async () => {
          const reached = cur.current >= TRIGGER;
          start.current = null;
          cur.current = 0;
          setPull(0);
          if (!reached) return;
          setBusy(true);
          try {
            await onRefresh();
          } finally {
            setBusy(false);
          }
        },
      }
    : {};

  const control = web ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.brand} colors={[colors.brand]} />;
  return { pull, busy, onScroll, touch, control, web };
}

/** Contentor do conteúdo puxável: desloca-o ao puxar e mostra o indicador por cima. */
export function PullView({ pull, children }: { pull: ReturnType<typeof usePullToRefresh>; children: ReactNode }) {
  const shown = pull.busy ? 48 : pull.pull;
  const ready = pull.pull >= TRIGGER;
  return (
    <View style={{ flex: 1 }} {...pull.touch}>
      {pull.web && (
        <View pointerEvents="none" style={[styles.slot, { opacity: pull.busy || pull.pull > 0 ? 1 : 0 }]}>
          {pull.busy ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <View style={[styles.dot, { opacity: Math.min(pull.pull / 40, 1), transform: [{ scale: 0.4 + Math.min(pull.pull / TRIGGER, 1) * (ready ? 1.3 : 0.9) }] }]} />
          )}
        </View>
      )}
      <FillView style={{ transform: [{ translateY: pull.web ? shown : 0 }] }}>{children}</FillView>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', left: 0, right: 0, top: 0, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.brand },
});
