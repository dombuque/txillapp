import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { KIND_LABEL, KINDS, locaisApi } from '@/lib/api.locais';
import { colors } from '@/lib/theme';

/** Os meus locais (bares, restaurantes, discotecas…) e criar um novo. */
export default function Locais() {
  const router = useRouter();
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ['venues-mine'], queryFn: locaisApi.myVenues, retry: false });
  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('bar');
  const [city, setCity] = useState('');
  const [about, setAbout] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const off = busy || name.trim().length < 2;

  async function create() {
    if (off) return;
    setBusy(true);
    setErr('');
    try {
      const v = await locaisApi.createVenue({ name: name.trim(), kind, city: city.trim() || undefined, about: about.trim() || undefined });
      await qc.invalidateQueries({ queryKey: ['venues-mine'] });
      setBusy(false);
      router.push({ pathname: '/v/[slug]', params: { slug: v.slug } });
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  const list = mine.data ?? [];
  return (
    <StackPage title="Os meus locais">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.zinc600 }}>Tens um bar, restaurante, discoteca ou café? Cria a página do local, imprime o QR e a malta faz check-in. A equipa verifica e dá o selo.</Text>

          {list.length > 0 && (
            <View style={{ marginTop: 16, gap: 8 }}>
              {list.map((v) => (
                <Pressable key={v.slug} onPress={() => router.push({ pathname: '/v/[slug]', params: { slug: v.slug } })} style={st.row} accessibilityRole="link">
                  <View style={st.pin}><Icon name="map-pin" size={20} color="#fff" /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: colors.zinc900 }} numberOfLines={1}>{v.name}</Text>
                    <Text style={{ fontSize: 14, lineHeight: 20, color: colors.zinc600 }}>{KIND_LABEL[v.kind] ?? 'Outro'} · {v.verified ? 'Verificado' : 'Em análise'} · {v.checkins} check-ins</Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={colors.zinc300} />
                </Pressable>
              ))}
            </View>
          )}

          <View style={{ marginTop: 24, gap: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.zinc900 }}>Criar um local</Text>
            <TextInput value={name} onChangeText={setName} maxLength={80} placeholder="Nome do local" placeholderTextColor={colors.zinc500} accessibilityLabel="Nome do local" style={st.input} />
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {KINDS.map((k) => (
                <Pressable key={k} onPress={() => setKind(k)} accessibilityRole="radio" accessibilityState={{ selected: kind === k }} style={[st.chip, kind === k && { backgroundColor: colors.zinc900 }]}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: kind === k ? '#fff' : colors.zinc800 }}>{KIND_LABEL[k]}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={city} onChangeText={setCity} maxLength={60} placeholder="Cidade" placeholderTextColor={colors.zinc500} accessibilityLabel="Cidade" style={st.input} />
            <TextInput value={about} onChangeText={setAbout} maxLength={300} multiline numberOfLines={3} placeholder="Uma frase sobre o local (opcional)" placeholderTextColor={colors.zinc500} accessibilityLabel="Sobre o local" style={[st.input, { height: 96, textAlignVertical: 'top' }]} />
            <Text accessibilityRole="alert" style={{ minHeight: 20, textAlign: 'center', fontSize: 14, color: colors.red600 }}>{err}</Text>
            <Pressable onPress={() => void create()} disabled={off} style={[st.cta, off && { opacity: 0.5 }]} accessibilityRole="button">
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>{busy ? 'A criar…' : 'Criar o local'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: '#fafafa', padding: 14 },
  pin: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.zinc900, alignItems: 'center', justifyContent: 'center' },
  input: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.zinc900 },
  chip: { height: 40, borderRadius: 999, paddingHorizontal: 16, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  cta: { height: 48, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
