import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, AppState, FlatList, Linking, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, type AccessibilityActionInfo, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { FillView } from '@/components/FillView';
import { Icon, type IconName } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Sheet } from '@/components/Sheet';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { AccessBadge, JoinButton, usePublicGroup } from '@/components/groups/GroupJoin';
import { GroupCover } from '@/components/groups/GroupParts';
import { NearbyMap } from '@/components/nearby/NearbyMap';
import type { MapMarker, MapMarkerKind } from '@/components/nearby/types';
import { ApiError, api } from '@/lib/api';
import type { GroupKind } from '@/lib/api.groups';
import { KIND_LABEL } from '@/lib/api.locais';
import { joinModeOf } from '@/lib/groupAccess';
import { eventWhen, kmLabel, nearbyApi, round2, type NearbyGroup, type NearbyResult, type NearbyVisibility, type NearbyWhen } from '@/lib/api.nearby';
import { SITE_URL, sized } from '@/lib/config';
import { useDesktop } from '@/lib/desktop';
import { kvGet, kvSet } from '@/lib/kv';
import { emptyHint, kindsToFetch, loadErrorText, locateProblemText, shownKinds, whenToFetch, type LocateProblem, type NearbyFilter } from '@/lib/nearbyView';
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
type Filter = NearbyFilter;
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tudo' },
  { key: 'venues', label: 'Locais' },
  { key: 'events', label: 'Eventos' },
  { key: 'people', label: 'A malta' },
  // Publicações (fotos e vídeos) das últimas 48 h perto daqui. Chamava-se "Agora" e confundia-se com o "Agora" dos eventos.
  { key: 'posts', label: 'Publicações' },
  { key: 'groups', label: 'TxillGroups' },
];
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

/** Uma promessa com prazo: o GPS dentro de casa pode ficar à procura minutos a fio. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** A posição: a última conhecida (até 10 min) ou uma nova (até 15 s); se não der, a última da última hora. */
async function currentPosition(): Promise<Location.LocationObject | null> {
  const native = Platform.OS !== 'web';
  const last = native ? await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null) : null;
  if (last) return last;
  try {
    return await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 15_000);
  } catch {
    return native ? await Location.getLastKnownPositionAsync({ maxAge: 60 * 60_000 }).catch(() => null) : null;
  }
}

/** Avisa porque não deu para usar a localização (com "Abrir definições" quando é isso que resolve). */
function alertProblem(p: LocateProblem) {
  const t = locateProblemText(p, Platform.OS === 'web');
  Alert.alert(t.title, t.text, t.settings ? [{ text: 'Agora não', style: 'cancel' }, { text: 'Abrir definições', onPress: () => void Linking.openSettings() }] : undefined);
}

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
      key: `g:${g.id}`, kind: 'group', title: g.name, image: sized(g.avatarUrl ?? g.coverUrl, 160) ?? null, distanceKm: g.distanceKm, lat: g.lat, lng: g.lng, group: g,
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
  /** Porque é que a localização não deu (mostrado no ecrã de escolher a cidade). */
  const [problem, setProblem] = useState<LocateProblem | null>(null);
  /** Quando foi a última posição do GPS (para a refrescar se ficou velha). */
  const fixAt = useRef(0);

  // ----- Onde estou: GPS (se deixares) ou a cidade escolhida -----
  /** null = deu; senão, o problema. `quiet`: atualizar sem mostrar "A ver onde estás…" (já há sítio no ecrã). */
  const locate = useCallback(async (requestIfNeeded: boolean, quiet = false): Promise<LocateProblem | null> => {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted && requestIfNeeded && perm.canAskAgain !== false) perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return perm.canAskAgain === false ? 'blocked' : 'denied';
      if (Platform.OS !== 'web' && !(await Location.hasServicesEnabledAsync().catch(() => true))) return 'off';
      if (!quiet) setAsk('locating');
      const pos = await currentPosition();
      if (!pos) return 'failed';
      // Arredondado logo aqui: a posição exata nunca sai deste ecrã.
      const lat = round2(pos.coords.latitude);
      const lng = round2(pos.coords.longitude);
      fixAt.current = Date.now();
      setPlace((prev) => (prev?.gps && prev.lat === lat && prev.lng === lng ? prev : { lat, lng, label: 'Perto de mim', gps: true }));
      if (!quiet) setAsk(null);
      void kvSet(PLACE_KEY, 'gps');
      return null;
    } catch {
      return 'failed';
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
      // Sem autorização ao abrir (tirada com a app fechada): a última presença no mapa sai logo, não espera as 3 h
      // (como quando a autorização se perde com o mapa aberto).
      if (!perm?.granted) void nearbyApi.clearPresence().catch(() => undefined);
      if (perm?.granted) {
        const p = await locate(false);
        if (!p || !alive) return;
        // Com autorização mas sem posição (GPS desligado, sem sinal): explica e deixa tentar outra vez ou escolher a cidade.
        setProblem(p);
        setAsk('explain');
        return;
      }
      setAsk(perm && !perm.granted && perm.canAskAgain === false ? 'cities' : 'explain');
    })();
    return () => {
      alive = false;
    };
  }, [locate]);

  const goMine = async () => {
    setPlaceSheet(false);
    const p = await locate(true);
    setProblem(place ? null : p);
    if (!p) return;
    if (place) {
      setAsk(null);
      alertProblem(p);
    } else setAsk('cities');
  };

  // ----- Aparecer em À tua volta (a malta) -----
  const vis = useQuery({ queryKey: ['nearby-settings'], queryFn: nearbyApi.settings, staleTime: 5 * 60_000, retry: false });
  const visibility: NearbyVisibility | null = vis.data?.visibility ?? null;
  const visible = visibility === 'mutual' || visibility === 'following';

  const pickCity = (c: (typeof CITIES)[number]) => {
    // Com uma cidade escolhida não apareces à malta (diz a folha): a última posição do GPS sai logo, não espera as 3 h.
    if (visible && place?.gps) void nearbyApi.clearPresence().catch(() => undefined);
    setPlace({ lat: c.lat, lng: c.lng, label: c.name, gps: false });
    setAsk(null);
    setProblem(null);
    setPlaceSheet(false);
    void kvSet(PLACE_KEY, c.name);
  };

  // ----- O que há à volta -----
  // Pede-se tudo de uma vez e filtra-se aqui (trocar de filtro é instantâneo); ver nearbyView.kindsToFetch.
  // "Tudo" (e os outros filtros) traz os eventos da semana; só "Eventos" escolhe Hoje / A decorrer / Esta semana.
  const fetchKinds = kindsToFetch(filter, when);
  const fetchWhen = whenToFetch(filter, when);
  const q = useQuery({
    queryKey: ['nearby', place?.lat, place?.lng, radius, fetchKinds.join(','), fetchWhen],
    queryFn: () => nearbyApi.around({ lat: place!.lat, lng: place!.lng, radiusKm: radius, kinds: fetchKinds, when: fetchWhen }),
    enabled: !!place,
    staleTime: 60_000,
    // Enquanto chega a resposta fica a anterior, mas só do mesmo sítio (a de outra cidade punha distâncias erradas na lista).
    placeholderData: (prev, prevQuery) => (prevQuery && prevQuery.queryKey[1] === place?.lat && prevQuery.queryKey[2] === place?.lng ? prev : undefined),
  });
  const shown = useMemo(() => shownKinds(filter), [filter]);
  const items = useMemo(() => toItems(q.data).filter((i) => shown.has(i.kind)), [q.data, shown]);
  const [pulling, setPulling] = useState(false);
  const pullRefresh = async () => {
    setPulling(true);
    try {
      await q.refetch();
    } finally {
      setPulling(false);
    }
  };
  const markers = useMemo<MapMarker[]>(() => items.map((i) => ({ id: i.key, kind: i.kind, lat: i.lat, lng: i.lng, title: i.title, image: i.image, date: i.date ?? null })), [items]);
  const center = useMemo(() => (place ? { lat: place.lat, lng: place.lng } : { lat: -25.97, lng: 32.57 }), [place]);

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

  // A posição do GPS não fica parada: ao voltar ao ecrã (ou à app) e a cada 5 minutos com ele aberto, se a última tem mais
  // de 4 min e meio, pede-se outra sem perguntar nada. Sem autorização (tirada nas definições), deixa de contar como GPS.
  const gps = !!place?.gps;
  useEffect(() => {
    if (!gps || !focused || !active) return;
    const refresh = () => {
      if (Date.now() - fixAt.current < 4.5 * 60_000) return;
      void locate(false, true).then((p) => {
        if (p !== 'denied' && p !== 'blocked') return;
        setPlace((prev) => (prev?.gps ? { ...prev, label: 'Último sítio', gps: false } : prev));
        void nearbyApi.clearPresence().catch(() => undefined);
      });
    };
    refresh();
    const t = setInterval(refresh, 5 * 60_000);
    return () => clearInterval(t);
  }, [gps, focused, active, locate]);

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
  // À procura do GPS (pedido na folha "Onde procurar"): o chip diz, para o toque não parecer perdido.
  const zoneLabel = place ? (ask === 'locating' ? 'A ver onde estás…' : `${place.label} · ${radius} km`) : '';
  const zonePill = place ? (
    <Pressable
      onPress={() => setPlaceSheet(true)}
      style={({ pressed }) => [st.zone, pressed && { backgroundColor: colors.zinc100 }]}
      hitSlop={{ top: 4, bottom: 4 }}
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
              <Chip key={f.key} label={f.label} on={filter === f.key} onPress={() => { if (f.key !== 'events') setWhen('today'); setFilter(f.key); setSelected(null); }} dark />
            ))}
          </View>
        </ScrollView>
        {/* Esbatido à direita: a fila continua para o lado sem um chip cortado a seco. */}
        <LinearGradient pointerEvents="none" colors={['rgba(255,255,255,0)', colors.white]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.chipFade} />
      </View>
      {/* Quando (só dos eventos): só aparece com "Eventos" escolhido. Ao sair de "Eventos" volta a Hoje (sem filtro ativo escondido). */}
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
      <VisibilityStrip onOpen={() => setVisSheet(true)} onLater={() => setHideCard(true)} />
    ) : null;

  // Vazio: a razão certa para cada filtro (a malta só com visibilidade, eventos de hoje vs. da semana…) e o botão que resolve.
  const hint = emptyHint({ filter, when: fetchWhen, radius, radii: RADII, canEnable });
  const listEmpty = q.isLoading ? (
    <View style={st.center}><ActivityIndicator /></View>
  ) : q.isError ? (
    <View style={st.center}>
      <View style={st.emptyIcon}><Icon name="alert" size={24} color={colors.brand} /></View>
      <Text style={st.emptyTitle}>Não consegui ver o que há à volta</Text>
      <Text style={st.emptySub}>{loadErrorText(q.error instanceof ApiError ? q.error.status : null)}</Text>
      <Pressable onPress={() => void q.refetch()} style={st.retry} accessibilityRole="button"><Text style={st.retryText}>Tentar outra vez</Text></Pressable>
    </View>
  ) : (
    <View style={st.center}>
      <View style={st.emptyIcon}><Icon name="compass" size={26} color={colors.brand} /></View>
      <Text style={st.emptyTitle}>{hint.title}</Text>
      <Text style={st.emptySub}>{hint.sub}</Text>
      {hint.action ? (
        <Pressable
          onPress={() => {
            const a = hint.action!;
            if (a.radius) setRadius(a.radius);
            if (a.when) setWhen(a.when);
          }}
          style={st.retry}
          accessibilityRole="button"
        >
          <Text style={st.retryText}>{hint.action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
  const listState = { loading: q.isLoading, updating: q.isPlaceholderData, failed: q.isError };

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
                {problem ? <ProblemNote problem={problem} /> : null}
                <Pressable onPress={() => void goMine()} style={st.primary} accessibilityRole="button"><Text style={st.primaryText}>{problem ? 'Tentar outra vez' : 'Usar a minha localização'}</Text></Pressable>
                <Pressable onPress={() => setAsk('cities')} style={st.secondary} accessibilityRole="button"><Text style={st.secondaryText}>Prefiro escolher a cidade</Text></Pressable>
              </View>
            ) : (
              <>
                <Text style={st.explainTitle}>Escolhe a cidade</Text>
                <Text style={st.explainText}>Sem localização também dá. Mostramos o que há à volta do centro da cidade.</Text>
                {problem ? <ProblemNote problem={problem} /> : null}
                <CityGrid onPick={pickCity} />
                <Pressable onPress={() => void goMine()} style={st.secondary} accessibilityRole="button"><Text style={st.secondaryText}>Usar a minha localização</Text></Pressable>
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
            <VisibilityOptions
              value={visibility ?? 'off'}
              onPick={(v) => setVis.mutate(v)}
              busy={setVis.isPending}
              gps={place.gps}
              onUseGps={() => {
                setVisSheet(false);
                void goMine();
              }}
            />
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
            <NearbyMap center={center} radiusKm={radius} markers={markers} selectedId={selected} onMarkerPress={setSelected} showMe={place.gps} zoomControl />
          </View>
          <View style={st.deskList}>
            <ListHead items={items} {...listState} />
            <DeskList items={items} selected={selected} header={card} empty={listEmpty} render={row} refreshing={pulling} onRefresh={() => void pullRefresh()} />
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
      <PhoneBody
        items={items}
        selected={selected}
        head={<ListHead items={items} {...listState} />}
        header={card}
        empty={listEmpty}
        render={row}
        refreshing={pulling}
        onRefresh={() => void pullRefresh()}
        map={(cover) => <NearbyMap center={center} radiusKm={radius} markers={markers} selectedId={selected} onMarkerPress={setSelected} showMe={place.gps} coverBottom={cover} />}
      />
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
      // 36 pt de altura (32 nos pequenos) + 4 em cima e em baixo: o toque chega aos 44 sem os chips ficarem maiores.
      hitSlop={{ top: 4, bottom: 4 }}
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

/**
 * Ação do leitor de ecrã em cada linha: "Abrir" abre logo, sem passar pelo mapa. O toque normal (activate) não se declara
 * aqui, para continuar a ser o onPress de sempre (mostrar no mapa e, outra vez, abrir).
 */
const OPEN_ACTIONS: AccessibilityActionInfo[] = [{ name: 'open', label: 'Abrir' }];

function Row({ item, selected, onPress, onOpen, onHover }: { item: Item; selected: boolean; onPress: () => void; onOpen: () => void; onHover?: () => void }) {
  const round = item.kind === 'person' || item.kind === 'group';
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={onHover}
      style={(s) => [st.row, selected && st.rowSel, (s as { hovered?: boolean }).hovered && !selected && { backgroundColor: colors.zinc100 }]}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${kmLabel(item.distanceKm)}. ${item.sub}`}
      // O primeiro toque mostra no mapa, o segundo abre. Com o leitor de ecrã há também a ação "Abrir", que abre logo.
      accessibilityHint={selected ? 'Toca para abrir' : 'Toca para mostrar no mapa e outra vez para abrir. Ou usa a ação Abrir'}
      accessibilityState={{ selected }}
      accessibilityActions={OPEN_ACTIONS}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'open') onOpen();
      }}
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

type ListProps = {
  items: Item[];
  selected: string | null;
  header: React.ReactElement | null;
  empty: React.ReactElement;
  render: (it: Item) => React.ReactElement;
  /** Puxar a lista para baixo volta a pedir o que há à volta. */
  refreshing: boolean;
  onRefresh: () => void;
};

/** Lista do computador: o item escolhido no mapa rola para a vista. */
function DeskList({ items, selected, header, empty, render, refreshing, onRefresh }: ListProps) {
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
      refreshing={refreshing}
      onRefresh={onRefresh}
      onScrollToIndexFailed={(e) => setTimeout(() => list.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: true }), 50)}
      contentContainerStyle={{ paddingBottom: 16 }}
    />
  );
}

const KIND_COUNT: Record<MapMarkerKind, [string, string]> = {
  venue: ['local', 'locais'],
  event: ['evento', 'eventos'],
  post: ['publicação', 'publicações'],
  group: ['TxillGroup', 'TxillGroups'],
  person: ['pessoa', 'pessoas'],
};

/** Cabeçalho da lista: quantos há (grande) e de que tipo (pequeno). `updating`: o que se vê é o anterior, a resposta nova vem a caminho. */
function ListHead({ items, loading, updating, failed }: { items: Item[]; loading: boolean; updating: boolean; failed: boolean }) {
  const n = items.length;
  const by = new Map<MapMarkerKind, number>();
  for (const i of items) by.set(i.kind, (by.get(i.kind) ?? 0) + 1);
  const parts = [...by.entries()].map(([k, c]) => `${c} ${KIND_COUNT[k][c === 1 ? 0 : 1]}`);
  const sub =
    loading || (updating && !n)
      ? 'A procurar…'
      : updating
        ? 'A atualizar…'
        : n
          ? parts.length > 1
            ? `${parts.join(' · ')} · mais perto primeiro`
            : 'Mais perto primeiro'
          : failed
            ? 'Sem resposta do servidor'
            : 'Nada por perto com estes filtros';
  return (
    <View style={st.listHead} accessibilityRole="header" accessibilityLabel={n ? `${n} à tua volta. ${sub}` : `À tua volta. ${sub}`}>
      <Text style={st.listHeadTitle} numberOfLines={1}>{n ? `${n} à tua volta` : 'À tua volta'}</Text>
      <Text style={st.listHeadSub} numberOfLines={1}>{sub}</Text>
    </View>
  );
}

/** Quanto da lista se vê com a folha em baixo, além do cabeçalho: uma linha inteira e um pouco da seguinte. */
const PEEK_ROWS = 90;
/** Altura do cabeçalho até ser medido (pega + contagem). */
const HEAD_GUESS = 72;

/** Telemóvel: o mapa ocupa tudo e a lista vive numa folha com três alturas (espreitar, meio e cheia). Em repouso só espreita. */
function PhoneBody({ items, selected, head, header, empty, render, refreshing, onRefresh, map }: ListProps & { head: React.ReactElement; map: (coverBottom: number) => React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [h, setH] = useState(0);
  /** Quanto do mapa a folha tapa (na altura em que parou): o mapa enquadra o raio e o item escolhido acima dela. */
  const [cover, setCover] = useState(0);
  const ty = useRef(new Animated.Value(10_000)).current;
  const pos = useRef(0);
  const start = useRef(0);
  const hRef = useRef(0);
  const headH = useRef(HEAD_GUESS);
  const headMeasured = useRef(false);
  const bottom = useRef(insets.bottom);
  bottom.current = insets.bottom;
  const list = useRef<FlatList<Item>>(null);
  const nd = Platform.OS !== 'web';
  // Em baixo: o cabeçalho (com a faixa de visibilidade, se houver) e cerca de uma linha; nunca acima do meio.
  const snaps = (H: number) => {
    const mid = Math.round(H * 0.48);
    return [24, mid, Math.max(mid + 40, H - (headH.current + PEEK_ROWS + bottom.current))];
  };
  const nearest = (v: number) => snaps(hRef.current).reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

  useEffect(() => {
    const id = ty.addListener(({ value }) => { pos.current = value; });
    return () => ty.removeListener(id);
  }, [ty]);

  const snapTo = useCallback((v: number) => {
    setCover(Math.max(0, Math.round(hRef.current - v)));
    Animated.spring(ty, { toValue: v, useNativeDriver: nd, bounciness: 2, speed: 16 }).start();
  }, [ty, nd]);

  const onLayout = (e: LayoutChangeEvent) => {
    const H = e.nativeEvent.layout.height;
    const first = hRef.current === 0;
    hRef.current = H;
    setH(H);
    if (first) {
      ty.setValue(snaps(H)[2]);
      pos.current = snaps(H)[2];
      setCover(Math.round(H - snaps(H)[2]));
    }
  };

  // O cabeçalho mudou de altura (a faixa de visibilidade apareceu ou saiu): se a folha estava em baixo, acompanha.
  const onHeadLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    if (!hRef.current || Math.abs(next - headH.current) < 2) {
      headH.current = next;
      headMeasured.current = true;
      return;
    }
    const wasLow = Math.abs(pos.current - snaps(hRef.current)[2]) < 12;
    const firstTime = !headMeasured.current;
    headMeasured.current = true;
    headH.current = next;
    if (!wasLow) return;
    const low = snaps(hRef.current)[2];
    if (firstTime) {
      ty.setValue(low);
      pos.current = low;
      setCover(Math.round(hRef.current - low));
    } else snapTo(low);
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
      <View style={StyleSheet.absoluteFill}>{map(cover)}</View>
      {h > 0 ? (
        <Animated.View style={[st.sheet, { height: h - 24, transform: [{ translateY: ty }] }]}>
          <View onLayout={onHeadLayout}>
            <View {...pan.panHandlers} style={st.grab} accessibilityRole="adjustable" accessibilityLabel="Puxar a lista para cima ou para baixo">
              <View style={st.grabBar} />
              {head}
            </View>
            {/* A faixa de visibilidade fica fora da pega (um botão dentro de um "ajustável" confunde o leitor de ecrã). */}
            {header}
          </View>
          <FlatList
            ref={list}
            data={items}
            keyExtractor={(i) => i.key}
            renderItem={({ item }) => render(item)}
            ListEmptyComponent={empty}
            refreshing={refreshing}
            onRefresh={onRefresh}
            onScrollToIndexFailed={(e) => setTimeout(() => list.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: true }), 50)}
            contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
            nestedScrollEnabled
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Porque não deu para usar a localização, com "Abrir definições" quando é isso que resolve (só na app). */
function ProblemNote({ problem }: { problem: LocateProblem }) {
  const t = locateProblemText(problem, Platform.OS === 'web');
  return (
    <View style={st.problem} accessibilityRole="alert">
      <Icon name="alert" size={20} color={colors.amber600} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={st.optTitle}>{t.title}</Text>
        <Text style={st.cardText}>{t.text}</Text>
        {t.settings ? (
          <Pressable onPress={() => void Linking.openSettings()} hitSlop={{ top: 12, bottom: 12 }} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 2 }}>
            <Text style={[st.mineText, { fontSize: 14 }]}>Abrir definições</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function VisibilityOptions({ value, onPick, busy, gps, onUseGps }: { value: NearbyVisibility; onPick: (v: NearbyVisibility) => void; busy: boolean; gps: boolean; onUseGps: () => void }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={st.privacy}>
        <Icon name="shield" size={20} color={colors.zinc700} />
        <Text style={[st.cardText, { flex: 1 }]}>
          Quem escolheres vê que estás por perto, só com a zona aproximada (o bairro, nunca o sítio exato). Só atualiza com este ecrã aberto e some sozinho passadas 3 h.
        </Text>
      </View>
      {!gps ? (
        <View style={{ gap: 8 }}>
          <Text style={[st.cardText, { color: colors.amber600 }]}>Para apareceres tens de usar a localização do telemóvel (com uma cidade escolhida não apareces).</Text>
          <Pressable onPress={onUseGps} style={st.mineRow} accessibilityRole="button">
            <Icon name="locate" size={20} color={colors.brand} />
            <Text style={[st.mineText, { flex: 1 }]}>Usar a minha localização</Text>
          </Pressable>
        </View>
      ) : null}
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

/** Faixa curta na folha: "Estás invisível · Mudar". As opções (e a explicação de privacidade) abrem numa folha própria. */
function VisibilityStrip({ onOpen, onLater }: { onOpen: () => void; onLater: () => void }) {
  return (
    <View style={st.strip}>
      <Pressable onPress={onOpen} style={st.stripMain} accessibilityRole="button" accessibilityLabel="Estás invisível para a malta. Mudar quem te vê" hitSlop={4}>
        <View style={st.stripIcon}><Icon name="eye-off" size={16} color={colors.zinc700} /></View>
        <Text style={st.stripText} numberOfLines={1}>
          Estás invisível <Text style={st.stripDim}>para a malta</Text>
        </Text>
        <Text style={st.stripLink}>Mudar</Text>
      </Pressable>
      <Pressable onPress={onLater} hitSlop={10} style={st.stripX} accessibilityRole="button" accessibilityLabel="Agora não">
        <Icon name="x" size={16} color={colors.zinc500} />
      </Pressable>
    </View>
  );
}

const GROUP_KIND: Record<string, string> = { viagem: 'Viagem', festa: 'Festa', fim_de_semana: 'Fim de semana', outro: 'TxillGroup' };

/** TxillGroup de que não sou membro: capa, foto, selo, informação e o botão para entrar (público) ou pedir (privado no mapa). */
function GroupInfo({ group, onClose }: { group: NearbyGroup; onClose: () => void }) {
  const router = useRouter();
  const pub = usePublicGroup(group.id);
  const p = pub.data;
  const gone = pub.error instanceof ApiError && (pub.error.status === 404 || pub.error.status === 403);
  const members = p?.members ?? group.members;
  const day = group.startsOn ? new Date(`${group.startsOn}T12:00:00`) : null;
  const go = (to: string) => { onClose(); router.push(to as never); };
  return (
    <Sheet title={group.name} onClose={onClose}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}>
        {group.coverUrl ? <Image source={{ uri: sized(group.coverUrl, 800) }} style={{ width: '100%', aspectRatio: 2, borderRadius: 16, backgroundColor: colors.zinc100 }} contentFit="cover" accessibilityLabel={`Capa de ${group.name}`} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <GroupCover url={group.avatarUrl ?? p?.avatarUrl ?? group.coverUrl} kind={(p?.groupKind ?? group.kind) as GroupKind} size={52} radius={26} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <AccessBadge visibility={p?.visibility ?? group.visibility} />
            <Text style={st.cardText}>
              {[GROUP_KIND[group.kind] ?? 'TxillGroup', `${members} ${members === 1 ? 'membro' : 'membros'}`, group.destination, day && !isNaN(day.getTime()) ? day.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' }) : null, kmLabel(group.distanceKm)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
        {group.placeLabel || p?.placeLabel ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLabel={`Aparece em ${group.placeLabel || p?.placeLabel}`}>
            <Icon name="map-pin" size={16} color={colors.brand} />
            <Text style={[st.cardText, { flex: 1, fontWeight: '700', color: colors.zinc800 }]} numberOfLines={1}>{group.placeLabel || p?.placeLabel}</Text>
          </View>
        ) : null}
        {p?.description ? <Text style={st.cardText} numberOfLines={4}>{p.description}</Text> : null}
        {gone ? (
          <Text style={st.emptySub}>Este grupo é privado ou já não existe.</Text>
        ) : pub.isError ? (
          <Pressable onPress={() => void pub.refetch()} accessibilityRole="button"><Text style={st.emptySub}>Não consegui ver se podes entrar. Toca para tentar outra vez.</Text></Pressable>
        ) : (
          <JoinButton groupId={group.id} mode={joinModeOf(p ?? group)} me={p?.me} onOpen={() => go(`/messages/g/${group.id}`)} />
        )}
        {!gone && (
          <Pressable onPress={() => go(`/g/${group.id}`)} style={st.secondary} accessibilityRole="link" accessibilityLabel={`Ver a página de ${group.name}`}>
            <Text style={st.secondaryText}>Ver a página do grupo</Text>
          </Pressable>
        )}
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
  grab: { paddingTop: 8, paddingBottom: 4, alignItems: 'center', gap: 8 },
  grabBar: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.zinc300 },
  listHead: { paddingHorizontal: 16, paddingBottom: 6, alignSelf: 'stretch' },
  listHeadTitle: { fontSize: 18, fontWeight: '800', color: colors.zinc900, letterSpacing: -0.2 },
  listHeadSub: { fontSize: 13, fontWeight: '500', color: colors.zinc500, marginTop: 1 },
  strip: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginTop: 2, marginBottom: 6, paddingLeft: 8, paddingRight: 4, minHeight: 44, borderRadius: 14, backgroundColor: colors.zinc100 },
  stripMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  stripIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  stripText: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  stripDim: { fontWeight: '500', color: colors.zinc500 },
  stripLink: { fontSize: 14, fontWeight: '800', color: colors.brand, paddingHorizontal: 6 },
  stripX: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.zinc100 },
  problem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.zinc100, alignSelf: 'stretch' },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  rowSel: { backgroundColor: colors.rose50 },
  thumb: { width: 52, height: 52, borderRadius: 14, backgroundColor: colors.zinc900, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  personHalo: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(214,51,79,0.14)', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900, flexShrink: 1 },
  rowSub: { fontSize: 13, color: colors.zinc500, marginTop: 2 },
  rowKm: { fontSize: 13, fontWeight: '700', color: colors.zinc700 },
  rowOpen: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  cardText: { fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.zinc200 },
  optOn: { borderColor: colors.brand, backgroundColor: colors.rose50 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  optTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  optSub: { fontSize: 13, color: colors.zinc500, marginTop: 1 },
  deskHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingTop: 22 },
  deskTitle: { fontSize: 24, fontWeight: '800', color: colors.zinc900 },
  deskList: { width: 380, borderRadius: 18, borderWidth: 1, borderColor: colors.zinc200, overflow: 'hidden', paddingTop: 12, backgroundColor: colors.white },
});
