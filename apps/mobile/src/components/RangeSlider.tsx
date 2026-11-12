import { useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, Text, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { clampRadius, fractionOf, valueAt } from '@/lib/radius';
import { colors } from '@/lib/theme';

const THUMB = 28;
/** A zona de toque tem 48 de altura (o desenho é uma faixa de 6 e um botão de 28). */
const HIT = 48;

/**
 * Barra deslizante feita à mão (PanResponder, sem bibliotecas nativas: o APK faz-se sem prebuild). Funciona com o dedo
 * (Android, PWA do iPhone) e com o rato e as setas do teclado (web).
 * - `onChange` vai a cada passo enquanto se arrasta (ex.: o círculo do mapa); `onCommit` ao largar (ex.: o pedido à API).
 * - Agarra o gesto e não o larga: nem a folha (puxar para baixo) nem o scroll lho tiram a meio.
 * - Para o leitor de ecrã é "ajustável", com aumentar e diminuir de um passo.
 */
export function RangeSlider({
  value, min, max, step = 1, marks = [], onChange, onCommit, label, format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Marcas discretas na faixa (ex.: 5, 10, 20 e 30 km). */
  marks?: readonly number[];
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  /** Nome para o leitor de ecrã (ex.: "Distância"). */
  label: string;
  /** O valor em texto (ex.: "12 km"). */
  format: (v: number) => string;
}) {
  const [w, setW] = useState(0);
  const [active, setActive] = useState(false);
  const width = useRef(0);
  const start = useRef(0);
  const last = useRef(value);
  last.current = value;
  const cfg = useRef({ min, max, step, onChange, onCommit });
  cfg.current = { min, max, step, onChange, onCommit };

  const emit = (v: number) => {
    if (v === last.current) return;
    last.current = v;
    cfg.current.onChange(v);
  };
  const at = (x: number) => valueAt(x - THUMB / 2, width.current - THUMB, cfg.current.min, cfg.current.max, cfg.current.step);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Uma vez agarrado, o gesto é da barra até largar (a folha e o scroll não o roubam).
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        start.current = e.nativeEvent.locationX;
        setActive(true);
        emit(at(start.current));
      },
      onPanResponderMove: (_e, g) => emit(at(start.current + g.dx)),
      onPanResponderRelease: () => {
        setActive(false);
        cfg.current.onCommit?.(last.current);
      },
      onPanResponderTerminate: () => {
        setActive(false);
        cfg.current.onCommit?.(last.current);
      },
    }),
  ).current;

  const nudge = (d: number) => {
    const v = clampRadius(last.current + d * step, min, max, step);
    emit(v);
    onCommit?.(v);
  };
  const onA11y = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') nudge(1);
    else if (e.nativeEvent.actionName === 'decrement') nudge(-1);
  };
  // Web: as setas, Page Up/Down, Home e End, como numa barra do browser.
  const onKeyDown = (e: { key: string; preventDefault: () => void }) => {
    const k = e.key;
    const d = k === 'ArrowRight' || k === 'ArrowUp' ? 1 : k === 'ArrowLeft' || k === 'ArrowDown' ? -1 : k === 'PageUp' ? 5 : k === 'PageDown' ? -5 : 0;
    if (d) { e.preventDefault(); nudge(d); return; }
    if (k === 'Home' || k === 'End') {
      e.preventDefault();
      const v = k === 'Home' ? min : max;
      emit(v);
      onCommit?.(v);
    }
  };

  const onLayout = (e: LayoutChangeEvent) => {
    width.current = e.nativeEvent.layout.width;
    setW(e.nativeEvent.layout.width);
  };
  const usable = Math.max(0, w - THUMB);
  const x = fractionOf(value, min, max) * usable;
  const web = Platform.OS === 'web';

  return (
    <View
      {...pan.panHandlers}
      onLayout={onLayout}
      style={[st.hit, web && ({ touchAction: 'none', cursor: 'pointer', userSelect: 'none' } as object)]}
      accessible
      focusable
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: format(value) }}
      accessibilityActions={[{ name: 'increment', label: 'Aumentar' }, { name: 'decrement', label: 'Diminuir' }]}
      onAccessibilityAction={onA11y}
      {...(web ? ({ onKeyDown, 'aria-valuetext': format(value) } as object) : {})}
    >
      {/* Tudo o que se desenha por dentro deixa passar o toque: a posição do dedo mede-se sempre na barra inteira. */}
      <View pointerEvents="none" style={st.track}>
        <View style={[st.fill, { width: x }]} />
      </View>
      {w > 0
        ? marks.filter((m) => m > min && m < max).map((m) => {
            const mx = THUMB / 2 + fractionOf(m, min, max) * usable;
            return (
              <View key={m} pointerEvents="none" style={[st.mark, { left: mx - 1 }, m <= value && { backgroundColor: 'rgba(255,255,255,0.85)' }]}>
                <Text style={[st.markText, { left: -15 }]} numberOfLines={1}>{m}</Text>
              </View>
            );
          })
        : null}
      {w > 0 ? <View pointerEvents="none" style={[st.thumb, { left: x }, active && st.thumbOn]} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  hit: { height: HIT + 14, justifyContent: 'center', paddingBottom: 14 },
  track: { height: 6, marginHorizontal: THUMB / 2, borderRadius: 3, backgroundColor: colors.zinc200, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.brand },
  mark: { position: 'absolute', top: (HIT - 6) / 2, width: 2, height: 6, borderRadius: 1, backgroundColor: '#a1a1aa' },
  markText: { position: 'absolute', top: 12, width: 32, textAlign: 'center', fontSize: 11, color: colors.zinc500 },
  thumb: { position: 'absolute', top: (HIT - THUMB) / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.brand, boxShadow: '0 1px 4px rgba(0,0,0,0.25)' },
  thumbOn: { transform: [{ scale: 1.15 }] },
});
