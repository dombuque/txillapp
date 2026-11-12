import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { StackPage } from '@/components/StackPage';
import { api, type Post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { findCachedPost } from '@/lib/postCache';
import { flushSeen, trackSeen } from '@/lib/seen';
import { colors } from '@/lib/theme';

/** Uma publicação aberta a partir de uma notificação, de um perfil ou de uma ligação. */
export default function PostPage() {
  const { id = '', comments, c } = useLocalSearchParams<{ id: string; comments?: string; c?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  // Se a publicação já está em memória (veio do Início, de um perfil…), mostra-se logo; a rede só a põe em dia.
  const q = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.getPost(id),
    retry: false,
    placeholderData: () => findCachedPost<Post>(qc.getQueryCache().getAll().map((x) => x.state.data), id),
  });
  void router;
  // Abrir a publicação conta como vista (o mesmo "visto" do Início): deixa de contar nas "publicações novas" do chat
  // e desce no feed. Envia logo, para a conversa já vir certa quando se volta atrás.
  const seenId = user && q.data ? q.data.id : null;
  useEffect(() => {
    if (!seenId) return;
    trackSeen(seenId);
    flushSeen();
  }, [seenId]);
  return (
    <StackPage title="Publicação">
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}>
        {q.isError && (
          <View style={styles.gone}>
            <Icon name="search" size={44} color={colors.zinc300} />
            <Text style={styles.goneTitle}>Esta publicação já não está disponível</Text>
            <Text style={styles.goneText}>Pode ter sido apagada, ou a conta passou a privada.</Text>
          </View>
        )}
        {q.isPending && !q.data ? <ActivityIndicator style={{ marginTop: 48, alignSelf: 'center' }} /> : null}
        {q.data && <PostCard post={q.data} me={user?.id} detail openComments={comments === '1' || !!c} highlightComment={c || undefined} />}
      </ScrollView>
    </StackPage>
  );
}

const styles = StyleSheet.create({
  gone: { marginHorizontal: 24, marginTop: 48, alignItems: 'center' },
  goneTitle: { marginTop: 12, fontSize: 20, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  goneText: { marginTop: 4, color: colors.zinc600, textAlign: 'center' },
});
