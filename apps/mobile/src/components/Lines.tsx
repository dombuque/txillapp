import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';
import { Icon, type IconName } from './Icon';

/** Uma linha de lista, no mesmo estilo da Ajuda/Sobre do site: ícone redondo, título, valor pequeno e seta. */
export function Line({ icon, label, value, to, href, onPress }: { icon: IconName; label: string; value?: string; to?: string; href?: string; onPress?: () => void }) {
  const router = useRouter();
  const press = to ? () => router.push(to as never) : href ? () => void Linking.openURL(href).catch(() => undefined) : onPress;
  const inner = (
    <>
      <View style={st.icon}><Icon name={icon} size={22} color={colors.zinc800} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.label}>{label}</Text>
        {value ? <Text style={st.value} numberOfLines={1}>{value}</Text> : null}
      </View>
      {press ? <Text style={st.chev}>›</Text> : null}
    </>
  );
  if (!press) return <View style={st.row}>{inner}</View>;
  return <Pressable onPress={press} accessibilityRole="button" style={({ pressed }) => [st.row, pressed && { backgroundColor: '#fafafa' }]}>{inner}</Pressable>;
}

/** Grupo de linhas com título pequeno em maiúsculas e cartão com cantos redondos. */
export function Group({ title, children }: { title?: string; children: ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean) as ReactNode[];
  return (
    <View style={{ marginTop: 20 }}>
      {title ? <Text style={st.title}>{title}</Text> : null}
      <View style={st.card}>
        {items.map((c, i) => (
          <View key={i} style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.zinc100 } : undefined}>{c}</View>
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  value: { fontSize: 14, color: colors.zinc500 },
  chev: { fontSize: 20, color: '#a1a1aa' },
  title: { marginBottom: 6, paddingHorizontal: 20, fontSize: 13, fontWeight: '700', letterSpacing: 0.65, textTransform: 'uppercase', color: colors.zinc500 },
  card: { marginHorizontal: 16, overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200, backgroundColor: colors.white },
});
