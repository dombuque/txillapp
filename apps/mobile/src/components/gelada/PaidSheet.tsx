import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Sheet } from '@/components/Sheet';
import type { GeladaDebt } from '@/lib/api.gelada';
import { locaisApi, type Venue } from '@/lib/api.locais';
import { round2 } from '@/lib/api.nearby';
import { abs, sized } from '@/lib/config';
import { devicePosition, locationPermission, type LatLng } from '@/lib/devicePosition';
import { debtLine, distanceLabel, venuesByDistance, venueTag } from '@/lib/gelada';
import { colors } from '@/lib/theme';

/** O local escolhido no «Já paguei». `near`: estou dentro do raio (o servidor confirma com a posição). */
export interface PaidPlace { slug: string; name: string; kind: string; near: boolean }
/** O que o «Já paguei» leva: com ou sem foto, o local (se o escolheu) e a posição de agora (só com o local; não se guarda). */
export interface PaidChoice { photo: boolean; place: PaidPlace | null; at: LatLng | null }

const GREEN = '#15803d';

/**
 * «Já pagaste?»: confirmar o pagamento, com uma foto e/ou o local onde foi a gelada (opcional). O local mostra primeiro os
 * que estão perto (como no «À tua volta») e procura-se pelo nome. Não é um check-in oficial (esse é só com o QR do local):
 * é a etiqueta «no Bar X», que só as duas pessoas veem. Se a pessoa estiver mesmo lá (GPS a até 150 m), leva o selo
 * «✓ estiveram lá».
 */
export function PaidSheet({ debt, onClose, onClaim }: { debt: GeladaDebt; onClose: () => void; onClaim: (c: PaidChoice) => void }) {
  const [place, setPlace] = useState<PaidPlace | null>(null);
  const [at, setAt] = useState<LatLng | null>(null);
  const [picking, setPicking] = useState(false);
  const who = debt.creditor.username ? `@${debt.creditor.username}` : 'a outra pessoa';

  if (picking) {
    return (
      <PlacePicker
        at={at}
        onAt={setAt}
        onPick={(p) => { setPlace(p); setPicking(false); }}
        onBack={() => setPicking(false)}
      />
    );
  }
  const claim = (photo: boolean) => onClaim({ photo, place, at: place ? at : null });
  return (
    <Sheet title="Já pagaste?" onClose={onClose}>
      <View style={st.body}>
        <Text style={st.text}>{debtLine(debt)}. Fica como paga quando {who} confirmar.</Text>
        {place ? (
          <View style={st.placeOn}>
            <Icon name="map-pin" size={20} color={colors.brand} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.placeName} numberOfLines={1}>{venueTag(place)}</Text>
              {place.near ? <Text style={st.there}>✓ Estás aqui: vai com o selo «estiveram lá»</Text> : <Text style={st.sub}>Só tu e {who} veem o local.</Text>}
            </View>
            <Pressable onPress={() => setPicking(true)} hitSlop={8} style={st.link} accessibilityRole="button" accessibilityLabel="Mudar o local">
              <Text style={st.linkText}>Mudar</Text>
            </Pressable>
            <Pressable onPress={() => setPlace(null)} hitSlop={8} style={st.link} accessibilityRole="button" accessibilityLabel="Tirar o local">
              <Icon name="x" size={18} color={colors.zinc600} />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setPicking(true)} style={({ pressed }) => [st.placeOff, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
            <Icon name="map-pin" size={20} color={colors.zinc700} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.placeName}>Onde foi? <Text style={st.optional}>(opcional)</Text></Text>
              <Text style={st.sub}>Junta o local. Só tu e {who} o veem.</Text>
            </View>
            <Icon name="chevron-right" size={18} color={colors.zinc500} />
          </Pressable>
        )}
        <Btn icon="check" label="Já paguei" onPress={() => claim(false)} primary />
        <Btn icon="camera" label="Já paguei, com uma foto" onPress={() => claim(true)} />
      </View>
    </Sheet>
  );
}

type Where = 'checking' | 'ask' | 'locating' | 'ready' | 'blocked' | 'none';

/** Escolher o local: os de perto primeiro (com a distância) e a pesquisa por nome. */
function PlacePicker({ at, onAt, onPick, onBack }: { at: LatLng | null; onAt: (p: LatLng | null) => void; onPick: (p: PaidPlace) => void; onBack: () => void }) {
  const [q, setQ] = useState('');
  const [where, setWhere] = useState<Where>(at ? 'ready' : 'checking');
  const term = q.trim();

  async function locate(ask: boolean) {
    setWhere('locating');
    const p = await devicePosition(ask);
    onAt(p);
    setWhere(p ? 'ready' : ask ? 'blocked' : 'none');
  }
  useEffect(() => {
    if (at) return;
    let live = true;
    void locationPermission().then((perm) => {
      if (!live) return;
      if (perm === 'granted') void locate(false);
      else setWhere(perm === 'blocked' ? 'blocked' : 'ask');
    });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Perto: o servidor só recebe a posição arredondada (~1 km), como no «À tua volta»; a distância faz-se aqui.
  const coarse = at ? { lat: round2(at.lat), lng: round2(at.lng) } : null;
  const near = useQuery({ queryKey: ['gelada-venues-near', coarse?.lat, coarse?.lng], queryFn: () => locaisApi.discover(coarse), enabled: !!coarse && term.length < 2, staleTime: 5 * 60_000, retry: false });
  const found = useQuery({ queryKey: ['gelada-venues-search', term], queryFn: () => locaisApi.searchVenues(term), enabled: term.length >= 2, staleTime: 30_000, retry: false });
  const searching = term.length >= 2;
  const rows = venuesByDistance<Venue>(searching ? found.data ?? [] : near.data?.nearby ?? [], at);
  const loading = searching ? found.isLoading : near.isLoading && !!coarse;

  return (
    <Sheet title="Onde foi a gelada?" onClose={onBack} full>
      <View style={{ flex: 1, paddingHorizontal: 16, gap: 10 }}>
        <View style={st.search}>
          <Icon name="search" size={18} color={colors.zinc500} />
          <TextInput value={q} onChangeText={setQ} placeholder="Procurar um local pelo nome" placeholderTextColor={colors.zinc500} style={st.searchInput} accessibilityLabel="Procurar um local pelo nome" autoCorrect={false} />
          {q ? (
            <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Limpar a pesquisa">
              <Icon name="x" size={16} color={colors.zinc500} />
            </Pressable>
          ) : null}
        </View>
        <Text style={st.fine}>Não é um check-in: é só a etiqueta na gelada, que só vocês os dois veem (e quem vir o momento, se o publicarem).</Text>
        {!searching && where === 'ask' && (
          <Pressable onPress={() => void locate(true)} style={({ pressed }) => [st.locate, pressed && { opacity: 0.85 }]} accessibilityRole="button">
            <Icon name="locate" size={20} color={colors.brand} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.placeName}>Ver os locais perto de ti</Text>
              <Text style={st.sub}>A tua posição só serve para mostrar os locais e ver se estás lá. Não fica guardada.</Text>
            </View>
          </Pressable>
        )}
        {!searching && (where === 'checking' || where === 'locating') && <Text style={st.status}>A ver onde estás…</Text>}
        {!searching && where === 'blocked' && <Text style={st.status}>Sem acesso à localização: procura o local pelo nome.</Text>}
        {!searching && where === 'none' && <Text style={st.status}>Não consegui ver onde estás. Procura o local pelo nome.</Text>}
        {!searching && where === 'ready' && <Text style={st.section}>Perto de ti</Text>}
        {loading && <ActivityIndicator color={colors.brand} style={{ paddingVertical: 16 }} />}
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          {rows.map((v) => (
            <Pressable
              key={v.slug}
              onPress={() => onPick({ slug: v.slug, name: v.name, kind: v.kind, near: v.near })}
              style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.zinc100 }]}
              accessibilityRole="button"
              accessibilityLabel={`${v.name}${v.meters != null ? `, ${distanceLabel(v.meters)}` : ''}${v.near ? ', estás aqui' : ''}`}
            >
              {v.avatarUrl ? <Image source={{ uri: sized(abs(v.avatarUrl) ?? v.avatarUrl, 120) }} style={st.avatar} /> : <View style={[st.avatar, st.avatarIcon]}><Icon name="store" size={20} color={colors.zinc600} /></View>}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.placeName} numberOfLines={1}>{v.name}</Text>
                <Text style={st.sub} numberOfLines={1}>{[v.meters != null ? distanceLabel(v.meters) : null, v.city].filter(Boolean).join(' · ') || `@${v.slug}`}</Text>
              </View>
              {v.near ? <View style={st.hereBadge}><Text style={st.hereText}>Estás aqui</Text></View> : null}
            </Pressable>
          ))}
          {!loading && rows.length === 0 && (searching || where === 'ready') ? (
            <Text style={st.status}>{searching ? 'Nenhum local com esse nome.' : 'Nenhum local no mapa perto de ti. Procura pelo nome.'}</Text>
          ) : null}
          {!searching && term.length === 1 ? <Text style={st.status}>Escreve pelo menos duas letras.</Text> : null}
        </ScrollView>
      </View>
    </Sheet>
  );
}

function Btn({ icon, label, onPress, primary = false }: { icon: IconName; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.btn, primary && st.btnPrimary, pressed && { opacity: 0.8 }]} accessibilityRole="button">
      <Icon name={icon} size={18} color={primary ? '#fff' : colors.zinc800} />
      <Text style={[st.btnText, primary && { color: '#fff' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 20, gap: 10 },
  text: { fontSize: 15, lineHeight: 22, color: colors.zinc700 },
  placeOff: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200, borderStyle: 'dashed', paddingHorizontal: 14, paddingVertical: 10 },
  placeOn: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: '#fde68a', backgroundColor: '#fffbeb', paddingHorizontal: 14, paddingVertical: 10 },
  placeName: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  optional: { fontSize: 13, fontWeight: '400', color: colors.zinc500 },
  sub: { marginTop: 2, fontSize: 12, lineHeight: 16, color: colors.zinc500 },
  there: { marginTop: 2, fontSize: 12, fontWeight: '700', color: GREEN },
  link: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontSize: 14, fontWeight: '700', color: colors.brand },
  btn: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 14 },
  btnPrimary: { backgroundColor: colors.brand },
  btnText: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: colors.zinc800 },
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, paddingVertical: 0, outlineStyle: 'none' } as never,
  fine: { fontSize: 12, lineHeight: 17, color: colors.zinc500 },
  locate: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: '#fff1f2', padding: 14 },
  section: { marginTop: 4, fontSize: 13, fontWeight: '800', color: colors.zinc600, textTransform: 'uppercase', letterSpacing: 0.4 },
  status: { paddingVertical: 16, textAlign: 'center', fontSize: 14, color: colors.zinc600 },
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingHorizontal: 4, paddingVertical: 8 },
  avatar: { width: 44, height: 44, borderRadius: 12 },
  avatarIcon: { backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  hereBadge: { borderRadius: 999, backgroundColor: '#dcfce7', paddingHorizontal: 10, paddingVertical: 4 },
  hereText: { fontSize: 12, fontWeight: '700', color: GREEN },
});
