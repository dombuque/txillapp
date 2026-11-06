import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FEATURES, markSeen, useIsNew, useUnseenFeatures } from '@/lib/whatsNew';
import { Icon } from './Icon';

/** Pequeno "Novo" para pôr no canto do botão de uma função nova. Some quando a pessoa a descobre (`markSeen`). */
export function NewBadge({ id }: { id: string }) {
  const isNew = useIsNew(id);
  if (!isNew) return null;
  return (
    <View pointerEvents="none" accessibilityLabel="Novo" style={st.badge}>
      <LinearGradient colors={['#d6334f', '#ff9a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      <Text style={st.badgeText}>NOVO</Text>
    </View>
  );
}

/** Cartão no topo do Início com o que há de novo e ainda não foi descoberto. */
export function WhatsNewCard() {
  const unseen = useUnseenFeatures();
  const router = useRouter();
  if (!unseen.length) return null;
  const shown = unseen.slice(0, 3);
  return (
    <View accessibilityLabel="Novidades" style={st.card}>
      <LinearGradient colors={['#d6334f', '#ff9a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={st.head}>
        <View style={st.sparkle}><Icon name="sparkles" size={16} color="#fff" /></View>
        <Text style={st.title}>Há novidades no Txillapp!</Text>
        <Pressable onPress={() => markSeen(...FEATURES.map((f) => f.id))} style={st.dismiss} accessibilityRole="button" accessibilityLabel="Dispensar as novidades">
          <Icon name="x" size={16} color="#fff" />
        </Pressable>
      </View>
      <View style={{ marginTop: 12, gap: 8 }}>
        {shown.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => {
              markSeen(f.id);
              router.push(f.path as never);
            }}
            style={({ pressed }) => [st.row, pressed && { backgroundColor: 'rgba(255,255,255,0.25)' }]}
            accessibilityRole="button"
          >
            <View style={st.ico}><Icon name={f.icon} size={20} color="#d6334f" /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.rowTitle}>{f.title}</Text>
              <Text style={st.rowText}>{f.text}</Text>
            </View>
            <Icon name="chevron-right" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        ))}
      </View>
      {unseen.length > shown.length ? <Text style={st.more}>E mais {unseen.length - shown.length}…</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  badge: { height: 18, borderRadius: 9, paddingHorizontal: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', boxShadow: '0 2px 6px rgba(214,51,79,0.5)' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.5, lineHeight: 12 },
  card: { marginHorizontal: 12, marginBottom: 16, overflow: 'hidden', borderRadius: 24, padding: 16, boxShadow: '0 6px 18px rgba(214,51,79,0.35)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sparkle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.25)' },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  dismiss: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 10, backgroundColor: 'rgba(255,255,255,0.15)' },
  ico: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  rowTitle: { fontSize: 15, fontWeight: '700', lineHeight: 19, color: '#fff' },
  rowText: { fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.9)' },
  more: { marginTop: 8, textAlign: 'center', fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
});
