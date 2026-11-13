import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { limitBuffer } from '@/lib/videoMemory';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, AppState, Easing, PanResponder, PixelRatio, Platform, Pressable, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { NameWithBadge } from '@/components/NameWithBadge';
import { Icon } from '@/components/Icon';
import { ReportSheet } from '@/components/ReportSheet';
import { RichText } from '@/components/RichText';
import { CheersPour } from '@/components/CheersPour';
import { ActivityPanel, CommentsPanel, Panel, ReplyBar, useKeyboardHeight } from '@/components/StoryParts';
import { useVisibleViewport } from '@/components/zas/useVisibleViewport';
import { sheetViewport } from '@/lib/sheetViewport';
import { api, type Story } from '@/lib/api';
import { SITE_URL, abs, sized } from '@/lib/config';
import { servedWidth } from '@/lib/photoSize';
import { useOwnSeen, writeOwnSeen } from '@/lib/ownSeen';
import { firstToWatch, markSeen, nextOwnSeen, seenUpTo } from '@/lib/ownStorySeen';
import { useAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/time';
import { saveToGallery } from '@/lib/saveToGallery';
import { StickerLayer } from '@/components/Stickers';
import { isGone } from '@/lib/postCache';
import { storyPaused } from '@/lib/storyPlayback';
import { freshEnough, startIndex, storyFit } from '@/lib/storyLink';
import { artistHref } from '@/lib/artists';
import { MusicPill } from '@/components/PostMusic';
import { SoundWaves } from '@/components/SoundWaves';
import { trackColors } from '@/lib/musicLook';
import { useMusicMuted } from '@/lib/musicPlayer';
import { finePointer, overlayOpen } from '@/lib/desktopKeys';
import { useViewerKeys } from '@/lib/desktopHooks';

/** Quanto tempo fica à vista um mimo de foto (os de vídeo duram o vídeo, até 30 s). */
const IMAGE_MS = 30_000;
/** Para que lado se saiu da pessoa anterior (a seguinte entra desse lado). Vive fora do ecrã porque a rota é substituída. */
let lastDir: 1 | -1 | 0 = 0;
const expiresIn = (iso: string) => {
  const h = Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000);
  return h <= 0 ? 'a expirar' : `expira em ${h} h`;
};

/**
 * Vídeo do mimo na web: um <video> com playsInline, sem controlos, a ocupar o mimo (no iPhone, sem playsInline, o Safari
 * abria o leitor do sistema em ecrã inteiro). Tenta tocar com som; se o browser não deixar, toca sem som e mostra o botão.
 */
function WebVideoStory({ url, paused, onEnd, onDuration }: { url: string; paused: boolean; onEnd: () => void; onDuration: (ms: number) => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (paused) { v.pause(); return; }
    v.muted = muted;
    void v.play().catch(() => { v.muted = true; setMuted(true); void v.play().catch(() => undefined); });
  }, [paused, muted, url]);
  return (
    <>
      {createElement('video', {
        ref, src: url, playsInline: true, 'webkit-playsinline': 'true', autoPlay: true, preload: 'auto', controls: false, disablePictureInPicture: true,
        onEnded: onEnd,
        onLoadedMetadata: (e: { currentTarget: HTMLVideoElement }) => { if (Number.isFinite(e.currentTarget.duration)) onDuration(e.currentTarget.duration * 1000); },
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000', pointerEvents: 'none' },
      })}
      <Pressable onPress={() => setMuted((m) => !m)} style={st.videoMute} accessibilityRole="button" accessibilityLabel={muted ? 'Ativar o som' : 'Silenciar'}>
        <Icon name={muted ? 'volume-off' : 'volume'} size={18} color="#fff" />
      </Pressable>
    </>
  );
}

function VideoStory({ url, paused, onEnd, onDuration }: { url: string; paused: boolean; onEnd: () => void; onDuration: (ms: number) => void }) {
  const player = useVideoPlayer(url, (p) => { limitBuffer(p, 'full'); p.loop = false; p.play(); });
  useEffect(() => {
    const a = player.addListener('playToEnd', onEnd);
    const b = player.addListener('statusChange', () => { if (player.duration) onDuration(player.duration * 1000); });
    return () => { a.remove(); b.remove(); };
  }, [player, onEnd, onDuration]);
  useEffect(() => { if (paused) player.pause(); else player.play(); }, [paused, player]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

/**
 * A música do mimo: toca enquanto está à vista (pára se pausares ou se a app sair do ecrã) e tem botão para silenciar (o
 * som da app, o mesmo das publicações). Diz ao visor se está a tocar com som (`onLive`), para as ondas no meio da foto.
 */
function StoryMusic({ track, paused, onLive }: { track: NonNullable<Story['music']>; paused: boolean; onLive?: (live: { playing: boolean; player: AudioPlayer | null }) => void }) {
  const player = useAudioPlayer(abs(track.url) ?? '');
  const status = useAudioPlayerStatus(player);
  const [muted, toggleMute] = useMusicMuted();
  const router = useRouter();
  // Programa de artistas: «♪ Título · Artista», e tocar leva ao perfil do artista.
  const artistTo = artistHref(track);
  const [bg, setBg] = useState(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st2) => setBg(st2 !== 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    try { player.loop = true; player.play(); } catch { /* sem áudio */ }
    return () => { try { player.pause(); } catch { /* já libertado */ } };
  }, [player]);
  useEffect(() => { try { if (paused || bg) player.pause(); else player.play(); } catch { /* */ } }, [paused, bg, player]);
  // `muted` e não `volume`: no Safari do iPhone o volume de um áudio não se pode mudar (fica sempre a 1), por isso o
  // botão mostrava «sem som» mas a música continuava. O `muted` funciona em todo o lado.
  useEffect(() => { try { player.muted = muted; player.volume = 1; } catch { /* */ } }, [muted, player]);
  const playing = !!status.playing && !paused && !bg;
  useEffect(() => { onLive?.({ playing, player: playing ? player : null }); }, [playing, player, onLive]);
  useEffect(() => () => onLive?.({ playing: false, player: null }), [onLive]);
  // Vidro escuro à esquerda, com largura máxima: longe da assinatura «txillapp @…» do canto de baixo à direita.
  return <MusicPill track={track} live={playing} muted={muted} onToggleMute={toggleMute} onArtist={artistTo ? () => router.push(artistTo as never) : undefined} />;
}

/** Ver os stories de uma pessoa: barras, toca à direita/esquerda, segura para pausar, arrasta para baixo para sair e para cima para responder (ou ver a atividade, nos teus). */
export default function StoryViewer() {
  const { username = '', m: wantedMedia } = useLocalSearchParams<{ username: string; m?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width > 520;
  // A música do mimo está a tocar (com o leitor, para as ondas medirem o som na web).
  const [tune, setTune] = useState<{ playing: boolean; player: AudioPlayer | null }>({ playing: false, player: null });
  const [tuneMuted] = useMusicMuted();
  const kb = useKeyboardHeight();
  // Na web (iPhone) o teclado tapa a página sem a encolher: o visor passa a ocupar só a zona visível e a página não rola.
  const vv = useVisibleViewport();
  const vvOn = Platform.OS === 'web' && typeof window !== 'undefined' && !!sheetViewport(vv, window.innerHeight, window.innerWidth);
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
  const ownSeen = useOwnSeen(me?.username);
  const [holding, setHeld] = useState(false);
  /** Computador: o espaço pausa e retoma o mimo. */
  const [kbPaused, setKbPaused] = useState(false);
  const [typing, setTyping] = useState(false);
  /** Muda a cada brinde: os copos aparecem no meio do mimo, como nas publicações. */
  const [burst, setBurst] = useState(0);
  const [panel, setPanel] = useState<null | 'menu' | 'viewers' | 'comments' | 'more' | 'report'>(null);
  const [away, setAway] = useState(false); // outro ecrã por cima (ex.: a publicação)
  const [seePost, setSeePost] = useState(false);
  const [photoRatio, setPhotoRatio] = useState<{ id: string; r: number } | null>(null); // a forma da foto (para encher o ecrã quando é parecida)
  const [box, setBox] = useState({ w: 0, h: 0 }); // o tamanho do ecrã do mimo (para pousar os stickers)
  const [saving, setSaving] = useState(false); // a guardar o mimo na galeria (antes do primeiro `return`, como todos os hooks)
  const [videoMs, setVideoMs] = useState<number | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const pval = useRef(0);
  const down = useRef(0);
  /** O mimo aberto acabou de ser denunciado (ao fechar a folha passa-se ao seguinte). */
  const reported = useRef(false);
  const replyRef = useRef<React.ComponentRef<typeof TextInput> | null>(null);
  const cur: Story | undefined = stories[i];
  const mine = username === me?.username;
  const dy = useRef(new Animated.Value(0)).current;
  const dx = useRef(new Animated.Value(0)).current;
  // A app saiu do ecrã (ou o separador do browser ficou escondido): o mimo pára onde estava e continua ao voltar.
  const [background, setBackground] = useState(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setBackground(s !== 'active'));
    return () => sub.remove();
  }, []);
  // Segurar (dedo ou rato) ou o espaço do teclado (computador) pausam.
  const held = holding || kbPaused;
  const paused = storyPaused({ held, typing, panelOpen: panel !== null, away, background });
  // Com rato (computador) não se arrasta o mimo: muda-se com os cliques nas metades, com ←/→ e fecha-se com Esc.
  const mouse = finePointer();

  useFocusEffect(useCallback(() => { setAway(false); }, []));
  useEffect(() => {
    const id = progress.addListener(({ value }) => { pval.current = value; });
    return () => progress.removeListener(id);
  }, [progress]);

  // Fechar sai sempre: volta ao ecrã anterior ou, se o mimo foi aberto sem nada antes (notificação, link, depois de
  // publicar), vai para o Início. Antes só voltava, e sem ecrã anterior ficava preso até o mimo acabar.
  const close = () => {
    setAway(true);
    void qc.invalidateQueries({ queryKey: ['stories'] });
    if (router.canGoBack()) router.back();
    else router.replace('/' as never);
  };
  // Ordem como no site: os teus (se tiveres) e depois os outros. Avança para o próximo ainda por ver.
  const order = (tray.data ?? []).slice().sort((a, b) => Number(b.isMe) - Number(a.isMe));
  const at = order.findIndex((t) => t.username === username);
  const goUser = (u?: string, dir: 1 | -1 = 1) => { if (!u) return close(); lastDir = dir; router.replace(`/stories/${u}` as never); };
  // Entrada: desliza do lado por onde se veio (como a passagem de pessoa a pessoa no Instagram).
  const enter = useRef(new Animated.Value(lastDir === 0 ? 1 : 0)).current;
  const enterDir = useRef(lastDir).current;
  useEffect(() => {
    lastDir = 0;
    Animated.timing(enter, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [enter]);
  // Pré-carrega a pessoa seguinte (lista e primeira foto) e a foto seguinte desta, para a passagem não esperar pela rede.
  useEffect(() => {
    const nu = order.find((t, n) => n > at && !t.seen) ?? order[at + 1];
    if (nu) {
      void qc.prefetchQuery({ queryKey: ['stories', nu.username], queryFn: () => api.storiesOf(nu.username), staleTime: 30_000 }).then(() => {
        const first = qc.getQueryData<Story[]>(['stories', nu.username])?.find((x) => !x.seen) ?? qc.getQueryData<Story[]>(['stories', nu.username])?.[0];
        if (first && first.mediaKind !== 'video') { const u = sized(first.mediaUrl, servedWidth(width, PixelRatio.get())); if (u) void Image.prefetch(u).catch(() => undefined); }
      }).catch(() => undefined);
    }
    const nx = stories[i + 1];
    if (nx && nx.mediaKind !== 'video') { const u = sized(nx.mediaUrl, servedWidth(width, PixelRatio.get())); if (u) void Image.prefetch(u).catch(() => undefined); }
  }, [at, i, stories.length, order.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => {
    if (i + 1 < stories.length) return setI(i + 1);
    const nu = order.find((t, n) => n > at && !t.seen);
    goUser(nu?.username);
  };
  const prev = () => {
    if (i > 0) return setI(i - 1);
    if (at > 0) return goUser(order[at - 1].username, -1);
    pval.current = 0;
    progress.setValue(0);
  };

  // Abre no primeiro story ainda não visto dessa pessoa (ou no primeiro, se já viu todos).
  const started = useRef<string | null>(null);
  /** Quando o visor abriu: a lista que já estava em memória pode ser de antes (com mimos vistos marcados como novos). */
  const openedAt = useRef(Date.now());
  useEffect(() => {
    if (!q.data || started.current === username) return;
    // Espera pela lista acabada de pedir ao servidor (o `seen` certo), em vez de decidir pela que estava guardada.
    if (!freshEnough(q.dataUpdatedAt, openedAt.current, q.isFetching)) return;
    started.current = username;
    // Os meus: o `seen` vem do servidor (guardado na conta, vale em todos os aparelhos), reforçado pelo que este aparelho guardou.
    // Vindo de uma resposta no chat (`?m=`): abre nesse mimo, se ainda existir.
    setI(startIndex(stories, wantedMedia, firstToWatch(stories, mine, ownSeen)));
    setReady(true);
  }, [q.isSuccess, q.isFetching, q.dataUpdatedAt, username]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (q.isSuccess && stories.length === 0) next();
  }, [q.isSuccess, stories.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setVideoMs(null);
    setSeePost(false);
    if (!ready || !cur) return;
    // Também nos meus: o servidor não me conta como espectador, mas guarda na conta até onde vi (o anel apaga-se em todos
    // os aparelhos). Este aparelho guarda-o já, para o anel não esperar pela rede.
    if (mine && me && !seenUpTo(ownSeen, cur.createdAt)) void writeOwnSeen(me.username, nextOwnSeen(ownSeen, cur.createdAt));
    const seen = cur;
    qc.setQueryData<Story[]>(['stories', username], (old) => markSeen(old, seen, mine));
    void api.viewStory(cur.id)
      .then(() => qc.invalidateQueries({ queryKey: ['stories'], exact: true })) // a bandeja (no Início e nos outros ecrãs)
      .catch(() => undefined);
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
      onMoveShouldSetPanResponder: (_e, g) => panelOpen.current
        ? g.dy > 14 && g.dy > Math.abs(g.dx) * 1.5
        : (Math.abs(g.dy) > 14 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5) || (Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5),
      onPanResponderMove: (_e, g) => {
        if (panelOpen.current) return; // com um painel aberto o mimo não se mexe
        if (Math.abs(g.dx) > Math.abs(g.dy)) { dx.setValue(g.dx); dy.setValue(0); } else { dy.setValue(Math.max(0, g.dy)); dx.setValue(0); }
      },
      onPanResponderRelease: (_e, g) => {
        if (panelOpen.current) { if (g.dy > 50) closePanelRef.current(); return; }
        if (Math.abs(g.dx) > Math.abs(g.dy)) {
          if (g.dx < -60) { Animated.timing(dx, { toValue: -80, duration: 120, useNativeDriver: false }).start(() => sideRef.current(1)); return; }
          if (g.dx > 60) { Animated.timing(dx, { toValue: 80, duration: 120, useNativeDriver: false }).start(() => sideRef.current(-1)); return; }
          Animated.spring(dx, { toValue: 0, useNativeDriver: false }).start();
          return;
        }
        if (g.dy > 110) return closeRef.current();
        Animated.spring(dy, { toValue: 0, useNativeDriver: false }).start();
        if (g.dy < -70) upRef.current();
      },
    }),
  ).current;
  const panelOpen = useRef(false);
  const closePanelRef = useRef(() => undefined as void);
  // Deslizar para o lado: a pessoa seguinte (mesmo já vista) ou a anterior; sem mais ninguém, fecha ou volta ao lugar.
  const sideRef = useRef((d: 1 | -1) => { void d; });
  sideRef.current = (d) => {
    const u = d > 0 ? order[at + 1]?.username : at > 0 ? order[at - 1].username : undefined;
    if (u) goUser(u, d);
    else if (d > 0) close();
    else Animated.spring(dx, { toValue: 0, useNativeDriver: false }).start();
  };
  panelOpen.current = panel !== null;
  closePanelRef.current = () => setPanel(null);
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
  // Teclado (computador): ←/→ anterior e seguinte, espaço pausa, Esc fecha. Não enquanto se escreve nem com um painel aberto.
  useViewerKeys(true, {
    prev: () => { setSeePost(false); prev(); },
    next: () => { setSeePost(false); next(); },
    pause: () => setKbPaused((v) => !v),
    close: () => close(),
  }, () => panel !== null || typing || overlayOpen());
  useEffect(() => { setKbPaused(false); }, [cur?.id]);
  const hold = { onPressIn: () => { down.current = Date.now(); setHeld(true); }, onPressOut: () => setHeld(false) };

  if (q.isLoading) return <View style={st.center}><ActivityIndicator color="#fff" /></View>;
  if (q.isError || !cur) {
    // Sem rede (ou o servidor falhou) não quer dizer que o mimo tenha desaparecido: deixa tentar outra vez.
    const offline = q.isError && !isGone(q.error);
    return (
      <View style={st.center} accessibilityRole={offline ? 'alert' : undefined}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{offline ? 'Ups, o mimo não carregou' : 'Este mimo já não está disponível'}</Text>
        {offline && <Pressable onPress={() => void q.refetch()} style={st.btn} accessibilityRole="button"><Text style={{ color: '#fff', fontWeight: '700' }}>Tentar outra vez</Text></Pressable>}
        <Pressable onPress={close} style={st.btn} accessibilityRole="button"><Text style={{ color: '#fff', fontWeight: '700' }}>Fechar</Text></Pressable>
      </View>
    );
  }
  const shared = !!cur.sharedFrom;
  /** Guarda o meu mimo na galeria, sempre com a assinatura do Txillapp (o servidor grava-a na foto ou no vídeo). */
  async function saveMimo() {
    if (!cur || saving) return;
    setPanel(null);
    setSaving(true);
    setAway(true);
    try {
      const r = await saveToGallery(`/stories/${cur.id}/download`, `txillapp-mimo-${cur.id.slice(0, 8)}.${cur.mediaKind === 'video' ? 'mp4' : 'jpg'}`);
      if (r === 'denied') Alert.alert('Sem acesso à galeria', 'Dá acesso às fotos nas definições do telemóvel para guardar o mimo.');
      else if (Platform.OS !== 'web') Alert.alert('Guardado', 'O mimo está na tua galeria, com a assinatura do Txillapp.');
    } catch (e) {
      Alert.alert('Não consegui guardar', (e as Error).message || 'Tenta outra vez.');
    } finally {
      setSaving(false);
      setAway(false);
    }
  }
  async function shareMimo() {
    if (!cur) return;
    setAway(true);
    // Ligação curta (txillapp.com/m/@). No iPhone a partilha junta a mensagem e o endereço: o endereço vai só uma vez.
    const url = `${SITE_URL || 'https://txillapp.com'}/m/${cur.author.username}`;
    const message = `Vê o mimo de @${cur.author.username} no Txillapp`;
    try {
      await Share.share(Platform.OS === 'ios' ? { message, url } : { message: `${message}: ${url}` }, { dialogTitle: `Mimo de @${cur.author.username}` });
    } catch { /* cancelado */ }
    setAway(false);
  }
  const chip = (icon: 'eye' | 'cheers' | 'comment', n: number, label: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={st.chip} accessibilityRole="button" accessibilityLabel={`${n} ${label}`}>
      <Icon name={icon} size={18} color="#fff" strokeWidth={icon === 'eye' ? 2 : undefined} />
      <Text style={st.chipText}>{n}</Text>
    </Pressable>
  );

  return (
    <View style={[{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }, vvOn && vv ? { position: 'absolute', left: 0, right: 0, top: vv.top, height: vv.height } : null]}>
      <Animated.View
        style={[st.root, wide && { maxWidth: 460, borderRadius: 24, overflow: 'hidden', maxHeight: 860 }, { transform: [{ translateY: dy }, { translateX: Animated.add(dx, enter.interpolate({ inputRange: [0, 1], outputRange: [enterDir * 90, 0] })) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }], opacity: Animated.multiply(dy.interpolate({ inputRange: [0, 300], outputRange: [1, 0.4], extrapolate: 'clamp' }), enter.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] })) }]}
        {...(mouse ? {} : pan.panHandlers)}
        onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (width !== box.w || height !== box.h) setBox({ w: width, h: height }); }}
      >
        {/* Fundo desfocado da própria foto: a imagem aparece inteira, sem barras pretas (recortado: está ampliado e não pode sair do ecrã). */}
        <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
          {cur.mediaKind === 'video' ? (
            Platform.OS === 'web'
              ? <WebVideoStory key={cur.id} url={abs(cur.mediaUrl) ?? ''} paused={paused} onEnd={next} onDuration={setVideoMs} />
              : <VideoStory key={cur.id} url={abs(cur.mediaUrl) ?? ''} paused={paused} onEnd={next} onDuration={setVideoMs} />
          ) : (
            <>
              <Image source={{ uri: sized(cur.mediaUrl, 160) }} style={[StyleSheet.absoluteFill, { opacity: 0.7, transform: [{ scale: 1.25 }] }]} contentFit="cover" blurRadius={40} />
              <Image source={{ uri: sized(cur.mediaUrl, servedWidth(width, PixelRatio.get())) }} style={StyleSheet.absoluteFill} contentFit={storyFit(photoRatio?.id === cur.id ? photoRatio.r : null, box.h ? box.w / box.h : 0)} onLoad={(e) => { const w = e.source?.width, h = e.source?.height; if (w && h) setPhotoRatio({ id: cur.id, r: w / h }); }} accessibilityLabel={cur.caption ?? `Mimo de ${cur.author.displayName}`} />
            </>
          )}
        </View>
        {/* As ondas da música: por cima da foto, por baixo dos stickers e dos controlos, sem apanhar toques. */}
        {cur.music ? <SoundWaves active={tune.playing && !tuneMuted && !typing} colors={trackColors(cur.music)} player={tune.player} band={0.3} /> : null}
        <StickerLayer stickers={cur.stickers} width={box.w} height={box.h} animate={!paused} />

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

        <CheersPour n={burst} size={Math.min(240, width * 0.6)} />

        <LinearGradient colors={['rgba(0,0,0,0.6)', 'transparent']} style={[st.top, { paddingTop: Math.max(insets.top, 12) }]} pointerEvents="box-none">
          <View style={st.bars} pointerEvents="none">
            {stories.map((s, n) => (
              <View key={s.id} style={st.track}>
                <Animated.View style={[st.fill, { width: n < i ? '100%' : n === i ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) : '0%' }]} />
              </View>
            ))}
          </View>
          <View style={st.who} pointerEvents="box-none">
            {/* Tocar na pessoa abre o perfil dela (o mimo fica em pausa enquanto estás lá). */}
            <Pressable onPress={() => { setAway(true); router.push((mine ? '/profile' : `/u/${cur.author.username}`) as never); }} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityRole="link" accessibilityLabel={`Perfil de ${cur.author.displayName}`}>
              <Avatar name={cur.author.displayName} username={cur.author.username} size={40} />
              <View style={{ flex: 1, minWidth: 0 }} pointerEvents="none">
                <NameWithBadge name={cur.author.username} who={cur.author} style={st.name} />
                <Text style={st.ago}>{timeAgo(cur.createdAt)}{mine ? ` · ${expiresIn(cur.expiresAt)}` : ''}</Text>
              </View>
            </Pressable>
            {mine && <Pressable onPress={() => setPanel('menu')} style={st.circle} accessibilityRole="button" accessibilityLabel="Mais opções"><Icon name="more" size={24} color="#fff" strokeWidth={2.4} /></Pressable>}
            {!mine && <Pressable onPress={() => setPanel('more')} style={st.circle} accessibilityRole="button" accessibilityLabel="Mais opções"><Icon name="more" size={24} color="#fff" strokeWidth={2.4} /></Pressable>}
            <Pressable onPress={close} hitSlop={10} style={st.circle} accessibilityRole="button" accessibilityLabel="Fechar"><Icon name="x" size={24} color="#fff" strokeWidth={2} /></Pressable>
          </View>
        </LinearGradient>

        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={[st.bottom, { paddingBottom: Math.max(insets.bottom, 20) + (kb ? kb - insets.bottom : 0) }]} pointerEvents="box-none">
          {!typing && cur.music && <StoryMusic key={cur.id} track={cur.music} paused={paused} onLive={setTune} />}
          {!typing && cur.caption ? <View style={st.caption}><RichText text={cur.caption} style={{ color: '#fff', fontSize: 18, lineHeight: 24, textAlign: 'center' }} /></View> : null}
          {mine && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {chip('eye', cur.viewCount ?? 0, 'visualizações', () => setPanel('viewers'))}
              {chip('cheers', cur.cheerCount ?? 0, 'brindes', () => setPanel('viewers'))}
              {chip('comment', cur.commentCount, 'comentários', () => setPanel('comments'))}
              <Pressable onPress={() => void shareMimo()} style={st.chip} accessibilityRole="button" accessibilityLabel="Partilhar o mimo"><Icon name="share" size={18} color="#fff" /></Pressable>
            </View>
          )}
          {!mine && !typing && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => setPanel('comments')} style={[st.chip, { minHeight: 40, backgroundColor: 'rgba(0,0,0,0.4)' }]} accessibilityRole="button">
                <Icon name="comment" size={18} color="#fff" />
                <Text style={st.chipText}>{cur.commentCount > 0 ? `${cur.commentCount} ${cur.commentCount === 1 ? 'comentário' : 'comentários'}` : 'Comentar'}</Text>
              </Pressable>
              <Pressable onPress={() => void shareMimo()} style={[st.chip, { minHeight: 40, backgroundColor: 'rgba(0,0,0,0.4)' }]} accessibilityRole="button" accessibilityLabel="Partilhar o mimo"><Icon name="share" size={18} color="#fff" /></Pressable>
            </View>
          )}
          {!mine && cur.canReply && <ReplyBar key={cur.id} story={cur} username={cur.author.username} onFocusChange={setTyping} inputRef={replyRef} onCheered={() => setBurst((b) => b + 1)} />}
          {!mine && !cur.canReply && <Text style={st.noReply}>Este mimo não aceita respostas</Text>}
        </LinearGradient>

        {panel === 'menu' && (
          <Panel title="O teu mimo" onClose={() => setPanel(null)}>
            <Pressable onPress={() => { close(); router.push('/settings/privacidade?o=storyReplies' as never); }} style={st.menuRow}><Text style={st.menuText}>Definições do mimo</Text></Pressable>
            <Pressable onPress={() => void saveMimo()} style={st.menuRow}><Text style={st.menuText}>{saving ? 'A guardar…' : 'Guardar na galeria'}</Text></Pressable>
            <Pressable onPress={() => void shareMimo()} style={st.menuRow}><Text style={st.menuText}>Partilhar</Text></Pressable>
            <Pressable onPress={() => void toggleComments()} style={st.menuRow}><Text style={st.menuText}>{cur.commentsOff ? 'Ativar comentários' : 'Desativar comentários'}</Text></Pressable>
            <Pressable onPress={() => void remove()} style={st.menuRow}><Text style={[st.menuText, { color: '#dc2626', fontWeight: '600' }]}>Apagar mimo</Text></Pressable>
            <Pressable onPress={() => setPanel(null)} style={st.menuRow}><Text style={st.menuText}>Cancelar</Text></Pressable>
          </Panel>
        )}
        {panel === 'more' && (
          <Panel title={`Mimo de ${cur.author.username}`} onClose={() => setPanel(null)}>
            <Pressable onPress={() => setPanel('report')} style={st.menuRow} accessibilityRole="button"><Text style={[st.menuText, { color: '#dc2626', fontWeight: '600' }]}>Denunciar mimo</Text></Pressable>
            <Pressable onPress={() => { setAway(true); setPanel(null); router.push(`/u/${cur.author.username}` as never); }} style={st.menuRow} accessibilityRole="button"><Text style={st.menuText}>Ver o perfil (para bloquear)</Text></Pressable>
            <Pressable onPress={() => setPanel(null)} style={st.menuRow}><Text style={st.menuText}>Cancelar</Text></Pressable>
          </Panel>
        )}
        {/* Denunciado, o mimo sai para quem denunciou: ao fechar passa ao seguinte (o servidor também já não o devolve). */}
        {panel === 'report' && <ReportSheet type="story" id={cur.id} onReported={() => { reported.current = true; }} onClose={() => { setPanel(null); if (reported.current) { reported.current = false; next(); } }} />}
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
  videoMute: { position: 'absolute', right: 14, top: 110, zIndex: 6, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 5, elevation: 5, paddingHorizontal: 12, paddingBottom: 40 },
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
  menuRow: { paddingVertical: 14, alignItems: 'center' },
  menuText: { fontSize: 18, color: '#18181b' },
});
