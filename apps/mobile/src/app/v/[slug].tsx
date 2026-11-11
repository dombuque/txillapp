import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator, PontoLoader } from '@/components/PontoLoader';
import { Empty } from '@/components/Empty';
import { Icon, type IconName } from '@/components/Icon';
import { PlaceMiniMap } from '@/components/nearby/PlaceMiniMap';
import { PostCard } from '@/components/PostCard';
import { StackPage } from '@/components/StackPage';
import { FollowVenueButton, VenueLogo } from '@/components/VenueCard';
import { VenuePaySheet } from '@/components/VenuePaySheet';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { directionsUrl, eventWhen, nearbyApi } from '@/lib/api.nearby';
import { KIND_LABEL, ROLE_LABEL, locaisApi, type Venue } from '@/lib/api.locais';
import { useAuth } from '@/lib/auth';
import { sized } from '@/lib/config';
import { formatAddress, showsOnMap, validPoint } from '@/lib/placeField';
import { cardShadow, colors } from '@/lib/theme';
import { onPostsViewable, postViewability } from '@/lib/visiblePosts';

type Tab = 'page' | 'people' | 'about';

/**
 * A página de um local (como uma página do Facebook): capa, logótipo, seguir, check-in por QR e três separadores:
 * as publicações da página, as da malta que lá esteve, e o "sobre" (morada, horário, contactos).
 * Quem gere vê o botão Gerir (perfil, gestores, QR, painel).
 */
export default function VenueScreen() {
  // `pagar=1` (e `valor`) abre logo a folha de pagar: o QR de receber do local leva para aqui.
  const { slug = '', k, pagar, valor } = useLocalSearchParams<{ slug: string; k?: string; pagar?: string; valor?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const win = useWindowDimensions();
  const q = useQuery({ queryKey: ['venue', slug], queryFn: () => locaisApi.venue(slug), retry: false });
  const v = q.data;
  const [tab, setTab] = useState<Tab>('page');
  // Próximos eventos do local (os mesmos do mapa À tua volta).
  const events = useQuery({ queryKey: ['venue-events', slug], queryFn: () => nearbyApi.venueEvents(slug), enabled: !!v, staleTime: 60_000, retry: false });
  const pagePosts = useInfiniteQuery({
    queryKey: ['venue-page-posts', slug],
    queryFn: ({ pageParam }) => locaisApi.venuePosts(slug, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: !!v,
    retry: false,
  });
  const peoplePosts = useInfiniteQuery({
    queryKey: ['venue-posts', v?.name],
    queryFn: ({ pageParam }) => locaisApi.placePosts(v!.name, 'at', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: !!v && tab === 'people',
    retry: false,
  });
  const list = tab === 'page' ? pagePosts : peoplePosts;
  const items = tab === 'about' ? [] : (list.data?.pages.flatMap((p) => p.items) ?? []);
  const [used, setUsed] = useState(false);
  const token = used ? undefined : k || undefined;
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<{ preset?: number } | null>(null);
  const linkUsed = useRef(false);
  const canPay = !!v && v.acceptsTxills && !v.mine;

  // Abrir pela ligação /v/<slug>?pagar=1&valor=200 (só uma vez por visita).
  useEffect(() => {
    if (!v || linkUsed.current || pagar !== '1') return;
    linkUsed.current = true;
    if (v.mine) return;
    if (!v.acceptsTxills) { setMsg('Este local ainda não aceita pagamentos em Txills.'); return; }
    const n = Math.floor(Number(valor));
    setPaying({ preset: Number.isFinite(n) && n >= 1 ? n : undefined });
  }, [v, pagar, valor]);

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
  async function answer(accept: boolean) {
    if (!v) return;
    setBusy(true);
    try {
      await locaisApi.answerInvite(slug, accept);
      await qc.invalidateQueries({ queryKey: ['venue', slug] });
      void qc.invalidateQueries({ queryKey: ['venues'] });
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }

  const coverH = Math.min(220, Math.round(win.width * 0.42));
  const head = v && (
    <>
      {v.mine && v.reviewStatus && v.reviewStatus !== 'approved' ? (
        <View style={[st.reviewBox, v.reviewStatus === 'rejected' && { backgroundColor: '#fef2f2' }]} accessibilityRole="alert">
          <Icon name={v.reviewStatus === 'rejected' ? 'alert' : 'clock'} size={20} color={v.reviewStatus === 'rejected' ? colors.red600 : '#b45309'} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={st.reviewTitle}>{v.reviewStatus === 'rejected' ? 'A equipa não aprovou esta página' : 'Página em análise'}</Text>
            <Text style={st.reviewText}>
              {v.reviewStatus === 'rejected'
                ? `${v.reviewNote ? `Motivo: ${v.reviewNote}. ` : ''}Corrige em Gerir e a página volta a ser analisada.`
                : 'A equipa do Txillapp vai ver a página em breve. Até lá só tu e os gestores a veem: aproveita para pôr o logótipo, a morada e o horário.'}
            </Text>
          </View>
        </View>
      ) : null}
      <View style={st.coverWrap}>
        {v.coverUrl ? <Image source={{ uri: sized(v.coverUrl, 1080) }} style={[st.cover, { height: coverH }]} contentFit="cover" /> : <View style={[st.cover, { height: coverH, backgroundColor: colors.zinc900 }]} />}
        <View style={st.logoWrap}><View style={st.logoRing}><VenueLogo venue={v} size={84} /></View></View>
      </View>

      <View style={st.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 36 }}>
          <Text style={st.name} numberOfLines={2}>{v.name}</Text>
          {v.verified && <VerifiedBadge size={20} tier="verified" />}
        </View>
        <Text style={st.sub}>{KIND_LABEL[v.kind] ?? 'Outro'}{v.city ? ` · ${v.city}` : ''}</Text>
        {v.acceptsTxills ? (
          <View style={st.txBadge} accessibilityLabel="Este local aceita pagamentos em Txills">
            <Icon name="wallet" size={14} color={colors.green700} />
            <Text style={st.txBadgeText}>Aceita Txills</Text>
          </View>
        ) : null}
        <View style={{ marginTop: 10, flexDirection: 'row', gap: 20 }}>
          <Text style={st.small}><Text style={st.num}>{v.followers}</Text> {v.followers === 1 ? 'seguidor' : 'seguidores'}</Text>
          <Text style={st.small}><Text style={st.num}>{v.checkins}</Text> check-ins</Text>
          <Text style={st.small}><Text style={st.num}>{v.checkinsToday}</Text> hoje</Text>
        </View>
        {v.about ? <Text style={st.about} numberOfLines={tab === 'about' ? undefined : 3}>{v.about}</Text> : null}

        <View style={{ marginTop: 14, flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><FollowVenueButton venue={v} /></View>
          {v.mine ? (
            <Pressable onPress={() => router.push({ pathname: '/v/[slug]/gerir', params: { slug } })} style={st.manage} accessibilityRole="button">
              <Icon name="settings" size={18} color={colors.zinc900} /><Text style={st.manageText}>Gerir</Text>
            </Pressable>
          ) : null}
          {v.mine && v.canPost ? (
            <Pressable onPress={() => router.push({ pathname: '/new', params: { as: slug } } as never)} style={[st.manage, { backgroundColor: colors.zinc900 }]} accessibilityRole="button" accessibilityLabel="Publicar como este local">
              <Icon name="compose" size={18} color="#fff" /><Text style={[st.manageText, { color: '#fff' }]}>Publicar</Text>
            </Pressable>
          ) : null}
        </View>

        {canPay ? (
          <Pressable onPress={() => setPaying({})} style={({ pressed }) => [st.cta, { backgroundColor: colors.brand }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
            <Icon name="wallet" size={20} color="#fff" />
            <Text style={st.ctaText}>Pagar com Txills</Text>
          </Pressable>
        ) : null}

        {v.invite ? (
          <View style={st.inviteBox}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.zinc900 }}>Convidaram-te para gerir esta página como {ROLE_LABEL[v.invite].toLowerCase()}.</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Pressable onPress={() => void answer(true)} disabled={busy} style={[st.cta, { flex: 1, marginTop: 0, backgroundColor: colors.brand }]}><Text style={st.ctaText}>Aceitar</Text></Pressable>
              <Pressable onPress={() => void answer(false)} disabled={busy} style={[st.cta, { flex: 1, marginTop: 0, backgroundColor: colors.zinc100 }]}><Text style={[st.ctaText, { color: colors.zinc800 }]}>Recusar</Text></Pressable>
            </View>
          </View>
        ) : null}
        {!v.verified && v.mine && <Text style={st.review}>Em análise: a equipa do Txillapp vai verificar o local e dar-lhe o selo.</Text>}

        {token && !v.checkedIn && (
          <Pressable onPress={() => void checkin()} disabled={busy} style={[st.cta, { backgroundColor: colors.brand, opacity: busy ? 0.6 : 1 }]} accessibilityRole="button">
            <Icon name="check-circle" size={20} color="#fff" />
            <Text style={st.ctaText}>Estou aqui: fazer check-in</Text>
          </Pressable>
        )}
        {v.checkedIn && (
          <View style={[st.cta, { backgroundColor: colors.zinc100 }]}>
            <Icon name="check-circle" size={20} color={colors.zinc800} />
            <Text style={[st.ctaText, { color: colors.zinc800 }]}>Já fizeste check-in aqui</Text>
          </View>
        )}
        {!token && !v.checkedIn && <Text style={{ marginTop: 12, fontSize: 12, color: colors.zinc500 }}>Para fazer check-in, lê o QR que está no local.</Text>}
        {msg ? <Text style={{ marginTop: 8, textAlign: 'center', fontSize: 14, fontWeight: '600', color: colors.zinc700 }}>{msg}</Text> : null}
      </View>

      {events.data?.length ? (
        <View style={{ marginTop: 16 }}>
          <Text style={st.sectionTitle}>Próximos eventos</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
            {events.data.map((e) => (
              <Pressable key={e.id} onPress={() => router.push(`/evento/${e.id}` as never)} style={st.event} accessibilityRole="link">
                <View style={st.eventCover}>
                  <Icon name="calendar" size={22} color="rgba(255,255,255,0.7)" />
                  {e.coverUrl ? <Image source={{ uri: sized(e.coverUrl, 480) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                </View>
                <Text style={st.eventWhen} numberOfLines={1}>{eventWhen(e.startsAt, e.endsAt)}</Text>
                <Text style={st.eventTitle} numberOfLines={2}>{e.title}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={st.tabs} accessibilityRole="tablist">
        {([['page', 'Publicações'], ['people', 'A malta aqui'], ['about', 'Sobre']] as const).map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} style={[st.tab, tab === id && st.tabOn]}>
            <Text style={[st.tabText, tab === id && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'about' ? <About v={v} /> : null}
    </>
  );

  const emptyText = tab === 'page'
    ? (v?.canPost ? 'A página ainda não publicou. Toca em Publicar e dá o primeiro sinal de vida.' : 'A página ainda não publicou nada.')
    : 'Ainda ninguém publicou aqui. Sê o primeiro e põe este local nos teus posts.';

  return (
    <StackPage title={v?.name ?? 'Local'}>
      {q.isLoading ? (
        <View style={{ alignItems: 'center', paddingVertical: 64 }}><PontoLoader size={20} /></View>
      ) : q.isError ? (
        <Empty icon="map-pin" title="Este local não existe" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          ListHeaderComponent={head}
          onViewableItemsChanged={onPostsViewable}
          viewabilityConfig={postViewability}
          onEndReached={() => tab !== 'about' && list.hasNextPage && !list.isFetchingNextPage && void list.fetchNextPage()}
          ListEmptyComponent={
            tab === 'about' ? undefined : list.isLoading ? <View style={{ alignItems: 'center', paddingVertical: 40 }}><PontoLoader size={20} /></View> : list.isSuccess ? (
              <Text style={{ marginHorizontal: 24, paddingVertical: 32, textAlign: 'center', fontSize: 16, color: colors.zinc500 }}>{emptyText}</Text>
            ) : undefined
          }
          ListFooterComponent={tab !== 'about' && list.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} color={colors.brand} /> : <View style={{ height: 32 }} />}
          renderItem={({ item }) => <PostCard post={item} me={user?.id} />}
        />
      )}
      {paying && v ? <VenuePaySheet venue={v} preset={paying.preset} onClose={() => setPaying(null)} /> : null}
    </StackPage>
  );
}

/** O separador Sobre: o mapa com o pino e "Como chegar", morada, horário, contactos e quem criou a página. */
function About({ v }: { v: Venue }) {
  const open = (url: string) => void Linking.openURL(url).catch(() => undefined);
  const tel = v.phone?.replace(/[^+0-9]/g, '');
  const wa = v.whatsapp?.replace(/[^0-9]/g, '');
  // O pino só se o local estiver no mapa (quem gere vê-o sempre, com o aviso de que está escondido).
  const hasPoint = validPoint(v.lat, v.lng);
  const pin = hasPoint && (showsOnMap(v) || v.mine);
  const maps = pin ? `https://maps.google.com/?q=${v.lat},${v.lng}` : v.address ? `https://maps.google.com/?q=${encodeURIComponent(formatAddress(v))}` : null;
  const route = pin ? directionsUrl(v.lat as number, v.lng as number, v.name, Platform.OS === 'ios') : null;
  const row = (icon: IconName, label: string, value: string, onPress?: () => void) => (
    <Pressable key={label} onPress={onPress} disabled={!onPress} style={st.aboutRow} accessibilityRole={onPress ? 'link' : undefined}>
      <View style={st.aboutIcon}><Icon name={icon} size={18} color={colors.zinc800} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: colors.zinc500, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Text>
        <Text style={{ fontSize: 15, lineHeight: 21, color: onPress ? colors.brand : colors.zinc900 }}>{value}</Text>
      </View>
      {onPress ? <Icon name="chevron-right" size={18} color={colors.zinc300} /> : null}
    </Pressable>
  );
  const rows = [
    v.address ? row('map-pin', 'Morada', formatAddress(v), maps ? () => open(maps) : undefined) : null,
    !v.address && maps ? row('map-pin', 'Mapa', 'Abrir no mapa', () => open(maps)) : null,
    v.hours ? row('clock', 'Horário', v.hours) : null,
    tel ? row('phone', 'Telefone', v.phone!, () => open(`tel:${tel}`)) : null,
    wa ? row('messages', 'WhatsApp', v.whatsapp!, () => open(`https://wa.me/${wa}`)) : null,
    v.website ? row('globe', 'Site', v.website.replace(/^https?:\/\//, ''), () => open(v.website!)) : null,
    v.owner ? row('user', 'Página criada por', `@${v.owner.username}`) : null,
  ].filter(Boolean);
  return (
    <View style={[st.card, { marginTop: 8 }]}>
      {pin && route ? (
        <View style={{ gap: 10, marginBottom: 12 }}>
          <PlaceMiniMap lat={v.lat as number} lng={v.lng as number} label={`Mapa com o pino em ${v.name}`} />
          {!showsOnMap(v) ? <Text style={{ fontSize: 13, lineHeight: 18, color: colors.zinc500 }}>Só quem gere vê este mapa: o local não aparece no mapa do À tua volta.</Text> : null}
          <Pressable onPress={() => open(route)} style={({ pressed }) => [st.route, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="link" accessibilityLabel={`Como chegar a ${v.name}`}>
            <Icon name="compass" size={18} color="#fff" />
            <Text style={st.routeText}>Como chegar</Text>
          </Pressable>
        </View>
      ) : null}
      {v.about ? <Text style={{ fontSize: 15, lineHeight: 22, color: colors.zinc800, marginBottom: rows.length ? 12 : 0 }}>{v.about}</Text> : null}
      {rows.length ? rows : <Text style={{ fontSize: 14, color: colors.zinc500 }}>{v.canEdit ? 'Completa o perfil em Gerir: morada, horário e contactos.' : 'A página ainda não tem morada nem contactos.'}</Text>}
    </View>
  );
}

const st = StyleSheet.create({
  coverWrap: { marginHorizontal: 16, marginTop: 12 },
  cover: { width: '100%', borderRadius: 24, backgroundColor: colors.zinc100 },
  logoWrap: { position: 'absolute', left: 16, bottom: -36 },
  logoRing: { padding: 4, borderRadius: 30, backgroundColor: colors.white, ...cardShadow },
  card: { marginHorizontal: 16, marginTop: 12, borderRadius: 24, backgroundColor: colors.white, padding: 16, ...cardShadow },
  name: { flexShrink: 1, fontSize: 24, lineHeight: 29, fontWeight: '800', color: colors.zinc900 },
  sub: { marginTop: 2, fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  about: { marginTop: 12, fontSize: 15, lineHeight: 22, color: colors.zinc800 },
  small: { fontSize: 14, color: colors.zinc600 },
  num: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  manage: { height: 38, borderRadius: 999, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.zinc100 },
  manageText: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  inviteBox: { marginTop: 14, borderRadius: 16, backgroundColor: colors.rose50, padding: 14 },
  review: { marginTop: 12, borderRadius: 16, backgroundColor: '#fffbeb', paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontWeight: '500', color: '#78350f', overflow: 'hidden' },
  cta: { marginTop: 16, height: 48, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  txBadge: { marginTop: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, backgroundColor: '#f0fdf4', paddingHorizontal: 10, paddingVertical: 4 },
  txBadgeText: { fontSize: 13, fontWeight: '700', color: colors.green700 },
  sectionTitle: { marginHorizontal: 16, marginBottom: 8, fontSize: 16, fontWeight: '800', color: colors.zinc900 },
  event: { width: 200, borderRadius: 20, backgroundColor: colors.white, padding: 8, ...cardShadow },
  eventCover: { height: 100, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.zinc900, alignItems: 'center', justifyContent: 'center' },
  eventWhen: { marginTop: 8, marginHorizontal: 4, fontSize: 12, fontWeight: '700', color: colors.brand },
  eventTitle: { marginTop: 2, marginHorizontal: 4, marginBottom: 4, fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  tabs: { marginHorizontal: 16, marginTop: 16, marginBottom: 8, flexDirection: 'row', gap: 8 },
  tab: { flex: 1, height: 38, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.zinc900 },
  tabText: { fontSize: 14, fontWeight: '700', color: colors.zinc700 },
  route: { height: 44, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.zinc900 },
  routeText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  aboutIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  reviewBox: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginHorizontal: 16, marginTop: 12, marginBottom: 4, borderRadius: 16, backgroundColor: '#fffbeb', paddingHorizontal: 16, paddingVertical: 12 },
  reviewTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  reviewText: { fontSize: 14, lineHeight: 19, color: colors.zinc700 },
});
