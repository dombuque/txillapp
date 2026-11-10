import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, AppState, FlatList, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { FillView } from '@/components/FillView';
import { Icon, type IconName } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Sheet } from '@/components/Sheet';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { NearbyMap } from '@/components/nearby/NearbyMap';
import type { MapMarker, MapMarkerKind } from '@/components/nearby/types';
import { ApiError, api } from '@/lib/api';
import { KIND_LABEL } from '@/lib/api.locais';
import { eventWhen, kmLabel, nearbyApi, round2, type NearbyGroup, type NearbyKind, type NearbyResult, type NearbyVisibility, type NearbyWhen } from '@/lib/api.nearby';
import { SITE_URL, sized } from '@/lib/config';
import { useDesktop } from '@/lib/desktop';
import { kvGet, kvSet } from '@/lib/kv';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

/** Cidades para quem não quer dar a localização (coordenadas do centro, já arredondadas). */
const CITIES: { name: string; lat: number; lng: number }[] = [
  { name: 'Maputo', lat: -25.97, lng: 32.57 },
  { name: 'Matola', lat: -25.96, lng: 32.46 },
  { name: 'Beira', lat: -19.84, lng: 34.84 },
  { name: 'Nampula', lat: -15.12, lng: 39.27 },
  { name: 'Inhambane', lat: -23.87, lng: 35.38 },
  { name: 'Tofo', lat: -23.85, lng: 35.54 },
  { name: 'Xai-Xai', lat: -25.05, lng: 33.64 },
  { name: 'Pemba', lat: -12.97, lng: 40.52 },
  { name: 'Quelimane', lat: -17.88, lng: 36.89 },
  { name: 'Tete', lat: -16.16, lng: 33.59 },
];
const PLACE_KEY = 'txill.perto.place';
const RADII = [5, 10, 20, 30] as const;
type Filter = 'all' | 'venues' | 'events' | 'people' | 'posts' | 'groups';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tudo' },
  { key: 'venues', label: 'Locais' },
  { key: 'events', label: 'Eventos' },
  { key: 'people', label: 'A malta' },
  // Publicações (fotos e vídeos) das últimas 48 h perto daqui. Chamava-se "Agora" e confundia-se com o "Agora" dos eventos.
  { key: 'posts', label: 'Publicações' },
  { key: 'groups', label: 'TxillGroups' },
];
const KINDS: Record<Filter, NearbyKind[]> = {
  all: ['venues', 'events', 'posts', 'groups', 'people'],
  venues: ['venues'],
  events: ['events'],
  people: ['people'],
  posts: ['posts'],
  groups: ['groups'],
};
const WHENS: { key: NearbyWhen; label: string }[] = [
  { key: 'now', label: 'A decorrer' },
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Esta semana' },
];
const VIS: { key: NearbyVisibility; label: string; sub: string }[] = [
  { key: 'off', label: 'Ninguém', sub: 'Ficas invisível. Vês na mesma o que há à volta.' },
  { key: 'mutual', label: 'Amigos mútuos', sub: 'Só quem segues e te segue de volta.' },
  { key: 'following', label: 'Quem eu sigo', sub: 'As pessoas que tu segues.' },
];

type Place = { lat: number; lng: number; label: string; gps: boolean };
interface Item {
  key: string;
  kind: MapMarkerKind;
  title: string;
  sub: string;
  image: string | null;
  distanceKm: number;
  lat: number;
  lng: number;
  date?: string;
  verified?: boolean;
  username?: string;
  group?: NearbyGroup;
  to?: string;
}

/** "há 20 min": o servidor pode mandar uma data, minutos ou o texto já feito. */
function agoText(ago: string | number): string {
  if (typeof ago === 'number') return ago < 1 ? 'agora mesmo' : ago < 60 ? `há ${Math.round(ago)} min` : `há ${Math.round(ago / 60)} h`;
  if (/^\d{4}-\d\d-\d\d/.test(ago)) {
    const t = timeAgo(ago);
    return t === 'Agora' ? 'agora mesmo' : t.replace(/^Há (\d+)(min|h|d)$/, (_m, n: string, u: string) => `há ${n} ${u}`);
  }
  if (/^agora/i.test(ago)) return 'agora mesmo';
  return /^há /i.test(ago) ? ago : `há ${ago}`;
}

function toItems(d: NearbyResult | undefined): Item[] {
  if (!d) return [];
  const out: Item[] = [];
  for (const v of d.venues ?? [])
    out.push({
      key: `v:${v.slug}`, kind: 'venue', title: v.name, image: sized(v.avatarUrl, 120) ?? null, distanceKm: v.distanceKm, lat: v.lat, lng: v.lng, verified: v.verified, to: `/v/${v.slug}`,
      sub: [KIND_LABEL[v.kind] ?? 'Local', v.checkinsToday ? `${v.checkinsToday} check-in${v.checkinsToday === 1 ? '' : 's'} hoje` : null, v.acceptsTxills ? 'aceita Txills' : null].filter(Boolean).join(' · '),
    });
  for (const e of d.events ?? [])
    out.push({
      key: `e:${e.id}`, kind: 'event', title: e.title, image: sized(e.coverUrl, 160) ?? null, distanceKm: e.distanceKm, lat: e.venue.lat, lng: e.venue.lng, date: e.startsAt, to: `/evento/${e.id}`,
      sub: [eventWhen(e.startsAt, e.endsAt), e.venue.name, e.interested ? `${e.interested} com interesse` : null].filter(Boolean).join(' · '),
    });
  for (const p of d.posts ?? [])
    out.push({
      key: `p:${p.id}`, kind: 'post', title: p.locationLabel || p.author.displayName, image: sized(p.thumbUrl, 160) ?? null, distanceKm: p.distanceKm, lat: p.lat, lng: p.lng, to: `/p/${p.code}`,
      sub: [`@${p.author.username}`, p.kind === 'video' ? 'vídeo' : 'foto', agoText(p.createdAt)].join(' · '),
    });
  for (const g of d.groups ?? [])
    out.push({
      key: `g:${g.id}`, kind: 'group', title: g.name, image: sized(g.coverUrl, 160) ?? null, distanceKm: g.distanceKm, lat: g.lat, lng: g.lng, group: g,
      sub: ['TxillGroup', `${g.members} ${g.members === 1 ? 'membro' : 'membros'}`, g.destination].filter(Boolean).join(' · '),
    });
  for (const u of d.people ?? [])
    out.push({
      key: `u:${u.username}`, kind: 'person', title: u.displayName, username: u.username, image: u.hasAvatar ? `${SITE_URL}/api/v1/avatars/${encodeURIComponent(u.username)}` : null,
      distanceKm: u.approxKm, lat: u.lat, lng: u.lng, to: `/u/${u.username}`, sub: `perto de ti · ${agoText(u.ago)}`,
    });
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

/** "À tua volta": mapa com o que se passa perto (locais, eventos, malta, publicações e TxillGroups), dentro do raio escolhido. */
export default function Perto() {
  const router = useRouter();
  const desktop = useDesktop();
  const qc = useQueryClient();
  const [place, setPlace] = useState<Place | null>(null);
  const [ask, setAsk] = useState<'checking' | 'explain' | 'cities' | 'locating' | null>('checking');
  const [radius, setRadius] = useState<number>(10);
  const [filter, setFilter] = useState<Filter>('all');
  const [when, setWhen] = useState<NearbyWhen>('today');
  const [selected, setSelected] = useState<string | null>(null);
  const [placeSheet, setPlaceSheet] = useState(false);
  const [visSheet, setVisSheet] = useState(false);
  const [hideCard, setHideCard] = useState(false);
  const [groupInfo, setGroupInfo] = useState<NearbyGroup | null>(null);

  // ----- Onde estou: GPS (se deixares) ou a cidade escolhida -----
  const locate = useCallback(async (requestIfNeeded: boolean) => {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted && requestIfNeeded && perm.canAskAgain !== false) perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return false;
      setAsk('locating');
      const last = Platform.OS === 'web' ? null : await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
      const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      // Arredondado logo aqui: a posição exata nunca sai deste ecrã.
      setPlace({ lat: round2(pos.coords.latitude), lng: round2(pos.coords.longitude), label: 'Perto de mim', gps: true });
      setAsk(null);
      void kvSet(PLACE_KEY, 'gps');
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const saved = await kvGet(PLACE_KEY);
      const city = CITIES.find((c) => c.name === saved);
      if (!alive) return;
      if (city) {
        setPlace({ lat: city.lat, lng: city.lng, label: city.name, gps: false });
        setAsk(null);
        return;
      }
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!alive) return;
      if (perm?.granted && (await locate(false))) return;
      if (alive) setAsk(perm && !perm.granted && perm.canAskAgain === false ? 'cities' : 'explain');
    })();
    return () => {
      alive = false;
    };
  }, [locate]);

  const goMine = async () => {
    setPlaceSheet(false);
    const ok = await locate(true);
    if (!ok) {
      setAsk(place ? null : 'cities');
      if (place) Alert.alert('Sem localização', 'Não consegui saber onde estás. Escolhe uma cidade ou liga a localização nas definições do telemóvel.');
    }
  };
  const pickCity = (c: (typeof CITIES)[number]) => {
    setPlace({ lat: c.lat, lng: c.lng, label: c.name, gps: false });
    setAsk(null);
    setPlaceSheet(false);
    void kvSet(PLACE_KEY, c.name);
  };

  // ----- O que há à volta -----
  const kinds = KINDS[filter];
  const q = useQuery({
    queryKey: ['nearby', place?.lat, place?.lng, radius, kinds.join(','), when],
    queryFn: () => nearbyApi.around({ lat: place!.lat, lng: place!.lng, radiusKm: radius, kinds, when }),
    enabled: !!place,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const items = useMemo(() => toItems(q.data), [q.data]);
  const markers = useMemo<MapMarker[]>(() => items.map((i) => ({ id: i.key, kind: i.kind, lat: i.lat, lng: i.lng, title: i.title, image: i.image, date: i.date ?? null })), [items]);
  const center = useMemo(() => (place ? { lat: place.lat, lng: place.lng } : { lat: -25.97, lng: 32.57 }), [place]);

  // ----- Aparecer em À tua volta (a malta) -----
  const vis = useQuery({ queryKey: ['nearby-settings'], queryFn: nearbyApi.settings, staleTime: 5 * 60_000, retry: false });
  const visibility: NearbyVisibility | null = vis.data?.visibility ?? null;
  const setVis = useMutation({
    mutationFn: (v: NearbyVisibility) => nearbyApi.setSettings(v),
    onSuccess: (r, v) => {
      qc.setQueryData(['nearby-settings'], { ...(vis.data ?? {}), visibility: r?.visibility ?? v });
      if (v === 'off') void nearbyApi.clearPresence().catch(() => undefined);
      setVisSheet(false);
      void qc.invalidateQueries({ queryKey: ['nearby'] });
    },
    onError: (e) => Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : 'Não consegui mudar isto agora. Tenta outra vez.'),
  });
  const visible = visibility === 'mutual' || visibility === 'following';
  // Menores de 18 não podem aparecer: o servidor diz canEnable = false e escondemos o cartão e o botão.
  const canEnable = vis.data?.canEnable !== false;

  // Presença: só com a localização do telemóvel, com o ecrã aberto e a app à frente; no máximo uma vez por minuto.
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const s = AppState.addEventListener('change', (st) => setActive(st === 'active'));
    return () => s.remove();
  }, []);
  const placeRef = useRef(place);
  placeRef.current = place;
  const sendPresence = visible && focused && active && !!place?.gps;
  useEffect(() => {
    if (!sendPresence) return;
    const tick = () => {
      const p = placeRef.current;
      if (p?.gps) void nearbyApi.presence(p.lat, p.lng).catch(() => undefined);
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [sendPresence]);

  // ----- Abrir um item -----
  const groups = useQuery({ queryKey: ['chat-groups'], queryFn: api.chatGroups, staleTime: 60_000, enabled: items.some((i) => i.kind === 'group') });
  const open = (it: Item) => {
    if (it.kind === 'group' && it.group) {
      const member = it.group.isMember ?? (groups.data ?? []).some((g) => g.id === it.group!.id);
      if (member) router.push(`/messages/g/${it.group.id}` as never);
      else setGroupInfo(it.group);
      return;
    }
    if (it.to) router.push(it.to as never);
  };

  // ----- Partes do ecrã -----
  const eyeButton =
    visibility === null || (!canEnable && !visible) ? null : (
      <Pressable
        onPress={() => (visible ? setVis.mutate('off') : setVisSheet(true))}
        disabled={setVis.isPending}
        style={[st.eye, visible && { backgroundColor: colors.rose50 }]}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Estás visível. Tocar para ficar invisível' : 'Estás invisível. Escolher quem te vê'}
        hitSlop={6}
      >
        <Icon name={visible ? 'eye' : 'eye-off'} size={18} color={visible ? colors.brand : colors.zinc700} />
        <Text style={[st.eyeText, visible && { color: colors.brand }]}>{visible ? 'Visível' : 'Invisível'}</Text>
      </Pressable>
    );

  // ----- Filtros: uma só fila (zona e distância num chip que abre a folha "Onde procurar", depois o que mostrar) -----
  const zoneLabel = place ? `${place.label} · ${radius} km` : '';
  const zonePill = place ? (
    <Pressable
      onPress={() => setPlaceSheet(true)}
      style={({ pressed }) => [st.zone, pressed && { backgroundColor: colors.zinc100 }]}
      accessibilityRole="button"
      accessibilityLabel={`Zona: ${place.label}, até ${radius} km. Mudar o sítio ou a distância`}
    >
      <Icon name={place.gps ? 'locate' : 'map-pin'} size={16} color={colors.brand} />
      <Text style={st.zoneText} numberOfLines={1}>{zoneLabel}</Text>
      <View style={st.zoneCaret}><Icon name="chevron-right" size={14} strokeWidth={2.4} color={colors.zinc500} /></View>
    </Pressable>
  ) : null;

  const chips = (
    <View style={st.filters}>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chipRow}>
          {zonePill}
          <View style={st.chipSep} />
          <View style={st.chipGroup} accessibilityRole="radiogroup" accessibilityLabel="Mostrar">
            {FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} on={filter === f.key} onPress={() => { setFilter(f.key); setSelected(null); }} dark />
            ))}
          </View>
        </ScrollView>
        {/* Esbatido à direita: a fila continua para o lado sem um chip cortado a seco. */}
        <LinearGradient pointerEvents="none" colors={['rgba(255,255,255,0)', colors.white]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.chipFade} />
      </View>
      {/* Quando (só dos eventos): só aparece com "Eventos" escolhido. Com "Tudo" vale o que estiver escolhido (de início, Hoje). */}
      {filter === 'events' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chipRow}>
          <Icon name="calendar" size={15} color={colors.zinc500} />
          <View style={st.chipGroup} accessibilityRole="radiogroup" accessibilityLabel="Quando">
            {WHENS.map((w) => (
              <Chip key={w.key} label={w.label} on={when === w.key} onPress={() => setWhen(w.key)} small soft />
            ))}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );

  const card =
    visibility === 'off' && canEnable && !hideCard && (filter === 'all' || filter === 'people') ? (
      <VisibilityCard onPick={(v) => setVis.mutate(v)} busy={setVis.isPending} gps={!!place?.gps} onLater={() => setHideCard(true)} />
    ) : null;

  const listEmpty = q.isLoading ? (
    <View style={st.center}><ActivityIndicator /></View>
  ) : q.isError ? (
    <View style={st.center}>
      <Text style={st.emptyTitle}>Não consegui ver o que há à volta</Text>
      <Pressable onPress={() => void q.refetch()} style={st.retry}><Text style={st.retryText}>Tentar outra vez</Text></Pressable>
    </View>
  ) : (
    <View style={st.center}>
      <Icon name="map" size={34} color={colors.zinc300} />
      <Text style={st.emptyTitle}>Por aqui está calmo</Text>
      <Text style={st.emptySub}>{radius < 30 ? 'Aumenta o raio ou troca o filtro.' : 'Troca o filtro ou volta mais logo.'}</Text>
    </View>
  );

  // ----- Antes de haver sítio -----
  if (!place) {
    return (
      <PertoPage line>
        {ask === 'checking' || ask === 'locating' ? (
          <View style={st.center}><ActivityIndicator /><Text style={st.emptySub}>{ask === 'locating' ? 'A ver onde estás…' : ''}</Text></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 24, gap: 18, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
            {ask === 'explain' ? (
              <View style={st.explain}>
                <View style={st.explainIcon}><Icon name="locate" size={30} color={colors.brand} /></View>
                <Text style={st.explainTitle}>Vê o que há à tua volta</Text>
                <Text style={st.explainText}>
                  Locais, eventos, a malta e o que se está a publicar perto de ti. Para isso o Txillapp precisa de saber onde estás: usamos só para esta procura, arredondada ao bairro, e não guardamos o teu percurso.
                </Text>
                <Pressable onPress={() => void goMine()} style={st.primary} accessibilityRole="button"><Text style={st.primaryText}>Usar a minha localização</Text></Pressable>
                <Pressable onPress={() => setAsk('cities')} style={st.secondary} accessibilityRole="button"><Text style={st.secondaryText}>Prefiro escolher a cidade</Text></Pressable>
              </View>
            ) : (
              <>
                <Text style={st.explainTitle}>Escolhe a cidade</Text>
                <Text style={st.explainText}>Sem localização também dá. Mostramos o que há à volta do centro da cidade.</Text>
                <CityGrid onPick={pickCity} />
                <Pressable onPress={() => void goMine()} style={st.secondary}><Text style={st.secondaryText}>Usar a minha localização</Text></Pressable>
              </>
            )}
          </ScrollView>
        )}
      </PertoPage>
    );
  }

  const row = (it: Item) => (
    <Row
      key={it.key}
      item={it}
      selected={selected === it.key}
      onPress={() => (selected === it.key ? open(it) : setSelected(it.key))}
      onOpen={() => open(it)}
      onHover={desktop ? () => setSelected(it.key) : undefined}
    />
  );

  const sheets = (
    <>
      {placeSheet ? (
        <Sheet title="Onde procurar" onClose={() => setPlaceSheet(false)}>
          <View style={{ paddingHorizontal: 16, paddingBottom: 20, gap: 12 }}>
            <Text style={st.sheetLabel}>Distância</Text>
            <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Distância">
              {RADII.map((r) => (
                <View key={r} style={{ flex: 1 }}>
                  <Chip label={`${r} km`} on={radius === r} onPress={() => setRadius(r)} dark />
                </View>
              ))}
            </View>
            <Text style={[st.sheetLabel, { marginTop: 6 }]}>Sítio</Text>
            <Pressable onPress={() => void goMine()} style={st.mineRow} accessibilityRole="button" accessibilityState={{ selected: place.gps }}>
              <Icon name="locate" size={20} color={colors.brand} />
              <Text style={[st.mineText, { flex: 1 }]}>{place.gps ? 'Perto de mim (a tua localização)' : 'Usar a minha localização'}</Text>
              {place.gps ? <Icon name="check" size={18} strokeWidth={2.4} color={colors.brand} /> : null}
            </Pressable>
            <CityGrid onPick={pickCity} current={place.gps ? undefined : place.label} />
          </View>
        </Sheet>
      ) : null}
      {visSheet ? (
        <Sheet title="Aparecer em À tua volta" onClose={() => setVisSheet(false)}>
          <View style={{ paddingHorizontal: 16, paddingBottom: 20 }}>
            <VisibilityOptions value={visibility ?? 'off'} onPick={(v) => setVis.mutate(v)} busy={setVis.isPending} gps={place.gps} />
          </View>
        </Sheet>
      ) : null}
      {groupInfo ? <GroupInfo group={groupInfo} onClose={() => setGroupInfo(null)} /> : null}
    </>
  );

  // ----- Computador: mapa grande e a lista numa coluna à direita -----
  if (desktop) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.white }}>
        <View style={st.deskHead}>
          <Text style={st.deskTitle}>À tua volta</Text>
          {q.isFetching ? <ActivityIndicator /> : null}
          <View style={{ flex: 1 }} />
          {eyeButton}
        </View>
        <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>{chips}</View>
        <View style={{ flex: 1, flexDirection: 'row', gap: 16, paddingHorizontal: 24, paddingBottom: 24 }}>
          <View style={{ flex: 1, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: colors.zinc200 }}>
            <NearbyMap center={center} radiusKm={radius} markers={markers} selectedId={selected} onMarkerPress={setSelected} zoomControl />
          </View>
          <View style={st.deskList}>
            <Text style={st.listHead}>{items.length ? `${items.length} à tua volta · mais perto primeiro` : 'À tua volta'}</Text>
            <DeskList items={items} selected={selected} header={card} empty={listEmpty} render={row} />
          </View>
        </View>
        {sheets}
      </View>
    );
  }

  // ----- Telemóvel: mapa por trás e a lista numa folha que se puxa para cima -----
  return (
    <PertoPage right={eyeButton}>
      <View style={st.phoneTop}>{chips}</View>
      <PhoneBody items={items} selected={selected} header={card} empty={listEmpty} render={row} onMarker={setSelected}>
        <NearbyMap center={center} radiusKm={radius} markers={markers} selectedId={selected} onMarkerPress={setSelected} />
      </PhoneBody>
      {sheets}
    </PertoPage>
  );
}

/**
 * Página do À tua volta no telemóvel: a mesma seta e o mesmo título da StackPage, mas com o cabeçalho mais baixo
 * (sem os 8 pt de cima e de baixo) e sem traço por baixo quando os filtros vêm logo a seguir: o mapa começa mais acima.
 */
function PertoPage({ right, line = false, children }: { right?: React.ReactNode; line?: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
      <View style={[st.head, line && st.headLine]}>
        <BackButton onPress={back} />
        <Text style={st.headTitle} numberOfLines={1} accessibilityRole="header">À tua volta</Text>
        {right}
      </View>
      <FillView>{children}</FillView>
    </View>
  );
}

function Chip({ label, on, onPress, dark = false, small = false, soft = false }: { label: string; on: boolean; onPress: () => void; dark?: boolean; small?: boolean; soft?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        st.chip,
        small && { height: 32, paddingHorizontal: 13 },
        on && (soft ? { backgroundColor: colors.rose50, borderColor: colors.brand } : { backgroundColor: dark ? colors.zinc900 : colors.brand, borderColor: dark ? colors.zinc900 : colors.brand }),
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
    >
      <Text style={[st.chipText, small && { fontSize: 13 }, on && { color: soft ? colors.brand : colors.white }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function CityGrid({ onPick, current }: { onPick: (c: (typeof CITIES)[number]) => void; current?: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {CITIES.map((c) => (
        <Chip key={c.name} label={c.name} on={current === c.name} onPress={() => onPick(c)} dark />
      ))}
    </View>
  );
}

const KIND_ICON: Record<MapMarkerKind, IconName> = { venue: 'map-pin', event: 'calendar', post: 'image', group: 'users', person: 'user' };

function Row({ item, selected, onPress, onOpen, onHover }: { item: Item; selected: boolean; onPress: () => void; onOpen: () => void; onHover?: () => void }) {
  const round = item.kind === 'person' || item.kind === 'group';
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={onHover}
      style={(s) => [st.row, selected && st.rowSel, (s as { hovered?: boolean }).hovered && !selected && { backgroundColor: colors.zinc100 }]}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${kmLabel(item.distanceKm)}. ${item.sub}`}
      accessibilityState={{ selected }}
    >
      {item.kind === 'person' ? (
        <View style={st.personHalo}><Avatar name={item.title} username={item.username} size={44} /></View>
      ) : (
        <View style={[st.thumb, round && { borderRadius: 26 }, item.kind === 'event' && { backgroundColor: colors.brand }, item.kind === 'group' && { backgroundColor: '#7c3aed' }]}>
          <Icon name={KIND_ICON[item.kind]} size={22} color={item.kind === 'post' ? colors.zinc500 : colors.white} />
          {item.image ? <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={st.rowTitle} numberOfLines={1}>{item.title}</Text>
          {item.verified ? <VerifiedBadge size={14} /> : null}
        </View>
        <Text style={st.rowSub} numberOfLines={1}>{item.sub}</Text>
      </View>
      <Text style={st.rowKm}>{kmLabel(item.distanceKm).replace(/^a /, '')}</Text>
      <Pressable onPress={onOpen} hitSlop={8} style={st.rowOpen} accessibilityRole="link" accessibilityLabel={`Abrir ${item.title}`}>
        <Icon name="chevron-right" size={18} color={colors.zinc500} />
      </Pressable>
    </Pressable>
  );
}

type ListProps = { items: Item[]; selected: string | null; header: React.ReactElement | null; empty: React.ReactElement; render: (it: Item) => React.ReactElement };

/** Lista do computador: o item escolhido no mapa rola para a vista. */
function DeskList({ items, selected, header, empty, render }: ListProps) {
  const list = useRef<FlatList<Item>>(null);
  useEffect(() => {
    const i = items.findIndex((x) => x.key === selected);
    if (i >= 0) list.current?.scrollToIndex({ index: i, viewPosition: 0.3, animated: true });
  }, [selected, items]);
  return (
    <FlatList
      ref={list}
      data={items}
      keyExtractor={(i) => i.key}
      renderItem={({ item }) => render(item)}
      ListHeaderComponent={header ?? undefined}
      ListEmptyComponent={empty}
      onScrollToIndexFailed={(e) => setTimeout(() => list.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: true }), 50)}
      contentContainerStyle={{ paddingBottom: 16 }}
    />
  );
}

const PEEK = 168;

/** Telemóvel: o mapa ocupa tudo e a lista vive numa folha com três alturas (espreitar, meio e cheia). */
function PhoneBody({ items, selected, header, empty, render, children }: ListProps & { onMarker: (id: string) => void; children: React.ReactNode }) {
  const [h, setH] = useState(0);
  const ty = useRef(new Animated.Value(10_000)).current;
  const pos = useRef(0);
  const start = useRef(0);
  const hRef = useRef(0);
  const list = useRef<FlatList<Item>>(null);
  const nd = Platform.OS !== 'web';
  const snaps = (H: number) => [24, Math.round(H * 0.48), Math.max(0, H - PEEK)];
  const nearest = (v: number) => snaps(hRef.current).reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

  useEffect(() => {
    const id = ty.addListener(({ value }) => { pos.current = value; });
    return () => ty.removeListener(id);
  }, [ty]);

  const snapTo = useCallback((v: number) => {
    Animated.spring(ty, { toValue: v, useNativeDriver: nd, bounciness: 2, speed: 16 }).start();
  }, [ty, nd]);

  const onLayout = (e: LayoutChangeEvent) => {
    const H = e.nativeEvent.layout.height;
    const first = hRef.current === 0;
    hRef.current = H;
    setH(H);
    if (first) {
      ty.setValue(snaps(H)[1]);
      pos.current = snaps(H)[1];
    }
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        ty.stopAnimation();
        start.current = pos.current;
      },
      onPanResponderMove: (_e, g) => {
        const [top, , low] = snaps(hRef.current);
        ty.setValue(Math.min(low, Math.max(top, start.current + g.dy)));
      },
      onPanResponderRelease: (_e, g) => {
        const s = snaps(hRef.current);
        const now = pos.current;
        let target: number;
        if (Math.abs(g.vy) > 0.6) target = g.vy < 0 ? (s.slice().reverse().find((x) => x < now - 10) ?? s[0]) : (s.find((x) => x > now + 10) ?? s[2]);
        else target = nearest(now);
        // Um toque na pega (sem arrastar): alterna entre espreitar e meio.
        if (Math.abs(g.dy) < 4 && Math.abs(g.dx) < 4) target = now > s[1] + 10 ? s[1] : now < s[1] - 10 ? s[1] : s[2];
        snapTo(target);
      },
      onPanResponderTerminate: () => snapTo(nearest(pos.current)),
    }),
  ).current;

  // Tocaste num marcador: a folha sobe (se estava em baixo) e o item aparece na lista.
  useEffect(() => {
    if (!selected || !hRef.current) return;
    const s = snaps(hRef.current);
    if (pos.current > s[1] + 10) snapTo(s[1]);
    const i = items.findIndex((x) => x.key === selected);
    if (i >= 0) setTimeout(() => list.current?.scrollToIndex({ index: i, viewPosition: 0, animated: true }), 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <View style={StyleSheet.absoluteFill}>{children}</View>
      {h > 0 ? (
        <Animated.View style={[st.sheet, { height: h - 24, transform: [{ translateY: ty }] }]}>
          <View {...pan.panHandlers} style={st.grab} accessibilityRole="adjustable" accessibilityLabel="Puxar a lista para cima ou para baixo">
            <View style={st.grabBar} />
            <Text style={st.listHead}>{items.length ? `${items.length} à tua volta · mais perto primeiro` : 'À tua volta'}</Text>
          </View>
          <FlatList
            ref={list}
            data={items}
            keyExtractor={(i) => i.key}
            renderItem={({ item }) => render(item)}
            ListHeaderComponent={header ?? undefined}
            ListEmptyComponent={empty}
            onScrollToIndexFailed={(e) => setTimeout(() => list.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: true }), 50)}
            contentContainerStyle={{ paddingBottom: 40 }}
            nestedScrollEnabled
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

function VisibilityOptions({ value, onPick, busy, gps }: { value: NearbyVisibility; onPick: (v: NearbyVisibility) => void; busy: boolean; gps: boolean }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={st.cardText}>
        Quem escolheres vê que estás por perto, só com a zona aproximada (o bairro, nunca o sítio exato). Só atualiza com este ecrã aberto e some sozinho passadas 3 h.
      </Text>
      {!gps ? <Text style={[st.cardText, { color: colors.amber600 }]}>Para apareceres tens de usar a localização do telemóvel (com uma cidade escolhida não apareces).</Text> : null}
      {VIS.map((o) => {
        const on = value === o.key;
        return (
          <Pressable key={o.key} disabled={busy} onPress={() => onPick(o.key)} style={[st.opt, on && st.optOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <View style={[st.radio, on && { borderColor: colors.brand }]}>{on ? <View style={st.radioDot} /> : null}</View>
            <View style={{ flex: 1 }}>
              <Text style={st.optTitle}>{o.label}</Text>
              <Text style={st.optSub}>{o.sub}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function VisibilityCard({ onPick, busy, gps, onLater }: { onPick: (v: NearbyVisibility) => void; busy: boolean; gps: boolean; onLater: () => void }) {
  return (
    <View style={st.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="users" size={20} color={colors.brand} />
        <Text style={st.cardTitle}>Aparecer em À tua volta</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onLater} hitSlop={8} accessibilityRole="button" accessibilityLabel="Agora não"><Icon name="x" size={18} color={colors.zinc500} /></Pressable>
      </View>
      <VisibilityOptions value="off" onPick={onPick} busy={busy} gps={gps} />
    </View>
  );
}

const GROUP_KIND: Record<string, string> = { viagem: 'Viagem', festa: 'Festa', fim_de_semana: 'Fim de semana', outro: 'TxillGroup' };

/** TxillGroup de que não sou membro: só a informação (entrar é por convite de quem lá está). */
function GroupInfo({ group, onClose }: { group: NearbyGroup; onClose: () => void }) {
  const day = group.startsOn ? new Date(`${group.startsOn}T12:00:00`) : null;
  return (
    <Sheet title={group.name} onClose={onClose}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}>
        {group.coverUrl ? <Image source={{ uri: sized(group.coverUrl, 800) }} style={{ width: '100%', aspectRatio: 2, borderRadius: 16, backgroundColor: colors.zinc100 }} contentFit="cover" /> : null}
        <Text style={st.cardText}>
          {[GROUP_KIND[group.kind] ?? 'TxillGroup', `${group.members} ${group.members === 1 ? 'membro' : 'membros'}`, group.destination, day && !isNaN(day.getTime()) ? day.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' }) : null, kmLabel(group.distanceKm)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Text style={st.emptySub}>Os TxillGroups são da malta que lá está. Para entrar, pede a alguém do grupo que te adicione.</Text>
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  emptySub: { fontSize: 14, color: colors.zinc500, textAlign: 'center' },
  retry: { marginTop: 6, height: 40, paddingHorizontal: 18, borderRadius: 999, backgroundColor: colors.zinc100, justifyContent: 'center' },
  retryText: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  explain: { alignItems: 'center', gap: 14, paddingTop: 24 },
  explainIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  explainTitle: { fontSize: 22, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  explainText: { fontSize: 15, lineHeight: 21, color: colors.zinc600, textAlign: 'center' },
  primary: { alignSelf: 'stretch', height: 50, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  primaryText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  secondary: { alignSelf: 'stretch', height: 48, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.zinc900, fontSize: 15, fontWeight: '700' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8, paddingRight: 12, paddingVertical: 2, backgroundColor: colors.white },
  headLine: { borderBottomWidth: 1, borderBottomColor: colors.zinc100, paddingBottom: 6 },
  headTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  phoneTop: { borderBottomWidth: 1, borderBottomColor: colors.zinc100, backgroundColor: colors.white },
  filters: { gap: 8, paddingTop: 2, paddingBottom: 10 },
  chipRow: { paddingLeft: 12, paddingRight: 28, gap: 8, alignItems: 'center' },
  chipGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipSep: { width: 1, height: 20, backgroundColor: colors.zinc200 },
  chipFade: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 28 },
  chip: { height: 36, borderRadius: 999, paddingHorizontal: 15, borderWidth: 1, borderColor: colors.zinc100, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
  zone: { height: 36, borderRadius: 999, paddingLeft: 11, paddingRight: 10, borderWidth: 1, borderColor: colors.zinc200, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 230 },
  zoneText: { fontSize: 14, fontWeight: '700', color: colors.zinc900, flexShrink: 1 },
  zoneCaret: { transform: [{ rotate: '90deg' }], marginLeft: -1 },
  sheetLabel: { fontSize: 13, fontWeight: '700', color: colors.zinc500 },
  eye: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.zinc100 },
  eyeText: { fontSize: 13, fontWeight: '700', color: colors.zinc700 },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.rose50 },
  mineText: { fontSize: 15, fontWeight: '700', color: colors.brand },
  sheet: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, boxShadow: '0 -4px 20px rgba(0,0,0,0.12)' },
  grab: { paddingTop: 8, paddingBottom: 6, alignItems: 'center', gap: 6 },
  grabBar: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.zinc300 },
  listHead: { fontSize: 13, fontWeight: '700', color: colors.zinc500, paddingHorizontal: 16, paddingVertical: 4, alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  rowSel: { backgroundColor: colors.rose50 },
  thumb: { width: 52, height: 52, borderRadius: 14, backgroundColor: colors.zinc900, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  personHalo: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(214,51,79,0.14)', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900, flexShrink: 1 },
  rowSub: { fontSize: 13, color: colors.zinc500, marginTop: 2 },
  rowKm: { fontSize: 13, fontWeight: '700', color: colors.zinc700 },
  rowOpen: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  card: { margin: 12, padding: 14, borderRadius: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.zinc200, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.zinc900 },
  cardText: { fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.zinc200 },
  optOn: { borderColor: colors.brand, backgroundColor: colors.rose50 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  optTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  optSub: { fontSize: 13, color: colors.zinc500, marginTop: 1 },
  deskHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingTop: 22 },
  deskTitle: { fontSize: 24, fontWeight: '800', color: colors.zinc900 },
  deskList: { width: 380, borderRadius: 18, borderWidth: 1, borderColor: colors.zinc200, overflow: 'hidden', paddingTop: 10, backgroundColor: colors.white },
});
