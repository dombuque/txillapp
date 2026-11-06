import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { quoteText, type Msg } from '@/components/ChatBubbles';
import { ChatList } from '@/components/ChatList';
import { MessageMenu, stopLiveShare } from '@/components/ChatParts';
import { GroupComposer } from '@/components/GroupComposer';
import { GroupInfoSheet } from '@/components/GroupSheets';
import { api } from '@/lib/api';
import { gruposApi, type GroupThread } from '@/lib/api.grupos';
import { colors } from '@/lib/theme';

/** Conversa de grupo: bolhas com o nome de quem envia, a mesma barra de escrever e a folha com os membros. */
export default function GroupThreadScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [err, setErr] = useState('');
  const [menuFor, setMenuFor] = useState<Msg | null>(null);
  const [replying, setReplying] = useState<{ id: string; text: string; who: string } | null>(null);
  const [viewing, setViewing] = useState<{ url: string | null; body: string } | null>(null);
  const [members, setMembers] = useState(false);

  const q = useInfiniteQuery({
    queryKey: ['chat-group', id],
    queryFn: ({ pageParam }) => gruposApi.thread(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l: GroupThread) => l.nextCursor ?? undefined,
    refetchInterval: 30_000, // o tempo real faz o trabalho; isto é só uma rede de segurança
    retry: false,
  });
  const first = q.data?.pages[0];
  const group = first?.group;
  const items: Msg[] = q.data?.pages.flatMap((p) => p.items) ?? [];

  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['chat-unread'] });
    void qc.invalidateQueries({ queryKey: ['chat-groups'] });
  }, [first?.items[0]?.id, qc]);

  function startReply(m: Msg) {
    setReplying({ id: m.id, text: quoteText(m.kind, m.body), who: m.fromMe ? 'ti' : m.sender?.displayName.split(' ')[0] ?? '' });
  }
  async function cheer(m: Msg) {
    if (m.reactions?.some((x) => x.mine && x.reaction === ':brinde:')) return;
    try {
      await api.chatReact(m.id, ':brinde:');
      await q.refetch();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function openOnce(m: Msg) {
    try {
      const r = await api.chatOpen(m.id);
      setViewing({ url: r.mediaUrl, body: r.body });
      void q.refetch();
    } catch (e) {
      Alert.alert('Não consegui abrir', (e as Error).message);
    }
  }
  function left() {
    void qc.invalidateQueries({ queryKey: ['chat-groups'] });
    router.replace('/messages' as never);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={st.header}>
        <BackButton fallback="/messages" />
        {group && (
          <Pressable onPress={() => setMembers(true)} accessibilityLabel={`Ver membros de ${group.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <View style={{ width: 40, height: 40 }}>
              {group.members.slice(0, 2).map((m, i) => (
                <View key={m.username} style={[st.pair, i === 0 ? { left: 0, top: 0 } : { right: 0, bottom: 0 }]}>
                  <Avatar name={m.displayName} username={m.hasAvatar ? m.username : undefined} size={26} />
                </View>
              ))}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.hName} numberOfLines={1}>{group.name}</Text>
              <Text style={st.hSub} numberOfLines={1}>{group.members.length} pessoas · toca para ver</Text>
            </View>
          </Pressable>
        )}
      </View>

      {q.isError && !group ? (
        <Text style={st.empty}>{(q.error as Error).message || 'Não consegui abrir este grupo.'}</Text>
      ) : (
        <ChatList
          items={items}
          group
          loading={q.isLoading}
          hasNext={!!q.hasNextPage}
          fetchNext={() => q.fetchNextPage()}
          fetchingNext={q.isFetchingNextPage}
          seenId={null}
          emptyText="Diz olá ao grupo"
          meHandle={user?.username}
          onMenu={setMenuFor}
          onCheer={(m) => void cheer(m)}
          onOpenOnce={(m) => void openOnce(m)}
          onStopLive={(m) => void stopLiveShare(m.id).then(() => q.refetch()).catch(() => undefined)}
          onRetry={() => undefined}
        />
      )}

      {group && (
        <GroupComposer send={(msg) => gruposApi.send(id, msg)} onSent={() => void q.refetch()} bottom={insets.bottom} replyTo={replying} onClearReply={() => setReplying(null)} />
      )}
      {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
      {menuFor && <MessageMenu m={menuFor} onClose={() => setMenuFor(null)} onReply={startReply} onDone={() => void q.refetch()} onError={setErr} />}
      {viewing && (
        <Pressable onPress={() => setViewing(null)} style={st.viewer} accessibilityLabel="Fechar">
          {viewing.url ? <Image source={{ uri: viewing.url }} style={{ flex: 1 }} contentFit="contain" /> : <Text style={{ color: '#fff', fontSize: 20, textAlign: 'center', padding: 24 }}>{viewing.body}</Text>}
          <Text style={{ color: '#fff', textAlign: 'center', paddingBottom: 32 }}>Toca para fechar. Esta mensagem não volta a abrir.</Text>
        </Pressable>
      )}
      {members && group && <GroupInfoSheet group={group} onClose={() => setMembers(false)} onChanged={() => { void q.refetch(); void qc.invalidateQueries({ queryKey: ['chat-groups'] }); }} onLeft={left} />}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  viewer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#000', justifyContent: 'center', zIndex: 50 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.zinc100, paddingHorizontal: 8, paddingVertical: 8 },
  pair: { position: 'absolute', borderRadius: 15, borderWidth: 2, borderColor: colors.white },
  hName: { fontWeight: '700', fontSize: 16, color: colors.zinc900 },
  hSub: { fontSize: 12, color: colors.zinc500 },
  empty: { textAlign: 'center', color: colors.zinc500, paddingVertical: 24 },
  err: { position: 'absolute', left: 0, right: 0, bottom: 88, textAlign: 'center', fontSize: 14, color: colors.red600 },
});
