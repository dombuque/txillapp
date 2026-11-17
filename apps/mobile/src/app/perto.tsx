import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, AppState, FlatList, Linking, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, type AccessibilityActionInfo, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { FillView } from '@/components/FillView';
import { Icon, type IconName } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Sheet } from '@/components/Sheet';
import { NameWithBadge } from '@/components/NameWithBadge';
import { AccessBadge, JoinButton, usePublicGroup } from '@/components/groups/GroupJoin';
import { GroupCover } from '@/components/groups/GroupParts';
import { NearbyMap } from '@/components/nearby/NearbyMap';
import type { MapMarker, MapMarkerKind } from '@/components/nearby/types';
import { ApiError, api, type Badged } from '@/lib/api';
import { boostsApi } from '@/lib/api.boosts';
import type { GroupKind } from '@/lib/api.groups';
import { KIND_LABEL } from '@/lib/api.locais';
import { joinModeOf } from '@/lib/groupAccess';
import { eventWhen, kmLabel, nearbyApi, round2, type NearbyGroup, type NearbyResult, type NearbyVisibility, type NearbyWhen } from '@/lib/api.nearby';
import { SITE_URL, sized } from '@/lib/config';
import { useDesktop } from '@/lib/desktop';
import { kvGet, kvSet } from '@/lib/kv';
import { EMPTY_EXTRA_LABEL, emptyExtras, emptyHint, kindsToFetch, loadErrorText, locateProblemText, shownKinds, whenToFetch, type EmptyExtra, type LocateProblem, type NearbyFilter } from '@/lib/nearbyView';
import { RADIUS, RADIUS_MARKS, RADIUS_STEPS } from '@/lib/radius';
import { cardShadow, colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { RangeSlider } from '@/components/RangeSlider';

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
/** O pedido à API espera que a barra pare uns instantes (ou que se largue): não sai um pedido por cada km. */
const RADIUS_SETTLE_MS = 300;
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

/** `lat`/`lng` arredondados (o que vai ao servidor); `at` é a posição exata do GPS, só para centrar o mapa neste ecrã. */
type Place = { lat: number; lng: number; label: string; gps: boolean; at?: { lat: number; lng: number } };

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
  /** Só locais: o tipo (bar, restaurante…), para o ícone. */
  category?: string;
  /** Só pessoas: há quanto tempo esteve por aqui («há 12 min»). */
  ago?: string;
  /** O selo de verificado (do local, da pessoa ou de quem publicou quando o título é o nome dela). */
  who?: Badged;
  username?: string;
  group?: NearbyGroup;
  to?: string;
  /** Destaque pago (Bombar): realçado no mapa, no topo da lista e com a etiqueta. */
  boost?: { campaignId: string; label: string } | null;
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
      key: `v:${v.slug}`, kind: 'venue', title: v.name, image: sized(v.avatarUrl, 120) ?? null, distanceKm: v.distanceKm, lat: v.lat, lng: v.lng, who: { verified: v.verified }, to: `/v/${v.slug}`, boost: v.boosted ?? null, category: v.kind,
      sub: [KIND_LABEL[v.kind] ?? 'Local', v.checkinsToday ? `${v.checkinsToday} check-in${v.checkinsToday === 1 ? '' : 's'} hoje` : null, v.acceptsTxills ? 'aceita vibes' : null].filter(Boolean).join(' · '),
    });
  for (const e of d.events ?? [])
    out.push({
      key: `e:${e.id}`, kind: 'event', title: e.title, image: sized(e.coverUrl, 160) ?? null, distanceKm: e.distanceKm, lat: e.venue.lat, lng: e.venue.lng, date: e.startsAt, to: `/evento/${e.id}`, boost: e.boosted ?? null,
      sub: [eventWhen(e.startsAt, e.endsAt), e.venue.name, e.interested ? `${e.interested} com interesse` : null].filter(Boolean).join(' · '),
    });
  for (const p of d.posts ?? [])
    out.push({
      key: `p:${p.id}`, kind: 'post', title: p.locationLabel || p.author.displayName, who: p.locationLabel ? undefined : p.author, image: sized(p.thumbUrl, 160) ?? null, distanceKm: p.distanceKm, lat: p.lat, lng: p.lng, to: `/p/${p.code}`,
      sub: [`@${p.author.username}`, p.kind === 'video' ? 'vídeo' : 'foto', agoText(p.createdAt)].join(' · '),
    });
  for (const g of d.groups ?? [])
    out.push({
      key: `g:${g.id}`, kind: 'group', title: g.name, image: sized(g.avatarUrl ?? g.coverUrl, 160) ?? null, distanceKm: g.distanceKm, lat: g.lat, lng: g.lng, group: g,
      sub: ['TxillGroup', `${g.members} ${g.members === 1 ? 'membro' : 'membros'}`, g.destination].filter(Boolean).join(' · '),
    });
  for (const u of d.people ?? [])
    out.push({
      key: `u:${u.username}`, kind: 'person', title: u.displayName, who: u, username: u.username, image: u.hasAvatar ? `${SITE_URL}/api/v1/avatars/${encodeURIComponent(u.username)}` : null,
      distanceKm: u.approxKm, lat: u.lat, lng: u.lng, to: `/u/${u.username}`, ago: agoText(u.ago), sub: `Por perto ${agoText(u.ago)}`,
    });
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  // Os destaques do Bombar vão à frente (entre eles, pela distância).
  return [...out.filter((i) => i.boost), ...out.filter((i) => !i.boost)];
}

/** "À tua volta": mapa com o que se passa perto (locais, eventos, malta, publicações e TxillGroups), dentro do raio escolhido. */
export default function Perto() {
  const router = useRouter();
  const desktop = useDesktop();
  const qc = useQueryClient();
  const [place, setPlace] = useState<Place | null>(null);
  const [ask, setAsk] = useState<'checking' | 'explain' | 'cities' | 'locating' | null>('checking');
  // A distância: `liveRadius` segue o dedo na barra (o círculo do mapa e o texto do botão), `radius` é a do pedido.
  const [radius, setRadius] = useState<number>(RADIUS.default);
  const [liveRadius, setLiveRadius] = useState<number>(RADIUS.default);
  const pickRadius = useCallback((r: number) => { setLiveRadius(r); setRadius(r); }, []);
  useEffect(() => {
    if (liveRadius === radius) return;
    const t = setTimeout(() => setRadius(liveRadius), RADIUS_SETTLE_MS);
    return () => clearTimeout(t);
  }, [liveRadius, radius]);
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
      // Ao servidor vai arredondado; a posição exata só centra o mapa e nunca sai deste ecrã.
      const lat = round2(pos.coords.latitude);
      const lng = round2(pos.coords.longitude);
      const at = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      fixAt.current = Date.now();
      setPlace((prev) => (prev?.gps && prev.at && prev.lat === lat && prev.lng === lng ? prev : { lat, lng, label: 'Perto de mim', gps: true, at }));
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
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!alive) return;
      // Sem autorização ao abrir (tirada com a app fechada): a última presença no mapa sai logo, não espera as 3 h
      // (como quando a autorização se perde com o mapa aberto).
      if (!perm?.granted) void nearbyApi.clearPresence().catch(() => undefined);
      // «À tua volta» abre onde estás: com o GPS autorizado, a cidade escolhida da outra vez só fica se o GPS não der.
      if (city) {
        if (perm?.granted && !(await locate(false))) return;
        if (!alive) return;
        setPlace({ lat: city.lat, lng: city.lng, label: city.name, gps: false });
        setAsk(null);
        return;
      }
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
  const markers = useMemo<MapMarker[]>(() => items.map((i) => ({ id: i.key, kind: i.kind, lat: i.lat, lng: i.lng, title: i.title, image: i.image, date: i.date ?? null, category: i.category ?? null, boosted: !!i.boost })), [items]);
  const center = useMemo(() => (place ? (place.gps && place.at) || { lat: place.lat, lng: place.lng } : { lat: -25.97, lng: 32.57 }), [place]);

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
    // Tocar num destaque conta no relatório do local (no servidor; só o total).
    if (it.boost) void boostsApi.tap(it.boost.campaignId, 'map').catch(() => undefined);
    if (it.kind === 'group' && it.group) {
      const member = it.group.isMember ?? (groups.data ?? []).some((g) => g.id === it.group!.id);
      if (member) router.push(`/messages/g/${it.group.id}` as never);
      else setGroupInfo(it.group);
      return;
    }
    if (it.to) router.push(it.to as never);
  };

  // ----- Partes do ecrã -----
  // Visível / Invisível: um estado claro (bolinha verde ou cinzenta) com o nome. Invisível abre as opções; visível fica
  // invisível logo (sair do mapa nunca pede confirmação).
  const eyeButton =
    visibility === null || (!canEnable && !visible) ? null : (
      <Pressable
        onPress={() => (visible ? setVis.mutate('off') : setVisSheet(true))}
        disabled={setVis.isPending}
        style={({ pressed }) => [st.eye, visible && st.eyeOn, pressed && { opacity: 0.75 }]}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Estás visível para a malta' : 'Estás invisível para a malta'}
        accessibilityHint={visible ? 'Toca para ficares invisível já' : 'Toca para escolher quem te vê'}
        hitSlop={6}
      >
        <View style={[st.eyeDot, { backgroundColor: visible ? colors.green600 : colors.zinc300 }]} />
        <Icon name={visible ? 'eye' : 'eye-off'} size={17} color={visible ? colors.green700 : colors.zinc700} />
        <Text style={[st.eyeText, visible && { color: colors.green700 }]}>{visible ? 'Visível' : 'Invisível'}</Text>
      </Pressable>
    );

  // ----- Filtros: uma só fila (zona e distância num chip que abre a folha "Onde procurar", depois o que mostrar) -----
  // À procura do GPS (pedido na folha "Onde procurar"): o chip diz, para o toque não parecer perdido.
  const locating = ask === 'locating';
  const zonePill = place ? (
    <Pressable
      onPress={() => setPlaceSheet(true)}
      style={({ pressed }) => [st.zone, pressed && { backgroundColor: colors.rose50 }]}
      hitSlop={{ top: 4, bottom: 4 }}
      accessibilityRole="button"
      accessibilityLabel={`Zona: ${place.label}, até ${liveRadius} km. Mudar o sítio ou a distância`}
    >
      <Icon name={place.gps ? 'locate' : 'map-pin'} size={16} color={colors.brand} />
      <Text style={st.zoneText} numberOfLines={1}>{locating ? 'A ver onde estás…' : place.label}</Text>
      {locating ? null : (
        <View style={st.zoneKm}>
          <Text style={st.zoneKmText}>{liveRadius} km</Text>
        </View>
      )}
      <View style={st.zoneCaret}><Icon name="chevron-right" size={14} strokeWidth={2.4} color={colors.zinc500} /></View>
    </Pressable>
  ) : null;

  const chipAt = useRef<Record<string, { x: number; w: number }>>({});
  const chipGroupX = useRef(0);
  const [chipFocus, setChipFocus] = useState<{ x: number; w: number } | null>(null);
  const chips = (
    <View style={st.filters}>
      <FadeRow contentContainerStyle={st.chipRow} focus={chipFocus}>
        {zonePill}
        <View style={st.chipSep} />
        <View style={st.chipGroup} accessibilityRole="radiogroup" accessibilityLabel="Mostrar" onLayout={(e) => { chipGroupX.current = e.nativeEvent.layout.x; }}>
          {FILTERS.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              on={filter === f.key}
              onLayout={(e) => { chipAt.current[f.key] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }; }}
              onPress={() => {
                if (f.key !== 'events') setWhen('today');
                setFilter(f.key);
                setSelected(null);
                // O chip escolhido fica todo à vista (não meio escondido no esbatido da ponta).
                const at = chipAt.current[f.key];
                if (at) setChipFocus({ x: chipGroupX.current + at.x, w: at.w });
              }}
              dark
            />
          ))}
        </View>
      </FadeRow>
      {/* Quando (só dos eventos): só aparece com "Eventos" escolhido. Ao sair de "Eventos" volta a Hoje (sem filtro ativo escondido). */}
      {filter === 'events' ? (
        <FadeRow contentContainerStyle={st.chipRow}>
          <Icon name="calendar" size={15} color={colors.zinc500} />
          <View style={st.chipGroup} accessibilityRole="radiogroup" accessibilityLabel="Quando">
            {WHENS.map((w) => (
              <Chip key={w.key} label={w.label} on={when === w.key} onPress={() => setWhen(w.key)} small soft />
            ))}
          </View>
        </FadeRow>
      ) : null}
    </View>
  );

  const card =
    visibility === 'off' && canEnable && !hideCard && (filter === 'all' || filter === 'people') ? (
      <VisibilityCard onOpen={() => setVisSheet(true)} onLater={() => setHideCard(true)} />
    ) : null;

  // Vazio: a razão certa para cada filtro (a malta só com visibilidade, eventos de hoje vs. da semana…), o botão que resolve
  // e mais dois caminhos (mudar o sítio, convidar a malta, registar o local ou voltar a Tudo).
  const hint = emptyHint({ filter, when: fetchWhen, radius, radii: RADIUS_STEPS, canEnable });
  const extra = (e: EmptyExtra) => {
    if (e === 'place') setPlaceSheet(true);
    else if (e === 'invite') router.push('/invites' as never);
    else if (e === 'venue') router.push('/locais' as never);
    else {
      setWhen('today');
      setFilter('all');
    }
  };
  const listEmpty = q.isLoading ? (
    <SkeletonList />
  ) : q.isError ? (
    <EmptyState
      art={<View style={[st.errIcon, !desktop && { width: 56, height: 56, borderRadius: 28 }]}><Icon name="alert" size={desktop ? 28 : 24} color={colors.brand} /></View>}
      compact={!desktop}
      title="Não consegui ver o que há à volta"
      sub={loadErrorText(q.error instanceof ApiError ? q.error.status : null)}
      primary={{ label: 'Tentar outra vez', onPress: () => void q.refetch() }}
    />
  ) : (
    <EmptyState
      art={<RadarArt size={desktop ? 112 : 68} />}
      compact={!desktop}
      title={hint.title}
      sub={hint.sub}
      primary={
        hint.action
          ? {
              label: hint.action.label,
              onPress: () => {
                const a = hint.action!;
                if (a.radius) pickRadius(a.radius);
                if (a.when) setWhen(a.when);
              },
            }
          : undefined
      }
      extras={emptyExtras({ filter, canEnable }).map((e) => ({ key: e, label: EMPTY_EXTRA_LABEL[e], icon: EXTRA_ICON[e], onPress: () => extra(e) }))}
    />
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
            <View style={st.distHead}>
              <Text style={st.sheetLabel}>Distância</Text>
              <Text style={st.distValue} accessibilityElementsHidden importantForAccessibility="no">até {liveRadius} km</Text>
            </View>
            {/* Barra de 1 a 50 km (de 1 em 1): o círculo do mapa segue o dedo e o pedido sai ao largar (ou ao parar). */}
            <RangeSlider
              value={liveRadius}
              min={RADIUS.min}
              max={RADIUS.max}
              step={RADIUS.step}
              marks={RADIUS_MARKS}
              onChange={setLiveRadius}
              onCommit={setRadius}
              label="Distância"
              format={(v) => `até ${v} km`}
            />
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
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.deskTitle} accessibilityRole="header">À tua volta</Text>
            <Text style={st.deskSub} numberOfLines={1}>Locais, eventos, a malta e o que se publica perto de ti</Text>
          </View>
          {eyeButton}
        </View>
        <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>{chips}</View>
        <View style={{ flex: 1, flexDirection: 'row', gap: 16, paddingHorizontal: 24, paddingBottom: 24 }}>
          <View style={st.deskMap}>
            <NearbyMap center={center} radiusKm={liveRadius} markers={markers} selectedId={selected} onMarkerPress={setSelected} showMe={place.gps} zoomControl />
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
        peek={items.length ? PEEK_ROWS : PEEK_EMPTY}
        selected={selected}
        head={<ListHead items={items} {...listState} />}
        header={card}
        empty={listEmpty}
        render={row}
        refreshing={pulling}
        onRefresh={() => void pullRefresh()}
        map={(cover) => <NearbyMap center={center} radiusKm={liveRadius} markers={markers} selectedId={selected} onMarkerPress={setSelected} showMe={place.gps} coverBottom={cover} />}
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

function Chip({ label, on, onPress, onLayout, dark = false, small = false, soft = false }: { label: string; on: boolean; onPress: () => void; onLayout?: (e: LayoutChangeEvent) => void; dark?: boolean; small?: boolean; soft?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
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
/** O ícone de cada tipo de local: o mesmo do pino no mapa (mapRuntime VENUE_ICON). */
const VENUE_ICON: Record<string, IconName> = { bar: 'martini', restaurante: 'utensils', cafe: 'coffee', discoteca: 'music', hotel: 'key', evento: 'calendar' };
const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const EXTRA_ICON: Record<EmptyExtra, IconName> = { place: 'map-pin', invite: 'user-plus', venue: 'store', all: 'compass' };
const GROUP_PURPLE = '#7c3aed';

/**
 * Ação do leitor de ecrã em cada linha: "Abrir" abre logo, sem passar pelo mapa. O toque normal (activate) não se declara
 * aqui, para continuar a ser o onPress de sempre (mostrar no mapa e, outra vez, abrir).
 */
const OPEN_ACTIONS: AccessibilityActionInfo[] = [{ name: 'open', label: 'Abrir' }];

/** A imagem da linha: a foto com o anel da marca (pessoas), o logótipo ou o ícone do tipo (locais), a folha do calendário (eventos)… */
function Thumb({ item }: { item: Item }) {
  if (item.kind === 'person') {
    return (
      <View style={st.ring}>
        <LinearGradient colors={[colors.brand, colors.brandWarm]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={[StyleSheet.absoluteFill, { borderRadius: 27 }]} />
        <View style={st.ringInner}><Avatar name={item.title} username={item.username} size={46} /></View>
      </View>
    );
  }
  if (item.kind === 'event') {
    const d = item.date ? new Date(item.date) : null;
    const ok = !!d && !isNaN(d.getTime());
    if (item.image) {
      return (
        <View style={st.thumb}>
          <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
          {ok ? <View style={st.dateChip}><Text style={st.dateChipText}>{`${d!.getDate()} ${MONTHS[d!.getMonth()]}`}</Text></View> : null}
        </View>
      );
    }
    return (
      <View style={st.cal}>
        <View style={st.calTop}><Text style={st.calMonth}>{ok ? MONTHS[d!.getMonth()] : ''}</Text></View>
        <View style={st.calBody}>{ok ? <Text style={st.calDay}>{d!.getDate()}</Text> : <Icon name="calendar" size={20} color={colors.brand} />}</View>
      </View>
    );
  }
  const round = item.kind === 'group';
  const icon = item.kind === 'venue' ? (VENUE_ICON[item.category ?? ''] ?? 'map-pin') : KIND_ICON[item.kind];
  return (
    <View style={[st.thumb, round && { borderRadius: 27 }, item.kind === 'group' && { backgroundColor: GROUP_PURPLE }, item.kind === 'post' && { backgroundColor: colors.zinc200 }]}>
      <Icon name={icon} size={22} color={item.kind === 'post' ? colors.zinc500 : colors.white} />
      {item.image ? <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
    </View>
  );
}

function Row({ item, selected, onPress, onOpen, onHover }: { item: Item; selected: boolean; onPress: () => void; onOpen: () => void; onHover?: () => void }) {
  const km = kmLabel(item.distanceKm).replace(/^a /, '');
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={onHover}
      style={(s) => [st.row, (s as { hovered?: boolean }).hovered && !selected && st.rowHover, s.pressed && !selected && st.rowHover, selected && st.rowSel]}
      accessibilityRole="button"
      accessibilityLabel={`${item.boost ? `${item.boost.label.replace(' · ', ', ')}. ` : ''}${item.title}, ${kmLabel(item.distanceKm)}. ${item.sub}`}
      // O primeiro toque mostra no mapa, o segundo abre. Com o leitor de ecrã há também a ação "Abrir", que abre logo.
      accessibilityHint={selected ? 'Toca para abrir' : 'Toca para mostrar no mapa e outra vez para abrir. Ou usa a ação Abrir'}
      accessibilityState={{ selected }}
      accessibilityActions={OPEN_ACTIONS}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'open') onOpen();
      }}
    >
      <Thumb item={item} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <NameWithBadge name={item.title} who={item.who} style={st.rowTitle} gap={4} />
        <Text style={st.rowSub} numberOfLines={1}>{item.sub}</Text>
        {item.boost ? (
          <View style={st.boostTag}>
            <Icon name="flame" size={12} color={colors.brand} />
            <Text style={st.boostText}>{item.boost.label}</Text>
          </View>
        ) : null}
      </View>
      <View style={[st.kmPill, selected && { borderColor: '#f6c9d1' }]}>
        <Text style={st.kmText} numberOfLines={1}>{km}</Text>
      </View>
      <Pressable onPress={onOpen} hitSlop={{ top: 4, bottom: 4, left: 7, right: 7 }} style={({ pressed }) => [st.rowOpen, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="link" accessibilityLabel={`Abrir ${item.title}`}>
        <Icon name="chevron-right" size={18} strokeWidth={2.2} color={selected ? colors.brand : colors.zinc500} />
      </Pressable>
    </Pressable>
  );
}

/** Fila de chips que rola para o lado: esbatida nas pontas onde ainda há mais (à direita no início, dos dois lados a meio). */
function FadeRow({ children, contentContainerStyle, focus }: { children: React.ReactNode; contentContainerStyle?: StyleProp<ViewStyle>; focus?: { x: number; w: number } | null }) {
  const [edges, setEdges] = useState({ left: false, right: false });
  const box = useRef({ w: 0, cw: 0, x: 0 });
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  // Um chip escolhido perto da ponta: a fila rola até ele ficar fora do esbatido.
  useEffect(() => {
    if (!focus) return;
    const { w, x } = box.current;
    const pad = 48;
    if (focus.x < x + pad) scroll.current?.scrollTo({ x: Math.max(0, focus.x - pad), animated: true });
    else if (focus.x + focus.w > x + w - pad) scroll.current?.scrollTo({ x: focus.x + focus.w - w + pad, animated: true });
  }, [focus]);
  const sync = () => {
    const { w, cw, x } = box.current;
    const left = x > 4;
    const right = w > 0 && x + w < cw - 4;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  };
  return (
    <View>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={contentContainerStyle}
        scrollEventThrottle={32}
        onLayout={(e) => { box.current.w = e.nativeEvent.layout.width; sync(); }}
        onContentSizeChange={(w) => { box.current.cw = w; sync(); }}
        onScroll={(e) => { box.current.x = e.nativeEvent.contentOffset.x; sync(); }}
      >
        {children}
      </ScrollView>
      {edges.left ? <LinearGradient pointerEvents="none" colors={[colors.white, 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[st.chipFade, { left: 0 }]} /> : null}
      {edges.right ? <LinearGradient pointerEvents="none" colors={['rgba(255,255,255,0)', colors.white]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[st.chipFade, { right: 0 }]} /> : null}
    </View>
  );
}

/**
 * Estado vazio (ou de erro): o desenho, o título, uma frase curta, o botão que resolve e mais caminhos. `compact` (telemóvel):
 * o desenho ao lado do texto e os botões numa fila, para tudo caber na folha em baixo sem tapar o mapa.
 */
function EmptyState({ art, title, sub, primary, extras = [], compact = false }: { art: React.ReactNode; title: string; sub: string; primary?: { label: string; onPress: () => void }; extras?: { key: string; label: string; icon: IconName; onPress: () => void }[]; compact?: boolean }) {
  const main = primary ? (
    <Pressable onPress={primary.onPress} style={({ pressed }) => [st.emptyPrimary, compact && st.emptyPrimaryC, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      <Text style={st.emptyPrimaryText}>{primary.label}</Text>
    </Pressable>
  ) : null;
  const more = (
    <>
      {extras.map((e) => (
        <Pressable key={e.key} onPress={e.onPress} style={({ pressed }) => [st.extra, pressed && { backgroundColor: colors.zinc200 }]} accessibilityRole="button">
          <Icon name={e.icon} size={16} color={colors.zinc700} />
          <Text style={st.extraText}>{e.label}</Text>
        </Pressable>
      ))}
    </>
  );
  if (compact) {
    return (
      <View style={st.emptyC}>
        <View style={st.emptyCRow}>
          {art}
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text style={st.emptyTitleC} accessibilityRole="header">{title}</Text>
            <Text style={st.emptySubC}>{sub}</Text>
          </View>
        </View>
        {primary || extras.length ? <View style={st.extrasC}>{main}{more}</View> : null}
      </View>
    );
  }
  return (
    <View style={st.empty}>
      {art}
      <Text style={st.emptyTitle} accessibilityRole="header">{title}</Text>
      <Text style={st.emptySub}>{sub}</Text>
      {main}
      {extras.length ? <View style={st.extras}>{more}</View> : null}
    </View>
  );
}

/** O desenho do vazio: um radar com a bússola ao meio e uns pontos à volta (locais, eventos, a malta) ainda por aparecer. */
function RadarArt({ size = 112 }: { size?: number }) {
  const core = Math.round(size * 0.43);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 128 128">
        <Circle cx={64} cy={64} r={62} fill={colors.rose50} />
        <Circle cx={64} cy={64} r={44} fill="#ffe4e8" />
        <Circle cx={64} cy={64} r={62} fill="none" stroke="#fecdd6" strokeWidth={1} />
        <Circle cx={64} cy={64} r={44} fill="none" stroke="#fda4b4" strokeWidth={1} strokeDasharray="3 4" />
        <Circle cx={22} cy={44} r={6} fill={colors.zinc900} stroke={colors.white} strokeWidth={2.5} />
        <Circle cx={104} cy={36} r={6} fill={GROUP_PURPLE} stroke={colors.white} strokeWidth={2.5} />
        <Circle cx={100} cy={96} r={7} fill={colors.brandWarm} stroke={colors.white} strokeWidth={2.5} />
        <Circle cx={34} cy={102} r={5} fill={colors.sky} stroke={colors.white} strokeWidth={2.5} />
      </Svg>
      <View style={[st.radarCore, { width: core, height: core, borderRadius: core / 2, borderWidth: size < 90 ? 2 : 3 }]}>
        <Icon name="compass" size={Math.round(core * 0.54)} strokeWidth={2} color={colors.white} />
      </View>
    </View>
  );
}

/** A carregar: linhas a fingir (com a forma das de verdade) a pulsar devagar, em vez de uma roda a girar. */
function SkeletonList() {
  const a = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const nd = Platform.OS !== 'web';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 650, useNativeDriver: nd }),
        Animated.timing(a, { toValue: 0.5, duration: 650, useNativeDriver: nd }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  const W = ['64%', '48%', '72%', '42%'] as const;
  return (
    <Animated.View style={{ opacity: a, paddingTop: 2 }} accessibilityRole="progressbar" accessibilityLabel="A procurar o que há à tua volta">
      {W.map((w, i) => (
        <View key={i} style={st.skRow}>
          <View style={[st.skThumb, i % 2 === 1 && { borderRadius: 27 }]} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[st.skLine, { width: w }]} />
            <View style={[st.skLine, { width: '36%', height: 10 }]} />
          </View>
          <View style={st.skPill} />
        </View>
      ))}
    </Animated.View>
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
const KIND_ORDER: MapMarkerKind[] = ['venue', 'event', 'person', 'group', 'post'];

/**
 * Cabeçalho da lista: quantos há (grande) e, por baixo, quantos de cada tipo (ícone e número, curtos para caberem numa linha).
 * `updating`: o que se vê é o anterior, a resposta nova vem a caminho.
 */
function ListHead({ items, loading, updating, failed }: { items: Item[]; loading: boolean; updating: boolean; failed: boolean }) {
  const n = items.length;
  const by = new Map<MapMarkerKind, number>();
  for (const i of items) by.set(i.kind, (by.get(i.kind) ?? 0) + 1);
  const kinds = KIND_ORDER.filter((k) => by.has(k));
  const parts = kinds.map((k) => `${by.get(k)} ${KIND_COUNT[k][by.get(k) === 1 ? 0 : 1]}`);
  const busy = loading || (updating && !n);
  const sub = busy ? 'A procurar…' : updating ? 'A atualizar…' : n ? 'Mais perto primeiro' : failed ? 'Sem resposta do servidor' : 'Nada por perto com estes filtros';
  return (
    <View style={st.listHead} accessibilityRole="header" accessibilityLabel={n ? `${n} à tua volta. ${parts.join(', ')}. ${sub}` : `À tua volta. ${sub}`}>
      <Text style={st.listHeadTitle} numberOfLines={1}>{n ? `${n} à tua volta` : 'À tua volta'}</Text>
      <View style={st.listHeadRow}>
        {n && !busy && kinds.length > 1
          ? kinds.map((k) => (
              <View key={k} style={st.token}>
                <Icon name={KIND_ICON[k]} size={13} strokeWidth={2} color={colors.zinc600} />
                <Text style={st.tokenText}>{by.get(k)}</Text>
              </View>
            ))
          : null}
        <Text style={st.listHeadSub} numberOfLines={1}>{n && !busy && kinds.length === 1 ? `${parts[0]} · ${sub.toLowerCase()}` : sub}</Text>
      </View>
    </View>
  );
}

/** Quanto da lista se vê com a folha em baixo, além do cabeçalho: uma linha inteira e um pouco da seguinte. */
const PEEK_ROWS = 90;
/** Sem nada para mostrar (vazio ou erro): a folha espreita o suficiente para se ver o desenho, a frase e o botão. */
const PEEK_EMPTY = 150;
/** Altura do cabeçalho até ser medido (pega + contagem). */
const HEAD_GUESS = 72;

/** Telemóvel: o mapa ocupa tudo e a lista vive numa folha com três alturas (espreitar, meio e cheia). Em repouso só espreita. */
function PhoneBody({ items, selected, head, header, empty, render, refreshing, onRefresh, map, peek = PEEK_ROWS }: ListProps & { head: React.ReactElement; map: (coverBottom: number) => React.ReactNode; peek?: number }) {
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
  const peekRef = useRef(peek);
  const nd = Platform.OS !== 'web';
  // Em baixo: o cabeçalho (com a faixa de visibilidade, se houver) e cerca de uma linha; nunca acima do meio.
  // Sem resultados (e a carregar) espreita um pouco mais (o peek): o vazio compacto ou duas linhas do esqueleto.
  const snaps = (H: number) => {
    const mid = Math.round(H * 0.48);
    return [24, mid, Math.max(mid + 40, H - (headH.current + peekRef.current + bottom.current))];
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

  // Ficou vazio (ou deixou de estar): se a folha estava em baixo, sobe ou desce para a nova altura de espreitar.
  useEffect(() => {
    if (peekRef.current === peek) return;
    const wasLow = hRef.current > 0 && Math.abs(pos.current - snaps(hRef.current)[2]) < 12;
    peekRef.current = peek;
    if (wasLow) snapTo(snaps(hRef.current)[2]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek]);

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

/**
 * Cartão na folha quando estás invisível: o que a malta vê agora (nada), o que vês tu (tudo) e o que veriam se aparecesses
 * (só o bairro). "Aparecer à malta" abre as opções (e a explicação de privacidade) numa folha própria.
 */
function VisibilityCard({ onOpen, onLater }: { onOpen: () => void; onLater: () => void }) {
  return (
    <View style={st.vis}>
      <View style={st.visHead}>
        <View style={st.visIcon}><Icon name="eye-off" size={18} color={colors.zinc700} /></View>
        <Text style={st.visTitle} numberOfLines={1}>Estás invisível</Text>
        <Pressable onPress={onLater} hitSlop={4} style={({ pressed }) => [st.visX, pressed && { backgroundColor: colors.zinc200 }]} accessibilityRole="button" accessibilityLabel="Agora não">
          <Icon name="x" size={18} color={colors.zinc500} />
        </Pressable>
      </View>
      <Text style={st.visText}>A malta não te vê no mapa. Tu vês tudo na mesma.</Text>
      <View style={st.visFoot}>
        <Pressable
          onPress={onOpen}
          style={({ pressed }) => [st.visBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="Aparecer à malta. Escolher quem te vê"
          accessibilityHint="Mostramos só a zona aproximada, nunca o sítio exato"
        >
          <Icon name="eye" size={16} color={colors.white} />
          <Text style={st.visBtnText}>Aparecer à malta</Text>
        </Pressable>
        <View style={st.visSafe} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon name="shield" size={14} color={colors.zinc500} />
          <Text style={st.visSafeText} numberOfLines={2}>Só o bairro, nunca o sítio exato</Text>
        </View>
      </View>
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
  // Vazio e erro.
  empty: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 10, paddingBottom: 28, gap: 6 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.zinc900, textAlign: 'center', letterSpacing: -0.2, marginTop: 6 },
  emptySub: { fontSize: 14, lineHeight: 20, color: colors.zinc500, textAlign: 'center', maxWidth: 320 },
  emptyPrimary: { marginTop: 10, minHeight: 46, paddingHorizontal: 24, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(214,51,79,0.28)' },
  emptyPrimaryText: { fontSize: 15, fontWeight: '800', color: colors.white },
  extras: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 8 },
  extra: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.zinc100 },
  extraText: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
  radarCore: { position: 'absolute', backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.white, boxShadow: '0 4px 12px rgba(214,51,79,0.35)' },
  // Vazio no telemóvel: o desenho ao lado do texto e os botões numa fila.
  emptyC: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 24, gap: 12 },
  emptyCRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  emptyTitleC: { fontSize: 17, fontWeight: '800', color: colors.zinc900, letterSpacing: -0.2 },
  emptySubC: { fontSize: 13, lineHeight: 18, color: colors.zinc500 },
  extrasC: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emptyPrimaryC: { marginTop: 0, minHeight: 44, paddingHorizontal: 18, boxShadow: '0 3px 10px rgba(214,51,79,0.25)' },
  errIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  // A carregar.
  skRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 8, paddingHorizontal: 10, paddingVertical: 10 },
  skThumb: { width: 54, height: 54, borderRadius: 15, backgroundColor: colors.zinc200 },
  skLine: { height: 13, borderRadius: 7, backgroundColor: colors.zinc200 },
  skPill: { width: 48, height: 24, borderRadius: 12, backgroundColor: colors.zinc100, marginRight: 8 },
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
  headTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.zinc900, letterSpacing: -0.3 },
  // A fila dos filtros fica por cima do mapa, com uma sombra curta em vez de um traço (o mapa parece passar por baixo).
  phoneTop: { backgroundColor: colors.white, zIndex: 2, boxShadow: '0 4px 10px rgba(0,0,0,0.06)' },
  filters: { gap: 8, paddingTop: 2, paddingBottom: 10 },
  chipRow: { paddingLeft: 12, paddingRight: 16, gap: 8, alignItems: 'center' },
  chipGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipSep: { width: 1, height: 20, backgroundColor: colors.zinc200 },
  chipFade: { position: 'absolute', top: 0, bottom: 0, width: 40 },
  chip: { height: 36, borderRadius: 999, paddingHorizontal: 15, borderWidth: 1, borderColor: colors.zinc100, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
  zone: { height: 36, borderRadius: 999, paddingLeft: 11, paddingRight: 9, borderWidth: 1, borderColor: '#f6c9d1', backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 240 },
  zoneText: { fontSize: 14, fontWeight: '700', color: colors.zinc900, flexShrink: 1 },
  zoneKm: { height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: colors.rose50, justifyContent: 'center' },
  zoneKmText: { fontSize: 12, fontWeight: '800', color: colors.brand, fontVariant: ['tabular-nums'] },
  zoneCaret: { transform: [{ rotate: '90deg' }], marginLeft: -1 },
  sheetLabel: { fontSize: 13, fontWeight: '700', color: colors.zinc500 },
  distHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  distValue: { fontSize: 17, fontWeight: '800', color: colors.zinc900, fontVariant: ['tabular-nums'] },
  eye: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingLeft: 10, paddingRight: 13, borderRadius: 999, backgroundColor: colors.zinc100 },
  eyeOn: { backgroundColor: '#e9f9ef' },
  eyeDot: { width: 7, height: 7, borderRadius: 4 },
  eyeText: { fontSize: 13, fontWeight: '800', color: colors.zinc700 },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.rose50 },
  mineText: { fontSize: 15, fontWeight: '700', color: colors.brand },
  sheet: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: colors.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, boxShadow: '0 -6px 24px rgba(0,0,0,0.14)' },
  grab: { paddingTop: 8, paddingBottom: 4, alignItems: 'center', gap: 10 },
  grabBar: { width: 38, height: 5, borderRadius: 3, backgroundColor: colors.zinc300 },
  listHead: { paddingHorizontal: 18, paddingBottom: 8, alignSelf: 'stretch' },
  listHeadTitle: { fontSize: 20, fontWeight: '800', color: colors.zinc900, letterSpacing: -0.3 },
  listHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, minHeight: 22 },
  listHeadSub: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: colors.zinc500 },
  token: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: colors.zinc100 },
  tokenText: { fontSize: 12, fontWeight: '800', color: colors.zinc700, fontVariant: ['tabular-nums'] },
  // Invisível.
  vis: { marginHorizontal: 12, marginTop: 0, marginBottom: 6, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 18, backgroundColor: colors.zinc100, gap: 6 },
  visHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  visIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  visTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.zinc900 },
  visX: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: -6, marginVertical: -4 },
  visText: { fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  visFoot: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  visBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.zinc900 },
  visBtnText: { fontSize: 14, fontWeight: '800', color: colors.white },
  visSafe: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  visSafeText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '600', color: colors.zinc500 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.zinc100 },
  problem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.zinc100, alignSelf: 'stretch' },
  // Linhas (cartões) da lista.
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, marginHorizontal: 8, paddingLeft: 10, paddingRight: 2, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: 'transparent' },
  rowHover: { backgroundColor: colors.zinc100 },
  rowSel: { backgroundColor: colors.rose50, borderColor: '#f9d0d8' },
  thumb: { width: 54, height: 54, borderRadius: 15, backgroundColor: colors.zinc900, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ring: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  ringInner: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  cal: { width: 54, height: 54, borderRadius: 15, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.zinc200, overflow: 'hidden' },
  calTop: { height: 17, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  calMonth: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: colors.white },
  calBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  calDay: { fontSize: 20, fontWeight: '800', color: colors.zinc900, fontVariant: ['tabular-nums'] },
  dateChip: { position: 'absolute', left: 4, bottom: 4, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.white },
  dateChipText: { fontSize: 9, fontWeight: '800', color: colors.brand, letterSpacing: 0.3 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900, flexShrink: 1 },
  rowSub: { fontSize: 13, color: colors.zinc500, marginTop: 3 },
  boostTag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 5, borderRadius: 999, backgroundColor: colors.rose50, paddingHorizontal: 8, paddingVertical: 2 },
  boostText: { fontSize: 11, fontWeight: '800', color: colors.brand },
  kmPill: { height: 24, paddingHorizontal: 7, borderRadius: 12, borderWidth: 1, borderColor: colors.zinc200, backgroundColor: colors.white, justifyContent: 'center' },
  kmText: { fontSize: 12, fontWeight: '800', color: colors.zinc700, fontVariant: ['tabular-nums'] },
  rowOpen: { width: 30, height: 36, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  cardText: { fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.zinc200 },
  optOn: { borderColor: colors.brand, backgroundColor: colors.rose50 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  optTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  optSub: { fontSize: 13, color: colors.zinc500, marginTop: 1 },
  deskHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingTop: 22 },
  deskTitle: { fontSize: 26, fontWeight: '800', color: colors.zinc900, letterSpacing: -0.4 },
  deskSub: { fontSize: 14, fontWeight: '500', color: colors.zinc500, marginTop: 2 },
  deskMap: { flex: 1, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.zinc200, backgroundColor: '#f2efe9' },
  deskList: { width: 400, borderRadius: 22, borderWidth: 1, borderColor: colors.zinc200, overflow: 'hidden', paddingTop: 16, backgroundColor: colors.white, ...cardShadow },
});
