import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { api, type CheerPerson } from '@/lib/api';
import { feedApi, type PeopleKind } from '@/lib/api.feed';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { Avatar } from './Avatar';
import { NameWithBadge } from './NameWithBadge';
import { Sheet } from './Sheet';
import { t } from '@/lib/i18n';

const TITLE: Record<PeopleKind, string> = { get reposts() { return t('Quem repostou'); }, get cheers() { return t('Quem brindou'); }, get gifts() { return t('Quem presenteou'); } };
const EMPTY: Record<PeopleKind, string> = { get reposts() { return t('Ainda ninguém repostou.'); }, get cheers() { return t('Ainda ninguém brindou.'); }, get gifts() { return t('Ainda ninguém presenteou.'); } };

/** Lista de quem interagiu com uma publicação. O servidor só responde se o dono o permitir. */
export function PeopleSheet({ postId, kind, onClose }: { postId: string; kind: PeopleKind; onClose: () => void }) {
  const q = useQuery({ queryKey: ['post-people', postId, kind], queryFn: () => feedApi.postPeople(postId, kind), retry: false });
  return <PeopleList title={TITLE[kind]} empty={EMPTY[kind]} q={q} onClose={onClose} />;
}

/** Quem brindou um comentário (`story`: um comentário de um mimo; senão, de uma publicação). */
export function CommentCheersSheet({ commentId, story = false, onClose }: { commentId: string; story?: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['comment-cheers', story ? 'story' : 'post', commentId],
    queryFn: () => (story ? api.storyCommentCheers(commentId) : api.commentCheers(commentId)),
    retry: false,
  });
  return <PeopleList title={t('Quem brindou')} empty={t('Ainda ninguém brindou.')} q={q} onClose={onClose} />;
}

function PeopleList({ title, empty, q, onClose }: { title: string; empty: string; q: UseQueryResult<CheerPerson[]>; onClose: () => void }) {
  const router = useRouter();
  return (
    <Sheet title={title} onClose={onClose}>
      {q.isLoading && <ActivityIndicator color={colors.brand} style={{ paddingVertical: 24 }} />}
      {q.isError && <Text style={st.msg} accessibilityRole="alert">{t('Esta lista não está disponível')}</Text>}
      {q.isSuccess && q.data.length === 0 && <Text style={st.msg}>{empty}</Text>}
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
              <NameWithBadge name={p.displayName} who={p} style={st.name} />
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
