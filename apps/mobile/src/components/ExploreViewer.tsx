import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Reel } from '@/app/(tabs)/reels';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import type { Page, Post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/**
 * Abre uma publicação do Explorar em ecrã inteiro (não numa folha), como no site.
 * Vídeo: como os Reels, desliza-se para cima para o seguinte. Foto ou texto: só aquela publicação.
 */
export function ExploreViewer({ items, startId, onClose, title = 'Explorar' }: { items: Post[]; startId: string; onClose: () => void; title?: string }) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { user } = useAuth();
  const qc = useQueryClient();
  const start = items.find((p) => p.id === startId);
  const reels = start?.media[0]?.kind === 'video';
  const immersive = reels || start?.kind === 'post';
  const list = reels ? items.filter((p) => p.media[0]?.kind === 'video') : items.filter((p) => p.id === startId);
  const first = Math.max(0, list.findIndex((p) => p.id === startId));
  const [active, setActive] = useState(first);
  const [h, setH] = useState(winH);
  const ref = useRef<FlatList<Post>>(null);
  const viewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null) setActive(i);
  }).current;
  const viewConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;
  if (!start) return null;

  const patch = (id: string, p: Partial<Post>) => {
    const merge = (i: Post): Post => (i.id === id ? { ...i, ...p } : i);
    qc.setQueriesData<InfiniteData<Page<Post>>>({ queryKey: ['explore'] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map(merge) })) });
  };
  const goNext = (i: number) => ref.current?.scrollToIndex({ index: (i + 1) % list.length, animated: true });

  if (immersive) {
    return (
      <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center' }}>
          <View style={{ flex: 1, width: '100%', maxWidth: 576 }} onLayout={(e) => setH(Math.round(e.nativeEvent.layout.height))}>
            <FlatList
              ref={ref}
              data={list}
              extraData={`${h}|${active}`}
              keyExtractor={(p) => p.id}
              pagingEnabled
              snapToInterval={h}
              decelerationRate="fast"
              bounces={false}
              showsVerticalScrollIndicator={false}
              initialScrollIndex={first}
              getItemLayout={(_, i) => ({ length: h, offset: h * i, index: i })}
              onViewableItemsChanged={viewable}
              viewabilityConfig={viewConfig}
              renderItem={({ item, index }) => (
                <Reel post={item} active={index === active} height={h} me={user?.id} onChange={(c) => patch(item.id, c)} onMore={reels ? () => goNext(index) : undefined} />
              )}
            />
            <View style={[st.top, { paddingTop: Math.max(insets.top, 12) }]} pointerEvents="box-none">
              <Pressable onPress={onClose} style={st.topBtn} accessibilityRole="button" accessibilityLabel="Voltar ao Explorar"><Icon name="back" size={24} color="#fff" /></Pressable>
              <Text style={st.topTitle}>{title}</Text>
              <View style={{ width: 44, height: 44 }} />
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top, alignItems: 'center' }}>
        <View style={{ flex: 1, width: '100%', maxWidth: 576, backgroundColor: colors.white }}>
          <View style={st.header}>
            <Pressable onPress={onClose} style={st.back} accessibilityRole="button" accessibilityLabel="Voltar ao Explorar"><Icon name="back" size={24} /></Pressable>
            <Text style={st.title}>Publicação</Text>
          </View>
          <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}>
            {list.map((p) => <PostCard key={p.id} post={p} me={user?.id} />)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, zIndex: 20 },
  topBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  topTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.zinc100, paddingHorizontal: 8, paddingBottom: 8, paddingTop: 8 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: colors.zinc900 },
});
