import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOwnSeen } from '@/lib/ownSeen';
import { trayMine } from '@/lib/ownStorySeen';
import { colors } from '@/lib/theme';
import { Avatar } from './Avatar';
import { Ring } from './StoryRing';
import { NameWithBadge } from './NameWithBadge';
import { navTap } from '@/lib/tapGuard';

/** Tabuleiro de stories no topo do Início: o teu primeiro (com o "+"), depois quem segues. */
export function StoriesTray() {
  const { user } = useAuth();
  const router = useRouter();
  const { data } = useQuery({ queryKey: ['stories'], queryFn: api.stories, refetchInterval: 60_000 });
  const users = data ?? [];
  const others = users.filter((u) => !u.isMe);
  const mine = users.find((u) => u.isMe);
  const ownSeenAt = useOwnSeen(user?.username);
  // O `seen` do servidor (vale em todos os aparelhos), reforçado pelo que este aparelho já viu.
  const mineRing = trayMine(mine, ownSeenAt);
  // Dois toques rápidos no anel abriam o visor duas vezes (fechar um mostrava o outro por baixo).
  const create = () => { if (navTap('/stories/new')) router.push('/stories/new' as never); };
  const view = (u: string) => { if (navTap(`/stories/${u}`)) router.push(`/stories/${u}` as never); };

  return (
    <View style={{ marginBottom: 16 }} accessibilityLabel="Mimos">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Pressable onPress={() => (mine ? view(user?.username ?? '') : create())} style={styles.bubble} accessibilityRole="button" accessibilityLabel={mine ? 'Ver o teu mimo' : 'Criar mimo'}>
          <View>
            <Ring count={mine?.count ?? 1} seenCount={mine ? mineRing.seenCount : 1} green={mine?.closeFriends}>
              <Avatar name={user?.displayName ?? '?'} username={user?.username} size={56} />
            </Ring>
            <Pressable onPress={create} hitSlop={8} style={styles.plus} accessibilityRole="button" accessibilityLabel="Adicionar ao mimo">
              <Text style={styles.plusText}>+</Text>
            </Pressable>
          </View>
          <Text style={[styles.label, { color: colors.zinc800, fontWeight: '500' }]} numberOfLines={1}>O teu mimo</Text>
        </Pressable>

        {others.map((u) => (
          <Pressable key={u.username} onPress={() => view(u.username)} style={styles.bubble} accessibilityRole="button" accessibilityLabel={`Ver mimo de ${u.displayName}${u.seen ? '' : ' (novo)'}`}>
            <View style={{ opacity: u.seen ? 0.6 : 1 }}>
              <Ring count={u.count} seenCount={u.seenCount} green={u.closeFriends}>
                <Avatar name={u.displayName} username={u.username} size={56} />
              </Ring>
            </View>
            <NameWithBadge name={u.username} who={u} center gap={2} style={[styles.label, styles.name, u.seen ? { color: colors.zinc500, fontWeight: '400' } : { color: colors.zinc900, fontWeight: '700' }]} size={11} />
          </Pressable>
        ))}
        {others.length === 0 && <Text style={styles.empty}>Segue pessoas para ver os mimos delas</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4, gap: 12 },
  bubble: { width: 76, alignItems: 'center', gap: 6 },
  label: { width: '100%', textAlign: 'center', fontSize: 12, lineHeight: 16 },
  /** Na linha com o selo, o @ não ocupa a largura toda (o selo pequeno fica a seguir, centrado com ele). */
  name: { width: undefined },
  plus: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.white, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: '#fff', fontSize: 16, fontWeight: '700', lineHeight: 18, marginTop: -1 },
  empty: { alignSelf: 'center', paddingRight: 16, fontSize: 14, color: colors.zinc500 },
});
