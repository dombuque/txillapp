import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MusicLinkCard } from '@/components/MusicLink';
import { SpotifyAutoPlayer } from '@/components/SpotifyAutoPlayer';
import { isLinkMusic } from '@/lib/musicLink';
import type { Track } from '@/lib/api.music';
import { useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { limitBuffer } from '@/lib/videoMemory';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, AppState, Easing, Keyboard, PanResponder, PixelRatio, Platform, Pressable, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { NameWithBadge } from '@/components/NameWithBadge';
import { Icon } from '@/components/Icon';
import { ReportSheet } from '@/components/ReportSheet';
import { RichText } from '@/components/RichText';
import { CheersPour } from '@/components/CheersPour';
import { ActivityPanel, BarButton, CommentsPanel, Panel, ReplyBar, shareSharedPost, useKeyboardHeight } from '@/components/StoryParts';
import { StoryFloatComments } from '@/components/StoryFloatComments';
import { ActionRow } from '@/components/ui/ActionRow';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { confirm } from '@/lib/confirm';
import { captionSpot, floatColumn, HEADER_H, mimoFit, storyFrame } from '@/lib/storyFrame';
import { colors } from '@/lib/theme';
import { useVisibleViewport, webWindowH } from '@/components/zas/useVisibleViewport';
import { barBottom, heldSize, keyboardCover, webKeyboardBox, type Size } from '@/lib/keyboardFrame';
import { api, type Story } from '@/lib/api';
import { SITE_URL, abs, sized } from '@/lib/config';
import { isSaving } from '@/lib/dataSaverRules';
import { servedWidth } from '@/lib/photoSize';
import { useOwnSeen, writeOwnSeen } from '@/lib/ownSeen';
import { firstToWatch, markSeen, nextOwnSeen, seenUpTo } from '@/lib/ownStorySeen';
import { useAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/time';
import { saveToGallery } from '@/lib/saveToGallery';
import { StickerLayer } from '@/components/Stickers';
import { isGone } from '@/lib/postCache';
import { storyPaused } from '@/lib/storyPlayback';
import { withStories } from '@/lib/txillada';
import { freshEnough, opensComments, startIndex } from '@/lib/storyLink';
import { artistHref } from '@/lib/artists';
import { MusicPill } from '@/components/PostMusic';
import { SoundWaves } from '@/components/SoundWaves';
import { trackColors } from '@/lib/musicLook';
import { useMusicMuted } from '@/lib/musicPlayer';
import { finePointer, overlayOpen } from '@/lib/desktopKeys';
import { useViewerKeys } from '@/lib/desktopHooks';
import { t } from '@/lib/i18n';

/** Quanto tempo fica à vista um mimo de foto (os de vídeo duram o vídeo, até 30 s). */
const IMAGE_MS = 30_000;
/** Para que lado se saiu da pessoa anterior (a seguinte entra desse lado). Vive fora do ecrã porque a rota é substituída. */
let lastDir: 1 | -1 | 0 = 0;
const expiresIn = (iso: string) => {
  const h = Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000);
  return h <= 0 ? 'a expirar' : t('expira em {h} h', { h });
};

/**
 * Vídeo do mimo na web: um <video> com playsInline, sem controlos, a ocupar o mimo (no iPhone, sem playsInline, o Safari
 * abria o leitor do sistema em ecrã inteiro). Tenta tocar com som; se o browser não deixar, toca sem som e mostra o botão.
 * Inteiro (`contain`): um vídeo 9:16 enche o cartão e um de outra forma não perde o canto da assinatura.
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
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000', pointerEvents: 'none' },
      })}
      <Pressable onPress={() => setMuted((m) => !m)} hitSlop={4} style={st.videoMute} accessibilityRole="button" accessibilityLabel={muted ? t('Ativar o som') : t('Silenciar')}>
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
  // textureView: no Android o vídeo respeita os cantos redondos do cartão.
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} surfaceType="textureView" />;
}

/**
 * A música do mimo: toca enquanto está à vista (pára se pausares ou se a app sair do ecrã) e tem botão para silenciar (o
 * som da app, o mesmo das publicações). Diz ao visor se está a tocar com som (`onLive`), para as ondas no meio da foto.
 */
/** A música do mimo: a do catálogo toca por baixo; a por ligação (Spotify…) é a pílula que abre o leitor oficial. */
function StoryMusic(p: { track: NonNullable<Story['music']>; paused: boolean; onLive?: (live: { playing: boolean; player: AudioPlayer | null }) => void }) {
  const winW = useWindowDimensions().width;
  const tr = p.track as Track;
  // Spotify: o leitor compacto oficial a tocar sozinho (pára com o mimo). As outras plataformas: a pílula (toque para ouvir).
  if (isLinkMusic(tr) && tr.provider === 'spotify' && tr.link && tr.embedUrl) return <SpotifyAutoPlayer link={tr.link} embedUrl={tr.embedUrl} paused={p.paused} width={Math.min(winW - 48, 360)} />;
  return isLinkMusic(tr) ? <MusicLinkCard track={tr} pill dark /> : <StoryMusicAudio {...p} />;
}

function StoryMusicAudio({ track, paused, onLive }: { track: NonNullable<Story['music']>; paused: boolean; onLive?: (live: { playing: boolean; player: AudioPlayer | null }) => void }) {
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
  // Vidro escuro no cabeçalho, por baixo do autor (como nos visores pro): longe da assinatura do canto de baixo à direita.
  return <MusicPill track={track} live={playing} muted={muted} onToggleMute={toggleMute} onArtist={artistTo ? () => router.push(artistTo as never) : undefined} />;
}

/** Ver os stories de uma pessoa: barras, toca à direita/esquerda, segura para pausar, arrasta para baixo para sair e para cima para responder (ou ver a atividade, nos teus). */
export default function StoryViewer() {
  const { username = '', m: wantedMedia, comments: wantComments } = useLocalSearchParams<{ username: string; m?: string; comments?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const insets = useSafeAreaInsets();
  const { width, height: winH } = useWindowDimensions();
  const wide = width > 520;
  // A música do mimo está a tocar (com o leitor, para as ondas medirem o som na web).
  const [tune, setTune] = useState<{ playing: boolean; player: AudioPlayer | null }>({ playing: false, player: null });
  const [tuneMuted] = useMusicMuted();
  const kb = useKeyboardHeight();
  // Na web (iPhone) o teclado tapa a página sem a encolher: só a zona visível fica mais baixa (lib/keyboardFrame). O
  // mimo fica do mesmo tamanho, atrás, e só a barra de responder sobe para cima do teclado; a página não rola.
  const vv = useVisibleViewport();
  const vvBox = Platform.OS === 'web' && typeof window !== 'undefined' ? webKeyboardBox(vv, webWindowH(), window.innerWidth) : null;
  useEffect(() => {
    if (!vvBox || typeof window === 'undefined') return;
    const fix = () => { if (window.scrollY || window.scrollX) window.scrollTo(0, 0); };
    fix();
    window.addEventListener('scroll', fix);
    return () => window.removeEventListener('scroll', fix);
  }, [!!vvBox, vv?.top, vv?.height]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const [photoRatio, setPhotoRatio] = useState<{ id: string; r: number } | null>(null); // a forma da foto (para encher o cartão quando é a mesma)
  /** O tamanho medido do visor agora (com o teclado aberto pode ser mais baixo: o visor desenha-se com `still`). */
  const [root, setRoot] = useState<Size>({ w: 0, h: 0 });
  /** O tamanho do visor sem o teclado: fica parado enquanto se escreve (o mimo não encolhe nem salta). */
  const still = useRef<Size>({ w: 0, h: 0 });
  /** Acabou de se escrever: o teclado ainda está a fechar (o tamanho continua parado um bocadinho). */
  const [typedTail, setTypedTail] = useState(false);
  /** A segurar o mimo há um bocadinho: o cabeçalho e a legenda saem da frente (como nos visores pro). */
  const [hideUi, setHideUi] = useState(false);
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
  useEffect(() => {
    if (!holding) { setHideUi(false); return; }
    const t = setTimeout(() => setHideUi(true), 260);
    return () => clearTimeout(t);
  }, [holding]);
  const paused = storyPaused({ held, typing, panelOpen: panel !== null, away, background });
  useEffect(() => {
    if (typing) { setTypedTail(true); return; }
    const t = setTimeout(() => setTypedTail(false), 450);
    return () => clearTimeout(t);
  }, [typing]);
  /** A escrever, a responder: um toque no mimo (ou arrastá-lo) só fecha o teclado, como no Instagram. */
  const typingRef = useRef(false);
  typingRef.current = typing;
  const dismiss = () => { replyRef.current?.blur(); Keyboard.dismiss(); };
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
  // As entradas só ao vivo (sem mimos) ficam de fora: passar para elas abria um visor vazio.
  const order = withStories(tray.data ?? []).sort((a, b) => Number(b.isMe) - Number(a.isMe));
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
        if (first && first.mediaKind !== 'video' && !isSaving()) { const u = sized(first.mediaUrl, servedWidth(width, PixelRatio.get())); if (u) void Image.prefetch(u).catch(() => undefined); }
      }).catch(() => undefined);
    }
    const nx = stories[i + 1];
    if (nx && nx.mediaKind !== 'video' && !isSaving()) { const u = sized(nx.mediaUrl, servedWidth(width, PixelRatio.get())); if (u) void Image.prefetch(u).catch(() => undefined); }
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
    // Vindo do aviso de brinde a um comentário (`?comments=1`): a folha dos comentários desse mimo abre logo.
    if (opensComments(stories, wantedMedia, wantComments)) setPanel('comments');
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
      onMoveShouldSetPanResponder: (_e, g) => typingRef.current
        ? false
        : panelOpen.current
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
    if (!(await confirm({ title: t('Apagar o mimo?'), message: t('Desaparece para toda a gente.'), confirm: t('Apagar'), danger: true }))) return;
    await api.deleteStory(cur.id).catch(() => undefined);
    await q.refetch();
    void qc.invalidateQueries({ queryKey: ['stories'] });
    if (stories.length <= 1) close();
  }
  /** Bloquear quem publicou o mimo (como no perfil, lib/api `block`): os mimos dela saem e o visor fecha. */
  async function confirmBlock() {
    if (!cur) return;
    const u = cur.author.username;
    setPanel(null);
    if (!(await confirm({ title: t('Bloquear @{u}?', { u }), message: t('Deixa de ver as tuas publicações e mimos e não pode interagir contigo.'), confirm: t('Bloquear'), danger: true }))) return;
    try {
      await api.block(u);
      for (const k of ['profile', 'feed', 'stories', 'suggestions', 'blocked']) void qc.invalidateQueries({ queryKey: [k] });
      close();
    } catch (e) {
      Alert.alert(t('Não deu'), (e as Error)?.message || t('Não consegui bloquear agora. Tenta outra vez.'));
    }
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
  // Os comentários a flutuar: só se pedem quando o mimo à vista tem comentários (a mesma cache da folha dos comentários;
  // voltar ao mesmo mimo não pede outra vez).
  const floatOn = ready && !!cur && cur.commentCount > 0 && !cur.commentsOff && !away && !background;
  const floatQ = useQuery({ queryKey: ['story-comments', cur?.id], queryFn: () => api.storyComments(cur!.id), enabled: floatOn, staleTime: 5 * 60_000 });
  /** A altura medida da legenda deste mimo (os balões acabam acima dela). */
  const [capH, setCapH] = useState<{ id: string; h: number } | null>(null);

  if (q.isLoading) return <View style={st.center}><ActivityIndicator color="#fff" /></View>;
  if (q.isError || !cur) {
    // Sem rede (ou o servidor falhou) não quer dizer que o mimo tenha desaparecido: deixa tentar outra vez.
    const offline = q.isError && !isGone(q.error);
    return (
      <View style={st.center} accessibilityRole={offline ? 'alert' : undefined}>
        {offline
          ? <ErrorState what={t('o mimo')} onRetry={() => void q.refetch()} dark style={{ marginTop: 0 }} />
          : <EmptyState icon="clock" title={t('Este mimo já não está disponível')} text={t('Os mimos ficam 24 horas.')} dark style={{ marginTop: 0 }} />}
        <Button label={t('Fechar')} kind="ghost" size="md" dark onPress={close} />
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
      if (r === 'denied') Alert.alert(t('Sem acesso à galeria'), t('Dá acesso às fotos nas definições do telemóvel para guardar o mimo.'));
      else if (Platform.OS !== 'web') Alert.alert(t('Guardado'), t('O mimo está na tua galeria, com a assinatura do Txillapp.'));
    } catch (e) {
      Alert.alert(t('Não consegui guardar'), (e as Error).message || t('Tenta outra vez.'));
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
    const message = t('Vê o mimo de @{username} no Txillapp', { username: cur.author.username });
    try {
      await Share.share(Platform.OS === 'ios' ? { message, url } : { message: `${message}: ${url}` }, { dialogTitle: t('Mimo de @{username}', { username: cur.author.username }) });
    } catch { /* cancelado */ }
    setAway(false);
  }
  // O cartão do mimo e a barra por baixo dele (lib/storyFrame): a barra nunca vai para cima da imagem, por isso a
  // assinatura «txillapp @…» do canto de baixo à direita fica sempre à vista. Medido sem o teclado (lib/keyboardFrame): com
  // o teclado aberto o mimo fica do mesmo tamanho, em ecrã inteiro, e só a barra de responder sobe, colada ao teclado.
  // Na web conta também um campo com o foco (no iPhone a janela pode encolher com o teclado antes de se dar pelo foco).
  const domTyping = Platform.OS === 'web' && typeof document !== 'undefined' && /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
  const keyboardOpen = typing || typedTail || domTyping || kb > 0 || !!vvBox;
  const rootH = root.h || winH;
  still.current = heldSize(still.current, { w: root.w || width, h: rootH }, keyboardOpen);
  const stage = still.current;
  const frame = storyFrame({ w: stage.w, h: stage.h, top: insets.top, bottom: insets.bottom, wide });
  const kbArea = keyboardCover({ web: Platform.OS === 'web', vv: vvBox, rootH, screenH: stage.h, kb: Platform.OS === 'web' ? 0 : kb });
  const ratio = cur.mediaKind === 'image' && photoRatio?.id === cur.id ? photoRatio.r : null;
  const cap = captionSpot(frame.cardW, frame.cardH, ratio);
  const floatCol = floatColumn(frame.cardW, frame.cardH, ratio, cur.caption ? (capH?.id === cur.id ? capH.h : 56) : 0);
  // A barra presa ao fim do cartão; com o teclado aberto sobe para cima dele, colada (com as reações rápidas por cima).
  // No computador não há teclado no ecrã e a barra fica onde está.
  const restBottom = stage.h - (frame.barTop + frame.barH);
  const replyBottom = barBottom(restBottom, panel === null ? kbArea.cover : 0);
  // Um painel (os comentários) com o teclado aberto: na web acaba onde acaba a zona visível; no telemóvel o próprio
  // painel junta a altura do teclado por baixo (só falta o que a janela encolheu a mais).
  const panelBottom = Platform.OS === 'web' ? kbArea.cover : Math.max(0, kbArea.cover - kb);
  const sub = [
    cur.audience === 'close_friends' ? t('Amigos próximos') : null,
    cur.sharedFrom ? t('Publicação de @{username}', { username: cur.sharedFrom.username }) : null,
    mine ? expiresIn(cur.expiresAt) : null,
  ].filter(Boolean).join(' · ');
  const fade = hideUi ? st.hidden : null;

  return (
    <View
      style={st.screen}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w !== root.w || h !== root.h) setRoot({ w, h });
      }}
    >
      {/* No computador: o fundo é a própria foto, desfocada e escura, à volta do cartão. */}
      {wide && cur.mediaKind === 'image' ? <Image source={{ uri: sized(cur.mediaUrl, 160) }} style={[StyleSheet.absoluteFill, { opacity: 0.28 }]} contentFit="cover" blurRadius={60} /> : null}
      <Animated.View
        style={[st.stage, { top: kbArea.shift, height: stage.h || '100%', transform: [{ translateY: dy }, { translateX: Animated.add(dx, enter.interpolate({ inputRange: [0, 1], outputRange: [enterDir * 90, 0] })) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }], opacity: Animated.multiply(dy.interpolate({ inputRange: [0, 300], outputRange: [1, 0.4], extrapolate: 'clamp' }), enter.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] })) }]}
        {...(mouse ? {} : pan.panHandlers)}
      >
        <View style={[st.card, { left: frame.cardLeft, top: frame.cardTop, width: frame.cardW, height: frame.cardH, borderRadius: frame.radius }]}>
          {/* Fundo desfocado da própria foto: uma foto de outra forma aparece inteira, sem barras pretas (recortado: está ampliado e não pode sair do cartão). */}
          <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
            {cur.mediaKind === 'video' ? (
              Platform.OS === 'web'
                ? <WebVideoStory key={cur.id} url={abs(cur.mediaUrl) ?? ''} paused={paused} onEnd={next} onDuration={setVideoMs} />
                : <VideoStory key={cur.id} url={abs(cur.mediaUrl) ?? ''} paused={paused} onEnd={next} onDuration={setVideoMs} />
            ) : (
              <>
                <Image source={{ uri: sized(cur.mediaUrl, 160) }} style={[StyleSheet.absoluteFill, { opacity: 0.7, transform: [{ scale: 1.25 }] }]} contentFit="cover" blurRadius={40} />
                <Image source={{ uri: sized(cur.mediaUrl, servedWidth(width, PixelRatio.get())) }} style={StyleSheet.absoluteFill} contentFit={mimoFit(ratio, frame.cardW, frame.cardH)} onLoad={(e) => { const w = e.source?.width, h = e.source?.height; if (w && h) setPhotoRatio({ id: cur.id, r: w / h }); }} accessibilityLabel={cur.caption ?? t('Mimo de {displayName}', { displayName: cur.author.displayName })} />
              </>
            )}
          </View>
          {/* As ondas da música: por cima da foto, por baixo dos stickers e dos controlos, sem apanhar toques. */}
          {cur.music ? <SoundWaves active={tune.playing && !tuneMuted && !typing} colors={trackColors(cur.music)} player={tune.player} band={0.3} /> : null}
          <StickerLayer stickers={cur.stickers} width={frame.cardW} height={frame.cardH} animate={!paused} />

          <Pressable style={[st.zone, { left: 0, width: shared ? '30%' : '33%' }]} {...hold} onPress={tap(() => { setSeePost(false); prev(); })} accessibilityLabel={t('Anterior')} />
          {shared && <Pressable style={[st.zone, { left: '30%', width: '40%' }]} {...hold} onPress={tap(() => setSeePost((v) => !v))} accessibilityLabel={t('Mostrar a ligação à publicação')} />}
          <Pressable style={[st.zone, { right: 0, width: shared ? '30%' : '67%' }]} {...hold} onPress={tap(() => { setSeePost(false); next(); })} accessibilityLabel={t('Seguinte')} />

          {shared && seePost && (
            <Pressable onPress={() => { setAway(true); router.push(`/${cur.mediaKind === 'video' ? 'r' : 'p'}/${cur.sharedFrom!.postId}` as never); }} style={st.seePost} accessibilityRole="button">
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{cur.mediaKind === 'video' ? t('Ver tcheka') : t('Ver publicação')}</Text>
              <Icon name="chevron-right" size={16} color="#fff" strokeWidth={3} />
            </Pressable>
          )}

          <CheersPour n={burst} size={Math.min(240, frame.cardW * 0.6)} />

          {/* A escrever: o mimo fica atrás, pausado e um pouco mais escuro; um toque nele só fecha o teclado. */}
          {typing && <Pressable style={[StyleSheet.absoluteFill, st.dim]} onPress={dismiss} accessibilityRole="button" accessibilityLabel={t('Fechar o teclado')} />}

          {/* Em cima do cartão, num degradê suave: o progresso, o autor e as ações (longe do canto da assinatura). */}
          <LinearGradient colors={['rgba(0,0,0,0.58)', 'rgba(0,0,0,0.22)', 'transparent']} style={[st.top, fade]} pointerEvents="box-none">
            <View style={st.bars} pointerEvents="none">
              {stories.map((s, n) => (
                <View key={s.id} style={st.track}>
                  <Animated.View style={[st.fill, { width: n < i ? '100%' : n === i ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) : '0%' }]}>
                    <LinearGradient colors={[colors.brand, colors.brandWarm]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                  </Animated.View>
                </View>
              ))}
            </View>
            <View style={st.who} pointerEvents="box-none">
              {/* Tocar na pessoa abre o perfil dela (o mimo fica em pausa enquanto estás lá). */}
              <Pressable onPress={() => { setAway(true); router.push((mine ? '/profile' : `/u/${cur.author.username}`) as never); }} style={st.author} accessibilityRole="link" accessibilityLabel={t('Perfil de {displayName}', { displayName: cur.author.displayName })}>
                <View style={[st.ring, cur.audience === 'close_friends' && st.ringFriends]}>
                  <Avatar name={cur.author.displayName} username={cur.author.username} size={34} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }} pointerEvents="none">
                  <View style={st.nameRow}>
                    <View style={{ flexShrink: 1, minWidth: 0 }}><NameWithBadge name={cur.author.username} who={cur.author} style={st.name} /></View>
                    <Text style={st.ago} numberOfLines={1}>{timeAgo(cur.createdAt)}</Text>
                  </View>
                  {sub ? <Text style={st.sub} numberOfLines={1}>{sub}</Text> : null}
                </View>
              </Pressable>
              {mine && <Pressable onPress={() => setPanel('menu')} hitSlop={4} style={st.circle} accessibilityRole="button" accessibilityLabel={t('Mais opções')}><Icon name="more" size={22} color="#fff" strokeWidth={2.4} /></Pressable>}
              {!mine && <Pressable onPress={() => setPanel('more')} hitSlop={4} style={st.circle} accessibilityRole="button" accessibilityLabel={t('Mais opções')}><Icon name="more" size={22} color="#fff" strokeWidth={2.4} /></Pressable>}
              <Pressable onPress={close} hitSlop={10} style={st.circle} accessibilityRole="button" accessibilityLabel={t('Fechar')}><Icon name="x" size={22} color="#fff" strokeWidth={2.2} /></Pressable>
            </View>
            {!typing && cur.music && <View style={st.music} pointerEvents="box-none"><StoryMusic key={cur.id} track={cur.music} paused={paused} onLive={setTune} /></View>}
          </LinearGradient>

          {/* A legenda: por baixo de uma foto deitada, ou logo acima da assinatura (captionSpot), nunca por cima dela. */}
          {!typing && cur.caption ? (
            <View style={[st.captionWrap, { bottom: cap.bottom, maxHeight: cap.maxHeight }, fade]} pointerEvents="box-none" onLayout={(e) => { const h = Math.ceil(e.nativeEvent.layout.height); if (capH?.id !== cur.id || capH.h !== h) setCapH({ id: cur.id, h }); }}>
              <View style={st.caption}><RichText text={cur.caption} style={{ color: '#fff', fontSize: 17, lineHeight: 23, fontWeight: '600', textAlign: 'center' }} /></View>
            </View>
          ) : null}

          {/* Os comentários a flutuar, à esquerda na metade de baixo (floatColumn): acima da legenda e da assinatura. */}
          {!typing && panel === null && floatOn && floatQ.data?.length ? (
            <StoryFloatComments key={cur.id} storyId={cur.id} comments={floatQ.data} col={floatCol} active={!paused} hidden={hideUi} onOpen={() => setPanel('comments')} />
          ) : null}
        </View>

        {/* A barra, fora do mimo, sobre o fundo escuro: responder, comentar, brindar e partilhar (ou a atividade, nos meus). */}
        <View style={[st.bar, { left: frame.cardLeft, width: frame.cardW, minHeight: frame.barH, bottom: replyBottom }]} pointerEvents="box-none">
          {mine && (
            <View style={st.barRow}>
              <Pressable onPress={() => setPanel('viewers')} style={({ pressed }) => [st.activity, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={t('{viewCount} visualizações', { viewCount: cur.viewCount ?? 0 })}>
                <Icon name="eye" size={18} color="#fff" strokeWidth={2} />
                <Text style={st.activityN}>{cur.viewCount ?? 0}</Text>
                {frame.cardW >= 340 && <Text style={st.activityLabel} numberOfLines={1}>{t('Atividade')}</Text>}
              </Pressable>
              <View style={{ flex: 1 }} />
              <BarButton icon="cheers" label={t('{cheerCount} brindes', { cheerCount: cur.cheerCount ?? 0 })} n={cur.cheerCount} on={!!cur.cheerCount} color={cur.cheerCount ? colors.brandWarm : '#fff'} onPress={() => setPanel('viewers')} />
              <BarButton icon="comment" label={t('{commentCount} comentários', { commentCount: cur.commentCount })} n={cur.commentCount} onPress={() => setPanel('comments')} />
              <BarButton icon="share" label={t('Partilhar o mimo')} size={24} onPress={() => void shareMimo()} />
            </View>
          )}
          {!mine && cur.canReply && <ReplyBar key={cur.id} story={cur} username={cur.author.username} onFocusChange={setTyping} inputRef={replyRef} onCheered={() => setBurst((b) => b + 1)} onComments={() => setPanel('comments')} onShare={() => void shareMimo()} compact={frame.cardW < 340} />}
          {!mine && !cur.canReply && (
            <View style={st.barRow}>
              <View style={st.noReply}>
                <Icon name="lock" size={15} color="rgba(255,255,255,0.6)" />
                <Text style={st.noReplyText} numberOfLines={1}>{t('Este mimo não aceita respostas')}</Text>
              </View>
              <BarButton icon="comment" label={cur.commentCount > 0 ? t('{count} comentário', { count: cur.commentCount, other: '{count} comentários' }) : t('Comentar')} onPress={() => setPanel('comments')} />
              <BarButton icon="share" label={t('Partilhar o mimo')} size={24} onPress={() => void shareMimo()} />
            </View>
          )}
        </View>

        {panel !== null && <View style={[StyleSheet.absoluteFill, { bottom: panelBottom }, wide && { left: frame.cardLeft, width: frame.cardW, top: frame.cardTop, height: frame.cardH + frame.barH, right: undefined, bottom: undefined, borderRadius: frame.radius, overflow: 'hidden' }]} pointerEvents="box-none">

        {panel === 'menu' && (
          <Panel title={t('O teu mimo')} onClose={() => setPanel(null)} cancel>
            <ActionRow icon="settings" title={t('Definições do mimo')} onPress={() => { close(); router.push('/settings/privacidade?o=storyReplies' as never); }} />
            <ActionRow icon="download" title={saving ? t('A guardar…') : t('Guardar na galeria')} disabled={saving} onPress={() => void saveMimo()} />
            <ActionRow icon="share" title={t('Partilhar')} onPress={() => void shareMimo()} />
            <ActionRow icon={cur.commentsOff ? 'comment' : 'comment-off'} title={cur.commentsOff ? t('Ativar comentários') : t('Desativar comentários')} onPress={() => void toggleComments()} />
            <ActionRow icon="trash" title={t('Apagar mimo')} danger onPress={() => void remove()} />
          </Panel>
        )}
        {panel === 'more' && (
          <Panel title={t('Mimo de @{username}', { username: cur.author.username })} onClose={() => setPanel(null)} cancel>
            {cur.sharedFrom && <ActionRow icon="share" title={cur.mediaKind === 'video' ? t('Partilhar a tcheka') : t('Partilhar a publicação')} onPress={() => { setPanel(null); void shareSharedPost(cur); }} />}
            <ActionRow icon="user" title={t('Ver o perfil')} onPress={() => { setAway(true); setPanel(null); router.push(`/u/${cur.author.username}` as never); }} />
            <ActionRow icon="flag" title={t('Denunciar mimo')} danger onPress={() => setPanel('report')} />
            <ActionRow icon="block" title={t('Bloquear @{username}', { username: cur.author.username })} danger onPress={() => void confirmBlock()} />
          </Panel>
        )}
        {/* Denunciado, o mimo sai para quem denunciou: ao fechar passa ao seguinte (o servidor também já não o devolve). */}
        {panel === 'report' && <ReportSheet type="story" id={cur.id} onReported={() => { reported.current = true; }} onClose={() => { setPanel(null); if (reported.current) { reported.current = false; next(); } }} />}
        {panel === 'comments' && <CommentsPanel story={cur} canComment={mine || cur.canReply} onTyping={setTyping} onClose={() => setPanel(null)} />}
        {panel === 'viewers' && <ActivityPanel story={cur} onClose={() => setPanel(null)} />}
        </View>}
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  // O visor desenhado: do tamanho do ecrã sem o teclado (com ele aberto passa por baixo dele, não encolhe).
  stage: { position: 'absolute', left: 0, right: 0 },
  // Por cima do mimo enquanto se escreve (por baixo do cabeçalho, que continua a fechar o visor).
  dim: { zIndex: 4, backgroundColor: 'rgba(0,0,0,0.4)' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },

  // O cartão do mimo (a forma e o lugar vêm de lib/storyFrame).
  card: { position: 'absolute', overflow: 'hidden', backgroundColor: colors.zinc900 },
  zone: { position: 'absolute', top: HEADER_H, bottom: 0 },
  videoMute: { position: 'absolute', right: 10, top: HEADER_H + 8, zIndex: 6, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(14,14,18,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 5, elevation: 5, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 26 },
  hidden: { opacity: 0 },
  bars: { flexDirection: 'row', gap: 3 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2, overflow: 'hidden' },
  who: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  // O anel do avatar: branco (verde nos mimos para amigos próximos).
  ring: { borderRadius: 999, padding: 1.5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)' },
  ringFriends: { borderColor: '#22c55e' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  name: { color: '#fff', fontWeight: '700', fontSize: 15, letterSpacing: -0.2 },
  ago: { flexShrink: 0, color: 'rgba(255,255,255,0.72)', fontSize: 13, fontWeight: '500' },
  sub: { marginTop: 1, color: 'rgba(255,255,255,0.78)', fontSize: 12, fontWeight: '500' },
  // Botões de vidro escuro, iguais em todo o visor.
  circle: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(14,14,18,0.38)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', ...({ backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)' } as object) },
  music: { marginTop: 8 },
  captionWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  caption: { maxWidth: '100%', borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.46)', paddingHorizontal: 14, paddingVertical: 8 },
  // A barra por baixo do cartão, sobre o fundo escuro.
  bar: { position: 'absolute', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  activity: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 20, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  activityN: { color: '#fff', fontSize: 15, fontWeight: '800' },
  activityLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
  noReply: { flex: 1, minWidth: 0, height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 22, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  noReplyText: { flexShrink: 1, fontSize: 14, color: 'rgba(255,255,255,0.72)' },
  seePost: { position: 'absolute', left: '50%', top: '50%', marginLeft: -84, marginTop: -22, zIndex: 10, minHeight: 44, width: 168, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 22, backgroundColor: 'rgba(14,14,18,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },

});
