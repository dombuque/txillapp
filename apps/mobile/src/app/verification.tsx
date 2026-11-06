import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { api, uploadMedia, type DocType } from '@/lib/api';
import { colors } from '@/lib/theme';

type Pic = { uri: string; mime: string } | null;

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: 'id_card', label: 'BI ou cartão de eleitor' },
  { value: 'passport', label: 'Passaporte' },
  { value: 'driver_licence', label: 'Carta de condução' },
  { value: 'residence', label: 'DIRE (residente)' },
  { value: 'other', label: 'Outro documento oficial com foto' },
];

/** Uma foto a enviar. Com `live`, só se aceita uma foto tirada na hora com a câmara da frente; senão também se escolhe da galeria. */
function PhotoSlot({ label, hint, pic, onPick, live }: { label: string; hint: string; pic: Pic; onPick: (p: Pic) => void; live?: boolean }) {
  const [err, setErr] = useState('');
  async function pick() {
    setErr('');
    try {
      let r: ImagePicker.ImagePickerResult;
      if (live) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return setErr('Dá acesso à câmara nas definições do telemóvel');
        r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, cameraType: ImagePicker.CameraType.front });
      } else {
        r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      }
      const a = r.canceled ? null : r.assets[0];
      if (a) onPick({ uri: a.uri, mime: a.mimeType ?? 'image/jpeg' });
    } catch {
      setErr('Não consegui abrir a câmara');
    }
  }
  return (
    <View>
      <Text style={st.label}>{label}</Text>
      <Pressable onPress={() => void pick()} style={st.slot} accessibilityRole="button" accessibilityLabel={label}>
        {pic ? <Image source={{ uri: pic.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : (
          <View style={{ alignItems: 'center', gap: 4, paddingHorizontal: 16 }}>
            <Icon name="camera" size={28} color={colors.zinc500} />
            <Text style={{ fontSize: 14, textAlign: 'center', color: colors.zinc500 }}>{hint}</Text>
          </View>
        )}
      </Pressable>
      {pic && live ? <Pressable onPress={() => void pick()}><Text style={{ marginTop: 6, fontSize: 14, fontWeight: '600', color: colors.brand }}>Tirar outra vez</Text></Pressable> : null}
      {err ? <Text style={{ marginTop: 4, fontSize: 13, color: colors.red600 }}>{err}</Text> : null}
    </View>
  );
}

/** Pedir o selo de verificado: requisitos automáticos primeiro, depois nome, prova, documento e selfie para revisão manual. */
export default function Verification() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['verification'], queryFn: api.verificationStatus });
  const [kind, setKind] = useState<'person' | 'business'>('person');
  const [fullName, setFullName] = useState('');
  const [proof, setProof] = useState('');
  const [docType, setDocType] = useState<DocType>('id_card');
  const [doc, setDoc] = useState<Pic>(null);
  const [docBack, setDocBack] = useState<Pic>(null);
  const [face, setFace] = useState<Pic>(null);
  const [selfie, setSelfie] = useState<Pic>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const s = q.data;

  async function submit() {
    if (!doc || !face || !selfie || (twoSides && !docBack)) return setErr('Faltam fotos: documento, cara e selfie com o documento');
    setBusy(true);
    setErr('');
    try {
      const docMediaId = await uploadMedia(doc.uri, doc.mime, 'chat');
      const docBackMediaId = twoSides && docBack ? await uploadMedia(docBack.uri, docBack.mime, 'chat') : undefined;
      const faceMediaId = await uploadMedia(face.uri, face.mime, 'chat');
      const selfieMediaId = await uploadMedia(selfie.uri, selfie.mime, 'chat');
      await api.verificationRequest({ kind, fullName: fullName.trim(), proof: proof.trim(), docType, docMediaId, docBackMediaId, faceMediaId, selfieMediaId });
      await qc.invalidateQueries({ queryKey: ['verification'] });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  async function withdraw() {
    setBusy(true);
    try {
      await api.verificationWithdraw();
      await qc.invalidateQueries({ queryKey: ['verification'] });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  const twoSides = docType !== 'passport';
  const ready = !busy && !!fullName.trim() && proof.trim().length >= 30 && !!doc && (!twoSides || !!docBack) && !!face && !!selfie;

  return (
    <StackPage title="Verificação">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}>
        {q.isLoading && <ActivityIndicator style={{ marginTop: 32 }} color={colors.brand} />}
        {s?.verified && (
          <View style={st.done}>
            <VerifiedBadge size={56} tier={s.tier} />
            <Text style={{ marginTop: 12, fontSize: 20, fontWeight: '800', color: colors.zinc900, textAlign: 'center' }}>{s.tier === 'official' ? 'Conta oficial do Txillapp' : 'A tua conta está verificada'}</Text>
            <Text style={{ marginTop: 4, fontSize: 14, color: colors.zinc600, textAlign: 'center' }}>O selo aparece junto ao teu nome em todo o Txillapp.</Text>
          </View>
        )}
        {s && !s.verified && (
          <>
            <Text style={{ fontSize: 15, lineHeight: 22, color: colors.zinc700 }}>O selo mostra que uma conta é de quem diz ser. Passa por duas fases: primeiro a conta tem de cumprir os requisitos, depois a moderação revê o teu documento, a tua cara e a justificação.</Text>
            <View style={st.list}>
              {s.items.map((i, n) => (
                <View key={i.key} style={[st.item, n > 0 && { borderTopWidth: 1, borderTopColor: colors.zinc100 }]}>
                  <View style={[st.dot, { backgroundColor: i.ok ? '#10b981' : colors.zinc200 }]}><Icon name={i.ok ? 'check' : 'clock'} size={14} color={i.ok ? '#fff' : colors.zinc500} strokeWidth={3} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }}>{i.label}</Text>
                    {!i.ok && <Text style={{ fontSize: 14, color: colors.zinc500 }}>{i.hint}</Text>}
                  </View>
                </View>
              ))}
            </View>

            {s.request?.status === 'pending' && (
              <View style={[st.box, { backgroundColor: '#fffbeb' }]}>
                <Text style={{ fontWeight: '700', fontSize: 16, color: colors.zinc900 }}>Pedido em análise</Text>
                <Text style={{ marginTop: 4, fontSize: 14, color: colors.zinc700 }}>Vamos rever o teu pedido e avisamos-te quando houver decisão.</Text>
                <Pressable onPress={() => void withdraw()} disabled={busy} style={st.ghost} accessibilityRole="button"><Text style={st.ghostText}>Retirar pedido</Text></Pressable>
              </View>
            )}
            {s.request?.status === 'rejected' && (
              <View style={[st.box, { backgroundColor: '#fef2f2' }]}>
                <Text style={{ fontWeight: '700', fontSize: 16, color: colors.zinc900 }}>O último pedido foi recusado</Text>
                {s.request.reason ? <Text style={{ marginTop: 4, fontSize: 14, color: colors.zinc700 }}>Motivo: {s.request.reason}</Text> : null}
                {s.retryAfter ? <Text style={{ marginTop: 4, fontSize: 14, color: colors.zinc600 }}>Podes pedir outra vez a partir de {new Date(s.retryAfter).toLocaleDateString('pt-PT')}.</Text> : null}
              </View>
            )}

            {s.eligible && s.request?.status !== 'pending' && !s.retryAfter && (
              <View style={{ marginTop: 24, gap: 16 }}>
                <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
                  {([['person', 'Pessoa'], ['business', 'Negócio ou marca']] as const).map(([v, label]) => (
                    <Pressable key={v} onPress={() => setKind(v)} style={[st.kind, kind === v && { borderColor: colors.brand, backgroundColor: colors.rose50 }]} accessibilityRole="radio" accessibilityState={{ checked: kind === v }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: kind === v ? colors.brand : colors.zinc800 }}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                <View>
                  <Text style={st.label}>{kind === 'person' ? 'Nome completo (como no documento)' : 'Nome do negócio ou do responsável'}</Text>
                  <TextInput value={fullName} onChangeText={setFullName} maxLength={80} style={st.input} accessibilityLabel="Nome" />
                </View>
                <View>
                  <Text style={st.label}>Justifica o pedido ({proof.trim().length}/600)</Text>
                  <TextInput value={proof} onChangeText={setProof} maxLength={600} multiline placeholder="Quem és, o que fazes, porque precisas do selo e onde te podemos confirmar (página oficial, notícias, redes). Mínimo 30 caracteres." placeholderTextColor={colors.zinc500} style={[st.input, { minHeight: 110, textAlignVertical: 'top' }]} accessibilityLabel="Justificação" />
                </View>
                <View>
                  <Text style={st.label}>Documento de identificação</Text>
                  <Text style={{ marginBottom: 8, fontSize: 14, color: colors.zinc500 }}>Não tem de ser o BI: serve qualquer documento oficial com a tua foto.</Text>
                  <View style={{ gap: 8 }}>
                    {DOC_TYPES.map((d) => (
                      <Pressable key={d.value} onPress={() => setDocType(d.value)} style={[st.kind, { flex: 0, height: 46, alignItems: 'flex-start', paddingHorizontal: 16 }, docType === d.value && { borderColor: colors.brand, backgroundColor: colors.rose50 }]} accessibilityRole="radio" accessibilityState={{ checked: docType === d.value }}>
                        <Text style={{ fontSize: 15, fontWeight: '600', color: docType === d.value ? colors.brand : colors.zinc800 }}>{d.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <PhotoSlot label={twoSides ? 'Documento: frente' : 'Passaporte: página da foto'} hint="Toca para escolher ou tirar a foto. Os dados têm de estar legíveis." pic={doc} onPick={setDoc} />
                {twoSides && <PhotoSlot label="Documento: verso" hint="Toca para escolher ou tirar a foto do verso." pic={docBack} onPick={setDocBack} />}
                <PhotoSlot live label="Leitura da cara" hint="Abre a câmara: olha de frente, com boa luz, sem óculos escuros nem boné." pic={face} onPick={setFace} />
                <PhotoSlot live label="Selfie ao lado do documento" hint="Abre a câmara: segura o documento ao lado da cara, com os dados e a foto visíveis." pic={selfie} onPick={setSelfie} />
                {err ? <Text style={{ textAlign: 'center', fontSize: 14, color: colors.red600 }} accessibilityRole="alert">{err}</Text> : null}
                <Pressable onPress={() => void submit()} disabled={!ready} style={[st.primary, !ready && { opacity: 0.5 }]} accessibilityRole="button">
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryText}>Enviar pedido</Text>}
                </Pressable>
                <Text style={{ textAlign: 'center', fontSize: 12, color: colors.zinc500 }}>Só a moderação vê as fotos, e são apagadas quando decidirmos.</Text>
              </View>
            )}
            {!s.eligible && <Text style={{ marginTop: 16, textAlign: 'center', fontSize: 14, color: colors.zinc500 }}>Quando cumprires todos os pontos, o pedido abre aqui.</Text>}
          </>
        )}
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  done: { borderRadius: 24, backgroundColor: '#f0f9ff', padding: 24, alignItems: 'center' },
  list: { marginTop: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  dot: { marginTop: 2, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  box: { marginTop: 20, borderRadius: 16, padding: 16 },
  ghost: { marginTop: 12, alignSelf: 'flex-start', borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 18, paddingVertical: 10 },
  ghostText: { fontSize: 14, fontWeight: '600', color: colors.zinc800 },
  kind: { flex: 1, height: 48, borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, alignItems: 'center', justifyContent: 'center' },
  label: { marginBottom: 6, fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  input: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  slot: { height: 144, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.zinc300, backgroundColor: '#fafafa', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  primary: { height: 54, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
