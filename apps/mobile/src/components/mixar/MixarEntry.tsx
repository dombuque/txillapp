import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mixarApi, mixarKeys } from '@/lib/api.mixar';
import { inboxEntry } from '@/lib/mixar';
import { colors } from '@/lib/theme';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { MixarBadge } from './MixarBits';

/** A lista dos meus Mixar (a mesma query do ecrã /mixar). Falhar não incomoda ninguém: o acesso simplesmente não aparece. */
export function useMixarList(enabled = true) {
  return useQuery({ queryKey: mixarKeys.list(), queryFn: mixarApi.list, enabled, staleTime: 30_000, refetchInterval: 120_000, retry: 1 });
}

/**
 * O acesso ao Mixar nas Mensagens (por cima dos separadores): com Mixar ou convites, uma linha discreta com o selo, o que
 * há de novo e os avatares; sem nenhum, só uma dica pequena. Sem servidor do Mixar (ou a carregar), nada.
 */
export function MixarEntry() {
  const router = useRouter();
  const q = useMixarList();
  if (!q.data) return null;
  const items = q.data.items ?? [];
  const e = inboxEntry(items);
  const go = () => router.push('/mixar' as never);
  if (!e.show) {
    return (
      <Pressable onPress={go} style={({ pressed }) => [st.hint, pressed && { opacity: 0.6 }]} accessibilityRole="link" accessibilityLabel={`Mixar. ${e.line}`}>
        <Icon name="mixar" size={15} color={colors.brand} strokeWidth={2.2} />
        <Text style={st.hintText} numberOfLines={2}><Text style={{ fontWeight: '700', color: colors.zinc700 }}>Mixar · </Text>{e.line}</Text>
      </Pressable>
    );
  }
  const faces = items.slice(0, 3).map((s) => s.partner);
  return (
    <Pressable onPress={go} style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={`Mixar: ${e.line}. Abrir os teus Mixar`}>
      <MixarBadge size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.title}>Mixar</Text>
        <Text style={[st.sub, e.hot && st.subHot]} numberOfLines={1}>{e.line}</Text>
      </View>
      <View style={st.faces} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {faces.map((p, i) => (
          <View key={p.username} style={[st.face, i > 0 && { marginLeft: -10 }]}>
            <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={26} />
          </View>
        ))}
      </View>
      {e.hot ? <View style={st.dot} /> : null}
      <Icon name="chevron-right" size={16} color={colors.zinc500} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingHorizontal: 8, paddingVertical: 8, marginBottom: 4, borderWidth: 1, borderColor: colors.zinc100 },
  title: { fontSize: 15, fontWeight: '800', color: colors.zinc900 },
  sub: { fontSize: 13, color: colors.zinc500 },
  subHot: { color: colors.brand, fontWeight: '700' },
  faces: { flexDirection: 'row', alignItems: 'center' },
  face: { borderRadius: 15, borderWidth: 2, borderColor: '#fff' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, paddingVertical: 6, marginBottom: 2, minHeight: 32 },
  hintText: { flex: 1, fontSize: 12, lineHeight: 16, color: colors.zinc500 },
});
