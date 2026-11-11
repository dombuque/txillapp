import { BackButton } from '@/components/BackButton';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Alert, AppState, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { quoteText, type Msg } from '@/components/ChatBubbles';
import { ChatComposer } from '@/components/ChatComposer';
import { ChatHeader, ChatMenuSheet, ChatSearchSheet, HeaderButton, HeaderStatus, OnlineDot } from '@/components/ChatHeader';
import { ChatEditBar } from '@/components/ChatEditBar';
import { ChatList } from '@/components/ChatList';
import { NoteDot, PeerNoteBubble } from '@/components/ChatPeerNote';
import { NoteView } from '@/components/Notes';
import { MessageMenu, NotFollowingNote, RequestBar, saveEdit, sendTyping, stopLiveShare } from '@/components/ChatParts';
import { CallIcon } from '@/components/calls/CallIcons';
import { Icon } from '@/components/Icon';
import { abs } from '@/lib/config';
import { api, raw, type ChatThread, type Conversation } from '@/lib/api';
import { startCall } from '@/lib/calls';
import { useAuth } from '@/lib/auth';
import { headerLine, newPostsLabel, newPostsTarget, newPostsText } from '@/lib/chatNewPosts';
import { NOTE_FOLD_MS, NOTE_FOLD_START, noteFold, peerBubble, peerBubbleKey } from '@/lib/chatPeerNote';
import { activeLabel } from '@/lib/chatTimeline';
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
  /** Tocar na lista de mensagens fecha os stickers e os menus do compositor (tocar fora fecha). */
  const [closeTick, setCloseTick] = useState(0);
  const composerOpen = useRef(false);
  const onComposerOpen = useCallback((o: boolean) => { composerOpen.current = o; }, []);
  const [viewing, setViewing] = useState<{ url: string | null; body: string } | null>(null);
  // O menu da mensagem (segurar) e, se veio da ação "Apagar" do leitor de ecrã, já na confirmação.
  const [menuFor, setMenuFor] = useState<{ m: Msg; start?: 'delete' } | null>(null);
  // A minha mensagem que estou a editar (a barra de escrever passa a ser a de editar).
  const [editing, setEditing] = useState<Msg | null>(null);
  const [searching, setSearching] = useState(false);
  const [more, setMore] = useState(false);
  const [raised, setRaised] = useState(false);
  const typing = useTyping(username);
  const typingSent = useRef(0);
  // Por ler ao abrir (da lista de conversas, antes de a conversa as marcar como lidas): para o "Mensagens novas".
  const unread = useMemo(() => qc.getQueryData<Conversation[]>(['chat-list'])?.find((c) => c.username === username)?.unread ?? 0, [username]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // A nota da pessoa (ou, sem nota, a bio do perfil) por baixo da foto do cabeçalho (lib/chatPeerNote): abre ao entrar e
  // encolhe ao subir nas mensagens ou ao fim de 8 s; tocar na foto volta a mostrá-la, tocar no balão abre a nota (ou o
  // perfil, se for a bio).
  const reduceMotion = useReducedMotion();
  const bubble = first?.blocked ? null : peerBubble(first?.peerNote, first?.peerBio);
  const peerNote = bubble?.kind === 'note' ? bubble.note : null;
  const noteKey = peerBubbleKey(bubble);
  const [fold, foldDispatch] = useReducer(noteFold, NOTE_FOLD_START);
  const [noteOpen, setNoteOpen] = useState(false);
  const scrollY = useRef(0);
  const foldOpen = useRef(false);
  foldOpen.current = fold.open;
  useEffect(() => foldDispatch({ type: 'note', key: noteKey, y: scrollY.current }), [noteKey]);
  useEffect(() => {
    if (!fold.open) return;
    const t = setTimeout(() => foldDispatch({ type: 'timeout' }), NOTE_FOLD_MS);
    return () => clearTimeout(t);
  }, [fold.open, fold.seq]);
  const onScrollY = useCallback((y: number) => {
    scrollY.current = y;
    if (foldOpen.current) foldDispatch({ type: 'scroll', y });
  }, []);

  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['chat-unread'] });
    void qc.invalidateQueries({ queryKey: ['chat-list'] });
  }, [first?.items[0]?.id, qc]);

  // Ao voltar à conversa (ex.: da publicação ou do perfil aberto pelas "publicações novas"), a contagem põe-se em dia.
  const focusedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    if (focusedOnce.current) void qc.invalidateQueries({ queryKey: ['chat-thread', username] });
    focusedOnce.current = true;
  }, [qc, username]));

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

  // A minha última já enviada (a lista vem do mais recente para o mais antigo); as que estão a enviar ou falharam não contam.
  const lastMine = items.find((m) => m.fromMe && !m.state && !m.id.startsWith('tmp-'));
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
      setViewing({ url: abs(r.mediaUrl) ?? null, body: r.body });
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
        <View style={st.header}><BackButton fallback="/messages" style={{ width: 44, height: 44, borderRadius: 22 }} /></View>
        <View style={{ marginHorizontal: 24, marginTop: 64, alignItems: 'center' }}>
          <Icon name="alert" size={44} color={colors.zinc300} />
          <Text style={{ marginTop: 12, fontSize: 20, fontWeight: '700', color: colors.zinc900, textAlign: 'center' }}>Não consegui abrir esta conversa</Text>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/messages' as never))} style={{ marginTop: 16, minHeight: 44, justifyContent: 'center' }}><Text style={{ fontWeight: '600', color: colors.brand, fontSize: 16 }}>Voltar</Text></Pressable>
        </View>
      </View>
    );
  }

  const request = first?.relation?.request;
  const online = person?.presence?.online;
  const rel = first?.relation;
  const call = (video: boolean) => person && void startCall({ username: person.username, displayName: person.displayName, hasAvatar: person.hasAvatar }, video);
  const openProfile = person ? () => router.push(`/u/${person.username}` as never) : undefined;
  const avatarOf = person?.hasAvatar ? person.username : undefined;
  // Por baixo do nome: "a escrever…" ganha; depois "1 publicação nova" (toca para abrir); depois Online / Ativo há….
  const newPosts = first?.blocked ? undefined : first?.newPosts;
  const line = headerLine({ typing, newPosts, online });
  const newPostsGo = person && line === 'newPosts' ? newPostsTarget(newPosts, person.username) : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }} behavior="padding">
      <ChatHeader
        raised={raised}
        onOpen={openProfile}
        openLabel={person ? `Ver o perfil de ${person.displayName}` : 'Conversa'}
        avatar={
          <View>
            <Avatar name={person?.displayName ?? username} username={avatarOf} size={36} />
            {online ? <OnlineDot size={36} /> : null}
            {bubble ? <NoteDot visible={!fold.open} reduceMotion={reduceMotion} /> : null}
          </View>
        }
        avatarAction={person && bubble && !fold.open ? { label: `Mostrar a ${bubble.kind === 'bio' ? 'bio' : 'nota'} de ${person.displayName}`, onPress: () => foldDispatch({ type: 'show', y: scrollY.current }) } : undefined}
        overlay={person && bubble ? (
          <PeerNoteBubble bubble={bubble} name={person.displayName} online={!!online} open={fold.open} reduceMotion={reduceMotion} onPress={() => (bubble.kind === 'bio' ? openProfile?.() : setNoteOpen(true))} />
        ) : null}
        title={person?.displayName ?? ''}
        subtitleAction={person && newPostsGo ? { label: newPostsLabel(newPosts?.count, person.displayName), onPress: () => router.push(newPostsGo as never) } : undefined}
        subtitle={
          line === 'typing' ? <HeaderStatus text="a escrever…" tone="typing" />
            : person && newPostsGo ? <HeaderStatus text={newPostsText(newPosts?.count)} />
            : online ? <HeaderStatus text="Online" tone="online" />
            : person ? <HeaderStatus text={activeLabel(person.presence?.lastSeen) ?? `@${person.username}`} />
            : null
        }
        actions={
          <>
            {person && !first?.blocked ? (
              <>
                <HeaderButton label={`Ligar a ${person.displayName}`} onPress={() => call(false)}><CallIcon name="handset" size={21} color={colors.zinc800} /></HeaderButton>
                <HeaderButton label={`Videochamada a ${person.displayName}`} onPress={() => call(true)}><Icon name="video" size={23} color={colors.zinc800} /></HeaderButton>
              </>
            ) : null}
            <HeaderButton label="Mais opções" onPress={() => setMore(true)}><Icon name="more" size={22} color={colors.zinc800} strokeWidth={2.4} /></HeaderButton>
          </>
        }
      />

      {qs.isError && items.length === 0 ? (
        <View style={st.failBox}>
          <Text style={st.failTitle}>Não consegui abrir esta conversa</Text>
          <Text style={st.failText}>Verifica a internet e tenta outra vez.</Text>
          <Pressable onPress={() => void qs.refetch()} style={st.failBtn} accessibilityRole="button"><Text style={st.failBtnText}>Tentar outra vez</Text></Pressable>
        </View>
      ) : null}
      <ChatList
        key={username}
        onTouch={() => { if (composerOpen.current) setCloseTick((t) => t + 1); }}
        items={items}
        loading={q.isLoading || (qs.isError && items.length === 0 && qs.isFetching)}
        hasNext={!!q.hasNextPage}
        fetchNext={() => q.fetchNextPage()}
        fetchingNext={q.isFetchingNextPage}
        typing={typing}
        seenId={seenId}
        unread={unread}
        onRaised={setRaised}
        onScrollY={onScrollY}
        emptyArt={person ? <Avatar name={person.displayName} username={avatarOf} size={80} /> : null}
        emptyTitle={person?.displayName}
        emptyText={`Ainda não há mensagens. Diz olá a ${firstName || 'esta pessoa'} 👋`}
        peerName={person?.displayName}
        peerHandle={username}
        peerAvatar={avatarOf}
        meHandle={user?.username}
        top={!request && rel && !rel.theyFollow && person ? <NotFollowingNote name={firstName} left={rel.left} /> : null}
        onMenu={(m) => setMenuFor({ m })}
        onDelete={(m) => setMenuFor({ m, start: 'delete' })}
        onCheer={(m) => void cheer(m)}
        onOpenOnce={(m) => void openOnce(m)}
        onStopLive={(m) => void stopSharing(m)}
        onRetry={() => undefined}
        onReply={startReply}
      />

      {request && person ? (
        <RequestBar name={firstName} bottom={insets.bottom} onAccept={() => void acceptReq()} onDecline={() => void declineReq()} onBlock={() => void blockReq()} />
      ) : rel?.left === 0 ? (
        <Text style={[st.foot, { paddingBottom: Math.max(insets.bottom, 16) }]}>{firstName} ainda não respondeu. Podes escrever outra vez quando responder, aceitar ou te seguir.</Text>
      ) : first?.blocked ? (
        <Text style={[st.foot, { paddingBottom: Math.max(insets.bottom, 16) }]}>Não podes trocar mensagens com esta conta.</Text>
      ) : editing ? (
        <ChatEditBar
          key={editing.id}
          original={editing.body}
          bottom={insets.bottom}
          onCancel={() => setEditing(null)}
          onSave={async (text) => {
            await saveEdit(qc, ['chat-thread', username], editing.id, text);
            setEditing(null);
          }}
        />
      ) : (
        <ChatComposer closeTick={closeTick} onOpenChange={onComposerOpen} username={username} person={person} onSent={() => void q.refetch()} bottom={insets.bottom} replyTo={replying} onClearReply={() => setReplying(null)} onTyping={onTyping} />
      )}
      {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}

      {menuFor && (
        <MessageMenu
          m={menuFor.m}
          start={menuFor.start}
          cacheKey={['chat-thread', username]}
          onClose={() => setMenuFor(null)}
          onReply={(m) => { setEditing(null); startReply(m); }}
          onEdit={(m) => { setReplying(null); setEditing(m); }}
          onDone={() => void q.refetch()}
          onError={setErr}
        />
      )}
      {more && (
        <ChatMenuSheet
          onClose={() => setMore(false)}
          items={[
            { icon: 'search', label: 'Procurar na conversa', onPress: () => setSearching(true) },
            ...(openProfile ? [{ icon: 'user' as const, label: 'Ver perfil', onPress: openProfile }] : []),
          ]}
        />
      )}
      {searching && (
        <ChatSearchSheet items={items} nameOf={(m) => (m.fromMe ? 'Tu' : person?.displayName ?? '')} hasNext={!!q.hasNextPage} fetchNext={() => void q.fetchNextPage()} onClose={() => setSearching(false)} />
      )}
      {noteOpen && person && peerNote && (
        <NoteView
          inChat
          note={{ username: person.username, displayName: person.displayName, hasAvatar: person.hasAvatar, body: peerNote.body, music: peerNote.music, audience: 'mutual', createdAt: peerNote.createdAt, expiresAt: peerNote.expiresAt, cheered: peerNote.cheered }}
          onClose={() => setNoteOpen(false)}
        />
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 6 },
  foot: { borderTopWidth: 1, borderTopColor: colors.zinc100, paddingHorizontal: 24, paddingTop: 16, textAlign: 'center', fontSize: 14, color: colors.zinc600 },
  err: { position: 'absolute', left: 0, right: 0, bottom: 88, textAlign: 'center', fontSize: 14, color: colors.red600 },
});
