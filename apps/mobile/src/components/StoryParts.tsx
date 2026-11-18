import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import Reanimated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { api, type Story, type StoryComment } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SITE_URL } from '@/lib/config';
import { confirm } from '@/lib/confirm';
import { colors, dark as D } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { Avatar } from './Avatar';
import { CheersPour } from './CheersPour';
import { NameWithBadge } from './NameWithBadge';
import { Icon } from './Icon';
import { MentionSuggest, useMentionSuggest } from './MentionSuggest';
import { ReportSheet } from './ReportSheet';
import { RichText } from './RichText';
import { Sheet } from './Sheet';
import { Sticker, StickerPanel } from './StickerPanel';
import { GifHiddenCard, GifView, TxillappReaction, useGifsConfig } from './GifPanel';
import { stickerOf } from './CommentsSheet';
import { TXILLAPP_GIF, gifPayload, validGif } from '@/lib/gifs';
import type { ChatGif } from '@/lib/gifs';
import { SearchField } from './ui/SearchField';
import { SegmentedTabs } from './ui/SegmentedTabs';
import { SendButton } from './ui/SendButton';
import { linkShare } from '@/lib/shareLink';
import { t } from '@/lib/i18n';

/** Reações a stories: a mesma mascote dos stickers, sem texto (guardam-se como :nome:). */
export const REACTIONS: { id: string; label: string; art: string }[] = [
  { id: ':rir:', get label() { return t('Rir'); }, art: 'rir' },
  { id: ':uau:', get label() { return t('Uau'); }, art: 'uau' },
  { id: ':amor:', get label() { return t('Adorar'); }, art: 'amor' },
  { id: ':snif:', get label() { return t('Triste'); }, art: 'snif' },
  { id: ':palmas:', get label() { return t('Fixe'); }, art: 'fixe' },
  { id: ':fogo:', get label() { return t('Bora'); }, art: 'bora' },
  { id: ':brinde:', get label() { return t('Brindar'); }, art: 'saude' },
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

/**
 * O painel do visor (mimos e Txillada: menu, atividade, comentários, quem está a ver, oferecer): a folha escura de sempre
 * (Sheet `dark`, por cima do vídeo), com o título, a pega e, nos menus de ações, «Cancelar» no fim (`cancel`).
 * Arrastar para baixo fecha só o painel (o mimo ou a Txillada continuam por baixo).
 */
export function Panel({ title, onClose, children, cancel = false }: { title: string; onClose: () => void; children: ReactNode; cancel?: boolean }) {
  return (
    <Sheet title={title} onClose={onClose} dark cancel={cancel}>
      <View style={st.panelBody}>{children}</View>
    </Sheet>
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
      flash(REACTIONS.some((r) => r.id === body) ? t('{reactionLabel} enviado!', { reactionLabel: reactionLabel(body) }) : t('Mensagem enviada'));
    } catch (e) { flash((e as Error).message); } finally { setBusy(false); }
  }
  const focus = (v: boolean) => { setOpen(v); onFocusChange(v); };
  const typed = !!text.trim();

  return (
    <View style={{ width: '100%' }}>
      {open && (
        <View style={st.reactions}>
          {REACTIONS.map((r) => (
            <Pressable key={r.id} onPress={() => void send(r.id)} style={({ pressed }) => pressed && { transform: [{ scale: 0.88 }] }} accessibilityRole="button" accessibilityLabel={t('Reagir: {label}', { label: r.label })} hitSlop={4}><ReactionArt body={r.id} size={38} /></Pressable>
          ))}
        </View>
      )}
      <View style={st.barRow}>
        <View style={[st.replyPill, open && st.replyPillOn]}>
          <TextInput ref={inputRef} value={text} onChangeText={setText} onFocus={() => focus(true)} onBlur={() => focus(false)} maxLength={500} placeholder={msg && !text ? '' : compact && !open ? t('Responder…') : t('Responder a {username}…', { username })} placeholderTextColor="rgba(255,255,255,0.62)" returnKeyType="send" onSubmitEditing={() => void send(text)} style={st.reply} accessibilityLabel={t('Responder ao mimo de {username}', { username })} />
          {msg && !text ? (
            <View style={st.flashIn} pointerEvents="none">
              <Icon name="check-circle" size={16} color={colors.brandWarm} />
              <Text style={st.flash} numberOfLines={1} accessibilityRole="alert">{msg}</Text>
            </View>
          ) : null}
          {typed ? <SendButton onPress={() => void send(text)} disabled={busy} /> : null}
        </View>
        {!open && (
          <>
            {onComments ? <BarButton icon="comment" label={story.commentCount > 0 ? t('{count} comentário', { count: story.commentCount, other: '{count} comentários' }) : t('Comentar')} onPress={onComments} /> : null}
            <Pressable onPress={() => void cheer()} hitSlop={4} style={({ pressed }) => [st.barBtn, cheered && st.barBtnOn, pressed && { transform: [{ scale: 0.92 }] }]} accessibilityRole="button" accessibilityLabel={t('Brindar')} accessibilityState={{ selected: cheered }}>
              <Icon name="cheers" size={26} color={cheered ? colors.brandWarm : '#fff'} strokeWidth={cheered ? 2.1 : 1.8} />
            </Pressable>
            {onShare ? <BarButton icon="share" label={t('Partilhar o mimo')} onPress={onShare} size={24} /> : null}
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
  // @ nos comentários do mimo: o autor primeiro, depois as pessoas mais próximas.
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const mention = useMentionSuggest({ text, setText, inputRef, context: 'story', id: story.id });
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ['stories', story.author.username] }); };

  /** Painel de autocolantes/GIFs aberto por baixo do campo (como nos comentários das publicações). */
  const [stickers, setStickers] = useState<null | 'stickers' | 'gif'>(null);
  const gifs = useGifsConfig();
  /** `explicit`: um autocolante ([sticker:id]). `gif`: um GIF, com o texto que estiver escrito (ou sem texto). */
  async function send(explicit?: string, gif?: ChatGif) {
    const body = (explicit ?? text).trim();
    if ((!body && !gif) || busy) return;
    setBusy(true);
    setErr('');
    try { await api.commentStory(story.id, body, gif); if (explicit === undefined) setText(''); setStickers(null); refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function del(id: string) {
    if (!(await confirm({ title: t('Apagar o comentário?'), message: t('O comentário desaparece e não dá para o recuperar.'), confirm: t('Apagar'), danger: true }))) return;
    await api.deleteStoryComment(id).catch(() => undefined);
    refresh();
  }
  return (
    <Panel title={t('Comentários{value}', { value: list.data ? ` (${list.data.length})` : '' })} onClose={onClose}>
      {/* O teclado: a folha (Sheet) sobe sozinha por cima dele. */}
      <View>
        <ScrollView style={{ maxHeight: 320, minHeight: 96 }}>
          {list.isLoading && <ActivityIndicator style={{ margin: 24 }} color="#fff" />}
          {list.isSuccess && list.data.length === 0 && <Text style={st.none}>{t('Ainda sem comentários. Sê o primeiro')}</Text>}
          {list.data?.map((c) => <StoryCommentRow key={c.id} c={c} onReport={() => setReporting(c.id)} onDelete={() => void del(c.id)} />)}
        </ScrollView>
        {canComment ? <MentionSuggest mention={mention} style={{ marginHorizontal: 0, marginTop: 8, marginBottom: 0 }} /> : null}
        {canComment && stickers ? <View style={{ maxHeight: gifs.enabled ? 320 : 280, marginTop: 8 }}><StickerPanel key={stickers} start={stickers} onPick={(id) => void send(`[sticker:${id}]`)} onGif={(g) => void send('', gifPayload(g))} /></View> : null}
        {canComment ? (
          <View style={st.compose}>
            <Avatar name={user?.displayName ?? '?'} username={user?.username} size={32} />
            <TextInput ref={inputRef} value={text} onChangeText={setText} {...mention.inputProps} onFocus={() => { onTyping(true); mention.inputProps.onFocus(); }} onBlur={() => { onTyping(false); mention.inputProps.onBlur(); }} maxLength={500} placeholder={t('Adiciona um comentário…')} placeholderTextColor={D.sub} returnKeyType="send" onSubmitEditing={() => void send()} style={st.commentInput} accessibilityLabel={t('Comentário')} />
            {text.trim() ? null : (
              <>
                <TxillappReaction onDark width={40} disabled={busy} label={t('Comentar com o GIF Txillapp')} onPress={() => void send('', gifPayload(TXILLAPP_GIF))} />
                <Pressable onPress={() => setStickers((v) => (v === 'stickers' ? null : 'stickers'))} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('Stickers')} accessibilityState={{ expanded: stickers === 'stickers' }} style={[st.pickBtn, stickers === 'stickers' && st.pickOn]}>
                  <Icon name="sticker" size={22} color={stickers === 'stickers' ? colors.brand : D.text} />
                </Pressable>
                {gifs.enabled ? (
                  <Pressable onPress={() => setStickers((v) => (v === 'gif' ? null : 'gif'))} hitSlop={6} accessibilityRole="button" accessibilityLabel="GIF" accessibilityHint={t('Escolher um GIF para o comentário')} accessibilityState={{ expanded: stickers === 'gif' }} style={[st.gifBtn, stickers === 'gif' && st.pickOn]}>
                    <Text style={[st.gifBtnText, stickers === 'gif' && { color: colors.brand }]}>GIF</Text>
                  </Pressable>
                ) : null}
              </>
            )}
            <Pressable onPress={() => void send()} disabled={!text.trim() || busy} accessibilityRole="button"><Text style={{ paddingHorizontal: 8, fontWeight: '700', fontSize: 16, color: colors.brand, opacity: !text.trim() || busy ? 0.4 : 1 }}>{t('Publicar')}</Text></Pressable>
          </View>
        ) : (
          <Text style={st.closed}>{t('Este mimo não aceita comentários.')}</Text>
        )}
        {err ? <Text style={{ marginTop: 4, textAlign: 'center', fontSize: 14, color: '#fca5a5' }}>{err}</Text> : null}
      </View>
      {/* O comentário denunciado sai logo da lista de quem denunciou (o servidor também já não o devolve). */}
      {reporting && <ReportSheet type="story_comment" id={reporting} onReported={refresh} onClose={() => setReporting(null)} />}
    </Panel>
  );
}

/**
 * Um comentário do mimo na folha, com o brinde como nos comentários das publicações (components/CommentsSheet): o copo à
 * direita põe e tira; dois toques no comentário só põem (já brindado, só os copos). Ao pôr: os copos pequenos por cima, o
 * ícone salta e o telemóvel vibra. A contagem sobe logo e acerta com a resposta do servidor.
 */
function StoryCommentRow({ c, onReport, onDelete }: { c: StoryComment; onReport: () => void; onDelete: () => void }) {
  const [cheer, setCheer] = useState({ cheered: !!c.cheered, cheers: c.cheers ?? 0 });
  useEffect(() => { setCheer({ cheered: !!c.cheered, cheers: c.cheers ?? 0 }); }, [c.cheered, c.cheers]);
  const [burst, setBurst] = useState(0);
  const pop = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  function celebrate() {
    setBurst((n) => n + 1);
    pop.value = withSequence(withTiming(1.45, { duration: 120 }), withSpring(1, { damping: 7, stiffness: 260 }));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }
  async function toggle() {
    const prev = cheer;
    if (!prev.cheered) celebrate();
    setCheer({ cheered: !prev.cheered, cheers: Math.max(0, prev.cheers + (prev.cheered ? -1 : 1)) });
    try {
      const r = await api.cheerStoryComment(c.id);
      setCheer({ cheered: !!r.cheered, cheers: r.cheers });
    } catch {
      setCheer(prev);
    }
  }
  const lastTap = useRef(0);
  function onRowPress() {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      if (cheer.cheered) celebrate();
      else void toggle();
      return;
    }
    lastTap.current = now;
  }
  return (
    <Pressable onPress={onRowPress} style={st.item} accessibilityHint={t('Dois toques para brindar')}>
      <Avatar name={c.author.displayName} username={c.author.hasAvatar ? c.author.username : undefined} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <NameWithBadge name={c.author.username} who={c.author} style={st.who}><Text style={st.whoAgo}>· {timeAgo(c.createdAt)}</Text></NameWithBadge>
        {stickerOf(c.body) ? <View style={{ marginTop: 2 }}><Sticker id={stickerOf(c.body)!} size={88} /></View> : c.body ? <RichText text={c.body} style={{ fontSize: 15, lineHeight: 21, color: D.text }} /> : null}
        {c.gifHidden ? <View style={{ marginTop: 6 }}><GifHiddenCard /></View> : validGif(c.gif) ? <View style={{ marginTop: 6 }}><GifView gif={c.gif} onDark /></View> : null}
        {cheer.cheers > 0 && <Text style={st.cheers}>{cheer.cheers} {cheer.cheers === 1 ? t('brinde') : t('brindes')}</Text>}
      </View>
      {!c.mine && <Pressable onPress={onReport} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Denunciar o comentário de {username}', { username: c.author.username })} style={{ padding: 6 }}><Icon name="flag" size={17} color={D.sub} /></Pressable>}
      {c.canDelete && <Pressable onPress={onDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Apagar comentário')} style={{ padding: 6 }}><Icon name="trash" size={18} color={D.sub} /></Pressable>}
      <Pressable onPress={() => void toggle()} hitSlop={10} style={{ padding: 6 }} accessibilityRole="button" accessibilityLabel={cheer.cheered ? t('Tirar o brinde') : t('Brindar comentário')} accessibilityState={{ selected: cheer.cheered }}>
        <Reanimated.View style={popStyle}><Icon name="cheers" size={19} color={cheer.cheered ? colors.brandWarm : D.sub} /></Reanimated.View>
      </Pressable>
      <CheersPour n={burst} size={96} />
    </Pressable>
  );
}

/** Atividade do teu story: quem viu (e brindou) e as respostas. */
export function ActivityPanel({ story, onClose }: { story: Story; onClose: () => void }) {
  const [tab, setTab] = useState<'viewers' | 'replies'>('viewers');
  const viewers = useQuery({ queryKey: ['story-viewers', story.id], queryFn: () => api.storyViewers(story.id) });
  const replies = useQuery({ queryKey: ['story-replies', story.id], queryFn: () => api.storyReplies(story.id) });
  const tabs = [
    { value: 'viewers' as const, label: t('Visualizações{value}', { value: story.viewCount ? ` (${story.viewCount})` : '' }) },
    { value: 'replies' as const, label: t('Respostas{value}', { value: replies.data ? ` (${replies.data.length})` : '' }) },
  ];
  return (
    <Panel title={t('Atividade do mimo')} onClose={onClose}>
      <SegmentedTabs tabs={tabs} value={tab} onChange={setTab} dark style={{ marginBottom: 12 }} />
      <ScrollView style={{ maxHeight: 360 }}>
        {tab === 'replies' && (
          <>
            {replies.isLoading && <ActivityIndicator style={{ margin: 24 }} color="#fff" />}
            {replies.isSuccess && replies.data.length === 0 && <Text style={st.none}>{t('Ainda sem respostas')}</Text>}
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
            {viewers.isLoading && <ActivityIndicator style={{ margin: 24 }} color="#fff" />}
            {viewers.isSuccess && viewers.data.length === 0 && <Text style={st.none}>{t('Ainda ninguém viu')}</Text>}
            {viewers.data?.map((v) => (
              <View key={v.username} style={[st.item, { alignItems: 'center' }]}>
                <Avatar name={v.displayName} username={v.username} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <NameWithBadge name={v.displayName} who={v} style={{ fontSize: 16, fontWeight: '600', color: D.text }} />
                  <Text style={{ fontSize: 14, color: D.sub }} numberOfLines={1}>@{v.username}</Text>
                </View>
                {v.cheered && <Icon name="cheers" size={18} color={colors.brandWarm} />}
                <Text style={{ fontSize: 14, color: D.sub }}>{timeAgo(v.viewedAt)}</Text>
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
    <Sheet title={t('Amigos próximos')} onClose={onClose} full>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <Text style={{ marginBottom: 12, fontSize: 14, color: colors.zinc600 }}>{t('Só estas pessoas veem o que marcares para amigos próximos: mimos, notas, Zás, Txilladas e a geleira. Elas não sabem que estão na lista.')}</Text>
        <Text style={st.sec}>{t('Na tua lista ({n})', { n: friends.data?.length ?? 0 })}</Text>
        {friends.data?.length === 0 && <Text style={{ paddingVertical: 8, fontSize: 14, color: colors.zinc500 }}>{t('Ainda ninguém. Escolhe abaixo')}</Text>}
        {friends.data?.map((f) => (
          <View key={f.username} style={[st.item, { alignItems: 'center' }]}>
            <Avatar name={f.displayName} username={f.hasAvatar ? f.username : undefined} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <NameWithBadge name={f.displayName} who={f} style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} />
              <Text style={{ fontSize: 14, color: colors.zinc500 }} numberOfLines={1}>@{f.username}</Text>
            </View>
            <Pressable onPress={() => void toggle(f.username, false)} style={[st.pill, { backgroundColor: '#ecfdf5' }]} accessibilityRole="button"><Text style={{ fontWeight: '700', fontSize: 14, color: '#047857' }}>{t('Na lista')}</Text></Pressable>
          </View>
        ))}
        <Text style={[st.sec, { marginTop: 16 }]}>{t('Adicionar dos teus seguidores')}</Text>
        <SearchField value={q} onChangeText={setQ} placeholder={t('Procurar…')} accessibilityLabel={t('Procurar seguidores')} style={{ marginTop: 4 }} />
        {candidates.map((p) => (
          <View key={p.username} style={[st.item, { alignItems: 'center' }]}>
            <Avatar name={p.displayName} username={p.username} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <NameWithBadge name={p.displayName} who={p} style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} />
              <Text style={{ fontSize: 14, color: colors.zinc500 }} numberOfLines={1}>@{p.username}</Text>
            </View>
            <Pressable onPress={() => void toggle(p.username, true)} style={[st.pill, { backgroundColor: colors.brand }]} accessibilityRole="button"><Text style={{ fontWeight: '700', fontSize: 14, color: '#fff' }}>{t('Adicionar')}</Text></Pressable>
          </View>
        ))}
        {followers.isSuccess && candidates.length === 0 && <Text style={{ paddingVertical: 12, fontSize: 14, color: colors.zinc500 }}>{q ? t('Ninguém com esse nome') : t('Não há mais seguidores para adicionar')}</Text>}
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  panelBody: { paddingHorizontal: 20 },
  // A barra do visor: vidro escuro sobre o fundo preto, por baixo do mimo.
  reactions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 26, backgroundColor: 'rgba(24,24,27,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', ...({ backdropFilter: 'blur(18px) saturate(1.4)', WebkitBackdropFilter: 'blur(18px) saturate(1.4)' } as object) },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  replyPill: { flex: 1, minWidth: 0, height: 44, flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.07)', paddingRight: 4 },
  replyPillOn: { borderColor: 'rgba(255,154,91,0.6)', backgroundColor: 'rgba(24,24,27,0.92)' },
  reply: { flex: 1, minWidth: 0, height: 42, paddingLeft: 18, paddingRight: 8, color: '#fff', fontSize: 15, outlineStyle: 'none' as never },

  flashIn: { position: 'absolute', left: 16, right: 12, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  flash: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: '#fff' },
  barBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  barBtnOn: { backgroundColor: 'rgba(255,154,91,0.16)' },
  count: { position: 'absolute', top: 3, right: 1, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.brand, borderWidth: 1.5, borderColor: '#000', alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  // Dentro do painel escuro (folhas por cima do mimo): as letras e os campos em tons claros.
  none: { paddingVertical: 24, textAlign: 'center', color: D.sub, fontSize: 16 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  who: { fontSize: 14, fontWeight: '700', color: D.text },
  whoAgo: { flexShrink: 0, fontSize: 14, color: D.sub },
  cheers: { marginTop: 4, fontSize: 13, fontWeight: '600', color: D.sub },
  compose: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: D.line, paddingTop: 12 },
  pickBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pickOn: { backgroundColor: 'rgba(214,51,79,0.18)', borderColor: colors.brand },
  gifBtn: { minWidth: 40, height: 30, borderRadius: 8, borderWidth: 1.5, borderColor: D.sub, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  gifBtnText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: D.text },
  commentInput: { flex: 1, height: 44, borderRadius: 22, backgroundColor: D.raised, paddingHorizontal: 16, fontSize: 15, color: D.text, outlineStyle: 'none' as never },
  closed: { marginTop: 8, borderRadius: 12, backgroundColor: D.raised, paddingHorizontal: 12, paddingVertical: 10, textAlign: 'center', fontSize: 14, color: D.sub },
  bubble: { marginTop: 2, alignSelf: 'flex-start', borderRadius: 16, borderTopLeftRadius: 6, backgroundColor: D.raised, paddingHorizontal: 14, paddingVertical: 8, fontSize: 16, color: D.text, overflow: 'hidden' },
  sec: { marginBottom: 4, fontSize: 14, fontWeight: '600', color: colors.zinc500 },
  pill: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 },
});
