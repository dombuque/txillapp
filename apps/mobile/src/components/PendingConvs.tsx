import { useRouter } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { pendingConvs, pendingPreview, subscribePending, type PendingConv } from '@/lib/chatPending';
import { colors } from '@/lib/theme';

/**
 * Sem rede, na lista de Mensagens (que não carregou): as conversas com mensagens à espera (lib/chatPending), com o nome
 * guardado com elas e o reloginho. Tocar abre a conversa, que mostra essas bolhas mesmo sem rede.
 */
export function PendingConvs() {
  const router = useRouter();
  const convs = useSyncExternalStore(subscribePending, pendingConvs, pendingConvs);
  if (!convs.length) return null;
  return (
    <View style={st.wrap}>
      <Text style={st.head} accessibilityRole="header">Por enviar</Text>
      {convs.map((c) => <Row key={c.conv} c={c} onPress={() => router.push((c.conv.startsWith('g:') ? `/messages/g/${c.conv.slice(2)}` : `/messages/${c.conv.slice(2)}`) as never)} />)}
    </View>
  );
}

function Row({ c, onPress }: { c: PendingConv; onPress: () => void }) {
  const group = c.conv.startsWith('g:');
  const name = c.title?.name ?? (group ? 'TxillGroup' : `@${c.conv.slice(2)}`);
  const status = c.failed ? 'Não enviada' : c.count > 1 ? `${c.count} à espera de rede` : 'À espera de rede';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.row, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`${name}. ${status}. Abrir a conversa`}>
      <Avatar name={name} username={!group && c.title?.hasAvatar ? c.conv.slice(2) : undefined} size={48} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.name} numberOfLines={1}>{name}</Text>
        <View style={st.line}>
          <Icon name={c.failed ? 'alert' : 'clock'} size={13} strokeWidth={2.2} color={c.failed ? colors.red600 : colors.zinc500} />
          <Text style={[st.preview, c.failed && { color: colors.red600 }]} numberOfLines={1}>{`${status} · ${pendingPreview(c.last)}`}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  wrap: { paddingTop: 8, paddingBottom: 8 },
  head: { paddingHorizontal: 16, paddingBottom: 4, fontSize: 13, fontWeight: '700', color: colors.zinc500 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 64 },
  name: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  line: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 5 },
  preview: { flex: 1, fontSize: 14, color: colors.zinc500 },
});
