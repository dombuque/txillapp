import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { composeApi, type NearbyPlaces } from '@/lib/api.compose';
import { colors } from '@/lib/theme';

const kindIcon: Record<string, IconName> = { praia: 'waves', bar: 'cheers', restaurante: 'utensils', lazer: 'trees', turismo: 'camera', local: 'map-pin' };

/** A posição do SÍTIO escolhido (nunca a da pessoa). `coarse`: zona ou cidade (arredonda-se mais). */
export interface PlaceGeo { lat: number; lng: number; coarse?: boolean }
interface Option { label: string; sub?: string; icon: IconName; geo?: PlaceGeo }
type Status = 'locating' | 'searching' | 'ready' | 'error';

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Pede a posição (browser ou aparelho) e devolve-a; as coordenadas ficam só em memória. */
async function whereAmI(): Promise<{ lat: number; lng: number }> {
  if (Platform.OS === 'web') {
    const g = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!g) throw new Error('Este dispositivo não sabe dizer onde estás. Escreve à mão.');
    return new Promise((ok, no) =>
      g.getCurrentPosition(
        (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
        (e) => no(new Error(e.code === e.PERMISSION_DENIED ? 'Sem permissão de localização. Ativa-a no browser ou escreve à mão.' : 'Não consegui apanhar o teu sinal. Tenta outra vez ou escreve à mão.')),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
      ),
    );
  }
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new Error('Sem permissão de localização. Ativa-a nas definições ou escreve à mão.');
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: p.coords.latitude, lng: p.coords.longitude };
}

function Row({ o, onPick }: { o: Option; onPick: () => void }) {
  return (
    <Pressable onPress={onPick} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
      <View style={styles.rowIcon}><Icon name={o.icon} size={22} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{o.label}</Text>
        {o.sub ? <Text style={styles.rowSub} numberOfLines={1}>{o.sub}</Text> : null}
      </View>
    </Pressable>
  );
}

function Skeleton() {
  return (
    <View style={{ marginTop: 12 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.row}>
          <View style={[styles.rowIcon, { backgroundColor: colors.zinc200 }]} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ height: 14, width: '66%', borderRadius: 7, backgroundColor: colors.zinc200 }} />
            <View style={{ height: 12, width: '33%', borderRadius: 6, backgroundColor: colors.zinc200 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** "Onde estás?" como no site: já procura sítios perto ao abrir, sugere enquanto escreves, mostra "A bater agora" e aceita texto livre. */
export function PlaceSheet({ value, onChange, onClose, photoAt }: {
  value: string; onChange: (v: string, geo?: PlaceGeo) => void; onClose: () => void;
  /** Onde a foto foi tirada (GPS dos metadados): sugere primeiro os sítios de lá. */
  photoAt?: { lat: number; lng: number } | null;
}) {
  const [status, setStatus] = useState<Status>('locating');
  const [data, setData] = useState<NearbyPlaces | null>(null);
  const [at, setAt] = useState<{ lat: number; lng: number } | null>(null);
  const [msg, setMsg] = useState('');
  const [typed, setTyped] = useState(value);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const text = typed.trim();
  const debounced = useDebounced(text, 300);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function locate() {
    setMsg('');
    setStatus('locating');
    try {
      const here = await whereAmI();
      if (!alive.current) return;
      setAt(here);
      setStatus('searching');
      try {
        const d = await composeApi.nearbyPlaces(here.lat, here.lng);
        if (!alive.current) return;
        setData(d);
        setStatus('ready');
      } catch {
        if (!alive.current) return;
        setStatus('error');
        setMsg('Não consegui procurar sítios agora. Escreve à mão.');
      }
    } catch (e) {
      if (!alive.current) return;
      setStatus('error');
      setMsg((e as Error).message || 'Não consegui apanhar o teu sinal. Tenta outra vez ou escreve à mão.');
    }
  }
  useEffect(() => { void locate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hot = useQuery({ queryKey: ['places-hot'], queryFn: composeApi.hotPlaces, staleTime: 5 * 60_000, retry: false });
  const found = useQuery({ queryKey: ['place-search', debounced, at?.lat, at?.lng], queryFn: () => composeApi.searchPlaces(debounced, at ?? undefined), enabled: debounced.length >= 2, staleTime: 5 * 60_000, retry: false });

  const pick = (label: string, geo?: PlaceGeo) => {
    onChange(label, geo);
    onClose();
  };

  const fromPhoto = useQuery({
    queryKey: ['places-photo', photoAt?.lat, photoAt?.lng],
    queryFn: () => composeApi.nearbyPlaces(photoAt!.lat, photoAt!.lng),
    enabled: !!photoAt,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const photoOpts: Option[] = [];
  if (fromPhoto.data && photoAt) {
    const pd = fromPhoto.data;
    for (const p of pd.places.slice(0, 3)) photoOpts.push({ label: p.name, sub: pd.area ?? undefined, icon: kindIcon[p.kind] ?? 'map-pin', geo: { lat: p.lat, lng: p.lng } });
    if (pd.area) photoOpts.push({ label: pd.area, sub: pd.city ?? undefined, icon: 'camera', geo: { ...photoAt, coarse: true } });
    else if (pd.city) photoOpts.push({ label: pd.city, icon: 'camera', geo: { ...photoAt, coarse: true } });
  }

  const nearby: Option[] = [];
  if (data) {
    for (const p of data.places) {
      const d = p.distanceM < 1000 ? `${p.distanceM} m` : `${(p.distanceM / 1000).toFixed(1)} km`;
      nearby.push({ label: p.name, sub: `${d}${data.area ? ` · ${data.area}` : ''}`, icon: kindIcon[p.kind] ?? 'map-pin', geo: { lat: p.lat, lng: p.lng } });
    }
    if (data.area) nearby.push({ label: data.area, sub: data.city ?? undefined, icon: 'home', geo: at ? { ...at, coarse: true } : undefined });
    if (data.city && data.city !== data.area) nearby.push({ label: data.city, icon: 'city', geo: at ? { ...at, coarse: true } : undefined });
  }
  const noNearby = status === 'error' || (status === 'ready' && nearby.length === 0);
  useEffect(() => { if (noNearby) input.current?.focus(); }, [noNearby]);
  const suggestions: Option[] = (found.data ?? []).map((h) => ({ label: h.name, sub: h.sub || undefined, icon: kindIcon[h.kind] ?? 'map-pin' }));
  const searching = text.length >= 2;
  const fullName = (o: Option) => (o.sub ? `${o.label}, ${o.sub.split(', ')[0]}` : o.label);

  return (
    <Sheet title="Onde estás?" onClose={onClose} full>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, minHeight: 260 }} showsVerticalScrollIndicator={false}>
        <View style={styles.searchWrap}>
          <View style={styles.searchIcon} pointerEvents="none"><Icon name="search" size={20} strokeWidth={2.2} color={colors.zinc500} /></View>
          <TextInput
            ref={input}
            value={typed}
            onChangeText={setTyped}
            maxLength={80}
            returnKeyType="done"
            onSubmitEditing={() => text && pick(text)}
            autoCorrect={false}
            placeholder="Procura um sítio…"
            placeholderTextColor={colors.zinc500}
            accessibilityLabel="Local"
            style={styles.search}
          />
          {typed ? (
            <Pressable onPress={() => setTyped('')} style={styles.clear} accessibilityLabel="Limpar"><Icon name="x" size={18} color={colors.zinc500} /></Pressable>
          ) : null}
        </View>

        {!searching && (hot.data?.length ?? 0) > 0 ? (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.label}>A bater agora</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }} keyboardShouldPersistTaps="handled">
              {hot.data!.map((h) => (
                <Pressable key={h.name} onPress={() => pick(h.name)} style={({ pressed }) => [styles.hot, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button">
                  <Icon name="flame" size={14} color={colors.amber600} />
                  <Text style={styles.hotText}>{h.name}</Text>
                  <Text style={styles.hotCount}>{h.posts}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {searching ? (
          <View style={{ marginTop: 8 }} accessibilityLiveRegion="polite">
            <Row o={{ label: `Usar “${text}”`, sub: 'Escrever à mão', icon: 'pencil' }} onPick={() => pick(text)} />
            {found.isFetching && suggestions.length === 0 ? <Skeleton /> : null}
            {suggestions.map((o, i) => <Row key={`${o.label}-${i}`} o={o} onPick={() => pick(fullName(o))} />)}
            {!found.isFetching && debounced === text && suggestions.length === 0 ? <Text style={styles.empty}>Nada com esse nome. Podes usar o que escreveste.</Text> : null}
          </View>
        ) : (
          <>
            {photoOpts.length > 0 ? (
              <>
                <Text style={[styles.label, { marginTop: 16, marginBottom: 4 }]}>Onde a foto foi tirada</Text>
                {photoOpts.map((o, i) => (
                  <Row key={`f-${o.label}-${i}`} o={o} onPick={() => pick(o.sub && o.icon !== 'camera' ? `${o.label}, ${o.sub}` : o.label, o.geo)} />
                ))}
              </>
            ) : null}
            {status === 'locating' || status === 'searching' ? (
              <>
                <Text style={[styles.label, { marginTop: 16 }]}>{status === 'locating' ? 'A apanhar o teu sinal…' : 'A ver o que há por perto…'}</Text>
                <Skeleton />
              </>
            ) : null}
            {status === 'error' ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }} accessibilityRole="alert">
                <Text style={styles.msg}>{msg}</Text>
                <Pressable onPress={() => void locate()} style={styles.again}><Text style={styles.againText}>Tentar outra vez</Text></Pressable>
              </View>
            ) : null}
            {status === 'ready' && nearby.length === 0 ? <Text style={[styles.msg, { paddingVertical: 24, textAlign: 'center' }]}>Não encontrei nada por perto. Escreve o sítio acima.</Text> : null}
            {status === 'ready' && nearby.length > 0 ? (
              <>
                <Text style={[styles.label, { marginTop: 16, marginBottom: 4 }]}>Perto de ti</Text>
                {nearby.map((o, i) => (
                  <Row key={`${o.label}-${i}`} o={o} onPick={() => pick(data?.area && o.label !== data.area && o.sub?.includes('·') ? `${o.label}, ${data.area}` : o.label, o.geo)} />
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  searchWrap: { justifyContent: 'center' },
  searchIcon: { position: 'absolute', left: 16, zIndex: 1 },
  search: { height: 48, borderRadius: 24, backgroundColor: colors.zinc100, paddingLeft: 44, paddingRight: 44, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  clear: { position: 'absolute', right: 6, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600', color: colors.zinc500, marginBottom: 8 },
  hot: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', paddingHorizontal: 14, paddingVertical: 8 },
  hotText: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  hotCount: { fontSize: 12, fontWeight: '700', color: '#b45309' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingVertical: 10, borderRadius: 12 },
  rowIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  rowSub: { fontSize: 14, color: colors.zinc500 },
  empty: { paddingHorizontal: 4, paddingVertical: 12, fontSize: 14, color: colors.zinc500 },
  msg: { fontSize: 16, color: colors.zinc700 },
  again: { marginTop: 12, borderRadius: 999, backgroundColor: colors.rose50, paddingHorizontal: 20, paddingVertical: 8 },
  againText: { fontWeight: '600', color: colors.brand },
});
