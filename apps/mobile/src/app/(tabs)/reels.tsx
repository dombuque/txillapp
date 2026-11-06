import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { enterImmersive, leaveImmersive } from '@/lib/immersive';
import { Animated, AppState, Easing, FlatList, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { BookmarkIcon } from '@/components/BookmarkIcon';
import { CommentsSheet } from '@/components/CommentsSheet';
import { FollowButton } from '@/components/FollowButton';
import { Icon } from '@/components/Icon';
import { GiftSheet, PostMenuSheet, RepostSheet } from '@/components/PostSheets';
import { RichText } from '@/components/RichText';
import { ShareSheet } from '@/components/ShareSheet';
import { Sheet } from '@/components/Sheet';
import { Wordmark } from '@/components/Wordmark';
import { api, post as postInit, raw, type Page, type Post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { abs } from '@/lib/config';
import { colors } from '@/lib/theme';

type SheetName = null | 'comments' | 'repost' | 'gift' | 'menu' | 'share';
type PeopleKind = 'cheers' | 'reposts';

const isWeb = Platform.OS === 'web';
const SHADOW = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;
/** Quantas vezes mais o reel repete sozinho (toca 3 vezes no total) antes de mostrar o fim, como no site. */
const REEL_REPEATS = 2;

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

/* ---------- Peças ---------- */

/** A barra de progresso de baixo: 3px, fundo branco 25%, a avançar a branco. Tem o seu próprio estado para não repintar o reel. */
function ProgressBar({ player, bottom }: { player: VideoPlayer; bottom: number }) {
  const w = useRef(new Animated.Value(0)).current;
  const last = useRef(0);
  useEffect(() => {
    player.timeUpdateEventInterval = 0.25;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const d = player.duration;
      const p = d > 0 ? Math.min(1, Math.max(0, currentTime / d)) : 0;
      if (p < last.current) {
        // Voltou ao início (repetição): salta sem animar para trás.
        w.stopAnimation();
        w.setValue(p);
      } else {
        // Entre duas atualizações o preenchimento avança a direito, sem saltos.
        Animated.timing(w, { toValue: p, duration: 260, easing: Easing.linear, useNativeDriver: false }).start();
      }
      last.current = p;
    });
    return () => sub.remove();
  }, [player, w]);
  return (
    <View style={[st.progress, { bottom }]} pointerEvents="none">
      <Animated.View style={{ height: '100%', backgroundColor: '#fff', width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
    </View>
  );
}

/** "Interessado / Não interessado": ensina o algoritmo (só em reels de quem não segues). */
function TeachBar({ postId, onNo, bottom }: { postId: string; onNo?: () => void; bottom: number }) {
  const [done, setDone] = useState<null | 'yes' | 'no'>(null);
  const [busy, setBusy] = useState(false);
  async function pick(v: 1 | -1) {
    if (busy) return;
    setBusy(true);
    try {
      await raw(`/posts/${postId}/interest`, { method: 'PUT', body: JSON.stringify({ value: v }) });
      setDone(v > 0 ? 'yes' : 'no');
      if (v < 0) setTimeout(() => onNo?.(), 450);
    } catch {
      /* sem rede: não conta */
    }
    setBusy(false);
  }
  if (done) {
    return (
      <View style={[st.teach, { bottom }]} accessibilityRole="alert">
        <View style={[st.teachBtn, { flex: 1 }]}><Text style={st.teachText}>{done === 'yes' ? 'Boa! Vamos mostrar mais disto.' : 'Ok, vamos mostrar menos disto.'}</Text></View>
      </View>
    );
  }
  return (
    <View style={[st.teach, { bottom }]}>
      <Pressable onPress={() => void pick(-1)} style={({ pressed }) => [st.teachBtn, { flex: 1 }, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button">
        <Icon name="x" size={16} strokeWidth={2.6} color="#fff" /><Text style={st.teachText}>Não interessado</Text>
      </Pressable>
      <Pressable onPress={() => void pick(1)} style={({ pressed }) => [st.teachBtn, { flex: 1 }, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button">
        <Icon name="check" size={16} strokeWidth={2.6} color="#fff" /><Text style={st.teachText}>Interessado</Text>
      </Pressable>
    </View>
  );
}

/** Quem brindou / repostou (se o dono deixar ver). */
function PeopleSheet({ postId, kind, onClose }: { postId: string; kind: PeopleKind; onClose: () => void }) {
  const router = useRouter();
  const q = useQuery({
    queryKey: ['post-people', postId, kind],
    queryFn: (): Promise<{ username: string; displayName: string; hasAvatar: boolean }[]> => raw(`/posts/${postId}/people/${kind}`),
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
              <Text style={st.personName} numberOfLines={1}>{p.displayName}</Text>
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
        <Pressable onPress={go} accessibilityRole="button"><Text style={st.endName}>{post.author.displayName}</Text></Pressable>
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
 * Um vídeo em ecrã inteiro com os botões à direita. `height` é a altura medida do contentor (onLayout), nunca a da janela.
 * `bottomInset`: espaço seguro de baixo quando não há barra de baixo por cima (ex.: página do reel).
 */
export function Reel({ post, active, height, onChange, me, onMore, bottomInset = 0 }: { post: Post; active: boolean; height: number; onChange: (p: Partial<Post>) => void; me?: string; onMore?: () => void; bottomInset?: number }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<SheetName>(null);
  const [people, setPeople] = useState<PeopleKind | null>(null);
  const [userPaused, setUserPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [flash, setFlash] = useState<null | 'play' | 'pause'>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loops = useRef(0);
  const { chosen, silent } = useSound();
  const visible = useAppVisible();
  const m = post.media[0];
  const mine = post.author.id === me;
  const teach = !mine && (post as Post & { authorFollowed?: boolean }).authorFollowed === false;

  const player = useVideoPlayer(abs(m.url) ?? '', (p) => {
    p.loop = !onMore;
    p.muted = true;
    p.timeUpdateEventInterval = 0.25;
  });
  // Com `onMore` o reel repete 2 vezes e mostra o fim; sem ele repete sem fim.
  useEffect(() => {
    player.loop = !onMore;
  }, [player, onMore]);
  useEffect(() => {
    const a = player.addListener('playingChange', ({ isPlaying }) => { if (isPlaying) setStarted(true); });
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
    return () => { a.remove(); b.remove(); c.remove(); };
  }, [player, onMore]);

  // Fora de cena: volta ao início, sem a pausa nem o fim anteriores.
  useEffect(() => {
    if (active) return;
    setUserPaused(false);
    setEnded(false);
    loops.current = 0;
    try { player.currentTime = 0; } catch { /* leitor ainda a carregar */ }
  }, [active, player]);

  const shouldPlay = active && visible && !userPaused && !ended;
  useEffect(() => {
    try { player.muted = silent; } catch { /* leitor libertado */ }
  }, [silent, player]);
  useEffect(() => {
    try {
      if (shouldPlay) {
        player.muted = silent;
        player.play();
      } else {
        player.pause();
      }
    } catch { /* leitor libertado */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPlay, player]);
  // O leitor para quando o reel desaparece da lista.
  useEffect(() => () => { try { player.pause(); } catch { /* já libertado */ } clearTimeout(flashTimer.current); }, [player]);

  // Conta como "visto" depois de 1 s em cena.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => void api.markSeen([post.id]).catch(() => undefined), 1000);
    return () => clearTimeout(t);
  }, [active, post.id]);

  // Toque simples (pausa/retoma) ou duplo (brinda): o simples espera um instante para ver se vem o segundo.
  const lastTap = useRef(0);
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [burst, setBurst] = useState(0);
  const burstAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => () => { if (singleTimer.current) clearTimeout(singleTimer.current); }, []);
  function onScreenTap() {
    const now = Date.now();
    if (now - lastTap.current < 280 && singleTimer.current) {
      // Duplo toque: brinda (só põe, nunca tira) e mostra o copo grande.
      clearTimeout(singleTimer.current);
      singleTimer.current = null;
      lastTap.current = 0;
      setBurst((n) => n + 1);
      burstAnim.setValue(0);
      Animated.timing(burstAnim, { toValue: 1, duration: 800, useNativeDriver: false }).start();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      if (!post.cheered) {
        onChange({ cheered: true, cheers: post.cheers + 1 });
        api.cheer(post.id).then((r) => onChange(r)).catch(() => onChange({ cheered: post.cheered, cheers: post.cheers }));
      }
      return;
    }
    lastTap.current = now;
    singleTimer.current = setTimeout(() => {
      singleTimer.current = null;
      tap();
    }, 280);
  }
  function tap() {
    const next = !userPaused;
    setUserPaused(next);
    setFlash(next ? 'pause' : 'play');
    flashAnim.setValue(0);
    Animated.spring(flashAnim, { toValue: 1, useNativeDriver: !isWeb, bounciness: 8 }).start();
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 700);
  }
  function replay() {
    loops.current = 0;
    setEnded(false);
    try { player.replay(); } catch { /* nada */ }
  }

  async function cheer() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    try {
      await (next ? api.savePost(post.id) : api.unsavePost(post.id));
    } catch {
      onChange({ saved: !next });
    }
  }

  // Posições (as do site: 1.5rem do fundo; mais acima se houver "Interessado / Não interessado").
  const base = Math.max(24, bottomInset);
  const lift = teach ? base + 57.6 : base;
  const muteBottom = teach ? Math.max(14.4, bottomInset) + 44 + 8 : 10;
  const railsBottom = muteBottom + 36 + 8; // por cima do botão do som, sem o tapar
  // A barra de progresso fica logo acima da barra de baixo (que flutua por cima dos Reels).
  const barBottom = bottomInset > 0 ? Math.max(0, bottomInset - 10) : 0;

  const circle = (on?: boolean, tone?: string) => [st.circle, on && { backgroundColor: tone ?? 'rgba(255,255,255,0.9)' }];
  const count = (n: number, kind: PeopleKind, enabled: boolean) => (
    <Pressable disabled={!enabled || n === 0} onPress={() => setPeople(kind)} style={st.countBtn} accessibilityRole="button" accessibilityLabel={kind === 'cheers' ? 'Ver quem brindou' : 'Ver quem repostou'}>
      <Text style={st.railText}>{n}</Text>
    </Pressable>
  );

  return (
    <View style={[{ height, width: '100%', backgroundColor: '#000', overflow: 'hidden' }, isWeb && ({ scrollSnapAlign: 'start', scrollSnapStop: 'always' } as object)]} accessibilityLabel={`Tcheka de ${post.author.displayName}`}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onScreenTap} accessibilityRole="button" accessibilityLabel="Tocar ou pausar (duplo toque para brindar)">
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} allowsPictureInPicture={false} playsInline pointerEvents="none" />
        {m.posterUrl && !started ? <Image source={{ uri: abs(m.posterUrl) }} style={StyleSheet.absoluteFill} contentFit="contain" pointerEvents="none" /> : null}
      </Pressable>

      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} style={st.shade} pointerEvents="none" />
      {burst > 0 && (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 15, opacity: burstAnim.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }), transform: [{ scale: burstAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.5, 1.15, 1.4] }) }] }}>
          <Icon name="cheers" size={110} strokeWidth={1.6} color="#fff" />
        </Animated.View>
      )}
      <ProgressBar player={player} bottom={barBottom} />
      {teach && <TeachBar postId={post.id} bottom={Math.max(14.4, bottomInset)} onNo={onMore} />}

      {flash && (
        <View style={st.flashWrap} pointerEvents="none">
          <Animated.View style={[st.flash, { opacity: flashAnim, transform: [{ scale: flashAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
            <Icon name={flash === 'pause' ? 'pause' : 'play'} size={38} color="#fff" solid />
          </Animated.View>
        </View>
      )}
      {failed && <View style={st.flashWrap} pointerEvents="none"><Text style={st.failed}>Não consegui carregar este vídeo.</Text></View>}

      <View style={[st.info, { bottom: lift }]} pointerEvents="box-none">
        <View style={st.author}>
          <Pressable onPress={() => router.push(`/u/${post.author.username}` as never)} accessibilityRole="button"><Avatar name={post.author.displayName} username={post.author.username} size={40} /></Pressable>
          <Pressable onPress={() => router.push(`/u/${post.author.username}` as never)} style={{ flexShrink: 1, minWidth: 0 }} accessibilityRole="button">
            <Text style={st.authorName} numberOfLines={1}>{post.author.displayName}</Text>
          </Pressable>
          {teach && <View style={{ width: 96 }}><FollowButton username={post.author.username} following={false} requested={false} isPrivate={false} /></View>}
        </View>
        {post.body ? <View style={{ marginTop: 8 }}><RichText text={post.body} style={st.body} /></View> : null}
        {post.locationLabel ? (
          <Pressable onPress={() => router.push(`/place/${encodeURIComponent(post.locationLabel!)}` as never)} style={st.loc} accessibilityRole="link">
            <Icon name="map-pin" size={14} color="rgba(255,255,255,0.9)" /><Text style={st.locText}>{post.locationLabel}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[st.rails, { bottom: railsBottom }]} pointerEvents="box-none">
        <View style={{ alignItems: 'center' }}>
          <Pressable onPress={() => void cheer()} style={({ pressed }) => [st.rail, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel={post.cheered ? 'Tirar o brinde' : 'Brindar'} accessibilityState={{ selected: !!post.cheered }}>
            <View style={circle(post.cheered)}><Icon name="cheers" size={26} color={post.cheered ? colors.brand : '#fff'} /></View>
          </Pressable>
          {count(post.cheers, 'cheers', !!post.lists?.cheers)}
        </View>
        <Pressable onPress={() => setSheet('comments')} style={({ pressed }) => [st.rail, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel={`Comentários (${post.comments})`}>
          <View style={circle()}><Icon name="comment" size={26} color="#fff" /></View>
          <Text style={st.railText}>{post.comments}</Text>
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Pressable onPress={() => setSheet('repost')} style={({ pressed }) => [st.rail, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel={post.reposted ? `Reposte feito (${post.reposts})` : `Repostar (${post.reposts})`} accessibilityState={{ selected: !!post.reposted }}>
            <View style={circle(post.reposted, 'rgba(16,185,129,0.9)')}><Icon name="repeat" size={26} color="#fff" /></View>
          </Pressable>
          {count(post.reposts, 'reposts', !!post.lists?.reposts)}
        </View>
        <Pressable onPress={() => setSheet('share')} style={({ pressed }) => [st.rail, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel="Partilhar">
          <View style={circle()}><Icon name="share" size={26} color="#fff" /></View>
        </Pressable>
        {!mine && post.canGift && (
          <Pressable onPress={() => setSheet('gift')} style={({ pressed }) => [st.rail, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel="Presentear">
            <View style={circle()}><Icon name="gift" size={26} color="#fff" /></View>
          </Pressable>
        )}
        <Pressable onPress={() => void save()} style={({ pressed }) => [st.rail, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel={post.saved ? 'Tirar dos guardados' : 'Guardar'} accessibilityState={{ selected: !!post.saved }}>
          <View style={circle(!!post.saved)}><BookmarkIcon on={!!post.saved} size={26} color={post.saved ? colors.zinc900 : '#fff'} /></View>
        </Pressable>
        <Pressable onPress={() => setSheet('menu')} style={({ pressed }) => [st.rail, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel="Mais opções">
          <View style={circle()}><Icon name="more" size={26} color="#fff" strokeWidth={3} /></View>
        </Pressable>
      </View>

      <Pressable onPress={() => setReelMuted(!chosen)} style={[st.mute, { bottom: muteBottom }]} accessibilityRole="button" accessibilityLabel={chosen ? 'Ligar o som' : 'Desligar o som'}>
        <Icon name={chosen ? 'volume-off' : 'volume'} size={18} color="#fff" />
      </Pressable>

      {ended && onMore && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]}>
          <ReelEnd post={post} mine={mine} replay={replay} more={() => { setEnded(false); onMore(); }} bottomInset={bottomInset} />
        </View>
      )}

      {people && <PeopleSheet postId={post.id} kind={people} onClose={() => setPeople(null)} />}
      {sheet === 'share' && <ShareSheet post={post} onClose={() => setSheet(null)} />}
      {sheet === 'comments' && <CommentsSheet post={post} onClose={() => setSheet(null)} onDelta={(d) => onChange({ comments: Math.max(0, post.comments + d) })} onGift={() => setSheet('gift')} />}
      {sheet === 'repost' && <RepostSheet post={post} onChange={onChange} onClose={() => setSheet(null)} />}
      {sheet === 'gift' && <GiftSheet postId={post.id} recipient={post.author} onClose={() => setSheet(null)} />}
      {sheet === 'menu' && <PostMenuSheet post={post} mine={mine} onClose={() => setSheet(null)} onSaved={(saved) => onChange({ saved })} onShare={() => setSheet('share')} />}
    </View>
  );
}

/** Reels: vídeos curtos em ecrã inteiro, um de cada vez. Desliza para cima para o seguinte. */
export default function Reels() {
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
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  const list = useRef<FlatList<Post>>(null);
  const activeRef = useRef(0);
  activeRef.current = active;

  const q = useInfiniteQuery({
    queryKey: ['reels'],
    queryFn: ({ pageParam }) => api.reels(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  // Vindo de uma ligação com ?start=<id>: esse reel passa à frente e os outros seguem-se.
  const startPost = useQuery({ queryKey: ['post', startId], queryFn: () => api.getPost(startId!), enabled: !!startId, retry: false });
  const listed = q.data?.pages.flatMap((p) => p.items) ?? [];
  const lead = startPost.data && startPost.data.media[0]?.kind === 'video' ? [startPost.data] : [];
  const seen = new Set<string>();
  const items = (startId && startPost.isLoading ? [] : [...lead, ...listed]).filter((p) => p.media[0]?.kind === 'video' && !seen.has(p.id) && !!seen.add(p.id));

  function patch(id: string, p: Partial<Post>) {
    qc.setQueryData<InfiniteData<Page<Post>>>(['reels'], (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((i) => (i.id === id ? { ...i, ...p } : i)) })) });
    if (startId && startPost.data?.id === id) qc.setQueryData(['post', startId], (d: Post | undefined) => (d ? { ...d, ...p } : d));
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

  /** Do fim de um reel (ou "Não interessado") para o seguinte; no último carrega mais, e se não houver volta ao primeiro. */
  const goNext = useCallback((index: number) => {
    const next = index + 1;
    if (next < items.length) list.current?.scrollToIndex({ index: next, animated: true });
    else if (q.hasNextPage) void q.fetchNextPage();
    else if (items.length > 1) list.current?.scrollToIndex({ index: 0, animated: true });
  }, [items.length, q]);

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

  const loading = q.isLoading || (!!startId && startPost.isLoading);
  const web = isWeb ? ({ overscrollBehavior: 'contain', scrollSnapType: 'y mandatory' } as object) : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={st.column} onLayout={(e: LayoutChangeEvent) => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0) setHeight((o) => (Math.abs(o - h) >= 1 ? h : o)); }}>
        {height > 0 && (
          <FlatList
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
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            onScrollToIndexFailed={(info) => list.current?.scrollToOffset({ offset: info.index * height, animated: true })}
            renderItem={({ item, index }) => (
              <Reel post={item} active={focused && index === active} height={height} onChange={(c) => patch(item.id, c)} me={user?.id} onMore={() => goNext(index)} bottomInset={76 + Math.max(insets.bottom, 8)} />
            )}
            onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
            onEndReachedThreshold={1}
            ListEmptyComponent={
              loading ? <View style={[st.center, { height }]}><ActivityIndicator color="#fff" /></View> : q.isError ? (
                <View style={[st.center, { height }]}><Text accessibilityRole="alert" style={{ color: 'rgba(255,255,255,0.8)' }}>Ups, falhou</Text></View>
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
        <View style={[st.top, { paddingTop: Math.max(insets.top, 12) }]} pointerEvents="box-none">
          {/* Sem seta de voltar: nos reels o deslize para os lados muda de aba. */}
          <Pressable onPress={() => router.push('/new' as never)} style={({ pressed }) => [st.topBtn, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel="Nova tcheka"><Icon name="plus" size={26} color="#fff" strokeWidth={2.4} /></Pressable>
          <Text style={st.topTitle}>Tcheka</Text>
          <Pressable onPress={() => router.push('/reels/filtros' as never)} style={({ pressed }) => [st.topBtn, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="button" accessibilityLabel="Filtros das tchekas"><Icon name="sliders" size={22} color="#fff" /></Pressable>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  column: { flex: 1, width: '100%', maxWidth: 576, alignSelf: 'center', backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%' },
  progress: { position: 'absolute', left: 0, right: 0, height: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.25)' },
  flashWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  flash: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  failed: { paddingHorizontal: 24, textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  info: { position: 'absolute', left: 16, right: 80 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  authorName: { color: '#fff', fontWeight: '700', fontSize: 16, ...SHADOW },
  body: { color: '#fff', fontSize: 15, lineHeight: 20.6 },
  loc: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  locText: { color: 'rgba(255,255,255,0.9)', fontSize: 14 },
  rails: { position: 'absolute', right: 12, alignItems: 'center', gap: 12 },
  rail: { alignItems: 'center', gap: 4 },
  circle: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  railText: { color: '#fff', fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'], ...SHADOW },
  countBtn: { minHeight: 32, minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  mute: { position: 'absolute', right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  teach: { position: 'absolute', left: 12, right: 12, zIndex: 5, flexDirection: 'row', gap: 8 },
  teachBtn: { height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  teachText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, zIndex: 20 },
  topBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  topTitle: { color: '#fff', fontSize: 18, fontWeight: '800', ...SHADOW },
  emptyTitle: { marginTop: 16, color: '#fff', fontSize: 24, fontWeight: '800' },
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
