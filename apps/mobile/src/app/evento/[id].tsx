import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { VenueLogo } from '@/components/VenueCard';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { ApiError } from '@/lib/api';
import { locaisApi } from '@/lib/api.locais';
import { directionsUrl, eventWhen, nearbyApi, type EventDetail } from '@/lib/api.nearby';
import { sized } from '@/lib/config';
import { colors } from '@/lib/theme';

/** Um evento num local: capa, quando, onde, "Tenho interesse" e "Ir até lá". */
export default function Evento() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['event', id], queryFn: () => nearbyApi.event(id!), enabled: !!id });
  const ev = q.data;
  const slug = ev?.venue.slug;
  // Quem gere o local pode criar mais eventos daqui.
  const venue = useQuery({ queryKey: ['venue', slug], queryFn: () => locaisApi.venue(slug!), enabled: !!slug, staleTime: 60_000 });
  const more = useQuery({ queryKey: ['venue-events', slug], queryFn: () => nearbyApi.venueEvents(slug!), enabled: !!slug, staleTime: 60_000 });

  const interest = useMutation({
    mutationFn: (on: boolean) => nearbyApi.setInterest(id!, on),
    onMutate: (on) => {
      const prev = qc.getQueryData<EventDetail>(['event', id]);
      if (prev) qc.setQueryData<EventDetail>(['event', id], { ...prev, imInterested: on, interested: Math.max(0, prev.interested + (on ? 1 : -1)) });
      return { prev };
    },
    onError: (e, _on, ctx) => {
      if (ctx?.prev) qc.setQueryData(['event', id], ctx.prev);
      Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : 'Tenta outra vez daqui a pouco.');
    },
    onSuccess: (r) => {
      if (r && typeof r === 'object' && typeof r.interested === 'number') {
        const cur = qc.getQueryData<EventDetail>(['event', id]);
        if (cur) qc.setQueryData<EventDetail>(['event', id], { ...cur, interested: r.interested, imInterested: r.imInterested ?? cur.imInterested });
      }
      void qc.invalidateQueries({ queryKey: ['nearby'] });
    },
  });

  if (q.isLoading) {
    return <StackPage title="Evento"><View style={st.center}><ActivityIndicator /></View></StackPage>;
  }
  if (!ev) {
    return (
      <StackPage title="Evento">
        <View style={st.center}>
          <Icon name="calendar" size={36} color={colors.zinc300} />
          <Text style={st.emptyTitle}>{q.error instanceof ApiError && q.error.status === 404 ? 'Este evento já não existe' : 'Não consegui abrir o evento'}</Text>
          <Pressable onPress={() => void q.refetch()} style={st.ghost}><Text style={st.ghostText}>Tentar outra vez</Text></Pressable>
        </View>
      </StackPage>
    );
  }

  const { lat, lng } = ev.venue;
  const go = lat != null && lng != null ? () => void Linking.openURL(directionsUrl(lat, lng, ev.venue.name, Platform.OS === 'ios')) : null;
  const canCreate = !!venue.data?.canPost || !!venue.data?.mine;
  const others = (more.data ?? []).filter((e) => e.id !== ev.id).slice(0, 6);

  return (
    <StackPage title="Evento">
      <ScrollView contentContainerStyle={{ paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <View style={st.cover}>
          <Icon name="calendar" size={40} color="rgba(255,255,255,0.7)" />
          {ev.coverUrl ? <Image source={{ uri: sized(ev.coverUrl, 1080) }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={`Capa de ${ev.title}`} /> : null}
        </View>
        <View style={{ padding: 16, gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Text style={st.when}>{eventWhen(ev.startsAt, ev.endsAt)}</Text>
            <Text style={st.title}>{ev.title}</Text>
            <Text style={st.sub}>{ev.interested ? `${ev.interested} ${ev.interested === 1 ? 'pessoa tem' : 'pessoas têm'} interesse` : 'Sê o primeiro a mostrar interesse'}</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={() => interest.mutate(!ev.imInterested)}
              disabled={interest.isPending}
              style={[st.btn, ev.imInterested ? st.btnOn : st.btnBrand]}
              accessibilityRole="button"
              accessibilityState={{ selected: ev.imInterested }}
            >
              <Icon name={ev.imInterested ? 'check' : 'star'} size={18} color={ev.imInterested ? colors.zinc900 : colors.white} />
              <Text style={[st.btnText, ev.imInterested && { color: colors.zinc900 }]}>{ev.imInterested ? 'Tens interesse' : 'Tenho interesse'}</Text>
            </Pressable>
            {go ? (
              <Pressable onPress={go} style={[st.btn, st.btnOn]} accessibilityRole="link" accessibilityLabel={`Ir até ${ev.venue.name} na app de mapas`}>
                <Icon name="map-pin" size={18} color={colors.zinc900} />
                <Text style={[st.btnText, { color: colors.zinc900 }]}>Ir até lá</Text>
              </Pressable>
            ) : null}
          </View>

          <Pressable onPress={() => router.push(`/v/${ev.venue.slug}` as never)} style={st.venue} accessibilityRole="link">
            <VenueLogo venue={ev.venue} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={st.venueName} numberOfLines={1}>{ev.venue.name}</Text>
                {ev.venue.verified ? <VerifiedBadge size={14} /> : null}
              </View>
              <Text style={st.sub}>Ver o local</Text>
            </View>
            <Icon name="chevron-right" size={18} color={colors.zinc500} />
          </Pressable>

          {ev.description ? <Text style={st.desc}>{ev.description}</Text> : null}

          {canCreate ? (
            <Pressable onPress={() => router.push(`/evento/novo?venue=${encodeURIComponent(ev.venue.slug)}` as never)} style={[st.btn, st.btnOn, { alignSelf: 'flex-start', flex: 0, paddingHorizontal: 18 }]} accessibilityRole="button">
              <Icon name="plus" size={18} color={colors.zinc900} />
              <Text style={[st.btnText, { color: colors.zinc900 }]}>Criar evento</Text>
            </Pressable>
          ) : null}

          {others.length ? (
            <View style={{ gap: 4, marginTop: 6 }}>
              <Text style={st.section}>Mais em {ev.venue.name}</Text>
              {others.map((o) => (
                <Pressable key={o.id} onPress={() => router.push(`/evento/${o.id}` as never)} style={st.other} accessibilityRole="link">
                  <View style={st.otherThumb}>
                    <Icon name="calendar" size={20} color={colors.white} />
                    {o.coverUrl ? <Image source={{ uri: sized(o.coverUrl, 160) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={st.venueName} numberOfLines={1}>{o.title}</Text>
                    <Text style={st.sub} numberOfLines={1}>{eventWhen(o.startsAt, o.endsAt)}{o.interested ? ` · ${o.interested} com interesse` : ''}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  ghost: { height: 40, paddingHorizontal: 18, borderRadius: 999, backgroundColor: colors.zinc100, justifyContent: 'center' },
  ghostText: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  when: { fontSize: 14, fontWeight: '800', color: colors.brand },
  title: { fontSize: 24, fontWeight: '800', color: colors.zinc900 },
  sub: { fontSize: 13, color: colors.zinc500 },
  btn: { flex: 1, height: 46, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnBrand: { backgroundColor: colors.brand },
  btnOn: { backgroundColor: colors.zinc100 },
  btnText: { fontSize: 15, fontWeight: '700', color: colors.white },
  venue: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200 },
  venueName: { fontSize: 15, fontWeight: '700', color: colors.zinc900, flexShrink: 1 },
  desc: { fontSize: 15, lineHeight: 22, color: colors.zinc800 },
  section: { fontSize: 16, fontWeight: '800', color: colors.zinc900, marginBottom: 4 },
  other: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  otherThumb: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
