import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Avatar } from '@/components/Avatar';
import { Empty } from '@/components/Empty';
import { FollowButton } from '@/components/FollowButton';
import { Icon } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { api, type Person } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { goBack } from '@/lib/nav';

type Kind = 'followers' | 'following';

const web = Platform.OS === 'web';

function ConnectionList({ username, kind, me, width }: { username: string; kind: Kind; me: string; width: number }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const winH = useWindowDimensions().height;
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  // Na web, a lista leva uma altura em píxeis (altura da janela menos o topo da lista), em vez de `flex: 1`.
  // Ao contrário das notificações e das mensagens (onde a lista é filha única), aqui a lista tem a pesquisa como irmã
  // e os separadores por cima: o Safari do iPhone resolve o `flex: 1 1 0%` desses irmãos à altura do conteúdo, a lista
  // fica do tamanho dos nomes todos e não rola — e `onLayout` mede essa altura, por isso medir a zona não chegava.
  // `measureInWindow` dá a posição real no ecrã (getBoundingClientRect), independente de como o flex foi resolvido.
  const zone = useRef<React.ComponentRef<typeof View>>(null);
  const [top, setTop] = useState(0);
  const measure = useCallback(() => {
    if (!web) return;
    zone.current?.measureInWindow((_x, y) => setTop((cur) => (Math.abs(cur - y) > 1 ? Math.round(y) : cur)));
  }, []);
  useEffect(measure, [measure, winH, width]);
  const listH = web && top > 0 ? Math.max(160, winH - top) : 0;
  const q = useInfiniteQuery({
    queryKey: ['people', kind, username, term],
    queryFn: ({ pageParam }) => (kind === 'followers' ? api.followers(username, pageParam, term) : api.following(username, pageParam, term)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const people: Person[] = q.data?.pages.flatMap((x) => x.items) ?? [];
  return (
    <View style={{ width, flex: 1 }}>
      <View style={st.searchWrap}>
        <View style={st.search}>
          <Icon name="search" size={18} color={colors.zinc600} />
          <TextInput value={text} onChangeText={setText} placeholder={kind === 'followers' ? 'Procurar seguidores' : 'Procurar quem sigo'} placeholderTextColor={colors.zinc500} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={st.input} accessibilityLabel="Procurar" />
          {text ? <Pressable onPress={() => setText('')} hitSlop={10} accessibilityLabel="Limpar pesquisa"><Text style={{ fontSize: 20, color: colors.zinc600 }}>×</Text></Pressable> : null}
        </View>
      </View>
      {/* Só para medir onde a lista começa; a altura vai na própria lista. */}
      <View ref={zone} onLayout={measure} collapsable={false} style={listH ? { height: listH } : { flex: 1 }}>
      {/* Sem virtualização: o FlatList no Safari do iPhone só desenhava as 10 primeiras linhas (não chegava a medir a altura)
          e a lista "prendia". Aqui desenham-se todas (as páginas são de 30) e carrega-se mais ao chegar perto do fim. */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={listH ? { height: listH, flexGrow: 0, flexShrink: 0 } : { flex: 1 }}
        contentContainerStyle={{ paddingBottom: web ? insets.bottom + 24 : 24 }}
        scrollEventThrottle={100}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          if (contentOffset.y + layoutMeasurement.height > contentSize.height - 400 && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
        }}
      >
        {q.isLoading ? <ActivityIndicator style={{ marginTop: 32 }} color={colors.brand} /> : q.isError ? <Text style={st.err}>Ups, não consegui carregar</Text> : null}
        {q.isSuccess && people.length === 0 ? <Empty icon={term ? 'search' : kind === 'followers' ? 'sprout' : 'eye'} title={term ? 'Ninguém com esse nome' : kind === 'followers' ? 'Ainda sem seguidores' : 'Ainda não segue ninguém'} /> : null}
        {people.map((x) => (
          <View key={x.username} style={st.row}>
            <Pressable onPress={() => router.push(x.username === me ? '/profile' : (`/u/${x.username}` as never))} style={st.who} accessibilityRole="link">
              <Avatar name={x.displayName} username={x.username} size={48} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.name} numberOfLines={1}>{x.displayName}</Text>
                <Text style={st.user} numberOfLines={1}>@{x.username}{x.followsYou && x.username !== me ? ' · segue-te' : ''}</Text>
              </View>
            </Pressable>
            {x.username !== me && (
              <View style={{ width: 112, flexDirection: 'row' }}>
                <FollowButton username={x.username} following={x.following} requested={!!x.requested} isPrivate={!!x.isPrivate} />
              </View>
            )}
          </View>
        ))}
        {q.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} color={colors.brand} /> : null}
      </ScrollView>
      </View>
    </View>
  );
}

/** Seguidores e a seguir numa só página: dois separadores que se alternam tocando ou a arrastar para o lado, cada um com a sua pesquisa. */
export default function Connections() {
  const { username = '', tab } = useLocalSearchParams<{ username: string; tab?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const win = useWindowDimensions().width;
  const [measured, setMeasured] = useState(0);
  const width = measured || win;
  const start: Kind = tab === 'following' ? 'following' : 'followers';
  const [cur, setCur] = useState<Kind>(start);
  const pager = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const profile = useQuery({ queryKey: ['profile', username], queryFn: () => api.profile(username), retry: false });
  const p = profile.data;

  useEffect(() => {
    if (start === 'following' && p?.canSeeConnections) setTimeout(() => pager.current?.scrollTo({ x: width, animated: false }), 0);
  }, [start, p?.canSeeConnections, width]);

  // Na web não há pager (a lista não rolava no Safari com ele por baixo): o deslizar para o lado troca o separador à mão.
  const curRef = useRef(cur);
  curRef.current = cur;
  const widthRef = useRef(width);
  widthRef.current = width;
  // As duas listas lado a lado a deslizar (acompanham o dedo; ao largar, mola para o separador escolhido).
  const slide = useRef(new Animated.Value(start === 'following' ? -win : 0)).current;
  const settle = (k: Kind) => Animated.spring(slide, { toValue: k === 'followers' ? 0 : -widthRef.current, useNativeDriver: false, bounciness: 0, speed: 16 }).start();
  useEffect(() => { settle(cur); }, [cur, width]); // eslint-disable-line react-hooks/exhaustive-deps
  // Os toques são lidos no document: com outro ecrã por cima (ex.: o perfil de quem se tocou, que também desliza entre
  // separadores), este fica montado por baixo e não pode trocar de lista às escondidas.
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  useEffect(() => {
    if (!web || typeof document === 'undefined') return;
    let s: { x: number; y: number; t: number; horiz: boolean | null } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      s = focusedRef.current && e.touches.length === 1 && t.clientX > 24 && t.clientX < window.innerWidth - 24 && !/INPUT|TEXTAREA/.test(tag) ? { x: t.clientX, y: t.clientY, t: Date.now(), horiz: null } : null;
    };
    const move = (e: TouchEvent) => {
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (s.horiz === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) s.horiz = Math.abs(dx) > Math.abs(dy) * 1.5;
      if (!s.horiz) return;
      const base = curRef.current === 'followers' ? 0 : -widthRef.current;
      slide.setValue(Math.max(-widthRef.current, Math.min(0, base + dx)));
    };
    const up = (e: TouchEvent) => {
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const quick = Date.now() - s.t < 700;
      const horiz = s.horiz;
      s = null;
      if (!horiz) return;
      const far = Math.abs(dx) > widthRef.current * 0.35 || (quick && Math.abs(dx) > 50);
      const next: Kind = far ? (dx < 0 ? 'following' : 'followers') : curRef.current;
      if (next !== curRef.current) setCur(next); else settle(next);
    };
    const cancel = () => { s = null; settle(curRef.current); };
    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', up, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', down);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      document.removeEventListener('touchcancel', cancel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (k: Kind) => {
    setCur(k);
    pager.current?.scrollTo({ x: k === 'followers' ? 0 : width, animated: true });
  };
  const tabBtn = (k: Kind, label: string, n: number) => (
    <Pressable onPress={() => go(k)} style={st.tab} accessibilityRole="tab" accessibilityState={{ selected: cur === k }}>
      <Text style={[st.tabText, cur === k ? { fontWeight: '700', color: colors.zinc900 } : { color: colors.zinc600 }]}>{n.toLocaleString('pt-PT')} {label}</Text>
      <View style={[st.bar, { opacity: cur === k ? 1 : 0 }]} />
    </Pressable>
  );

  return (
    <StackPage title={`@${username}`}>
      {profile.isError && (
        <View>
          <Empty icon="search" title="Essa pessoa não existe" />
          <Pressable onPress={() => goBack(router)} style={{ alignSelf: 'center', marginTop: 24 }}><Text style={{ textDecorationLine: 'underline', fontSize: 16 }}>Voltar</Text></Pressable>
        </View>
      )}
      {p && !p.canSeeConnections && <Empty icon="lock" title="Estas listas são privadas" text={`${p.displayName} escolheu quem as pode ver.`} />}
      {p?.canSeeConnections && (
        <>
          <View style={st.tabs} accessibilityRole="tablist">
            {tabBtn('followers', 'seguidores', p.counts.followers)}
            {tabBtn('following', 'a seguir', p.counts.following)}
          </View>
          {web ? (
            // Na web (iPhone/Safari) a lista dentro de um pager horizontal não rola com o dedo: mostra-se só o separador ativo.
            <View style={{ flex: 1, overflow: 'hidden' }} onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}>
              <Animated.View style={{ flex: 1, flexDirection: 'row', width: width * 2, transform: [{ translateX: slide }] }}>
                <ConnectionList username={username} kind="followers" me={user!.username} width={width} />
                <ConnectionList username={username} kind="following" me={user!.username} width={width} />
              </Animated.View>
            </View>
          ) : (
            <ScrollView ref={pager} onLayout={(e) => setMeasured(e.nativeEvent.layout.width)} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e) => setCur(Math.round(e.nativeEvent.contentOffset.x / width) === 0 ? 'followers' : 'following')} style={{ flex: 1 }}>
              <ConnectionList username={username} kind="followers" me={user!.username} width={width} />
              <ConnectionList username={username} kind="following" me={user!.username} width={width} />
            </ScrollView>
          )}
        </>
      )}
    </StackPage>
  );
}

const st = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.zinc100, backgroundColor: colors.white },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 15 },
  bar: { position: 'absolute', left: 24, right: 24, bottom: 0, height: 3, borderRadius: 2, backgroundColor: colors.zinc900 },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.white },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, backgroundColor: colors.zinc100, paddingHorizontal: 14, height: 42 },
  input: { flex: 1, fontSize: 15, color: colors.zinc900, paddingVertical: 0, outlineStyle: 'none' as never },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  user: { fontSize: 14, color: colors.zinc600 },
  err: { textAlign: 'center', color: colors.red600, paddingVertical: 40 },
});
