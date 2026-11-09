import { useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { useAnimatedStyle, interpolate, Extrapolation, type SharedValue } from 'react-native-reanimated';
import { Icon, type IconName } from '@/components/Icon';
import { useDesktop } from '@/lib/desktop';
import { colors } from '@/lib/theme';

export interface SwipeAction {
  label: string;
  icon: IconName;
  /** Cor do fundo do botão (o texto e o ícone são brancos). */
  color: string;
  onPress: () => void;
}

const W = 84;

function ActionButtons({ actions, side, progress }: { actions: SwipeAction[]; side: 'left' | 'right'; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.6, 1], [0, 0.8, 1], Extrapolation.CLAMP) }));
  return (
    <Animated.View style={[{ flexDirection: 'row', width: W * actions.length }, side === 'left' ? { justifyContent: 'flex-start' } : { justifyContent: 'flex-end' }, style]}>
      {actions.map((a) => (
        <Pressable key={a.label} onPress={a.onPress} style={({ pressed }) => [st.action, { backgroundColor: a.color }, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={a.label}>
          <Icon name={a.icon} size={22} color="#fff" />
          <Text style={st.actionText} numberOfLines={1}>{a.label}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

/**
 * Uma linha de lista com ações escondidas, como no WhatsApp:
 * - telemóvel: deslizar para a direita mostra `left`, para a esquerda mostra `right`;
 * - computador: as mesmas ações aparecem como botões pequenos ao passar o rato.
 * Tocar numa ação fecha a linha antes de a correr.
 */
export function SwipeRow({ left = [], right = [], children }: { left?: SwipeAction[]; right?: SwipeAction[]; children: ReactNode }) {
  const desktop = useDesktop();
  const ref = useRef<SwipeableMethods>(null);
  const [hover, setHover] = useState(false);
  const run = (a: SwipeAction) => () => { ref.current?.close(); a.onPress(); };

  if (desktop && Platform.OS === 'web') {
    const all = [...left, ...right];
    return (
      <View
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ position: 'relative' }}
      >
        {children}
        {hover && all.length ? (
          <View style={st.hoverBar}>
            {all.map((a) => (
              <Pressable key={a.label} onPress={a.onPress} style={({ pressed }) => [st.hoverBtn, pressed && { backgroundColor: colors.zinc200 }]} accessibilityRole="button" accessibilityLabel={a.label}>
                <Icon name={a.icon} size={18} color={a.color === colors.red600 ? colors.red600 : colors.zinc800} />
                <Text style={[st.hoverText, a.color === colors.red600 && { color: colors.red600 }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.6}
      leftThreshold={W / 2}
      rightThreshold={W / 2}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={left.length ? (p) => <ActionButtons actions={left.map((a) => ({ ...a, onPress: run(a) }))} side="left" progress={p} /> : undefined}
      renderRightActions={right.length ? (p) => <ActionButtons actions={right.map((a) => ({ ...a, onPress: run(a) }))} side="right" progress={p} /> : undefined}
      childrenContainerStyle={{ backgroundColor: '#fff' }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const st = StyleSheet.create({
  action: { width: W, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  hoverBar: { position: 'absolute', right: 72, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  hoverBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: colors.zinc100, boxShadow: '0 1px 4px rgba(0,0,0,0.12)' } as object,
  hoverText: { fontSize: 13, fontWeight: '600', color: colors.zinc800 },
});
