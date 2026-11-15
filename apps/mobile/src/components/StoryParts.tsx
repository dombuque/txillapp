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
import { NameWithBadge } from './NameWithBadge';
import { Icon } from './Icon';
import { MentionSuggest, useMentionSuggest } from './MentionSuggest';
import { ReportSheet } from './ReportSheet';
import { RichText } from './RichText';
import { Sheet } from './Sheet';
import { Sticker } from './StickerPanel';
import { linkShare } from '@/lib/shareLink';

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

/** Partilhar a publicação que foi posta no mimo (o mimo em si partilha-se pela barra). */
export async function shareSharedPost(story: Story) {
  if (!story.sharedFrom) return;
  const url = `${SITE_URL || 'https://txillapp.com'}/p/${story.sharedFrom.postId}`;
  try { await Share.share(linkShare('', url)); } catch { /* cancelado */ }
}

/** Um botão redondo da barra do visor (fora do mimo, sobre o fundo escuro), com a conta opcional num selo da marca. */
export function BarButton({ icon, label, onPress, n, on, color = '#fff', size = 25 }: { icon: 'comment' | 'cheers' | 'share' | 'eye'; label: string; onPress: () => void; n?: number | null; on?: boolean; color?: string; size?: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={4} style={({ pressed }) => [st.barBtn, on && st.barBtnOn, pressed && { transform: [{ scale: 0.92 }] }]} accessibilityRole="button" accessibilityLabel={label} accessibilityState={on !== undefined ? { selected: on } : undefined}>
      <Icon name={icon} size={size} color={color} strokeWidth={icon === 'eye' ? 2 : undefined} />
      {n ? <View style={st.count} pointerEvents="none"><Text style={st.countText}>{n > 99 ? '99+' : n}</Text></View> : null}
    </Pressable>
  );
}

/**
 * A barra do visor para quem vê (por baixo do mimo, fora da imagem: nunca tapa a assinatura do canto): responder numa
 * pílula escura, comentar, brindar (o ícone da marca, aceso na cor quente) e partilhar. A escrever, aparecem as reações
 * por cima e o campo ocupa a barra toda. As confirmações («Mensagem enviada») aparecem dentro do próprio campo.
 */
export function ReplyBar({ story, username, onFocusChange, inputRef, onCheered, onComments, onShare, compact = false }: { story: Story; username: string; onFocusChange: (v: boolean) => void; inputRef: React.RefObject<React.ComponentRef<typeof TextInput> | null>; /** Brindou (não quando tira o brinde): o ecrã mostra os copos, como nas publicações. */ onCheered?: () => void; onComments?: () => void; onShare?: () => void; /** Barra estreita (ecrã pequeno): o convite fica curto. */ compact?: boolean }) {
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
  const focus = (v: boolean) => { setOpen(v); onFocusChange(v); };
  const typed = !!text.trim();

  return (
    <View style={{ width: '100%' }}>
      {open && (
        <View style={st.reactions}>
          {REACTIONS.map((r) => (
            <Pressable key={r.id} onPress={() => void send(r.id)} style={({ pressed }) => pressed && { transform: [{ scale: 0.88 }] }} accessibilityRole="button" accessibilityLabel={`Reagir: ${r.label}`} hitSlop={4}><ReactionArt body={r.id} size={38} /></Pressable>
          ))}
        </View>
      )}
      <View style={st.barRow}>
        <View style={[st.replyPill, open && st.replyPillOn]}>
          <TextInput ref={inputRef} value={text} onChangeText={setText} onFocus={() => focus(true)} onBlur={() => focus(false)} maxLength={500} placeholder={msg && !text ? '' : compact && !open ? 'Responder…' : `Responder a ${username}…`} placeholderTextColor="rgba(255,255,255,0.62)" returnKeyType="send" onSubmitEditing={() => void send(text)} style={st.reply} accessibilityLabel={`Responder ao mimo de ${username}`} />
          {msg && !text ? (
            <View style={st.flashIn} pointerEvents="none">
              <Icon name="check-circle" size={16} color={colors.brandWarm} />
              <Text style={st.flash} numberOfLines={1} accessibilityRole="alert">{msg}</Text>
            </View>
          ) : null}
          {typed ? (
            <Pressable onPress={() => void send(text)} disabled={busy} style={({ pressed }) => [st.send, pressed && { transform: [{ scale: 0.92 }] }, busy && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Enviar">
              <Icon name="send" size={17} color="#fff" strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
        {!open && (
          <>
            {onComments ? <BarButton icon="comment" label={story.commentCount > 0 ? `${story.commentCount} ${story.commentCount === 1 ? 'comentário' : 'comentários'}` : 'Comentar'} onPress={onComments} n={story.commentCount} /> : null}
            <Pressable onPress={() => void cheer()} hitSlop={4} style={({ pressed }) => [st.barBtn, cheered && st.barBtnOn, pressed && { transform: [{ scale: 0.92 }] }]} accessibilityRole="button" accessibilityLabel="Brindar" accessibilityState={{ selected: cheered }}>
              <Icon name="cheers" size={26} color={cheered ? colors.brandWarm : '#fff'} strokeWidth={cheered ? 2.1 : 1.8} />
            </Pressable>
            {onShare ? <BarButton icon="share" label="Partilhar o mimo" onPress={onShare} size={24} /> : null}
          </>
        )}
      </View>
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
  /** O comentário de outra pessoa que se está a denunciar. */
  const [reporting, setReporting] = useState<string | null>(null);
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
                <NameWithBadge name={c.author.username} who={c.author} style={st.who}><Text style={st.whoAgo}>· {timeAgo(c.createdAt)}</Text></NameWithBadge>
                <RichText text={c.body} style={{ fontSize: 15, lineHeight: 21, color: colors.zinc900 }} />
              </View>
              {!c.mine && <Pressable onPress={() => setReporting(c.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Denunciar o comentário de ${c.author.username}`} style={{ padding: 6 }}><Icon name="flag" size={17} color={colors.zinc500} /></Pressable>}
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
      {/* O comentário denunciado sai logo da lista de quem denunciou (o servidor também já não o devolve). */}
      {reporting && <ReportSheet type="story_comment" id={reporting} onReported={refresh} onClose={() => setReporting(null)} />}
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
                  <NameWithBadge name={r.author.displayName} who={r.author} style={st.who}><Text style={st.whoAgo}>· {timeAgo(r.createdAt)}</Text></NameWithBadge>
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
                  <NameWithBadge name={v.displayName} who={v} style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} />
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
              <NameWithBadge name={f.displayName} who={f} style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} />
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
              <NameWithBadge name={p.displayName} who={p} style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} />
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
  // A barra do visor: vidro escuro sobre o fundo preto, por baixo do mimo.
  reactions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 26, backgroundColor: 'rgba(24,24,27,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', ...({ backdropFilter: 'blur(18px) saturate(1.4)', WebkitBackdropFilter: 'blur(18px) saturate(1.4)' } as object) },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  replyPill: { flex: 1, minWidth: 0, height: 44, flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.07)', paddingRight: 4 },
  replyPillOn: { borderColor: 'rgba(255,154,91,0.6)', backgroundColor: 'rgba(24,24,27,0.92)' },
  reply: { flex: 1, minWidth: 0, height: 42, paddingLeft: 18, paddingRight: 8, color: '#fff', fontSize: 15, outlineStyle: 'none' as never },
  send: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(214,51,79,0.45)' } as object,
  flashIn: { position: 'absolute', left: 16, right: 12, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  flash: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: '#fff' },
  barBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  barBtnOn: { backgroundColor: 'rgba(255,154,91,0.16)' },
  count: { position: 'absolute', top: 3, right: 1, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.brand, borderWidth: 1.5, borderColor: '#000', alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  none: { paddingVertical: 24, textAlign: 'center', color: colors.zinc500, fontSize: 16 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  who: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  whoAgo: { flexShrink: 0, fontSize: 14, color: colors.zinc500 },
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
