import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Animated, Easing, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import type { MixarReactionId } from '@/lib/api.mixar';
import { mixarSocialApi, mixarSocialKeys, type MixarComment, type MixarCommentsPage } from '@/lib/api.mixarSocial';
import { reactionOf } from '@/lib/mixar';
import {
  BURST_MS, canSend, COMMENT_MAX, commentA11y, commentBadge, commentErrorText, commentLeft, commentsEmpty, hereLine, moreLine, saveA11y,
  savedByText, savedEmpty, savedEnd, togetherLine, togetherSub, type Presence,
} from '@/lib/mixarSocial';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { Avatar } from '../Avatar';
import { BookmarkIcon } from '../BookmarkIcon';
import { Icon } from '../Icon';
import { NameWithBadge } from '../NameWithBadge';
import { ActivityIndicator } from '../PontoLoader';
import { ReportSheet } from '../ReportSheet';
import { RailButton } from '../reel/ReelExtraActions';
import { Sheet } from '../Sheet';
import { MIXAR_GRADIENT, ReactionGlyph } from './MixarBits';

const isWeb = Platform.OS === 'web';
const SHADOW = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;
type Who = { name: string; username?: string };
/** O outro, com o selo (verificado) para o nome. */
type Partner = Who & { displayName: string; verified?: boolean; verifiedTier?: 'verified' | 'official' | 'paid' | null };

/* ---------- Carril: a conversa e o marcador do Mixar ---------- */

/**
 * Os dois botões do Mixar no carril (por cima de «Mandar»): o balão da conversa só dos dois (com o número) e o marcador dos
 * Guardados do Mixar. Levam o anel do Mixar (o gradiente) para não se confundirem com os comentários e os guardados de sempre.
 */
export function MixarRailButtons({ comments, saved, partner, onComments, onToggleSave }: { comments: number; saved: boolean; partner: string; onComments: () => void; onToggleSave: () => void }) {
  const badge = commentBadge(comments);
  return (
    <>
      <RailButton
        icon={
          <MixarCircle>
            <Icon name="comment" size={26} color="#fff" />
            {badge ? <View style={st.badge} pointerEvents="none"><Text style={st.badgeText} allowFontScaling={false}>{badge}</Text></View> : null}
          </MixarCircle>
        }
        label="Conversa"
        onPress={onComments}
        accessibilityLabel={commentA11y(comments, partner)}
      />
      <RailButton
        icon={<MixarCircle on={saved}><BookmarkIcon on={saved} size={24} color={saved ? '#f5c518' : '#fff'} /></MixarCircle>}
        label={saved ? 'Guardado' : 'Guardar'}
        onPress={onToggleSave}
        selected={saved}
        accessibilityLabel={saveA11y(saved)}
      />
    </>
  );
}

function MixarCircle({ children, on = false }: { children: ReactNode; on?: boolean }) {
  return (
    <LinearGradient colors={MIXAR_GRADIENT} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={st.ring}>
      <View style={[st.inner, on && { backgroundColor: 'rgba(0,0,0,0.55)' }]}>{children}</View>
    </LinearGradient>
  );
}

/* ---------- A conversa do item ---------- */

/** A folha com a conversa daquele vídeo: só os dois a veem. O meu apaga-se; o do outro denuncia-se. */
export function MixarCommentsSheet({ mixarId, postId, partner, onClose }: { mixarId: string; postId: string; partner: Partner; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = mixarSocialKeys.comments(mixarId, postId);
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => mixarSocialApi.comments(mixarId, postId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l: MixarCommentsPage) => l.nextCursor ?? undefined,
  });
  // As páginas vêm da mais recente para as mais antigas; cada uma já da mais antiga para a mais recente.
  const items = q.data ? [...q.data.pages].reverse().flatMap((p) => p.items) : [];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reporting, setReporting] = useState<MixarComment | null>(null);
  const list = useRef<FlatList<MixarComment>>(null);
  // Fica no fim (o mais recente) até a pessoa pedir as mais antigas; enviar volta a pôr no fim.
  const stick = useRef(true);
  const left = commentLeft(text);
  const empty = commentsEmpty(partner.name);

  const refreshCounts = () => void qc.invalidateQueries({ queryKey: mixarSocialKeys.social(mixarId) });
  async function send() {
    if (!canSend(text, busy)) return;
    setBusy(true);
    setErr('');
    try {
      const c = await mixarSocialApi.comment(mixarId, postId, text.trim());
      qc.setQueryData<InfiniteData<MixarCommentsPage>>(key, (d) => (d ? { ...d, pages: d.pages.map((p, i) => (i === 0 ? { ...p, items: [...p.items.filter((x) => x.id !== c.id), c] } : p)) } : d));
      setText('');
      stick.current = true;
      refreshCounts();
      setTimeout(() => list.current?.scrollToEnd({ animated: true }), 60);
    } catch (e) {
      setErr(commentErrorText(e));
    } finally {
      setBusy(false);
    }
  }
  function remove(c: MixarComment) {
    const go = async () => {
      try {
        await mixarSocialApi.deleteComment(mixarId, c.id);
        qc.setQueryData<InfiniteData<MixarCommentsPage>>(key, (d) => (d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== c.id) })) } : d));
        refreshCounts();
      } catch {
        setErr('Não consegui apagar. Tenta outra vez.');
      }
    };
    if (isWeb) { void go(); return; }
    Alert.alert('Apagar o comentário?', `Deixa de se ver para ti e para ${partner.name}.`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Apagar', style: 'destructive', onPress: () => void go() }]);
  }
  const hide = (c: MixarComment) => qc.setQueryData<InfiniteData<MixarCommentsPage>>(key, (d) => (d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== c.id) })) } : d));

  if (reporting) return <ReportSheet type="mixar_comment" id={reporting.id} onClose={() => setReporting(null)} onReported={() => { hide(reporting); refreshCounts(); }} />;

  return (
    <Sheet title="Conversa sobre este vídeo" onClose={onClose}>
      <View style={st.private}>
        <Icon name="lock" size={14} color={colors.zinc500} />
        <Text style={st.privateText}>Só tu e {partner.name} veem isto</Text>
      </View>
      <FlatList
        ref={list}
        data={items}
        keyExtractor={(c) => c.id}
        style={{ maxHeight: 420 }}
        contentContainerStyle={{ paddingVertical: 4, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => { if (stick.current) list.current?.scrollToEnd({ animated: false }); }}
        ListHeaderComponent={q.hasNextPage ? (
          <Pressable onPress={() => { stick.current = false; void q.fetchNextPage(); }} disabled={q.isFetchingNextPage} style={st.older} accessibilityRole="button">
            {q.isFetchingNextPage ? <ActivityIndicator color={colors.brand} /> : <Text style={st.olderText}>Ver as mais antigas</Text>}
          </Pressable>
        ) : undefined}
        renderItem={({ item: c }) => (
          <View style={[st.row, c.mine && st.rowMine]}>
            {c.mine ? null : <Avatar name={c.author.displayName} username={c.author.hasAvatar ? c.author.username : undefined} size={32} />}
            <View style={[st.bubble, c.mine ? st.bubbleMine : st.bubbleTheirs]}>
              {c.mine ? null : <NameWithBadge name={c.author.displayName} who={c.author} style={st.author} />}
              <Text style={[st.body, c.mine && { color: '#fff' }]} selectable>{c.body}</Text>
              <View style={st.meta}>
                <Text style={[st.ago, c.mine && { color: 'rgba(255,255,255,0.8)' }]}>{timeAgo(c.createdAt)}</Text>
                {c.mine ? (
                  <Pressable onPress={() => remove(c)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Apagar o meu comentário">
                    <Text style={[st.action, { color: 'rgba(255,255,255,0.9)' }]}>Apagar</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => setReporting(c)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Denunciar o comentário de ${c.author.displayName}`}>
                    <Text style={st.action}>Denunciar</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={
          q.isPending ? <ActivityIndicator color={colors.brand} style={{ margin: 40 }} /> : q.isError ? (
            <View style={st.emptyBox} accessibilityRole="alert">
              <Text style={[st.emptyLine, { color: colors.red600 }]}>Ups, não consegui carregar</Text>
              <Pressable onPress={() => void q.refetch()} style={st.retry} accessibilityRole="button"><Text style={st.retryText}>Tentar outra vez</Text></Pressable>
            </View>
          ) : (
            <View style={st.emptyBox}>
              <Icon name="comment" size={36} color={colors.zinc300} />
              <Text style={st.emptyTitle}>{empty.title}</Text>
              <Text style={st.emptyLine}>{empty.line}</Text>
            </View>
          )
        }
      />
      <KeyboardAvoidingView behavior="padding" style={st.bar}>
        {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
        <View style={st.compose}>
          <Avatar name={user?.displayName ?? '?'} username={user?.username} size={34} />
          <View style={st.field}>
            <TextInput
              value={text}
              onChangeText={(t) => { setText(t); if (err) setErr(''); }}
              maxLength={COMMENT_MAX + 50}
              placeholder={`Diz a ${partner.name}…`}
              placeholderTextColor={colors.zinc500}
              style={st.input}
              multiline
              accessibilityLabel={`Escrever a ${partner.name} sobre este vídeo`}
              onSubmitEditing={() => void send()}
              blurOnSubmit={false}
              onKeyPress={isWeb ? (e) => { const k = e.nativeEvent as unknown as { key: string; shiftKey?: boolean; preventDefault?: () => void }; if (k.key === 'Enter' && !k.shiftKey) { (e as unknown as { preventDefault: () => void }).preventDefault?.(); void send(); } } : undefined}
            />
            {left.show ? <Text style={[st.left, left.over && { color: colors.red600 }]} accessibilityLabel={`Faltam ${Math.max(0, left.left)} caracteres`}>{left.left}</Text> : null}
            <Pressable onPress={() => void send()} disabled={!canSend(text, busy)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Enviar">
              {busy ? <ActivityIndicator color={colors.brand} /> : <Text style={[st.publish, !canSend(text) && { opacity: 0.45 }]}>Enviar</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Sheet>
  );
}

/* ---------- Ver juntos ---------- */

/** «Zeca está a ver contigo» (com o avatar e o selo), por baixo do cabeçalho. Noutro vídeo, tocar leva lá. */
export function TogetherBanner({ partner, presence, myPostId, known, onJump }: { partner: Partner; presence: Presence; myPostId: string | null; known: readonly string[]; onJump: (postId: string) => void }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: presence.here ? 1 : 0, duration: 220, useNativeDriver: !isWeb }).start();
  }, [presence.here, fade]);
  if (!presence.here) return null;
  const sub = togetherSub(presence, myPostId, known);
  const line = togetherLine(partner.name);
  return (
    <Animated.View style={[st.together, { opacity: fade }]} accessibilityLiveRegion="polite">
      <Pressable
        onPress={sub.jump ? () => onJump(sub.jump!) : undefined}
        disabled={!sub.jump}
        style={({ pressed }) => [st.togetherPill, pressed && { opacity: 0.85 }]}
        accessibilityRole={sub.jump ? 'button' : 'text'}
        accessibilityLabel={`${line}${sub.text ? `. ${sub.text}` : ''}`}
      >
        <View>
          <Avatar name={partner.displayName} username={partner.username} size={26} />
          <View style={st.liveDot} />
        </View>
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <NameWithBadge name={partner.name} who={partner} style={st.togetherName} gap={4}>
            <Text style={st.togetherRest} numberOfLines={1}>está a ver contigo</Text>
          </NameWithBadge>
          {sub.text ? <Text style={st.togetherSub} numberOfLines={1}>{sub.text}</Text> : null}
        </View>
        {sub.jump ? <Icon name="chevron-right" size={14} color="rgba(255,255,255,0.85)" strokeWidth={2.4} /> : null}
      </Pressable>
    </Animated.View>
  );
}

/** No item em que o outro está: «Zeca está aqui» (discreto, ao lado da razão). */
export function HereChip({ partner }: { partner: Partner }) {
  const line = hereLine(partner.name);
  return (
    <View style={st.here} accessibilityRole="text" accessibilityLabel={line}>
      <View style={st.hereDot} />
      <NameWithBadge name={partner.name} who={partner} style={st.hereText} gap={4}>
        <Text style={st.hereText} numberOfLines={1}>está aqui</Text>
      </NameWithBadge>
    </View>
  );
}

/**
 * A reação do outro a subir (por cima da barra das reações), com o avatar dele. `seq` muda a cada reação nova: a animação
 * recomeça. Some sozinha ao fim de BURST_MS.
 */
export function ReactionBurst({ reaction, seq, partner }: { reaction: MixarReactionId | null; seq: number; partner: Who }) {
  const t = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!reaction || !seq) return;
    setShown(true);
    t.setValue(0);
    const a = Animated.timing(t, { toValue: 1, duration: BURST_MS, easing: Easing.out(Easing.cubic), useNativeDriver: !isWeb });
    a.start(({ finished }) => { if (finished) setShown(false); });
    return () => a.stop();
  }, [seq, reaction, t]);
  const r = reactionOf(reaction);
  if (!shown || !r) return null;
  const y = t.interpolate({ inputRange: [0, 1], outputRange: [0, -150] });
  const op = t.interpolate({ inputRange: [0, 0.12, 0.75, 1], outputRange: [0, 1, 1, 0] });
  const sc = t.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0.4, 1.25, 1] });
  return (
    <Animated.View pointerEvents="none" style={[st.burst, { opacity: op, transform: [{ translateY: y }, { scale: sc }] }]} accessibilityLiveRegion="polite" accessibilityLabel={`${partner.name} reagiu com ${r.label}`}>
      <View style={st.burstGlyph}><ReactionGlyph r={r} size={34} /></View>
      <View style={st.burstFace}><Avatar name={partner.name} username={partner.username} size={20} /></View>
    </Animated.View>
  );
}

/** Nos Guardados: quem guardou («Guardado por Zeca», «Os dois reagiram»). */
export function SavedByChip({ by, partner }: { by: 'me' | 'them' | 'both'; partner: string }) {
  const text = savedByText(by, partner);
  return (
    <View style={st.savedBy} accessibilityRole="text" accessibilityLabel={text}>
      <BookmarkIcon on size={12} color="#f5c518" />
      <Text style={st.savedByText} numberOfLines={1}>{text}</Text>
    </View>
  );
}

/** O botão «Guardados» do cabeçalho do Mixar (abre a coleção dos dois). */
export function SavedHeaderButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [st.headBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Guardados do Mixar">
      <BookmarkIcon on={false} size={22} color="#fff" />
      <Text style={st.headBtnText} numberOfLines={1}>Guardados</Text>
    </Pressable>
  );
}

/** O fim dos Guardados (ou os Guardados vazios). */
export function SavedEndPage({ height, partner, empty, onBack }: { height: number; partner: string; empty: boolean; onBack: () => void }) {
  const t = empty ? savedEmpty(partner) : savedEnd;
  return (
    <View style={[{ height, width: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: '#0b0b0c' }, isWeb && ({ scrollSnapAlign: 'start', scrollSnapStop: 'always' } as object)]}>
      <LinearGradient colors={['rgba(245,197,24,0.18)', 'rgba(0,0,0,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.7 }} style={StyleSheet.absoluteFill} />
      <View style={st.savedIcon}><BookmarkIcon on size={34} color="#f5c518" /></View>
      <Text style={st.endTitle}>{t.title}</Text>
      <Text style={st.endLine}>{t.line}</Text>
      <Pressable onPress={onBack} style={({ pressed }) => [st.endBtn, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button">
        <Icon name="mixar" size={18} color="#fff" />
        <Text style={st.endBtnText}>Voltar ao Mixar</Text>
      </Pressable>
    </View>
  );
}

/* ---------- «Mais 5» ---------- */

/** No fim da seleção do dia: pede mais até 5 itens (no máximo 3 vezes por dia). */
export function MoreButton({ left, busy, note, onPress }: { left: number | null; busy: boolean; note: string | null; onPress: () => void }) {
  const off = left === 0;
  return (
    <View style={{ alignItems: 'center', marginTop: 24 }}>
      <Pressable onPress={onPress} disabled={busy || off} style={({ pressed }) => [st.more, off && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button" accessibilityState={{ disabled: busy || off, busy }} accessibilityHint="Junta até 5 vídeos novos à seleção de hoje">
        {busy ? <ActivityIndicator color="#fff" /> : <><Icon name="plus" size={18} color="#fff" strokeWidth={2.6} /><Text style={st.moreText}>Mais 5</Text></>}
      </Pressable>
      <Text style={st.moreLine} accessibilityLiveRegion="polite">{note ?? moreLine(left)}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  ring: { width: 46, height: 46, borderRadius: 23, padding: 2 },
  inner: { flex: 1, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -7, right: -9, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.brand, fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  private: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 8 },
  privateText: { fontSize: 13, color: colors.zinc500, fontWeight: '600' },
  older: { alignSelf: 'center', minHeight: 40, justifyContent: 'center', paddingHorizontal: 16 },
  olderText: { fontSize: 13, fontWeight: '700', color: colors.brand },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingVertical: 4 },
  rowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: colors.zinc100, borderBottomLeftRadius: 6 },
  author: { fontSize: 13, fontWeight: '700', color: colors.zinc900, marginBottom: 2 },
  body: { fontSize: 15, lineHeight: 20, color: colors.zinc900 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  ago: { fontSize: 12, color: colors.zinc500 },
  action: { fontSize: 12, fontWeight: '700', color: colors.zinc500 },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 32 },
  emptyTitle: { marginTop: 8, fontSize: 18, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  emptyLine: { marginTop: 4, fontSize: 15, lineHeight: 21, color: colors.zinc500, textAlign: 'center' },
  retry: { marginTop: 16, height: 44, paddingHorizontal: 24, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 15, fontWeight: '600', color: colors.zinc800 },
  bar: { borderTopWidth: 1, borderTopColor: colors.zinc200, paddingTop: 8, paddingBottom: 4 },
  err: { fontSize: 14, color: colors.red600, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 6 },
  compose: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16 },
  field: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.zinc300, borderRadius: 22, paddingLeft: 14, paddingRight: 10, minHeight: 44 },
  input: { flex: 1, minWidth: 0, paddingVertical: 10, fontSize: 15, color: colors.zinc900, maxHeight: 110, outlineStyle: 'none' } as object,
  left: { fontSize: 12, fontWeight: '700', color: colors.zinc500, fontVariant: ['tabular-nums'] },
  publish: { paddingHorizontal: 6, paddingVertical: 4, fontWeight: '800', color: colors.brand, fontSize: 15 },
  together: { alignSelf: 'center', marginTop: 8, paddingHorizontal: 16, maxWidth: '100%' },
  togetherPill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)', paddingLeft: 4, paddingRight: 12, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  liveDot: { position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#111' },
  togetherName: { color: '#fff', fontSize: 13, fontWeight: '800' },
  togetherRest: { color: '#fff', fontSize: 13, fontWeight: '600' },
  togetherSub: { color: 'rgba(255,255,255,0.78)', fontSize: 11, fontWeight: '600' },
  here: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.42)', paddingHorizontal: 8, paddingVertical: 3, maxWidth: '100%' },
  hereDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' },
  hereText: { color: '#fff', fontSize: 12, fontWeight: '700', ...SHADOW },
  burst: { position: 'absolute', left: 8, bottom: 40, alignItems: 'center', zIndex: 5 },
  burstGlyph: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  burstFace: { marginTop: -10, borderRadius: 12, borderWidth: 2, borderColor: '#fff', overflow: 'hidden' },
  savedBy: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.42)', paddingHorizontal: 8, paddingVertical: 3 },
  savedByText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  more: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, paddingHorizontal: 26, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  moreText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  headBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  headBtnText: { marginTop: 1, color: '#fff', fontSize: 10, fontWeight: '700', ...SHADOW },
  savedIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  endTitle: { marginTop: 20, fontSize: 24, lineHeight: 30, fontWeight: '900', color: '#fff', textAlign: 'center' },
  endLine: { marginTop: 8, fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.78)', textAlign: 'center', maxWidth: 330 },
  endBtn: { marginTop: 28, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 24 },
  endBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  moreLine: { marginTop: 8, fontSize: 13, color: 'rgba(255,255,255,0.7)', textAlign: 'center', minHeight: 18, maxWidth: 300 },
});
