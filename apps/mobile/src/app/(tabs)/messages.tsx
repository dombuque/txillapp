import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
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
import { timeAgo } from '@/lib/time';

function what(m: { body: string; kind: ChatMessage['kind']; fromMe: boolean }, group = false) {
  const you = m.fromMe ? 'Tu: ' : '';
  if (m.kind === 'image') return `${you}${m.body || 'Foto'}`;
  if (m.kind === 'voice') return `${you}Mensagem de voz`;
  if (m.kind === 'video') return `${you}Vídeo`;
  if (m.kind === 'post') return `${you}Partilhou uma publicação`;
  if (m.kind === 'gift') return `${m.fromMe ? 'Tu: ' : ''}Presente`;
  if (m.kind === 'sticker') return `${you}Sticker`;
  if (m.kind === 'location') return `${you}Localização`;
  if (m.kind === 'story_reaction') return `${m.fromMe ? 'Reagiste ao mimo' : 'Reagiu ao teu mimo'}: ${REACTIONS.find((x) => x.id === m.body)?.label ?? m.body}`;
  if (m.kind === 'story_reply') return `${m.fromMe ? 'Respondeste ao mimo' : 'Respondeu ao teu mimo'}: ${m.body}`;
  if (m.kind === 'zas_reply') return `${m.fromMe ? 'Respondeste ao Zás' : 'Respondeu ao teu Zás'}: ${m.body}`;
  return `${group ? '' : you}${m.body}`;
}

interface Row {
  key: string;
  to: string;
  name: string;
  sub: string;
  at: string;
  unread: number;
  names: { name: string; username?: string }[];
  online: boolean;
  group: boolean;
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

/** Lista de conversas e grupos, com pesquisa e pedidos de mensagem, como no site. */
export default function Messages() {
  // Vindo do "+" com o Zás escolhido: abre a câmara do Zás assim que o ecrã monta.
  const { zas } = useLocalSearchParams<{ zas?: string }>();
  useEffect(() => { if (zas === '1') setTimeout(openZasCamera, 300); }, [zas]);
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [view, setView] = useState<'all' | 'requests'>('all');
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

  const requestCount = (direct.data ?? []).filter((c) => c.request).length;
  const rows: Row[] = [
    ...(direct.data ?? []).filter((c) => (view === 'requests' ? c.request : !c.request)).map((c): Row => ({
      key: `d:${c.username}`,
      to: `/messages/${c.username}`,
      name: c.displayName,
      sub: what(c.lastMessage),
      at: c.lastMessage.at,
      unread: c.unread,
      names: [{ name: c.displayName, username: c.hasAvatar ? c.username : undefined }],
      online: !!c.presence?.online,
      group: false,
    })),
    ...(view === 'requests' ? [] : groups.data ?? []).map((g): Row => ({
      key: `g:${g.id}`,
      to: `/messages/g/${g.id}`,
      name: g.name,
      sub: g.lastMessage.empty ? `${g.members} pessoas` : `${g.lastMessage.fromMe ? '' : g.lastMessage.senderName ? `${g.lastMessage.senderName}: ` : ''}${what(g.lastMessage, true)}`,
      at: g.lastMessage.at,
      unread: g.unread,
      names: g.preview.slice(0, 2).map((p) => ({ name: p.displayName, username: p.hasAvatar ? p.username : undefined })),
      online: false,
      group: true,
    })),
  ]
    .filter((r) => !term || r.name.toLowerCase().includes(term) || r.sub.toLowerCase().includes(term))
    .sort((a, b) => +new Date(b.at) - +new Date(a.at));

  const known = new Set((direct.data ?? []).map((c) => c.username.toLowerCase()));
  const strangers = term ? (people.data ?? []).filter((p) => !known.has(p.username.toLowerCase())) : [];
  const loading = direct.isLoading || groups.isLoading;

  const pull = usePullToRefresh(async () => { await Promise.all([direct.refetch(), groups.refetch()]); });
  const header = (
    <View>
      <View style={styles.top}>
        <Text style={styles.handle} numberOfLines={1}>{user?.username ?? 'Mensagens'}</Text>
        <Pressable onPress={() => router.push('/messages/new' as never)} hitSlop={8} style={styles.compose} accessibilityRole="button" accessibilityLabel="Nova conversa ou grupo"><Icon name="compose" size={24} /></Pressable>
      </View>
      <View style={[styles.search, focus && { backgroundColor: 'rgba(228,228,231,0.7)' }]}>
        <Icon name="search" size={18} color={colors.zinc500} />
        <TextInput value={text} onChangeText={setText} placeholder="Procurar pessoas e grupos" placeholderTextColor={colors.zinc500} style={styles.input} accessibilityLabel="Procurar conversas" onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} />
        {text ? <Pressable onPress={() => setText('')} style={styles.sBtn} accessibilityRole="button" accessibilityLabel="Limpar"><Icon name="x" size={16} /></Pressable> : null}
        <Pressable onPress={() => setAi(true)} style={styles.sBtn} accessibilityRole="button" accessibilityLabel="Abrir o SuperTxill"><Bolt size={20} /></Pressable>
      </View>
      {!term && view === 'all' && <NotesStrip />}
      <View style={styles.tabs} accessibilityRole="tablist">
        <Pressable onPress={() => setView('all')} accessibilityRole="tab" accessibilityState={{ selected: view === 'all' }}>
          <Text style={[styles.tab, view === 'all' ? styles.tabOn : styles.tabOff]}>Mensagens</Text>
        </Pressable>
        <Pressable onPress={() => setView('requests')} accessibilityRole="tab" accessibilityState={{ selected: view === 'requests' }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.tab, view === 'requests' ? styles.tabOn : styles.tabOff]}>Pedidos</Text>
          {requestCount > 0 && <View style={styles.count}><Text style={styles.countText}>{requestCount}</Text></View>}
        </Pressable>
      </View>
      {view === 'requests' && <Text style={styles.note}>Mensagens de quem não segues. Só passam para a caixa normal se aceitares. Quem recusas não é avisado.</Text>}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
      <PullView pull={pull}>
      <FlatList
        onScroll={(e) => { pull.onScroll(e); zasListScrolling(); }}
        scrollEventThrottle={16}
        refreshControl={pull.control}
        data={rows}
        keyExtractor={(r) => r.key}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: r }) => (
          <Pressable onPressIn={() => { const m = /^\/messages\/([^/]+)$/.exec(String(r.to)); if (m && m[1] !== 'new') warm(decodeURIComponent(m[1])); }} onPress={() => router.push(r.to as never)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.zinc100 }]}>
            <View>
              {r.group ? (
                <View style={{ width: 62, height: 62 }}>
                  {r.names.slice(0, 2).map((a, i) => (
                    <View key={i} style={[styles.pair, i === 0 ? { left: 3, top: 3 } : { right: 3, bottom: 3 }]}><Avatar name={a.name} username={a.username} size={32} /></View>
                  ))}
                  {r.names.length === 0 && <View style={styles.groupEmpty}><Icon name="users" size={24} color={colors.zinc600} /></View>}
                </View>
              ) : (
                r.unread ? (
                  <LinearGradient colors={[colors.brand, '#ff9a5b']} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.ring}>
                    <View style={[styles.ringIn, { backgroundColor: colors.white }]}><Avatar name={r.names[0].name} username={r.names[0].username} size={50} /></View>
                  </LinearGradient>
                ) : (
                  <View style={styles.ring}><View style={styles.ringIn}><Avatar name={r.names[0].name} username={r.names[0].username} size={56} /></View></View>
                )
              )}
              {r.online && <View style={styles.online} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.name, { fontWeight: r.unread ? '800' : '600' }]} numberOfLines={1}>{r.name}</Text>
                {r.group && <Icon name="users" size={14} color="#a1a1aa" />}
              </View>
              <View style={{ flexDirection: 'row' }}>
                <Text style={[styles.sub, r.unread ? { fontWeight: '600', color: colors.zinc900 } : null, { flexShrink: 1 }]} numberOfLines={1}>{r.sub}</Text>
                <Text style={[styles.sub, r.unread ? { fontWeight: '600', color: colors.zinc900 } : null]}> · {timeAgo(r.at).replace('Há ', '')}</Text>
              </View>
            </View>
            {r.unread > 0 && <View style={styles.dot} accessibilityLabel={`${r.unread} por ler`} />}
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? <Skeleton /> : strangers.length > 0 ? <View /> : (
            <View style={styles.empty}>
              <Icon name="messages" size={44} color={colors.zinc300} />
              <Text style={styles.emptyTitle}>{term ? 'Nada com esse nome' : view === 'requests' ? 'Sem pedidos' : 'Ainda sem cochichos'}</Text>
              <Text style={styles.emptySub}>{term ? 'Tenta outro nome ou começa uma conversa nova.' : view === 'requests' ? 'Quando alguém que não segues te escrever, aparece aqui.' : 'Toca no ícone no canto para falar com alguém ou criar um grupo.'}</Text>
              {!term && view === 'all' && <Pressable onPress={() => router.push('/messages/new' as never)} style={styles.newBtn} accessibilityRole="button"><Text style={styles.newBtnText}>Nova conversa</Text></Pressable>}
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
      {ai && <SuperTxillPanel onClose={() => setAi(false)} />}
      <InstantsDock />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  zas: { position: 'absolute', left: 0, top: 2, height: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 10, paddingRight: 12, borderRadius: 999 },
  zasText: { fontSize: 15, fontWeight: '900', letterSpacing: -0.3, color: colors.brand },
  compose: { position: 'absolute', right: 0, top: 2, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  handle: { maxWidth: '70%', fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16, marginBottom: 8 },
  sBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  newBtn: { marginTop: 16, height: 44, borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  newBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, padding: 0, outlineStyle: 'none' } as object,
  tabs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 4, marginBottom: 4 },
  tab: { height: 40, lineHeight: 40, fontSize: 17 },
  tabOn: { fontWeight: '800', color: colors.zinc900 },
  tabOff: { fontWeight: '600', color: colors.zinc500 },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  note: { paddingHorizontal: 4, paddingBottom: 8, fontSize: 13, lineHeight: 18, color: colors.zinc500 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingHorizontal: 4, paddingVertical: 12 },
  ring: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  ringIn: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  pair: { position: 'absolute', width: 36, height: 36, borderRadius: 18, padding: 2, backgroundColor: colors.white },
  groupEmpty: { flex: 1, borderRadius: 31, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  online: { position: 'absolute', right: 4, bottom: 4, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.white, backgroundColor: '#10b981' },
  name: { fontSize: 17, fontWeight: '600', color: colors.zinc900, flexShrink: 1 },
  sub: { fontSize: 15, color: colors.zinc500 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.brand },
  empty: { marginTop: 40, alignItems: 'center', paddingHorizontal: 24 },
  emptyTitle: { marginTop: 12, fontSize: 20, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  emptySub: { marginTop: 4, maxWidth: 320, fontSize: 16, color: colors.zinc600, textAlign: 'center' },
  others: { paddingHorizontal: 4, paddingBottom: 4, paddingTop: 16, fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.zinc500 },
  chat: { borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 6 },
  chatText: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
});
