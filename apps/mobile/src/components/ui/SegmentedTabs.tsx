import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, dark as D } from '@/lib/theme';

export type SegmentedTab<T extends string> = { value: T; label: string; /** Número ao lado do texto (ex.: pedidos por ver). */ count?: number };

/**
 * Separadores para 2 a 4 vistas no mesmo ecrã: uma calha cinzenta com a vista escolhida numa pílula escura.
 * (As listas principais com deslizar, como as Mensagens, usam o TabSlider, com o traço por baixo.)
 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, dark = false, style }: { tabs: SegmentedTab<T>[]; value: T; onChange: (v: T) => void; dark?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[st.track, dark && { backgroundColor: D.raised }, style]} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.value === value;
        const fg = on ? (dark ? colors.zinc900 : '#ffffff') : dark ? D.sub : colors.zinc600;
        return (
          <Pressable
            key={t.value}
            onPress={() => onChange(t.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.count ? `${t.label}, ${t.count}` : t.label}
            style={({ pressed }) => [st.tab, on && { backgroundColor: dark ? '#ffffff' : colors.zinc900 }, pressed && !on && { opacity: 0.7 }]}
          >
            <Text style={[st.text, { color: fg }]} numberOfLines={1}>{t.label}</Text>
            {t.count ? <Text style={[st.count, { color: on ? fg : colors.brand }]}>{t.count > 99 ? '99+' : t.count}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  track: { flexDirection: 'row', backgroundColor: colors.zinc100, borderRadius: 999, padding: 4, gap: 4 },
  tab: { flex: 1, minHeight: 36, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10 },
  text: { fontSize: 14, fontWeight: '700' },
  count: { fontSize: 13, fontWeight: '800' },
});
