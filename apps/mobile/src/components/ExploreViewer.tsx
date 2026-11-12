import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Modal } from '@/components/Modal';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Reel } from '@/app/(tabs)/reels';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { isTcheka, type Page, type Post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/**
 * Abre uma publicação do Explorar em ecrã inteiro (não numa folha), como no site.
 * Tcheka: desliza-se para cima para a seguinte. Foto, carrossel ou texto: só aquela publicação.
 */
export function ExploreViewer({ items, startId, onClose, title = 'Explorar' }: { items: Post[]; startId: string; onClose: () => void; title?: string }) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { user } = useAuth();
  const qc = useQueryClient();
  const start = items.find((p) => p.id === startId);
  // Tchekas (um vídeo só): ecrã inteiro, a deslizar para a seguinte. O resto (fotos, carrosséis com vídeos, texto) abre como publicação.
  const reels = isTcheka(start);
  const immersive = reels;
  const list = reels ? items.filter((p) => isTcheka(p)) : items.filter((p) => p.id === startId);
  const first = Math.max(0, list.findIndex((p) => p.id === startId));
  const [active, setActive] = useState(first);
  const [h, setH] = useState(winH);
  const ref = useRef<FlatList<Post>>(null);
  // Abrir no Tcheka tocado: o initialScrollIndex não chega (no browser é ignorado e a altura muda depois do primeiro
  // layout), por isso põe-se a lista no sítio certo sempre que a altura muda, até a pessoa começar a deslizar.
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current || first <= 0) return;
    const go = () => ref.current?.scrollToOffset({ offset: first * h, animated: false });
    go();
    const t = setTimeout(go, 60);
    return () => clearTimeout(t);
  }, [h, first]);
  const viewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null) setActive(i);
  }).current;
  const viewConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;
  const { width: winW } = useWindowDimensions();
  // Arrastar para a direita (a partir do lado esquerdo do ecrã, como no iPhone) volta ao Explorar.
  const dx = useSharedValue(0);
  const back = Gesture.Pan()
    .activeOffsetX(18)
    .failOffsetY([-14, 14])
    .hitSlop({ left: 0, width: Math.max(80, winW * 0.3) })
    .onUpdate((e) => { dx.value = Math.max(0, e.translationX); })
    .onEnd((e) => {
      if (e.translationX > winW * 0.28 || e.velocityX > 700) dx.value = withTiming(winW, { duration: 180 }, () => runOnJS(onClose)());
      else dx.value = withTiming(0, { duration: 160 });
    });
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }] }));
  if (!start) return null;
  const swipeBack = (child: React.ReactNode, bg: string) => (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <GestureDetector gesture={back}>
        <Animated.View style={[{ flex: 1, backgroundColor: bg }, slide]}>{child}</Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );

  const patch = (id: string, p: Partial<Post>) => {
    const merge = (i: Post): Post => (i.id === id ? { ...i, ...p } : i);
    qc.setQueriesData<InfiniteData<Page<Post>>>({ queryKey: ['explore'] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map(merge) })) });
  };
  const goNext = (i: number) => ref.current?.scrollToIndex({ index: (i + 1) % list.length, animated: true });

  if (immersive) {
    return (
      <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent>
        {swipeBack(<View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center' }}>
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
              onScrollBeginDrag={() => { moved.current = true; }}
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
        </View>, '#000')}
      </Modal>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} transparent>
      {swipeBack(<View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top, alignItems: 'center' }}>
        <View style={{ flex: 1, width: '100%', maxWidth: 576, backgroundColor: colors.white }}>
          <View style={st.header}>
            <Pressable onPress={onClose} style={st.back} accessibilityRole="button" accessibilityLabel="Voltar ao Explorar"><Icon name="back" size={24} /></Pressable>
            <Text style={st.title}>Publicação</Text>
          </View>
          <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}>
            {list.map((p) => <PostCard key={p.id} post={p} me={user?.id} />)}
          </ScrollView>
        </View>
      </View>, colors.white)}
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
