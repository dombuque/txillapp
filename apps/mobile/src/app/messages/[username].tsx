import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { ChatComposer } from '@/components/ChatComposer';
import { Icon } from '@/components/Icon';
import { Sticker } from '@/components/StickerPanel';
import { api, type ChatMessage, type ChatThread } from '@/lib/api';
import { colors } from '@/lib/theme';

type Msg = ChatMessage & { state?: 'sending' | 'failed' };

const quoteText = (kind: ChatMessage['kind'], body: string) => (kind === 'image' ? body || 'Foto' : kind === 'voice' ? 'Mensagem de voz' : kind === 'sticker' ? 'Sticker' : kind === 'gift' ? 'Presente' : body);
const hm = (iso: string) => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

function seenLabel(lastSeen: string | null): string | null {
  if (!lastSeen) return null;
  const s = (Date.now() - new Date(lastSeen).getTime()) / 1000;
  if (s < 3600) return `Ativo há ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `Ativo há ${Math.floor(s / 3600)} h`;
  return `Ativo há ${Math.floor(s / 86400)} d`;
}

function Bubble({ m, prevSame, nextSame, onMenu, onRetry, onOpenOnce }: { m: Msg; prevSame: boolean; nextSame: boolean; onMenu: (m: Msg) => void; onRetry: (m: Msg) => void; onOpenOnce: (m: Msg) => void }) {
  const mine = m.fromMe;
  const radius = mine
    ? { borderRadius: 20, borderBottomRightRadius: 6, ...(prevSame ? { borderTopRightRadius: 6 } : null) }
    : { borderRadius: 20, borderBottomLeftRadius: 6, ...(prevSame ? { borderTopLeftRadius: 6 } : null) };
  const tone = mine ? { backgroundColor: colors.brand } : { backgroundColor: colors.zinc100 };
  const ink = mine ? '#fff' : colors.zinc900;
  const real = !m.id.startsWith('tmp-');

  let content: React.ReactNode;
  if (m.viewOnce && !m.opened && !mine) {
    content = (
      <Pressable onPress={() => onOpenOnce(m)} style={[styles.bubble, tone, radius, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <Icon name="once" size={20} color={ink} />
        <Text style={[styles.text, { color: ink, fontWeight: '600' }]}>Toca para abrir</Text>
      </Pressable>
    );
  } else if (m.viewOnce && mine) {
    content = (
      <View style={[styles.bubble, tone, radius, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <Icon name="once" size={20} color={ink} />
        <Text style={[styles.text, { color: ink }]}>{m.opened ? 'Aberta' : 'Visualização única'}</Text>
      </View>
    );
  } else if (m.viewOnce && m.opened) {
    content = <View style={[styles.bubble, tone, radius]}><Text style={[styles.text, { color: ink, fontStyle: 'italic' }]}>Já abriste esta mensagem</Text></View>;
  } else if (m.kind === 'gift') {
    content = (
      <View style={[styles.gift]}>
        <Icon name="gift" size={22} color="#fff" />
        <Text style={styles.giftAmount}>{(m.giftAmount ?? 0).toLocaleString('pt-PT')} Txills</Text>
        {m.body ? <Text style={styles.giftNote}>{m.body}</Text> : null}
      </View>
    );
  } else if (m.kind === 'sticker') {
    content = <Sticker id={m.body} size={132} />;
  } else if ((m.kind === 'image' || m.kind === 'video') && m.mediaUrl) {
    content = (
      <View style={[styles.media, radius]}>
        <Image source={{ uri: m.mediaUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        {m.kind === 'video' && <View style={styles.play}><Icon name="play" size={22} color="#fff" solid /></View>}
        {m.body ? <View style={styles.cap}><Text style={styles.capText}>{m.body}</Text></View> : null}
      </View>
    );
  } else if (m.kind === 'location' && m.lat != null && m.lng != null) {
    content = (
      <Pressable onPress={() => void Linking.openURL(`https://www.google.com/maps?q=${m.lat},${m.lng}`)} style={[styles.bubble, tone, radius]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="map-pin" size={18} color={ink} /><Text style={[styles.text, { color: ink }]}>Localização</Text></View>
      </Pressable>
    );
  } else if (m.kind === 'voice') {
    content = <View style={[styles.bubble, tone, radius]}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="mic" size={18} color={ink} /><Text style={[styles.text, { color: ink }]}>Mensagem de voz{m.durationMs ? ` · ${Math.round(m.durationMs / 1000)} s` : ''}</Text></View></View>;
  } else if (m.kind === 'post') {
    content = <View style={[styles.bubble, tone, radius]}><Text style={[styles.text, { color: ink }]}>Partilhou uma publicação{m.post ? ` de ${m.post.author.displayName}` : ''}</Text></View>;
  } else if (m.kind === 'story_reaction' || m.kind === 'story_reply') {
    content = <View style={[styles.bubble, tone, radius]}><Text style={[styles.text, { color: ink }]}>{m.kind === 'story_reaction' ? (mine ? 'Reagiste ao story' : 'Reagiu ao teu story') : `${mine ? 'Respondeste ao story' : 'Respondeu ao teu story'}: ${m.body}`}</Text></View>;
  } else {
    content = <View style={[styles.bubble, tone, radius, m.state === 'sending' && { opacity: 0.7 }]}><Text style={[styles.text, { color: ink }]}>{m.body}</Text></View>;
  }

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: prevSame ? 2 : 10 }}>
      {m.replyTo && (
        <View style={[styles.reply, mine ? { borderLeftColor: 'rgba(214,51,79,0.7)', backgroundColor: 'rgba(214,51,79,0.08)' } : { borderLeftColor: '#a1a1aa', backgroundColor: '#fafafa' }]}>
          {m.replyTo.gone ? <Text style={{ fontStyle: 'italic', color: colors.zinc600, fontSize: 13 }}>Mensagem apagada</Text> : (
            <>
              <Text style={{ fontWeight: '700', color: colors.zinc700, fontSize: 13 }} numberOfLines={1}>{m.replyTo.fromMe ? 'Tu' : m.replyTo.name}</Text>
              <Text style={{ color: colors.zinc600, fontSize: 13 }} numberOfLines={2}>{quoteText(m.replyTo.kind, m.replyTo.body)}</Text>
            </>
          )}
        </View>
      )}
      <Pressable onLongPress={real ? () => onMenu(m) : undefined} delayLongPress={350} style={{ maxWidth: '78%' }}>{content}</Pressable>
      {m.reactions && m.reactions.length > 0 && (
        <View style={styles.reactions}>{m.reactions.map((r) => <Text key={r.reaction} style={{ fontSize: 13 }}>{r.reaction} {r.count > 1 ? r.count : ''}</Text>)}</View>
      )}
      {m.state === 'failed' && (
        <Pressable onPress={() => onRetry(m)}><Text style={{ marginTop: 2, fontSize: 12, color: colors.red600, fontWeight: '600' }}>Não enviou. Toca para tentar outra vez</Text></Pressable>
      )}
      {!nextSame && m.state !== 'failed' && <Text style={styles.time}>{hm(m.at)}</Text>}
    </View>
  );
}

/** Conversa direta: bolhas como as do site, enviar texto, aceitar ou recusar um pedido. */
export default function Thread() {
  const { username = '' } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Msg[]>([]);
  const [err, setErr] = useState('');
  const [replying, setReplying] = useState<{ id: string; text: string } | null>(null);
  const [viewing, setViewing] = useState<{ url: string | null; body: string } | null>(null);
  const list = useRef<FlatList<Msg>>(null);

  const q = useInfiniteQuery({
    queryKey: ['chat-thread', username],
    queryFn: ({ pageParam }) => api.chatThread(username, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l: ChatThread) => l.nextCursor ?? undefined,
    refetchInterval: 4000,
  });
  const first = q.data?.pages[0];
  const person = first?.person;
  // O servidor manda do mais recente para o mais antigo: a lista mostra de baixo para cima (invertida).
  const server: Msg[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  const ids = new Set(server.map((m) => m.id));
  const items: Msg[] = [...pending.filter((p) => !ids.has(p.id)).reverse(), ...server];

  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['chat-unread'] });
    void qc.invalidateQueries({ queryKey: ['chat-list'] });
  }, [first?.items[0]?.id, qc]);

  async function send(body: string, tmpId?: string) {
    const id = tmpId ?? `tmp-${Date.now()}`;
    const optimistic: Msg = { id, fromMe: true, body, kind: 'text', storyUrl: null, mediaUrl: null, durationMs: null, at: new Date().toISOString(), state: 'sending' };
    setPending((p) => [...p.filter((x) => x.id !== id), optimistic]);
    setErr('');
    try {
      await api.chatSend(username, { body });
      setPending((p) => p.filter((x) => x.id !== id));
      await q.refetch();
    } catch (e) {
      setPending((p) => p.map((x) => (x.id === id ? { ...x, state: 'failed' as const } : x)));
      setErr((e as Error).message);
    }
  }
  function submit() {
    const body = text.trim();
    if (!body) return;
    setText('');
    void send(body);
  }
  function menu(m: Msg) {
    const buttons = [
      { text: 'Responder', onPress: () => setReplying({ id: m.id, text: quoteText(m.kind, m.body) }) },
      { text: '🥂 Brindar', onPress: () => void api.chatReact(m.id, '🥂').then(() => q.refetch()) },
      ...(m.fromMe ? [{ text: 'Apagar', style: 'destructive' as const, onPress: () => void api.chatDelete(m.id).then(() => q.refetch()) }] : []),
      { text: 'Cancelar', style: 'cancel' as const },
    ];
    Alert.alert('Mensagem', undefined, buttons);
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
  async function decide(accept: boolean) {
    await (accept ? api.chatAccept(username) : api.chatDecline(username)).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['chat-list'] });
    if (accept) await q.refetch();
    else router.back();
  }

  const request = first?.relation?.request;
  const online = person?.presence?.online;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/messages' as never))} style={styles.back} accessibilityRole="button" accessibilityLabel="Voltar"><Icon name="back" size={26} strokeWidth={2} /></Pressable>
        {person && (
          <Pressable onPress={() => router.push(`/u/${person.username}` as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <View>
              <Avatar name={person.displayName} username={person.hasAvatar ? person.username : undefined} size={38} />
              {online && <View style={styles.online} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.hName} numberOfLines={1}>{person.displayName}</Text>
              {online ? <Text style={[styles.hSub, { color: '#059669', fontWeight: '600' }]}>● Online</Text> : <Text style={styles.hSub} numberOfLines={1}>{seenLabel(person.presence?.lastSeen ?? null) ?? `@${person.username}`}</Text>}
            </View>
          </Pressable>
        )}
      </View>

      {q.isLoading ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : (
        <FlatList
          ref={list}
          inverted
          data={items}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
          renderItem={({ item, index }) => {
            // Lista invertida: o "anterior" no tempo é o índice seguinte.
            const older = items[index + 1];
            const newer = items[index - 1];
            return <Bubble m={item} prevSame={!!older && older.fromMe === item.fromMe} nextSame={!!newer && newer.fromMe === item.fromMe} onMenu={menu} onRetry={(m) => void send(m.body, m.id)} onOpenOnce={(m) => void openOnce(m)} />;
          }}
          onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
          ListEmptyComponent={<Text style={styles.empty}>Diz olá 👋</Text>}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {request ? (
        <View style={[styles.request, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Text style={styles.requestText}><Text style={{ fontWeight: '700' }}>Pedido de mensagem.</Text> Não segues {person?.displayName.split(' ')[0]}. Só passa para a caixa normal se aceitares.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Pressable onPress={() => void decide(true)} style={styles.accept}><Text style={styles.acceptText}>Aceitar</Text></Pressable>
            <Pressable onPress={() => void decide(false)} style={styles.decline}><Text style={styles.declineText}>Recusar</Text></Pressable>
          </View>
        </View>
      ) : first?.blocked ? (
        <Text style={[styles.empty, { paddingBottom: Math.max(insets.bottom, 12) }]}>Não podes trocar mensagens com esta conta.</Text>
      ) : (
        <ChatComposer username={username} person={person} onSent={() => void q.refetch()} bottom={insets.bottom} replyTo={replying} onClearReply={() => setReplying(null)} />
      )}
      {viewing && (
        <Pressable onPress={() => setViewing(null)} style={styles.viewer} accessibilityLabel="Fechar">
          {viewing.url ? <Image source={{ uri: viewing.url }} style={{ flex: 1 }} contentFit="contain" /> : <Text style={{ color: '#fff', fontSize: 20, textAlign: 'center', padding: 24 }}>{viewing.body}</Text>}
          <Text style={{ color: '#fff', textAlign: 'center', paddingBottom: 32 }}>Toca para fechar. Esta mensagem não volta a abrir.</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  viewer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#000', justifyContent: 'center', zIndex: 50 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.zinc100, paddingHorizontal: 8, paddingVertical: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  hName: { fontWeight: '700', fontSize: 16, color: colors.zinc900 },
  hSub: { fontSize: 12, color: colors.zinc500 },
  online: { position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.white, backgroundColor: '#10b981' },
  bubble: { paddingHorizontal: 16, paddingVertical: 10 },
  text: { fontSize: 16, lineHeight: 21 },
  time: { marginTop: 2, paddingHorizontal: 4, fontSize: 11, color: colors.zinc500 },
  reply: { marginBottom: 2, maxWidth: '78%', borderLeftWidth: 4, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  reactions: { marginTop: -6, flexDirection: 'row', gap: 6, borderRadius: 999, backgroundColor: colors.white, paddingHorizontal: 8, paddingVertical: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' },
  media: { width: 240, height: 300, overflow: 'hidden', backgroundColor: colors.zinc100 },
  play: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  cap: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', padding: 8 },
  capText: { color: '#fff', fontSize: 14 },
  gift: { width: 240, borderRadius: 20, backgroundColor: colors.brand, padding: 16, alignItems: 'center', gap: 4 },
  giftAmount: { color: '#fff', fontSize: 24, fontWeight: '800' },
  giftNote: { color: 'rgba(255,255,255,0.9)', fontSize: 14, textAlign: 'center' },
  empty: { textAlign: 'center', color: colors.zinc500, paddingVertical: 24 },
  err: { textAlign: 'center', fontSize: 14, color: colors.red600, paddingBottom: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, borderRadius: 26, backgroundColor: colors.zinc100, padding: 6 },
  input: { flex: 1, minHeight: 40, maxHeight: 128, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  send: { height: 40, borderRadius: 20, backgroundColor: colors.brand, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontWeight: '700' },
  request: { borderTopWidth: 1, borderTopColor: colors.zinc100, padding: 16 },
  requestText: { fontSize: 14, lineHeight: 19, color: colors.zinc700, textAlign: 'center' },
  accept: { flex: 1, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: '#fff', fontWeight: '700' },
  decline: { flex: 1, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  declineText: { fontWeight: '600', color: colors.zinc800 },
});
