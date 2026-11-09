import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { CallIcon } from '@/components/calls/CallIcons';
import { Empty } from '@/components/Empty';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { closeOpenSwipe, SwipeRow } from '@/components/SwipeRow';
import { callsApi, fmtDuration, startCall, type CallLogItem } from '@/lib/calls';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

/** Perdida: ligaram-me e não atendi (tocou até ao fim, ou desistiram antes). */
const isMissed = (c: CallLogItem) => c.direction === 'in' && (c.status === 'missed' || c.status === 'cancelled');

function subtitle(c: CallLogItem): string {
  const kind = c.video ? 'Videochamada' : 'Chamada de voz';
  const when = timeAgo(c.startedAt);
  if (isMissed(c)) return `${kind} perdida · ${when}`;
  if (c.status === 'ringing' || c.status === 'active') return `${kind} · agora`;
  if (c.status === 'declined') return `${kind} recusada · ${when}`;
  if (c.status === 'missed' || c.status === 'cancelled') return `${kind} sem resposta · ${when}`;
  const dur = c.durationS ? ` · ${fmtDuration(c.durationS * 1000)}` : '';
  return `${kind}${dur} · ${when}`;
}

/** Histórico de chamadas: as perdidas a vermelho e um botão para ligar de volta. */
export default function Calls() {
  const router = useRouter();
  const q = useInfiniteQuery({
    queryKey: ['calls'],
    queryFn: ({ pageParam }) => callsApi.history(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    retry: 1,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const qc = useQueryClient();
  type Pages = InfiniteData<{ items: CallLogItem[]; nextCursor: string | null }>;
  /** Apagar já, sem perguntar (tira da lista na hora; se falhar, volta). */
  function remove(c: CallLogItem) {
    const before = qc.getQueryData<Pages>(['calls']);
    qc.setQueryData<Pages>(['calls'], (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== c.id) })) });
    callsApi.remove(c.id).catch(() => { qc.setQueryData(['calls'], before); Alert.alert('Não consegui apagar', 'Tenta outra vez.'); });
  }
  function clearAll() {
    Alert.alert('Limpar o histórico?', 'Todas as chamadas saem da tua lista. Do lado da outra pessoa ficam.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Limpar', style: 'destructive', onPress: () => { void callsApi.removeAll().then(() => qc.invalidateQueries({ queryKey: ['calls'] })).catch(() => Alert.alert('Não consegui limpar', 'Tenta outra vez.')); } },
    ]);
  }

  function callBack(c: CallLogItem) {
    void startCall(c.peer, c.video).catch((e: Error) => Alert.alert('Não consegui ligar', e.message));
  }

  return (
    <StackPage
      title="Chamadas"
      right={items.length ? (
        <Pressable onPress={clearAll} hitSlop={8} accessibilityRole="button" style={({ pressed }) => [st.clear, pressed && { opacity: 0.6 }]}>
          <Text style={st.clearText}>Limpar</Text>
        </Pressable>
      ) : undefined}
    >
      <FlatList
        onScrollBeginDrag={closeOpenSwipe}
        data={items}
        keyExtractor={(c) => c.id}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        onRefresh={() => void q.refetch()}
        refreshing={q.isRefetching && !q.isFetchingNextPage}
        contentContainerStyle={{ paddingVertical: 6 }}
        ListEmptyComponent={
          q.isLoading ? <ActivityIndicator style={{ marginTop: 48 }} color={colors.brand} /> :
          q.isError ? <Empty icon="alert" title="Não consegui ver as chamadas agora" text="Verifica a internet e tenta outra vez." /> :
          <Empty icon="phone" title="Ainda não há chamadas" text="Liga a alguém a partir de uma conversa: o botão está no topo." />
        }
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.brand} /> : undefined}
        renderItem={({ item: c }) => {
          const missed = isMissed(c);
          const live = c.status === 'ringing' || c.status === 'active';
          return (
            <SwipeRow
              left={[
                { label: 'Mensagem', icon: 'comment', color: colors.brand, onPress: () => router.push(`/messages/${c.peer.username}` as never) },
                c.video
                  ? { label: 'Voz', icon: 'phone', color: colors.zinc700, onPress: () => callBack({ ...c, video: false }) }
                  : { label: 'Vídeo', icon: 'video', color: colors.zinc700, onPress: () => callBack({ ...c, video: true }) },
              ]}
              right={live ? [] : [
                { label: 'Perfil', icon: 'user', color: colors.zinc500, onPress: () => router.push(`/u/${c.peer.username}` as never) },
                { label: 'Apagar', icon: 'trash', color: colors.red600, onPress: () => remove(c) },
              ]}
            >
            <Pressable onPress={() => router.push(`/messages/${c.peer.username}` as never)} style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
              <Avatar name={c.peer.displayName} username={c.peer.hasAvatar ? c.peer.username : undefined} size={48} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[st.name, missed && { color: colors.red600 }]} numberOfLines={1}>{c.peer.displayName}</Text>
                <View style={st.subRow}>
                  <CallIcon name={missed ? 'missed' : c.direction === 'out' ? 'outgoing' : 'incoming'} size={14} color={missed ? colors.red600 : colors.zinc500} />
                  <Text style={[st.sub, missed && { color: colors.red600 }]} numberOfLines={1}>{subtitle(c)}</Text>
                </View>
              </View>
              <Pressable onPress={() => callBack(c)} hitSlop={6} style={({ pressed }) => [st.callBtn, pressed && { backgroundColor: colors.zinc200 }]} accessibilityRole="button" accessibilityLabel={c.video ? `Videochamada a ${c.peer.displayName}` : `Ligar a ${c.peer.displayName}`}>
                {c.video ? <Icon name="video" size={22} color={colors.zinc800} /> : <CallIcon name="handset" size={21} color={colors.zinc800} />}
              </Pressable>
            </Pressable>
            </SwipeRow>
          );
        }}
      />
    </StackPage>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  name: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  sub: { fontSize: 14, color: colors.zinc500, flexShrink: 1 },
  clear: { paddingHorizontal: 8, paddingVertical: 6 },
  clearText: { fontSize: 15, fontWeight: '600', color: colors.brand },
  callBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.zinc100 },
});
