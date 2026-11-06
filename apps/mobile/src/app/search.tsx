import { BackButton } from '@/components/BackButton';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { api, type Post } from '@/lib/api';
import { sized } from '@/lib/config';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

/** Pesquisa de pessoas, hashtags e publicações, mais o Explorar (temas e grelha), como no site. */
export default function Search() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const col = Math.min(width, 576);
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [tab, setTab] = useState<'people' | 'tags' | 'posts'>('people');
  const [topic, setTopic] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(text.trim());
      if (text.trim().startsWith('#')) setTab('tags');
    }, 300);
    return () => clearTimeout(t);
  }, [text]);

  const trending = useQuery({ queryKey: ['trending'], queryFn: api.trending, staleTime: 60_000 });
  const hot = useQuery({ queryKey: ['places-hot'], queryFn: api.hotPlaces, staleTime: 60_000 });
  const topics = useQuery({ queryKey: ['explore-topics'], queryFn: () => api.exploreTopics(), staleTime: 5 * 60_000, retry: false });
  const explore = useInfiniteQuery({
    queryKey: ['explore', topic],
    queryFn: ({ pageParam }) => api.explore(topic, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    staleTime: 60_000,
  });
  const q = useQuery({ queryKey: ['search', term], queryFn: () => api.search(term), enabled: term.length >= 2, staleTime: 30_000 });

  const grid: Post[] = (() => {
    const seen = new Set<string>();
    const all = explore.data?.pages.flatMap((x) => x.items) ?? [];
    return all.map((p) => (p.kind === 'repost' && p.repostOf ? p.repostOf : p)).filter((p) => p.media.length > 0 && !seen.has(p.id) && !!seen.add(p.id));
  })();
  const searching = term.length >= 2;
  const people = q.data?.people ?? [];
  const tags = q.data?.tags ?? [];
  const posts = q.data?.posts ?? [];
  const cell = (col - 4) / 3;
  const open = (p: Post) => router.push(`/p/${p.code ?? p.id}` as never);

  /** Grelha do Explorar: linhas do mesmo tamanho; o primeiro bloco (e de 10 em 10) é grande, 2×2. */
  const tiles = () => {
    const rows: React.ReactNode[] = [];
    let i = 0;
    let n = 0;
    while (i < grid.length) {
      const big = n % 10 === 0;
      const p = grid[i];
      const m = p.media[0];
      const img = (post: Post, w: number, h: number, key: string) => (
        <Pressable key={key} onPress={() => open(post)} style={{ width: w, height: h, backgroundColor: colors.rose50 }} accessibilityRole="button" accessibilityLabel={`Abrir publicação de ${post.author.displayName}`}>
          <Image source={{ uri: sized(post.media[0].kind === 'video' ? post.media[0].posterUrl ?? post.media[0].url : post.media[0].url, w > cell ? 720 : 360) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} accessibilityIgnoresInvertColors />
          {post.media[0].kind === 'video' ? <View style={styles.tag}><Icon name="film" size={18} color="#fff" /></View> : post.media.length > 1 ? <View style={styles.tag}><Icon name="images" size={18} color="#fff" /></View> : null}
        </Pressable>
      );
      void m;
      if (big && grid[i + 2]) {
        // Bloco grande à esquerda (2×2) e dois pequenos empilhados à direita.
        rows.push(
          <View key={`b${i}`} style={{ flexDirection: 'row', gap: 2, marginBottom: 2 }}>
            {img(p, cell * 2 + 2, cell * 2 + 2, p.id)}
            <View style={{ gap: 2 }}>
              {img(grid[i + 1], cell, cell, grid[i + 1].id)}
              {img(grid[i + 2], cell, cell, grid[i + 2].id)}
            </View>
          </View>,
        );
        i += 3;
        n += 3;
      } else {
        const rest = grid.slice(i, i + 3);
        rows.push(<View key={`r${i}`} style={{ flexDirection: 'row', gap: 2, marginBottom: 2 }}>{rest.map((x) => img(x, cell, cell, x.id))}</View>);
        i += rest.length;
        n += rest.length;
      }
    }
    return rows;
  };

  const chipBase = { height: 40, borderRadius: 999, paddingHorizontal: 16, alignItems: 'center' as const, justifyContent: 'center' as const, flexDirection: 'row' as const, gap: 6 };

  return (
    <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
      <View style={styles.bar}>
        <BackButton />
        <View style={styles.field}>
          <Icon name="search" size={20} color={colors.zinc600} />
          <TextInput value={text} onChangeText={setText} placeholder="Procura malta e publicações…" placeholderTextColor={colors.zinc500} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={styles.input} accessibilityLabel="Pesquisar" />
          {text ? <Pressable onPress={() => setText('')} hitSlop={8} accessibilityLabel="Limpar pesquisa"><Text style={{ fontSize: 22, color: colors.zinc600, paddingHorizontal: 6 }}>×</Text></Pressable> : null}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        {!searching && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
              <Pressable onPress={() => router.push('/reels/filtros' as never)} style={[chipBase, { width: 40, paddingHorizontal: 0, backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel="Filtros"><Icon name="sliders" size={20} /></Pressable>
              {[{ id: null as string | null, label: 'Para ti' }, ...(topics.data ?? []).map((t) => ({ id: t.id as string | null, label: t.label }))].map((t) => (
                <Pressable key={t.id ?? 'fy'} onPress={() => setTopic(t.id)} accessibilityRole="tab" accessibilityState={{ selected: topic === t.id }} style={[chipBase, { backgroundColor: topic === t.id ? colors.zinc900 : colors.zinc100 }]}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: topic === t.id ? '#fff' : colors.zinc800 }}>{t.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {((trending.data?.tags.length ?? 0) > 0 || (hot.data?.length ?? 0) > 0) && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 8 }}>
                {(hot.data ?? []).slice(0, 5).map((pl) => (
                  <Pressable key={pl.name} onPress={() => setText(pl.name)} style={[chipBase, { backgroundColor: '#f0f9ff' }]}>
                    <Icon name="map-pin" size={15} color="#075985" /><Text style={{ fontSize: 14, fontWeight: '600', color: '#075985' }}>{pl.name}</Text>
                  </Pressable>
                ))}
                {(trending.data?.tags ?? []).slice(0, 8).map((t) => (
                  <Pressable key={t.tag} onPress={() => setText(`#${t.tag}`)} style={[chipBase, { backgroundColor: colors.zinc100 }]}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.zinc800 }}>#{t.tag}</Text>
                    {t.rising ? <Icon name="trending" size={14} strokeWidth={2.2} color="#ea580c" /> : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {explore.isLoading && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, paddingHorizontal: 2 }}>{Array.from({ length: 9 }, (_, n) => <View key={n} style={{ width: cell, height: cell, backgroundColor: colors.zinc100 }} />)}</View>}
            <View style={{ paddingHorizontal: 2 }}>{tiles()}</View>
            {explore.isSuccess && grid.length === 0 && (
              <View style={styles.empty}>
                <Icon name="image" size={36} color={colors.zinc300} />
                <Text style={styles.emptyTitle}>Ainda não há publicações para explorar</Text>
                <Text style={styles.emptySub}>Quando a malta publicar, aparece aqui.</Text>
              </View>
            )}
            {explore.hasNextPage && (
              <Pressable onPress={() => void explore.fetchNextPage()} disabled={explore.isFetchingNextPage} style={styles.more}>
                {explore.isFetchingNextPage ? <ActivityIndicator color={colors.brand} /> : <Text style={styles.moreText}>Ver mais</Text>}
              </Pressable>
            )}
          </>
        )}

        {searching && (
          <>
            <View style={styles.tabs} accessibilityRole="tablist">
              {([['people', `Pessoas${q.data ? ` (${people.length})` : ''}`], ['tags', `#Tags${q.data ? ` (${tags.length})` : ''}`], ['posts', `Publicações${q.data ? ` (${posts.length})` : ''}`]] as const).map(([k, label]) => (
                <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={[styles.tabBtn, { backgroundColor: tab === k ? colors.zinc900 : colors.zinc100 }]}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: tab === k ? '#fff' : colors.zinc700 }}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {q.isLoading && <ActivityIndicator color={colors.brand} style={{ margin: 40 }} />}
            {q.isError && <Text style={[styles.emptyTitle, { color: colors.red600, paddingVertical: 40 }]}>Ups, a pesquisa falhou</Text>}

            {q.isSuccess && tab === 'people' && (
              <View style={{ paddingHorizontal: 16 }}>
                {people.length === 0 && <View style={styles.empty}><Icon name="search" size={36} color={colors.zinc300} /><Text style={styles.emptyTitle}>Ninguém com esse nome</Text></View>}
                {people.map((p) => (
                  <Pressable key={p.username} onPress={() => router.push(`/u/${p.username}` as never)} style={styles.person}>
                    <Avatar name={p.displayName} username={p.username} size={48} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={styles.pName} numberOfLines={1}>{p.displayName}</Text>
                        {p.verified && <VerifiedBadge size={15} />}
                        {p.isPrivate && <Icon name="lock" size={14} color={colors.zinc500} />}
                      </View>
                      <Text style={styles.pHandle} numberOfLines={1}>@{p.username}{p.followsYou ? ' · segue-te' : ''}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {q.isSuccess && tab === 'tags' && (
              <View style={{ paddingHorizontal: 16 }}>
                {tags.length === 0 && <View style={styles.empty}><Icon name="tag" size={36} color={colors.zinc300} /><Text style={styles.emptyTitle}>Nenhuma hashtag assim</Text></View>}
                {tags.map((t) => (
                  <View key={t.tag} style={styles.person}>
                    <View style={styles.hash}><Text style={styles.hashText}>#</Text></View>
                    <View>
                      <Text style={styles.pName}>#{t.tag}</Text>
                      <Text style={styles.pHandle}>{t.posts} {t.posts === 1 ? 'publicação' : 'publicações'}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {q.isSuccess && tab === 'posts' && (
              <FlatList
                scrollEnabled={false}
                data={posts}
                keyExtractor={(p) => p.id}
                contentContainerStyle={{ paddingHorizontal: 16 }}
                ListEmptyComponent={<View style={styles.empty}><Icon name="inbox" size={36} color={colors.zinc300} /><Text style={styles.emptyTitle}>Não encontrei nada com isso</Text></View>}
                renderItem={({ item: p }) => (
                  <Pressable onPress={() => open(p)} style={styles.person}>
                    {p.media[0] ? (
                      <Image source={{ uri: sized(p.media[0].kind === 'video' ? p.media[0].posterUrl ?? p.media[0].url : p.media[0].url, 160) }} style={styles.thumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.thumb, { backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' }]}><Icon name="comment" size={24} /></View>
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.pName} numberOfLines={1}>{p.author.displayName}</Text>
                      <Text style={{ fontSize: 14, color: colors.zinc700 }} numberOfLines={2}>{p.body || (p.media.length ? 'Foto' : '')}</Text>
                      <Text style={{ fontSize: 12, color: colors.zinc500 }}>{timeAgo(p.createdAt)}{p.locationLabel ? ` · ${p.locationLabel}` : ''}</Text>
                    </View>
                  </Pressable>
                )}
              />
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 8, paddingTop: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  field: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12 },
  input: { flex: 1, minWidth: 0, fontSize: 16, padding: 0, color: colors.zinc900, outlineStyle: 'none' } as object,
  tag: { position: 'absolute', right: 6, top: 6 },
  tabs: { marginHorizontal: 16, marginBottom: 8, flexDirection: 'row', gap: 8 },
  tabBtn: { flex: 1, borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  pName: { fontSize: 16, fontWeight: '600', color: colors.zinc900, flexShrink: 1 },
  pHandle: { fontSize: 14, color: colors.zinc600 },
  hash: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  hashText: { fontSize: 20, fontWeight: '700', color: colors.brand },
  thumb: { width: 64, height: 64, borderRadius: 12 },
  empty: { paddingHorizontal: 24, paddingVertical: 40, alignItems: 'center' },
  emptyTitle: { marginTop: 8, fontWeight: '600', color: colors.zinc600, textAlign: 'center' },
  emptySub: { fontSize: 14, color: colors.zinc600 },
  more: { alignSelf: 'center', marginVertical: 20, height: 44, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontWeight: '600', color: colors.zinc900 },
});
