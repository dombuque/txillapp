import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Alert, KeyboardAvoidingView, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '@/components/BackButton';
import { quoteText, type Msg } from '@/components/ChatBubbles';
import { ChatList } from '@/components/ChatList';
import { MessageMenu, stopLiveShare } from '@/components/ChatParts';
import { GroupComposer } from '@/components/GroupComposer';
import { GroupInfoSheet } from '@/components/GroupSheets';
import { Icon, type IconName } from '@/components/Icon';
import { AlbumPanel } from '@/components/groups/AlbumPanel';
import { GroupCover } from '@/components/groups/GroupParts';
import { PlanPanel } from '@/components/groups/PlanPanel';
import { GroupCtx, NewPollSheet } from '@/components/groups/PollCard';
import { PotPanel } from '@/components/groups/PotPanel';
import { api } from '@/lib/api';
import { gruposApi, type GroupThread } from '@/lib/api.grupos';
import { dateRange, groupKindOf, kindInfo, type TxillGroupInfo } from '@/lib/api.groups';
import { useDesktopSizes } from '@/lib/desktop';
import { colors } from '@/lib/theme';

type Tab = 'chat' | 'plan' | 'album' | 'pot';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'chat', label: 'Conversa', icon: 'messages' },
  { id: 'plan', label: 'Plano', icon: 'calendar' },
  { id: 'album', label: 'Álbum', icon: 'images' },
  { id: 'pot', label: 'Txills', icon: 'wallet' },
];

/**
 * TxillGroup: cabeçalho com a capa, o nome e o tipo, e quatro separadores · Conversa, Plano, Álbum e Txills.
 * No computador largo o Plano fica numa coluna à direita da conversa (e sai dos separadores).
 */
export default function GroupThreadScreen() {
  const { id = '', tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const { desktop, labels } = useDesktopSizes();
  // Largura que sobra ao lado da lista de conversas (barra lateral + 380 da lista).
  const side = desktop && width - (labels ? 244 : 76) - 380 >= 760;
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : 'chat');
  const [err, setErr] = useState('');
  const [menuFor, setMenuFor] = useState<Msg | null>(null);
  const [replying, setReplying] = useState<{ id: string; text: string; who: string } | null>(null);
  const [viewing, setViewing] = useState<{ url: string | null; body: string } | null>(null);
  const [members, setMembers] = useState(false);
  const [polling, setPolling] = useState(false);
  useEffect(() => { if (side && tab === 'plan') setTab('chat'); }, [side, tab]);

  const q = useInfiniteQuery({
    queryKey: ['chat-group', id],
    queryFn: ({ pageParam }) => gruposApi.thread(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l: GroupThread) => l.nextCursor ?? undefined,
    refetchInterval: 30_000, // o tempo real faz o trabalho; isto é só uma rede de segurança
    retry: 2,
    retryDelay: (n) => Math.min(400 * 2 ** n, 2000),
    staleTime: 15_000,
  });
  const first = q.data?.pages[0];
  const group = first?.group as TxillGroupInfo | undefined;
  const items: Msg[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  const me = user?.username ?? '';
  const admin = group?.myRole === 'admin';
  const people = (group?.members ?? []).map((m) => ({ username: m.username, displayName: m.displayName, hasAvatar: m.hasAvatar }));

  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['chat-unread'] });
    void qc.invalidateQueries({ queryKey: ['chat-groups'] });
  }, [first?.items[0]?.id, qc]);
  // Chegou uma foto ou um vídeo novo: o álbum fica a saber.
  useEffect(() => {
    const k = first?.items[0]?.kind;
    if (k === 'image' || k === 'video') void qc.invalidateQueries({ queryKey: ['group-album', id] });
  }, [first?.items[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const when = dateRange(group?.plan?.startsOn, group?.plan?.endsOn);
  const sub = group ? [kindInfo(groupKindOf(group)).label, when ?? `${group.members.length} pessoas`].join(' · ') : '';
  const tabs = TABS.filter((t) => !(side && t.id === 'plan'));

  const chat = (
    <View style={{ flex: 1, minWidth: 0 }}>
      {q.isError && !group ? (
        <Text style={st.empty}>{(q.error as Error).message || 'Não consegui abrir este TxillGroup.'}</Text>
      ) : (
        <ChatList
          items={items}
          group
          loading={q.isLoading}
          hasNext={!!q.hasNextPage}
          fetchNext={() => q.fetchNextPage()}
          fetchingNext={q.isFetchingNextPage}
          seenId={null}
          emptyText="Diz olá à malta do TxillGroup"
          meHandle={user?.username}
          onMenu={setMenuFor}
          onCheer={(m) => void cheer(m)}
          onOpenOnce={(m) => void openOnce(m)}
          onStopLive={(m) => void stopLiveShare(m.id).then(() => q.refetch()).catch(() => undefined)}
          onRetry={() => undefined}
        />
      )}
      {group && (
        <GroupComposer send={(msg) => gruposApi.send(id, msg)} onSent={() => void q.refetch()} bottom={insets.bottom} replyTo={replying} onClearReply={() => setReplying(null)} onPoll={() => setPolling(true)} />
      )}
    </View>
  );

  return (
    <GroupCtx.Provider value={group ? { id, me, admin } : null}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }} behavior="padding">
        <View style={st.header}>
          <BackButton fallback="/messages" style={{ width: 44, height: 44, borderRadius: 22 }} />
          {group && (
            <Pressable onPress={() => setMembers(true)} accessibilityLabel={`Ver membros de ${group.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
              <GroupCover url={group.coverUrl} kind={groupKindOf(group)} size={42} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.hName} numberOfLines={1}>{group.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name={kindInfo(groupKindOf(group)).icon} size={12} color={colors.zinc500} />
                  <Text style={st.hSub} numberOfLines={1}>{sub}</Text>
                </View>
              </View>
            </Pressable>
          )}
        </View>
        <View style={st.tabs} accessibilityRole="tablist">
          {tabs.map((t) => {
            const on = tab === t.id;
            return (
              <Pressable key={t.id} onPress={() => setTab(t.id)} style={[st.tab, on && st.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Icon name={t.icon} size={16} color={on ? colors.zinc900 : colors.zinc500} strokeWidth={on ? 2.3 : 1.8} />
                <Text style={[st.tabText, on && { color: colors.zinc900, fontWeight: '800' }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flex: 1, flexDirection: 'row' }}>
          {tab === 'chat' ? chat : null}
          {tab === 'plan' && group ? <PlanPanel groupId={id} me={me} admin={admin} members={people} /> : null}
          {tab === 'album' ? <AlbumPanel groupId={id} columns={desktop ? 4 : 3} /> : null}
          {tab === 'pot' && group ? <PotPanel groupId={id} me={me} admin={admin} /> : null}
          {side && tab === 'chat' && group ? (
            <View style={st.sideCol} accessibilityLabel="Plano">
              <Text style={st.sideTitle}>Plano</Text>
              <PlanPanel groupId={id} me={me} admin={admin} members={people} />
            </View>
          ) : null}
        </View>

        {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
        {menuFor && <MessageMenu m={menuFor} onClose={() => setMenuFor(null)} onReply={startReply} onDone={() => void q.refetch()} onError={setErr} />}
        {viewing && (
          <Pressable onPress={() => setViewing(null)} style={st.viewer} accessibilityLabel="Fechar">
            {viewing.url ? <Image source={{ uri: viewing.url }} style={{ flex: 1 }} contentFit="contain" /> : <Text style={{ color: '#fff', fontSize: 20, textAlign: 'center', padding: 24 }}>{viewing.body}</Text>}
            <Text style={{ color: '#fff', textAlign: 'center', paddingBottom: 32 }}>Toca para fechar. Esta mensagem não volta a abrir.</Text>
          </Pressable>
        )}
        {members && group && <GroupInfoSheet group={group} onClose={() => setMembers(false)} onChanged={() => { void q.refetch(); void qc.invalidateQueries({ queryKey: ['chat-groups'] }); }} onLeft={left} />}
        {polling && <NewPollSheet groupId={id} onClose={() => { setPolling(false); void q.refetch(); }} />}
      </KeyboardAvoidingView>
    </GroupCtx.Provider>
  );
}

const st = StyleSheet.create({
  viewer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#000', justifyContent: 'center', zIndex: 50 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 8 },
  hName: { fontWeight: '700', fontSize: 16, color: colors.zinc900 },
  hSub: { fontSize: 12, color: colors.zinc500, flexShrink: 1 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.zinc100, paddingHorizontal: 8 },
  tab: { flex: 1, height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.zinc900 },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.zinc500 },
  sideCol: { width: 380, borderLeftWidth: 1, borderLeftColor: colors.zinc100, backgroundColor: '#fafafa' },
  sideTitle: { paddingHorizontal: 16, paddingTop: 14, fontSize: 18, fontWeight: '800', color: colors.zinc900, backgroundColor: '#fafafa' },
  empty: { textAlign: 'center', color: colors.zinc500, paddingVertical: 24 },
  err: { position: 'absolute', left: 0, right: 0, bottom: 88, textAlign: 'center', fontSize: 14, color: colors.red600 },
});
