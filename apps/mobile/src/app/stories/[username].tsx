import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAudioPlayer } from 'expo-audio';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, PanResponder, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { RichText } from '@/components/RichText';
import { ActivityPanel, CommentsPanel, Panel, ReplyBar, useKeyboardHeight } from '@/components/StoryParts';
import { useVisibleViewport } from '@/components/zas/useVisibleViewport';
import { api, type Story } from '@/lib/api';
import { abs, sized } from '@/lib/config';
import { useOwnSeen, writeOwnSeen } from '@/lib/ownSeen';
import { useAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/time';

const IMAGE_MS = 5000;
const expiresIn = (iso: string) => {
  const h = Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000);
  return h <= 0 ? 'a expirar' : `expira em ${h} h`;
};

function VideoStory({ url, paused, onEnd, onDuration }: { url: string; paused: boolean; onEnd: () => void; onDuration: (ms: number) => void }) {
  const player = useVideoPlayer(url, (p) => { p.loop = false; p.play(); });
  useEffect(() => {
    const a = player.addListener('playToEnd', onEnd);
    const b = player.addListener('statusChange', () => { if (player.duration) onDuration(player.duration * 1000); });
    return () => { a.remove(); b.remove(); };
  }, [player, onEnd, onDuration]);
  useEffect(() => { if (paused) player.pause(); else player.play(); }, [paused, player]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

/** A música do story: toca enquanto está à vista (pára se pausares) e tem botão para silenciar. */
function StoryMusic({ track, paused }: { track: NonNullable<Story['music']>; paused: boolean }) {
  const player = useAudioPlayer(abs(track.url) ?? '');
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    try { player.loop = true; player.play(); } catch { /* sem áudio */ }
    return () => { try { player.pause(); } catch { /* já libertado */ } };
  }, [player]);
  useEffect(() => { try { if (paused) player.pause(); else player.play(); } catch { /* */ } }, [paused, player]);
  useEffect(() => { try { player.volume = muted ? 0 : 1; } catch { /* */ } }, [muted, player]);
  return (
    <View style={st.music}>
      <Icon name="music" size={16} color="#fff" />
      <Text style={st.musicText} numberOfLines={1}>{track.title}{track.kind === 'clip' ? '' : ` · ${track.artist || 'Autor desconhecido'}`}</Text>
      <Pressable onPress={() => setMuted((m) => !m)} style={st.musicBtn} accessibilityRole="button" accessibilityLabel={muted ? 'Ativar o som' : 'Silenciar'}><Icon name={muted ? 'volume-off' : 'volume'} size={18} color="#fff" /></Pressable>
    </View>
  );
}

/** Ver os stories de uma pessoa: barras, toca à direita/esquerda, segura para pausar, arrasta para baixo para sair e para cima para responder (ou ver a atividade, nos teus). */
export default function StoryViewer() {
  const { username = '' } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width > 520;
  const kb = useKeyboardHeight();
  // Na web (iPhone) o teclado tapa a página sem a encolher: o visor passa a ocupar só a zona visível e a página não rola.
  const vv = useVisibleViewport();
  const vvOn = Platform.OS === 'web' && !!vv && typeof window !== 'undefined' && vv.height < window.innerHeight - 120;
  useEffect(() => {
    if (!vvOn || typeof window === 'undefined') return;
    const fix = () => window.scrollTo(0, 0);
    fix();
    window.addEventListener('scroll', fix);
    return () => window.removeEventListener('scroll', fix);
  }, [vvOn, vv?.top, vv?.height]);
  const q = useQuery({ queryKey: ['stories', username], queryFn: () => api.storiesOf(username), retry: false, refetchOnMount: 'always' });
  const tray = useQuery({ queryKey: ['stories'], queryFn: api.stories });
  const stories = q.data ?? [];
  const [i, setI] = useState(0);
  const [ready, setReady] = useState(false); // já se escolheu por onde começar
  const ownSeen = useOwnSeen();
  const [held, setHeld] = useState(false);
  const [typing, setTyping] = useState(false);
  const [panel, setPanel] = useState<null | 'menu' | 'viewers' | 'comments'>(null);
  const [away, setAway] = useState(false); // outro ecrã por cima (ex.: a publicação)
  const [seePost, setSeePost] = useState(false);
  const [videoMs, setVideoMs] = useState<number | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const pval = useRef(0);
  const down = useRef(0);
  const replyRef = useRef<React.ComponentRef<typeof TextInput> | null>(null);
  const cur: Story | undefined = stories[i];
  const mine = username === me?.username;
  const dy = useRef(new Animated.Value(0)).current;
  const paused = held || typing || panel !== null || away;

  useFocusEffect(useCallback(() => { setAway(false); }, []));
  useEffect(() => {
    const id = progress.addListener(({ value }) => { pval.current = value; });
    return () => progress.removeListener(id);
  }, [progress]);

  const close = () => {
    void qc.invalidateQueries({ queryKey: ['stories'] });
    router.back();
  };
  // Ordem como no site: os teus (se tiveres) e depois os outros. Avança para o próximo ainda por ver.
  const order = (tray.data ?? []).slice().sort((a, b) => Number(b.isMe) - Number(a.isMe));
  const at = order.findIndex((t) => t.username === username);
  const goUser = (u?: string) => (u ? router.replace(`/stories/${u}` as never) : close());
  const next = () => {
    if (i + 1 < stories.length) return setI(i + 1);
    const nu = order.find((t, n) => n > at && !t.seen);
    goUser(nu?.username);
  };
  const prev = () => {
    if (i > 0) return setI(i - 1);
    if (at > 0) return goUser(order[at - 1].username);
    pval.current = 0;
    progress.setValue(0);
  };

  // Abre no primeiro story ainda não visto dessa pessoa (ou no primeiro, se já viu todos).
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!q.isSuccess || q.isFetching || started.current === username) return;
    started.current = username;
    // Os meus: o servidor não conta o autor, por isso "visto" é o que este aparelho guardou (hora do último visto).
    const firstNew = mine ? stories.findIndex((x) => !ownSeen || x.createdAt > ownSeen) : stories.findIndex((x) => !x.seen);
    setI(firstNew === -1 ? 0 : firstNew);
    setReady(true);
  }, [q.isSuccess, q.isFetching, username]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (q.isSuccess && stories.length === 0) next();
  }, [q.isSuccess, stories.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setVideoMs(null);
    setSeePost(false);
    if (!ready || !cur) return;
    if (!mine) void api.viewStory(cur.id).catch(() => undefined);
    // Os meus: fica guardado até onde vi (o servidor não conta o autor); no último, o anel apaga-se.
    else if (!ownSeen || cur.createdAt > ownSeen) void writeOwnSeen(i === stories.length - 1 ? ((tray.data ?? []).find((t) => t.isMe)?.latestAt ?? cur.createdAt) : cur.createdAt);
  }, [cur?.id, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!seePost) return;
    const t = setTimeout(() => setSeePost(false), 4000);
    return () => clearTimeout(t);
  }, [seePost]);

  const total = cur?.mediaKind === 'video' ? Math.min(videoMs ?? cur.durationMs ?? IMAGE_MS, 30_000) : IMAGE_MS;
  // Nova história: barra do início. Pausa e retoma: continua de onde estava.
  useEffect(() => {
    pval.current = 0;
    progress.setValue(0);
  }, [cur?.id, progress]);
  useEffect(() => {
    if (!cur || paused) return;
    const a = Animated.timing(progress, { toValue: 1, duration: Math.max(200, total * (1 - pval.current)), easing: Easing.linear, useNativeDriver: false });
    a.start(({ finished }) => finished && next());
    return () => a.stop();
  }, [cur?.id, paused, total]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useRef(
    PanResponder.create({
      // Com um painel aberto (visualizações, comentários, menu) o gesto é do painel: não sai do story.
      onMoveShouldSetPanResponder: (_e, g) => !panelOpen.current && Math.abs(g.dy) > 14 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_e, g) => dy.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110) return closeRef.current();
        Animated.spring(dy, { toValue: 0, useNativeDriver: false }).start();
        if (g.dy < -70) upRef.current();
      },
    }),
  ).current;
  const panelOpen = useRef(false);
  panelOpen.current = panel !== null;
  const closeRef = useRef(close);
  closeRef.current = close;
  const upRef = useRef(() => undefined as void);
  upRef.current = () => {
    if (panel) return;
    if (mine) setPanel('viewers');
    else replyRef.current?.focus();
  };

  async function remove() {
    if (!cur) return;
    setPanel(null);
    Alert.alert('Apagar o mimo?', 'Desaparece para toda a gente.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: async () => { await api.deleteStory(cur.id).catch(() => undefined); await q.refetch(); void qc.invalidateQueries({ queryKey: ['stories'] }); if (stories.length <= 1) close(); } },
    ]);
  }
  async function toggleComments() {
    if (!cur) return;
    await api.setStoryComments(cur.id, !cur.commentsOff).catch(() => undefined);
    setPanel(null);
    await q.refetch();
  }
  const tap = (fn: () => void) => () => { if (Date.now() - down.current < 250) fn(); };
  const hold = { onPressIn: () => { down.current = Date.now(); setHeld(true); }, onPressOut: () => setHeld(false) };

  if (q.isLoading) return <View style={st.center}><ActivityIndicator color="#fff" /></View>;
  if (q.isError || !cur) {
    return (
      <View style={st.center}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Este mimo já não está disponível</Text>
        <Pressable onPress={close} style={st.btn}><Text style={{ color: '#fff', fontWeight: '700' }}>Fechar</Text></Pressable>
      </View>
    );
  }
  const shared = !!cur.sharedFrom;
  const chip = (icon: 'eye' | 'cheers' | 'comment', n: number, label: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={st.chip} accessibilityRole="button" accessibilityLabel={`${n} ${label}`}>
      <Icon name={icon} size={18} color="#fff" strokeWidth={icon === 'eye' ? 2 : undefined} />
      <Text style={st.chipText}>{n}</Text>
    </Pressable>
  );

  return (
    <View style={[{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }, vvOn && vv ? { position: 'absolute', left: 0, right: 0, top: vv.top, height: vv.height } : null]}>
      <Animated.View
        style={[st.root, wide && { maxWidth: 460, borderRadius: 24, overflow: 'hidden', maxHeight: 860 }, { transform: [{ translateY: dy }], opacity: dy.interpolate({ inputRange: [0, 300], outputRange: [1, 0.4], extrapolate: 'clamp' }) }]}
        {...pan.panHandlers}
      >
        {/* Fundo desfocado da própria foto: a imagem aparece inteira, sem barras pretas */}
        <View style={StyleSheet.absoluteFill}>
          {cur.mediaKind === 'video' ? (
            <VideoStory key={cur.id} url={abs(cur.mediaUrl) ?? ''} paused={paused} onEnd={next} onDuration={setVideoMs} />
          ) : (
            <>
              <Image source={{ uri: sized(cur.mediaUrl, 160) }} style={[StyleSheet.absoluteFill, { opacity: 0.7, transform: [{ scale: 1.25 }] }]} contentFit="cover" blurRadius={40} />
              <Image source={{ uri: sized(cur.mediaUrl, 1080) }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel={cur.caption ?? `Mimo de ${cur.author.displayName}`} />
            </>
          )}
        </View>

        {typing && <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} pointerEvents="none" />}
        <Pressable style={[st.zone, { left: 0, width: shared ? '30%' : '33%' }]} {...hold} onPress={tap(() => { setSeePost(false); prev(); })} accessibilityLabel="Anterior" />
        {shared && <Pressable style={[st.zone, { left: '30%', width: '40%' }]} {...hold} onPress={tap(() => setSeePost((v) => !v))} accessibilityLabel="Mostrar a ligação à publicação" />}
        <Pressable style={[st.zone, { right: 0, width: shared ? '30%' : '67%' }]} {...hold} onPress={tap(() => { setSeePost(false); next(); })} accessibilityLabel="Seguinte" />

        {shared && seePost && (
          <Pressable onPress={() => { setAway(true); router.push(`/${cur.mediaKind === 'video' ? 'r' : 'p'}/${cur.sharedFrom!.postId}` as never); }} style={st.seePost} accessibilityRole="button">
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{cur.mediaKind === 'video' ? 'Ver tcheka' : 'Ver publicação'}</Text>
            <Icon name="chevron-right" size={16} color="#fff" strokeWidth={3} />
          </Pressable>
        )}

        <LinearGradient colors={['rgba(0,0,0,0.6)', 'transparent']} style={[st.top, { paddingTop: Math.max(insets.top, 12) }]} pointerEvents="box-none">
          <View style={st.bars} pointerEvents="none">
            {stories.map((s, n) => (
              <View key={s.id} style={st.track}>
                <Animated.View style={[st.fill, { width: n < i ? '100%' : n === i ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) : '0%' }]} />
              </View>
            ))}
          </View>
          <View style={st.who} pointerEvents="box-none">
            <Avatar name={cur.author.displayName} username={cur.author.username} size={40} />
            <View style={{ flex: 1, minWidth: 0 }} pointerEvents="none">
              <Text style={st.name} numberOfLines={1}>{cur.author.username}</Text>
              <Text style={st.ago}>{timeAgo(cur.createdAt)}{mine ? ` · ${expiresIn(cur.expiresAt)}` : ''}</Text>
            </View>
            {mine && <Pressable onPress={() => setPanel('menu')} style={st.circle} accessibilityRole="button" accessibilityLabel="Mais opções"><Icon name="more" size={24} color="#fff" strokeWidth={2.4} /></Pressable>}
            <Pressable onPress={close} style={st.circle} accessibilityRole="button" accessibilityLabel="Fechar"><Icon name="x" size={24} color="#fff" strokeWidth={2} /></Pressable>
          </View>
        </LinearGradient>

        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={[st.bottom, { paddingBottom: Math.max(insets.bottom, 20) + (kb ? kb - insets.bottom : 0) }]} pointerEvents="box-none">
          {!typing && cur.music && <StoryMusic key={cur.id} track={cur.music} paused={paused} />}
          {!typing && cur.caption ? <View style={st.caption}><RichText text={cur.caption} style={{ color: '#fff', fontSize: 18, lineHeight: 24, textAlign: 'center' }} /></View> : null}
          {mine && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {chip('eye', cur.viewCount ?? 0, 'visualizações', () => setPanel('viewers'))}
              {chip('cheers', cur.cheerCount ?? 0, 'brindes', () => setPanel('viewers'))}
              {chip('comment', cur.commentCount, 'comentários', () => setPanel('comments'))}
            </View>
          )}
          {!mine && !typing && (
            <Pressable onPress={() => setPanel('comments')} style={[st.chip, { minHeight: 40, backgroundColor: 'rgba(0,0,0,0.4)' }]} accessibilityRole="button">
              <Icon name="comment" size={18} color="#fff" />
              <Text style={st.chipText}>{cur.commentCount > 0 ? `${cur.commentCount} ${cur.commentCount === 1 ? 'comentário' : 'comentários'}` : 'Comentar'}</Text>
            </Pressable>
          )}
          {!mine && cur.canReply && <ReplyBar key={cur.id} story={cur} username={cur.author.username} onFocusChange={setTyping} inputRef={replyRef} />}
          {!mine && !cur.canReply && <Text style={st.noReply}>Este mimo não aceita respostas</Text>}
        </LinearGradient>

        {panel === 'menu' && (
          <Panel title="O teu mimo" onClose={() => setPanel(null)}>
            <Pressable onPress={() => { close(); router.push('/settings' as never); }} style={st.menuRow}><Text style={st.menuText}>Definições do mimo</Text></Pressable>
            <Pressable onPress={() => void toggleComments()} style={st.menuRow}><Text style={st.menuText}>{cur.commentsOff ? 'Ativar comentários' : 'Desativar comentários'}</Text></Pressable>
            <Pressable onPress={() => void remove()} style={st.menuRow}><Text style={[st.menuText, { color: '#dc2626', fontWeight: '600' }]}>Apagar mimo</Text></Pressable>
            <Pressable onPress={() => setPanel(null)} style={st.menuRow}><Text style={st.menuText}>Cancelar</Text></Pressable>
          </Panel>
        )}
        {panel === 'comments' && <CommentsPanel story={cur} canComment={mine || cur.canReply} onTyping={setTyping} onClose={() => setPanel(null)} />}
        {panel === 'viewers' && <ActivityPanel story={cur} onClose={() => setPanel(null)} />}
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, width: '100%', backgroundColor: '#18181b' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  btn: { borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 24, paddingVertical: 12 },
  zone: { position: 'absolute', top: 112, bottom: 112 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, paddingBottom: 40 },
  bars: { flexDirection: 'row', gap: 4 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2, backgroundColor: '#fff' },
  who: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: '#fff', fontWeight: '600', fontSize: 16 },
  ago: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  circle: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 64, gap: 12, alignItems: 'center' },
  caption: { maxWidth: '100%', borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 16, paddingVertical: 8 },
  chip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 16 },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  noReply: { borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 16, paddingVertical: 8, textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.9)', overflow: 'hidden' },
  seePost: { position: 'absolute', left: '50%', top: '50%', marginLeft: -80, marginTop: -22, zIndex: 10, minHeight: 44, width: 160, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, backgroundColor: 'rgba(63,63,70,0.9)' },
  music: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)', paddingVertical: 4, paddingLeft: 16, paddingRight: 4 },
  musicText: { flexShrink: 1, color: '#fff', fontSize: 14, fontWeight: '600' },
  musicBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  menuRow: { paddingVertical: 14, alignItems: 'center' },
  menuText: { fontSize: 18, color: '#18181b' },
});
