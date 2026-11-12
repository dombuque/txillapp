import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { abs } from '@/lib/config';
import { useChatVisible } from '@/lib/chatVisible';
import { useAuth } from '@/lib/auth';
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { quoteText, type MenuAt, type MenuMode, type Msg } from '@/components/ChatBubbles';
import { canEdit } from '@/lib/messageMenu';
import { lastMine } from '@/lib/deskChatKeys';
import { useDeskChat } from '@/lib/deskChat';
import { ChatHeader, ChatMenuSheet, ChatSearchSheet, HeaderButton, HeaderStatus } from '@/components/ChatHeader';
import { ChatEditBar } from '@/components/ChatEditBar';
import { confirmClear, TtlBadge, TtlSheet, useLiveItems } from '@/components/ChatTemporary';
import { TTL_TITLE, ttlBadgeLabel } from '@/lib/chatTemporary';
import { clearPending } from '@/lib/chatPending';
import { ChatScreen, useComposerBottom } from '@/components/ChatScreen';
import { ChatList } from '@/components/ChatList';
import { OnceViewer } from '@/components/OnceViewer';
import type { OnceContent } from '@/lib/onceView';
import { MessageMenu, saveEdit, stopLiveShare } from '@/components/ChatParts';
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
import { dateRange, groupKindOf, kindInfo, type TxillGroupInfo, type TxillGroupSummary } from '@/lib/api.groups';
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
  // `info=1` (vindo de "pediu para entrar"): abre logo os detalhes, onde estão os pedidos.
  const { id = '', tab: tabParam, info } = useLocalSearchParams<{ id: string; tab?: string; info?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Com o teclado aberto a barra de escrever fica colada a ele (sem a margem do sistema por baixo).
  const composerBottom = useComposerBottom(insets.bottom);
  const qc = useQueryClient();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const { desktop, labels } = useDesktopSizes();
  // Largura que sobra ao lado da lista de conversas (barra lateral + 380 da lista).
  const side = desktop && width - (labels ? 244 : 76) - 380 >= 760;
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : 'chat');
  const [err, setErr] = useState('');
  // O menu da mensagem (segurar) e, se veio da ação "Apagar" do leitor de ecrã, já na confirmação.
  const [menuFor, setMenuFor] = useState<{ m: Msg; start?: 'delete'; at?: MenuAt; mode?: MenuMode } | null>(null);
  const desk = useDeskChat();
  // A minha mensagem que estou a editar (a barra de escrever passa a ser a de editar).
  const [editing, setEditing] = useState<Msg | null>(null);
  const [replying, setReplying] = useState<{ id: string; text: string; who: string } | null>(null);
  /** Tocar na lista de mensagens fecha os stickers e os menus do compositor (tocar fora fecha). */
  const [closeTick, setCloseTick] = useState(0);
  const composerOpen = useRef(false);
  const onComposerOpen = useCallback((o: boolean) => { composerOpen.current = o; }, []);
  const [viewing, setViewing] = useState<OnceContent | null>(null);
  const [members, setMembers] = useState(info === '1');
  useEffect(() => { if (info === '1') setMembers(true); }, [info, id]);
  const [polling, setPolling] = useState(false);
  const [more, setMore] = useState(false);
  const [ttlOpen, setTtlOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [raised, setRaised] = useState(false);
  // Por ler ao abrir (da lista de TxillGroups, antes de a conversa as marcar como lidas): para o "Mensagens novas".
  const listed = useMemo(() => qc.getQueryData<TxillGroupSummary[]>(['chat-groups'])?.find((g) => g.id === id), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const unread = listed?.unread ?? 0;
  useEffect(() => { if (side && tab === 'plan') setTab('chat'); }, [side, tab]);

  // Só marca como lidas com o grupo mesmo à vista; ao voltar a ele (ecrã, app ou janela), pede outra vez para as ler.
  const visible = useChatVisible(() => void qc.invalidateQueries({ queryKey: ['chat-group', id] }));
  const q = useInfiniteQuery({
    queryKey: ['chat-group', id],
    queryFn: ({ pageParam }) => gruposApi.thread(id, pageParam, !pageParam && visible()),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l: GroupThread) => l.nextCursor ?? undefined,
    refetchInterval: 30_000, // o tempo real faz o trabalho; isto é só uma rede de segurança
    retry: 2,
    retryDelay: (n) => Math.min(400 * 2 ** n, 2000),
    staleTime: 15_000,
  });
  const first = q.data?.pages[0];
  const group = first?.group as TxillGroupInfo | undefined;
  // As mensagens temporárias que expiram com o grupo aberto saem logo (lib/chatTemporary).
  const allItems: Msg[] = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const items = useLiveItems(allItems);
  const ttl = first?.group.ttl ?? null;
  const me = user?.username ?? '';
  const admin = group?.myRole === 'admin';
  const people = (group?.members ?? []).map((m) => ({ username: m.username, displayName: m.displayName, hasAvatar: m.hasAvatar, verified: m.verified, verifiedTier: m.verifiedTier }));

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
      setViewing({ kind: r.kind, url: abs(r.mediaUrl) ?? null, body: r.body });
      void q.refetch();
    } catch (e) {
      Alert.alert('Não consegui abrir', (e as Error).message);
    }
  }
  /** Mensagens temporárias (só quem administra; o servidor confirma): fica o aviso na conversa. */
  async function pickTtl(next: number | null) {
    await gruposApi.setTtl(id, next);
    await q.refetch();
    void qc.invalidateQueries({ queryKey: ['chat-groups'] });
  }
  /** Limpar a conversa do grupo só para mim: some já daqui; o grupo fica na lista com "Sem mensagens". */
  function clearChat() {
    confirmClear(true, () => {
      clearPending(`g:${id}`);
      qc.setQueryData<InfiniteData<GroupThread>>(['chat-group', id], (d) => d && { ...d, pages: d.pages.slice(0, 1).map((p) => ({ ...p, items: [], nextCursor: null })), pageParams: d.pageParams.slice(0, 1) });
      void gruposApi.clear(id)
        .then(() => { void qc.invalidateQueries({ queryKey: ['chat-groups'] }); void qc.invalidateQueries({ queryKey: ['chat-unread'] }); })
        .catch((e) => { setErr((e as Error).message || 'Não consegui limpar a conversa.'); void q.refetch(); });
    });
  }
  function left() {
    void qc.invalidateQueries({ queryKey: ['chat-groups'] });
    router.replace('/messages' as never);
  }

  const when = dateRange(group?.plan?.startsOn, group?.plan?.endsOn);
  // "8 pessoas · Tofo" (o Plano: destino ou datas; sem Plano, o tipo do grupo).
  const count = group ? `${group.members.length} ${group.members.length === 1 ? 'pessoa' : 'pessoas'}` : '';
  const sub = group ? [count, group.plan?.destination || when || kindInfo(groupKindOf(group)).label].filter(Boolean).join(' · ') : '';
  const tabs = TABS.filter((t) => !(side && t.id === 'plan'));

  // Computador: ↑ com a caixa vazia edita a minha última mensagem (se ainda der: texto, até 15 minutos).
  const mineLast = desk ? lastMine(items) : null;
  const editLast = mineLast && canEdit(mineLast) ? mineLast : null;
  const chat = (
    <View style={{ flex: 1, minWidth: 0 }}>
      {q.isError && !group ? (
        <View style={{ alignItems: 'center' }}>
          <Text style={st.empty}>{(q.error as Error).message || 'Não consegui abrir este TxillGroup.'}</Text>
          {/* Quem não está no grupo vê a página pública (se o grupo estiver no mapa ou for público). */}
          <Pressable onPress={() => router.replace(`/g/${id}` as never)} style={st.toPublic} accessibilityRole="link">
            <Text style={st.toPublicText}>Ver a página do grupo</Text>
          </Pressable>
        </View>
      ) : (
        <ChatList
          key={id}
          pendingKey={`g:${id}`}
          onTouch={() => { if (composerOpen.current) setCloseTick((t) => t + 1); }}
          items={items}
          group
          unread={unread}
          onRaised={setRaised}
          emptyArt={group ? <GroupCover url={group.avatarUrl ?? group.coverUrl} kind={groupKindOf(group)} size={80} radius={40} /> : null}
          emptyTitle={group?.name}
          loading={q.isLoading}
          hasNext={!!q.hasNextPage}
          fetchNext={() => q.fetchNextPage()}
          fetchingNext={q.isFetchingNextPage}
          seenId={null}
          emptyText="Ainda não há mensagens. Diz olá à malta do TxillGroup 👋"
          meHandle={user?.username}
          onMenu={(m, at, mode) => setMenuFor({ m, at, mode })}
          onDelete={(m) => setMenuFor({ m, start: 'delete' })}
          onCheer={(m) => void cheer(m)}
          onOpenOnce={(m) => void openOnce(m)}
          onStopLive={(m) => void stopLiveShare(m.id).then(() => q.refetch()).catch(() => undefined)}
          onRetry={() => undefined}
          onReply={startReply}
        />
      )}
      {group && editing ? (
        <ChatEditBar
          key={editing.id}
          original={editing.body}
          bottom={composerBottom}
          onCancel={() => setEditing(null)}
          onSave={async (text) => {
            await saveEdit(qc, ['chat-group', id], editing.id, text);
            setEditing(null);
          }}
        />
      ) : group && (
        <GroupComposer pendingKey={`g:${id}`} closeTick={closeTick} onOpenChange={onComposerOpen} send={(msg) => gruposApi.send(id, msg)} onSent={() => void q.refetch()} bottom={composerBottom} replyTo={replying} onClearReply={() => setReplying(null)} onPoll={() => setPolling(true)} onEditLast={editLast ? () => { setReplying(null); setEditing(editLast); } : undefined} />
      )}
    </View>
  );

  return (
    <GroupCtx.Provider value={group ? { id, me, admin } : null}>
      <ChatScreen style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
        <ChatHeader
          raised={raised || tab !== 'chat'}
          onOpen={group ? () => setMembers(true) : undefined}
          openLabel={group ? `Ver os detalhes de ${group.name}${ttl ? `. ${ttlBadgeLabel(ttl)}` : ''}` : 'TxillGroup'}
          // Enquanto carrega, o nome e a foto vêm da lista de TxillGroups (o cabeçalho não aparece vazio e depois salta).
          avatar={
            <View>
              <GroupCover url={group ? group.avatarUrl ?? group.coverUrl : listed?.avatarUrl ?? listed?.coverUrl} kind={groupKindOf(group ?? listed)} size={36} radius={18} />
              {ttl ? <TtlBadge size={36} /> : null}
            </View>
          }
          title={group?.name ?? listed?.name ?? ''}
          subtitle={group ? <HeaderStatus text={sub} /> : null}
          actions={group ? <HeaderButton label="Mais opções" onPress={() => setMore(true)}><Icon name="more" size={22} color={colors.zinc800} strokeWidth={2.4} /></HeaderButton> : null}
          below={
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
          }
        />

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
        {menuFor && (
          <MessageMenu
            m={menuFor.m}
            start={menuFor.start}
            at={menuFor.at}
            mode={menuFor.mode}
            cacheKey={['chat-group', id]}
            onClose={() => setMenuFor(null)}
            onReply={(m) => { setEditing(null); startReply(m); }}
            onEdit={(m) => { setReplying(null); setEditing(m); }}
            onDone={() => void q.refetch()}
            onError={setErr}
          />
        )}
        {/* Ver uma vez: foto, vídeo, voz ou texto (components/OnceViewer). */}
        {viewing && <OnceViewer content={viewing} onClose={() => setViewing(null)} />}
        {members && group && <GroupInfoSheet group={group} onClose={() => setMembers(false)} onChanged={() => { void q.refetch(); void qc.invalidateQueries({ queryKey: ['chat-groups'] }); }} onLeft={left} />}
        {more && group && (
          <ChatMenuSheet
            onClose={() => setMore(false)}
            items={[
              { icon: 'users', label: 'Detalhes do grupo', onPress: () => setMembers(true) },
              { icon: 'search', label: 'Procurar na conversa', onPress: () => { setTab('chat'); setSearching(true); } },
              // Todos veem como está; só quem administra muda (a folha diz porquê).
              { icon: 'clock', label: TTL_TITLE, onPress: () => setTtlOpen(true) },
              ...(items.length ? [{ icon: 'trash' as const, label: 'Limpar conversa', onPress: () => { setTab('chat'); clearChat(); } }] : []),
            ]}
          />
        )}
        {ttlOpen && group && <TtlSheet ttl={ttl} group canChange={admin} onPick={pickTtl} onClose={() => setTtlOpen(false)} />}
        {searching && (
          <ChatSearchSheet items={items} nameOf={(m) => (m.fromMe ? 'Tu' : m.sender?.displayName ?? '')} hasNext={!!q.hasNextPage} fetchNext={() => void q.fetchNextPage()} onClose={() => setSearching(false)} />
        )}
        {polling && <NewPollSheet groupId={id} onClose={() => { setPolling(false); void q.refetch(); }} />}
      </ChatScreen>
    </GroupCtx.Provider>
  );
}

const st = StyleSheet.create({
  tabs: { flexDirection: 'row', paddingHorizontal: 8 },
  tab: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.zinc900 },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.zinc500 },
  sideCol: { width: 380, borderLeftWidth: 1, borderLeftColor: colors.zinc100, backgroundColor: '#fafafa' },
  sideTitle: { paddingHorizontal: 16, paddingTop: 14, fontSize: 18, fontWeight: '800', color: colors.zinc900, backgroundColor: '#fafafa' },
  empty: { textAlign: 'center', color: colors.zinc500, paddingVertical: 24 },
  toPublic: { height: 40, paddingHorizontal: 18, borderRadius: 999, backgroundColor: colors.zinc100, justifyContent: 'center' },
  toPublicText: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  err: { position: 'absolute', left: 0, right: 0, bottom: 88, textAlign: 'center', fontSize: 14, color: colors.red600 },
});
