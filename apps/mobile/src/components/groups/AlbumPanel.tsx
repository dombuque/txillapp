import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MediaFull } from '@/components/ChatBubbles';
import { Icon } from '@/components/Icon';
import { PhotoViewer } from '@/components/PhotoViewer';
import { ActivityIndicator } from '@/components/PontoLoader';
import { groupKeys, groupsApi, type AlbumItem, type AlbumPage } from '@/lib/api.groups';
import { abs, sized } from '@/lib/config';
import { colors } from '@/lib/theme';

/** O álbum do TxillGroup: todas as fotos e vídeos enviados na conversa, numa grelha. Fotos abrem no visor de fotos, vídeos no leitor do chat. */
export function AlbumPanel({ groupId, columns = 3 }: { groupId: string; columns?: number }) {
  const [w, setW] = useState(0);
  const [photoAt, setPhotoAt] = useState<number | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: groupKeys.album(groupId),
    queryFn: ({ pageParam }) => groupsApi.album(groupId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l: AlbumPage) => l.nextCursor ?? undefined,
    staleTime: 30_000,
  });
  const items: AlbumItem[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  const photos = items.filter((i) => i.kind === 'image');
  const size = w ? Math.floor((w - (columns - 1) * 2) / columns) : 0;
  const open = (it: AlbumItem) => {
    if (it.kind === 'video') return setVideo(abs(it.mediaUrl) ?? it.mediaUrl);
    setPhotoAt(photos.findIndex((p) => p.id === it.id));
  };
  const shown = photoAt != null ? photos[photoAt] : null;

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {q.isLoading ? (
        <View style={st.center}><ActivityIndicator color={colors.zinc500} /></View>
      ) : (
        <FlatList
          key={columns}
          data={items}
          numColumns={columns}
          keyExtractor={(i) => i.id}
          columnWrapperStyle={{ gap: 2 }}
          contentContainerStyle={{ gap: 2, paddingBottom: 24 }}
          onEndReachedThreshold={0.6}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
          ListHeaderComponent={items.length ? <Text style={st.head}>{photos.length} fotos · {items.length - photos.length} vídeos</Text> : undefined}
          ListEmptyComponent={
            <View style={st.center}>
              <Icon name="images" size={44} color={colors.zinc300} />
              <Text style={st.emptyTitle}>{q.isError ? 'Não consegui abrir o álbum' : 'O álbum ainda está vazio'}</Text>
              <Text style={st.emptySub}>{q.isError ? (q.error as Error).message : 'As fotos e os vídeos que a malta mandar na conversa aparecem aqui.'}</Text>
            </View>
          }
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.zinc500} /> : undefined}
          renderItem={({ item }) => {
            const thumb = item.kind === 'video' ? null : item.mediaUrl;
            const src = thumb ? sized(abs(thumb) ?? thumb, 360) : null;
            return (
              <Pressable onPress={() => open(item)} style={{ width: size, height: size, backgroundColor: colors.zinc100 }} accessibilityRole="imagebutton" accessibilityLabel={item.kind === 'video' ? 'Vídeo' : 'Foto'}>
                {src ? <Image source={{ uri: src }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.zinc800 }]} />}
                {item.kind === 'video' && <View style={st.play}><Icon name="play" size={14} solid color="#fff" /></View>}
              </Pressable>
            );
          }}
        />
      )}
      {shown && photoAt != null && (
        <PhotoViewer
          photos={photos.map((p) => ({ url: abs(p.mediaUrl) ?? p.mediaUrl }))}
          start={photoAt}
          author={{ displayName: shown.sender?.displayName ?? 'TxillGroup', username: shown.sender?.username ?? '' }}
          onClose={() => setPhotoAt(null)}
        />
      )}
      {video && <MediaFull url={video} video onClose={() => setVideo(null)} />}
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 6, minHeight: 280 },
  head: { paddingHorizontal: 14, paddingVertical: 10, fontSize: 13, fontWeight: '700', color: colors.zinc500 },
  emptyTitle: { marginTop: 8, fontSize: 18, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  emptySub: { fontSize: 14, color: colors.zinc600, textAlign: 'center', maxWidth: 300 },
  play: { position: 'absolute', right: 6, top: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});
