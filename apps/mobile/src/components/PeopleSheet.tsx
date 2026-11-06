import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { feedApi, type PeopleKind } from '@/lib/api.feed';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';

const TITLE: Record<PeopleKind, string> = { reposts: 'Quem repostou', cheers: 'Quem brindou', gifts: 'Quem presenteou' };
const EMPTY: Record<PeopleKind, string> = { reposts: 'Ainda ninguém repostou.', cheers: 'Ainda ninguém brindou.', gifts: 'Ainda ninguém presenteou.' };

/** Lista de quem interagiu com uma publicação. O servidor só responde se o dono o permitir. */
export function PeopleSheet({ postId, kind, onClose }: { postId: string; kind: PeopleKind; onClose: () => void }) {
  const router = useRouter();
  const q = useQuery({ queryKey: ['post-people', postId, kind], queryFn: () => feedApi.postPeople(postId, kind), retry: false });
  return (
    <Sheet title={TITLE[kind]} onClose={onClose}>
      {q.isLoading && <ActivityIndicator color={colors.brand} style={{ paddingVertical: 24 }} />}
      {q.isError && <Text style={st.msg} accessibilityRole="alert">Esta lista não está disponível</Text>}
      {q.isSuccess && q.data.length === 0 && <Text style={st.msg}>{EMPTY[kind]}</Text>}
      <ScrollView style={{ maxHeight: 420 }}>
        {q.data?.map((p) => (
          <Pressable
            key={p.username}
            onPress={() => {
              onClose();
              router.push(`/u/${p.username}` as never);
            }}
            style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.zinc100 }]}
            accessibilityRole="link"
          >
            <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.name} numberOfLines={1}>{p.displayName}</Text>
              <Text style={st.handle} numberOfLines={1}>@{p.username}</Text>
            </View>
            <Text style={st.handle}>{timeAgo(p.at)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  msg: { paddingVertical: 24, textAlign: 'center', color: colors.zinc600, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 24 },
  name: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  handle: { fontSize: 14, color: colors.zinc500 },
});
