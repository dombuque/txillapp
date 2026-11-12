import { BackButton } from '@/components/BackButton';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { BookmarkIcon } from '@/components/BookmarkIcon';
import { ExploreViewer } from '@/components/ExploreViewer';
import { FollowButton } from '@/components/FollowButton';
import { Icon } from '@/components/Icon';
import { Suggestions } from '@/components/Suggestions';
import { Bolt } from '@/components/SuperTxillPanel';
import { NameWithBadge } from '@/components/NameWithBadge';
import { api, isTcheka, type Post } from '@/lib/api';
import { locaisApi } from '@/lib/api.locais';
import { VenueRow, VenueTile } from '@/components/VenueCard';
import { sized } from '@/lib/config';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { useDesktop } from '@/lib/desktop';
import { gridColumns } from '@/lib/desktopKeys';

const RECENT_KEY = 'txill.recent-searches';
const readRecent = async (): Promise<string[]> => {
  try {
    const v = Platform.OS === 'web' ? globalThis.localStorage?.getItem(RECENT_KEY) : await SecureStore.getItemAsync(RECENT_KEY);
    const l = JSON.parse(v ?? '[]');
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
};
const writeRecent = async (list: string[]) => {
  try {
    const v = JSON.stringify(list);
    if (Platform.OS === 'web') {
      if (list.length) globalThis.localStorage?.setItem(RECENT_KEY, v);
      else globalThis.localStorage?.removeItem(RECENT_KEY);
    } else if (list.length) await SecureStore.setItemAsync(RECENT_KEY, v);
    else await SecureStore.deleteItemAsync(RECENT_KEY);
  } catch {
    /* sem armazenamento: não faz mal */
  }
};
const NONE = ['Procurámos em tudo e nada. Tenta outra vibe.', 'Nada por aqui. Experimenta outra palavra.'];

/** Pesquisa de pessoas, hashtags e publicações, mais o Explorar (temas e grelha), como no site. */
export default function Search() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // A largura real da página (no computador o Explorar é largo, até 935).
  const [colW, setColW] = useState(0);
  const col = colW || Math.min(width, 576);
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [tab, setTab] = useState<'people' | 'venues' | 'tags' | 'posts' | 'mentions'>('people');
  const [topic, setTopic] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  /** Tocaste na pesquisa: mostra as pesquisas recentes (como no Instagram), em vez do Explorar. */
  const [focusMode, setFocusMode] = useState(false);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [opened, setOpened] = useState<Post | null>(null);
  const [none] = useState(() => NONE[Math.floor(Math.random() * NONE.length)]);

  useEffect(() => {
    void readRecent().then(setRecent);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(text.trim());
      if (text.trim().startsWith('#')) setTab('tags');
    }, 300);
    return () => clearTimeout(t);
  }, [text]);

  function remember(t: string) {
    const next = [t, ...recent.filter((r) => r !== t)].slice(0, 8);
    setRecent(next);
    void writeRecent(next);
  }
  function forget() {
    setRecent([]);
    void writeRecent([]);
  }
  function forgetOne(t: string) {
    const next = recent.filter((r) => r !== t);
    setRecent(next);
    void writeRecent(next);
  }
  function cancelSearch() {
    setText('');
    setFocusMode(false);
    input.current?.blur();
  }

  const trending = useQuery({ queryKey: ['trending'], queryFn: api.trending, staleTime: 60_000 });
  const hot = useQuery({ queryKey: ['places-hot'], queryFn: api.hotPlaces, staleTime: 60_000 });
  // Locais (páginas): os mais movimentados da semana, para a fila do Explorar.
  const venues = useQuery({ queryKey: ['venues', 'discover'], queryFn: () => locaisApi.discover(null), staleTime: 5 * 60_000, retry: false });
  const topics = useQuery({ queryKey: ['explore-topics'], queryFn: () => api.exploreTopics(), staleTime: 5 * 60_000, retry: false });
  const explore = useInfiniteQuery({
    queryKey: ['explore', topic],
    queryFn: ({ pageParam }) => api.explore(topic, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    staleTime: 60_000,
  });
  // Ao escrever, os resultados da pesquisa anterior ficam à vista até chegarem os novos (antes piscava: vazio, roda, resultados).
  const q = useQuery({ queryKey: ['search', term], queryFn: () => api.search(term), enabled: term.length >= 2, staleTime: 30_000, placeholderData: keepPreviousData });
  // Menções: publicações que falam de @alguém com esse nome (o texto da publicação leva o @).
  const handle = term.replace(/^[@#]/, '');
  const mq = useQuery({ queryKey: ['search-mentions', handle], queryFn: () => api.search(`@${handle}`), enabled: handle.length >= 2, staleTime: 30_000, placeholderData: keepPreviousData });
  const mentions = mq.data?.posts ?? [];

  const grid: Post[] = (() => {
    const seen = new Set<string>();
    const all = explore.data?.pages.flatMap((x) => x.items) ?? [];
    return all.map((p) => (p.kind === 'repost' && p.repostOf ? p.repostOf : p)).filter((p) => p.media.length > 0 && !seen.has(p.id) && !!seen.add(p.id));
  })();
  const searching = term.length >= 2;
  const people = q.data?.people ?? [];
  const tags = q.data?.tags ?? [];
  const posts = q.data?.posts ?? [];
  const foundVenues = q.data?.venues ?? [];
  // Computador: mais colunas quando a coluna é larga (3 no telemóvel).
  const desktop = useDesktop();
  const ncol = gridColumns(col - 4, desktop);
  const cell = (col - 4 - 2 * (ncol - 3)) / ncol;

  /**
   * Grelha do Explorar (igual ao `grid-flow-dense` do site): 3 colunas de células quadradas; o 1.º bloco (e de 10 em 10)
   * ocupa 2×2 e os pequenos preenchem os buracos. As sugestões entram a meio, depois dos 9 primeiros.
   */
  const block = (list: Post[], offset: number) => {
    const occ: boolean[][] = [];
    const fits = (r: number, c: number, w: number) => {
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if (c + x > ncol - 1 || occ[r + y]?.[c + x]) return false;
      return true;
    };
    let rows = 0;
    const out = list.map((p, k) => {
      const w = (offset + k) % 10 === 0 ? 2 : 1;
      let r = 0;
      let c = 0;
      let found = false;
      for (r = 0; !found; r++) for (c = 0; c < ncol && !found; c++) if (fits(r, c, w)) found = true;
      r -= 1;
      c -= 1;
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) (occ[r + y] ??= [])[c + x] = true;
      rows = Math.max(rows, r + w);
      return { p, r, c, w };
    });
    return (
      <View style={{ height: rows * cell + Math.max(0, rows - 1) * 2, marginHorizontal: 2, marginBottom: 2 }}>
        {out.map(({ p, r, c, w }) => {
          const m = p.media[0];
          const size = w * cell + (w - 1) * 2;
          return (
            <Pressable key={p.id} onPress={() => setViewing(p.id)} style={(s) => [{ position: 'absolute', left: c * (cell + 2), top: r * (cell + 2), width: size, height: size, backgroundColor: colors.rose50 }, desktop && (s as { hovered?: boolean }).hovered && { opacity: 0.88 }]} accessibilityRole="button" accessibilityLabel={`Abrir publicação de ${p.author.displayName}`}>
              <Image source={{ uri: sized(m.kind === 'video' ? m.posterUrl ?? m.url : m.url, w > 1 ? 720 : 360) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} accessibilityIgnoresInvertColors />
              {isTcheka(p) ? <View style={styles.tag}><Icon name="film" size={18} color="#fff" /></View> : p.media.length > 1 ? <View style={styles.tag}><Icon name="images" size={18} color="#fff" /></View> : null}
            </Pressable>
          );
        })}
      </View>
    );
  };

  const chipBase = { height: 40, borderRadius: 999, paddingHorizontal: 16, alignItems: 'center' as const, justifyContent: 'center' as const, flexDirection: 'row' as const, gap: 6 };

  return (
    <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }} onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && Math.abs(w - colW) > 1) setColW(w); }}>
      <View style={styles.bar}>
        <BackButton />
        <View style={styles.field}>
          <Icon name="search" size={20} color={colors.zinc600} />
          <TextInput ref={input} value={text} onChangeText={setText} onFocus={() => setFocusMode(true)} onSubmitEditing={() => { const t = text.trim(); if (t.length >= 2) { setTerm(t); remember(t); } }} placeholder="Procura malta e publicações…" placeholderTextColor={colors.zinc500} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={styles.input} accessibilityLabel="Pesquisar" />
          {text ? <Pressable onPress={() => setText('')} hitSlop={8} accessibilityLabel="Limpar pesquisa"><Text style={{ fontSize: 22, color: colors.zinc600, paddingHorizontal: 6 }}>×</Text></Pressable> : null}
          <Pressable onPress={() => router.push('/supertxill' as never)} hitSlop={6} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel="Abrir o SuperTxill"><Bolt size={20} /></Pressable>
        </View>
        {focusMode ? (
          <Pressable onPress={cancelSearch} hitSlop={6} style={{ height: 44, justifyContent: 'center', paddingHorizontal: 6 }} accessibilityRole="button"><Text style={{ fontSize: 15, fontWeight: '600', color: colors.zinc900 }}>Cancelar</Text></Pressable>
        ) : (
          <Pressable onPress={() => router.push('/saved' as never)} style={styles.saved} accessibilityRole="button" accessibilityLabel="Guardados"><BookmarkIcon on={false} size={26} color={colors.zinc900} /></Pressable>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
        {focusMode && !searching && (
          <View style={{ paddingTop: 4 }} accessibilityLabel="Pesquisas recentes">
            <View style={{ paddingHorizontal: 20, marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.zinc900 }}>Recentes</Text>
              {recent.length > 0 ? <Pressable onPress={forget} hitSlop={8} accessibilityRole="button"><Text style={{ fontSize: 14, fontWeight: '600', color: colors.brand }}>Limpar tudo</Text></Pressable> : null}
            </View>
            {recent.length === 0 ? (
              <Text style={{ paddingHorizontal: 20, paddingVertical: 24, fontSize: 15, color: colors.zinc500 }}>Ainda não pesquisaste nada. Procura malta, hashtags ou sítios.</Text>
            ) : recent.map((r) => (
              <View key={r} style={styles.recentRow}>
                <Pressable onPress={() => { setText(r); remember(r); }} style={({ pressed }) => [{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={`Pesquisar ${r}`}>
                  <View style={styles.recentIcon}><Icon name={r.startsWith('#') ? 'tag' : r.startsWith('@') ? 'user' : 'clock'} size={18} color={colors.zinc700} /></View>
                  <Text style={{ flex: 1, fontSize: 15, fontWeight: '500', color: colors.zinc900 }} numberOfLines={1}>{r}</Text>
                </Pressable>
                <Pressable onPress={() => forgetOne(r)} hitSlop={8} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel={`Tirar ${r} das recentes`}>
                  <Icon name="x" size={18} color={colors.zinc500} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {!focusMode && !searching && (
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
                  <Pressable key={pl.name} onPress={() => setText(pl.name)} style={[chipBase, { backgroundColor: '#f0f9ff', gap: 6 }]}>
                    <Icon name="map-pin" size={15} color="#075985" /><Text style={{ fontSize: 14, fontWeight: '600', color: '#075985' }}>{pl.name}</Text>
                  </Pressable>
                ))}
                {(trending.data?.tags ?? []).slice(0, 8).map((t) => (
                  <Pressable key={t.tag} onPress={() => router.push(`/tag/${t.tag}` as never)} style={[chipBase, { backgroundColor: colors.zinc100 }]}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.zinc800 }}>#{t.tag}</Text>
                    {t.rising ? <Icon name="trending" size={14} strokeWidth={2.2} color="#ea580c" /> : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {/* À tua volta: o mapa do que há perto (locais, eventos, malta). */}
            <Pressable onPress={() => router.push('/perto' as never)} style={styles.perto} accessibilityRole="link" accessibilityLabel="À tua volta: o que há perto de ti">
              <Icon name="map" size={22} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.zinc900 }}>À tua volta</Text>
                <Text style={{ fontSize: 13, color: colors.zinc500 }}>Locais, eventos e malta perto de ti, no mapa</Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.zinc500} />
            </Pressable>

            {(venues.data?.popular.length ?? 0) > 0 && (
              <View style={{ paddingBottom: 16 }}>
                <View style={{ paddingHorizontal: 20, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.zinc900 }}>Locais para txillar</Text>
                  <Pressable onPress={() => router.push('/locais' as never)} hitSlop={8} accessibilityRole="button"><Text style={{ fontSize: 14, fontWeight: '600', color: colors.brand }}>Os meus</Text></Pressable>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
                  {venues.data!.popular.map((v) => <VenueTile key={v.slug} venue={v} />)}
                </ScrollView>
              </View>
            )}

            {explore.isLoading && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, paddingHorizontal: 2 }}>{Array.from({ length: 9 }, (_, n) => <View key={n} style={{ width: cell, height: cell, backgroundColor: colors.zinc100 }} />)}</View>}
            {grid.length > 0 && block(grid.slice(0, 9), 0)}
            {grid.length > 0 && <Suggestions />}
            {grid.length > 9 && block(grid.slice(9), 9)}
            {explore.isError && grid.length === 0 && (
              // Antes, sem rede, o Explorar ficava em branco (nem grelha, nem aviso).
              <View style={styles.empty} accessibilityRole="alert">
                <Icon name="image" size={36} color={colors.zinc300} />
                <Text style={styles.emptyTitle}>Ups, o Explorar não carregou</Text>
                <Pressable onPress={() => void explore.refetch()} style={styles.more} accessibilityRole="button"><Text style={styles.moreText}>Tentar outra vez</Text></Pressable>
              </View>
            )}
            {explore.isSuccess && grid.length === 0 && (
              <View style={styles.empty}>
                <Icon name="image" size={36} color={colors.zinc300} />
                <Text style={styles.emptyTitle}>Ainda não há publicações para explorar</Text>
                <Text style={styles.emptySub}>Quando a malta publicar, aparece aqui.</Text>
              </View>
            )}
            {explore.hasNextPage && (
              <Pressable onPress={() => void explore.fetchNextPage()} disabled={explore.isFetchingNextPage} style={styles.more}>
                {explore.isFetchingNextPage ? <Text style={styles.moreText}>A carregar…</Text> : <Text style={styles.moreText}>Ver mais</Text>}
              </Pressable>
            )}
          </>
        )}

        {searching && (
          <>
            <View style={styles.tabs} accessibilityRole="tablist">
              {([['people', `Pessoas${q.data ? ` (${people.length})` : ''}`], ['venues', `Locais${q.data ? ` (${foundVenues.length})` : ''}`], ['tags', `#Tags${q.data ? ` (${tags.length})` : ''}`], ['posts', `Publicações${q.data ? ` (${posts.length})` : ''}`], ['mentions', `Menções${mq.data ? ` (${mentions.length})` : ''}`]] as const).map(([k, label]) => (
                <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={[styles.tabBtn, { backgroundColor: tab === k ? colors.zinc900 : colors.zinc100 }]}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: tab === k ? '#fff' : colors.zinc700 }}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {q.isLoading && <ActivityIndicator color={colors.brand} style={{ margin: 40 }} />}
            {q.isError && (
              <View style={{ alignItems: 'center', paddingVertical: 40 }} accessibilityRole="alert">
                <Text style={[styles.emptyTitle, { color: colors.red600 }]}>Ups, a pesquisa falhou</Text>
                <Pressable onPress={() => void q.refetch()} style={styles.more} accessibilityRole="button"><Text style={styles.moreText}>Tentar outra vez</Text></Pressable>
              </View>
            )}

            {q.isSuccess && tab === 'people' && (
              <View style={{ paddingHorizontal: 16 }}>
                {people.length === 0 && <View style={styles.empty}><Icon name="search" size={36} color={colors.zinc300} /><Text style={styles.emptyTitle}>Ninguém com esse nome</Text></View>}
                {people.map((p) => (
                  <View key={p.username} style={styles.person}>
                    <Pressable onPress={() => { remember(term); router.push(`/u/${p.username}` as never); }} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Avatar name={p.displayName} username={p.username} size={48} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <NameWithBadge name={p.displayName} who={p} style={styles.pName} gap={4}>
                          {p.isPrivate && <Icon name="lock" size={14} color={colors.zinc500} />}
                        </NameWithBadge>
                        <Text style={styles.pHandle} numberOfLines={1}>@{p.username}{p.followsYou ? ' · segue-te' : ''}</Text>
                      </View>
                    </Pressable>
                    <View style={{ width: 112, flexShrink: 0, flexDirection: 'row' }}>
                      <FollowButton username={p.username} following={p.following} requested={p.requested} isPrivate={p.isPrivate} />
                    </View>
                  </View>
                ))}
              </View>
            )}

            {q.isSuccess && tab === 'venues' && (
              <View style={{ paddingHorizontal: 16 }}>
                {foundVenues.length === 0 && <View style={styles.empty}><Icon name="map-pin" size={36} color={colors.zinc300} /><Text style={styles.emptyTitle}>Nenhum local com esse nome</Text><Text style={styles.emptySub}>Tens um bar ou restaurante? Cria a página em Definições.</Text></View>}
                {foundVenues.map((v) => <VenueRow key={v.slug} venue={v} onPress={() => { remember(term); router.push({ pathname: '/v/[slug]', params: { slug: v.slug } }); }} />)}
              </View>
            )}

            {q.isSuccess && tab === 'tags' && (
              <View style={{ paddingHorizontal: 16 }}>
                {tags.length === 0 && <View style={styles.empty}><Icon name="tag" size={36} color={colors.zinc300} /><Text style={styles.emptyTitle}>Nenhuma hashtag assim</Text></View>}
                {tags.map((t) => (
                  <Pressable key={t.tag} onPress={() => { remember(term); router.push(`/tag/${t.tag}` as never); }} style={({ pressed }) => [styles.person, { borderRadius: 12 }, pressed && { backgroundColor: colors.zinc100 }]}>
                    <View style={styles.hash}><Text style={styles.hashText}>#</Text></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.pName, { fontSize: 17, fontWeight: '700' }]} numberOfLines={1}>#{t.tag}</Text>
                      <Text style={[styles.pHandle, { color: colors.zinc500 }]}>{t.posts} {t.posts === 1 ? 'publicação' : 'publicações'}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {((q.isSuccess && tab === 'posts') || (mq.isSuccess && tab === 'mentions')) && (
              // Sem FlatList: a página é que rola (um FlatList com scrollEnabled={false} fica com touch-action: none na web e o toque não rolava nada).
              <View style={{ paddingHorizontal: 16 }}>
                {(tab === 'mentions' ? mentions : posts).length === 0 && <View style={styles.empty}><Icon name="inbox" size={36} color={colors.zinc300} /><Text style={styles.emptyTitle}>{none}</Text></View>}
                {(tab === 'mentions' ? mentions : posts).map((p) => (
                  <Pressable key={p.id} onPress={() => { remember(term); setOpened(p); }} style={({ pressed }) => [styles.person, { borderRadius: 16 }, pressed && { backgroundColor: colors.zinc100 }]}>
                    {p.media[0] ? (
                      <Image source={{ uri: sized(p.media[0].kind === 'video' ? p.media[0].posterUrl ?? p.media[0].url : p.media[0].url, 160) }} style={styles.thumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.thumb, { backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' }]}><Icon name="comment" size={24} /></View>
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <NameWithBadge name={p.author.displayName} who={p.author} style={styles.pName} />
                      <Text style={{ fontSize: 14, color: colors.zinc700 }} numberOfLines={2}>{p.body || (p.media.length ? 'Foto' : '')}</Text>
                      <Text style={{ fontSize: 12, color: colors.zinc500 }}>{timeAgo(p.createdAt)}{p.locationLabel ? ` · ${p.locationLabel}` : ''}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
      {viewing && <ExploreViewer items={grid} startId={viewing} onClose={() => setViewing(null)} />}
      {opened && <ExploreViewer items={[opened]} startId={opened.id} title="Publicação" onClose={() => setOpened(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  perto: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 16, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: colors.rose50 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 8, paddingTop: 8 },
  saved: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  field: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12 },
  input: { flex: 1, minWidth: 0, fontSize: 16, padding: 0, color: colors.zinc900, outlineStyle: 'none' } as object,
  tag: { position: 'absolute', right: 6, top: 6 },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 14, paddingVertical: 8 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20 },
  recentIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  tabs: { marginHorizontal: 16, marginBottom: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
