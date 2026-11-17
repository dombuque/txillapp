import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { NameWithBadge } from '@/components/NameWithBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { closeOpenSwipe, rowHold, SwipeRow, type SwipeAction } from '@/components/SwipeRow';
import { InboxMenuSheet } from '@/components/InboxMenuSheet';
import { GroupCover } from '@/components/groups/GroupParts';
import { a11yToAction, actionIcon, inboxA11yActions, inboxDeskMenuItems, inboxMenu, inboxMenuItems, inboxSwipe, swipeLabel, type InboxAction, type InboxMenuRow } from '@/lib/inboxMenu';
import { CallIcon } from '@/components/calls/CallIcons';
import { DeskMenu } from '@/components/DeskMenu';
import { Sheet } from '@/components/Sheet';
import { confirmClear, TtlSheet } from '@/components/ChatTemporary';
import { deskZone, isMac, typingNow, useDeskChat, useDeskChatChrome } from '@/lib/deskChat';
import { inboxShortcut, neighbourChat, openChatPath, shortcutHelp } from '@/lib/deskChatKeys';
import { clearPending } from '@/lib/chatPending';
import { Icon } from '@/components/Icon';
import { NotesStrip } from '@/components/Notes';
import { REACTIONS } from '@/components/StoryParts';
import { Pulse } from '@/components/ChatParts';
import { Bolt } from '@/components/SuperTxillPanel';
import { InstantsDock, openZasCamera, zasListScrolling } from '@/components/Instants';
import { PullView, usePullToRefresh } from '@/components/PullToRefresh';
import { api, type Badged, type ChatMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirm } from '@/lib/confirm';
import { colors } from '@/lib/theme';
import { groupSenderPrefix, listTime, rowLabel, unreadBadge } from '@/lib/inboxRow';
import { systemText } from '@/lib/screenshotNotice';
import { emptyPreview } from '@/lib/chatTemporary';
import { inboxFailed } from '@/lib/chatErrors';
import { PendingConvs } from '@/components/PendingConvs';

import { callLabel } from '@/components/ChatBubbles';
import { GroupCard, groupCardData } from '@/components/groups/GroupCard';
import type { TxillGroupSummary } from '@/lib/api.groups';
import { kvGet, kvSet } from '@/lib/kv';
import { remindPush } from '@/components/PushReminder';
import { badgeText, inboxCounts, inboxRows, INBOX_TAB_KEY, nextInboxView, parseInboxTab, tabLabel, type InboxTab, type InboxView } from '@/lib/inboxTabs';
import { gruposApi } from '@/lib/api.grupos';
import { innerPager, registerInnerPager, type InnerPager } from '@/lib/swipeClaim';
import { FadeCell, fadeCellsIn, useTabSlider } from '@/components/TabSlider';
import { usePagerPan } from '@/components/SwipePager';
import { useTabPress } from '@/lib/tabPress';
import { useOpenMixar } from '@/components/mixar/useOpenMixar';
import { mixarPreview, mixarShowDot } from '@/lib/mixar';
import { useMixarSeen } from '@/lib/mixarSeen';
import { groupShowDot } from '@/lib/mixarGrupo';
import { MixarEntry, useMixarList } from '@/components/mixar/MixarEntry';
import { MixarDot } from '@/components/mixar/MixarBits';
import { useChatHiding } from '@/components/ChatHide';
import { ChatMenuSheet } from '@/components/ChatHeader';
import { HIDDEN_PATH, HIDDEN_TITLE } from '@/lib/chatHidden';
import { t } from '@/lib/i18n';

/** Último separador usado, guardado também em memória para voltar ao ecrã sem piscar "Conversas" antes de ler o kv. */
let lastTab: InboxTab | null = null;

/** O texto da última mensagem numa linha da lista (também nas «Conversas ocultas», app/messages/escondidas). */
export function what(m: { body: string; kind: ChatMessage['kind']; fromMe: boolean }, group = false) {
  const you = m.fromMe ? (t('Tu:') + ' ') : '';
  if (m.kind === 'image') return `${you}${m.body || t('Foto')}`;
  if (m.kind === 'voice') return t('{you}Mensagem de voz', { you });
  if (m.kind === 'video') return t('{you}Vídeo', { you });
  if (m.kind === 'post') return m.fromMe ? t('Partilhaste uma publicação') : t('Partilhou uma publicação');
  if (m.kind === 'gift') return t('{value}Presente', { value: m.fromMe ? (t('Tu:') + ' ') : '' });
  if (m.kind === 'sticker') return t('{you}Sticker', { you });
  if (m.kind === 'gif') return `${you}GIF`;
  if (m.kind === 'call') return callLabel(m.body, m.fromMe).text;
  // Aviso de sistema ("Ligaste as mensagens temporárias: 7 dias.", "Ana fez uma captura de ecrã."): o servidor já
  // manda o texto para quem o vê.
  if (m.kind === 'system') return systemText(m);
  if (m.kind === 'location') return t('{you}Localização', { you });
  // «Paga-me uma» e rodadas (0145): o servidor já manda um texto legível ("Paga-me uma 2M 🍺"); sem ele, um genérico.
  if (m.kind === 'gelada') return `${you}${m.body || 'Paga-me uma'}`;
  if (m.kind === 'rodada') return `${you}${m.body || t('Abriu uma rodada')}`;
  // Mixar: «Convidou-te para um Mixar» / «Convidaste para um Mixar» (sempre para quem vê, lib/mixar).
  if (m.kind === 'mixar') return mixarPreview(m);
  if ((m.kind as string) === 'poll') return t('{you}Sondagem{value}', { you, value: m.body ? `: ${m.body}` : '' });
  if (m.kind === 'story_reaction') return `${m.fromMe ? t('Reagiste ao mimo') : t('Reagiu ao teu mimo')}: ${REACTIONS.find((x) => x.id === m.body)?.label ?? m.body}`;
  if (m.kind === 'story_reply') return `${m.fromMe ? t('Respondeste ao mimo') : t('Respondeu ao teu mimo')}: ${m.body}`;
  if (m.kind === 'zas_reply') return `${m.fromMe ? t('Respondeste ao Zás') : t('Respondeu ao teu Zás')}: ${m.body}`;
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
  /** Conversa direta: o selo de verificado do outro lado. */
  who?: Badged;
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
  // Tocar outra vez em Mensagens (já nas Mensagens): volta ao topo da lista, como no Início.
  const listRef = useRef<FlatList>(null);
  useTabPress('messages', () => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
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
  const [focus, setFocus] = useState(false);
  const qc = useQueryClient();
  const direct = useQuery({ queryKey: ['chat-list'], queryFn: api.chatList, refetchInterval: 60_000 });
  // Conversas a abrir já carregadas: pré-carrega as 6 mais recentes assim que a lista chega (e ao tocar numa linha).
  const warm = (u: string) => void qc.prefetchInfiniteQuery({ queryKey: ['chat-thread', u], queryFn: ({ pageParam }) => api.chatThread(u, pageParam as string | undefined, false), initialPageParam: undefined as string | undefined, staleTime: 15_000 }).catch(() => undefined);
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
  const patchGroup = (id: string, f: (g: TxillGroupSummary) => TxillGroupSummary | null) =>
    qc.setQueryData<TxillGroupSummary[]>(['chat-groups'], (d) => d?.flatMap((g) => (g.id === id ? (f(g) ?? []) : [g])));

  // As ações de uma linha. As mesmas funções servem o deslizar (rowLeft/rowRight), a folha de segurar e o leitor de
  // ecrã; quais aparecem em cada linha e em cada estado decide-o lib/inboxMenu.
  /** Conversa a dois: marcar como lida (abrir a conversa é o que a marca na API). */
  function markRead(u: string) {
    patchDirect(u, (c) => ({ ...c, unread: 0, marked: false }));
    void api.chatThread(u).then(refreshUnread).catch(() => void qc.invalidateQueries({ queryKey: ['chat-list'] }));
  }
  /** Conversa a dois: marcar como por ler (um ponto em vez de um número). */
  function markUnread(u: string) {
    patchDirect(u, (c) => ({ ...c, unread: 1, marked: true }));
    void api.chatMarkUnread(u).then(refreshUnread).catch(() => void qc.invalidateQueries({ queryKey: ['chat-list'] }));
  }
  /** Conversa a dois: apagar a conversa (pergunta antes). */
  async function deleteChat(u: string, name: string) {
    if (!(await confirm({ title: t('Apagar a conversa?'), message: t('As mensagens com {name} saem da tua lista. Do lado de lá ficam. Se te escreverem outra vez, a conversa volta.', { name }), confirm: t('Apagar'), danger: true }))) return;
    patchDirect(u, () => null);
    qc.removeQueries({ queryKey: ['chat-thread', u] });
    void api.chatClear(u).then(refreshUnread).catch(() => { void qc.invalidateQueries({ queryKey: ['chat-list'] }); Alert.alert(t('Não consegui apagar'), t('Tenta outra vez.')); });
  }
  /** TxillGroup: marcar como lido (abrir a conversa é o que o marca na API). "Por ler" não existe para grupos. */
  function groupRead(g: TxillGroupSummary) {
    patchGroup(g.id, (x) => ({ ...x, unread: 0 }));
    void gruposApi.thread(g.id).then(refreshUnread).catch(() => void qc.invalidateQueries({ queryKey: ['chat-groups'] }));
  }
  /** TxillGroup: sair do grupo (pergunta antes; o mesmo que "Sair do TxillGroup" na info do grupo). Apagar não existe para grupos. */
  async function leaveGroup(g: TxillGroupSummary, me: string) {
    if (!(await confirm({ title: t('Sair do TxillGroup?'), message: t('Deixas de receber as mensagens de «{name}». Só voltas se alguém te adicionar.', { name: g.name }), confirm: t('Sair'), cancel: t('Ficar'), danger: true }))) return;
    patchGroup(g.id, () => null);
    qc.removeQueries({ queryKey: ['chat-group', g.id] });
    void gruposApi.remove(g.id, me).then(refreshUnread).catch(() => { void qc.invalidateQueries({ queryKey: ['chat-groups'] }); Alert.alert(t('Não consegui sair do TxillGroup'), t('Tenta outra vez.')); });
  }
  /** Conversa a dois: limpar só para mim (pergunta antes; a conversa fica na lista, vazia). O mesmo que na conversa aberta. */
  function clearChat(u: string) {
    confirmClear(false, () => {
      clearPending(`u:${u}`);
      qc.removeQueries({ queryKey: ['chat-thread', u] });
      patchDirect(u, (c) => ({ ...c, unread: 0, marked: false, lastMessage: { ...c.lastMessage, body: '', empty: true } }));
      void api.chatClearKeep(u)
        .then(() => { void qc.invalidateQueries({ queryKey: ['chat-list'] }); refreshUnread(); })
        .catch(() => { void qc.invalidateQueries({ queryKey: ['chat-list'] }); Alert.alert(t('Não consegui limpar a conversa'), t('Tenta outra vez.')); });
    });
  }
  /** Mensagens temporárias de uma conversa a partir da lista (computador): a mesma folha da conversa aberta. */
  const [ttlFor, setTtlFor] = useState<{ username: string; ttl: number | null } | null>(null);
  async function pickTtl(u: string, next: number | null) {
    await api.chatSetTtl(u, next);
    void qc.invalidateQueries({ queryKey: ['chat-thread', u] });
    void qc.invalidateQueries({ queryKey: ['chat-list'] });
  }
  const menuRow = (r: Row): InboxMenuRow => ({ group: !!r.g, unread: r.unread, username: r.username, me: user?.username, request: r.request, mixar: !r.g, name: r.name });
  const mixar = useOpenMixar();
  // Mixar com novidades (sugestões de hoje por ver, o desafio ou um convite): o ícone com a bolinha azul na linha da conversa.
  const mixarList = useMixarList();
  const mixarSeen = useMixarSeen();
  const mixarNew = new Set((mixarList.data?.items ?? []).filter((s) => mixarShowDot(s, mixarSeen[s.id])).map((s) => s.partner.username));
  // Mixar de grupo (0173): a mesma bolinha na linha do grupo (convite por responder ou novidades de hoje, até abrir).
  const mixarGroupNew = new Set((mixarList.data?.groups ?? []).filter((s) => groupShowDot(s, mixarSeen[s.id])).map((s) => s.group.groupId));
  // Esconder a conversa (sai da lista e do contador; fica em «Conversas ocultas», no "⋯" de cima).
  const hiding = useChatHiding();
  const [moreOpen, setMoreOpen] = useState(false);
  /** Correr uma ação numa linha (do deslizar, da folha ou do leitor de ecrã). */
  function runAction(a: InboxAction, r: Row) {
    const me = user?.username;
    if (r.g) {
      if (a === 'hide') hiding.hide({ groupId: r.g.id }, r.name);
      else if (a === 'read') groupRead(r.g);
      else if (a === 'info') router.push(`/messages/g/${r.g.id}?info=1` as never);
      else if (a === 'leave' && me) leaveGroup(r.g, me);
      return;
    }
    const u = r.username;
    if (!u) return;
    if (a === 'read') markRead(u);
    else if (a === 'unread') markUnread(u);
    else if (a === 'profile') router.push(`/u/${u}` as never);
    else if (a === 'delete') deleteChat(u, r.name);
    else if (a === 'clear') clearChat(u);
    else if (a === 'mixar') void mixar.run(u, r.name);
    else if (a === 'hide') hiding.hide({ username: u }, r.name);
    else if (a === 'ttl') setTtlFor({ username: u, ttl: direct.data?.find((c) => c.username === u)?.ttl ?? null });
  }
  const SWIPE_COLOR: Record<InboxAction, string> = { read: colors.zinc600, unread: colors.brand, profile: colors.zinc600, delete: colors.red600, info: colors.zinc600, leave: colors.red600, ttl: colors.zinc600, clear: colors.red600, mixar: colors.brand, hide: colors.zinc600, unhide: colors.zinc600 };
  const swipeButtons = (acts: InboxAction[], r: Row): SwipeAction[] =>
    acts.map((a) => ({ label: swipeLabel(a), icon: actionIcon(a), color: SWIPE_COLOR[a], onPress: () => runAction(a, r) }));
  /** Deslizar para a direita: marcar como por ler (ou como lida, se já estiver por ler); num TxillGroup, lido. */
  const rowLeft = (r: Row) => swipeButtons(inboxSwipe(menuRow(r)).left, r);
  /** Deslizar para a esquerda: apagar a conversa; num TxillGroup, sair (os dois perguntam antes). */
  const rowRight = (r: Row) => swipeButtons(inboxSwipe(menuRow(r)).right, r);

  // Segurar uma linha: a folha com a foto, o nome e as ações (lib/inboxMenu). Guarda-se a chave: se a linha sair da
  // lista entretanto (apagada noutro sítio), a folha fecha-se sozinha.
  const [menuKey, setMenuKey] = useState<string | null>(null);
  function openMenu(r: Row, buzz = false) {
    if (!inboxMenu(menuRow(r)).length) return;
    closeOpenSwipe();
    if (buzz && Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setMenuKey(r.key);
  }
  const closeMenu = () => {
    setMenuKey(null);
    closeOpenSwipe(); // se o dedo ainda deslizou a linha por baixo da folha, ela não fica aberta
  };
  function pickMenu(a: InboxAction | 'cancel', r: Row) {
    closeMenu();
    if (a === 'cancel') return;
    // No iPhone, um Alert pedido enquanto a folha (Modal) ainda se fecha não chega a aparecer: espera um pouco.
    if (Platform.OS === 'ios') setTimeout(() => runAction(a, r), 350);
    else runAction(a, r);
  }
  /** Computador: o menu de contexto da linha ("⋯" ou botão direito), no sítio pedido. */
  const [deskMenu, setDeskMenu] = useState<{ key: string; at: { x: number; y: number } } | null>(null);
  /** O leitor de ecrã: as mesmas ações e "Mais opções", que abre a folha. */
  function a11yAction(name: string, r: Row) {
    const a = a11yToAction(name, menuRow(r));
    if (a === 'more') openMenu(r);
    else if (a) runAction(a, r);
  }

  const all: Row[] = [
    ...(direct.data ?? []).map((c): Row => ({
      key: `d:${c.username}`,
      username: c.username,
      to: `/messages/${c.username}`,
      name: c.displayName,
      sub: emptyPreview(c.lastMessage) ?? what(c.lastMessage),
      at: c.lastMessage.at,
      unread: c.unread,
      marked: !!c.marked,
      names: [{ name: c.displayName, username: c.hasAvatar ? c.username : undefined }],
      who: c,
      online: !!c.presence?.online,
      group: false,
      request: !!c.request,
    })),
    ...((groups.data ?? []) as TxillGroupSummary[]).map((g): Row => ({
      key: `g:${g.id}`,
      to: `/messages/g/${g.id}`,
      name: g.name,
      sub: emptyPreview(g.lastMessage, { members: g.members }) ?? `${groupSenderPrefix(g.lastMessage)}${what(g.lastMessage, true)}`,
      at: g.lastMessage.at,
      unread: g.unread,
      names: g.preview.slice(0, 2).map((p) => ({ name: p.displayName, username: p.hasAvatar ? p.username : undefined })),
      online: false,
      group: true,
      g,
    })),
  ];
  /** A linha da folha de segurar (some se a linha sair da lista). */
  const held = menuKey ? all.find((r) => r.key === menuKey) : undefined;
  const gone = !!menuKey && !held;
  useEffect(() => { if (gone) setMenuKey(null); }, [gone]);
  const deskRow = deskMenu ? all.find((r) => r.key === deskMenu.key) : undefined;
  const deskGone = !!deskMenu && !deskRow;
  useEffect(() => { if (deskGone) setDeskMenu(null); }, [deskGone]);
  const counts = inboxCounts(all);
  const rows = inboxRows(all, view, term);
  // A pesquisar fora dos pedidos: resultados de conversas e TxillGroups juntos (a caixa procura em tudo).
  const searching = !!term && view !== 'requests';
  // Deslize grande para os lados = mudar de separador (lib/swipeClaim, "pager interno"); nas pontas, na web, muda de menu.
  const nav = useRef({ view, searching, setView });
  nav.current = { view, searching, setView };
  // Abriu a lista de Mensagens: bom momento para lembrar, se as notificações estiverem desligadas neste aparelho.
  useFocusEffect(useCallback(() => { remindPush('inbox'); }, []));
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
  // (components/SwipePager, o mesmo pan do Perfil.) As notas rolam para o lado: aí o deslize é delas.
  const notesTouch = useRef(false);
  const pagerPan = usePagerPan({ width, pager: innerPager, skip: () => notesTouch.current });
  const slider = useTabSlider<InboxView>(searching ? null : view);
  const small = width < 360;
  const newGroup = () => router.push('/messages/new?group=1' as never);

  const known = new Set((direct.data ?? []).map((c) => c.username.toLowerCase()));
  const strangers = term ? (people.data ?? []).filter((p) => !known.has(p.username.toLowerCase())) : [];
  const loading = direct.isLoading || groups.isLoading;
  const failed = inboxFailed(view, searching, { isError: direct.isError, hasData: !!direct.data }, { isError: groups.isError, hasData: !!groups.data });
  const retrying = direct.isFetching || groups.isFetching;

  const pull = usePullToRefresh(async () => { await Promise.all([direct.refetch(), groups.refetch()]); });

  // Computador (rato e teclado, lib/deskChat): atalhos, foco visível e tooltips. No telemóvel nada disto corre.
  const desk = useDeskChat();
  useDeskChatChrome(desk);
  const pathname = usePathname();
  const openPath = desk ? openChatPath(pathname) : null;
  const [help, setHelp] = useState(false);
  const searchRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const rootRef = useRef<React.ComponentRef<typeof View>>(null);
  const keys = useRef({ rows, openPath });
  keys.current = { rows, openPath };
  useEffect(() => {
    if (!desk || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      // No computador as Mensagens podem estar montadas duas vezes (a coluna da lista e o separador escondido): só a visível responde.
      const el = rootRef.current as unknown as HTMLElement | null;
      if (!el || !el.isConnected || el.offsetParent === null) return;
      if (document.querySelector('[aria-modal="true"]')) return; // com uma folha ou um menu aberto, as teclas são deles
      const a = inboxShortcut(e, { typing: typingNow() });
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      if (a === 'search') { searchRef.current?.focus(); return; }
      if (a === 'help') { setHelp(true); return; }
      const paths = keys.current.rows.map((r) => r.to);
      const to = neighbourChat(paths, keys.current.openPath, a === 'next' ? 1 : -1);
      if (!to) return;
      if (keys.current.openPath) router.replace(to as never);
      else router.push(to as never);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [desk, router]);
  const header = (
    <View>
      <View style={styles.top}>
        <Text style={styles.handle} numberOfLines={1}>{user?.username ?? t('Mensagens')}</Text>
        <Pressable onPress={() => router.push('/calls' as never)} hitSlop={8} style={[styles.compose, { right: 48 }]} accessibilityRole="button" accessibilityLabel={t('Chamadas')}><CallIcon name="handset" size={22} color={colors.zinc900} /></Pressable>
        <Pressable onPress={() => router.push('/messages/new' as never)} hitSlop={8} style={styles.compose} accessibilityRole="button" accessibilityLabel={t('Nova conversa ou TxillGroup')}><Icon name="compose" size={24} /></Pressable>
        {/* "⋯": «Conversas ocultas» (e, no computador, os atalhos do teclado). */}
        <Pressable onPress={() => setMoreOpen(true)} hitSlop={8} style={[styles.compose, { right: undefined, left: 0 }]} accessibilityRole="button" accessibilityLabel={t('Mais opções das mensagens')}><Icon name="more" size={22} color={colors.zinc800} strokeWidth={2.4} /></Pressable>
        {desk ? <Pressable onPress={() => setHelp(true)} hitSlop={8} style={[styles.compose, { right: undefined, left: 48 }]} accessibilityRole="button" accessibilityLabel={t('Atalhos do teclado (?)')}><Icon name="info" size={22} color={colors.zinc700} /></Pressable> : null}
      </View>
      <View style={[styles.search, focus && { backgroundColor: 'rgba(228,228,231,0.7)' }]}>
        <Icon name="search" size={18} color={colors.zinc500} />
        <TextInput
          ref={searchRef}
          value={text}
          onChangeText={setText}
          placeholder={desk ? t('Procurar ({value}K)', { value: isMac() ? '⌘' : t('Ctrl+') }) : t('Procurar pessoas e TxillGroups')}
          placeholderTextColor={colors.zinc500}
          style={styles.input}
          accessibilityLabel={t('Procurar conversas')}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          // Computador: Esc sai da pesquisa (limpa e larga a caixa).
          onKeyPress={desk ? (e) => { if ((e.nativeEvent as { key?: string }).key === 'Escape') { e.preventDefault(); setText(''); searchRef.current?.blur(); } } : undefined}
        />
        {text ? <Pressable onPress={() => setText('')} style={styles.sBtn} accessibilityRole="button" accessibilityLabel={t('Limpar')}><Icon name="x" size={16} /></Pressable> : null}
        <Pressable onPress={() => router.push('/supertxill' as never)} style={styles.sBtn} accessibilityRole="button" accessibilityLabel={t('Abrir o SuperTxill')}><Bolt size={20} /></Pressable>
      </View>
      {!term && view !== 'requests' && <View onTouchStart={() => { notesTouch.current = true; }}><NotesStrip /></View>}
      {/* Mixar: uma linha discreta por cima dos separadores, só quando algum Mixar tem novidades (a bolinha azul); sem novidades, nada. */}
      {!term && view !== 'requests' ? <MixarEntry /> : null}
      <View style={styles.tabs} accessibilityRole="tablist">
        {searching ? (
          <View style={[styles.tabBtn, { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }]}>
            <Text style={[styles.tab, small && { fontSize: 15 }, styles.tabOn]} accessibilityRole="header">{t('Resultados')}</Text>
            <Text style={styles.searchHint} numberOfLines={1}>{t('conversas e TxillGroups')}</Text>
          </View>
        ) : (
          <View onLayout={slider.box('main')} style={{ flexDirection: 'row', alignItems: 'center', gap: small ? 14 : 20, flexShrink: 1 }}>
            <InboxTabButton label={t('Conversas')} n={counts.chats} on={view === 'chats'} onPress={() => setView('chats')} small={small} onLayout={slider.layout('chats', 'main')} />
            <InboxTabButton label="TxillGroups" n={counts.groups} on={view === 'groups'} onPress={() => setView('groups')} small={small} onLayout={slider.layout('groups', 'main')} />
          </View>
        )}
        <InboxTabButton label={t('Pedidos')} n={counts.requests} what={t('à espera')} on={view === 'requests'} onPress={() => setView('requests')} small={small} onLayout={slider.layout('requests')} />
        {slider.bar}
      </View>
      {view === 'requests' && <Text style={styles.note}>{t('Mensagens de quem não segues. Só passam para a caixa normal se aceitares. Quem recusas não é avisado.')}</Text>}
      {view === 'groups' && !searching && rows.length > 0 && (
        <Pressable onPress={newGroup} style={({ pressed }) => [styles.row, styles.newGroup, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={t('Novo TxillGroup')}>
          <View style={styles.newGroupIcon}><Icon name="plus" size={22} color={colors.brand} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>{t('Novo TxillGroup')}</Text>
            <Text style={[styles.sub, { fontSize: 14 }]} numberOfLines={1}>{t('Viagem, festa ou fim de semana, com Plano e vibes')}</Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.zinc500} />
        </Pressable>
      )}
    </View>
  );

  return (
    <View ref={rootRef} {...deskZone(desk)} style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
      <GestureDetector gesture={pagerPan}>
      <View style={{ flex: 1 }} collapsable={false} onTouchStartCapture={() => { notesTouch.current = false; }}>
      <PullView pull={pull}>
      <FlatList
        ref={listRef}
        CellRendererComponent={FadeCell}
        onScrollBeginDrag={closeOpenSwipe}
        onScroll={(e) => { pull.onScroll(e); zasListScrolling(); }}
        scrollEventThrottle={16}
        refreshControl={pull.control}
        data={rows}
        keyExtractor={(r) => r.key}
        // Na web (sobretudo no PWA do iPhone) a FlatList nem sempre recebe o scroll: ficava nas primeiras 10 linhas e o que
        // o «Ver mais» trazia nunca aparecia. Na web desenham-se logo todas as que já vieram (como no feed).
        initialNumToRender={Platform.OS === 'web' ? 200 : 12}
        windowSize={Platform.OS === 'web' ? 201 : 11}
        disableVirtualization={Platform.OS === 'web'}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: r }) => {
          const time = listTime(r.at);
          const badge = unreadBadge(r.unread, r.marked);
          const hot = r.unread > 0;
          // Segurar (e o botão direito do rato, na web) abre a folha; o leitor de ecrã tem as mesmas ações.
          const hold = inboxMenu(menuRow(r)).length ? () => openMenu(r, true) : undefined;
          const a11y = inboxA11yActions(menuRow(r));
          return (
          <SwipeRow left={[]} right={[]} onHold={hold} active={!!openPath && r.to === openPath} onDeskMenu={hold ? (at) => setDeskMenu({ key: r.key, at }) : undefined}>
          {r.g ? (
            <GroupCard {...groupCardData(r.g)} mixarNew={mixarGroupNew.has(r.g.id)} lastMessage={r.sub} onPress={() => router.push(r.to as never)} {...rowHold(hold)} accessibilityActions={a11y} onAccessibilityAction={(name) => a11yAction(name, r)} />
          ) : (
          <Pressable
            onPressIn={() => { const m = /^\/messages\/([^/]+)$/.exec(String(r.to)); if (m && m[1] !== 'new') warm(decodeURIComponent(m[1])); }}
            onPress={() => router.push(r.to as never)}
            {...rowHold(hold)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.zinc100 }]}
            accessibilityRole="button"
            accessibilityLabel={rowLabel(r.name, r.sub, time, r.unread, r.marked)}
            accessibilityHint={a11y.length ? (desk ? t('Clica para abrir. Botão direito para mais opções.') : t('Toca para abrir. Mantém premido para mais opções.')) : undefined}
            accessibilityActions={a11y.length ? a11y : undefined}
            onAccessibilityAction={a11y.length ? (e) => a11yAction(e.nativeEvent.actionName, r) : undefined}
          >
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
                <NameWithBadge name={r.name} who={r.who} style={[styles.name, { fontWeight: hot ? '800' : '700' }]} containerStyle={styles.grow} />
                {time ? <Text style={[styles.time, hot && styles.timeHot]} numberOfLines={1}>{time}</Text> : null}
              </View>
              <View style={styles.line}>
                <Text style={[styles.sub, styles.grow, hot && styles.subHot]} numberOfLines={1}>{r.sub}</Text>
                {!r.g && r.username && mixarNew.has(r.username) ? (
                  <View style={styles.mixarNew} accessibilityLabel={t('Mixar com novidades')}><Icon name="mixar" size={17} color={colors.zinc500} /><MixarDot size={6} /></View>
                ) : null}
                {badge === 'dot' ? <View style={styles.dot} /> : badge ? <View style={styles.count}><Text style={styles.countText}>{badge}</Text></View> : null}
              </View>
            </View>
          </Pressable>
          )}
          </SwipeRow>
          );
        }}
        ListEmptyComponent={
          loading ? <Skeleton /> : strangers.length > 0 ? <View /> : failed ? (
            // Não carregou (sem rede): não é "Ainda sem cochichos" (lib/chatErrors). Por cima, as conversas com mensagens
            // à espera de rede (abrem e mostram-nas mesmo sem rede).
            <View>
              <PendingConvs />
              <ErrorState what={t('as mensagens')} retryLabel={retrying ? t('A tentar…') : undefined} onRetry={() => { if (retrying) return; void direct.refetch(); void groups.refetch(); }} />
            </View>
          ) : (
            <EmptyState
              icon={view === 'groups' && !term ? 'users' : 'messages'}
              title={term ? t('Nada com esse nome') : view === 'requests' ? t('Sem pedidos') : view === 'groups' ? t('Ainda não tens TxillGroups') : t('Ainda sem cochichos')}
              text={term ? t('Tenta outro nome ou começa uma conversa nova.')
                : view === 'requests' ? t('Quando alguém que não segues te escrever, aparece aqui.')
                : view === 'groups' ? t('Cria um para planear uma viagem, uma festa ou um fim de semana com a malta, com Plano e vibes.')
                : t('Começa uma conversa com alguém que segues. Os TxillGroups estão no separador ao lado.')}
              action={!term && view === 'chats' ? { label: t('Nova conversa'), onPress: () => router.push('/messages/new' as never) } : !term && view === 'groups' ? { label: t('Novo TxillGroup'), onPress: newGroup } : undefined}
            />
          )
        }
        ListFooterComponent={
          strangers.length > 0 ? (
            <View>
              <Text style={styles.others}>{t('OUTRAS PESSOAS')}</Text>
              {strangers.map((p) => (
                <Pressable key={p.username} onPress={() => router.push(`/messages/${p.username}` as never)} accessibilityRole="button" accessibilityLabel={t('Conversar com {displayName}', { displayName: p.displayName })} style={({ pressed }) => [styles.row, { paddingVertical: 10 }, pressed && { backgroundColor: colors.zinc100 }]}>
                  <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={46} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <NameWithBadge name={p.displayName} who={p} style={[styles.name, { fontSize: 16 }]} />
                    <Text style={[styles.sub, { fontSize: 14 }]} numberOfLines={1}>@{p.username}</Text>
                  </View>
                  <View style={styles.chat}><Text style={styles.chatText}>{t('Conversar')}</Text></View>
                </Pressable>
              ))}
            </View>
          ) : <View style={{ height: 8 }} />
        }
      />
      </PullView>
      </View>
      </GestureDetector>
      {held ? (
        <InboxMenuSheet
          name={held.name}
          who={held.who}
          sub={held.g ? t('{count} pessoa', { count: held.g.members, other: '{count} pessoas' }) : held.username ? `@${held.username}` : undefined}
          photo={held.g
            ? <GroupCover url={held.g.avatarUrl} kind={groupCardData(held.g).kind} size={48} radius={24} />
            : <Avatar name={held.names[0].name} username={held.names[0].username} size={48} />}
          items={inboxMenuItems(menuRow(held))}
          onPick={(a) => pickMenu(a, held)}
          onClose={closeMenu}
        />
      ) : null}
      {deskMenu && deskRow ? (
        <DeskMenu
          at={deskMenu.at}
          label={t('Opções da conversa com {name}', { name: deskRow.name })}
          items={inboxDeskMenuItems(menuRow(deskRow)).map((it) => ({ id: it.id, label: it.label, icon: it.icon, danger: it.danger, onPress: () => runAction(it.id as InboxAction, deskRow) }))}
          onClose={() => setDeskMenu(null)}
        />
      ) : null}
      {ttlFor ? <TtlSheet ttl={ttlFor.ttl} canChange onPick={(next) => pickTtl(ttlFor.username, next)} onClose={() => setTtlFor(null)} /> : null}
      {help ? <ShortcutHelp onClose={() => setHelp(false)} /> : null}
      {moreOpen ? (
        <ChatMenuSheet
          title={t('Mensagens')}
          onClose={() => setMoreOpen(false)}
          items={[
            { icon: 'eye-off', label: HIDDEN_TITLE, onPress: () => router.push(HIDDEN_PATH as never) },
            ...(desk ? [{ icon: 'info' as const, label: t('Atalhos do teclado'), onPress: () => setHelp(true) }] : []),
          ]}
        />
      ) : null}
      <InstantsDock />
    </View>
  );
}

/** "?" no computador: os atalhos do teclado das Mensagens (lib/deskChatKeys, shortcutHelp). */
function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title={t('Atalhos do teclado')} onClose={onClose}>
      <View style={{ paddingHorizontal: 24, paddingBottom: 4, gap: 10 }} {...deskZone(true)}>
        {shortcutHelp(isMac()).map((s) => (
          <View key={s.label} style={styles.keyRow}>
            <View style={styles.keys}>{s.keys.map((k) => <Text key={k} style={styles.kbd}>{k}</Text>)}</View>
            <Text style={styles.keyLabel}>{s.label}</Text>
          </View>
        ))}
        <Text style={[styles.keyLabel, { color: colors.zinc500, marginTop: 6 }]}>{t('Botão direito numa conversa ou numa mensagem: o menu com todas as opções.')}</Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  keys: { width: 128, flexDirection: 'row', gap: 6 },
  kbd: { minWidth: 28, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: colors.zinc300, backgroundColor: colors.zinc100, fontSize: 13, fontWeight: '700', color: colors.zinc800, textAlign: 'center' },
  keyLabel: { flex: 1, fontSize: 14, color: colors.zinc800 },
  top: { height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  zas: { position: 'absolute', left: 0, top: 2, height: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 10, paddingRight: 12, borderRadius: 999 },
  zasText: { fontSize: 15, fontWeight: '900', letterSpacing: -0.3, color: colors.brand },
  compose: { position: 'absolute', right: 0, top: 2, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  handle: { maxWidth: '54%', fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16, marginBottom: 8 },
  // 44 de altura (a da caixa) para o toque chegar aos 44 pt.
  sBtn: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },

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
  mixarNew: { marginLeft: 6, marginRight: 2 },


  others: { paddingHorizontal: 4, paddingBottom: 4, paddingTop: 16, fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.zinc500 },
  chat: { borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 6 },
  chatText: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
});
