import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Animated, Keyboard, PanResponder, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { api, type Story } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SITE_URL } from '@/lib/config';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { MentionSuggest, useMentionSuggest } from './MentionSuggest';
import { RichText } from './RichText';
import { Sheet } from './Sheet';
import { Sticker } from './StickerPanel';

/** Reações a stories: a mesma mascote dos stickers, sem texto (guardam-se como :nome:). */
export const REACTIONS: { id: string; label: string; art: string }[] = [
  { id: ':rir:', label: 'Rir', art: 'rir' },
  { id: ':uau:', label: 'Uau', art: 'uau' },
  { id: ':amor:', label: 'Adorar', art: 'amor' },
  { id: ':snif:', label: 'Triste', art: 'snif' },
  { id: ':palmas:', label: 'Fixe', art: 'fixe' },
  { id: ':fogo:', label: 'Bora', art: 'bora' },
  { id: ':brinde:', label: 'Brindar', art: 'saude' },
];
export function ReactionArt({ body, size = 40 }: { body: string; size?: number }) {
  const r = REACTIONS.find((x) => x.id === body);
  return r ? <Sticker id={r.art} size={size} /> : <Text style={{ fontSize: size * 0.85 }}>{body}</Text>;
}
const reactionLabel = (b: string) => REACTIONS.find((x) => x.id === b)?.label ?? b;

export function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0));
    return () => { a.remove(); b.remove(); };
  }, []);
  return h;
}

/** Painel inferior dentro do visualizador (menu, atividade, comentários). */
export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // Arrastar o painel para baixo fecha só o painel (o story continua por baixo).
  const dy = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => dy.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > 80 || g.vy > 0.8) closeRef.current();
          else Animated.spring(dy, { toValue: 0, useNativeDriver: false }).start();
        },
      }),
    [dy],
  );
  return (
    <Pressable style={st.panelBack} onPress={onClose} accessibilityRole="none">
      <Animated.View style={[st.panel, { transform: [{ translateY: dy }] }]}>
        <Pressable onPress={() => undefined} accessibilityRole="none">
          <View {...pan.panHandlers} style={{ paddingBottom: 4 }}>
            <View style={st.grab} />
            <Text style={st.panelTitle}>{title}</Text>
          </View>
          {children}
        </Pressable>
      </Animated.View>
    </Pressable>
  );
}

/** Responder ao story ou reagir com a mascote; brindar alterna e conta ao autor. */
export function ReplyBar({ story, username, onFocusChange, inputRef, onCheered }: { story: Story; username: string; onFocusChange: (v: boolean) => void; inputRef: React.RefObject<React.ComponentRef<typeof TextInput> | null>; /** Brindou (não quando tira o brinde): o ecrã mostra os copos, como nas publicações. */ onCheered?: () => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [cheered, setCheered] = useState(!!story.cheered);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2200); };

  async function cheer() {
    const next = !cheered;
    setCheered(next);
    if (next) {
      onCheered?.();
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    }
    try { await api.cheerStory(story.id, next); } catch (e) { setCheered(!next); flash((e as Error).message); }
  }
  async function send(body: string) {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await api.replyStory(story.id, body.trim());
      setText('');
      flash(REACTIONS.some((r) => r.id === body) ? `${reactionLabel(body)} enviado!` : 'Mensagem enviada');
    } catch (e) { flash((e as Error).message); } finally { setBusy(false); }
  }
  async function share() {
    if (!story.sharedFrom) return;
    const url = `${SITE_URL || 'https://txillapp.com'}/p/${story.sharedFrom.postId}`;
    try { await Share.share({ message: url, url }); } catch { /* cancelado */ }
  }
  const focus = (v: boolean) => { setOpen(v); onFocusChange(v); };

  return (
    <View style={{ width: '100%' }}>
      {open && (
        <View style={st.reactions}>
          {REACTIONS.map((r) => (
            <Pressable key={r.id} onPress={() => void send(r.id)} accessibilityRole="button" accessibilityLabel={`Reagir: ${r.label}`} hitSlop={4}><ReactionArt body={r.id} size={40} /></Pressable>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <TextInput ref={inputRef} value={text} onChangeText={setText} onFocus={() => focus(true)} onBlur={() => focus(false)} maxLength={500} placeholder={`Enviar mensagem a ${username}…`} placeholderTextColor="rgba(255,255,255,0.7)" returnKeyType="send" onSubmitEditing={() => void send(text)} style={st.reply} accessibilityLabel={`Responder ao mimo de ${username}`} />
        {text.trim() ? (
          <Pressable onPress={() => void send(text)} accessibilityRole="button"><Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Enviar</Text></Pressable>
        ) : (
          <>
            <Pressable onPress={() => void cheer()} style={st.round} accessibilityRole="button" accessibilityLabel="Brindar" accessibilityState={{ selected: cheered }}><Icon name="cheers" size={28} color={cheered ? colors.amber300 : '#fff'} /></Pressable>
            {story.sharedFrom && <Pressable onPress={() => void share()} style={st.round} accessibilityRole="button" accessibilityLabel="Partilhar"><Icon name="share" size={26} color="#fff" /></Pressable>}
          </>
        )}
      </View>
      {msg ? <Text style={st.flash} accessibilityRole="alert">{msg}</Text> : null}
    </View>
  );
}

/** Comentários públicos do story (só se comenta se o autor deixar). */
export function CommentsPanel({ story, canComment, onClose, onTyping }: { story: Story; canComment: boolean; onClose: () => void; onTyping: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const key = ['story-comments', story.id];
  const list = useQuery({ queryKey: key, queryFn: () => api.storyComments(story.id) });
  const kb = useKeyboardHeight();
  // @ nos comentários do mimo: o autor primeiro, depois as pessoas mais próximas.
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const mention = useMentionSuggest({ text, setText, inputRef, context: 'story', id: story.id });
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ['stories', story.author.username] }); };

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr('');
    try { await api.commentStory(story.id, body); setText(''); refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  function del(id: string) {
    Alert.alert('Apagar o comentário?', 'O comentário desaparece e não dá para o recuperar.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: async () => { await api.deleteStoryComment(id).catch(() => undefined); refresh(); } },
    ]);
  }
  return (
    <Panel title={`Comentários${list.data ? ` (${list.data.length})` : ''}`} onClose={onClose}>
      <View style={{ paddingBottom: kb ? kb : 0 }}>
        <ScrollView style={{ maxHeight: 320, minHeight: 96 }}>
          {list.isLoading && <ActivityIndicator style={{ margin: 24 }} color={colors.brand} />}
          {list.isSuccess && list.data.length === 0 && <Text style={st.none}>Ainda sem comentários. Sê o primeiro</Text>}
          {list.data?.map((c) => (
            <View key={c.id} style={st.item}>
              <Avatar name={c.author.displayName} username={c.author.hasAvatar ? c.author.username : undefined} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14, color: colors.zinc500 }} numberOfLines={1}><Text style={{ fontWeight: '700', color: colors.zinc900 }}>{c.author.username}</Text> · {timeAgo(c.createdAt)}</Text>
                <RichText text={c.body} style={{ fontSize: 15, lineHeight: 21, color: colors.zinc900 }} />
              </View>
              {c.canDelete && <Pressable onPress={() => del(c.id)} hitSlop={8} accessibilityLabel="Apagar comentário" style={{ padding: 6 }}><Icon name="x" size={18} color={colors.zinc500} /></Pressable>}
            </View>
          ))}
        </ScrollView>
        {canComment ? <MentionSuggest mention={mention} style={{ marginHorizontal: 0, marginTop: 8, marginBottom: 0 }} /> : null}
        {canComment ? (
          <View style={st.compose}>
            <Avatar name={user?.displayName ?? '?'} username={user?.username} size={32} />
            <TextInput ref={inputRef} value={text} onChangeText={setText} {...mention.inputProps} onFocus={() => { onTyping(true); mention.inputProps.onFocus(); }} onBlur={() => { onTyping(false); mention.inputProps.onBlur(); }} maxLength={500} placeholder="Adiciona um comentário…" placeholderTextColor={colors.zinc500} returnKeyType="send" onSubmitEditing={() => void send()} style={st.commentInput} accessibilityLabel="Comentário" />
            <Pressable onPress={() => void send()} disabled={!text.trim() || busy} accessibilityRole="button"><Text style={{ paddingHorizontal: 8, fontWeight: '700', fontSize: 16, color: colors.brand, opacity: !text.trim() || busy ? 0.4 : 1 }}>Publicar</Text></Pressable>
          </View>
        ) : (
          <Text style={st.closed}>Este mimo não aceita comentários.</Text>
        )}
        {err ? <Text style={{ marginTop: 4, textAlign: 'center', fontSize: 14, color: colors.red600 }}>{err}</Text> : null}
      </View>
    </Panel>
  );
}

/** Atividade do teu story: quem viu (e brindou) e as respostas. */
export function ActivityPanel({ story, onClose }: { story: Story; onClose: () => void }) {
  const [tab, setTab] = useState<'viewers' | 'replies'>('viewers');
  const viewers = useQuery({ queryKey: ['story-viewers', story.id], queryFn: () => api.storyViewers(story.id) });
  const replies = useQuery({ queryKey: ['story-replies', story.id], queryFn: () => api.storyReplies(story.id) });
  const tabs = [['viewers', `Visualizações${story.viewCount ? ` (${story.viewCount})` : ''}`], ['replies', `Respostas${replies.data ? ` (${replies.data.length})` : ''}`]] as const;
  return (
    <Panel title="Atividade do mimo" onClose={onClose}>
      <View style={st.tabs}>
        {tabs.map(([k, label]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[st.tab, tab === k && st.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: tab === k ? colors.zinc900 : colors.zinc500 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView style={{ maxHeight: 360 }}>
        {tab === 'replies' && (
          <>
            {replies.isLoading && <ActivityIndicator style={{ margin: 24 }} color={colors.brand} />}
            {replies.isSuccess && replies.data.length === 0 && <Text style={st.none}>Ainda sem respostas</Text>}
            {replies.data?.map((r) => (
              <View key={r.id} style={st.item}>
                <Avatar name={r.author.displayName} username={r.author.username} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, color: colors.zinc500 }} numberOfLines={1}><Text style={{ fontWeight: '700', color: colors.zinc900 }}>{r.author.displayName}</Text> · {timeAgo(r.createdAt)}</Text>
                  {r.kind === 'reaction' ? <ReactionArt body={r.body} size={44} /> : <Text style={st.bubble}>{r.body}</Text>}
                </View>
              </View>
            ))}
          </>
        )}
        {tab === 'viewers' && (
          <>
            {viewers.isLoading && <ActivityIndicator style={{ margin: 24 }} color={colors.brand} />}
            {viewers.isSuccess && viewers.data.length === 0 && <Text style={st.none}>Ainda ninguém viu</Text>}
            {viewers.data?.map((v) => (
              <View key={v.username} style={[st.item, { alignItems: 'center' }]}>
                <Avatar name={v.displayName} username={v.username} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} numberOfLines={1}>{v.displayName}</Text>
                  <Text style={{ fontSize: 14, color: colors.zinc500 }} numberOfLines={1}>@{v.username}</Text>
                </View>
                {v.cheered && <Icon name="cheers" size={18} color={colors.brand} />}
                <Text style={{ fontSize: 14, color: colors.zinc500 }}>{timeAgo(v.viewedAt)}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Panel>
  );
}

/** Amigos próximos: quem vê os stories marcados só para eles. Só se juntam seguidores. */
export function CloseFriendsSheet({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const friends = useQuery({ queryKey: ['close-friends'], queryFn: api.closeFriends });
  const followers = useQuery({ queryKey: ['close-friends-search', q], queryFn: () => api.followers(user!.username, undefined, q.trim() || undefined) });
  const mine = new Set((friends.data ?? []).map((f) => f.username.toLowerCase()));
  const candidates = (followers.data?.items ?? []).filter((p) => !mine.has(p.username.toLowerCase()));
  async function toggle(username: string, add: boolean) {
    await (add ? api.addCloseFriend(username) : api.removeCloseFriend(username)).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['close-friends'] });
    await qc.invalidateQueries({ queryKey: ['stories'] });
  }
  return (
    <Sheet title="Amigos próximos" onClose={onClose} full>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <Text style={{ marginBottom: 12, fontSize: 14, color: colors.zinc600 }}>Só estas pessoas veem os mimos que marcares para amigos próximos. Elas não sabem que estão na lista.</Text>
        <Text style={st.sec}>Na tua lista ({friends.data?.length ?? 0})</Text>
        {friends.data?.length === 0 && <Text style={{ paddingVertical: 8, fontSize: 14, color: colors.zinc500 }}>Ainda ninguém. Escolhe abaixo</Text>}
        {friends.data?.map((f) => (
          <View key={f.username} style={[st.item, { alignItems: 'center' }]}>
            <Avatar name={f.displayName} username={f.hasAvatar ? f.username : undefined} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} numberOfLines={1}>{f.displayName}</Text>
              <Text style={{ fontSize: 14, color: colors.zinc500 }} numberOfLines={1}>@{f.username}</Text>
            </View>
            <Pressable onPress={() => void toggle(f.username, false)} style={[st.pill, { backgroundColor: '#ecfdf5' }]} accessibilityRole="button"><Text style={{ fontWeight: '700', fontSize: 14, color: '#047857' }}>Na lista</Text></Pressable>
          </View>
        ))}
        <Text style={[st.sec, { marginTop: 16 }]}>Adicionar dos teus seguidores</Text>
        <TextInput value={q} onChangeText={setQ} placeholder="Procurar…" placeholderTextColor={colors.zinc500} autoCapitalize="none" style={st.search} accessibilityLabel="Procurar seguidores" />
        {candidates.map((p) => (
          <View key={p.username} style={[st.item, { alignItems: 'center' }]}>
            <Avatar name={p.displayName} username={p.username} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} numberOfLines={1}>{p.displayName}</Text>
              <Text style={{ fontSize: 14, color: colors.zinc500 }} numberOfLines={1}>@{p.username}</Text>
            </View>
            <Pressable onPress={() => void toggle(p.username, true)} style={[st.pill, { backgroundColor: colors.brand }]} accessibilityRole="button"><Text style={{ fontWeight: '700', fontSize: 14, color: '#fff' }}>Adicionar</Text></Pressable>
          </View>
        ))}
        {followers.isSuccess && candidates.length === 0 && <Text style={{ paddingVertical: 12, fontSize: 14, color: colors.zinc500 }}>{q ? 'Ninguém com esse nome' : 'Não há mais seguidores para adicionar'}</Text>}
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  panelBack: { ...StyleSheet.absoluteFill, zIndex: 20, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  panel: { maxHeight: '72%', borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#fff', paddingHorizontal: 20, paddingBottom: 24, paddingTop: 12 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.zinc300, marginBottom: 12 },
  panelTitle: { textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.zinc900, marginBottom: 12 },
  reactions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 12 },
  reply: { flex: 1, minWidth: 0, height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', backgroundColor: 'rgba(0,0,0,0.2)', paddingHorizontal: 20, color: '#fff', fontSize: 16, outlineStyle: 'none' as never },
  round: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  flash: { marginTop: 8, textAlign: 'center', fontSize: 14, fontWeight: '500', color: '#fff' },
  none: { paddingVertical: 24, textAlign: 'center', color: colors.zinc500, fontSize: 16 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  compose: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.zinc100, paddingTop: 12 },
  commentInput: { flex: 1, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, paddingHorizontal: 16, fontSize: 15, color: colors.zinc900, outlineStyle: 'none' as never },
  closed: { marginTop: 8, borderRadius: 12, backgroundColor: '#fafafa', paddingHorizontal: 12, paddingVertical: 10, textAlign: 'center', fontSize: 14, color: colors.zinc600 },
  tabs: { flexDirection: 'row', borderRadius: 999, backgroundColor: colors.zinc100, padding: 4, marginBottom: 12 },
  tab: { flex: 1, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.12)' },
  bubble: { marginTop: 2, alignSelf: 'flex-start', borderRadius: 16, borderTopLeftRadius: 6, backgroundColor: colors.zinc100, paddingHorizontal: 14, paddingVertical: 8, fontSize: 16, color: colors.zinc900, overflow: 'hidden' },
  sec: { marginBottom: 4, fontSize: 14, fontWeight: '600', color: colors.zinc500 },
  pill: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 },
  search: { marginTop: 4, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, paddingHorizontal: 16, fontSize: 15, color: colors.zinc900, outlineStyle: 'none' as never },
});
