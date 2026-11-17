import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Pill, ast } from '@/components/ArtistUi';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { artistsApi, type MyTrack } from '@/lib/api.artists';
import { mmss, trackStatusLabel, usesLine } from '@/lib/artists';
import { abs } from '@/lib/config';
import { confirm } from '@/lib/confirm';
import { playTrack, stopTrack } from '@/lib/musicPlayer';
import { colors } from '@/lib/theme';
import { showToast } from '@/lib/toast';
import { formatDate, t } from '@/lib/i18n';

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
  async function withdraw(track: MyTrack) {
    const ok = await confirm({ title: t('Retirar «{title}»?', { title: track.title }), message: t('Deixa de estar disponível para novos mimos e tchekas. Os que já a usam continuam como estão. Não se desfaz: para voltar, carregas outra vez.'), confirm: t('Retirar'), danger: true });
    if (!ok) return;
    artistsApi.withdrawTrack(track.id).then(() => qc.invalidateQueries({ queryKey: ['artist-tracks'] })).catch((e: Error) => showToast(e.message || t('Não deu. Tenta outra vez.')));
  }

  const list = q.data ?? [];
  const total = list.reduce((n, t) => n + t.uses, 0);
  return (
    <StackPage title={t('As minhas músicas')}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Button label={t('Carregar uma música')} onPress={() => router.push('/artista/carregar' as never)} block />
        {q.isLoading ? <ActivityIndicator color={colors.zinc500} style={{ paddingVertical: 32 }} /> : null}
        {q.isError ? <ErrorState what={t('as tuas músicas')} onRetry={() => void q.refetch()} /> : null}
        {q.data && !list.length ? <Text style={[ast.cardSub, { textAlign: 'center', marginTop: 24 }]}>{t('Ainda não carregaste nenhuma música.')}</Text> : null}
        {list.length ? <Text style={[ast.hint, { marginTop: 16 }]}>{t('{count} música · {total} {value} ao todo. Só vês totais: nunca quem usou.', { count: list.length, total, value: total === 1 ? 'uso' : 'usos', other: '{count} músicas · {total} {value} ao todo. Só vês totais: nunca quem usou.' })}</Text> : null}
        {list.map((track2) => {
          const st = trackStatusLabel(track2.status, track2.onHold);
          return (
            <View key={track2.id} style={ast.card}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' }}>
                  {track2.cover ? <Image source={{ uri: abs(track2.cover) }} style={{ width: 64, height: 64 }} contentFit="cover" /> : <Icon name="music" size={24} color={colors.zinc500} />}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={ast.cardTitle} numberOfLines={2}>{track2.title}</Text>
                  <View style={{ marginTop: 4 }}><Pill tone={st.tone}>{st.label}</Pill>{track2.explicit ? <Text style={ast.hint}>{t('Explícita')}</Text> : null}</View>
                  <Text style={ast.hint}>{t('Trecho de {mmss} a {mmss2} · {styles}', { mmss: mmss(track2.previewStartMs), mmss2: mmss(track2.previewStartMs + track2.previewMs), styles: track2.styles.join(', ') })}</Text>
                </View>
              </View>
              <Text style={[ast.cardSub, { fontWeight: '600', color: colors.zinc900 }]}>{usesLine(track2.uses, track2.people)}</Text>
              {track2.reason && (track2.status === 'rejected' || track2.status === 'removed') ? <Text style={[ast.cardSub, { color: colors.danger }]}>{t('Motivo: {reason}', { reason: track2.reason })}</Text> : null}
              {track2.onHold ? <Text style={ast.hint}>{t('Alguém denunciou esta música por direitos de autor. Fica escondida enquanto a equipa analisa; podes ser contactado.')}</Text> : null}
              <Text style={ast.hint}>{track2.licenseAcceptedAt ? t('Licença aceite a {date} (versão {licenseVersion}).', { date: formatDate(track2.licenseAcceptedAt), licenseVersion: track2.licenseVersion }) : t('Licença aceite (versão {licenseVersion}).', { licenseVersion: track2.licenseVersion })}</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {track2.previewUrl ? (
                  <Button label={playing === track2.id ? t('Parar') : t('Ouvir o trecho')} kind="secondary" size="sm" icon={<Icon name={playing === track2.id ? 'pause' : 'play'} size={14} solid color={colors.zinc900} />} onPress={() => void listen(track2)} style={ast.ghost} />
                ) : null}
                {track2.status === 'approved' || track2.status === 'pending' ? <Button label={t('Retirar')} kind="danger" size="sm" onPress={() => void withdraw(track2)} style={ast.ghost} /> : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </StackPage>
  );
}
