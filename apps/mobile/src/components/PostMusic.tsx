import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import type { Track } from '@/lib/api.music';
import { MARQUEE_GAP, badgeLine, marquee, motionOn, musicA11yLabel, ringProgress, snippetSeconds, textOn, trackArtist, trackColors, withAlpha } from '@/lib/musicLook';
import { sharedPlayer, stopTrack, trackTime, useMusicMuted, useTrackLive, setMusicMuted } from '@/lib/musicPlayer';
import { useReduceMotion } from '@/lib/reduceMotion';
import { finePointer } from '@/lib/desktopKeys';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { SoundWaves } from './SoundWaves';
import { TrackCredits, useAutoTrack } from './TrackCard';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
type Hover = { pressed: boolean; hovered?: boolean };
const web = Platform.OS === 'web';
/** Estilos só da web (vidro, máscaras, sombras em CSS); no telemóvel não existem. */
const onWeb = (o: object) => (web ? (o as object) : null);

/* ------------------------------------------------------------------ peças ------------------------------------------------------------------ */

/**
 * Texto numa linha que corre devagar (marquee) quando não cabe, com as pontas a desvanecer na web. Pára (e fica com «…»)
 * com `run` a falso: fora de vista, sem tocar ou com «reduzir movimento».
 */
export function Marquee({ text, style, run, children }: { text: string; style: TextStyle | TextStyle[]; run: boolean; /** O que se mostra parado (por omissão o texto com «…»). */ children?: ReactNode }) {
  const [boxW, setBoxW] = useState(0);
  const [textW, setTextW] = useState(0);
  const m = marquee(textW, boxW);
  const moving = run && m.run;
  return (
    <View
      style={[s.mq, moving && onWeb({ maskImage: 'linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 16px), transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 16px), transparent)' })]}
      onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (Math.abs(w - boxW) > 1) setBoxW(w); }}
    >
      {/* Mede o texto inteiro (sem limite de largura) para saber se cabe. */}
      <View style={s.measure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
        <Text style={style} onLayout={(e) => { const w = Math.ceil(e.nativeEvent.layout.width); if (Math.abs(w - textW) > 1) setTextW(w); }}>{text}</Text>
      </View>
      {moving ? (
        <Animated.View
          style={{
            flexDirection: 'row',
            width: textW * 2 + MARQUEE_GAP + 4,
            animationName: { from: { transform: [{ translateX: 0 }] }, to: { transform: [{ translateX: -m.distance }] } },
            animationDuration: `${m.ms}ms`,
            animationDelay: '1400ms',
            animationIterationCount: 'infinite',
            animationTimingFunction: 'linear',
          }}
        >
          <Text style={[style, { width: textW + 2 }]} numberOfLines={1}>{text}</Text>
          <View style={{ width: MARQUEE_GAP - 2 }} />
          <Text style={[style, { width: textW + 2 }]} numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no">{text}</Text>
        </Animated.View>
      ) : (
        children ?? <Text style={style} numberOfLines={1}>{text}</Text>
      )}
    </View>
  );
}

const EQ = [
  { lo: 0.3, ms: 520, delay: 0 },
  { lo: 0.45, ms: 380, delay: 120 },
  { lo: 0.25, ms: 610, delay: 60 },
  { lo: 0.4, ms: 450, delay: 200 },
] as const;
/** Quatro barras de equalizador: sobem e descem só enquanto `run` (animação CSS no fio da interface, nada a correr parada). */
export function Equalizer({ run, color, height = 12 }: { run: boolean; color: string; height?: number }) {
  return (
    <View style={[s.eq, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {EQ.map((b, k) => (
        <Animated.View
          key={k}
          style={[
            s.eqBar,
            { height, backgroundColor: color, transform: [{ scaleY: run ? 1 : b.lo }] },
            run && {
              animationName: { from: { transform: [{ scaleY: b.lo }] }, to: { transform: [{ scaleY: 1 }] } },
              animationDuration: `${b.ms}ms`,
              animationDelay: `${b.delay}ms`,
              animationIterationCount: 'infinite',
              animationDirection: 'alternate',
              animationTimingFunction: 'ease-in-out',
            },
          ]}
        />
      ))}
    </View>
  );
}

/** A capa da faixa (quadrada, cantos de 14) ou, sem capa, um disco com o gradiente das cores e a nota. */
function Cover({ track, size, radius = 14 }: { track: Track; size: number; radius?: number }) {
  const [c0, c1] = trackColors(track);
  return (
    <View style={[s.cover, { width: size, height: size, borderRadius: radius }]}>
      {track.cover ? (
        <Image source={{ uri: track.cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} accessible={false} />
      ) : (
        <LinearGradient colors={[c0, c1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, s.center]}>
          {/* O disco: sulcos discretos e o furo do meio, com a nota por cima. */}
          <View style={[s.groove, { width: size * 0.78, height: size * 0.78, borderRadius: size }]} />
          <View style={[s.groove, { width: size * 0.56, height: size * 0.56, borderRadius: size }]} />
          <Icon name={track.kind === 'sound' ? 'waves' : 'music'} size={Math.round(size * 0.36)} color="rgba(255,255,255,0.92)" strokeWidth={2} />
        </LinearGradient>
      )}
    </View>
  );
}

/** O que o disco precisa de uma faixa (as dos mimos não trazem capa nem cores). */
type DiscTrack = { cover?: string | null; coverColors?: [string, string] | null };
/** O mini disco do selo: a capa num círculo com o furo do meio, a rodar enquanto toca. */
function MiniDisc({ track, size, spin }: { track: DiscTrack; size: number; spin: boolean }) {
  const [c0, c1] = trackColors(track);
  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' },
        spin && { animationName: { from: { transform: [{ rotate: '0deg' }] }, to: { transform: [{ rotate: '360deg' }] } }, animationDuration: '3.6s', animationIterationCount: 'infinite', animationTimingFunction: 'linear' },
      ]}
    >
      {track.cover ? (
        <Image source={{ uri: track.cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} accessible={false} />
      ) : (
        <LinearGradient colors={[c0, c1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      <View style={[s.groove, { position: 'absolute', left: size * 0.14, top: size * 0.14, width: size * 0.72, height: size * 0.72, borderRadius: size }]} />
      <View style={[s.hole, { left: size / 2 - size * 0.12, top: size / 2 - size * 0.12, width: size * 0.24, height: size * 0.24, borderRadius: size }]} />
    </Animated.View>
  );
}

/** O botão tocar/pausar com o anel do tempo do trecho à volta (enche ao longo do trecho e recomeça com ele). */
function PlayRing({ me, track, live, paused, size, fg, onPress }: { me: symbol; track: Track; live: boolean; paused: boolean; size: number; fg: string; onPress: () => void }) {
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => {
    if (!live) { cancelAnimation(p); return; }
    // Acerta o anel pelo tempo do leitor (a duração só se sabe depois de o áudio carregar) e segue em linha reta até ao
    // fim do trecho; depois recomeça com ele. Sem ler o tempo a cada frame.
    const sync = () => {
      const tt = trackTime(me);
      if (!tt) return;
      const dur = snippetSeconds(tt.duration, track.durationMs);
      const frac = ringProgress(tt.current, dur);
      cancelAnimation(p);
      p.value = frac;
      p.value = withSequence(
        withTiming(1, { duration: Math.max(0, (1 - frac) * dur * 1000), easing: Easing.linear }),
        withRepeat(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: dur * 1000, easing: Easing.linear })), -1),
      );
    };
    const a = setTimeout(sync, 300);
    const b = setTimeout(sync, 1600);
    return () => { clearTimeout(a); clearTimeout(b); cancelAnimation(p); };
  }, [live, me, track.durationMs, p]);
  const ring = useAnimatedProps(() => ({ strokeDashoffset: C * (1 - p.value) }));
  const showPause = live && !paused;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={(st) => [s.ringBtn, { width: size, height: size }, (st as Hover).hovered && s.ringHover, st.pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={showPause ? 'Pausar a música' : 'Tocar a música'}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={withAlpha(fg === '#ffffff' ? '#ffffff' : '#18181b', 0.18)} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={fg}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${C} ${C}`}
          animatedProps={ring}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[s.ringCore, { width: size - 10, height: size - 10, borderRadius: size, backgroundColor: fg === '#ffffff' ? 'rgba(255,255,255,0.18)' : 'rgba(24,24,27,0.08)' }]}>
        <Icon name={showPause ? 'pause' : 'play'} size={16} solid color={fg} />
      </View>
    </Pressable>
  );
}

/* --------------------------------------------------------------- o cartão --------------------------------------------------------------- */

/**
 * A música de uma publicação só com texto: o cartão completo da faixa. Capa à esquerda (ou o disco do gradiente), fundo de
 * vidro com o gradiente das cores da capa, título a negrito (a correr se não couber), o artista (o local leva ao perfil, com
 * a etiqueta «Artista») e, à direita, tocar/pausar com o anel do tempo do trecho. Um toque no cartão liga ou desliga o som
 * da app (como antes); manter premido mostra os créditos. Com `soundTo` (a página do som), a ligação «Usar este som».
 */
export function MusicCard({ track, visible, soundTo }: { track: Track; /** O post está à vista: a música toca. */ visible: boolean; /** `/som/[id]`, quando a publicação tem `sound`. */ soundTo?: string | null }) {
  const [paused, setPaused] = useState(false);
  const { me, play } = useAutoTrack(track, { autoplay: true, visible, paused });
  const live = useTrackLive(me);
  const [muted, toggleMute] = useMusicMuted();
  const reduce = useReduceMotion();
  const router = useRouter();
  const [info, setInfo] = useState(false);
  const [c0, c1] = trackColors(track);
  const fg = textOn([c0, c1]);
  const sub = fg === '#ffffff' ? 'rgba(255,255,255,0.78)' : 'rgba(24,24,27,0.68)';
  const artist = trackArtist(track);
  const eqOn = motionOn({ reduce, playing: live, visible, muted });
  const mqOn = motionOn({ reduce, playing: live, visible, needsSound: false });

  // As cores da capa entram com um fade curto, por cima de um fundo neutro do mesmo tom (sem saltos de layout).
  const fade = useSharedValue(0);
  useEffect(() => { fade.value = 0; fade.value = withTiming(1, { duration: 260 }); }, [c0, c1, fade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const togglePlay = () => {
    if (live && !paused) { setPaused(true); stopTrack(me); return; }
    setPaused(false);
    if (muted) setMusicMuted(false);
    play();
  };
  // Fora de vista, a pausa da pessoa acaba: da próxima vez que o post aparecer, a música volta a tocar sozinha.
  useEffect(() => { if (!visible) setPaused(false); }, [visible]);
  const state = muted ? 'Sem som' : live ? 'A tocar' : paused ? 'Em pausa' : 'Música';

  return (
    <Pressable
      onPress={toggleMute}
      onLongPress={track.kind !== 'clip' ? () => setInfo(true) : undefined}
      delayLongPress={450}
      style={(st) => [s.card, onWeb({ boxShadow: `0 10px 28px ${withAlpha(c1, 0.28)}, 0 2px 6px rgba(0,0,0,0.06)`, transition: 'transform 160ms ease, box-shadow 160ms ease' }), (st as Hover).hovered && [s.cardHover, onWeb({ boxShadow: `0 14px 36px ${withAlpha(c1, 0.4)}, 0 2px 8px rgba(0,0,0,0.08)` })], st.pressed && s.pressedSoft]}
      accessibilityRole="button"
      accessibilityState={{ selected: muted }}
      accessibilityLabel={musicA11yLabel(track, muted)}
      accessibilityHint="Mantém premido para ver os créditos"
      {...(finePointer() ? ({ dataSet: { tip: muted ? 'Ligar o som' : 'Silenciar' } } as object) : null)}
    >
      {/* O vidro: um fundo neutro do mesmo tom e, por cima (com o fade), a capa desfocada e o gradiente das cores dela. */}
      <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', borderRadius: 22, backgroundColor: fg === '#ffffff' ? '#2a2a2e' : '#f1f1f2' }]} pointerEvents="none">
        <Animated.View style={[StyleSheet.absoluteFill, fadeStyle]}>
        {track.cover ? <Image source={{ uri: track.cover }} style={[StyleSheet.absoluteFill, { opacity: 0.5, transform: [{ scale: 1.6 }] }]} contentFit="cover" blurRadius={28} accessible={false} /> : null}
        <LinearGradient colors={[withAlpha(c0, 0.86), withAlpha(c1, 0.92)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        {/* O brilho do vidro em cima. */}
        <LinearGradient colors={['rgba(255,255,255,0.20)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 0.6 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
      {/* As ondas da música a tocar, discretas, por trás do texto do cartão. */}
      <SoundWaves active={live && !muted && visible} subtle band={0.8} tint={fg} colors={[c0, c1]} player={live ? sharedPlayer() : null} />
      <View style={[StyleSheet.absoluteFill, s.edge, { borderColor: fg === '#ffffff' ? 'rgba(255,255,255,0.22)' : 'rgba(24,24,27,0.10)' }]} pointerEvents="none" />

      <Cover track={track} size={60} />
      <View style={s.text}>
        <View style={s.kicker}>
          {live && !muted ? <Equalizer run={eqOn} color={fg} height={11} /> : <Icon name={muted ? 'volume-off' : 'music'} size={13} color={sub} strokeWidth={2.2} />}
          <Text style={[s.kickerTxt, { color: sub }]} numberOfLines={1}>{state}</Text>
          {soundTo ? (
            <Pressable onPress={() => router.push(soundTo as never)} hitSlop={8} style={(st) => [s.useSound, { borderColor: fg === '#ffffff' ? 'rgba(255,255,255,0.35)' : 'rgba(24,24,27,0.2)' }, (st as Hover).hovered && { backgroundColor: fg === '#ffffff' ? 'rgba(255,255,255,0.14)' : 'rgba(24,24,27,0.06)' }]} accessibilityRole="link" accessibilityLabel="Usar este som">
              <Text style={[s.useSoundTxt, { color: fg }]} numberOfLines={1}>Usar este som</Text>
            </Pressable>
          ) : null}
        </View>
        <Marquee text={track.title} style={[s.title, { color: fg }]} run={mqOn} />
        <View style={s.artistRow}>
          {artist.href ? (
            <Pressable onPress={() => router.push(artist.href as never)} hitSlop={6} style={{ flexShrink: 1, minWidth: 0 }} accessibilityRole="link" accessibilityLabel={`${artist.name}: ver o perfil do artista`}>
              {(st) => <Text style={[s.artist, { color: sub }, (st as Hover).hovered && { color: fg, textDecorationLine: 'underline' }]} numberOfLines={1}>{artist.name}</Text>}
            </Pressable>
          ) : (
            <Text style={[s.artist, { color: sub }]} numberOfLines={1}>{artist.name}</Text>
          )}
          {artist.local ? (
            <View style={[s.tag, { borderColor: fg === '#ffffff' ? 'rgba(255,255,255,0.55)' : withAlpha(colors.brand, 0.7) }]} accessibilityLabel="Artista">
              <Text style={[s.tagTxt, { color: fg === '#ffffff' ? '#fff' : colors.brand }]}>Artista</Text>
            </View>
          ) : null}
        </View>
      </View>
      <PlayRing me={me} track={track} live={live} paused={paused} size={46} fg={fg} onPress={togglePlay} />
      {info && <TrackCredits track={track} onClose={() => setInfo(false)} />}
    </Pressable>
  );
}

/* ---------------------------------------------------------------- o selo ---------------------------------------------------------------- */

/**
 * A música de uma publicação com fotos ou vídeo: um selo flutuante em vidro escuro no canto de baixo à esquerda da imagem
 * (nada por baixo dela), com o mini disco a rodar enquanto toca, «♪ Título · Artista» a correr e o som. Um toque liga ou
 * desliga o som da app. Com `waves`, as ondas de som atravessam o meio da foto enquanto a música toca com som.
 * Vai dentro da caixa da imagem (o Carousel põe-no por cima das fotos e por baixo dos controlos).
 */
export function MusicBadge({ track, visible, waves = false }: { track: Track; visible: boolean; waves?: boolean }) {
  const { me } = useAutoTrack(track, { autoplay: true, visible });
  const live = useTrackLive(me);
  const [muted, toggleMute] = useMusicMuted();
  const reduce = useReduceMotion();
  const spin = motionOn({ reduce, playing: live, visible, muted });
  const mqOn = motionOn({ reduce, playing: live, visible, needsSound: false });
  return (
    <>
      {waves ? <SoundWaves active={live && !muted && visible} colors={trackColors(track)} player={live ? sharedPlayer() : null} /> : null}
      <Pressable
        onPress={toggleMute}
        hitSlop={4}
        style={(st) => [s.badge, onWeb({ backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)', transition: 'background-color 140ms ease, transform 140ms ease' }), (st as Hover).hovered && s.badgeHover, st.pressed && s.pressed]}
        accessibilityRole="button"
        accessibilityState={{ selected: muted }}
        accessibilityLabel={musicA11yLabel(track, muted)}
        {...(finePointer() ? ({ dataSet: { tip: muted ? 'Ligar o som' : 'Silenciar' } } as object) : null)}
      >
        <MiniDisc track={track} size={24} spin={spin} />
        <View style={s.badgeText}>
          <Marquee text={badgeLine(track)} style={s.badgeLine} run={mqOn} />
        </View>
        <View style={s.badgeVol}>
          <Icon name={muted ? 'volume-off' : 'volume'} size={15} color="#fff" strokeWidth={2.1} />
        </View>
      </Pressable>
    </>
  );
}

/**
 * A pastilha da música no visor dos mimos: o mesmo vidro escuro do selo, com o mini disco a rodar enquanto toca,
 * «♪ Título · Artista» a correr e o botão do som. Fica à esquerda, com largura máxima, longe da assinatura do canto de baixo
 * à direita. Numa faixa de um artista local, tocar no texto leva ao perfil dele.
 */
export function MusicPill({ track, live, muted, onToggleMute, onArtist }: { track: DiscTrack & { title: string; artist?: string | null; source?: string; artistUsername?: string | null }; live: boolean; muted: boolean; onToggleMute: () => void; onArtist?: () => void }) {
  const reduce = useReduceMotion();
  const spin = motionOn({ reduce, playing: live, muted });
  const mqOn = motionOn({ reduce, playing: live, needsSound: false });
  const line = <Marquee text={badgeLine(track)} style={s.pillLine} run={mqOn} />;
  return (
    <View style={[s.pill, onWeb({ backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)' })]} accessibilityLabel={musicA11yLabel(track, muted)}>
      <MiniDisc track={track} size={28} spin={spin} />
      {onArtist ? (
        <Pressable onPress={onArtist} style={s.pillText} accessibilityRole="link" accessibilityLabel={`${badgeLine(track)}. Ver o perfil do artista`}>{line}</Pressable>
      ) : (
        <Pressable onPress={onToggleMute} style={s.pillText} accessibilityRole="button" accessibilityLabel={musicA11yLabel(track, muted)}>{line}</Pressable>
      )}
      <Pressable onPress={onToggleMute} hitSlop={6} style={(st) => [s.pillVol, (st as Hover).hovered && { backgroundColor: 'rgba(255,255,255,0.26)' }, st.pressed && s.pressed]} accessibilityRole="button" accessibilityState={{ selected: muted }} accessibilityLabel={muted ? 'Ativar o som' : 'Silenciar'}>
        <Icon name={muted ? 'volume-off' : 'volume'} size={17} color="#fff" strokeWidth={2.1} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.96 }] },
  pressedSoft: { transform: [{ scale: 0.99 }] },
  // O cartão (altura fixa: nada salta quando as cores ou a capa chegam).
  card: { marginTop: 12, height: 86, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 22, overflow: 'hidden', paddingHorizontal: 12, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  cardHover: { transform: [{ translateY: -1 }] },
  edge: { borderRadius: 22, borderWidth: 1 },
  cover: { overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.15)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  groove: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  hole: { position: 'absolute', backgroundColor: 'rgba(12,12,14,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  text: { flex: 1, minWidth: 0, justifyContent: 'center' },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 18 },
  kickerTxt: { flexShrink: 1, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  useSound: { marginLeft: 'auto', borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, height: 18, justifyContent: 'center' },
  useSoundTxt: { fontSize: 11, fontWeight: '700' },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '800', letterSpacing: -0.2 },
  artistRow: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 19 },
  artist: { fontSize: 13, fontWeight: '600' },
  tag: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 6, height: 16, justifyContent: 'center' },
  tagTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  ringBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  ringHover: { transform: [{ scale: 1.06 }] },
  ringCore: { alignItems: 'center', justifyContent: 'center' },
  eq: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  eqBar: { width: 3, borderRadius: 2, transformOrigin: 'bottom' },
  mq: { overflow: 'hidden', minWidth: 0 },
  measure: { position: 'absolute', left: 0, top: 0, width: 4000, flexDirection: 'row', opacity: 0 },
  // O selo: vidro escuro, no canto de baixo à esquerda da imagem.
  badge: { position: 'absolute', left: 12, bottom: 12, maxWidth: '68%', height: 34, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 17, paddingLeft: 5, paddingRight: 5, backgroundColor: 'rgba(14,14,18,0.58)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', zIndex: 2 },
  badgeHover: { backgroundColor: 'rgba(14,14,18,0.74)', transform: [{ scale: 1.03 }] },
  badgeText: { flexShrink: 1, minWidth: 0, maxWidth: 220 },
  badgeLine: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.1 },
  pill: { alignSelf: 'flex-start', maxWidth: '72%', height: 40, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 20, paddingLeft: 6, paddingRight: 4, backgroundColor: 'rgba(14,14,18,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  pillText: { flexShrink: 1, minWidth: 0 },
  pillLine: { color: '#fff', fontSize: 14, fontWeight: '700' },
  pillVol: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  badgeVol: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
});
