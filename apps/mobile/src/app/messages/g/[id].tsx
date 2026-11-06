import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { Bubble, quoteText, type Msg } from '@/components/ChatBubbles';
import { GroupComposer } from '@/components/GroupComposer';
import { GroupInfoSheet } from '@/components/GroupSheets';
import { api } from '@/lib/api';
import { gruposApi, type GroupThread } from '@/lib/api.grupos';
import { colors } from '@/lib/theme';

const JOIN_MS = 120_000; // mensagens da mesma pessoa com menos de 2 min juntam-se

const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
const joined = (a: Msg, b: Msg) => a.sender?.username === b.sender?.username && sameDay(a.at, b.at) && Math.abs(new Date(b.at).getTime() - new Date(a.at).getTime()) < JOIN_MS;

/** Conversa de grupo: bolhas com o nome de quem envia, a mesma barra de escrever e a folha com os membros. */
export default function GroupThreadScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [pending, setPending] = useState<Msg[]>([]);
  const [replying, setReplying] = useState<{ id: string; text: string } | null>(null);
  const [viewing, setViewing] = useState<{ url: string | null; body: string } | null>(null);
  const [members, setMembers] = useState(false);

  const q = useInfiniteQuery({
    queryKey: ['chat-group', id],
    queryFn: ({ pageParam }) => gruposApi.thread(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l: GroupThread) => l.nextCursor ?? undefined,
    refetchInterval: 4000, // rede de segurança; pode baixar quando useChatStream estiver ligado
  });
  const first = q.data?.pages[0];
  const group = first?.group;
  const server: Msg[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  const ids = new Set(server.map((m) => m.id));
  const items: Msg[] = [...pending.filter((p) => !ids.has(p.id)).reverse(), ...server];

  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['chat-unread'] });
    void qc.invalidateQueries({ queryKey: ['chat-groups'] });
  }, [first?.items[0]?.id, qc]);

  async function retry(m: Msg) {
    setPending((p) => p.map((x) => (x.id === m.id ? { ...x, state: 'sending' as const } : x)));
    try {
      await gruposApi.send(id, { body: m.body });
      setPending((p) => p.filter((x) => x.id !== m.id));
      await q.refetch();
    } catch {
      setPending((p) => p.map((x) => (x.id === m.id ? { ...x, state: 'failed' as const } : x)));
    }
  }
  function menu(m: Msg) {
    Alert.alert('Mensagem', undefined, [
      { text: 'Responder', onPress: () => setReplying({ id: m.id, text: quoteText(m.kind, m.body) }) },
      { text: 'Brindar', onPress: () => void api.chatReact(m.id, '🥂').then(() => q.refetch()) },
      ...(m.fromMe ? [{ text: 'Apagar', style: 'destructive' as const, onPress: () => void api.chatDelete(m.id).then(() => q.refetch()) }] : []),
      { text: 'Cancelar', style: 'cancel' as const },
    ]);
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
      <View style={styles.header}>
        <BackButton fallback="/messages" />
        {group && (
          <Pressable onPress={() => setMembers(true)} accessibilityLabel={`Ver membros de ${group.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <View style={{ width: 40, height: 40 }}>
              {group.members.slice(0, 2).map((m, i) => (
                <View key={m.username} style={[styles.pair, i === 0 ? { left: 0, top: 0 } : { right: 0, bottom: 0 }]}>
                  <Avatar name={m.displayName} username={m.hasAvatar ? m.username : undefined} size={26} />
                </View>
              ))}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.hName} numberOfLines={1}>{group.name}</Text>
              <Text style={styles.hSub} numberOfLines={1}>{group.members.length} pessoas · toca para ver</Text>
            </View>
          </Pressable>
        )}
      </View>

      {q.isLoading ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : q.isError && !group ? (
        <Text style={styles.empty}>{(q.error as Error).message || 'Não consegui abrir este grupo.'}</Text>
      ) : (
        <FlatList
          inverted
          data={items}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
          renderItem={({ item, index }) => {
            // Lista invertida: o "anterior" no tempo é o índice seguinte.
            const older = items[index + 1];
            const newer = items[index - 1];
            return <Bubble m={item} group prevSame={!!older && joined(older, item)} nextSame={!!newer && joined(item, newer)} onMenu={menu} onRetry={(m) => void retry(m)} onOpenOnce={(m) => void openOnce(m)} />;
          }}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
          ListEmptyComponent={<Text style={styles.empty}>Diz olá ao grupo</Text>}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {group && (
        <GroupComposer send={(msg) => gruposApi.send(id, msg)} onSent={() => void q.refetch()} bottom={insets.bottom} replyTo={replying} onClearReply={() => setReplying(null)} />
      )}
      {viewing && (
        <Pressable onPress={() => setViewing(null)} style={styles.viewer} accessibilityLabel="Fechar">
          {viewing.url ? <Image source={{ uri: viewing.url }} style={{ flex: 1 }} contentFit="contain" /> : <Text style={{ color: '#fff', fontSize: 20, textAlign: 'center', padding: 24 }}>{viewing.body}</Text>}
          <Text style={{ color: '#fff', textAlign: 'center', paddingBottom: 32 }}>Toca para fechar. Esta mensagem não volta a abrir.</Text>
        </Pressable>
      )}
      {members && group && <GroupInfoSheet group={group} onClose={() => setMembers(false)} onChanged={() => { void q.refetch(); void qc.invalidateQueries({ queryKey: ['chat-groups'] }); }} onLeft={left} />}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  viewer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#000', justifyContent: 'center', zIndex: 50 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.zinc100, paddingHorizontal: 8, paddingVertical: 8 },
  pair: { position: 'absolute', borderRadius: 15, borderWidth: 2, borderColor: colors.white },
  hName: { fontWeight: '700', fontSize: 16, color: colors.zinc900 },
  hSub: { fontSize: 12, color: colors.zinc500 },
  empty: { textAlign: 'center', color: colors.zinc500, paddingVertical: 24 },
});
