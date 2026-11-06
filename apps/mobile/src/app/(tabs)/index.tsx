import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { StoriesTray } from '@/components/StoriesTray';
import { Wordmark } from '@/components/Wordmark';
import { api, type Post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cardShadow, colors } from '@/lib/theme';

/** Topo do Início: sino à esquerda, logótipo ao centro, pesquisa à direita (como no site). */
function Header() {
  const router = useRouter();
  const unread = useQuery({ queryKey: ['unread'], queryFn: api.unreadCount, refetchInterval: 30_000, staleTime: 10_000 });
  const count = unread.data?.count ?? 0;
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.push('/notifications')} style={[styles.hBtn, { left: 12 }]} accessibilityRole="button" accessibilityLabel={count > 0 ? `Notificações (${count} por ler)` : 'Notificações'}>
        <View>
          <Icon name="bell" size={26} />
          {count > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
            </View>
          )}
        </View>
      </Pressable>
      <Wordmark height={32} />
      <Pressable onPress={() => router.push('/search')} style={[styles.hBtn, { right: 12 }]} accessibilityRole="button" accessibilityLabel="Pesquisar">
        <Icon name="search" size={26} />
      </Pressable>
    </View>
  );
}

function Skeleton() {
  return (
    <View style={[styles.skel, cardShadow]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[styles.sk, { width: 52, height: 52, borderRadius: 26 }]} />
        <View style={{ flex: 1, gap: 8 }}>
          <View style={[styles.sk, { height: 16, width: '50%', borderRadius: 8 }]} />
          <View style={[styles.sk, { height: 12, width: '33%', borderRadius: 6 }]} />
        </View>
      </View>
      <View style={[styles.sk, { marginTop: 20, height: 16, width: '75%', borderRadius: 8 }]} />
      <View style={[styles.sk, { marginTop: 16, height: 160, borderRadius: 12 }]} />
    </View>
  );
}

/** Início: stories no topo e as publicações de quem segues e do que o Txillapp descobre para ti. */
export default function Feed() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const q = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => api.feed(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // O mesmo post pode aparecer em duas páginas: mostra-se uma vez.
  const seen = new Set<string>();
  const posts: Post[] = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => !seen.has(p.id) && !!seen.add(p.id));
  const firstSeen = posts.findIndex((p) => p.feed?.seen);

  const onEnd = useCallback(() => {
    if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [q]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
      <Header />
      <FlatList
        data={q.isLoading || q.isError ? [] : posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item, index }) => (
          <>
            {index === firstSeen && firstSeen > 0 && (
              <View style={styles.caughtUp}>
                <Text style={styles.caughtTitle}>Estás em dia</Text>
                <Text style={styles.caughtSub}>Daqui para baixo são publicações que já viste.</Text>
              </View>
            )}
            <PostCard post={item} me={user?.id} />
          </>
        )}
        ListHeaderComponent={<View style={{ paddingTop: 4 }}><StoriesTray /></View>}
        ListEmptyComponent={
          q.isLoading ? (
            <>
              <Skeleton />
              <Skeleton />
            </>
          ) : q.isError ? (
            <View style={styles.msg} accessibilityRole="alert">
              <Text style={styles.msgTitle}>Ups, a vibe falhou</Text>
              <Pressable onPress={() => void q.refetch()} style={styles.ghost} accessibilityRole="button">
                <Text style={styles.ghostText}>Tentar outra vez</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.msg}>
              <Icon name="cheers" size={52} color={colors.zinc300} />
              <Text style={[styles.msgTitle, { marginTop: 16, fontSize: 24 }]}>Ainda ninguém brindou por aqui</Text>
              <Text style={styles.msgSub}>Sê tu a começar a festa!</Text>
            </View>
          )
        }
        ListFooterComponent={
          q.isFetchingNextPage ? <ActivityIndicator color={colors.brand} style={{ marginBottom: 24 }} /> : <View style={{ height: 8 }} />
        }
        onEndReached={onEnd}
        onEndReachedThreshold={1.5}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
        showsVerticalScrollIndicator={false}
        windowSize={7}
        initialNumToRender={3}
        maxToRenderPerBatch={4}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { height: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  hBtn: { position: 'absolute', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -8, top: -8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700', lineHeight: 13 },
  skel: { marginHorizontal: 16, marginBottom: 24, borderRadius: 28, backgroundColor: colors.white, padding: 20 },
  sk: { backgroundColor: colors.zinc100 },
  caughtUp: { marginHorizontal: 24, marginBottom: 24, marginTop: 8, alignItems: 'center' },
  caughtTitle: { fontSize: 18, fontWeight: '800', color: colors.zinc900, lineHeight: 28 },
  caughtSub: { fontSize: 14, color: colors.zinc600, lineHeight: 20, textAlign: 'center' },
  msg: { marginHorizontal: 24, marginTop: 40, alignItems: 'center' },
  msgTitle: { fontSize: 18, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  msgSub: { marginTop: 8, fontSize: 18, fontWeight: '300', color: colors.zinc600, textAlign: 'center' },
  ghost: { marginTop: 16, height: 44, paddingHorizontal: 24, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 15, fontWeight: '600', color: colors.zinc800 },
});
