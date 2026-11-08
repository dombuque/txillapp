import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import type { Shot } from './TxCamera';

const MAX_VIDEO_MS = 60_500;
const PAGE = 60;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const mimeOf = (name: string, video: boolean) => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (video) return ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'video/mp4';
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
};

type Item = MediaLibrary.Asset | 'camera';

/**
 * Galeria dentro do Txillapp (como no Instagram): grelha de 3 com a câmara no primeiro quadrado, os vídeos com a duração,
 * "Recentes" para trocar de álbum e "Selecionar" para escolher várias. Devolve as fotos e vídeos escolhidos.
 */
export function GalleryPicker({ title, multi = false, max = 10, onPick, onCamera, onClose }: {
  title: string;
  multi?: boolean;
  max?: number;
  onPick: (shots: Shot[]) => void;
  /** O primeiro quadrado: volta à câmara. */
  onCamera: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [perm, askPerm] = MediaLibrary.usePermissions({ granularPermissions: ['photo', 'video'] });
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [end, setEnd] = useState<string | undefined>(undefined);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [albums, setAlbums] = useState<MediaLibrary.Album[] | null>(null);
  const [album, setAlbum] = useState<MediaLibrary.Album | null>(null);
  const [albumsOpen, setAlbumsOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<MediaLibrary.Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (albumsOpen) { setAlbumsOpen(false); return true; }
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [albumsOpen, onClose]);

  const load = useCallback(async (reset: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await MediaLibrary.getAssetsAsync({
        first: PAGE,
        after: reset ? undefined : end,
        album: album ?? undefined,
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });
      setAssets((cur) => (reset ? page.assets : [...cur, ...page.assets]));
      setEnd(page.endCursor);
      setMore(page.hasNextPage);
    } catch {
      setMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [album, end]);

  // Carrega quando há permissão e sempre que se troca de álbum.
  useEffect(() => {
    if (!perm?.granted) return;
    setAssets([]);
    setEnd(undefined);
    setMore(true);
    void load(true);
  }, [perm?.granted, album]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openAlbums() {
    setAlbumsOpen(true);
    if (albums) return;
    try {
      const list = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
      setAlbums(list.filter((a) => a.assetCount > 0).sort((a, b) => b.assetCount - a.assetCount));
    } catch {
      setAlbums([]);
    }
  }

  async function resolve(list: MediaLibrary.Asset[]): Promise<Shot[]> {
    const out: Shot[] = [];
    for (const a of list) {
      const video = a.mediaType === MediaLibrary.MediaType.video;
      let uri = a.uri;
      try {
        const info = await MediaLibrary.getAssetInfoAsync(a);
        uri = info.localUri ?? a.uri;
      } catch { /* fica o endereço da galeria */ }
      out.push({ uri, video, mime: mimeOf(a.filename, video), durationMs: video ? Math.round(a.duration * 1000) : undefined });
    }
    return out;
  }

  async function choose(a: MediaLibrary.Asset) {
    const video = a.mediaType === MediaLibrary.MediaType.video;
    if (video && a.duration * 1000 > MAX_VIDEO_MS) return;
    if (selecting) {
      setPicked((cur) => (cur.some((x) => x.id === a.id) ? cur.filter((x) => x.id !== a.id) : cur.length >= max ? cur : [...cur, a]));
      return;
    }
    setBusy(true);
    onPick(await resolve([a]));
  }
  async function done() {
    if (!picked.length) return;
    setBusy(true);
    onPick(await resolve(picked));
  }

  const cell = (width - 4) / 3;
  const data: Item[] = ['camera', ...assets];

  if (perm && !perm.granted) {
    return (
      <View style={[StyleSheet.absoluteFill, st.root, st.center, { paddingHorizontal: 32 }]}>
        <Pressable onPress={onClose} style={[st.iconBtn, { position: 'absolute', top: insets.top + 8, left: 8 }]} accessibilityRole="button" accessibilityLabel="Fechar"><Icon name="x" size={26} color="#fff" strokeWidth={2.2} /></Pressable>
        <Icon name="images" size={52} color="rgba(255,255,255,0.8)" />
        <Text style={st.pTitle}>As tuas fotos e vídeos</Text>
        <Text style={st.pSub}>{perm.canAskAgain ? 'Dá acesso à galeria para escolheres fotos e vídeos aqui mesmo.' : 'O acesso à galeria está bloqueado. Ativa-o nas definições do telemóvel.'}</Text>
        <Pressable onPress={() => void (perm.canAskAgain ? askPerm() : Linking.openSettings())} style={st.cta} accessibilityRole="button">
          <Text style={st.ctaText}>{perm.canAskAgain ? 'Permitir a galeria' : 'Abrir as definições'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, st.root]}>
      <View style={[st.head, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={onClose} style={st.iconBtn} accessibilityRole="button" accessibilityLabel="Fechar"><Icon name="x" size={26} color="#fff" strokeWidth={2.2} /></Pressable>
        <Text style={st.title} numberOfLines={1}>{title}</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={st.row}>
        <Pressable onPress={() => void openAlbums()} style={st.albumBtn} accessibilityRole="button" accessibilityLabel="Escolher o álbum">
          <Text style={st.albumText} numberOfLines={1}>{album?.title ?? 'Recentes'}</Text>
          <View style={{ transform: [{ rotate: '90deg' }] }}><Icon name="chevron-right" size={18} color="#fff" /></View>
        </Pressable>
        {multi ? (
          <Pressable onPress={() => { setSelecting((v) => !v); setPicked([]); }} style={[st.selectBtn, selecting && { backgroundColor: '#fff' }]} accessibilityRole="button" accessibilityState={{ selected: selecting }}>
            <Icon name="images" size={18} color={selecting ? colors.zinc900 : '#fff'} />
            <Text style={[st.selectText, selecting && { color: colors.zinc900 }]}>Selecionar</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={data}
        numColumns={3}
        keyExtractor={(it) => (it === 'camera' ? 'camera' : it.id)}
        columnWrapperStyle={{ gap: 2 }}
        contentContainerStyle={{ gap: 2, paddingBottom: 120 + insets.bottom }}
        onEndReached={() => { if (more && !loading) void load(false); }}
        onEndReachedThreshold={1.5}
        initialNumToRender={18}
        windowSize={9}
        renderItem={({ item }) => {
          if (item === 'camera') {
            return (
              <Pressable onPress={onCamera} style={[st.cam, { width: cell, height: cell * 1.6 }]} accessibilityRole="button" accessibilityLabel="Abrir a câmara">
                <Icon name="camera" size={34} color="#fff" />
              </Pressable>
            );
          }
          const video = item.mediaType === MediaLibrary.MediaType.video;
          const long = video && item.duration * 1000 > MAX_VIDEO_MS;
          const n = picked.findIndex((x) => x.id === item.id);
          return (
            <Pressable onPress={() => void choose(item)} disabled={busy} style={{ width: cell, height: cell * 1.6, backgroundColor: '#1c1c1e' }} accessibilityRole="button" accessibilityLabel={video ? `Vídeo de ${mmss(item.duration)}` : 'Foto'}>
              <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={item.id} transition={80} />
              {long ? <View style={st.long}><Text style={st.longText}>Mais de 60 s</Text></View> : null}
              {video ? <Text style={st.dur}>{mmss(item.duration)}</Text> : null}
              {selecting ? (
                <View style={[st.check, n >= 0 && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
                  {n >= 0 ? <Text style={st.checkText}>{n + 1}</Text> : null}
                </View>
              ) : null}
            </Pressable>
          );
        }}
        ListFooterComponent={loading ? <ActivityIndicator color="#fff" style={{ margin: 24 }} /> : undefined}
        ListEmptyComponent={!loading ? <Text style={st.empty}>Ainda não há fotos nem vídeos aqui.</Text> : undefined}
      />

      {selecting && picked.length > 0 ? (
        <Pressable onPress={() => void done()} disabled={busy} style={[st.next, { bottom: Math.max(insets.bottom, 12) + 20 }]} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.nextText}>Seguinte ({picked.length})</Text>}
        </Pressable>
      ) : null}
      {busy && !selecting ? <View style={[StyleSheet.absoluteFill, st.center, { backgroundColor: 'rgba(0,0,0,0.4)' }]}><ActivityIndicator color="#fff" size="large" /></View> : null}

      {albumsOpen ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.96)', paddingTop: insets.top + 6 }]}>
          <View style={st.head}>
            <Pressable onPress={() => setAlbumsOpen(false)} style={st.iconBtn} accessibilityRole="button" accessibilityLabel="Voltar"><Icon name="back" size={24} color="#fff" /></Pressable>
            <Text style={st.title}>Álbuns</Text>
            <View style={{ width: 44 }} />
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Pressable onPress={() => { setAlbum(null); setAlbumsOpen(false); }} style={st.albumRow}><Text style={st.albumRowText}>Recentes</Text></Pressable>
            {albums === null ? <ActivityIndicator color="#fff" style={{ margin: 24 }} /> : albums.map((a) => (
              <Pressable key={a.id} onPress={() => { setAlbum(a); setAlbumsOpen(false); }} style={st.albumRow}>
                <Text style={st.albumRowText} numberOfLines={1}>{a.title}</Text>
                <Text style={st.albumCount}>{a.assetCount}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { backgroundColor: '#000', zIndex: 25 },
  center: { alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 10 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 19, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  albumBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '60%' },
  albumText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  selectBtn: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 19, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.14)' },
  selectText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cam: { backgroundColor: '#1c2024', alignItems: 'center', justifyContent: 'center' },
  dur: { position: 'absolute', right: 8, bottom: 6, color: '#fff', fontSize: 14, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  long: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  longText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
  check: { position: 'absolute', right: 8, top: 8, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  checkText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  empty: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: 40, fontSize: 15 },
  next: { position: 'absolute', alignSelf: 'center', height: 50, minWidth: 180, borderRadius: 25, paddingHorizontal: 24, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  nextText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  albumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  albumRowText: { color: '#fff', fontSize: 17, fontWeight: '600', flexShrink: 1 },
  albumCount: { color: 'rgba(255,255,255,0.5)', fontSize: 15 },
  pTitle: { marginTop: 18, color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  pSub: { marginTop: 8, color: 'rgba(255,255,255,0.75)', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  cta: { marginTop: 22, height: 48, borderRadius: 24, paddingHorizontal: 26, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
