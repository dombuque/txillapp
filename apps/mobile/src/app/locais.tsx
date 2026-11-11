import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { PlaceField } from '@/components/PlaceField';
import { StackPage } from '@/components/StackPage';
import { VenueRow } from '@/components/VenueCard';
import { KIND_LABEL, KINDS, ROLE_LABEL, locaisApi } from '@/lib/api.locais';
import { createPlaceWarning, venuePlaceBody, type PlaceValue } from '@/lib/placeField';
import { colors } from '@/lib/theme';

/** As minhas páginas de locais (as que criei e as que giro), os convites por aceitar e criar uma página nova. */
export default function Locais() {
  const router = useRouter();
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ['venues-mine'], queryFn: locaisApi.myVenues, retry: false });
  const invites = useQuery({ queryKey: ['venues-invites'], queryFn: locaisApi.myInvites, retry: false });
  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('bar');
  const [place, setPlace] = useState<PlaceValue | null>(null);
  const [typed, setTyped] = useState('');
  const [showOnMap, setShowOnMap] = useState(true);
  const [about, setAbout] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const off = busy || name.trim().length < 2;
  const placeWarning = createPlaceWarning(place, typed, showOnMap);

  async function create() {
    if (off) return;
    setBusy(true);
    setErr('');
    try {
      // Sem sítio escolhido cria na mesma (marca-se depois em Gerir): não manda morada nem coordenadas.
      const v = await locaisApi.createVenue({ name: name.trim(), kind, about: about.trim() || undefined, ...venuePlaceBody(place, showOnMap) });
      await qc.invalidateQueries({ queryKey: ['venues-mine'] });
      setBusy(false);
      router.push({ pathname: '/v/[slug]/gerir', params: { slug: v.slug } });
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }
  async function answer(slug: string, accept: boolean) {
    try {
      await locaisApi.answerInvite(slug, accept);
      await Promise.all([qc.invalidateQueries({ queryKey: ['venues-mine'] }), qc.invalidateQueries({ queryKey: ['venues-invites'] })]);
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  const list = mine.data ?? [];
  const pending = invites.data ?? [];
  return (
    <StackPage title="Os meus locais">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.zinc600 }}>Tens um bar, restaurante, discoteca ou café? Cria a página do local, convida os teus gestores, publica como o local, imprime o QR e a malta faz check-in. A equipa verifica e dá o selo.</Text>

          {pending.length > 0 && (
            <View style={{ marginTop: 16, gap: 8 }}>
              <Text style={st.h}>Convites para gerir</Text>
              {pending.map((v) => (
                <View key={v.slug} style={st.invite}>
                  <VenueRow venue={v} right="none" />
                  <Text style={{ fontSize: 13, color: colors.zinc600 }}>Convidaram-te como {ROLE_LABEL[v.invite ?? 'editor'].toLowerCase()}.</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <Pressable onPress={() => void answer(v.slug, true)} style={[st.cta, { flex: 1, height: 42 }]} accessibilityRole="button"><Text style={st.ctaText}>Aceitar</Text></Pressable>
                    <Pressable onPress={() => void answer(v.slug, false)} style={[st.cta, { flex: 1, height: 42, backgroundColor: colors.zinc100 }]} accessibilityRole="button"><Text style={[st.ctaText, { color: colors.zinc800 }]}>Recusar</Text></Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          {list.length > 0 && (
            <View style={{ marginTop: 16, gap: 4 }}>
              <Text style={st.h}>As minhas páginas</Text>
              {list.map((v) => (
                <View key={v.slug} style={st.row}>
                  <VenueRow venue={v} right="role" />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable onPress={() => router.push({ pathname: '/v/[slug]', params: { slug: v.slug } })} style={st.small} accessibilityRole="link"><Text style={st.smallText}>Ver página</Text></Pressable>
                    <Pressable onPress={() => router.push({ pathname: '/v/[slug]/gerir', params: { slug: v.slug } })} style={[st.small, { backgroundColor: colors.zinc900 }]} accessibilityRole="link"><Icon name="settings" size={16} color="#fff" /><Text style={[st.smallText, { color: '#fff' }]}>Gerir</Text></Pressable>
                    <Pressable onPress={() => router.push({ pathname: '/new', params: { as: v.slug } } as never)} style={st.small} accessibilityRole="link"><Icon name="compose" size={16} color={colors.zinc900} /><Text style={st.smallText}>Publicar</Text></Pressable>
                  </View>
                  <Text style={{ fontSize: 12, color: colors.zinc500 }}>{v.verified ? 'Verificado' : 'Em análise'} · {v.checkins} check-ins · {v.posts} publicações</Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ marginTop: 24, gap: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.zinc900 }}>Criar uma página de local</Text>
            <TextInput value={name} onChangeText={setName} maxLength={80} placeholder="Nome do local" placeholderTextColor={colors.zinc500} accessibilityLabel="Nome do local" style={st.input} />
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {KINDS.map((k) => (
                <Pressable key={k} onPress={() => setKind(k)} accessibilityRole="radio" accessibilityState={{ selected: kind === k }} style={[st.chip, kind === k && { backgroundColor: colors.zinc900 }]}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: kind === k ? '#fff' : colors.zinc800 }}>{KIND_LABEL[k]}</Text>
                </Pressable>
              ))}
            </View>
            <PlaceField label="Onde fica?" value={place} onChange={setPlace} onTyped={setTyped} placeholder="Procurar o sítio… (nome, rua ou bairro)" mapHint="Arrasta o mapa até o alfinete ficar na porta do local." />
            <View style={st.switchRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.zinc900 }}>Mostrar no mapa</Text>
                <Text style={{ fontSize: 13, lineHeight: 18, color: colors.zinc600 }}>O teu local aparece no mapa do À tua volta e em perto de mim. Desligado, continua na pesquisa pelo nome, sem o ponto no mapa. Desliga se não tiver porta aberta ao público.</Text>
              </View>
              <Switch value={showOnMap} onValueChange={setShowOnMap} trackColor={{ true: colors.brand, false: colors.zinc300 }} thumbColor="#fff" {...({ activeThumbColor: '#fff' } as object)} accessibilityLabel="Mostrar no mapa do À tua volta" />
            </View>
            {placeWarning ? (
              <View style={st.warn}>
                <Icon name="info" size={16} color="#b45309" />
                <Text style={st.warnText}>{placeWarning}</Text>
              </View>
            ) : null}
            <TextInput value={about} onChangeText={setAbout} maxLength={1000} multiline numberOfLines={3} placeholder="Uma frase sobre o local (podes completar depois)" placeholderTextColor={colors.zinc500} accessibilityLabel="Sobre o local" style={[st.input, { height: 96, textAlignVertical: 'top' }]} />
            <Text accessibilityRole="alert" style={{ minHeight: 20, textAlign: 'center', fontSize: 14, color: colors.red600 }}>{err}</Text>
            <Pressable onPress={() => void create()} disabled={off} style={[st.cta, off && { opacity: 0.5 }]} accessibilityRole="button">
              <Text style={st.ctaText}>{busy ? 'A criar…' : 'Criar a página'}</Text>
            </Pressable>
            <Text style={{ fontSize: 12, lineHeight: 18, color: colors.zinc500 }}>Depois de criar, completa o perfil (logótipo, capa, horário, contactos) e convida os gestores em Gerir.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  h: { fontSize: 16, fontWeight: '800', color: colors.zinc900, marginBottom: 4 },
  row: { borderRadius: 20, backgroundColor: '#fafafa', paddingHorizontal: 14, paddingVertical: 8, gap: 8, marginBottom: 8 },
  invite: { borderRadius: 20, backgroundColor: colors.rose50, paddingHorizontal: 14, paddingVertical: 8 },
  small: { height: 34, borderRadius: 999, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.zinc100 },
  smallText: { fontSize: 13, fontWeight: '700', color: colors.zinc900 },
  input: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.zinc900 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: '#fafafa', padding: 14 },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, backgroundColor: '#fffbeb', paddingHorizontal: 12, paddingVertical: 10 },
  warnText: { flex: 1, fontSize: 13, lineHeight: 18, color: '#78350f' },
  chip: { height: 40, borderRadius: 999, paddingHorizontal: 16, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  cta: { height: 48, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
