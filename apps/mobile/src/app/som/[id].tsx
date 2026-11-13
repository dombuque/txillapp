import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Empty } from '@/components/Empty';
import { ExploreViewer } from '@/components/ExploreViewer';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { ApiError, type Post } from '@/lib/api';
import { soundsApi, type SoundSort } from '@/lib/api.sounds';
import { goBack } from '@/lib/nav';
import { sized } from '@/lib/config';
import { playTrack, stopTrack } from '@/lib/musicPlayer';
import { isSoundId, mergePages, RETIRE_SOUND_TEXT, RETIRE_SOUND_TITLE, soundMeta, unavailableText, usesLine, studioHref } from '@/lib/sounds';
import { colors } from '@/lib/theme';

/**
 * A página de um som (como no TikTok): a capa, o título, o autor com o selo, quantas tchekas o usam, ouvir, o botão grande
 * «Usar este som» (abre o estúdio já com ele) e, por baixo, a grelha das tchekas que o usam (mais vistas ou recentes).
 */
export default function SoundScreen() {
  const { id: raw = '' } = useLocalSearchParams<{ id: string }>();
  const id = decodeURIComponent(String(raw));
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [sort, setSort] = useState<SoundSort>('top');
  const [viewing, setViewing] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const me = useRef(Symbol('som'));
  const qc = useQueryClient();
  const valid = isSoundId(id);

  const sound = useQuery({ queryKey: ['sound', id], queryFn: () => soundsApi.get(id), enabled: valid, retry: false });
  const grid = useInfiniteQuery({
    queryKey: ['sound', id, 'tchekas', sort],
    queryFn: ({ pageParam }) => soundsApi.tchekas(id, sort, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: valid && sound.isSuccess,
    retry: false,
  });
  const items = mergePages(grid.data?.pages);

  // Sair da página pára o som.
  useEffect(() => {
    const k = me.current;
    return () => stopTrack(k);
  }, []);

  const s = sound.data;
  async function toggle() {
    if (!s?.previewUrl) return;
    if (playing) return stopTrack(me.current);
    const ok = await playTrack(me.current, s.previewUrl, { loop: true, onStop: () => setPlaying(false) });
    setPlaying(ok);
  }

  function report() {
    if (!s) return;
    const send = (reason: 'copyright' | 'other') =>
      soundsApi
        .report(s.id, reason)
        .then(() => {
          Alert.alert('Obrigado', 'A equipa vai analisar. Enquanto isso, o som não pode ser usado em tchekas novas.');
          void sound.refetch();
        })
        .catch((e) => Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : 'Tenta outra vez daqui a pouco.'));
    Alert.alert('Denunciar este som', 'Porquê?', [
      { text: 'Tem música protegida', onPress: () => void send('copyright') },
      { text: 'Outro motivo', onPress: () => void send('other') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  // «Retirar o som» (só o autor): deixa de tocar em todo o lado e o áudio é apagado. Não se desfaz.
  function retire() {
    if (!s) return;
    Alert.alert(RETIRE_SOUND_TITLE, RETIRE_SOUND_TEXT, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Retirar', style: 'destructive', onPress: () => void soundsApi.retire(s.id)
        .then(() => {
          stopTrack(me.current);
          void qc.invalidateQueries({ queryKey: ['sounds'] });
          Alert.alert('Som retirado', 'Deixou de tocar em todo o lado.');
          goBack(router, '/settings/sons');
        })
        .catch((e) => Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : 'Tenta outra vez daqui a pouco.')) },
    ]);
  }

  const cols = 3;
  const cell = Math.floor((Math.min(width, 640) - (cols - 1) * 2) / cols);
  const why = s && !s.canUse ? unavailableText(s.unavailable) : null;

  const header = s ? (
    <View style={st.head}>
      <View style={st.top}>
        <Pressable onPress={() => void toggle()} style={st.cover} accessibilityRole="button" accessibilityLabel={playing ? 'Parar o som' : 'Ouvir o som'} disabled={!s.previewUrl}>
          {s.cover ? <Image source={{ uri: sized(s.cover, 320) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} accessibilityIgnoresInvertColors /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.brand }]} />}
          <View style={st.play}><Icon name={playing ? 'pause' : 'play'} size={26} color="#fff" solid /></View>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={st.title} numberOfLines={3}>{s.title}</Text>
          {s.author ? (
            <NameWithBadge name={s.author.displayName} who={s.author} style={st.author} onPress={() => router.push(`/u/${s.author!.username}` as never)} />
          ) : s.artist ? <Text style={st.author} numberOfLines={1}>{s.artist}</Text> : null}
          <Text style={st.meta}>{[usesLine(s.uses), soundMeta({ kind: 'catalog', durationMs: s.durationMs })].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
      <Pressable
        onPress={() => router.push(studioHref(s.id) as never)}
        disabled={!s.canUse}
        style={({ pressed }) => [st.use, !s.canUse && { backgroundColor: colors.zinc300 }, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !s.canUse }}
      >
        <Icon name="video" size={20} color="#fff" />
        <Text style={st.useText}>Usar este som</Text>
      </Pressable>
      {why ? <Text style={st.why}>{why}</Text> : null}
      {s.kind === 'original' && s.mine ? (
        <Pressable onPress={retire} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 6 }} accessibilityRole="button">
          <Text style={{ color: colors.red600, fontSize: 13, fontWeight: '700' }}>Retirar o som</Text>
        </Pressable>
      ) : null}
      {s.kind === 'original' && !s.mine ? (
        <Pressable onPress={report} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 6 }} accessibilityRole="button">
          <Text style={{ color: colors.zinc500, fontSize: 13, fontWeight: '600' }}>Denunciar este som</Text>
        </Pressable>
      ) : null}
      <View style={st.tabs} accessibilityRole="tablist">
        {([['top', 'Mais vistas'], ['recent', 'Recentes']] as const).map(([k, label]) => (
          <Pressable key={k} onPress={() => setSort(k)} style={[st.pill, sort === k && { backgroundColor: colors.zinc900 }]} accessibilityRole="tab" accessibilityState={{ selected: sort === k }}>
            <Text style={[st.pillText, sort === k && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  ) : null;

  if (!valid || sound.isError) {
    return (
      <StackPage title="Som">
        <Empty icon="music" title="Este som já não está disponível" text="Pode ter sido apagado, ou a conta não deixa vê-lo." />
      </StackPage>
    );
  }

  return (
    <StackPage title="Som">
      <FlatList
        data={items}
        key={cols}
        numColumns={cols}
        keyExtractor={(p) => p.id}
        columnWrapperStyle={{ gap: 2 }}
        contentContainerStyle={{ gap: 2, paddingBottom: 32 }}
        ListHeaderComponent={sound.isLoading ? <ActivityIndicator style={{ marginTop: 48 }} color={colors.brand} /> : header ?? undefined}
        ListEmptyComponent={sound.isSuccess ? (grid.isLoading ? <ActivityIndicator style={{ marginTop: 32 }} color={colors.brand} /> : <Empty icon="film" title="Ainda ninguém usou este som" text="Sê a primeira pessoa." />) : undefined}
        ListFooterComponent={grid.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} color={colors.brand} /> : undefined}
        onEndReached={() => grid.hasNextPage && !grid.isFetchingNextPage && void grid.fetchNextPage()}
        renderItem={({ item, index }) => <Cell post={item} size={cell} original={index === 0 && sort === 'top' && s?.sourcePost?.id === item.id} onPress={() => setViewing(item.id)} />}
      />
      {viewing && <ExploreViewer items={items} startId={viewing} title={s?.title ?? 'Som'} onClose={() => setViewing(null)} />}
    </StackPage>
  );
}

function Cell({ post, size, original, onPress }: { post: Post; size: number; original: boolean; onPress: () => void }) {
  const m = post.media[0];
  return (
    <Pressable onPress={onPress} style={{ width: size, height: Math.round(size * 1.6), backgroundColor: colors.zinc100 }} accessibilityRole="button" accessibilityLabel={`Abrir a tcheka de ${post.author.displayName}`}>
      {m ? <Image source={{ uri: sized(m.posterUrl ?? m.url, 360) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} accessibilityIgnoresInvertColors /> : null}
      {original ? <View style={st.badge}><Text style={st.badgeText}>Original</Text></View> : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 12 },
  top: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  cover: { width: 104, height: 104, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.zinc100 },
  play: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '800', color: colors.zinc900 },
  author: { fontSize: 15, fontWeight: '600', color: colors.zinc700 },
  meta: { fontSize: 14, color: colors.zinc500 },
  use: { height: 52, borderRadius: 14, backgroundColor: colors.brand, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  useText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  why: { fontSize: 13, color: colors.zinc600, textAlign: 'center' },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 4 },
  pill: { flex: 1, borderRadius: 999, backgroundColor: colors.zinc100, paddingVertical: 10, alignItems: 'center' },
  pillText: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
  badge: { position: 'absolute', left: 6, top: 6, borderRadius: 6, backgroundColor: colors.brand, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
