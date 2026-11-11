import { TermsUpdate } from '@/components/TermsUpdate';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Landing, isStandaloneWeb } from '@/components/Landing';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { Icon } from '@/components/Icon';
import { PullView, usePullToRefresh } from '@/components/PullToRefresh';
import { PostCard } from '@/components/PostCard';
import { SponsoredCard } from '@/components/boost/SponsoredCard';
import { ProfileNudge } from '@/components/ProfileNudge';
import { StoriesTray } from '@/components/StoriesTray';
import { useTabPress } from '@/lib/tabPress';
import { Suggestions } from '@/components/Suggestions';
import { EmailBanner } from '@/components/EmailBanner';
import { PublishBanner } from '@/components/PublishBanner';
import { WelcomeTour } from '@/components/WelcomeTour';
import { Wordmark } from '@/components/Wordmark';
import { api, type Post } from '@/lib/api';
import { feedPosition } from '@/lib/api.boosts';
import { slotsByAnchor } from '@/lib/boostView';
import { useAuth } from '@/lib/auth';
import { useDesktop } from '@/lib/desktop';
import { trackSeen } from '@/lib/seen';
import { onPostsViewable } from '@/lib/visiblePosts';
import { isSnoozed, shouldShowSuggestions } from '@/lib/suggestPacing';
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

/** Início: com sessão, o feed; sem sessão (no browser), a apresentação do Txillapp, no endereço principal (para os motores de busca). */
export default function Home() {
  const { user } = useAuth();
  if (user) return <Feed />;
  return Platform.OS === 'web' && !isStandaloneWeb() ? <Landing /> : null;
}

/** Início: mimos no topo e as publicações de quem segues e do que o Txillapp descobre para ti. */
function Feed() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const desktop = useDesktop();
  // As sugestões de pessoas aparecem só às vezes entre os posts (ritmo neste aparelho).
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [snoozed, setSnoozed] = useState(true);
  useEffect(() => {
    void shouldShowSuggestions('feed', { minGapHours: 10, base: 0.4, step: 0.2 }).then(setShowSuggestions);
    void isSnoozed().then(setSnoozed);
  }, []);
  // A app ainda é nova e há pouca gente: quem segue poucas pessoas vê logo, em todas as visitas, quem pode conhecer (a não ser que dispense).
  const me = useQuery({ queryKey: ['profile', user?.username], queryFn: () => api.profile(user!.username), enabled: !!user, staleTime: 60_000 });
  const early = !!me.data && me.data.counts.following < 25 && !snoozed;
  const q = useInfiniteQuery({
    queryKey: ['feed'],
    // Com a posição aproximada do "À tua volta" (se houver): o servidor junta os destaques do Bombar (`sponsored`).
    queryFn: async ({ pageParam }) => api.feed(pageParam, await feedPosition()),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // O mesmo post pode aparecer em duas páginas: mostra-se uma vez.
  const seen = new Set<string>();
  const posts: Post[] = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => !seen.has(p.id) && !!seen.add(p.id));
  const firstSeen = posts.findIndex((p) => p.feed?.seen);
  // Destaques do Bombar (no máximo 1 a cada ~11 publicações, decidido no servidor), pela publicação depois da qual entram.
  const slots = slotsByAnchor(q.data?.pages ?? []);

  // Sinal de novidades: de tempos a tempos espreita a primeira página sem mexer no que estás a ler. Não atualiza sozinho:
  // mostra um aviso e, ao tocar (ou ao puxar para atualizar), traz as novas.
  const peek = useQuery({
    queryKey: ['feed-peek'],
    queryFn: () => api.feed(),
    enabled: q.isSuccess,
    refetchInterval: 60_000,
    staleTime: 30_000,
    gcTime: 0,
  });
  const have = new Set(posts.map((p) => p.id));
  const fresh = (peek.data?.items ?? []).filter((p) => !have.has(p.id) && !p.feed?.seen).length;
  const list = useRef<FlatList<Post>>(null);
  const offset = useRef(0);
  async function showNew() {
    list.current?.scrollToOffset({ offset: 0, animated: true });
    await q.refetch();
    void peek.refetch();
  }

  // Regista como vista a publicação que esteve pelo menos 60% no ecrã durante 1 segundo.
  const onViewable = useRef(({ viewableItems }: { viewableItems: { item: Post; isViewable: boolean }[] }) => {
    for (const v of viewableItems) if (v.isViewable) trackSeen(v.item.id);
    onPostsViewable({ viewableItems }); // a música dos posts à vista toca; a dos outros pára
  }).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 1000 }).current;

  const pull = usePullToRefresh(async () => {
    await q.refetch();
    void peek.refetch();
  }, q.isRefetching && !q.isFetchingNextPage);
  // Tocar no Início quando já estás no Início: se não estás no topo, volta ao topo e espreita se há novidades (o aviso
  // “N novidades” aparece para trazer as novas); se já estás no topo, atualiza.
  useTabPress('index', () => {
    if (offset.current > 40) {
      list.current?.scrollToOffset({ offset: 0, animated: true });
      void peek.refetch();
    } else {
      void showNew();
    }
  });
  const onEnd = useCallback(() => {
    if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [q]);

  // No telemóvel, deslizar para a direita no Início abre a câmara (como no Instagram). Na web faz-se em lib/swipeTabs.
  const swipeCam = usePanGesture({
    runOnJS: true,
    maxPointers: 1,
    activeOffsetX: 45,
    failOffsetY: [-18, 18],
    enabled: Platform.OS !== 'web',
    onDeactivate: (e) => { if (e.translationX > 90) router.navigate('/new' as never); },
  });

  return (
    <GestureDetector gesture={swipeCam}>
    <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }} collapsable={false}>
      {desktop ? <View style={{ height: 16 }} /> : <Header />}
      <WelcomeTour />
      <TermsUpdate />
      <PullView pull={pull}>
      {fresh > 0 && (
        <View style={styles.freshWrap} pointerEvents="box-none">
          <Pressable onPress={() => void showNew()} style={({ pressed }) => [styles.fresh, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button">
            <Icon name="arrow-up" size={16} strokeWidth={3} color="#fff" />
            <Text style={styles.freshText}>{fresh === 1 ? 'Há novidades' : `${fresh} novidades`}</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        ref={list}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
          pull.onScroll(e);
        }}
        scrollEventThrottle={16}
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
            {(slots.get(item.id) ?? []).map((s) => <SponsoredCard key={s.campaignId} slot={s} me={user?.id} />)}
            {((early && index === 0) || (!early && index === 1 && showSuggestions)) && <Suggestions />}
          </>
        )}
        ListHeaderComponent={
          <View style={{ paddingTop: 4 }}>
            <PublishBanner />
            <EmailBanner />
            <ProfileNudge />
            <StoriesTray />
          </View>
        }
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
              <Pressable onPress={() => router.push('/new' as never)} style={styles.cta} accessibilityRole="button">
                <Text style={styles.ctaText}>Faz a primeira publicação</Text>
              </Pressable>
            </View>
          )
        }
        ListFooterComponent={
          <>
            {q.isSuccess && posts.length === 0 && (slots.get(null) ?? []).map((s) => <SponsoredCard key={s.campaignId} slot={s} me={user?.id} />)}
            {q.isSuccess && (posts.length === 0 || (posts.length === 1 && !early)) && <Suggestions />}
            {q.isFetchingNextPage ? <ActivityIndicator color={colors.brand} style={{ marginBottom: 24 }} /> : <View style={{ height: 8 }} />}
          </>
        }
        onEndReached={onEnd}
        onEndReachedThreshold={1.5}
        refreshControl={pull.control}
        showsVerticalScrollIndicator={false}
        windowSize={7}
        initialNumToRender={3}
        maxToRenderPerBatch={4}
      />
      </PullView>
    </View>
    </GestureDetector>
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
  freshWrap: { position: 'absolute', top: 8, left: 0, right: 0, zIndex: 30, alignItems: 'center' },
  fresh: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 20, backgroundColor: colors.brand, paddingLeft: 12, paddingRight: 16, boxShadow: '0 4px 14px rgba(214,51,79,0.45)' },
  freshText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cta: { marginTop: 24, borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 32, paddingVertical: 14 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  msg: { marginHorizontal: 24, marginTop: 40, alignItems: 'center' },
  msgTitle: { fontSize: 18, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  msgSub: { marginTop: 8, fontSize: 18, fontWeight: '300', color: colors.zinc600, textAlign: 'center' },
  ghost: { marginTop: 16, height: 44, paddingHorizontal: 24, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 15, fontWeight: '600', color: colors.zinc800 },
});
