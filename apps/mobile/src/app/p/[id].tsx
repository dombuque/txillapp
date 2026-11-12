import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { api, type Post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { findCachedPost, isGone } from '@/lib/postCache';
import { flushSeen, trackSeen } from '@/lib/seen';
import { colors } from '@/lib/theme';

/** As listas onde a publicação pode já estar carregada (para a abrir logo, sem ecrã vazio). */
const LISTS = ['feed', 'profile-posts', 'explore', 'saved', 'tag', 'place'];

/** Uma publicação aberta a partir de uma notificação, de um perfil ou de uma ligação. */
export default function PostPage() {
  const { id = '', comments, c } = useLocalSearchParams<{ id: string; comments?: string; c?: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.getPost(id),
    retry: false,
    // Vindo do feed (ou do perfil, do explorar…): mostra já o cartão que lá estava, enquanto chega a versão fresca.
    // Primeiro as listas de publicações; senão o resto da memória (pesquisa, notificações…), com limites (lib/postCache).
    placeholderData: () => findCachedPost(LISTS.flatMap((k) => qc.getQueriesData<Post>({ queryKey: [k] }).map(([, d]) => d)), id) ??
      findCachedPost<Post>(qc.getQueryCache().getAll().map((x) => x.state.data), id),
  });
  // Abrir a publicação conta como vista (o mesmo "visto" do Início): deixa de contar nas "publicações novas" do chat
  // e desce no feed. Envia logo, para a conversa já vir certa quando se volta atrás.
  const seenId = user && q.data ? q.data.id : null;
  useEffect(() => {
    if (!seenId) return;
    trackSeen(seenId);
    flushSeen();
  }, [seenId]);
  const gone = q.isError && isGone(q.error);
  return (
    <StackPage title="Publicação">
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}>
        {q.isLoading && <ActivityIndicator color={colors.brand} style={{ marginTop: 48 }} />}
        {gone && (
          <View style={styles.gone}>
            <Icon name="search" size={44} color={colors.zinc300} />
            <Text style={styles.goneTitle}>Esta publicação já não está disponível</Text>
            <Text style={styles.goneText}>Pode ter sido apagada, ou a conta passou a privada.</Text>
          </View>
        )}
        {q.isError && !gone && (
          // Sem rede (ou o servidor falhou): não quer dizer que a publicação tenha desaparecido.
          <View style={styles.gone} accessibilityRole="alert">
            <Icon name="alert" size={44} color={colors.zinc300} />
            <Text style={styles.goneTitle}>Ups, não consegui abrir a publicação</Text>
            <Text style={styles.goneText}>Verifica a ligação e tenta outra vez.</Text>
            <Pressable onPress={() => void q.refetch()} style={styles.retry} accessibilityRole="button"><Text style={styles.retryText}>Tentar outra vez</Text></Pressable>
          </View>
        )}
        {q.data && <PostCard post={q.data} me={user?.id} detail openComments={comments === '1' || !!c} highlightComment={c || undefined} />}
      </ScrollView>
    </StackPage>
  );
}

const styles = StyleSheet.create({
  gone: { marginHorizontal: 24, marginTop: 48, alignItems: 'center' },
  goneTitle: { marginTop: 12, fontSize: 20, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  goneText: { marginTop: 4, color: colors.zinc600, textAlign: 'center' },
  retry: { marginTop: 20, height: 44, paddingHorizontal: 24, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 15, fontWeight: '600', color: colors.zinc800 },
});
