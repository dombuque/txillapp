import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Icon } from '@/components/Icon';
import { LoadMore } from '@/components/LoadMore';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { EmptyState } from '@/components/Empty';
import { Button } from '@/components/ui/Button';
import { DuetGlyph } from '@/components/remix/RemixParts';
import { NameWithBadge } from '@/components/NameWithBadge';
import { StackPage } from '@/components/StackPage';
import { api, isTcheka, type Post } from '@/lib/api';
import { remixApi } from '@/lib/api.remix';
import { abs } from '@/lib/config';
import { duetHref, remixCount, type RemixKind } from '@/lib/remix';
import { colors } from '@/lib/theme';
import { t } from '@/lib/i18n';

const TABS: { id: RemixKind | null; label: string }[] = [{ id: null, get label() { return t('Todos'); } }, { id: 'duet', get label() { return t('Duetos'); } }, { id: 'reply', get label() { return t('Respostas'); } }];

/** «Duetos e respostas» de uma tcheka (ou publicação): as tchekas que a remisturaram, as mais recentes primeiro. */
export default function RemixesPage() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<RemixKind | null>(null);
  const orig = useQuery({ queryKey: ['post', id], queryFn: () => api.getPost(id), retry: false });
  const q = useInfiniteQuery({
    queryKey: ['remixes', id, tab],
    queryFn: ({ pageParam }) => remixApi.remixes(id, tab, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const cols = 3;
  const side = Math.floor((Math.min(width, 640) - 4) / cols);
  const p = orig.data;
  // Na app nativa não há gravação lado a lado: o botão só aparece no site e no PWA (ver remixActions).
  const canDuet = Platform.OS === 'web' && !!p && isTcheka(p) && p.canRemix === true;

  const cell = ({ item }: { item: Post }) => {
    const m = item.media[0];
    const poster = m?.posterUrl ?? (m?.kind === 'image' ? m.url : undefined);
    return (
      <Pressable onPress={() => router.push(`/p/${item.id}` as never)} style={{ width: side, height: side * (16 / 9) * 0.75, margin: 1 }} accessibilityRole="link" accessibilityLabel={t('{value} de @{username}', { value: item.remixOf?.kind === 'reply' ? t('Resposta') : t('Dueto'), username: item.author.username })}>
        {poster ? <Image source={{ uri: abs(poster) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.zinc800 }]} />}
        <View style={st.badge}>{item.remixOf?.kind === 'reply' ? <Icon name="reply" size={12} color="#fff" /> : <DuetGlyph size={14} />}<Text style={st.badgeText}>{item.remixOf?.kind === 'reply' ? t('Resposta') : t('Dueto')}</Text></View>
        <NameWithBadge name={`@${item.author.username}`} who={item.author} style={st.who} containerStyle={st.whoRow} />
      </Pressable>
    );
  };

  return (
    <StackPage title={t('Duetos e respostas')}>
      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        numColumns={cols}
        renderItem={cell}
        contentContainerStyle={{ paddingBottom: 40, maxWidth: 640, width: '100%', alignSelf: 'center' }}
        onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
        ListHeaderComponent={
          <View>
            {p ? (
              <Pressable onPress={() => router.push(`/p/${p.id}` as never)} style={st.orig} accessibilityRole="link">
                {p.media[0]?.posterUrl || p.media[0]?.kind === 'image' ? <Image source={{ uri: abs(p.media[0].posterUrl ?? p.media[0].url) }} style={st.origThumb} contentFit="cover" /> : <View style={[st.origThumb, { backgroundColor: colors.zinc200 }]} />}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.origTitle} numberOfLines={1}>{p.body || t('Tcheka de @{username}', { username: p.author.username })}</Text>
                  <NameWithBadge name={`@${p.author.username}`} who={p.author} style={st.origSub}><Text style={[st.origSub, { flexShrink: 0 }]}>· {remixCount(p.remixes ?? items.length)}</Text></NameWithBadge>
                </View>
              </Pressable>
            ) : null}
            {canDuet ? (
              <Button label={t('Fazer dueto')} icon={<DuetGlyph size={20} />} size="md" onPress={() => router.push(duetHref(id) as never)} style={{ marginHorizontal: 16, marginTop: 12 }} />
            ) : null}
            <SegmentedTabs tabs={TABS.map((t) => ({ value: t.id ?? 'all', label: t.label }))} value={tab ?? 'all'} onChange={(v) => setTab(v === 'all' ? null : (v as RemixKind))} style={{ marginHorizontal: 16, marginVertical: 12 }} />
          </View>
        }
        ListEmptyComponent={
          q.isLoading ? <View style={st.empty}><ActivityIndicator /></View>
            : q.isError ? <EmptyState icon="film" title={t('Esta tcheka já não está disponível')} />
            : <EmptyState icon="film" title={t('Ainda não há {value}', { value: tab === 'reply' ? t('respostas') : tab === 'duet' ? t('duetos') : t('duetos nem respostas') })} text={t('Quando alguém fizer, aparece aqui.')} />
        }
        // Carrega sozinha ao chegar ao fim (também no PWA do iPhone, com o LoadMore).
        ListFooterComponent={q.hasNextPage && items.length > 0 ? <LoadMore onLoad={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }} loading={q.isFetchingNextPage} label={t('Ver mais duetos e respostas')} /> : undefined}
      />
    </StackPage>
  );
}

const st = StyleSheet.create({
  orig: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 8, padding: 10, borderRadius: 14, backgroundColor: colors.zinc100 },
  origThumb: { width: 48, height: 64, borderRadius: 8 },
  origTitle: { color: colors.zinc900, fontSize: 15, fontWeight: '700' },
  origSub: { color: colors.zinc500, fontSize: 13, marginTop: 2 },
  duetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 22, backgroundColor: colors.brand, marginHorizontal: 16, marginTop: 12 },
  duetText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tab: { height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.zinc900 },
  tabText: { color: colors.zinc800, fontSize: 14, fontWeight: '700' },
  badge: { position: 'absolute', left: 6, top: 6, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  whoRow: { position: 'absolute', left: 6, right: 6, bottom: 6 },
  who: { color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 3 },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32, gap: 6 },
  emptyTitle: { color: colors.zinc900, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: colors.zinc500, fontSize: 14, textAlign: 'center' },
});
