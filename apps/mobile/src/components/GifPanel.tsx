import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { ActivityIndicator } from '@/components/PontoLoader';
import { gifsApi } from '@/lib/api.gifs';
import { GIF_DEBOUNCE_MS, columnsFor, gifColumns, gifLabel, gifQuery, gifSize, mergeGifs, type ChatGif, type GifItem } from '@/lib/gifs';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';

/** Os GIFs estão ligados no servidor (há chave do GIPHY)? Sem isso, nada de GIFs na app. */
export function useGifsConfig() {
  const q = useQuery({ queryKey: ['gifs-config'], queryFn: gifsApi.config, staleTime: 10 * 60_000, gcTime: 60 * 60_000, retry: 1 });
  return { enabled: q.data?.enabled === true, channel: q.data?.channel ?? null };
}

/**
 * Um GIF já enviado (num comentário): a imagem animada na proporção dele, dentro de maxW × maxH, com cantos arredondados.
 * "Reduzir movimento": parado.
 */
export function GifView({ gif, maxW = 220, maxH = 220 }: { gif: ChatGif; maxW?: number; maxH?: number }) {
  const reduce = useReducedMotion();
  const size = gifSize(gif.w, gif.h, maxW, maxH, 100);
  return (
    <View style={[st.view, size]} accessible accessibilityRole="image" accessibilityLabel={gifLabel(gif.title)}>
      <Image source={{ uri: reduce && gif.still ? gif.still : gif.url }} autoplay={!reduce} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={gif.id} accessibilityIgnoresInvertColors />
    </View>
  );
}

const GAP = 4;
const PAD = 8;

/**
 * Painel dos GIFs (dentro do painel dos stickers): pesquisa com debounce, "Em alta" sem pesquisa e "Txillapp" (o canal do
 * Txillapp no GIPHY) se houver. Grelha em colunas pela proporção de cada GIF e mais GIFs ao chegar ao fim. Tocar envia.
 * "Powered by GIPHY" por baixo (a atribuição que o GIPHY pede). Com "Reduzir movimento", os GIFs aparecem parados.
 */
export function GifPanel({ onPick, height = 300 }: { onPick: (g: GifItem) => void; height?: number }) {
  const { channel } = useGifsConfig();
  const reduce = useReducedMotion();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'trending' | 'channel'>('trending');
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setQ(gifQuery(text)), GIF_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);
  const mode = q ? 'search' : tab === 'channel' && channel ? 'channel' : 'trending';
  const list = useInfiniteQuery({
    queryKey: ['gifs', mode, q],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => (mode === 'search' ? gifsApi.search(q, pageParam) : mode === 'channel' ? gifsApi.channel(pageParam) : gifsApi.trending(pageParam)),
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 5 * 60_000,
  });
  const items = useMemo(() => (list.data?.pages ?? []).reduce<GifItem[]>((acc, p) => mergeGifs(acc, p.items ?? []), []), [list.data]);
  const cols = columnsFor(width);
  const colWidth = width > 0 ? (width - PAD * 2 - GAP * (cols - 1)) / cols : 0;
  const grid = useMemo(() => (colWidth > 0 ? gifColumns(items, cols, colWidth, GAP) : []), [items, cols, colWidth]);
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 240 && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }

  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={st.search}>
        <Icon name="search" size={18} color={colors.zinc500} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Procurar no GIPHY"
          placeholderTextColor={colors.zinc500}
          style={st.input}
          maxLength={50}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Procurar GIFs"
        />
        {text ? (
          <Pressable onPress={() => setText('')} hitSlop={8} style={st.clear} accessibilityRole="button" accessibilityLabel="Limpar a pesquisa">
            <Icon name="x" size={16} color={colors.zinc500} />
          </Pressable>
        ) : null}
      </View>
      {!q && channel ? (
        <View style={st.tabs}>
          {([['trending', 'Em alta'], ['channel', 'Txillapp']] as const).map(([id, label]) => (
            <Pressable key={id} onPress={() => setTab(id)} hitSlop={{ top: 6, bottom: 6 }} style={[st.tab, { backgroundColor: tab === id ? colors.brand : colors.white }]} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} accessibilityLabel={id === 'channel' ? 'GIFs Txillapp' : 'GIFs em alta'}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: tab === id ? '#fff' : colors.zinc700 }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={st.heading}>{q ? `GIFs de “${q}”` : 'Em alta'}</Text>
      )}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: PAD }} onScroll={onScroll} scrollEventThrottle={64} keyboardShouldPersistTaps="handled">
        {list.isLoading ? (
          <ActivityIndicator color={colors.brand} style={{ margin: 24 }} />
        ) : !items.length ? (
          <Text style={st.empty}>{list.isError ? 'Não consegui carregar os GIFs. Tenta daqui a pouco.' : q ? 'Nenhum GIF encontrado.' : 'Sem GIFs agora. Tenta daqui a pouco.'}</Text>
        ) : (
          <View style={{ flexDirection: 'row', gap: GAP }}>
            {grid.map((col, i) => (
              <View key={i} style={{ width: colWidth, gap: GAP }}>
                {col.items.map(({ item, height: h }) => (
                  <Pressable
                    key={item.id}
                    onPress={() => onPick(item)}
                    style={({ pressed }) => [st.cell, { height: Math.max(h, 44) }, pressed && { opacity: 0.7 }]}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={`Enviar ${gifLabel(item.title)}`}
                  >
                    <Image
                      source={{ uri: reduce && item.still ? item.still : item.preview }}
                      autoplay={!reduce}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      recyclingKey={item.id}
                      accessibilityIgnoresInvertColors
                    />
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        )}
        {list.isFetchingNextPage ? <ActivityIndicator color={colors.brand} style={{ margin: 12 }} /> : null}
      </ScrollView>
      {/* Atribuição pedida pelo GIPHY (em texto: não carregamos o logótipo de terceiros). */}
      <Text style={st.powered} accessibilityLabel="Powered by GIPHY">Powered by GIPHY</Text>
    </View>
  );
}

const st = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 8, marginTop: 8, height: 44, borderRadius: 22, backgroundColor: colors.white, paddingLeft: 14, paddingRight: 4, borderWidth: 1, borderColor: colors.zinc200 },
  input: { flex: 1, minWidth: 0, height: 44, fontSize: 15, color: colors.zinc900, outlineStyle: 'none' } as object,
  clear: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingTop: 8 },
  tab: { height: 32, borderRadius: 16, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  heading: { paddingHorizontal: 14, paddingTop: 8, fontSize: 13, fontWeight: '700', color: colors.zinc700 },
  view: { overflow: 'hidden', borderRadius: 14, backgroundColor: colors.zinc200 },
  cell: { width: '100%', overflow: 'hidden', borderRadius: 8, backgroundColor: colors.zinc200 },
  empty: { textAlign: 'center', padding: 24, fontSize: 14, color: colors.zinc500 },
  powered: { textAlign: 'center', paddingVertical: 4, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: colors.zinc500 },
});
