import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Avatar } from '@/components/Avatar';
import { Empty } from '@/components/Empty';
import { FollowButton } from '@/components/FollowButton';
import { Icon } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { api, type Person } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

type Kind = 'followers' | 'following';

function ConnectionList({ username, kind, me, width }: { username: string; kind: Kind; me: string; width: number }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
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
      <FlatList
        data={people}
        keyExtractor={(x) => x.username}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={q.isLoading ? <ActivityIndicator style={{ marginTop: 32 }} color={colors.brand} /> : q.isError ? <Text style={st.err}>Ups, não consegui carregar</Text> : <View />}
        ListEmptyComponent={q.isSuccess ? <Empty icon={term ? 'search' : kind === 'followers' ? 'sprout' : 'eye'} title={term ? 'Ninguém com esse nome' : kind === 'followers' ? 'Ainda sem seguidores' : 'Ainda não segue ninguém'} /> : <View />}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} color={colors.brand} /> : <View style={{ height: 24 }} />}
        renderItem={({ item: x }) => (
          <View style={st.row}>
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
        )}
      />
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
          <Pressable onPress={() => router.back()} style={{ alignSelf: 'center', marginTop: 24 }}><Text style={{ textDecorationLine: 'underline', fontSize: 16 }}>Voltar</Text></Pressable>
        </View>
      )}
      {p && !p.canSeeConnections && <Empty icon="lock" title="Estas listas são privadas" text={`${p.displayName} escolheu quem as pode ver.`} />}
      {p?.canSeeConnections && (
        <>
          <View style={st.tabs} accessibilityRole="tablist">
            {tabBtn('followers', 'seguidores', p.counts.followers)}
            {tabBtn('following', 'a seguir', p.counts.following)}
          </View>
          {Platform.OS === 'web' ? (
            // Na web (iPhone/Safari) a lista dentro de um pager horizontal não rola com o dedo: mostra-se só o separador ativo.
            <View style={{ flex: 1 }} onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}>
              <ConnectionList key={cur} username={username} kind={cur} me={user!.username} width={width} />
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
