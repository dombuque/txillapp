import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Check, Chips, Field, Primary, ast } from '@/components/ArtistUi';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { uploadMedia } from '@/lib/api';
import { artistsApi } from '@/lib/api.artists';
import { PREVIEW, mmss, parseMmss, previewProblem } from '@/lib/artists';
import { canPickAudio, pickAudio, type PickedAudio } from '@/lib/pickAudio';
import { colors } from '@/lib/theme';

const MAX_MB = 20;

/**
 * Carregar uma música (só artistas aprovados): o ficheiro (MP3, M4A ou AAC, até 20 MB e 15 min), o título, a capa, os estilos,
 * o trecho a usar (onde começa o refrão e quanto dura, 15 a 60 s), se é explícita e a aceitação da Licença de uso de música
 * no Txillapp. O servidor confirma a duração e corta o trecho; a faixa fica à espera da equipa.
 */
export default function CarregarMusica() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['artist-me'], queryFn: artistsApi.me });
  const [audio, setAudio] = useState<PickedAudio | null>(null);
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState<{ uri: string; mime: string } | null>(null);
  const [styles, setStyles] = useState<string[]>([]);
  const [start, setStart] = useState('0:30');
  const [len, setLen] = useState<number>(30_000);
  const [explicit, setExplicit] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const approved = me.data?.artist?.status === 'approved';
  const startMs = parseMmss(start);
  const problem = previewProblem(startMs, len, audio?.durationMs);
  const tooBig = !!audio && audio.size > MAX_MB * 1024 * 1024;
  const ready = !!audio && !tooBig && title.trim().length > 0 && styles.length > 0 && !problem && accepted && !busy;

  async function chooseAudio() {
    setErr('');
    const a = await pickAudio();
    if (!a) return;
    if (!['audio/mpeg', 'audio/mp4', 'audio/aac'].includes(a.mime)) return setErr('Escolhe um ficheiro MP3, M4A ou AAC');
    setAudio(a);
    if (!title.trim()) setTitle(a.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 100));
  }
  async function chooseCover() {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, allowsEditing: true, aspect: [1, 1] });
      const p = r.canceled ? null : r.assets[0];
      if (p) setCover({ uri: p.uri, mime: p.mimeType ?? 'image/jpeg' });
    } catch {
      setErr('Não consegui abrir a galeria');
    }
  }
  async function publish() {
    if (!audio || !me.data || startMs === null) return;
    setErr('');
    try {
      setBusy('A enviar a música…');
      const audioMediaId = await uploadMedia(audio.uri, audio.mime, 'music');
      setBusy(cover ? 'A enviar a capa…' : 'A preparar o trecho…');
      const coverMediaId = cover ? await uploadMedia(cover.uri, cover.mime, 'public') : undefined;
      setBusy('A preparar o trecho…');
      await artistsApi.createTrack({ title: title.trim(), audioMediaId, coverMediaId, styles, previewStartMs: startMs, previewMs: len, explicit, licenseVersion: me.data.license.version, acceptLicense: true });
      void qc.invalidateQueries({ queryKey: ['artist-tracks'] });
      router.replace('/artista/gerir' as never);
    } catch (e) {
      setErr((e as Error).message || 'Não consegui carregar a música');
      setBusy(null);
    }
  }

  return (
    <StackPage title="Carregar música">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {me.isLoading ? <ActivityIndicator color={colors.zinc500} style={{ paddingVertical: 40 }} /> : null}
        {me.data && !approved ? (
          <View style={[ast.card, { marginTop: 0 }]}>
            <Text style={ast.cardTitle}>Só para artistas aprovados</Text>
            <Text style={ast.cardSub}>Pede primeiro em «Sou artista». Quando a equipa aprovar, voltas aqui.</Text>
            <Primary title="Ir a Sou artista" onPress={() => router.replace('/artista' as never)} />
          </View>
        ) : null}
        {me.data && approved ? (
          <>
            <Field label="A música" hint={`MP3, M4A ou AAC, até ${MAX_MB} MB e 15 minutos. O ficheiro inteiro nunca é mostrado: no Txillapp só se ouve o trecho que escolheres.`}>
              {canPickAudio ? (
                <Pressable onPress={() => void chooseAudio()} style={[ast.card, { marginTop: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }]} accessibilityRole="button">
                  <Icon name="music" size={22} color={colors.brand} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} numberOfLines={1}>{audio ? audio.name : 'Escolher o ficheiro'}</Text>
                    {audio ? <Text style={ast.hint}>{(audio.size / 1024 / 1024).toFixed(1)} MB{audio.durationMs ? ` · ${mmss(audio.durationMs)}` : ''}</Text> : null}
                  </View>
                </Pressable>
              ) : (
                <View style={[ast.card, { marginTop: 0 }]}>
                  <Text style={ast.cardSub}>Nesta versão da app ainda não dá para escolher ficheiros de música. Carrega no site, com a mesma conta:</Text>
                  <Text style={[ast.cardSub, { color: colors.brand, fontWeight: '600' }]} onPress={() => void Linking.openURL('https://txillapp.com/artista/carregar')}>txillapp.com/artista/carregar</Text>
                </View>
              )}
              {tooBig ? <Text style={ast.err}>O ficheiro tem mais de {MAX_MB} MB.</Text> : null}
            </Field>
            <Field label="Título">
              <TextInput value={title} onChangeText={setTitle} maxLength={100} placeholder="Nome da música" placeholderTextColor={colors.zinc500} style={ast.input} accessibilityLabel="Título" />
            </Field>
            <Field label="Capa (opcional)">
              <Pressable onPress={() => void chooseCover()} style={[ast.license, { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', padding: 0, overflow: 'hidden' }]} accessibilityRole="button" accessibilityLabel="Escolher a capa">
                {cover ? <Image source={{ uri: cover.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Icon name="image" size={26} color={colors.zinc500} />}
              </Pressable>
            </Field>
            <Field label="Estilos (até 5)">
              <Chips options={me.data.styles} value={styles} onChange={setStyles} />
            </Field>
            <Field label="O trecho" hint="Escolhe o início do refrão (minutos:segundos) e quanto dura. É isto que a malta ouve nos mimos e nas tchekas.">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 15, color: colors.zinc700 }}>Começa em</Text>
                <TextInput value={start} onChangeText={setStart} keyboardType="numbers-and-punctuation" maxLength={5} style={[ast.input, { width: 90, textAlign: 'center' }]} accessibilityLabel="Início do trecho" />
              </View>
              <View style={[ast.chips, { marginTop: 10 }]}>
                {PREVIEW.choices.map((ms) => (
                  <Pressable key={ms} onPress={() => setLen(ms)} style={[ast.chip, len === ms && ast.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: len === ms }}>
                    <Text style={[ast.chipTxt, len === ms && { color: '#fff' }]}>{ms / 1000} s</Text>
                  </Pressable>
                ))}
              </View>
              {startMs !== null && !problem ? <Text style={ast.hint}>De {mmss(startMs)} a {mmss(startMs + len)}.</Text> : null}
              {problem ? <Text style={ast.err}>{problem}</Text> : null}
            </Field>
            <Check on={explicit} onChange={setExplicit}>Tem linguagem explícita (não aparece a menores de 18 anos).</Check>

            <Field label={me.data.license.title} hint={`Versão ${me.data.license.version}. Fica guardado que aceitaste, quando e que versão do texto.`}>
              <ScrollView style={ast.license} nestedScrollEnabled>
                <Text style={ast.licenseTxt}>{me.data.license.text}</Text>
              </ScrollView>
            </Field>
            <Check on={accepted} onChange={setAccepted}>
              Li e aceito a {me.data.license.title}: uma autorização não exclusiva, gratuita e revogável para novos usos, para a malta usar o trecho em mimos e tchekas no Txillapp.
            </Check>
            {err ? <Text style={ast.err}>{err}</Text> : null}
            <Primary title={busy ?? 'Publicar para revisão'} disabled={!ready} onPress={() => void publish()} />
            <Text style={[ast.hint, { textAlign: 'center' }]}>A equipa do Txillapp revê cada música antes de aparecer nos «Artistas de Moçambique».</Text>
          </>
        ) : null}
      </ScrollView>
    </StackPage>
  );
}
