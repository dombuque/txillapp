import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { api, type Post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Reel } from '../(tabs)/reels';

/** Um reel aberto a partir de uma ligação, partilha ou story: ecrã inteiro, a tocar, com a seta de voltar. */
export default function ReelPage() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [muted, setMuted] = useState(false);
  const q = useQuery({ queryKey: ['post', id], queryFn: () => api.getPost(id), retry: false });
  const post = q.data ? (q.data.kind === 'repost' && q.data.repostOf ? q.data.repostOf : q.data) : null;
  const isVideo = post?.media[0]?.kind === 'video';
  const patch = (c: Partial<Post>) => qc.setQueryData(['post', id], (d: Post | undefined) => (d ? { ...d, ...c } : d));
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // Uma publicação que não é vídeo abre como publicação normal.
  useEffect(() => {
    if (post && !isVideo) router.replace(`/p/${post.id}` as never);
  }, [post, isVideo, router]);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {q.isLoading && <View style={st.center}><ActivityIndicator color="#fff" /></View>}
      {q.isError && (
        <View style={st.center}>
          <Icon name="film" size={48} color="rgba(255,255,255,0.7)" />
          <Text style={st.title}>Este reel já não está disponível</Text>
          <Text style={{ marginTop: 4, color: 'rgba(255,255,255,0.75)', textAlign: 'center' }}>Pode ter sido apagado, ou a conta passou a privada.</Text>
          <Pressable onPress={() => router.replace('/reels' as never)} style={st.cta}><Text style={{ color: '#fff', fontWeight: '700' }}>Ver outros reels</Text></Pressable>
        </View>
      )}
      {post && isVideo && (
        <View style={{ flex: 1, width: '100%', maxWidth: 576, alignSelf: 'center' }}>
          <Reel post={post} active height={height} muted={muted} onMute={() => setMuted((m) => !m)} onChange={patch} me={user?.id} />
        </View>
      )}
      <View style={[st.top, { paddingTop: Math.max(insets.top, 12) }]} pointerEvents="box-none">
        <BackButton onPress={close} color="#fff" />
        <Text style={st.head}>Reel</Text>
        <View style={{ width: 44 }} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: { marginTop: 16, fontSize: 20, fontWeight: '800', color: '#fff', textAlign: 'center' },
  cta: { marginTop: 24, borderRadius: 999, backgroundColor: '#d6334f', paddingHorizontal: 28, paddingVertical: 12 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  head: { fontSize: 18, fontWeight: '800', color: '#fff', textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 4 },
});
