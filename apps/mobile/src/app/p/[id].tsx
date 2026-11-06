import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { StackPage } from '@/components/StackPage';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/** Uma publicação aberta a partir de uma notificação, de um perfil ou de uma ligação. */
export default function PostPage() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const q = useQuery({ queryKey: ['post', id], queryFn: () => api.getPost(id), retry: false });
  void router;
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
        {q.data && <PostCard post={q.data} me={user?.id} />}
      </ScrollView>
    </StackPage>
  );
}

const styles = StyleSheet.create({
  gone: { marginHorizontal: 24, marginTop: 48, alignItems: 'center' },
  goneTitle: { marginTop: 12, fontSize: 20, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  goneText: { marginTop: 4, color: colors.zinc600, textAlign: 'center' },
});
