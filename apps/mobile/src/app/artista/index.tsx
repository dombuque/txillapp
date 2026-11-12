import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArtistTag, Check, Chips, Field, Ghost, Primary, ast } from '@/components/ArtistUi';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { uploadMedia } from '@/lib/api';
import { artistsApi, type ArtistMe } from '@/lib/api.artists';
import { RIGHTS_CONTACT, RIGHTS_SUBJECT, artistStatusText, guessLinkKind, linkProblem } from '@/lib/artists';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/**
 * «Sou artista»: o pedido para entrar no programa de artistas moçambicanos (nome artístico, estilos, ligações e quem tem os
 * direitos), o estado do pedido e, depois de aprovado, o caminho para carregar e gerir as músicas.
 */
export default function SouArtista() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['artist-me'], queryFn: artistsApi.me });
  const a = q.data?.artist ?? null;
  const [editing, setEditing] = useState(false);

  const status = artistStatusText(a?.status);
  const showForm = !a || editing || a.status === 'withdrawn';

  function withdraw() {
    Alert.alert('Retirar o pedido?', 'A prova que enviaste é apagada. Podes pedir outra vez quando quiseres.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Retirar', style: 'destructive', onPress: () => void artistsApi.withdrawApplication().then(() => qc.invalidateQueries({ queryKey: ['artist-me'] })).catch((e: Error) => Alert.alert('Não deu', e.message)) },
    ]);
  }

  return (
    <StackPage title="Sou artista">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {q.isLoading ? <ActivityIndicator color={colors.zinc500} style={{ paddingVertical: 40 }} /> : null}
        {q.isError ? <Text style={ast.err}>Não consegui carregar. Tenta outra vez.</Text> : null}
        {q.data ? (
          <>
            <View style={[ast.card, { marginTop: 0, backgroundColor: a?.status === 'approved' ? '#fff7ed' : '#fafafa' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={ast.cardTitle}>{status.title}</Text>
                {a?.status === 'approved' ? <ArtistTag /> : null}
              </View>
              <Text style={ast.cardSub}>{status.sub}</Text>
              {a?.reason && (a.status === 'rejected' || a.status === 'revoked') ? <Text style={[ast.cardSub, { color: colors.red600 }]}>Motivo: {a.reason}</Text> : null}
              {a?.status === 'pending' ? <Ghost title="Retirar o pedido" onPress={withdraw} /> : null}
              {a?.status === 'rejected' && !editing ? <Ghost title="Corrigir e pedir outra vez" onPress={() => setEditing(true)} /> : null}
            </View>

            {a?.status === 'approved' ? (
              <>
                <Primary title="Carregar uma música" onPress={() => router.push('/artista/carregar' as never)} />
                <Ghost title="Gerir as minhas músicas" onPress={() => router.push('/artista/gerir' as never)} />
                {user ? <Ghost title="Ver o meu perfil de artista" onPress={() => router.push(`/u/${user.username}` as never)} /> : null}
              </>
            ) : null}

            {showForm && a?.status !== 'pending' && a?.status !== 'approved' && a?.status !== 'revoked' ? (
              <ApplyForm me={q.data} onDone={() => { setEditing(false); void qc.invalidateQueries({ queryKey: ['artist-me'] }); }} />
            ) : null}

            <View style={[ast.card, { backgroundColor: '#fafafa' }]}>
              <Text style={ast.cardTitle}>Como funciona</Text>
              <Text style={ast.cardSub}>
                1. Pedes aqui, com o teu nome artístico, os estilos, as tuas ligações (redes e streaming) e quem tem os direitos das músicas.{'\n'}
                2. A equipa do Txillapp confirma o pedido. O teu perfil passa a ter a etiqueta «Artista».{'\n'}
                3. Carregas as tuas músicas, escolhes o trecho (o refrão, até 60 s) e aceitas a Licença de uso de música no Txillapp.{'\n'}
                4. Depois de revistas, aparecem nos «Artistas de Moçambique» e a malta usa-as nos mimos e nas tchekas, com «♪ Título · Artista» e a ligação ao teu perfil.
              </Text>
              <Text style={[ast.cardSub, { marginTop: 10 }]}>
                Direitos de autor:{' '}
                <Text style={{ fontWeight: '600', textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(`mailto:${RIGHTS_CONTACT}?subject=${encodeURIComponent(RIGHTS_SUBJECT)}`)}>{RIGHTS_CONTACT}</Text>
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </StackPage>
  );
}

function ApplyForm({ me, onDone }: { me: ArtistMe; onDone: () => void }) {
  const prev = me.artist;
  const [stageName, setStageName] = useState(prev?.stageName ?? '');
  const [styles, setStyles] = useState<string[]>(prev?.styles ?? []);
  const [links, setLinks] = useState((prev?.links ?? []).map((l) => l.url).join('\n'));
  const [rightsKind, setRightsKind] = useState<'self' | 'label'>(prev?.rightsKind ?? 'self');
  const [labelName, setLabelName] = useState(prev?.labelName ?? '');
  const [statement, setStatement] = useState(prev?.rightsStatement ?? '');
  const [proof, setProof] = useState<{ uri: string; mime: string } | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => setErr(''), [stageName, styles, links, rightsKind, labelName, statement]);

  const urls = links.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const badLink = urls.map(linkProblem).find(Boolean) ?? null;
  const ready = stageName.trim().length >= 2 && styles.length > 0 && statement.trim().length >= 20 && (rightsKind === 'self' || labelName.trim().length > 0) && !badLink && urls.length <= 8 && sure;

  async function pickProof() {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      const p = r.canceled ? null : r.assets[0];
      if (p) setProof({ uri: p.uri, mime: p.mimeType ?? 'image/jpeg' });
    } catch {
      setErr('Não consegui abrir a galeria');
    }
  }
  async function send() {
    setBusy(true);
    setErr('');
    try {
      // A prova vai como ficheiro privado (só a equipa a vê, e é apagada depois da decisão).
      const proofMediaId = proof ? await uploadMedia(proof.uri, proof.mime, 'chat') : undefined;
      await artistsApi.apply({
        stageName: stageName.trim(), styles, links: urls.map((url) => ({ kind: guessLinkKind(url), url })), rightsKind,
        labelName: rightsKind === 'label' ? labelName.trim() : undefined, rightsStatement: statement.trim(), proofMediaId,
      });
      onDone();
    } catch (e) {
      setErr((e as Error).message || 'Não consegui enviar o pedido');
    }
    setBusy(false);
  }

  return (
    <View style={{ marginTop: 8 }}>
      <Field label="Nome artístico">
        <TextInput value={stageName} onChangeText={setStageName} maxLength={60} placeholder="Como a malta te conhece" placeholderTextColor={colors.zinc500} style={ast.input} accessibilityLabel="Nome artístico" />
      </Field>
      <Field label="Estilos (até 5)">
        <Chips options={me.styles} value={styles} onChange={setStyles} />
      </Field>
      <Field label="Ligações" hint="Uma por linha: Instagram, TikTok, YouTube, Spotify, Audiomack, Boomplay… Só https://. Ajudam a equipa a confirmar que és tu.">
        <TextInput value={links} onChangeText={setLinks} multiline autoCapitalize="none" autoCorrect={false} placeholder={'https://instagram.com/…\nhttps://open.spotify.com/artist/…'} placeholderTextColor={colors.zinc500} style={[ast.input, { minHeight: 88, textAlignVertical: 'top' }]} accessibilityLabel="Ligações" />
        {badLink ? <Text style={ast.err}>{badLink}</Text> : null}
      </Field>
      <Field label="Quem tem os direitos das músicas?">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['self', 'Eu (artista independente)'], ['label', 'Uma editora']] as const).map(([k, l]) => (
            <Pressable key={k} onPress={() => setRightsKind(k)} style={[ast.chip, { flex: 1, height: 44 }, rightsKind === k && ast.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: rightsKind === k }}>
              <Text style={[ast.chipTxt, rightsKind === k && { color: '#fff' }]}>{l}</Text>
            </Pressable>
          ))}
        </View>
        {rightsKind === 'label' ? (
          <TextInput value={labelName} onChangeText={setLabelName} maxLength={80} placeholder="Nome da editora" placeholderTextColor={colors.zinc500} style={[ast.input, { marginTop: 8 }]} accessibilityLabel="Nome da editora" />
        ) : null}
      </Field>
      <Field label="Declaração" hint="Diz que és o autor e intérprete (ou que a editora te autoriza), e o que mais ajudar: registo na SOMAS, contrato, onde as músicas já estão publicadas.">
        <TextInput
          value={statement}
          onChangeText={setStatement}
          multiline
          maxLength={1000}
          placeholder="Sou o autor, compositor e intérprete das músicas que vou carregar e tenho todos os direitos sobre elas."
          placeholderTextColor={colors.zinc500}
          style={[ast.input, { minHeight: 110, textAlignVertical: 'top' }]}
          accessibilityLabel="Declaração de direitos"
        />
      </Field>
      <Field label="Prova (opcional)" hint="Uma foto do contrato, da carta da editora ou do registo. Só a equipa a vê, e é apagada depois da decisão.">
        <Pressable onPress={() => void pickProof()} style={[ast.license, { height: 120, alignItems: 'center', justifyContent: 'center', padding: 0, overflow: 'hidden' }]} accessibilityRole="button" accessibilityLabel="Escolher a foto da prova">
          {proof ? <Image source={{ uri: proof.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Text style={ast.hint}>Escolher uma foto</Text>}
        </Pressable>
      </Field>
      <Check on={sure} onChange={setSure}>Confirmo que a informação é verdadeira e que posso autorizar o uso destas músicas.</Check>
      {err ? <Text style={ast.err}>{err}</Text> : null}
      <Primary title={busy ? 'A enviar…' : 'Enviar o pedido'} disabled={!ready || busy} onPress={() => void send()} />
    </View>
  );
}
