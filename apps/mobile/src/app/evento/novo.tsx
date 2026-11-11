import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { PlaceMiniMap } from '@/components/nearby/PlaceMiniMap';
import { PlaceField } from '@/components/PlaceField';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { ApiError, uploadMedia } from '@/lib/api';
import { locaisApi } from '@/lib/api.locais';
import { nearbyApi } from '@/lib/api.nearby';
import { formatAddress, showsOnMap, venuePlace, venuePlaceBody, type PlaceValue } from '@/lib/placeField';
import { colors } from '@/lib/theme';

const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DAYS = 45;
/** "21:30" → [21, 30]; aceita "2130" e "21h30". */
function parseTime(s: string): [number, number] | null {
  const m = s.trim().replace(/h/i, ':').match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  return h <= 23 && mi <= 59 ? [h, mi] : null;
}

/** Criar um evento num local (só para quem gere a página): título, dia e hora, descrição e capa opcional. */
export default function NovoEvento() {
  const { venue: slug } = useLocalSearchParams<{ venue?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const venue = useQuery({ queryKey: ['venue', slug], queryFn: () => locaisApi.venue(slug!), enabled: !!slug, staleTime: 60_000 });
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [day, setDay] = useState(0);
  const [start, setStart] = useState('21:00');
  const [end, setEnd] = useState('');
  const [cover, setCover] = useState<{ uri: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // O evento é sempre num local: se o local ainda não tem ponto no mapa (e eu posso editá-lo), marca-se aqui e grava-se no local.
  const [place, setPlace] = useState<PlaceValue | null>(null);
  const venueAt = venuePlace(venue.data);

  const days = useMemo(() => {
    const t = new Date();
    return Array.from({ length: DAYS }, (_, i) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + i));
  }, []);

  const pickCover = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 9], quality: 0.9 });
      const a = r.canceled ? null : r.assets[0];
      if (a) setCover({ uri: a.uri, mime: a.mimeType ?? 'image/jpeg' });
    } catch {
      setErr('Não consegui abrir as fotos.');
    }
  };

  const submit = async () => {
    setErr(null);
    if (!slug) return setErr('Falta o local.');
    if (title.trim().length < 3) return setErr('Dá um nome ao evento (pelo menos 3 letras).');
    const s = parseTime(start);
    if (!s) return setErr('A hora de início não está certa. Escreve assim: 21:30.');
    const e = end.trim() ? parseTime(end) : null;
    if (end.trim() && !e) return setErr('A hora do fim não está certa. Escreve assim: 02:00.');
    const d = days[day];
    const startsAt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), s[0], s[1]);
    if (startsAt.getTime() < Date.now() - 5 * 60_000) return setErr('Essa hora já passou. Escolhe outra.');
    let endsAt: Date | undefined;
    if (e) {
      endsAt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), e[0], e[1]);
      // Acaba "às 02:00": é no dia seguinte.
      if (endsAt.getTime() <= startsAt.getTime()) endsAt = new Date(endsAt.getTime() + 86_400_000);
    }
    setBusy(true);
    try {
      if (place && !venueAt && venue.data?.canEdit) {
        const nv = await locaisApi.updateVenue(slug, venuePlaceBody(place, showsOnMap(venue.data)));
        qc.setQueryData(['venue', slug], nv);
        void qc.invalidateQueries({ queryKey: ['venues-mine'] });
      }
      const coverMediaId = cover ? await uploadMedia(cover.uri, cover.mime, 'public') : undefined;
      const r = await nearbyApi.createEvent({
        venueSlug: slug,
        title: title.trim(),
        description: desc.trim() || undefined,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt?.toISOString(),
        coverMediaId,
      });
      void qc.invalidateQueries({ queryKey: ['venue-events', slug] });
      void qc.invalidateQueries({ queryKey: ['nearby'] });
      router.replace(`/evento/${r.id}` as never);
    } catch (x) {
      setErr(x instanceof ApiError && x.message ? x.message : 'Não consegui criar o evento. Tenta outra vez.');
    } finally {
      setBusy(false);
    }
  };

  if (slug && venue.isLoading) return <StackPage title="Criar evento"><View style={st.center}><ActivityIndicator /></View></StackPage>;
  if (!slug || (venue.data && !venue.data.canPost && !venue.data.mine)) {
    return (
      <StackPage title="Criar evento">
        <View style={st.center}>
          <Icon name="lock" size={34} color={colors.zinc300} />
          <Text style={st.emptyTitle}>Só quem gere o local pode criar eventos</Text>
          <Text style={st.hint}>Abre a página do teu local e cria o evento a partir de lá.</Text>
        </View>
      </StackPage>
    );
  }

  return (
    <StackPage title="Criar evento">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48, maxWidth: 640, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          {venue.data ? <Text style={st.hint}>Em {venue.data.name}</Text> : null}

          {venue.data && venueAt ? (
            <View style={{ gap: 6 }}>
              <Text style={st.label}>Onde</Text>
              <PlaceMiniMap lat={venueAt.lat} lng={venueAt.lng} label={`Mapa com o pino em ${venue.data.name}`} />
              <Text style={[st.hint, { textAlign: 'left' }]}>{venue.data.name}{formatAddress(venueAt) ? ` · ${formatAddress(venueAt)}` : ''}</Text>
            </View>
          ) : venue.data?.canEdit ? (
            <View style={{ gap: 6 }}>
              <PlaceField label="Onde é?" value={place} onChange={setPlace} initialQuery={venue.data.address ? formatAddress(venue.data) : ''} placeholder="Procurar o sítio do local…" mapHint="Arrasta o mapa até o alfinete ficar na porta do local." />
              <Text style={[st.hint, { textAlign: 'left' }]}>{place ? 'Este sítio fica guardado no local ao criar o evento.' : `${venue.data.name} ainda não está no mapa. Marca onde fica para o evento aparecer no À tua volta.`}</Text>
            </View>
          ) : venue.data ? (
            <Text style={[st.hint, { textAlign: 'left' }]}>{venue.data.name} ainda não está no mapa: o evento só aparece no À tua volta quando o dono marcar onde fica, em Gerir.</Text>
          ) : null}

          <Pressable onPress={() => void pickCover()} style={st.cover} accessibilityRole="button" accessibilityLabel={cover ? 'Trocar a capa' : 'Pôr uma capa'}>
            {cover ? (
              <Image source={{ uri: cover.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <>
                <Icon name="image" size={30} color={colors.zinc500} />
                <Text style={st.hint}>Capa (opcional)</Text>
              </>
            )}
          </Pressable>
          {cover ? (
            <Pressable onPress={() => setCover(null)} style={{ alignSelf: 'flex-start' }} hitSlop={8}><Text style={st.link}>Tirar a capa</Text></Pressable>
          ) : null}

          <View style={{ gap: 6 }}>
            <Text style={st.label}>Nome do evento</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="Ex.: Noite de marrabenta" placeholderTextColor={colors.zinc500} style={st.input} maxLength={80} />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={st.label}>Dia</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {days.map((d, i) => {
                const on = i === day;
                return (
                  <Pressable key={i} onPress={() => setDay(i)} style={[st.day, on && st.dayOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <Text style={[st.dayTop, on && { color: colors.white }]}>{i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : WD[d.getDay()]}</Text>
                    <Text style={[st.dayNum, on && { color: colors.white }]}>{d.getDate()}</Text>
                    <Text style={[st.dayTop, on && { color: colors.white }]}>{MO[d.getMonth()]}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={st.label}>Começa às</Text>
              <TextInput value={start} onChangeText={setStart} placeholder="21:00" placeholderTextColor={colors.zinc500} style={st.input} keyboardType="numbers-and-punctuation" maxLength={5} />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={st.label}>Acaba às (opcional)</Text>
              <TextInput value={end} onChangeText={setEnd} placeholder="02:00" placeholderTextColor={colors.zinc500} style={st.input} keyboardType="numbers-and-punctuation" maxLength={5} />
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={st.label}>Descrição (opcional)</Text>
            <TextInput value={desc} onChangeText={setDesc} placeholder="Quem toca, o que há, entrada…" placeholderTextColor={colors.zinc500} style={[st.input, { height: 110, paddingTop: 12, textAlignVertical: 'top' }]} multiline maxLength={1000} />
          </View>

          {err ? <Text style={st.err}>{err}</Text> : null}

          <Pressable onPress={() => void submit()} disabled={busy} style={[st.primary, busy && { opacity: 0.6 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={st.primaryText}>Criar evento</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  hint: { fontSize: 14, color: colors.zinc500, textAlign: 'center' },
  link: { fontSize: 14, fontWeight: '700', color: colors.brand },
  cover: { width: '100%', aspectRatio: 16 / 9, borderRadius: 18, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden' },
  label: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
  input: { height: 48, borderRadius: 14, backgroundColor: colors.zinc100, paddingHorizontal: 14, fontSize: 16, color: colors.zinc900 },
  day: { width: 64, paddingVertical: 8, borderRadius: 14, backgroundColor: colors.zinc100, alignItems: 'center' },
  dayOn: { backgroundColor: colors.zinc900 },
  dayTop: { fontSize: 12, fontWeight: '600', color: colors.zinc500 },
  dayNum: { fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  err: { fontSize: 14, color: colors.red600 },
  primary: { height: 50, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});
