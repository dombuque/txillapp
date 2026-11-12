import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Ghost, Pill, Primary, ast } from '@/components/ArtistUi';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { artistsApi, type MyTrack } from '@/lib/api.artists';
import { mmss, trackStatusLabel, usesLine } from '@/lib/artists';
import { abs } from '@/lib/config';
import { playTrack, stopTrack } from '@/lib/musicPlayer';
import { colors } from '@/lib/theme';

/**
 * Gerir as minhas músicas (artista): o estado de cada faixa, quantas vezes foi usada e por quantas pessoas (só totais),
 * ouvir o trecho e retirar. Retirar tira a faixa do seletor para novos usos; os mimos e as tchekas antigos continuam.
 */
export default function GerirMusicas() {
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['artist-tracks'], queryFn: artistsApi.tracks, refetchOnMount: 'always' });
  const me = useRef(Symbol('gerir'));
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => stopTrack(me.current), []);

  async function listen(t: MyTrack) {
    if (playing === t.id) return stopTrack(me.current);
    if (!t.previewUrl) return;
    setPlaying(t.id);
    const ok = await playTrack(me.current, t.previewUrl, { loop: false, onStop: () => setPlaying(null) });
    if (!ok) setPlaying(null);
  }
  function withdraw(t: MyTrack) {
    Alert.alert(`Retirar «${t.title}»?`, 'Deixa de estar disponível para novos mimos e tchekas. Os que já a usam continuam como estão. Não se desfaz: para voltar, carregas outra vez.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Retirar',
        style: 'destructive',
        onPress: () => void artistsApi.withdrawTrack(t.id).then(() => qc.invalidateQueries({ queryKey: ['artist-tracks'] })).catch((e: Error) => Alert.alert('Não deu', e.message)),
      },
    ]);
  }

  const list = q.data ?? [];
  const total = list.reduce((n, t) => n + t.uses, 0);
  return (
    <StackPage title="As minhas músicas">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Primary title="Carregar uma música" onPress={() => router.push('/artista/carregar' as never)} />
        {q.isLoading ? <ActivityIndicator color={colors.zinc500} style={{ paddingVertical: 32 }} /> : null}
        {q.isError ? <Text style={ast.err}>Não consegui carregar as tuas músicas.</Text> : null}
        {q.data && !list.length ? <Text style={[ast.cardSub, { textAlign: 'center', marginTop: 24 }]}>Ainda não carregaste nenhuma música.</Text> : null}
        {list.length ? <Text style={[ast.hint, { marginTop: 16 }]}>{list.length} {list.length === 1 ? 'música' : 'músicas'} · {total} {total === 1 ? 'uso' : 'usos'} ao todo. Só vês totais: nunca quem usou.</Text> : null}
        {list.map((t) => {
          const st = trackStatusLabel(t.status, t.onHold);
          return (
            <View key={t.id} style={ast.card}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' }}>
                  {t.cover ? <Image source={{ uri: abs(t.cover) }} style={{ width: 64, height: 64 }} contentFit="cover" /> : <Icon name="music" size={24} color={colors.zinc500} />}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={ast.cardTitle} numberOfLines={2}>{t.title}</Text>
                  <View style={{ marginTop: 4 }}><Pill tone={st.tone}>{st.label}</Pill>{t.explicit ? <Text style={ast.hint}>Explícita</Text> : null}</View>
                  <Text style={ast.hint}>Trecho de {mmss(t.previewStartMs)} a {mmss(t.previewStartMs + t.previewMs)} · {t.styles.join(', ')}</Text>
                </View>
              </View>
              <Text style={[ast.cardSub, { fontWeight: '600', color: colors.zinc900 }]}>{usesLine(t.uses, t.people)}</Text>
              {t.reason && (t.status === 'rejected' || t.status === 'removed') ? <Text style={[ast.cardSub, { color: colors.red600 }]}>Motivo: {t.reason}</Text> : null}
              {t.onHold ? <Text style={ast.hint}>Alguém denunciou esta música por direitos de autor. Fica escondida enquanto a equipa analisa; podes ser contactado.</Text> : null}
              <Text style={ast.hint}>Licença aceite{t.licenseAcceptedAt ? ` a ${new Date(t.licenseAcceptedAt).toLocaleDateString('pt-PT')}` : ''} (versão {t.licenseVersion}).</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {t.previewUrl ? (
                  <Pressable onPress={() => void listen(t)} style={[ast.ghost, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} accessibilityRole="button" accessibilityLabel={playing === t.id ? 'Parar' : 'Ouvir o trecho'}>
                    <Icon name={playing === t.id ? 'pause' : 'play'} size={14} solid color={colors.zinc800} />
                    <Text style={ast.ghostTxt}>{playing === t.id ? 'Parar' : 'Ouvir o trecho'}</Text>
                  </Pressable>
                ) : null}
                {t.status === 'approved' || t.status === 'pending' ? <Ghost title="Retirar" danger onPress={() => withdraw(t)} /> : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </StackPage>
  );
}
