import { BackButton } from '@/components/BackButton';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { dayLabel, quoteText, seenLabel, type Msg } from '@/components/ChatBubbles';
import { ChatComposer } from '@/components/ChatComposer';
import { ChatList } from '@/components/ChatList';
import { MessageMenu, NotFollowingNote, RequestBar, sendTyping, stopLiveShare } from '@/components/ChatParts';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { api, raw, type ChatThread } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTyping } from '@/lib/realtime';
import { colors } from '@/lib/theme';

/** Conversa com uma pessoa, igual à do site: tempo real, "a escrever…", "Visto", citações, reações, apagar, pedidos de mensagem. */
export default function Thread() {
  const { username = '' } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [err, setErr] = useState('');
  const [replying, setReplying] = useState<{ id: string; text: string; who: string } | null>(null);
  const [viewing, setViewing] = useState<{ url: string | null; body: string } | null>(null);
  const [menuFor, setMenuFor] = useState<Msg | null>(null);
  const [searching, setSearching] = useState(false);
  const [needle, setNeedle] = useState('');
  const typing = useTyping(username);
  const typingSent = useRef(0);

  const q = useInfiniteQuery({
    queryKey: ['chat-thread', username],
    queryFn: ({ pageParam }) => api.chatThread(username, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l: ChatThread) => l.nextCursor ?? undefined,
    // O tempo real faz o trabalho; isto é só uma rede de segurança.
    refetchInterval: 30_000,
    // Falhas de rede ou do arranque não deixam o chat em branco: tenta outra vez com uma pequena pausa.
    retry: 3,
    retryDelay: (n) => Math.min(400 * 2 ** n, 3000),
    staleTime: 15_000,
  });
  const qs = { isError: q.isError as boolean, isFetching: q.isFetching as boolean, refetch: () => q.refetch() };
  const first = q.data?.pages[0];
  const person = first?.person;
  const firstName = person?.displayName.split(' ')[0] ?? '';
  // O servidor manda do mais recente para o mais antigo: a lista mostra de baixo para cima (invertida).
  const items: Msg[] = q.data?.pages.flatMap((p) => p.items) ?? [];

  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['chat-unread'] });
    void qc.invalidateQueries({ queryKey: ['chat-list'] });
  }, [first?.items[0]?.id, qc]);

  // Diz ao servidor que esta conversa está aberta e à vista: assim não manda aviso para o telemóvel enquanto estás aqui.
  useEffect(() => {
    const key = `u:${username}`;
    const put = (k: string | null) => (raw('/chat/active', { method: 'PUT', body: JSON.stringify({ key: k }) }) as Promise<unknown>).catch(() => undefined);
    const ping = () => AppState.currentState === 'active' && put(key);
    void ping();
    const t = setInterval(ping, 20_000);
    const sub = AppState.addEventListener('change', (s) => void (s === 'active' ? put(key) : put(null)));
    return () => {
      clearInterval(t);
      sub.remove();
      void put(null);
    };
  }, [username]);

  const lastMine = items.find((m) => m.fromMe); // a lista vem do mais recente para o mais antigo
  const otherRead = first?.otherRead ?? null;
  const seenId = otherRead && lastMine && lastMine.id <= otherRead ? lastMine.id : null;

  function onTyping() {
    if (Date.now() - typingSent.current > 3000) {
      typingSent.current = Date.now();
      void sendTyping(username).catch(() => undefined);
    }
  }
  function startReply(m: Msg) {
    setReplying({ id: m.id, text: quoteText(m.kind, m.body), who: m.fromMe ? 'ti' : firstName });
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
  async function acceptReq() {
    await api.chatAccept(username).catch((e) => setErr((e as Error).message));
    await q.refetch();
    void qc.invalidateQueries({ queryKey: ['chat-list'] });
  }
  async function declineReq() {
    await api.chatDecline(username).catch((e) => setErr((e as Error).message));
    void qc.invalidateQueries({ queryKey: ['chat-list'] });
    router.replace('/messages' as never);
  }
  async function blockReq() {
    await api.block(username).catch((e) => setErr((e as Error).message));
    void qc.invalidateQueries({ queryKey: ['chat-list'] });
    router.replace('/messages' as never);
  }
  async function stopSharing(m: Msg) {
    await stopLiveShare(m.id).catch(() => undefined);
    await q.refetch();
  }

  if (q.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
        <View style={st.header}><BackButton fallback="/messages" /></View>
        <View style={{ marginHorizontal: 24, marginTop: 64, alignItems: 'center' }}>
          <Icon name="alert" size={44} color={colors.zinc300} />
          <Text style={{ marginTop: 12, fontSize: 20, fontWeight: '700', color: colors.zinc900, textAlign: 'center' }}>Não consegui abrir esta conversa</Text>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/messages' as never))} style={{ marginTop: 16 }}><Text style={{ fontWeight: '600', color: colors.brand, fontSize: 16 }}>Voltar</Text></Pressable>
        </View>
      </View>
    );
  }

  const request = first?.relation?.request;
  const online = person?.presence?.online;
  const rel = first?.relation;
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(needle.trim());
  const hits = n.length < 2 ? [] : items.filter((m) => !m.id.startsWith('tmp-') && !m.viewOnce && m.body && (m.kind === 'text' || m.kind === 'story_reply') && norm(m.body).includes(n)).slice(0, 40);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={st.header}>
        <BackButton fallback="/messages" style={{ width: 44, height: 44, borderRadius: 22 }} />
        {person && (
          <Pressable onPress={() => router.push(`/u/${person.username}` as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <View>
              <Avatar name={person.displayName} username={person.hasAvatar ? person.username : undefined} size={38} />
              {online ? <View style={st.online} accessibilityLabel="Online" /> : null}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.hName} numberOfLines={1}>{person.displayName}</Text>
              {typing ? (
                <Text style={[st.hSub, { color: colors.brand, fontWeight: '600' }]}>a escrever…</Text>
              ) : online ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#10b981' }} />
                  <Text style={[st.hSub, { color: '#059669', fontWeight: '600' }]}>Online</Text>
                </View>
              ) : (
                <Text style={st.hSub} numberOfLines={1}>{seenLabel(person.presence?.lastSeen ?? null) ?? `@${person.username}`}</Text>
              )}
            </View>
          </Pressable>
        )}
        <Pressable onPress={() => setSearching(true)} style={st.search} accessibilityRole="button" accessibilityLabel="Procurar na conversa"><Icon name="search" size={22} color={colors.zinc700} /></Pressable>
      </View>

      {qs.isError && items.length === 0 ? (
        <View style={st.failBox}>
          <Text style={st.failTitle}>Não consegui abrir esta conversa</Text>
          <Text style={st.failText}>Verifica a internet e tenta outra vez.</Text>
          <Pressable onPress={() => void qs.refetch()} style={st.failBtn} accessibilityRole="button"><Text style={st.failBtnText}>Tentar outra vez</Text></Pressable>
        </View>
      ) : null}
      <ChatList
        items={items}
        loading={q.isLoading || (qs.isError && items.length === 0 && qs.isFetching)}
        hasNext={!!q.hasNextPage}
        fetchNext={() => q.fetchNextPage()}
        fetchingNext={q.isFetchingNextPage}
        typing={typing}
        seenId={seenId}
        emptyText={`Diz olá a ${firstName || 'esta pessoa'}`}
        peerName={person?.displayName}
        peerHandle={username}
        meHandle={user?.username}
        top={!request && rel && !rel.theyFollow && person ? <NotFollowingNote name={firstName} left={rel.left} /> : null}
        onMenu={setMenuFor}
        onCheer={(m) => void cheer(m)}
        onOpenOnce={(m) => void openOnce(m)}
        onStopLive={(m) => void stopSharing(m)}
        onRetry={() => undefined}
      />

      {request && person ? (
        <RequestBar name={firstName} bottom={insets.bottom} onAccept={() => void acceptReq()} onDecline={() => void declineReq()} onBlock={() => void blockReq()} />
      ) : rel?.left === 0 ? (
        <Text style={[st.foot, { paddingBottom: Math.max(insets.bottom, 16) }]}>{firstName} ainda não respondeu. Podes escrever outra vez quando responder, aceitar ou te seguir.</Text>
      ) : first?.blocked ? (
        <Text style={[st.foot, { paddingBottom: Math.max(insets.bottom, 16) }]}>Não podes trocar mensagens com esta conta.</Text>
      ) : (
        <ChatComposer username={username} person={person} onSent={() => void q.refetch()} bottom={insets.bottom} replyTo={replying} onClearReply={() => setReplying(null)} onTyping={onTyping} />
      )}
      {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}

      {menuFor && <MessageMenu m={menuFor} onClose={() => setMenuFor(null)} onReply={startReply} onDone={() => void q.refetch()} onError={setErr} />}
      {searching && (
        <Sheet title="Procurar na conversa" onClose={() => { setSearching(false); setNeedle(''); }}>
          <View style={{ paddingHorizontal: 20 }}>
            <TextInput autoFocus value={needle} onChangeText={setNeedle} placeholder="Escreve uma palavra…" placeholderTextColor={colors.zinc500} accessibilityLabel="Procurar na conversa" style={st.needle} />
            <View style={{ marginTop: 12, gap: 4 }}>
              {hits.map((m) => (
                <Pressable key={m.id} onPress={() => { setSearching(false); setNeedle(''); }} style={({ pressed }) => [{ borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }, pressed && { backgroundColor: colors.zinc100 }]}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.zinc500 }}>{m.fromMe ? 'Tu' : person?.displayName} · {dayLabel(m.at)}</Text>
                  <Text style={{ fontSize: 15, color: colors.zinc800 }} numberOfLines={2}>{m.body}</Text>
                </Pressable>
              ))}
            </View>
            {n.length >= 2 && hits.length === 0 && <Text style={{ paddingVertical: 24, textAlign: 'center', color: colors.zinc600 }}>Nada encontrado nas mensagens carregadas.</Text>}
            {q.hasNextPage && (
              <Pressable onPress={() => void q.fetchNextPage()} style={{ marginTop: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingVertical: 10, alignItems: 'center' }}><Text style={{ fontSize: 14, fontWeight: '600', color: colors.zinc700 }}>Carregar mensagens mais antigas</Text></Pressable>
            )}
          </View>
        </Sheet>
      )}
      {viewing && (
        <Pressable onPress={() => setViewing(null)} style={st.viewer} accessibilityLabel="Fechar">
          {viewing.url ? <Image source={{ uri: viewing.url }} style={{ flex: 1 }} contentFit="contain" /> : <Text style={{ color: '#fff', fontSize: 20, textAlign: 'center', padding: 24 }}>{viewing.body}</Text>}
          <Text style={{ color: '#fff', textAlign: 'center', paddingBottom: 32 }}>Toca para fechar. Esta mensagem não volta a abrir.</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  failBox: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 24 },
  failTitle: { fontSize: 18, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  failText: { marginTop: 4, fontSize: 15, color: colors.zinc600, textAlign: 'center' },
  failBtn: { marginTop: 14, height: 44, borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  failBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  viewer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#000', justifyContent: 'center', zIndex: 50 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.zinc100, paddingHorizontal: 8, paddingVertical: 8 },
  search: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  hName: { fontWeight: '700', fontSize: 16, lineHeight: 20, color: colors.zinc900 },
  hSub: { fontSize: 12, lineHeight: 16, color: colors.zinc500 },
  online: { position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.white, backgroundColor: '#10b981' },
  foot: { borderTopWidth: 1, borderTopColor: colors.zinc100, paddingHorizontal: 24, paddingTop: 16, textAlign: 'center', fontSize: 14, color: colors.zinc600 },
  err: { position: 'absolute', left: 0, right: 0, bottom: 88, textAlign: 'center', fontSize: 14, color: colors.red600 },
  needle: { height: 48, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 20, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
});
