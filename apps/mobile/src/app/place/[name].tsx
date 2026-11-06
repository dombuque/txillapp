import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Empty } from '@/components/Empty';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { StackPage } from '@/components/StackPage';
import { locaisApi } from '@/lib/api.locais';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/** Publicações de um sítio: "Neste sítio" (o mesmo nome) e "Perto" (até 10 km). */
export default function PlaceScreen() {
  const { name = '' } = useLocalSearchParams<{ name: string }>();
  const router = useRouter();
  const { user } = useAuth();
  let label = name;
  try {
    label = decodeURIComponent(name);
  } catch {
    /* já vem descodificado */
  }
  const [mode, setMode] = useState<'at' | 'near'>('at');
  const q = useInfiniteQuery({
    queryKey: ['place', label.toLowerCase(), mode],
    queryFn: ({ pageParam }) => locaisApi.placePosts(label, mode, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    retry: false,
  });
  const venue = useQuery({ queryKey: ['venue-by-name', label.toLowerCase()], queryFn: () => locaisApi.findVenue(label), staleTime: 5 * 60_000, retry: false });
  const first = q.data?.pages[0];
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const vd = venue.data;

  const head = (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      {vd && (
        <Pressable onPress={() => router.push({ pathname: '/v/[slug]', params: { slug: vd.slug } })} style={st.venue} accessibilityRole="link">
          <Icon name="check-circle" size={22} color="#fff" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Página do local{vd.verified ? ' · Verificado' : ''}</Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.7)' }}>{vd.checkins} check-ins</Text>
          </View>
          <Icon name="chevron-right" size={20} color="rgba(255,255,255,0.6)" />
        </Pressable>
      )}
      <View accessibilityRole="tablist" style={{ marginVertical: 16, flexDirection: 'row', gap: 8 }}>
        {([['at', 'Neste sítio'], ['near', 'Perto']] as const).map(([k, text]) => {
          const dis = k === 'near' && !!first && !first.hasNear;
          return (
            <Pressable key={k} onPress={() => setMode(k)} disabled={dis} accessibilityRole="tab" accessibilityState={{ selected: mode === k, disabled: dis }} style={[st.tab, mode === k && { backgroundColor: colors.zinc900 }, dis && { opacity: 0.4 }]}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: mode === k ? '#fff' : colors.zinc800 }}>{text}</Text>
            </Pressable>
          );
        })}
      </View>
      {first && !first.hasNear && <Text style={{ marginBottom: 12, fontSize: 14, lineHeight: 20, color: colors.zinc500 }}>Ainda não há publicações com a posição deste sítio, por isso não dá para ver o que há por perto.</Text>}
    </View>
  );

  return (
    <StackPage title={label}>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={head}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        ListEmptyComponent={
          q.isLoading ? <ActivityIndicator style={{ marginTop: 48 }} color={colors.brand} /> : q.isError ? (
            <Empty icon="map-pin" title="Não consegui ver este sítio agora" />
          ) : (
            <Empty icon="map-pin" title={mode === 'at' ? 'Ainda ninguém publicou aqui' : 'Nada por perto, por agora'} />
          )
        }
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} color={colors.brand} /> : <View style={{ height: 32 }} />}
        renderItem={({ item }) => <PostCard post={item} me={user?.id} />}
      />
    </StackPage>
  );
}

const st = StyleSheet.create({
  venue: { marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: colors.zinc900, paddingHorizontal: 16, paddingVertical: 12 },
  tab: { flex: 1, borderRadius: 999, backgroundColor: colors.zinc100, paddingVertical: 10, alignItems: 'center' },
});
