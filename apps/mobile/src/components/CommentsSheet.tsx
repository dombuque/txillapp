import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRef, useState, useEffect } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { api, type Comment, type Post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { detectPaymentAsk } from '@/lib/chatIntent';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { MentionSuggest, useMentionSuggest } from './MentionSuggest';
import { ReportSheet } from './ReportSheet';
import { RichText } from './RichText';
import { Sheet } from './Sheet';
import { Sticker, StickerPanel } from './StickerPanel';
import { GifView, useGifsConfig } from './GifPanel';
import { gifPayload, validGif } from '@/lib/gifs';
import { VerifiedBadge } from './VerifiedBadge';

// Reações rápidas desenhadas com a mascote do Txillapp; ao tocar, escrevem o emoji no comentário (conteúdo do utilizador).
// As mesmas reações rápidas do site (vão para o texto do comentário).
const QUICK = ['🥂', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];
/** Um comentário que é só um sticker (uma personagem do Txillapp) guarda-se como [sticker:id]. */
const STICKER_RE = /^\[sticker:([a-z0-9-]+)\]$/;
export const stickerOf = (body: string) => STICKER_RE.exec(body)?.[1] ?? null;

interface RowProps {
  c: Comment;
  mine: boolean;
  canDelete: boolean;
  isReply?: boolean;
  onReply: (c: Comment) => void;
  onRemoved: (c: Comment) => void;
  onGift: (c: Comment, amount: number, note: string) => void;
  /** Veio de uma notificação: este comentário fica realçado. */
  highlighted?: boolean;
}

function Row({ c, mine, canDelete, isReply, onReply, onRemoved, onGift, highlighted }: RowProps) {
  const [cheer, setCheer] = useState({ cheered: c.cheered, cheers: c.cheers });
  const [text, setText] = useState({ body: c.body, editedAt: c.editedAt ?? null });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sel, setSel] = useState<{ start: number; end: number } | undefined>();
  const [saving, setSaving] = useState(false);
  const [editErr, setEditErr] = useState('');
  const [gone, setGone] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Pedido de pagamento no comentário de outra pessoa (que seguimos): o mesmo aviso do chat.
  const ask = !mine && !dismissed && c.authorFollowed ? detectPaymentAsk(text.body, c.author.displayName.split(' ')[0]) : null;

  async function toggle() {
    const prev = cheer;
    setCheer({ cheered: !prev.cheered, cheers: prev.cheers + (prev.cheered ? -1 : 1) });
    try {
      setCheer(await api.cheerComment(c.id));
    } catch {
      setCheer(prev);
    }
  }
  async function saveEdit() {
    const body = draft.trim();
    if (!body || saving) return;
    if (body === text.body) return setEditing(false);
    setSaving(true);
    setEditErr('');
    try {
      const r = await api.editComment(c.id, body);
      setText({ body: r.body, editedAt: r.editedAt ?? new Date().toISOString() });
      setEditing(false);
    } catch (e) {
      setEditErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function confirmDelete() {
    Alert.alert('Apagar o comentário?', 'O comentário desaparece e não dá para o recuperar.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: async () => {
          setGone(true);
          try {
            await api.deleteComment(c.id);
            onRemoved(c);
          } catch {
            setGone(false);
          }
        },
      },
    ]);
  }
  // Segurar no comentário abre o menu (responder, editar, apagar, denunciar), como no Instagram.
  // Fica antes do `return` do comentário apagado: um hook depois dele mudava a ordem dos hooks e o ecrã rebentava ao apagar.
  const [menu, setMenu] = useState(false);
  const openMenu = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    setMenu(true);
  };
  // Um comentário que é só um sticker ou só um GIF não tem texto para editar (com texto, edita-se o texto e o GIF fica).
  const startEdit = () => { if (stickerOf(text.body) || !text.body) return; setDraft(text.body); setSel({ start: text.body.length, end: text.body.length }); setEditing(true); };
  if (gone) return null;

  return (
    <Pressable onLongPress={openMenu} delayLongPress={380} style={[styles.row, highlighted && { backgroundColor: colors.rose50 }]} accessibilityHint="Segura para mais opções">
      <View style={{ alignSelf: 'flex-start' }}>
        <Avatar name={c.author.displayName} username={c.author.username} size={isReply ? 28 : 36} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.who}>
          <Text style={styles.user}>{c.author.username}</Text>
          {c.author.verified && <VerifiedBadge size={13} tier={c.author.verifiedTier} />}
          <Text style={styles.ago}>{timeAgo(c.createdAt)}{text.editedAt ? ' · editado' : ''}</Text>
        </View>
        {editing ? (
          <View style={{ marginTop: 4 }}>
            <TextInput value={draft} onChangeText={setDraft} selection={sel} onSelectionChange={() => setSel(undefined)} maxLength={1000} multiline autoFocus style={styles.edit} accessibilityLabel="Editar comentário" />
            {editErr ? <Text style={styles.err}>{editErr}</Text> : null}
            <View style={styles.editBtns}>
              <Pressable onPress={() => { setEditing(false); setEditErr(''); }} style={styles.cancel}><Text style={styles.cancelText}>Cancelar</Text></Pressable>
              <Pressable onPress={() => void saveEdit()} disabled={saving || !draft.trim()} style={[styles.save, (saving || !draft.trim()) && { opacity: 0.5 }]}>
                <Text style={styles.saveText}>{saving ? 'A guardar…' : 'Guardar'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          stickerOf(text.body) ? <View style={{ marginTop: 2 }}><Sticker id={stickerOf(text.body)!} size={96} /></View> : text.body ? <RichText text={text.body} style={styles.body} /> : null
        )}
        {validGif(c.gif) && <View style={{ marginTop: 6 }}><GifView gif={c.gif} /></View>}
        {ask && !editing && (
          <View style={styles.ask} accessibilityRole="summary">
            <View style={styles.askIcon}><Icon name="gift" size={18} color="#b45309" /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.askTitle} numberOfLines={1}>{ask.title}</Text>
              <Text style={styles.askHint}>{ask.hint}</Text>
            </View>
            <Pressable onPress={() => onGift(c, ask.amount, ask.note)} style={styles.askBtn}><Text style={styles.askBtnText}>Presentear</Text></Pressable>
            <Pressable onPress={() => setDismissed(true)} hitSlop={6} style={styles.askX} accessibilityLabel="Dispensar sugestão"><Icon name="x" size={16} color={colors.zinc500} /></Pressable>
          </View>
        )}
        <View style={styles.links}>
          {cheer.cheers > 0 && <Text style={styles.link}>{cheer.cheers} {cheer.cheers === 1 ? 'brinde' : 'brindes'}</Text>}
          <Pressable onPress={() => onReply(c)} hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} accessibilityRole="button"><Text style={styles.link}>Responder</Text></Pressable>
        </View>
      </View>
      <Pressable onPress={() => void toggle()} hitSlop={12} style={{ alignSelf: 'flex-start', paddingTop: 4 }} accessibilityRole="button" accessibilityLabel={cheer.cheered ? 'Tirar o brinde' : 'Brindar comentário'}>
        <Icon name="cheers" size={20} color={cheer.cheered ? colors.brand : '#a1a1aa'} />
      </Pressable>
      {reporting && <ReportSheet type="comment" id={c.id} onReported={() => onRemoved(c)} onClose={() => setReporting(false)} />}
      {menu && (
        <Sheet onClose={() => setMenu(false)}>
          <View style={styles.menu}>
            <Pressable onPress={() => { setMenu(false); onReply(c); }} style={styles.menuRow} accessibilityRole="button"><Icon name="reply" size={22} /><Text style={styles.menuText}>Responder</Text></Pressable>
            {mine && !editing && <Pressable onPress={() => { setMenu(false); startEdit(); }} style={styles.menuRow} accessibilityRole="button"><Icon name="pencil" size={22} /><Text style={styles.menuText}>Editar</Text></Pressable>}
            {canDelete && <Pressable onPress={() => { setMenu(false); setTimeout(confirmDelete, 250); }} style={styles.menuRow} accessibilityRole="button"><Icon name="trash" size={22} color={colors.red600} /><Text style={[styles.menuText, { color: colors.red600 }]}>Apagar</Text></Pressable>}
            {!mine && <Pressable onPress={() => { setMenu(false); setTimeout(() => setReporting(true), 250); }} style={styles.menuRow} accessibilityRole="button"><Icon name="flag" size={22} /><Text style={styles.menuText}>Denunciar</Text></Pressable>}
          </View>
        </Sheet>
      )}
    </Pressable>
  );
}

function Replies({ c, meId, expanded, toggle, canDeleteFor, onReply, onRemoved, onGift, highlight }: { c: Comment; meId?: string; expanded: boolean; toggle: () => void; canDeleteFor: (c: Comment) => boolean; onReply: (c: Comment) => void; onRemoved: (c: Comment) => void; onGift: RowProps['onGift']; highlight?: string }) {
  const q = useInfiniteQuery({
    queryKey: ['replies', c.id],
    queryFn: ({ pageParam }) => api.replies(c.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: expanded && c.replyCount > 0,
  });
  if (c.replyCount === 0) return null;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <View style={{ marginLeft: 48 }}>
      <Pressable onPress={toggle} style={styles.thread}>
        <View style={styles.threadLine} />
        <Text style={styles.link}>{expanded ? 'Ocultar respostas' : `Ver ${c.replyCount} ${c.replyCount === 1 ? 'resposta' : 'respostas'}`}</Text>
      </Pressable>
      {expanded && (
        <View>
          {items.map((r) => (
            <Row key={r.id} c={r} mine={r.author.id === meId} isReply canDelete={canDeleteFor(r)} onReply={onReply} onRemoved={onRemoved} onGift={onGift} highlighted={r.id === highlight} />
          ))}
          {q.isLoading && <ActivityIndicator color={colors.brand} style={{ margin: 8 }} />}
          {q.hasNextPage && (
            <Pressable onPress={() => void q.fetchNextPage()} style={styles.thread}>
              <View style={styles.threadLine} />
              <Text style={styles.link}>Ver mais respostas</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/** Comentários de uma publicação: igual ao do site (responder, brindar, editar, apagar, denunciar e aviso de pedido de pagamento). */
export function CommentsSheet({ post, onClose, onDelta, onGift, highlight }: { post: Post; onClose: () => void; onDelta: (n: number) => void; onGift: (to: { username: string; displayName: string }, amount: number, note: string) => void; /** Comentário a realçar (vindo de uma notificação). */ highlight?: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // "a escrever…": avisa o servidor enquanto se escreve (no máximo de 2 em 2 s) e pergunta quem mais está a escrever.
  const lastPing = useRef(0);
  const typers = useQuery({ queryKey: ['typing', post.id], queryFn: () => api.typers(post.id), refetchInterval: 3000, staleTime: 0, gcTime: 0 });
  function onType(t: string) {
    setText(t);
    const now = Date.now();
    if (t.trim() && now - lastPing.current > 2000) {
      lastPing.current = now;
      void api.typingPing(post.id).catch(() => undefined);
    }
  }
  const typing = typers.data ?? [];
  // @: sugere primeiro o autor e quem já comentou nesta publicação, depois as pessoas mais próximas.
  const mention = useMentionSuggest({ text, setText, inputRef: input, context: 'post', id: post.id });

  const q = useInfiniteQuery({
    queryKey: ['comments', post.id],
    queryFn: ({ pageParam }) => api.comments(post.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  // Vindo de uma notificação: leva ao comentário. Se não está entre os de cima, é uma resposta: abrem-se as conversas para o mostrar.
  const list = useRef<FlatList<Comment>>(null);
  const jumped = useRef(false);
  useEffect(() => {
    if (!highlight || jumped.current || !q.isSuccess) return;
    const k = items.findIndex((c) => c.id === highlight);
    if (k >= 0) {
      jumped.current = true;
      setTimeout(() => list.current?.scrollToIndex({ index: k, animated: true, viewPosition: 0.3 }), 250);
    } else if (!q.hasNextPage) {
      jumped.current = true;
      setExpanded((s) => { const n = new Set(s); items.forEach((c) => { if (c.replyCount > 0) n.add(c.id); }); return n; });
    } else if (!q.isFetchingNextPage) void q.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, items.length, q.isSuccess, q.hasNextPage, q.isFetchingNextPage]);
  const canDeleteFor = (c: Comment) => c.author.id === user?.id || post.author.id === user?.id;

  function reply(c: Comment) {
    setReplyTo(c);
    setText(`@${c.author.username} `);
    setExpanded((s) => new Set(s).add(c.parentId ?? c.id));
    input.current?.focus();
  }
  const [stickers, setStickers] = useState<null | 'stickers' | 'gif'>(null);
  const gifs = useGifsConfig();
  /** `explicit`: um sticker ([sticker:id]). `gif`: um GIF do GIPHY, com o texto que estiver escrito (ou sem texto). */
  async function submit(explicit?: string, gif?: import('@/lib/gifs').ChatGif) {
    const body = (explicit ?? text).trim();
    if ((!body && !gif) || busy) return;
    setBusy(true);
    setErr('');
    try {
      const c = await api.addComment(post.id, body, replyTo?.id, gif);
      onDelta(1);
      if (!explicit) setText('');
      setReplyTo(null);
      if (c.parentId) {
        setExpanded((s) => new Set(s).add(c.parentId!));
        await qc.invalidateQueries({ queryKey: ['replies', c.parentId] });
      }
      await qc.invalidateQueries({ queryKey: ['comments', post.id] });
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function removed(c: Comment) {
    onDelta(-(1 + c.replyCount));
    void qc.invalidateQueries({ queryKey: ['comments', post.id] });
    if (c.parentId) void qc.invalidateQueries({ queryKey: ['replies', c.parentId] });
  }
  const gift = (c: Comment, amount: number, note: string) => onGift({ username: c.author.username, displayName: c.author.displayName }, amount, note);

  return (
    <Sheet title="Comentários" onClose={onClose} full plain>
      <View style={styles.head}><Text style={styles.headTitle}>Comentários</Text></View>
      <FlatList
        ref={list}
        onScrollToIndexFailed={() => undefined}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: 8 }}
        data={items}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: c }) => (
          <View>
            <Row c={c} mine={c.author.id === user?.id} canDelete={canDeleteFor(c)} onReply={reply} onRemoved={removed} onGift={gift} highlighted={c.id === highlight} />
            <Replies
              c={c}
              highlight={highlight}
              meId={user?.id}
              expanded={expanded.has(c.id)}
              toggle={() => setExpanded((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
              canDeleteFor={canDeleteFor}
              onReply={reply}
              onRemoved={removed}
              onGift={gift}
            />
          </View>
        )}
        ListEmptyComponent={
          q.isPending ? <ActivityIndicator color={colors.brand} style={{ margin: 40 }} /> : q.isError ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }} accessibilityRole="alert">
              <Text style={[styles.empty, { color: colors.red600, paddingVertical: 0 }]}>Ups, não consegui carregar</Text>
              <Pressable onPress={() => void q.refetch()} style={styles.retry} accessibilityRole="button"><Text style={styles.retryText}>Tentar outra vez</Text></Pressable>
            </View>
          ) : (
            <View style={{ paddingVertical: 56, alignItems: 'center' }}>
              <Icon name="comment-off" size={36} color={colors.zinc300} />
              <Text style={styles.emptyTitle}>Ainda ninguém disse nada</Text>
              <Text style={styles.empty}>Sê o primeiro a puxar conversa</Text>
            </View>
          )
        }
        onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
        ListFooterComponent={<View style={{ minHeight: 8 }}>{q.isFetchingNextPage ? <ActivityIndicator color={colors.brand} style={{ margin: 12 }} /> : null}</View>}
      />
      {!post.canComment && post.author.id !== user?.id ? (
        <View style={styles.off}>
          <Icon name="bell-off" size={16} color={colors.zinc600} />
          <Text style={styles.offText}>{post.author.displayName} desativou os comentários nesta publicação.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView behavior="padding" style={styles.bar}>
          {replyTo && (
            <View style={styles.replying}>
              <Text style={styles.replyingText}>A responder a <Text style={{ fontWeight: '700' }}>{replyTo.author.displayName}</Text></Text>
              <Pressable onPress={() => { setReplyTo(null); setText(''); }} hitSlop={8} accessibilityLabel="Cancelar resposta"><Text style={{ fontSize: 18, color: colors.zinc600, paddingHorizontal: 8 }}>×</Text></Pressable>
            </View>
          )}
          {typing.length > 0 && (
            <Text style={styles.typing} accessibilityLiveRegion="polite">
              {typing.length === 1 ? `${typing[0]} está a escrever…` : typing.length === 2 ? `${typing[0]} e ${typing[1]} estão a escrever…` : `${typing[0]} e mais ${typing.length - 1} estão a escrever…`}
            </Text>
          )}
          {stickers && <View style={{ maxHeight: gifs.enabled ? 340 : 300 }}><StickerPanel key={stickers} start={stickers} onPick={(id) => { setStickers(null); void submit(`[sticker:${id}]`); }} onGif={(g) => { setStickers(null); void submit(undefined, gifPayload(g)); }} /></View>}
          <View style={styles.quick}>
            {QUICK.map((e) => (
              <Pressable key={e} onPress={() => { setText((t) => t + e); input.current?.focus(); }} accessibilityLabel={`Adicionar ${e}`} style={({ pressed }) => [pressed && { transform: [{ scale: 1.25 }] }]}><Text style={{ fontSize: 24, lineHeight: 32 }}>{e}</Text></Pressable>
            ))}
            <Pressable onPress={() => setStickers((v) => (v === 'stickers' ? null : 'stickers'))} accessibilityRole="button" accessibilityLabel="Stickers" accessibilityState={{ expanded: stickers === 'stickers' }} style={[{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, stickers === 'stickers' && { backgroundColor: colors.rose50 }]}>
              <Icon name="sticker" size={24} color={stickers === 'stickers' ? colors.brand : colors.zinc700} />
            </Pressable>
            {gifs.enabled && (
              // GIF do GIPHY no comentário (vai com o texto que estiver escrito, ou sozinho).
              <Pressable onPress={() => setStickers((v) => (v === 'gif' ? null : 'gif'))} hitSlop={6} accessibilityRole="button" accessibilityLabel="GIF" accessibilityHint="Escolher um GIF para o comentário" accessibilityState={{ expanded: stickers === 'gif' }} style={[styles.gifBtn, stickers === 'gif' && { backgroundColor: colors.rose50, borderColor: colors.brand }]}>
                <Text style={[styles.gifBtnText, stickers === 'gif' && { color: colors.brand }]}>GIF</Text>
              </Pressable>
            )}
          </View>
          <MentionSuggest mention={mention} style={{ marginTop: 8 }} />
          <View style={styles.compose}>
            <Avatar name={user?.displayName ?? '?'} username={user?.username} size={36} />
            <View style={styles.field}>
              <TextInput ref={input} value={text} onChangeText={onType} {...mention.inputProps} maxLength={1000} placeholder={replyTo ? `Responder a ${replyTo.author.username}…` : 'Diz lá…'} placeholderTextColor={colors.zinc500} style={styles.input} accessibilityLabel="Escrever comentário" returnKeyType="send" onSubmitEditing={() => void submit()} />
              <Pressable onPress={() => void submit()} disabled={!text.trim() || busy} hitSlop={6}><Text style={[styles.publish, (!text.trim() || busy) && { opacity: 0.6 }]}>Publicar</Text></Pressable>
            </View>
          </View>
          {err ? <Text style={[styles.err, { textAlign: 'center', paddingHorizontal: 16 }]}>{err}</Text> : null}
        </KeyboardAvoidingView>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  gifBtn: { minWidth: 44, height: 32, borderRadius: 8, borderWidth: 1.5, borderColor: colors.zinc700, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  gifBtnText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: colors.zinc700 },
  head: { borderBottomWidth: 1, borderBottomColor: colors.zinc200, paddingBottom: 12 },
  headTitle: { textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 10, paddingHorizontal: 16 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  user: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  ago: { fontSize: 14, color: colors.zinc500, marginLeft: 4 },
  body: { fontSize: 15, lineHeight: 20, color: colors.zinc800 },
  links: { marginTop: 4, flexDirection: 'row', gap: 16 },
  link: { fontSize: 12, fontWeight: '600', color: colors.zinc500 },
  menu: { paddingHorizontal: 8, paddingBottom: 8 },
  menuRow: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, borderRadius: 16 },
  menuText: { fontSize: 17, fontWeight: '500', color: colors.zinc900 },
  thread: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  threadLine: { width: 28, height: 1, backgroundColor: colors.zinc300 },
  edit: { borderWidth: 1, borderColor: colors.zinc300, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, minHeight: 72, textAlignVertical: 'top', color: colors.zinc900 },
  editBtns: { marginTop: 6, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  cancel: { height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.zinc700 },
  save: { height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  err: { fontSize: 14, color: colors.red600 },
  ask: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: '#fffbeb', padding: 8, paddingLeft: 10 },
  askIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fef3c7', alignItems: 'center', justifyContent: 'center' },
  askTitle: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  askHint: { fontSize: 12, color: colors.zinc600 },
  askBtn: { height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  askBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  askX: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  retry: { marginTop: 16, height: 44, paddingHorizontal: 24, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 15, fontWeight: '600', color: colors.zinc800 },
  empty: { fontSize: 16, color: colors.zinc500, textAlign: 'center', paddingVertical: 20 },
  emptyTitle: { marginTop: 8, fontSize: 18, fontWeight: '700', color: colors.zinc900 },
  off: { borderTopWidth: 1, borderTopColor: colors.zinc200, paddingHorizontal: 16, paddingVertical: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  offText: { color: colors.zinc600, textAlign: 'center', flexShrink: 1 },
  bar: { borderTopWidth: 1, borderTopColor: colors.zinc200, paddingBottom: 4 },
  replying: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 8 },
  replyingText: { fontSize: 14, color: colors.zinc600 },
  typing: { paddingHorizontal: 16, paddingTop: 8, fontSize: 13, color: colors.zinc500, fontStyle: 'italic' },
  quick: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  compose: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.zinc300, borderRadius: 999, paddingLeft: 16, paddingRight: 8 },
  input: { flex: 1, minWidth: 0, paddingVertical: 10, fontSize: 15, color: colors.zinc900, outlineStyle: 'none' } as object,
  publish: { paddingHorizontal: 8, paddingVertical: 4, fontWeight: '600', color: colors.brand },
});
