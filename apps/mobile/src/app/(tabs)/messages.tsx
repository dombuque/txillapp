import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { closeOpenSwipe, SwipeRow, type SwipeAction } from '@/components/SwipeRow';
import { CallIcon } from '@/components/calls/CallIcons';
import { Icon } from '@/components/Icon';
import { NotesStrip } from '@/components/Notes';
import { REACTIONS } from '@/components/StoryParts';
import { Pulse } from '@/components/ChatParts';
import { Bolt, SuperTxillPanel } from '@/components/SuperTxillPanel';
import { InstantsDock, openZasCamera, zasListScrolling } from '@/components/Instants';
import { PullView, usePullToRefresh } from '@/components/PullToRefresh';
import { api, type ChatMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { listTime, rowLabel, unreadBadge } from '@/lib/inboxRow';

import { callLabel } from '@/components/ChatBubbles';
import { GroupCard, groupCardData } from '@/components/groups/GroupCard';
import type { TxillGroupSummary } from '@/lib/api.groups';
import { kvGet, kvSet } from '@/lib/kv';
import { badgeText, inboxCounts, inboxRows, INBOX_TAB_KEY, nextInboxView, parseInboxTab, tabLabel, type InboxTab, type InboxView } from '@/lib/inboxTabs';
import { gruposApi } from '@/lib/api.grupos';
import { decideSwipe, innerPager, registerInnerPager, type InnerPager } from '@/lib/swipeClaim';
import { FadeCell, fadeCellsIn, useTabSlider } from '@/components/TabSlider';

/** Último separador usado, guardado também em memória para voltar ao ecrã sem piscar "Conversas" antes de ler o kv. */
let lastTab: InboxTab | null = null;

function what(m: { body: string; kind: ChatMessage['kind']; fromMe: boolean }, group = false) {
  const you = m.fromMe ? 'Tu: ' : '';
  if (m.kind === 'image') return `${you}${m.body || 'Foto'}`;
  if (m.kind === 'voice') return `${you}Mensagem de voz`;
  if (m.kind === 'video') return `${you}Vídeo`;
  if (m.kind === 'post') return `${you}Partilhou uma publicação`;
  if (m.kind === 'gift') return `${m.fromMe ? 'Tu: ' : ''}Presente`;
  if (m.kind === 'sticker') return `${you}Sticker`;
  if (m.kind === 'call') return callLabel(m.body, m.fromMe).text;
  if (m.kind === 'location') return `${you}Localização`;
  if ((m.kind as string) === 'poll') return `${you}Sondagem${m.body ? `: ${m.body}` : ''}`;
  if (m.kind === 'story_reaction') return `${m.fromMe ? 'Reagiste ao mimo' : 'Reagiu ao teu mimo'}: ${REACTIONS.find((x) => x.id === m.body)?.label ?? m.body}`;
  if (m.kind === 'story_reply') return `${m.fromMe ? 'Respondeste ao mimo' : 'Respondeu ao teu mimo'}: ${m.body}`;
  if (m.kind === 'zas_reply') return `${m.fromMe ? 'Respondeste ao Zás' : 'Respondeu ao teu Zás'}: ${m.body}`;
  return `${group ? '' : you}${m.body}`;
}

interface Row {
  key: string;
  /** Conversa direta: o @ do outro lado (para as ações de swipe). */
  username?: string;
  to: string;
  name: string;
  sub: string;
  at: string;
  unread: number;
  /** Por ler só porque foi marcada à mão (sem mensagens novas): mostra um ponto e não um número. */
  marked?: boolean;
  names: { name: string; username?: string }[];
  online: boolean;
  group: boolean;
  /** Conversa direta que ainda é um pedido de mensagem (vai para "Pedidos"). */
  request?: boolean;
  /** TxillGroup: aparece como cartão (capa, foto de perfil, Plano) e não como conversa. */
  g?: TxillGroupSummary;
}

function Skeleton() {
  return (
    <Pulse style={{ paddingVertical: 8 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.zinc100 }} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ height: 14, width: '66%', borderRadius: 7, backgroundColor: colors.zinc100 }} />
            <View style={{ height: 12, width: '33%', borderRadius: 6, backgroundColor: colors.zinc100 }} />
          </View>
        </View>
      ))}
    </Pulse>
  );
}

/** Um separador da lista (toque; um deslize grande na lista também passa de um para o outro). O traço desliza (TabSlider). */
function InboxTabButton({ label, n, on, onPress, small, what, onLayout }: { label: string; n: number; on: boolean; onPress: () => void; small: boolean; what?: string; onLayout?: (e: LayoutChangeEvent) => void }) {
  const badge = badgeText(n);
  return (
    <Pressable onPress={onPress} onLayout={onLayout} hitSlop={{ top: 4, bottom: 4, left: 6, right: 6 }} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={tabLabel(label, n, what)} style={styles.tabBtn}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Text style={[styles.tab, small && { fontSize: 15 }, on ? styles.tabOn : styles.tabOff]} numberOfLines={1}>{label}</Text>
        {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
      </View>
    </Pressable>
  );
}

/** Lista de conversas e grupos, com pesquisa e pedidos de mensagem, como no site. */
export default function Messages() {
  // Vindo do "+" com o Zás escolhido: abre a câmara do Zás assim que o ecrã monta.
  const { zas } = useLocalSearchParams<{ zas?: string }>();
  useEffect(() => { if (zas === '1') setTimeout(openZasCamera, 300); }, [zas]);
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Separador ativo: abre no último usado ("Conversas" da primeira vez). Os pedidos não se lembram: são uma visita de passagem.
  const [view, setViewNow] = useState<InboxView>(lastTab ?? 'chats');
  const tapped = useRef(false);
  useEffect(() => {
    if (lastTab) return;
    void kvGet(INBOX_TAB_KEY).then((v) => {
      lastTab = parseInboxTab(v);
      if (!tapped.current) setViewNow(lastTab);
    });
  }, []);
  const setView = (v: InboxView) => {
    tapped.current = true;
    closeOpenSwipe();
    if (v !== view) fadeCellsIn();
    setViewNow(v);
    if (v !== 'requests' && v !== lastTab) { lastTab = v; void kvSet(INBOX_TAB_KEY, v); }
  };
  const [text, setText] = useState('');
  const [ai, setAi] = useState(false);
  const [focus, setFocus] = useState(false);
  const qc = useQueryClient();
  const direct = useQuery({ queryKey: ['chat-list'], queryFn: api.chatList, refetchInterval: 60_000 });
  // Conversas a abrir já carregadas: pré-carrega as 6 mais recentes assim que a lista chega (e ao tocar numa linha).
  const warm = (u: string) => void qc.prefetchInfiniteQuery({ queryKey: ['chat-thread', u], queryFn: ({ pageParam }) => api.chatThread(u, pageParam as string | undefined), initialPageParam: undefined as string | undefined, staleTime: 15_000 }).catch(() => undefined);
  useEffect(() => {
    (direct.data ?? []).slice(0, 6).forEach((c) => warm(c.username));
  }, [direct.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useQuery({ queryKey: ['chat-groups'], queryFn: api.chatGroups, refetchInterval: 60_000 });
  const term = text.trim().toLowerCase().replace(/^@/, '');
  const people = useQuery({ queryKey: ['mentionable', term], queryFn: () => api.mentionable(term), enabled: term.length >= 1, staleTime: 30_000 });

  type DirectList = Awaited<ReturnType<typeof api.chatList>>;
  const patchDirect = (username: string, f: (c: DirectList[number]) => DirectList[number] | null) =>
    qc.setQueryData<DirectList>(['chat-list'], (d) => d?.flatMap((c) => (c.username === username ? (f(c) ?? []) : [c])));
  const refreshUnread = () => void qc.invalidateQueries({ queryKey: ['chat-unread'] });
  /** Deslizar para a direita: marcar como por ler (ou como lida, se já estiver por ler). */
  function rowLeft(r: Row): SwipeAction[] {
    if (r.g) return groupLeft(r.g);
    const u = r.username;
    if (!u) return [];
    return r.unread > 0
      ? [{ label: 'Lida', icon: 'check', color: colors.zinc600, onPress: () => {
          patchDirect(u, (c) => ({ ...c, unread: 0, marked: false }));
          void api.chatThread(u).then(refreshUnread).catch(() => void qc.invalidateQueries({ queryKey: ['chat-list'] }));
        } }]
      : [{ label: 'Por ler', icon: 'mail', color: colors.brand, onPress: () => {
          patchDirect(u, (c) => ({ ...c, unread: 1, marked: true }));
          void api.chatMarkUnread(u).then(refreshUnread).catch(() => void qc.invalidateQueries({ queryKey: ['chat-list'] }));
        } }];
  }
  /** Deslizar para a esquerda: apagar a conversa (pergunta antes). */
  function rowRight(r: Row): SwipeAction[] {
    if (r.g) return groupRight(r.g);
    const u = r.username;
    if (!u) return [];
    return [{ label: 'Apagar', icon: 'trash', color: colors.red600, onPress: () => {
      Alert.alert('Apagar a conversa?', `As mensagens com ${r.name} saem da tua lista. Do lado de lá ficam. Se te escreverem outra vez, a conversa volta.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Apagar', style: 'destructive', onPress: () => {
          patchDirect(u, () => null);
          qc.removeQueries({ queryKey: ['chat-thread', u] });
          void api.chatClear(u).then(refreshUnread).catch(() => { void qc.invalidateQueries({ queryKey: ['chat-list'] }); Alert.alert('Não consegui apagar', 'Tenta outra vez.'); });
        } },
      ]);
    } }];
  }
  const patchGroup = (id: string, f: (g: TxillGroupSummary) => TxillGroupSummary | null) =>
    qc.setQueryData<TxillGroupSummary[]>(['chat-groups'], (d) => d?.flatMap((g) => (g.id === id ? (f(g) ?? []) : [g])));
  /** TxillGroup, deslizar para a direita: marcar como lido (abrir a conversa é o que o marca na API). "Por ler" não existe para grupos. */
  function groupLeft(g: TxillGroupSummary): SwipeAction[] {
    if (!(g.unread > 0)) return [];
    return [{ label: 'Lida', icon: 'check', color: colors.zinc600, onPress: () => {
      patchGroup(g.id, (x) => ({ ...x, unread: 0 }));
      void gruposApi.thread(g.id).then(refreshUnread).catch(() => void qc.invalidateQueries({ queryKey: ['chat-groups'] }));
    } }];
  }
  /** TxillGroup, deslizar para a esquerda: sair do grupo (pergunta antes; o mesmo que "Sair do TxillGroup" na info do grupo). Apagar não existe para grupos. */
  function groupRight(g: TxillGroupSummary): SwipeAction[] {
    const me = user?.username;
    if (!me) return [];
    return [{ label: 'Sair', icon: 'logout', color: colors.red600, onPress: () => {
      Alert.alert('Sair do TxillGroup?', `Deixas de receber as mensagens de “${g.name}”. Só voltas se alguém te adicionar.`, [
        { text: 'Ficar', style: 'cancel' },
        { text: 'Sair', style: 'destructive', onPress: () => {
          patchGroup(g.id, () => null);
          qc.removeQueries({ queryKey: ['chat-group', g.id] });
          void gruposApi.remove(g.id, me).then(refreshUnread).catch(() => { void qc.invalidateQueries({ queryKey: ['chat-groups'] }); Alert.alert('Não consegui sair do TxillGroup', 'Tenta outra vez.'); });
        } },
      ]);
    } }];
  }

  const all: Row[] = [
    ...(direct.data ?? []).map((c): Row => ({
      key: `d:${c.username}`,
      username: c.username,
      to: `/messages/${c.username}`,
      name: c.displayName,
      sub: what(c.lastMessage),
      at: c.lastMessage.at,
      unread: c.unread,
      marked: !!c.marked,
      names: [{ name: c.displayName, username: c.hasAvatar ? c.username : undefined }],
      online: !!c.presence?.online,
      group: false,
      request: !!c.request,
    })),
    ...((groups.data ?? []) as TxillGroupSummary[]).map((g): Row => ({
      key: `g:${g.id}`,
      to: `/messages/g/${g.id}`,
      name: g.name,
      sub: g.lastMessage.empty ? `${g.members} pessoas` : `${g.lastMessage.fromMe ? '' : g.lastMessage.senderName ? `${g.lastMessage.senderName}: ` : ''}${what(g.lastMessage, true)}`,
      at: g.lastMessage.at,
      unread: g.unread,
      names: g.preview.slice(0, 2).map((p) => ({ name: p.displayName, username: p.hasAvatar ? p.username : undefined })),
      online: false,
      group: true,
      g,
    })),
  ];
  const counts = inboxCounts(all);
  const rows = inboxRows(all, view, term);
  // A pesquisar fora dos pedidos: resultados de conversas e TxillGroups juntos (a caixa procura em tudo).
  const searching = !!term && view !== 'requests';
  // Deslize grande para os lados = mudar de separador (lib/swipeClaim, "pager interno"); nas pontas, na web, muda de menu.
  const nav = useRef({ view, searching, setView });
  nav.current = { view, searching, setView };
  useFocusEffect(useCallback(() => {
    const p: InnerPager = {
      canGo: (d) => nextInboxView(nav.current.view, d, nav.current.searching) !== null,
      go: (d) => { const v = nextInboxView(nav.current.view, d, nav.current.searching); if (v) nav.current.setView(v); },
    };
    registerInnerPager(p);
    return () => { if (innerPager() === p) registerInnerPager(null); };
  }, []));
  // Telemóvel: o deslize grande fora das linhas (as linhas tratam o seu em SwipeRow). Pede bem mais para o lado (40 px)
  // do que a linha (14 px) e desiste depressa na vertical, para não roubar o scroll. Na web é em lib/swipeTabs.
  const notesTouch = useRef(false);
  const pagerPan = usePanGesture(useMemo(() => ({
    runOnJS: true,
    maxPointers: 1,
    activeOffsetX: [-40, 40] as [number, number],
    failOffsetY: [-12, 12] as [number, number],
    enabled: Platform.OS !== 'web',
    onDeactivate: (e: { translationX: number; translationY: number; velocityX: number; canceled?: boolean }) => {
      if (e.canceled || notesTouch.current) return; // as notas rolam para o lado: aí o deslize é delas
      const p = innerPager();
      const d = decideSwipe({ dx: e.translationX, dy: e.translationY, vx: e.velocityX, width }, p);
      if (d.to === 'inner' && p) p.go(d.dir);
    },
  }), [width]));
  const slider = useTabSlider<InboxView>(searching ? null : view);
  const small = width < 360;
  const newGroup = () => router.push('/messages/new?group=1' as never);

  const known = new Set((direct.data ?? []).map((c) => c.username.toLowerCase()));
  const strangers = term ? (people.data ?? []).filter((p) => !known.has(p.username.toLowerCase())) : [];
  const loading = direct.isLoading || groups.isLoading;

  const pull = usePullToRefresh(async () => { await Promise.all([direct.refetch(), groups.refetch()]); });
  const header = (
    <View>
      <View style={styles.top}>
        <Text style={styles.handle} numberOfLines={1}>{user?.username ?? 'Mensagens'}</Text>
        <Pressable onPress={() => router.push('/calls' as never)} hitSlop={8} style={[styles.compose, { right: 48 }]} accessibilityRole="button" accessibilityLabel="Chamadas"><CallIcon name="handset" size={22} color={colors.zinc900} /></Pressable>
        <Pressable onPress={() => router.push('/messages/new' as never)} hitSlop={8} style={styles.compose} accessibilityRole="button" accessibilityLabel="Nova conversa ou TxillGroup"><Icon name="compose" size={24} /></Pressable>
      </View>
      <View style={[styles.search, focus && { backgroundColor: 'rgba(228,228,231,0.7)' }]}>
        <Icon name="search" size={18} color={colors.zinc500} />
        <TextInput value={text} onChangeText={setText} placeholder="Procurar pessoas e TxillGroups" placeholderTextColor={colors.zinc500} style={styles.input} accessibilityLabel="Procurar conversas" onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} />
        {text ? <Pressable onPress={() => setText('')} style={styles.sBtn} accessibilityRole="button" accessibilityLabel="Limpar"><Icon name="x" size={16} /></Pressable> : null}
        <Pressable onPress={() => setAi(true)} style={styles.sBtn} accessibilityRole="button" accessibilityLabel="Abrir o SuperTxill"><Bolt size={20} /></Pressable>
      </View>
      {!term && view !== 'requests' && <View onTouchStart={() => { notesTouch.current = true; }}><NotesStrip /></View>}
      <View style={styles.tabs} accessibilityRole="tablist">
        {searching ? (
          <View style={[styles.tabBtn, { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }]}>
            <Text style={[styles.tab, small && { fontSize: 15 }, styles.tabOn]} accessibilityRole="header">Resultados</Text>
            <Text style={styles.searchHint} numberOfLines={1}>conversas e TxillGroups</Text>
          </View>
        ) : (
          <View onLayout={slider.box('main')} style={{ flexDirection: 'row', alignItems: 'center', gap: small ? 14 : 20, flexShrink: 1 }}>
            <InboxTabButton label="Conversas" n={counts.chats} on={view === 'chats'} onPress={() => setView('chats')} small={small} onLayout={slider.layout('chats', 'main')} />
            <InboxTabButton label="TxillGroups" n={counts.groups} on={view === 'groups'} onPress={() => setView('groups')} small={small} onLayout={slider.layout('groups', 'main')} />
          </View>
        )}
        <InboxTabButton label="Pedidos" n={counts.requests} what="à espera" on={view === 'requests'} onPress={() => setView('requests')} small={small} onLayout={slider.layout('requests')} />
        {slider.bar}
      </View>
      {view === 'requests' && <Text style={styles.note}>Mensagens de quem não segues. Só passam para a caixa normal se aceitares. Quem recusas não é avisado.</Text>}
      {view === 'groups' && !searching && rows.length > 0 && (
        <Pressable onPress={newGroup} style={({ pressed }) => [styles.row, styles.newGroup, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel="Novo TxillGroup">
          <View style={styles.newGroupIcon}><Icon name="plus" size={22} color={colors.brand} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>Novo TxillGroup</Text>
            <Text style={[styles.sub, { fontSize: 14 }]} numberOfLines={1}>Viagem, festa ou fim de semana, com Plano e Txills</Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.zinc500} />
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
      <GestureDetector gesture={pagerPan}>
      <View style={{ flex: 1 }} collapsable={false} onTouchStartCapture={() => { notesTouch.current = false; }}>
      <PullView pull={pull}>
      <FlatList
        CellRendererComponent={FadeCell}
        onScrollBeginDrag={closeOpenSwipe}
        onScroll={(e) => { pull.onScroll(e); zasListScrolling(); }}
        scrollEventThrottle={16}
        refreshControl={pull.control}
        data={rows}
        keyExtractor={(r) => r.key}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: r }) => {
          const time = listTime(r.at);
          const badge = unreadBadge(r.unread, r.marked);
          const hot = r.unread > 0;
          return (
          <SwipeRow left={rowLeft(r)} right={rowRight(r)}>
          {r.g ? (
            <GroupCard {...groupCardData(r.g)} lastMessage={r.sub} onPress={() => router.push(r.to as never)} />
          ) : (
          <Pressable onPressIn={() => { const m = /^\/messages\/([^/]+)$/.exec(String(r.to)); if (m && m[1] !== 'new') warm(decodeURIComponent(m[1])); }} onPress={() => router.push(r.to as never)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={rowLabel(r.name, r.sub, time, r.unread, r.marked)}>
            <View>
              {r.unread ? (
                <LinearGradient colors={[colors.brand, '#ff9a5b']} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.ring}>
                  <View style={[styles.ringIn, { backgroundColor: colors.white }]}><Avatar name={r.names[0].name} username={r.names[0].username} size={50} /></View>
                </LinearGradient>
              ) : (
                <View style={styles.ring}><View style={styles.ringIn}><Avatar name={r.names[0].name} username={r.names[0].username} size={56} /></View></View>
              )}
              {r.online && <View style={styles.online} />}
            </View>
            {/* Linha 1: nome e, à direita, a hora. Linha 2: a mensagem e, à direita, quantas por ler. */}
            <View style={styles.text}>
              <View style={styles.line}>
                <Text style={[styles.name, styles.grow, { fontWeight: hot ? '800' : '700' }]} numberOfLines={1}>{r.name}</Text>
                {time ? <Text style={[styles.time, hot && styles.timeHot]} numberOfLines={1}>{time}</Text> : null}
              </View>
              <View style={styles.line}>
                <Text style={[styles.sub, styles.grow, hot && styles.subHot]} numberOfLines={1}>{r.sub}</Text>
                {badge === 'dot' ? <View style={styles.dot} /> : badge ? <View style={styles.count}><Text style={styles.countText}>{badge}</Text></View> : null}
              </View>
            </View>
          </Pressable>
          )}
          </SwipeRow>
          );
        }}
        ListEmptyComponent={
          loading ? <Skeleton /> : strangers.length > 0 ? <View /> : (
            <View style={styles.empty}>
              <Icon name={view === 'groups' && !term ? 'users' : 'messages'} size={44} color={colors.zinc300} />
              <Text style={styles.emptyTitle}>{term ? 'Nada com esse nome' : view === 'requests' ? 'Sem pedidos' : view === 'groups' ? 'Ainda não tens TxillGroups' : 'Ainda sem cochichos'}</Text>
              <Text style={styles.emptySub}>
                {term ? 'Tenta outro nome ou começa uma conversa nova.'
                  : view === 'requests' ? 'Quando alguém que não segues te escrever, aparece aqui.'
                  : view === 'groups' ? 'Cria um para planear uma viagem, uma festa ou um fim de semana com a malta, com Plano e Txills.'
                  : 'Começa uma conversa com alguém que segues. Os TxillGroups estão no separador ao lado.'}
              </Text>
              {!term && view === 'chats' && <Pressable onPress={() => router.push('/messages/new' as never)} style={styles.newBtn} accessibilityRole="button"><Text style={styles.newBtnText}>Nova conversa</Text></Pressable>}
              {!term && view === 'groups' && <Pressable onPress={newGroup} style={styles.newBtn} accessibilityRole="button"><Text style={styles.newBtnText}>Novo TxillGroup</Text></Pressable>}
            </View>
          )
        }
        ListFooterComponent={
          strangers.length > 0 ? (
            <View>
              <Text style={styles.others}>OUTRAS PESSOAS</Text>
              {strangers.map((p) => (
                <Pressable key={p.username} onPress={() => router.push(`/messages/${p.username}` as never)} style={({ pressed }) => [styles.row, { paddingVertical: 10 }, pressed && { backgroundColor: colors.zinc100 }]}>
                  <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={46} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.name, { fontSize: 16 }]} numberOfLines={1}>{p.displayName}</Text>
                    <Text style={[styles.sub, { fontSize: 14 }]} numberOfLines={1}>@{p.username}</Text>
                  </View>
                  <View style={styles.chat}><Text style={styles.chatText}>Conversar</Text></View>
                </Pressable>
              ))}
            </View>
          ) : <View style={{ height: 8 }} />
        }
      />
      </PullView>
      </View>
      </GestureDetector>
      {ai &&<SuperTxillPanel onClose={() => setAi(false)} />}
      <InstantsDock />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  zas: { position: 'absolute', left: 0, top: 2, height: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 10, paddingRight: 12, borderRadius: 999 },
  zasText: { fontSize: 15, fontWeight: '900', letterSpacing: -0.3, color: colors.brand },
  compose: { position: 'absolute', right: 0, top: 2, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  handle: { maxWidth: '54%', fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16, marginBottom: 8 },
  sBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  newBtn: { marginTop: 16, height: 44, borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  newBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, padding: 0, outlineStyle: 'none' } as object,
  tabs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 4, paddingTop: 4, marginBottom: 4 },
  tabBtn: { height: 40, justifyContent: 'center' },
  tab: { fontSize: 17 },
  tabOn: { fontWeight: '800', color: colors.zinc900 },
  tabOff: { fontWeight: '600', color: colors.zinc500 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  searchHint: { flexShrink: 1, fontSize: 14, color: colors.zinc500 },
  newGroup: { paddingVertical: 8, marginBottom: 4 },
  newGroupIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  note: { paddingHorizontal: 4, paddingBottom: 8, fontSize: 13, lineHeight: 18, color: colors.zinc500 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 4, paddingVertical: 12 },
  ring: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  ringIn: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  online: { position: 'absolute', right: 4, bottom: 4, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.white, backgroundColor: '#10b981' },
  name: { fontSize: 17, fontWeight: '600', color: colors.zinc900, flexShrink: 1 },
  sub: { fontSize: 15, color: colors.zinc500 },
  text: { flex: 1, minWidth: 0, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 },
  grow: { flex: 1, minWidth: 0 },
  time: { fontSize: 12, fontWeight: '500', color: colors.zinc500, fontVariant: ['tabular-nums'] },
  timeHot: { color: colors.brand, fontWeight: '700' },
  subHot: { fontWeight: '600', color: colors.zinc900 },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, lineHeight: 15, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: 5, backgroundColor: colors.brand },

  empty: { marginTop: 40, alignItems: 'center', paddingHorizontal: 24 },
  emptyTitle: { marginTop: 12, fontSize: 20, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  emptySub: { marginTop: 4, maxWidth: 320, fontSize: 16, color: colors.zinc600, textAlign: 'center' },
  others: { paddingHorizontal: 4, paddingBottom: 4, paddingTop: 16, fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.zinc500 },
  chat: { borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 6 },
  chatText: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
});
