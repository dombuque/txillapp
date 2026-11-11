import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Field, Pill } from '@/components/groups/GroupParts';
import { PlaceMiniMap } from '@/components/nearby/PlaceMiniMap';
import { PlacePickMap } from '@/components/nearby/PlacePickMap';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Sheet, useSheetScroll } from '@/components/Sheet';
import type { Profile } from '@/lib/api';
import { composeApi } from '@/lib/api.compose';
import { useAuth } from '@/lib/auth';
import { startCity } from '@/lib/cities';
import { devicePosition, locationPermission, preciseDevicePosition, type LatLng } from '@/lib/devicePosition';
import { kvGet } from '@/lib/kv';
import {
  ADDRESS_MAX, CITY_MAX, applyReverse, createDebounce, distanceM, movedValue, placeA11y, placeKindIcon, placeSubtitle, placeTitle, round2, round6,
  searchQuery, searchStatus, suggestionToValue, type PlaceSuggestion, type PlaceValue,
} from '@/lib/placeField';
import { colors } from '@/lib/theme';

export type { PlaceValue } from '@/lib/placeField';

/** O que o ecrã de fora pode pedir ao campo (o atalho do aviso "Este local ainda não está no mapa"). */
export interface PlaceFieldHandle {
  focus: () => void;
  openMap: () => void;
}

/**
 * "Onde fica?": escreve-se o sítio e aparecem sugestões (com a posição aproximada do aparelho, se a app já a tiver, para
 * ordenar por perto; nunca pede a permissão só para isto). Escolhida uma, mostra o mapa pequeno com o pino, a morada e a cidade,
 * e dá para "Ajustar no mapa" (arrastar o pino) ou "Usar a minha localização". Também se pode "Marcar no mapa" sem pesquisar.
 * O mesmo no telemóvel e no site.
 */
export function PlaceField({ label, value, onChange, onTyped, initialQuery = '', placeholder = 'Procurar o sítio…', mapHint, ref }: {
  label?: string;
  value: PlaceValue | null;
  onChange: (v: PlaceValue | null) => void;
  /** O texto escrito na pesquisa (para avisar "escolhe uma sugestão"). */
  onTyped?: (text: string) => void;
  /** Começar já a procurar isto (a morada em texto que o local já tinha). */
  initialQuery?: string;
  placeholder?: string;
  /** O texto por cima do mapa de "Marcar no mapa". */
  mapHint?: string;
  ref?: Ref<PlaceFieldHandle>;
}) {
  const [text, setText] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [near, setNear] = useState<LatLng | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [map, setMap] = useState<{ center: LatLng | null; name?: string | null; note?: string } | null>(null);
  const [reversing, setReversing] = useState(false);
  const [locating, setLocating] = useState<'explain' | 'busy' | null>(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState('');
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const alive = useRef(true);
  const seq = useRef(0);
  const deb = useRef(createDebounce<string>((t) => { if (alive.current) setDebounced(t); })).current;
  useEffect(() => () => { alive.current = false; deb.cancel(); }, [deb]);

  // A posição aproximada (~1 km) só se a app já a puder ler: ordena as sugestões por perto. Sem permissão, procura sem ela.
  useEffect(() => {
    void devicePosition(false).then((p) => { if (alive.current && p) setNear({ lat: round2(p.lat), lng: round2(p.lng) }); });
  }, []);

  const q = searchQuery(debounced);
  const found = useQuery({
    queryKey: ['place-search', q, near?.lat, near?.lng],
    queryFn: () => composeApi.searchPlaces(q, near ?? undefined),
    enabled: !!q,
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
  const hits = searchQuery(text) ? (found.data ?? []).slice(0, 6) : [];
  const status = searchStatus({ text, debounced, loading: found.isFetching, error: found.isError, count: hits.length });

  function onText(t: string) {
    setText(t);
    setMsg('');
    onTyped?.(t);
    deb.push(t);
  }

  /** A morada e a cidade de um ponto; chega depois de o pino já estar no sítio. Um pedido mais novo ganha ao antigo. */
  async function fillAddress(v: PlaceValue, keepAddress: boolean) {
    const my = ++seq.current;
    setReversing(true);
    try {
      const rev = await composeApi.reversePlace(round6(v.lat), round6(v.lng));
      if (!alive.current || my !== seq.current) return;
      const next = applyReverse(v, v, rev);
      onChange(keepAddress ? { ...next, address: v.address ?? next.address, city: v.city ?? next.city } : next);
      if (!keepAddress && !next.address && !next.city) setMsg('Não encontrei a morada deste ponto. Podes escrevê-la em "Corrigir a morada".');
    } catch {
      if (!alive.current || my !== seq.current) return;
      if (!keepAddress) setMsg('Não consegui saber a morada agora. O pino fica; podes escrever a morada em "Corrigir a morada".');
    } finally {
      if (alive.current && my === seq.current) setReversing(false);
    }
  }

  /** Pôr o pino num ponto novo (do mapa ou da minha posição) e ir buscar a morada. */
  function placeAt(at: LatLng, name?: string | null) {
    const base = movedValue(value, at);
    const v = name ? { ...base, name } : base;
    onChange(v);
    setReplacing(false);
    setText('');
    setDebounced('');
    deb.cancel();
    onTyped?.('');
    setMsg('');
    void fillAddress(v, false);
  }

  function choose(h: PlaceSuggestion) {
    const v = suggestionToValue(h);
    if (!v) {
      // Servidor antigo (sugestão sem coordenadas): marca-se no mapa, com o nome já posto.
      openMap(h.name, `Não sei o ponto exato de "${h.name}". Arrasta o mapa até o alfinete ficar lá.`);
      return;
    }
    seq.current++;
    setReversing(false);
    onChange(v);
    setReplacing(false);
    setEditing(false);
    setText('');
    setDebounced('');
    deb.cancel();
    onTyped?.('');
    setMsg('');
    // A sugestão não trouxe a cidade: vai buscá-la ao ponto (a morada da sugestão fica).
    if (!v.city) void fillAddress(v, true);
  }

  function openMap(name?: string | null, note?: string) {
    setMsg('');
    setMap({ center: value ? { lat: value.lat, lng: value.lng } : null, name, note });
  }

  async function mine(confirmed = false) {
    setMsg('');
    if (!confirmed) {
      const perm = await locationPermission();
      if (!alive.current) return;
      if (perm === 'blocked') {
        setMsg('A localização está desligada para o Txillapp. Liga-a nas definições do telemóvel ou marca no mapa.');
        return;
      }
      if (perm === 'ask') {
        setLocating('explain');
        return;
      }
    }
    setLocating('busy');
    const here = await preciseDevicePosition();
    if (!alive.current) return;
    setLocating(null);
    if (here) placeAt(here);
    else setMsg('Não consegui saber onde estás. Liga a localização ou marca no mapa.');
  }

  /** Corrigir a morada à mão: ganha a qualquer morada que ainda viesse a caminho. */
  function edit(patch: Partial<PlaceValue>) {
    if (!value) return;
    seq.current++;
    setReversing(false);
    onChange({ ...value, ...patch });
  }

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (value) setReplacing(true);
      setTimeout(() => input.current?.focus(), 50);
    },
    openMap: () => openMap(),
  }));

  const searching = !value || replacing;
  const subtitle = value ? placeSubtitle(value) : '';

  return (
    <View style={{ gap: 10 }}>
      {label ? <Text style={st.label} accessibilityRole="header">{label}</Text> : null}

      {value && !replacing ? (
        <View style={st.card} accessibilityLabel={placeA11y(value)}>
          <PlaceMiniMap lat={value.lat} lng={value.lng} label={`Mapa com o pino em ${placeTitle(value)}`} style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }} />
          <View style={st.cardBody}>
            <View style={st.pinIcon}><Icon name="map-pin" size={18} color={colors.brand} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.title} numberOfLines={2}>{placeTitle(value)}</Text>
              <Text style={st.sub} numberOfLines={2} accessibilityLiveRegion="polite">
                {reversing ? 'A procurar a morada…' : subtitle || (value.name || value.address ? '' : 'Sem morada: corrige à mão se quiseres.')}
              </Text>
            </View>
            <Pressable onPress={() => { setReplacing(true); setTimeout(() => input.current?.focus(), 50); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Procurar outro sítio">
              <Text style={st.link}>Mudar</Text>
            </Pressable>
          </View>
          <View style={st.actions}>
            <Pill label="Ajustar no mapa" icon="map" kind="soft" small onPress={() => openMap(value.name)} />
            <Pill label={locating === 'busy' ? 'A procurar…' : 'Usar a minha localização'} icon="locate" kind="soft" small busy={locating === 'busy'} onPress={() => void mine()} />
            <Pill label={editing ? 'Fechar a morada' : 'Corrigir a morada'} icon="pencil" kind="ghost" small onPress={() => setEditing((e) => !e)} />
          </View>
          {editing ? (
            <View style={{ gap: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
              <Field value={value.address ?? ''} onChangeText={(t) => edit({ address: t || null })} maxLength={ADDRESS_MAX} placeholder="Morada (rua, número, bairro)" accessibilityLabel="Morada" />
              <Field value={value.city ?? ''} onChangeText={(t) => edit({ city: t || null })} maxLength={CITY_MAX} placeholder="Cidade" accessibilityLabel="Cidade" />
            </View>
          ) : null}
        </View>
      ) : null}

      {searching ? (
        <View style={{ gap: 8 }}>
          <View style={st.searchWrap}>
            <View style={st.searchIcon} pointerEvents="none"><Icon name="search" size={20} strokeWidth={2.2} color={colors.zinc500} /></View>
            <TextInput
              ref={input}
              value={text}
              onChangeText={onText}
              maxLength={120}
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => { const t = searchQuery(text); if (t) { deb.cancel(); setDebounced(t); } }}
              placeholder={placeholder}
              placeholderTextColor={colors.zinc500}
              accessibilityLabel={label ? `${label}: procurar o sítio` : 'Procurar o sítio'}
              accessibilityHint="Escreve o nome ou a morada e escolhe uma sugestão"
              style={st.search}
            />
            {text ? (
              <Pressable onPress={() => onText('')} style={st.clear} accessibilityRole="button" accessibilityLabel="Limpar a pesquisa"><Icon name="x" size={18} color={colors.zinc500} /></Pressable>
            ) : null}
          </View>

          <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
            {status === 'waiting' || status === 'loading' ? (
              <View style={st.stateRow}><ActivityIndicator /><Text style={st.stateText}>A procurar…</Text></View>
            ) : null}
            {status === 'error' ? (
              <View style={st.stateRow}>
                <Text style={[st.stateText, { flex: 1 }]}>Não consegui procurar agora.</Text>
                <Pressable onPress={() => void found.refetch()} hitSlop={8} accessibilityRole="button"><Text style={st.link}>Tentar outra vez</Text></Pressable>
              </View>
            ) : null}
            {status === 'empty' ? (
              <View style={st.stateRow}>
                <Text style={[st.stateText, { flex: 1 }]}>Não encontrei. Marca no mapa.</Text>
                <Pressable onPress={() => openMap(searchQuery(text))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Marcar no mapa"><Text style={st.link}>Marcar no mapa</Text></Pressable>
              </View>
            ) : null}
            {status === 'results'
              ? hits.map((h, i) => {
                const sub = h.address || h.sub;
                return (
                  <Pressable
                    key={`${h.name}-${h.lat ?? ''}-${h.lng ?? ''}-${i}`}
                    onPress={() => choose(h)}
                    style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.zinc100 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${h.name}${sub ? `, ${sub}` : ''}`}
                  >
                    <View style={st.rowIcon}><Icon name={placeKindIcon(h.kind)} size={20} color={colors.zinc800} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={st.rowTitle} numberOfLines={1}>{h.name}</Text>
                      {sub ? <Text style={st.rowSub} numberOfLines={1}>{sub}</Text> : null}
                    </View>
                  </Pressable>
                );
              })
              : null}
          </View>

          <View style={st.actionsBare}>
            <Pill label="Marcar no mapa" icon="map-pin" kind="soft" small onPress={() => openMap(searchQuery(text) || null)} />
            <Pill label={locating === 'busy' ? 'A procurar…' : 'Usar a minha localização'} icon="locate" kind="soft" small busy={locating === 'busy'} onPress={() => void mine()} />
            {value && replacing ? <Pill label="Cancelar" kind="ghost" small onPress={() => { setReplacing(false); onText(''); }} /> : null}
          </View>
        </View>
      ) : null}

      {locating === 'explain' ? (
        <View style={st.explain}>
          <Icon name="locate" size={18} color={colors.zinc700} />
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={st.explainText}>Para pôr o pino onde estás agora, o Txillapp vai pedir a localização do aparelho. Só a usa para marcar este sítio.</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pill label="Continuar" small onPress={() => void mine(true)} />
              <Pill label="Agora não" kind="ghost" small onPress={() => setLocating(null)} />
            </View>
          </View>
        </View>
      ) : null}

      {msg ? <Text style={st.msg} accessibilityRole="alert">{msg}</Text> : null}

      {map ? (
        <AdjustSheet
          initial={map.center}
          note={map.note ?? mapHint}
          onPick={(at) => { if (!value || distanceM(value, at) > 2) placeAt(at, map.name); }}
          onClose={() => setMap(null)}
        />
      ) : null}
    </View>
  );
}

/**
 * "Ajustar no mapa" / "Marcar no mapa": o alfinete parado ao centro e arrasta-se o mapa. Abre no sítio escolhido; senão na
 * posição do aparelho (sem pedir); senão na cidade (À tua volta, perfil) ou Maputo. O ponto vai exato (é a porta do sítio).
 */
function AdjustSheet({ initial, note, onPick, onClose }: { initial: LatLng | null; note?: string; onPick: (at: LatLng) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [center, setCenter] = useState<LatLng | null>(initial);
  const [point, setPoint] = useState<LatLng | null>(initial);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (initial) return;
    void (async () => {
      const here = await devicePosition(false);
      if (!alive.current) return;
      if (here) { setCenter(here); return; }
      const chosen = await kvGet('txill.perto.place').catch(() => null);
      const profileCity = user ? qc.getQueryData<Profile>(['profile', user.username])?.city : null;
      if (!alive.current) return;
      setCenter((c) => c ?? startCity(chosen, profileCity));
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function use() {
    if (!point) return;
    onPick(point);
    onClose();
  }

  return (
    <Sheet title="Marcar no mapa" onClose={onClose} full>
      {/* Sem ScrollView: o mapa apanha os gestos todos. */}
      <View style={{ flex: 1, paddingHorizontal: 20, paddingBottom: 8, gap: 12 }}>
        <Text style={st.hintText}>{note ?? 'Arrasta o mapa até o alfinete ficar na porta do sítio.'}</Text>
        {center ? <MapBox center={center} onMove={setPoint} /> : <View style={[st.bigMap, st.mapWait]}><Text style={st.stateText}>A abrir o mapa…</Text></View>}
        <Pill label="Usar este sítio" onPress={use} disabled={!point} />
      </View>
    </Sheet>
  );
}

/** O mapa dentro da folha: enquanto o dedo está no mapa, arrastar para baixo mexe o mapa e não fecha a folha. */
function MapBox({ center, onMove }: { center: LatLng; onMove: (c: LatLng) => void }) {
  const sheet = useSheetScroll();
  const hold = () => { if (sheet) sheet.top.current = false; };
  const free = () => { if (sheet) sheet.top.current = true; };
  const c = useMemo(() => center, [center.lat, center.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View
      style={st.bigMap}
      onTouchStart={hold}
      onTouchEnd={free}
      onTouchCancel={free}
      accessible={Platform.OS !== 'web'}
      accessibilityLabel="Mapa para marcar o sítio. Arrasta o mapa para mover o alfinete."
    >
      <PlacePickMap center={c} onMove={onMove} zone={false} zoom={16} style={{ flex: 1 }} />
    </View>
  );
}

const st = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
  card: { borderRadius: 18, borderWidth: 1, borderColor: colors.zinc200, backgroundColor: colors.white, overflow: 'hidden' },
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 12 },
  pinIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '800', color: colors.zinc900 },
  sub: { fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  link: { fontSize: 14, fontWeight: '800', color: colors.brand },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  actionsBare: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  searchWrap: { justifyContent: 'center' },
  searchIcon: { position: 'absolute', left: 16, zIndex: 1 },
  search: { height: 48, borderRadius: 16, backgroundColor: colors.zinc100, paddingLeft: 44, paddingRight: 44, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  clear: { position: 'absolute', right: 6, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingVertical: 10 },
  stateText: { fontSize: 14, color: colors.zinc600 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingVertical: 8, borderRadius: 12 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  rowSub: { fontSize: 13, color: colors.zinc500 },
  explain: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: 16, backgroundColor: colors.zinc100, padding: 12 },
  explainText: { fontSize: 14, lineHeight: 20, color: colors.zinc700 },
  msg: { fontSize: 14, lineHeight: 20, color: colors.red600 },
  hintText: { fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  bigMap: { flex: 1, minHeight: 200, borderRadius: 16, overflow: 'hidden', backgroundColor: '#f2efe9' },
  mapWait: { alignItems: 'center', justifyContent: 'center' },
});
