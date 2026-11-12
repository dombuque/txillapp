import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { limitBuffer, reelMounted } from '@/lib/videoMemory';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { enterImmersive, leaveImmersive } from '@/lib/immersive';
import { Animated, AppState, Easing, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { BookmarkIcon } from '@/components/BookmarkIcon';
import { CommentsSheet } from '@/components/CommentsSheet';
import { FollowButton } from '@/components/FollowButton';
import { NameWithBadge } from '@/components/NameWithBadge';
import { Icon } from '@/components/Icon';
import { GiftSheet, PostMenuSheet, RepostSheet } from '@/components/PostSheets';
import { ReportSheet } from '@/components/ReportSheet';
import { RichText } from '@/components/RichText';
import { RemixTag, ReplyStickerOverlay } from '@/components/remix/RemixParts';
import { ShareSheet } from '@/components/ShareSheet';
import { Sheet } from '@/components/Sheet';
import { Wordmark } from '@/components/Wordmark';
import { HoldMenu } from '@/components/reel/HoldMenu';
import { RailButton, railStyles, ReelExtraActions } from '@/components/reel/ReelExtraActions';
import { SoundDisc, SoundMarquee } from '@/components/reel/ReelSound';
import { SeekBar } from '@/components/reel/SeekBar';
import { useDesktop } from '@/lib/desktop';
import { useDeskReels } from '@/lib/desktopHooks';
import { GestureDetector, useExclusiveGestures, useLongPressGesture, useTapGesture } from 'react-native-gesture-handler';
import { api, isTcheka, raw, type Badged, type Page, type Post } from '@/lib/api';
import { feedApi } from '@/lib/api.feed';
import { useAuth } from '@/lib/auth';
import { abs } from '@/lib/config';
import { compactCount } from '@/lib/musicCatalog';
import { colors } from '@/lib/theme';
import { reelResets, reelShouldPlay } from '@/lib/reelPlayback';
import { captionIsLong, REEL_TABS, reelSound, reelsKey, showFollowPlus, speedLabel, stepTime, type ReelSound, type ReelTab } from '@/lib/reelView';

type SheetName = null | 'comments' | 'repost' | 'gift' | 'menu' | 'share' | 'hold' | 'report';
type PeopleKind = 'cheers' | 'reposts';
/** Os campos de uma tcheka que a API manda e o tipo `Post` ainda não tem (o som, da equipa dos sons; seguir o autor). */
type ReelPost = Post & { sound?: ReelSound | null; authorFollowed?: boolean };

const isWeb = Platform.OS === 'web';
const SHADOW = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;
/** Quantas vezes mais o reel repete sozinho (toca 3 vezes no total) antes de mostrar o fim, como no site. */
const REEL_REPEATS = 2;
/** Segurar o dedo no vídeo este tempo (ms) abre o menu de segurar. */
const HOLD_MS = 420;
/** Os comentários ocupam 78% do ecrã (Sheet `full`): o vídeo encolhe para o que fica à vista por cima. */
const COMMENTS_SHARE = 0.78;

/* ---------- Som global (como no site: VideoPlayer.tsx) ----------
 * Nos Reels o som vem ligado por omissão; a escolha da pessoa vale para todos os vídeos. O Safari só deixa tocar com som
 * depois de um toque: até lá o vídeo toca sem som e o som liga-se sozinho no primeiro toque. */
const SOUND_KEY = 'txill_sound';
let pref: 'on' | 'off' | null = (() => {
  try {
    if (!isWeb) return null;
    const v = localStorage.getItem(SOUND_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
})();
let activated = !isWeb || (typeof navigator !== 'undefined' && (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === true);
const soundSubs = new Set<() => void>();
const soundNotify = () => soundSubs.forEach((f) => f());
const soundSub = (cb: () => void) => {
  soundSubs.add(cb);
  return () => void soundSubs.delete(cb);
};
if (isWeb && !activated && typeof window !== 'undefined') {
  const events = ['pointerdown', 'touchend', 'keydown', 'click'];
  const onTouch = () => {
    activated = true;
    soundNotify();
    for (const ev of events) window.removeEventListener(ev, onTouch, true);
  };
  for (const ev of events) window.addEventListener(ev, onTouch, true);
}
export function setReelMuted(m: boolean) {
  pref = m ? 'off' : 'on';
  try {
    if (isWeb) localStorage.setItem(SOUND_KEY, pref);
  } catch {
    /* sem armazenamento: só vale nesta sessão */
  }
  soundNotify();
}
/** `chosen`: o que a pessoa escolheu (ícone do botão); `silent`: o que o aparelho deixa tocar agora. */
function useSound() {
  const chosen = useSyncExternalStore(soundSub, () => pref === 'off', () => false);
  const silent = useSyncExternalStore(soundSub, () => !activated || pref === 'off', () => true);
  return { chosen, silent };
}

/** A app/separador está à vista? Em segundo plano o vídeo pára; ao voltar, continua. */
function useAppVisible() {
  const [visible, setVisible] = useState(() => (isWeb && typeof document !== 'undefined' ? document.visibilityState === 'visible' : AppState.currentState === 'active'));
  useEffect(() => {
    if (isWeb && typeof document !== 'undefined') {
      const f = () => setVisible(document.visibilityState === 'visible');
      document.addEventListener('visibilitychange', f);
      return () => document.removeEventListener('visibilitychange', f);
    }
    const sub = AppState.addEventListener('change', (s) => setVisible(s === 'active'));
    return () => sub.remove();
  }, []);
  return visible;
}

/**
 * Web: ao largar o dedo depois de segurar, alguns browsers mandam ainda um «click» no sítio do dedo, que caía no fundo do
 * menu acabado de abrir e o fechava logo. Engole só esse click (o que chega logo a seguir a largar), não os seguintes.
 */
function swallowReleaseClick() {
  if (!isWeb || typeof window === 'undefined') return;
  let upAt = 0;
  // Só conta o primeiro largar (o do dedo que segurou); um toque a sério mais tarde já não é engolido.
  const up = () => {
    if (upAt) return;
    upAt = Date.now();
    setTimeout(done, 400);
  };
  const eat = (e: Event) => {
    if (upAt && Date.now() - upAt < 400) { e.stopPropagation(); e.preventDefault(); }
    done();
  };
  const done = () => {
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('touchend', up, true);
    window.removeEventListener('click', eat, true);
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('touchend', up, true);
  window.addEventListener('click', eat, true);
  setTimeout(done, 4000);
}

/* ---------- Peças ---------- */

/** Quem brindou / repostou (se o dono deixar ver). */
function PeopleSheet({ postId, kind, onClose }: { postId: string; kind: PeopleKind; onClose: () => void }) {
  const router = useRouter();
  const q = useQuery({
    queryKey: ['post-people', postId, kind],
    queryFn: (): Promise<({ username: string; displayName: string; hasAvatar: boolean } & Badged)[]> => raw(`/posts/${postId}/people/${kind}`),
    retry: false,
  });
  return (
    <Sheet title={kind === 'cheers' ? 'Quem brindou' : 'Quem repostou'} onClose={onClose}>
      <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
        {q.isLoading && <ActivityIndicator style={{ paddingVertical: 24 }} />}
        {q.isError && <Text style={st.peopleMsg}>Esta lista não está disponível</Text>}
        {q.isSuccess && q.data.length === 0 && <Text style={st.peopleMsg}>{kind === 'cheers' ? 'Ainda ninguém brindou.' : 'Ainda ninguém repostou.'}</Text>}
        {q.data?.map((p) => (
          <Pressable key={p.username} onPress={() => { onClose(); router.push(`/u/${p.username}` as never); }} style={st.person} accessibilityRole="button">
            <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <NameWithBadge name={p.displayName} who={p} style={st.personName} />
              <Text style={st.personUser} numberOfLines={1}>@{p.username}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

/** O fim de um reel no Txillapp: a última imagem esbatida, quem fez o reel (com seguir), rever ou passar ao seguinte, e a marca. */
function ReelEnd({ post, mine, replay, more, bottomInset }: { post: Post; mine: boolean; replay: () => void; more: () => void; bottomInset: number }) {
  const router = useRouter();
  const ping = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const nd = !isWeb;
    Animated.timing(rise, { toValue: 1, duration: 250, useNativeDriver: nd }).start();
    const loop = Animated.loop(Animated.timing(ping, { toValue: 1, duration: 2400, useNativeDriver: nd }));
    loop.start();
    return () => loop.stop();
  }, [ping, rise]);
  const go = () => router.push(`/u/${post.author.username}` as never);
  return (
    <Animated.View style={[st.end, { opacity: rise, paddingBottom: Math.max(32, bottomInset) }]}>
      <LinearGradient colors={['rgba(0,0,0,0.75)', 'rgba(0,0,0,0.8)', 'rgba(0,0,0,0.9)']} style={StyleSheet.absoluteFill} />
      <View style={{ alignItems: 'center' }}>
        <Pressable onPress={go} style={st.endRing} accessibilityRole="button"><Avatar name={post.author.displayName} username={post.author.username} size={84} /></Pressable>
        <Pressable onPress={go} accessibilityRole="button"><NameWithBadge name={post.author.displayName} who={post.author} style={[st.endName, { marginTop: 0 }]} containerStyle={{ marginTop: 12 }} gap={5} /></Pressable>
        <Text style={st.endUser}>@{post.author.username}</Text>
        {!mine && (post as Post & { authorFollowed?: boolean }).authorFollowed === false && (
          <View style={{ marginTop: 16, width: 160 }}><FollowButton username={post.author.username} following={false} requested={false} isPrivate={false} /></View>
        )}
      </View>

      <View style={{ alignItems: 'center', gap: 20 }}>
        <Pressable onPress={replay} style={({ pressed }) => [st.replay, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel="Ver outra vez">
          <Animated.View pointerEvents="none" style={[st.pingRing, { opacity: ping.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }), transform: [{ scale: ping.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }] }]} />
          <Icon name="undo" size={34} strokeWidth={2.2} color="#fff" />
        </Pressable>
        <Text style={st.endReplay}>Ver outra vez</Text>
        <Pressable onPress={more} style={({ pressed }) => [st.endNext, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button">
          <Text style={st.endNextText}>Próximo</Text>
          <Icon name="arrow-up" size={18} strokeWidth={2.6} color="#fff" />
        </Pressable>
      </View>

      <View style={{ alignItems: 'center', gap: 4 }}>
        <Wordmark height={28} color="#fff" />
        <Text style={st.endBrand}>Txilla com a malta</Text>
      </View>
    </Animated.View>
  );
}

/**
 * Uma tcheka longe da que está em cena (sem leitor, para poupar memória): só a capa, para nunca se ver preto ao
 * deslizar depressa.
 */
export function ReelPoster({ post, height }: { post: Post; height: number }) {
  const poster = post.media[0]?.posterUrl;
  return (
    <View style={[{ height, width: '100%', backgroundColor: '#000' }, isWeb && ({ scrollSnapAlign: 'start', scrollSnapStop: 'always' } as object)]}>
      {poster ? <Image source={{ uri: abs(poster) }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
    </View>
  );
}

/** O avatar de quem fez a tcheka, no topo das ações do lado, com o «+» para seguir sem sair do vídeo (como no TikTok). */
function AuthorBubble({ post, mine, onChange }: { post: ReelPost; mine: boolean; onChange: (p: Partial<ReelPost>) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [followedNow, setFollowedNow] = useState(false);
  const [tick, setTick] = useState(false);
  const pop = useRef(new Animated.Value(1)).current;
  const plus = showFollowPlus({ mine, authorFollowed: post.authorFollowed, followedNow });
  async function follow() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setFollowedNow(true);
    setTick(true);
    Animated.sequence([
      Animated.spring(pop, { toValue: 1.25, useNativeDriver: !isWeb, speed: 40, bounciness: 12 }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: !isWeb, speed: 30 }),
    ]).start();
    try {
      await api.follow(post.author.username);
      onChange({ authorFollowed: true });
      for (const key of ['stories', 'suggestions', 'feed', 'profile']) void qc.invalidateQueries({ queryKey: [key] });
    } catch {
      setFollowedNow(false);
    }
    setTimeout(() => setTick(false), 900);
  }
  return (
    <View style={st.authorBubble}>
      <Pressable onPress={() => router.push(`/u/${post.author.username}` as never)} style={st.avatarRing} accessibilityRole="button" accessibilityLabel={`Perfil de ${post.author.displayName}`}>
        <Avatar name={post.author.displayName} username={post.author.username} size={46} />
      </Pressable>
      {(plus || tick) && (
        <Animated.View style={[st.plusWrap, { transform: [{ scale: pop }] }]}>
          <Pressable onPress={() => void follow()} disabled={!plus} hitSlop={10} style={[st.plus, tick && { backgroundColor: '#fff' }]} accessibilityRole="button" accessibilityLabel={`Seguir ${post.author.displayName}`}>
            <Icon name={tick ? 'check' : 'plus'} size={13} strokeWidth={3.2} color={tick ? colors.brand : '#fff'} />
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

/**
 * Um vídeo em ecrã inteiro com as ações do lado e o texto em baixo, como no TikTok. `height` é a altura medida do
 * contentor (onLayout), nunca a da janela. `bottomInset`: espaço seguro de baixo quando não há barra de baixo por cima
 * (ex.: página do reel). `extraActions` põe botões novos nas ações do lado (entre «Partilhar» e o disco); sem ele fica
 * o sítio da equipa do remix (components/reel/ReelExtraActions).
 *
 * Gestos: um toque pausa ou retoma; dois brindam; segurar abre o menu (Não me interessa, Denunciar, Guardar, Velocidade,
 * Legendas); arrastar na barra de baixo avança ou recua. No computador: espaço, ←/→ (5 s) e ↑/↓ ou a roda (lista).
 */
export function Reel({ post: rawPost, active, onScreen = true, height, onChange, me, onMore, bottomInset = 0, pauseSignal = 0, seekSignal, extraActions }: {
  /** Computador: muda a cada espaço (a tcheka em cena pausa ou continua). */ pauseSignal?: number;
  /** Computador: muda a cada ←/→ (recua ou avança `by` segundos). */ seekSignal?: { n: number; by: number };
  post: Post;
  /** É a tcheka em cena na lista. */ active: boolean;
  /** O ecrã está à frente (fora dele só pára; ao voltar continua). */ onScreen?: boolean;
  height: number;
  onChange: (p: Partial<Post>) => void;
  me?: string;
  onMore?: () => void;
  bottomInset?: number;
  /** Botões a mais nas ações do lado (ex.: «Remix»). */ extraActions?: ReactNode;
}) {
  const post = rawPost as ReelPost;
  const router = useRouter();
  const desktop = useDesktop();
  const win = useWindowDimensions();
  const safeTop = useSafeAreaInsets().top;
  const [sheet, setSheet] = useState<SheetName>(null);
  const [people, setPeople] = useState<PeopleKind | null>(null);
  const [userPaused, setUserPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  const [flash, setFlash] = useState<null | 'play' | 'pause'>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [captions, setCaptions] = useState<{ has: boolean; on: boolean }>({ has: false, on: false });
  const [captionOpen, setCaptionOpen] = useState(false);
  const [infoW, setInfoW] = useState(0);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loops = useRef(0);
  const { chosen, silent } = useSound();
  const visible = useAppVisible();
  const m = post.media[0];
  const mine = post.author.id === me;
  const sound = reelSound(post);

  const player = useVideoPlayer(abs(m.url) ?? '', (p) => {
    limitBuffer(p, 'reel');
    p.loop = !onMore;
    p.muted = true;
    p.timeUpdateEventInterval = 0.25;
  });
  // Com `onMore` o reel repete 2 vezes e mostra o fim; sem ele repete sem fim.
  useEffect(() => {
    player.loop = !onMore;
  }, [player, onMore]);
  useEffect(() => {
    // Sem pretos: a capa fica por cima até o vídeo ter a primeira imagem desenhada (onFirstFrameRender) ou já ter andado.
    const t = player.addListener('timeUpdate', ({ currentTime }) => { if (currentTime > 0.2) setShown(true); });
    const b = player.addListener('playToEnd', () => {
      if (!onMore) return;
      if (loops.current < REEL_REPEATS) {
        loops.current += 1;
        player.replay();
      } else {
        setEnded(true);
      }
    });
    const c = player.addListener('statusChange', ({ status }) => setFailed(status === 'error'));
    const d = player.addListener('availableSubtitleTracksChange', ({ availableSubtitleTracks }) => setCaptions((s) => ({ ...s, has: availableSubtitleTracks.length > 0 })));
    return () => { t.remove(); b.remove(); c.remove(); d.remove(); };
  }, [player, onMore]);

  // Fora de cena (deslizaste para outra): volta ao início, sem a pausa nem o fim anteriores. Com o ecrã por trás (outro
  // separador, o perfil do autor por cima) só pára: ao voltar continua de onde estava.
  useEffect(() => {
    if (!reelResets({ active, onScreen })) return;
    setUserPaused(false);
    setEnded(false);
    setCaptionOpen(false);
    loops.current = 0;
    try { player.currentTime = 0; } catch { /* leitor ainda a carregar */ }
  }, [active, onScreen, player]);

  // Com a partilha aberta (pré-visualização do status) o vídeo de fundo pára: é a pré-visualização que toca.
  // Só a tcheka em cena toca (e com som): as outras ficam carregadas, paradas e mudas.
  const shouldPlay = reelShouldPlay({ active, onScreen, appVisible: visible, userPaused, ended, sharing: sheet === 'share' });
  useEffect(() => {
    try { player.muted = silent || !active; } catch { /* leitor libertado */ }
  }, [silent, active, player]);
  useEffect(() => {
    try {
      if (shouldPlay) {
        player.muted = silent;
        if (!silent) player.volume = 1;
        player.play();
      } else {
        player.pause();
      }
    } catch { /* leitor libertado */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPlay, player]);
  useEffect(() => {
    try { player.playbackRate = speed; player.preservesPitch = true; } catch { /* leitor libertado */ }
  }, [speed, player]);
  // O leitor para quando o reel desaparece da lista.
  useEffect(() => () => { try { player.pause(); } catch { /* já libertado */ } clearTimeout(flashTimer.current); clearTimeout(toastTimer.current); }, [player]);

  // Conta como "visto" depois de 1 s em cena.
  useEffect(() => {
    if (!active || !onScreen) return;
    const t = setTimeout(() => void api.markSeen([post.id]).catch(() => undefined), 1000);
    return () => clearTimeout(t);
  }, [active, onScreen, post.id]);

  function say(text: string, ms = 1400) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }

  // Toque simples (pausa/retoma) ou duplo (brinda): o simples espera um instante para ver se vem o segundo.
  const lastTap = useRef(0);
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [burst, setBurst] = useState(0);
  const burstAnim = useRef(new Animated.Value(0)).current;
  const cheerPop = useRef(new Animated.Value(1)).current;
  useEffect(() => () => { if (singleTimer.current) clearTimeout(singleTimer.current); }, []);
  function popCheer() {
    cheerPop.setValue(0.7);
    Animated.spring(cheerPop, { toValue: 1, useNativeDriver: !isWeb, speed: 18, bounciness: 16 }).start();
  }
  // Duplo toque: brinda (só põe, nunca tira) e mostra o copo grande.
  function brindar() {
    setBurst((n) => n + 1);
    burstAnim.setValue(0);
    Animated.timing(burstAnim, { toValue: 1, duration: 800, useNativeDriver: false }).start();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    if (!post.cheered) {
      popCheer();
      onChange({ cheered: true, cheers: post.cheers + 1 });
      api.cheer(post.id).then((r) => onChange(r)).catch(() => onChange({ cheered: post.cheered, cheers: post.cheers }));
    }
  }
  // No telemóvel os toques vêm da biblioteca de gestos (funciona por cima do vídeo nativo); no browser, do Pressable.
  const tapRef = useRef(() => undefined as void);
  const dblRef = useRef(() => undefined as void);
  const holdRef = useRef(() => undefined as void);
  const hold = useLongPressGesture({ minDuration: HOLD_MS, maxDistance: 12, runOnJS: true, enabled: !isWeb, onActivate: () => holdRef.current() });
  const dblTap = useTapGesture({ numberOfTaps: 2, maxDelay: 280, runOnJS: true, enabled: !isWeb, onActivate: () => dblRef.current() });
  const oneTap = useTapGesture({ numberOfTaps: 1, runOnJS: true, enabled: !isWeb, onActivate: () => tapRef.current() });
  const taps = useExclusiveGestures(hold, dblTap, oneTap);
  function onScreenTap() {
    const now = Date.now();
    if (now - lastTap.current < 280 && singleTimer.current) {
      clearTimeout(singleTimer.current);
      singleTimer.current = null;
      lastTap.current = 0;
      brindar();
      return;
    }
    lastTap.current = now;
    singleTimer.current = setTimeout(() => {
      singleTimer.current = null;
      tap();
    }, 280);
  }
  function tap() {
    if (captionOpen) { setCaptionOpen(false); return; } // com a legenda aberta, o toque fecha-a
    const next = !userPaused;
    setUserPaused(next);
    setFlash(next ? 'pause' : 'play');
    flashAnim.setValue(0);
    Animated.spring(flashAnim, { toValue: 1, useNativeDriver: !isWeb, bounciness: 8 }).start();
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 700);
  }
  function openHold() {
    if (singleTimer.current) { clearTimeout(singleTimer.current); singleTimer.current = null; }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    swallowReleaseClick();
    setSheet('hold');
  }
  // Espaço (computador): o mesmo que tocar no vídeo.
  const lastSignal = useRef(pauseSignal);
  useEffect(() => {
    if (pauseSignal === lastSignal.current) return;
    lastSignal.current = pauseSignal;
    if (active) tap();
  }, [pauseSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  // ←/→ (computador): recua ou avança 5 s.
  const lastSeek = useRef(seekSignal?.n ?? 0);
  useEffect(() => {
    if (!seekSignal || seekSignal.n === lastSeek.current) return;
    lastSeek.current = seekSignal.n;
    if (!active) return;
    try {
      player.currentTime = stepTime(player.currentTime, player.duration, seekSignal.by);
      say(seekSignal.by > 0 ? `+${seekSignal.by} s` : `−${-seekSignal.by} s`, 600);
    } catch { /* ainda a carregar */ }
  }, [seekSignal?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  function replay() {
    loops.current = 0;
    setEnded(false);
    try { player.replay(); } catch { /* nada */ }
  }

  async function cheer() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!post.cheered) popCheer();
    onChange({ cheered: !post.cheered, cheers: post.cheers + (post.cheered ? -1 : 1) });
    try {
      onChange(await api.cheer(post.id));
    } catch {
      onChange({ cheered: post.cheered, cheers: post.cheers });
    }
  }
  async function save() {
    const next = !post.saved;
    onChange({ saved: next });
    say(next ? 'Guardado' : 'Tirado dos guardados', 1000);
    try {
      await (next ? api.savePost(post.id) : api.unsavePost(post.id));
    } catch {
      onChange({ saved: !next });
    }
  }
  /** «Não me interessa»: ensina o algoritmo (o mesmo do «Não interessado» do feed) e passa à seguinte. */
  function notInterested() {
    setSheet(null);
    say('Ok, vamos mostrar menos disto.', 1200);
    void feedApi.setInterest(post.id, -1).catch(() => undefined);
    setTimeout(() => onMore?.(), 900); // dá para ler o aviso antes de passar à seguinte
  }
  function toggleCaptions() {
    const on = !captions.on;
    try { player.subtitleTrack = on ? (player.availableSubtitleTracks[0] ?? null) : null; } catch { /* sem legendas */ }
    setCaptions((s) => ({ ...s, on }));
  }
  const goSound = () => { if (sound?.href) router.push(sound.href as never); };

  // Posições: a barra de progresso fica logo acima da barra de baixo (que flutua por cima das tchekas); o texto e as
  // ações do lado por cima dela.
  const barBottom = bottomInset > 0 ? Math.max(0, bottomInset - 10) : 0;
  const infoBottom = barBottom + 16;

  // Comentários abertos (telemóvel): o vídeo continua a tocar e encolhe para a parte de cima, que fica à vista.
  const shrink = useRef(new Animated.Value(0)).current;
  const comments = sheet === 'comments' && !desktop;
  useEffect(() => {
    Animated.timing(shrink, { toValue: comments ? 1 : 0, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: !isWeb }).start();
  }, [comments, shrink]);
  // Fica entre o topo (separadores / voltar) e a folha: centrado nessa faixa.
  const headTop = safeTop + 60;
  const room = Math.max(96, win.height * (1 - COMMENTS_SHARE) - headTop - 8);
  const scaleTo = height > 0 ? Math.min(1, room / height) : 1;
  const mediaShrink = {
    transform: [
      { translateY: shrink.interpolate({ inputRange: [0, 1], outputRange: [0, headTop + room / 2 - height / 2] }) },
      { scale: shrink.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] }) },
    ],
  };
  const chrome = Animated.multiply(shrink.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), scrubbing ? 0 : 1);

  tapRef.current = tap;
  dblRef.current = brindar;
  holdRef.current = openHold;
  const fit = (
    <Animated.View style={[StyleSheet.absoluteFill, mediaShrink]} pointerEvents="none">
      <VideoView player={player} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} contentFit="contain" nativeControls={false} allowsPictureInPicture={false} playsInline pointerEvents="none" useExoShutter={false} onFirstFrameRender={() => setShown(true)} />
      {m.posterUrl && !shown ? <Image source={{ uri: abs(m.posterUrl) }} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} contentFit="contain" pointerEvents="none" /> : null}
    </Animated.View>
  );
  const longCaption = captionIsLong(post.body);

  return (
    <View style={[{ height, width: '100%', backgroundColor: '#000', overflow: 'hidden' }, isWeb && ({ scrollSnapAlign: 'start', scrollSnapStop: 'always', userSelect: 'none', WebkitTouchCallout: 'none' } as object)]} accessibilityLabel={`Tcheka de ${post.author.displayName}`}>
      {isWeb ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={onScreenTap} onLongPress={openHold} delayLongPress={HOLD_MS} accessibilityRole="button" accessibilityLabel="Tocar ou pausar (duplo toque para brindar, segurar para mais opções)">{fit}</Pressable>
      ) : (
        <GestureDetector gesture={taps}>
          <View style={StyleSheet.absoluteFill} collapsable={false} accessible accessibilityRole="button" accessibilityLabel="Tocar ou pausar (duplo toque para brindar, segurar para mais opções)">{fit}</View>
        </GestureDetector>
      )}

      <Animated.View style={[st.shade, { opacity: chrome }]} pointerEvents="none">
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} style={StyleSheet.absoluteFill} />
      </Animated.View>
      {captionOpen && <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} onPress={() => setCaptionOpen(false)} accessibilityLabel="Fechar a legenda" />}
      {burst > 0 && (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 15, opacity: burstAnim.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }), transform: [{ scale: burstAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.5, 1.15, 1.4] }) }] }}>
          <Icon name="cheers" size={110} strokeWidth={1.6} color="#fff" />
        </Animated.View>
      )}
      {!comments && <SeekBar player={player} bottom={barBottom} onScrub={setScrubbing} />}

      {/* Em pausa (toque no meio): fica o símbolo de pausa e, por cima dele, o botão do som. Ao retomar, desaparecem. */}
      {(userPaused || flash === 'play') && !scrubbing && (
        <View style={st.flashWrap} pointerEvents="box-none">
          {userPaused && (
            <Pressable onPress={() => setReelMuted(!chosen)} style={({ pressed }) => [st.muteCenter, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel={chosen ? 'Ligar o som' : 'Desligar o som'}>
              <Icon name={chosen ? 'volume-off' : 'volume'} size={22} color="#fff" />
            </Pressable>
          )}
          <Animated.View pointerEvents="none" style={[st.flash, { opacity: userPaused ? 1 : flashAnim, transform: [{ scale: flashAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
            <Icon name={userPaused ? 'pause' : 'play'} size={38} color="#fff" solid />
          </Animated.View>
        </View>
      )}
      {failed && <View style={st.flashWrap} pointerEvents="none"><Text style={st.failed}>Não consegui carregar este vídeo.</Text></View>}
      {toast && <View style={st.toastWrap} pointerEvents="none" accessibilityRole="alert"><Text style={st.toast}>{toast}</Text></View>}
      {speed !== 1 && !comments && (
        <Pressable onPress={() => setSheet('hold')} style={st.speedChip} accessibilityRole="button" accessibilityLabel={`Velocidade ${speedLabel(speed)}`}>
          <Text style={st.speedChipText}>{speedLabel(speed)}</Text>
        </Pressable>
      )}

      {/* Resposta com tcheka: o comentário por cima do vídeo, onde a pessoa o deixou (leva ao comentário). */}
      <ReplyStickerOverlay remix={post.remixOf} />

      {/* Em baixo: o @ com o selo, a legenda (expande ao tocar), as hashtags, o local e o letreiro do som. */}
      <Animated.View style={[st.info, { bottom: infoBottom, opacity: chrome }]} pointerEvents={scrubbing || comments ? 'none' : 'box-none'} onLayout={(e) => setInfoW(Math.round(e.nativeEvent.layout.width))}>
        {/* «Dueto com @x» / «Resposta a @y»: leva ao original. */}
        {post.remixOf ? <View style={{ marginBottom: 8 }}><RemixTag remix={post.remixOf} /></View> : null}
        <Pressable onPress={() => router.push(`/u/${post.author.username}` as never)} style={{ alignSelf: 'flex-start', maxWidth: '100%' }} accessibilityRole="button">
          <NameWithBadge name={`@${post.author.username}`} who={post.author} style={st.authorName} />
        </Pressable>
        {post.body ? (
          captionOpen ? (
            <ScrollView style={{ marginTop: 6, maxHeight: Math.round(height * 0.4) }} showsVerticalScrollIndicator={false}>
              <Pressable onPress={() => setCaptionOpen(false)} accessibilityRole="button" accessibilityLabel="Encolher a legenda">
                <RichText text={post.body} style={st.body} />
                <Text style={st.more}>menos</Text>
              </Pressable>
            </ScrollView>
          ) : (
            <Pressable onPress={() => setCaptionOpen(true)} disabled={!longCaption} style={{ marginTop: 6 }} accessibilityRole={longCaption ? 'button' : undefined} accessibilityLabel={longCaption ? 'Ver a legenda toda' : undefined}>
              <RichText text={post.body} style={st.body} numberOfLines={2} />
              {longCaption && <Text style={st.more}>mais</Text>}
            </Pressable>
          )
        ) : null}
        {post.locationLabel ? (
          <Pressable onPress={() => router.push(`/place/${encodeURIComponent(post.locationLabel!)}` as never)} style={st.loc} accessibilityRole="link">
            <Icon name="map-pin" size={14} color="rgba(255,255,255,0.9)" /><Text style={st.locText} numberOfLines={1}>{post.locationLabel}</Text>
          </Pressable>
        ) : null}
        {sound && <SoundMarquee sound={sound} running={shouldPlay} onPress={goSound} width={Math.min(infoW - 24, 260)} />}
      </Animated.View>

      {/* As ações do lado: autor (com seguir), brindar, comentários, repostar, guardar, partilhar, [remix] e o disco. */}
      <Animated.View style={[st.rails, { bottom: infoBottom - 2, opacity: chrome }]} pointerEvents={scrubbing || comments ? 'none' : 'box-none'}>
        <AuthorBubble post={post} mine={mine} onChange={(c) => onChange(c as Partial<Post>)} />
        <RailButton
          icon={<Animated.View style={[railStyles.circle, { transform: [{ scale: cheerPop }] }]}><Icon name="cheers" size={28} solid={!!post.cheered} color={post.cheered ? colors.brand : '#fff'} /></Animated.View>}
          label={compactCount(post.cheers)}
          onPress={() => void cheer()}
          selected={!!post.cheered}
          accessibilityLabel={post.cheered ? 'Tirar o brinde' : 'Brindar'}
          onLabelPress={post.lists?.cheers && post.cheers > 0 ? () => setPeople('cheers') : undefined}
          labelA11y="Ver quem brindou"
        />
        <RailButton icon={<View style={railStyles.circle}><Icon name="comment" size={28} color="#fff" /></View>} label={compactCount(post.comments)} onPress={() => setSheet('comments')} accessibilityLabel={`Comentários (${post.comments})`} />
        <RailButton
          icon={<View style={[railStyles.circle, post.reposted && { backgroundColor: 'rgba(16,185,129,0.9)' }]}><Icon name="repeat" size={26} color="#fff" /></View>}
          label={compactCount(post.reposts)}
          onPress={() => setSheet('repost')}
          selected={!!post.reposted}
          accessibilityLabel={post.reposted ? `Reposte feito (${post.reposts})` : `Repostar (${post.reposts})`}
          onLabelPress={post.lists?.reposts && post.reposts > 0 ? () => setPeople('reposts') : undefined}
          labelA11y="Ver quem repostou"
        />
        <RailButton icon={<View style={railStyles.circle}><BookmarkIcon on={!!post.saved} size={26} color={post.saved ? '#f5c518' : '#fff'} /></View>} onPress={() => void save()} selected={!!post.saved} accessibilityLabel={post.saved ? 'Tirar dos guardados' : 'Guardar'} />
        <RailButton icon={<View style={railStyles.circle}><Icon name="share" size={26} color="#fff" /></View>} onPress={() => setSheet('share')} accessibilityLabel="Partilhar" />
        {extraActions ?? <ReelExtraActions post={post} active={active} />}
        {sound && <SoundDisc sound={sound} spinning={shouldPlay} onPress={goSound} />}
      </Animated.View>

      {ended && onMore && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]}>
          <ReelEnd post={post} mine={mine} replay={replay} more={() => { setEnded(false); onMore(); }} bottomInset={bottomInset} />
        </View>
      )}

      {people && <PeopleSheet postId={post.id} kind={people} onClose={() => setPeople(null)} />}
      {sheet === 'share' && <ShareSheet post={post} onClose={() => setSheet(null)} />}
      {sheet === 'comments' && <CommentsSheet post={post} dim={desktop ? undefined : 0.08} onClose={() => setSheet(null)} onDelta={(d) => onChange({ comments: Math.max(0, post.comments + d) })} onGift={() => setSheet('gift')} />}
      {sheet === 'repost' && <RepostSheet post={post} onChange={onChange} onClose={() => setSheet(null)} />}
      {sheet === 'gift' && <GiftSheet postId={post.id} recipient={post.author} onClose={() => setSheet(null)} />}
      {sheet === 'menu' && <PostMenuSheet post={post} mine={mine} onClose={() => setSheet(null)} onSaved={(saved) => onChange({ saved })} onShare={() => setSheet('share')} />}
      {sheet === 'report' && <ReportSheet type="post" id={post.id} onClose={() => setSheet(null)} onReported={() => setTimeout(() => onMore?.(), 1200)} />}
      {sheet === 'hold' && (
        <HoldMenu
          mine={mine}
          saved={!!post.saved}
          canGift={post.canGift}
          speed={speed}
          captions={captions.has}
          captionsOn={captions.on}
          onSpeed={(r) => { setSpeed(r); setSheet(null); if (r !== 1) say(`Velocidade ${speedLabel(r)}`, 900); }}
          onClose={() => setSheet(null)}
          onPick={(it) => {
            if (it === 'not-interested') return notInterested();
            if (it === 'report') return setSheet('report');
            if (it === 'save') { setSheet(null); return void save(); }
            if (it === 'captions') { setSheet(null); return toggleCaptions(); }
            if (it === 'gift') return setSheet('gift');
            setSheet('menu');
          }}
        />
      )}
    </View>
  );
}

/** O topo das tchekas: «+» (nova), os separadores «Para ti» e «A seguir», e os filtros do algoritmo. */
function ReelsTop({ tab, onTab, top }: { tab: ReelTab; onTab: (t: ReelTab) => void; top: number }) {
  const router = useRouter();
  return (
    <View style={[st.top, { paddingTop: top }]} pointerEvents="box-none">
      {/* Sem seta de voltar: nas tchekas o deslize para os lados muda de aba. */}
      <Pressable onPress={() => router.push('/new' as never)} style={({ pressed }) => [st.topBtn, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel="Nova tcheka"><Icon name="plus" size={26} color="#fff" strokeWidth={2.4} /></Pressable>
      <View style={st.tabs} accessibilityRole="tablist">
        {REEL_TABS.map((t) => {
          const on = t.id === tab;
          return (
            <Pressable key={t.id} onPress={() => onTab(t.id)} style={st.tab} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Text style={[st.tabText, on && st.tabTextOn]}>{t.label}</Text>
              <View style={[st.tabLine, !on && { backgroundColor: 'transparent' }]} />
            </Pressable>
          );
        })}
      </View>
      <Pressable onPress={() => router.push('/reels/filtros' as never)} style={({ pressed }) => [st.topBtn, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel="Filtros das tchekas"><Icon name="sliders" size={22} color="#fff" /></Pressable>
    </View>
  );
}

/** Junta as alterações de uma tcheka em todas as listas de tchekas («Para ti», «A seguir» e a da página /r). */
export function patchReels(qc: ReturnType<typeof useQueryClient>, id: string, p: Partial<Post>) {
  qc.setQueriesData<InfiniteData<Page<Post>>>({ queryKey: ['reels'] }, (d) => d && d.pages ? { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((i) => (i.id === id ? { ...i, ...p } : i)) })) } : d);
}

/** Tchekas: vídeos curtos em ecrã inteiro, um de cada vez. Desliza para cima para o seguinte. */
export default function Reels() {
  const desktop = useDesktop();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  // Ecrã todo (também a zona do relógio e da bateria no iPhone) enquanto a Tcheka está à frente.
  useEffect(() => {
    if (!focused) return;
    enterImmersive();
    return () => leaveImmersive();
  }, [focused]);
  const { start: startId } = useLocalSearchParams<{ start?: string }>();
  const [tab, setTab] = useState<ReelTab>('foryou');
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  const list = useRef<FlatList<Post>>(null);
  const activeRef = useRef(0);
  activeRef.current = active;

  const q = useInfiniteQuery({
    queryKey: reelsKey(tab),
    queryFn: ({ pageParam }) => api.reels(pageParam, tab === 'following'),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  // Vindo de uma ligação com ?start=<id>: esse reel passa à frente (em «Para ti») e os outros seguem-se.
  const startPost = useQuery({ queryKey: ['post', startId], queryFn: () => api.getPost(startId!), enabled: !!startId, retry: false });
  const listed = q.data?.pages.flatMap((p) => p.items) ?? [];
  const lead = tab === 'foryou' && startPost.data && isTcheka(startPost.data) ? [startPost.data] : [];
  const seen = new Set<string>();
  const items = (tab === 'foryou' && startId && startPost.isLoading ? [] : [...lead, ...listed]).filter((p) => isTcheka(p) && !seen.has(p.id) && !!seen.add(p.id));

  function patch(id: string, p: Partial<Post>) {
    patchReels(qc, id, p);
    if (startId && startPost.data?.id === id) qc.setQueryData(['post', startId], (d: Post | undefined) => (d ? { ...d, ...p } : d));
  }
  function pickTab(t: ReelTab) {
    if (t === tab) { list.current?.scrollToOffset({ offset: 0, animated: true }); return; }
    setActive(0);
    setTab(t);
  }

  // O reel em cena é o que ocupa mais de 70% do ecrã.
  const viewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null) setActive(i);
  }).current;
  const viewConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;

  // A altura do contentor muda (barra de endereços do Safari, rodar o telemóvel): mantém o mesmo reel alinhado.
  useEffect(() => {
    if (height > 0 && activeRef.current > 0) list.current?.scrollToOffset({ offset: activeRef.current * height, animated: false });
  }, [height]);

  // Perto do fim, pede mais.
  useEffect(() => {
    if (items.length > 0 && active >= items.length - 2 && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items.length, q.hasNextPage, q.isFetchingNextPage]);

  /** Do fim de um reel (ou "Não me interessa") para o seguinte; no último carrega mais, e se não houver volta ao primeiro. */
  const goNext = useCallback((index: number) => {
    const next = index + 1;
    if (next < items.length) list.current?.scrollToIndex({ index: next, animated: true });
    else if (q.hasNextPage) void q.fetchNextPage();
    else if (items.length > 1) list.current?.scrollToIndex({ index: 0, animated: true });
  }, [items.length, q]);

  // Computador: ↑/↓ (e a roda do rato) passam à tcheka anterior/seguinte, uma de cada vez; espaço pausa; ←/→ 5 s.
  const goTo = useCallback((k: number) => {
    if (k < 0 || k >= items.length) { if (k >= items.length && q.hasNextPage) void q.fetchNextPage(); return; }
    list.current?.scrollToIndex({ index: k, animated: true });
  }, [items.length, q]);
  const desk = useDeskReels(focused, () => activeRef.current, goTo);
  const pauseSignal = desk.pauseSignal;

  // Como uma app nativa: barra de estado preta nos Reels (iPhone, Safari/PWA).
  useEffect(() => {
    if (!isWeb || !focused || typeof document === 'undefined') return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const before = meta?.content;
    if (meta) meta.content = '#000000';
    return () => { if (meta && before) meta.content = before; };
  }, [focused]);
  // Os Reels não são um leitor de média: sem cartão no ecrã de bloqueio nem nos controlos do telemóvel.
  useEffect(() => {
    if (!isWeb || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = null;
    for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto'] as const) {
      try { ms.setActionHandler(a, null); } catch { /* ação não suportada */ }
    }
  }, []);

  // isPending: sem rede o pedido fica em pausa (não é "Ainda sem tchekas").
  const loading = q.isPending || (tab === 'foryou' && !!startId && startPost.isPending);
  const web = isWeb ? ({ overscrollBehavior: 'contain', scrollSnapType: 'y mandatory' } as object) : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View ref={desk.ref as never} style={[st.column, desktop && height > 0 && { maxWidth: Math.min(576, Math.round((height * 9) / 16)) }]} onLayout={(e: LayoutChangeEvent) => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0) setHeight((o) => (Math.abs(o - h) >= 1 ? h : o)); }}>
        {height > 0 && (
          <FlatList
            key={tab}
            ref={list}
            style={[{ flex: 1 }, web]}
            data={items}
            extraData={`${height}|${active}|${focused}`}
            keyExtractor={(p) => p.id}
            pagingEnabled
            snapToInterval={height}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            bounces={false}
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
            onViewableItemsChanged={viewable}
            viewabilityConfig={viewConfig}
            // A seguinte e a anterior ficam montadas (leitor carregado, parado na primeira imagem): ao deslizar já está pronta.
            windowSize={3}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            onScrollToIndexFailed={(info) => list.current?.scrollToOffset({ offset: info.index * height, animated: true })}
            renderItem={({ item, index }) => (
              reelMounted(index, active)
                ? <Reel pauseSignal={pauseSignal} seekSignal={desk.seekSignal} post={item} active={index === active} onScreen={focused} height={height} onChange={(c) => patch(item.id, c)} me={user?.id} onMore={() => goNext(index)} bottomInset={desktop ? Math.max(insets.bottom, 16) : 76 + Math.max(insets.bottom, 8)} />
                : <ReelPoster post={item} height={height} />
            )}
            onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
            onEndReachedThreshold={1}
            ListEmptyComponent={
              loading ? <View style={[st.center, { height }]}><ActivityIndicator color="#fff" /></View> : q.isError ? (
                <View style={[st.center, { height, paddingHorizontal: 32 }]} accessibilityRole="alert">
                  <Icon name="film" size={52} color="rgba(255,255,255,0.7)" />
                  <Text style={st.emptyTitle}>Ups, as tchekas não carregaram</Text>
                  <Text style={st.emptySub}>Verifica a ligação e tenta outra vez.</Text>
                  <Pressable onPress={() => void q.refetch()} style={({ pressed }) => [st.cta, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button"><Text style={st.ctaText}>Tentar outra vez</Text></Pressable>
                </View>
              ) : tab === 'following' ? (
                <View style={[st.center, { height, paddingHorizontal: 32 }]}>
                  <Icon name="users" size={52} color="rgba(255,255,255,0.7)" />
                  <Text style={st.emptyTitle}>Nada de quem segues</Text>
                  <Text style={st.emptySub}>Quando a malta que segues publicar tchekas, aparecem aqui.</Text>
                  <Pressable onPress={() => pickTab('foryou')} style={({ pressed }) => [st.cta, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button"><Text style={st.ctaText}>Ver «Para ti»</Text></Pressable>
                </View>
              ) : (
                <View style={[st.center, { height, paddingHorizontal: 32 }]}>
                  <Icon name="film" size={52} color="rgba(255,255,255,0.7)" />
                  <Text style={st.emptyTitle}>Ainda sem tchekas</Text>
                  <Text style={st.emptySub}>Sê tu a começar: grava um vídeo até 60 segundos.</Text>
                  <Pressable onPress={() => router.push('/new' as never)} style={({ pressed }) => [st.cta, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button"><Text style={st.ctaText}>Publicar um vídeo</Text></Pressable>
                </View>
              )
            }
          />
        )}
        <ReelsTop tab={tab} onTab={pickTab} top={Math.max(insets.top, 12)} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  column: { flex: 1, width: '100%', maxWidth: 576, alignSelf: 'center', backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%' },
  flashWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  muteCenter: { marginBottom: 14, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  flash: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  failed: { paddingHorizontal: 24, textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  toastWrap: { position: 'absolute', left: 0, right: 0, top: '42%', alignItems: 'center', zIndex: 16 },
  toast: { overflow: 'hidden', borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: 15, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 10 },
  speedChip: { position: 'absolute', top: 100, right: 12, zIndex: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4 },
  speedChipText: { color: '#fff', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  info: { position: 'absolute', left: 12, right: 76 },
  authorName: { color: '#fff', fontWeight: '700', fontSize: 16, ...SHADOW },
  body: { color: '#fff', fontSize: 15, lineHeight: 20.6, ...SHADOW },
  more: { marginTop: 2, color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '700', ...SHADOW },
  loc: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', maxWidth: '100%' },
  locText: { color: 'rgba(255,255,255,0.9)', fontSize: 14, flexShrink: 1, ...SHADOW },
  rails: { position: 'absolute', right: 8, width: 60, alignItems: 'center', gap: 10 },
  authorBubble: { width: 52, height: 62, alignItems: 'center', marginBottom: 2 },
  avatarRing: { borderRadius: 26, borderWidth: 2, borderColor: '#fff' },
  plusWrap: { position: 'absolute', bottom: 0 },
  plus: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, zIndex: 20 },
  topBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  tab: { alignItems: 'center', paddingTop: 6, paddingHorizontal: 2, minHeight: 44, justifyContent: 'center' },
  tabText: { color: 'rgba(255,255,255,0.65)', fontSize: 17, fontWeight: '700', ...SHADOW },
  tabTextOn: { color: '#fff' },
  tabLine: { marginTop: 5, width: 24, height: 3, borderRadius: 2, backgroundColor: '#fff' },
  emptyTitle: { marginTop: 16, color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center' },
  emptySub: { marginTop: 8, color: 'rgba(255,255,255,0.75)', textAlign: 'center', fontSize: 16 },
  cta: { marginTop: 24, borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 32, paddingVertical: 14 },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  end: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 96, backgroundColor: 'rgba(0,0,0,0.5)' },
  endKicker: { marginBottom: 20, fontSize: 14, fontWeight: '700', letterSpacing: 3, color: 'rgba(255,255,255,0.7)' },
  endRing: { padding: 4, borderRadius: 999, borderWidth: 4, borderColor: colors.brand },
  endName: { marginTop: 12, fontSize: 20, fontWeight: '800', color: '#fff' },
  endUser: { fontSize: 14, color: 'rgba(255,255,255,0.7)' },
  replay: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  pingRing: { ...StyleSheet.absoluteFill, borderRadius: 40, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)' },
  endReplay: { marginTop: -8, fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  endNext: { height: 48, minWidth: 220, paddingHorizontal: 32, borderRadius: 999, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 8px 16px rgba(0,0,0,0.3)' },
  endNextText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  endBrand: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  peopleMsg: { paddingVertical: 24, textAlign: 'center', color: colors.zinc500, fontSize: 16 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 24 },
  personName: { fontWeight: '600', fontSize: 16, color: colors.zinc900 },
  personUser: { fontSize: 14, color: colors.zinc500 },
});
