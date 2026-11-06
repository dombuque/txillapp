import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Empty } from '@/components/Empty';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { StackPage } from '@/components/StackPage';
import { VenueQr } from '@/components/VenueQr';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { KIND_LABEL, locaisApi } from '@/lib/api.locais';
import { useAuth } from '@/lib/auth';
import { cardShadow, colors } from '@/lib/theme';

/** A página de um local (bar, restaurante…): quem lá esteve, as publicações feitas ali e o check-in por QR. */
export default function VenueScreen() {
  const { slug = '', k } = useLocalSearchParams<{ slug: string; k?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['venue', slug], queryFn: () => locaisApi.venue(slug), retry: false });
  const v = q.data;
  const posts = useInfiniteQuery({
    queryKey: ['venue-posts', v?.name],
    queryFn: ({ pageParam }) => locaisApi.placePosts(v!.name, 'at', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: !!v,
    retry: false,
  });
  const items = posts.data?.pages.flatMap((p) => p.items) ?? [];
  const [used, setUsed] = useState(false);
  const token = used ? undefined : k || undefined;
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function checkin() {
    if (!token || !v) return;
    setBusy(true);
    setMsg('');
    try {
      await locaisApi.venueCheckin(slug, token);
      setUsed(true);
      setMsg('Check-in feito! Bom proveito.');
      await qc.invalidateQueries({ queryKey: ['venue', slug] });
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }

  const head = v && (
    <>
      <View style={st.card}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={st.pin}><Icon name="map-pin" size={26} color="#fff" /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ flexShrink: 1, fontSize: 22, lineHeight: 27, fontWeight: '800', color: colors.zinc900 }} numberOfLines={1}>{v.name}</Text>
              {v.verified && <VerifiedBadge size={18} tier="verified" />}
            </View>
            <Text style={{ fontSize: 14, lineHeight: 20, color: colors.zinc600 }}>{KIND_LABEL[v.kind] ?? 'Outro'}{v.city ? ` · ${v.city}` : ''}</Text>
          </View>
        </View>
        {v.about ? <Text style={{ marginTop: 12, fontSize: 15, lineHeight: 22, color: colors.zinc800 }}>{v.about}</Text> : null}
        <View style={{ marginTop: 12, flexDirection: 'row', gap: 24 }}>
          <Text style={st.small}><Text style={st.num}>{v.checkins}</Text> check-ins</Text>
          <Text style={st.small}><Text style={st.num}>{v.checkinsToday}</Text> nas últimas 24 h</Text>
        </View>
        {!v.verified && v.mine && <Text style={st.review}>Em análise: a equipa do Txillapp vai verificar o teu local e dar-lhe o selo.</Text>}

        {token && !v.checkedIn && (
          <Pressable onPress={() => void checkin()} disabled={busy} style={[st.cta, { backgroundColor: colors.brand, opacity: busy ? 0.6 : 1 }]} accessibilityRole="button">
            <Icon name="check-circle" size={20} color="#fff" />
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Estou aqui: fazer check-in</Text>
          </Pressable>
        )}
        {v.checkedIn && (
          <View style={[st.cta, { backgroundColor: colors.zinc100 }]}>
            <Icon name="check-circle" size={20} color={colors.zinc800} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.zinc800 }}>Já fizeste check-in aqui</Text>
          </View>
        )}
        {!token && !v.checkedIn && <Text style={{ marginTop: 12, fontSize: 12, color: colors.zinc500 }}>Para fazer check-in, lê o QR que está no local.</Text>}
        {msg ? <Text style={{ marginTop: 8, textAlign: 'center', fontSize: 14, fontWeight: '600', color: colors.zinc700 }}>{msg}</Text> : null}
      </View>

      {v.mine && v.qrToken ? <VenueQr venue={v} /> : null}

      <Text style={{ marginHorizontal: 20, marginTop: 24, marginBottom: 8, fontSize: 18, fontWeight: '800', color: colors.zinc900 }}>Publicações deste local</Text>
    </>
  );

  return (
    <StackPage title={v?.name ?? 'Local'}>
      {q.isLoading ? (
        <ActivityIndicator style={{ marginTop: 64 }} color={colors.brand} />
      ) : q.isError ? (
        <Empty icon="map-pin" title="Este local não existe" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          ListHeaderComponent={head}
          onEndReached={() => posts.hasNextPage && !posts.isFetchingNextPage && void posts.fetchNextPage()}
          ListEmptyComponent={
            posts.isLoading ? <ActivityIndicator style={{ margin: 40 }} color={colors.brand} /> : posts.isSuccess ? (
              <Text style={{ marginHorizontal: 24, paddingVertical: 32, textAlign: 'center', fontSize: 16, color: colors.zinc500 }}>Ainda ninguém publicou aqui. Sê o primeiro e põe este local nos teus posts.</Text>
            ) : undefined
          }
          ListFooterComponent={posts.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} color={colors.brand} /> : <View style={{ height: 32 }} />}
          renderItem={({ item }) => <PostCard post={item} me={user?.id} />}
        />
      )}
    </StackPage>
  );
}

const st = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 16, borderRadius: 24, backgroundColor: colors.white, padding: 16, ...cardShadow },
  pin: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.zinc900, alignItems: 'center', justifyContent: 'center' },
  small: { fontSize: 14, color: colors.zinc600 },
  num: { fontSize: 18, fontWeight: '700', color: colors.zinc900 },
  review: { marginTop: 12, borderRadius: 16, backgroundColor: '#fffbeb', paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontWeight: '500', color: '#78350f', overflow: 'hidden' },
  cta: { marginTop: 16, height: 48, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
