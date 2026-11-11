import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Avatar } from '@/components/Avatar';
import { ReplySwipe, type ReplySpot } from '@/components/ReplySwipe';
import { Icon } from '@/components/Icon';
import { CallIcon } from '@/components/calls/CallIcons';
import { Sticker } from '@/components/StickerPanel';
import { ReactionArt } from '@/components/StoryParts';
import { PollBubble } from '@/components/groups/PollCard';
import { TILE_URL } from '@/components/nearby/mapRuntime';
import { type ChatMessage } from '@/lib/api';
import { AVATAR, AVATAR_GAP, GAP_IN, GAP_OUT, corners, type Ticks } from '@/lib/chatLayout';
import { timeLabel } from '@/lib/chatTimeline';
import { abs, sized } from '@/lib/config';
import { canSwipeReply } from '@/lib/replySwipe';
import { colors } from '@/lib/theme';

/** Fundo das bolhas da outra pessoa. */
const OTHER_BG = '#ffffff';
/** Bolhas da outra pessoa: brancas sobre o fundo cinzento claro da conversa, com uma borda fina e uma sombra muito suave. */
const OTHER_SURFACE: ViewStyle = { backgroundColor: OTHER_BG, borderWidth: 1, borderColor: '#ececf0', boxShadow: '0 1px 2px rgba(16,24,40,0.05)' };
/** Linha da citação nas minhas mensagens (a marca, suave). */
const QUOTE_BAR_MINE = 'rgba(214,51,79,0.45)';

/**
 * Bolhas do chat: as minhas na cor da marca, as da outra pessoa brancas com borda fina; mensagens seguidas da mesma pessoa
 * agrupam-se (cantos interiores mais pequenos) e o avatar dela vai na última do grupo. O agrupamento vem de lib/chatTimeline; os cantos e os vistos, de lib/chatLayout.
 * Nos grupos, o nome de quem envia por cima da primeira bolha do grupo.
 */
export type Msg = ChatMessage & { state?: 'sending' | 'failed'; realId?: string; live?: boolean; liveUntil?: string | null; sender?: { username: string; displayName: string; hasAvatar: boolean } };

/** Cada pessoa tem a sua cor nos grupos (a mesma do site, apps/web/src/lib/senderColor.ts). */
const PALETTE = ['#d6334f', '#ea580c', '#b45309', '#15803d', '#0f766e', '#9f1239', '#3f3f46', '#4d7c0f'];
export function senderColor(username: string): string {
  let h = 7;
  for (const c of username.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const KIND_LABEL: Record<string, string> = { image: 'Foto', video: 'Vídeo', voice: 'Mensagem de voz', sticker: 'Sticker', post: 'Publicação', location: 'Localização', gift: 'Presente', poll: 'Sondagem' };
/** Excerto de uma mensagem para citar (na bolha e na barra de resposta). */
export const quoteText = (kind: ChatMessage['kind'], body: string) => (kind === 'text' || kind === 'story_reply' || kind === 'zas_reply' ? body : KIND_LABEL[kind] ?? 'Mensagem');
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
export const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const yest = new Date();
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Hoje';
  if (d.toDateString() === yest.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
/** "Visto há 5 min", "Visto hoje às 14:20", "Visto ontem", "Visto a 3 de out". */
export function seenLabel(iso: string | null) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Visto agora mesmo';
  if (mins < 60) return `Visto há ${mins} min`;
  const d = new Date(iso);
  const now = new Date();
  const yest = new Date();
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Visto hoje às ${clock(iso)}`;
  if (d.toDateString() === yest.toDateString()) return 'Visto ontem';
  return `Visto a ${d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })}`;
}

// ----- mapa -----
const Z = 16;
const T = 256;
const px = (lat: number, lng: number) => {
  const n = 2 ** Z;
  const r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n * T, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * T };
};
/** Um mosaico do OpenStreetMap, pelo servidor do Txillapp (/tiles), como os outros mapas: o aparelho não fala com o OSM. */
const tileUri = (x: number, y: number) => TILE_URL.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y));
/** Mini-mapa fixo de um ponto (azulejos do OpenStreetMap à volta do ponto), como no site. */
function TileMap({ lat, lng, width, height }: { lat: number; lng: number; width: number; height: number }) {
  const c = px(lat, lng);
  const left = c.x - width / 2;
  const top = c.y - height / 2;
  const tiles: { x: number; y: number }[] = [];
  for (let ty = Math.floor(top / T); ty <= Math.floor((top + height) / T); ty++) for (let tx = Math.floor(left / T); tx <= Math.floor((left + width) / T); tx++) tiles.push({ x: tx, y: ty });
  return (
    <View style={{ width, height, overflow: 'hidden', backgroundColor: colors.zinc200 }}>
      {tiles.map((t) => (
        <Image key={`${t.x}/${t.y}`} source={{ uri: tileUri(t.x, t.y) }} style={{ position: 'absolute', width: T, height: T, left: t.x * T - left, top: t.y * T - top }} />
      ))}
      <View style={{ position: 'absolute', left: width / 2 - 15, top: height / 2 - 38 }}>
        <Svg width={30} height={38} viewBox="0 0 30 38" fill="none">
          <Path d="M15 37C15 37 28 24.5 28 14.5a13 13 0 1 0-26 0C2 24.5 15 37 15 37Z" fill="#d6334f" stroke="#fff" strokeWidth={2.5} />
          <Circle cx={15} cy={14.5} r={5} fill="#fff" />
        </Svg>
      </View>
    </View>
  );
}

// ----- voz -----
const BARS = 42;
const RATES = [1, 1.5, 2];
let rate = 1;
/** Alturas das barras (0..1): a onda medida na gravação ou, em mensagens antigas, uma onda estável feita a partir do id. */
function waveShape(m: Pick<ChatMessage, 'id' | 'waveform'>): number[] {
  const out: number[] = [];
  if (m.waveform && m.waveform.length >= 8) {
    const w = m.waveform;
    for (let i = 0; i < BARS; i++) {
      const a = Math.floor((i * w.length) / BARS);
      const b = Math.max(a + 1, Math.floor(((i + 1) * w.length) / BARS));
      let sum = 0;
      for (let k = a; k < b; k++) sum += Number(w[k]);
      out.push(0.16 + 0.84 * (sum / (b - a) / 9));
    }
    return out;
  }
  let seed = [...m.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 17);
  for (let i = 0; i < BARS; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out.push(0.2 + 0.8 * Math.abs(Math.sin(i * 0.55 + (seed % 100) / 40)) * (0.45 + (seed % 55) / 100));
  }
  return out;
}

/** Mensagem de voz: tocar/pausar, onda real, tocar na onda para avançar ou recuar, velocidade 1×/1,5×/2× e tempo. */
function VoiceMessage({ m, dim }: { m: Msg; dim: boolean }) {
  const mine = m.fromMe;
  const player = useAudioPlayer(abs(m.mediaUrl) ?? '');
  const status = useAudioPlayerStatus(player);
  const [speed, setSpeed] = useState(rate);
  const [w, setW] = useState(0);
  const heights = useMemo(() => waveShape(m), [m.id, m.waveform]); // eslint-disable-line react-hooks/exhaustive-deps
  const len = m.durationMs ?? Math.round((status.duration || 0) * 1000);
  const at = Math.round((status.currentTime || 0) * 1000);
  const frac = len ? Math.min(1, at / len) : 0;
  const playing = status.playing;
  useEffect(() => () => { try { player.pause(); } catch { /* já libertado */ } }, [player]);
  const toggle = () => {
    try {
      if (playing) player.pause();
      else {
        player.setPlaybackRate(rate);
        player.play();
      }
    } catch { /* sem áudio */ }
  };
  const seek = (x: number) => {
    if (!w || !len) return;
    try { void player.seekTo((Math.max(0, Math.min(1, x / w)) * len) / 1000); } catch { /* ainda a carregar */ }
  };
  const shown = playing || at > 0 ? at : len;
  const played = mine ? '#fff' : colors.zinc900;
  const rest = mine ? 'rgba(255,255,255,0.35)' : colors.zinc300;
  return (
    <View style={[st.voice, mine ? { backgroundColor: colors.brand } : OTHER_SURFACE, dim && { opacity: 0.7 }]}>
      <Pressable onPress={toggle} style={[st.voiceBtn, { backgroundColor: mine ? '#fff' : colors.zinc900 }]} accessibilityRole="button" accessibilityLabel={playing ? 'Pausar' : 'Ouvir mensagem de voz'}>
        <Icon name={playing ? 'pause' : 'play'} size={19} solid color={mine ? colors.brand : '#fff'} />
      </Pressable>
      <Pressable onPress={(e) => seek(e.nativeEvent.locationX)} onLayout={(e) => setW(e.nativeEvent.layout.width)} style={st.wave} accessibilityRole="adjustable" accessibilityLabel="Posição da mensagem de voz">
        {heights.map((h, i) => (
          <View key={i} pointerEvents="none" style={{ flex: 1, minWidth: 2, maxWidth: 4, height: `${Math.round(h * 100)}%`, borderRadius: 999, backgroundColor: (i + 0.5) / BARS <= frac ? played : rest }} />
        ))}
      </Pressable>
      <View style={{ width: 44, alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 12, lineHeight: 12, fontWeight: '600', fontVariant: ['tabular-nums'], color: mine ? 'rgba(255,255,255,0.9)' : colors.zinc600 }}>{mmss(shown)}</Text>
        {(playing || at > 0 || speed !== 1) && (
          <Pressable
            onPress={() => {
              rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
              setSpeed(rate);
              try { player.setPlaybackRate(rate); } catch { /* */ }
            }}
            hitSlop={6}
            style={{ marginTop: 3, borderRadius: 999, backgroundColor: mine ? 'rgba(255,255,255,0.25)' : colors.zinc200, paddingHorizontal: 5, paddingVertical: 1 }}
            accessibilityRole="button"
            accessibilityLabel="Velocidade"
          >
            <Text style={{ fontSize: 10, fontWeight: '700', color: mine ? '#fff' : colors.zinc700 }}>{String(speed).replace('.', ',')}×</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Publicação ou reel partilhado numa conversa: miniatura, autor e texto. Tocar abre o post (ou o reel). */
function SharedPost({ post, radius, tone, ink }: { post: ChatMessage['post']; radius: object; tone: object; ink: string }) {
  const router = useRouter();
  if (!post) {
    return (
      <View style={[st.shared, tone, radius, { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, opacity: 0.8 }]}>
        <Icon name="lock" size={16} color={ink} />
        <Text style={{ fontSize: 14, color: ink }}>Publicação indisponível</Text>
      </View>
    );
  }
  const shown = post.kind === 'repost' && post.repostOf ? post.repostOf : post;
  const m = shown.media[0];
  const video = m?.kind === 'video';
  const thumb = m ? (video ? m.posterUrl : sized(m.url, 480)) : null;
  const go = () => router.push((video ? `/reels?start=${shown.id}` : `/p/${shown.code ?? shown.id}`) as never);
  return (
    <Pressable onPress={go} style={[st.shared, tone, radius, { overflow: 'hidden' }]} accessibilityRole="link">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
        <Icon name={video ? 'film' : 'image'} size={14} color={ink} />
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: ink, opacity: 0.9 }} numberOfLines={1}>{video ? 'TCHEKA' : 'Publicação'} de {shown.author.displayName}</Text>
      </View>
      {thumb ? (
        <View style={{ marginTop: 8, height: 170, width: '100%', backgroundColor: colors.zinc200 }}>
          <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" />
          {video && (
            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}><Icon name="play" size={24} solid color="#fff" /></View>
            </View>
          )}
        </View>
      ) : <View style={{ marginTop: 4, paddingBottom: 4 }} />}
      {shown.body ? <Text style={{ paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, lineHeight: 20.6, color: ink }} numberOfLines={3}>{shown.body}</Text> : null}
    </Pressable>
  );
}

/**
 * Visor de foto ou vídeo da conversa: um cartão centrado sobre o chat escurecido (com margens, não a tela toda).
 * Tocar fora fecha; o X também. O vídeo tem os controlos do próprio telemóvel/browser.
 */
export function MediaFull({ url, video, onClose }: { url: string; video: boolean; onClose: () => void }) {
  const win = useWindowDimensions();
  const w = Math.min(win.width - 32, 720);
  const h = Math.min(win.height * 0.78, 900);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={onClose} style={st.viewerBack} accessibilityLabel="Fechar">
        {/* O cartão não fecha ao toque (para o play e os controlos funcionarem). */}
        <Pressable onPress={() => undefined} style={[st.viewerCard, { width: w, height: h }]}>
          {video ? <ChatVideoPlayer url={url} autoPlay inModal /> : <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} contentFit="contain" />}
          <Pressable onPress={onClose} style={st.viewerX} accessibilityRole="button" accessibilityLabel="Fechar"><Icon name="x" size={20} color="#fff" /></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Leitor de vídeo da conversa: dentro da bolha (sem tocar sozinho) ou no visor. Controlos nativos: play, pausa, som e barra. */
function ChatVideoPlayer({ url, autoPlay = false, inModal = false }: { url: string; autoPlay?: boolean; inModal?: boolean }) {
  if (Platform.OS === 'web') {
    return createElement('video', {
      src: url, controls: true, playsInline: true, preload: 'metadata', autoPlay,
      style: { width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000', display: 'block' },
    });
  }
  return <NativeChatVideo url={url} autoPlay={autoPlay} inModal={inModal} />;
}
function NativeChatVideo({ url, autoPlay, inModal }: { url: string; autoPlay: boolean; inModal: boolean }) {
  const p = useVideoPlayer(url, (x) => { x.loop = false; x.muted = false; x.volume = 1; if (autoPlay) x.play(); });
  useEffect(() => () => { try { p.pause(); } catch { /* já libertado */ } }, [p]);
  // Dentro de um Modal ou de uma lista, no Android, o vídeo só aparece bem numa TextureView.
  return <VideoView player={p} style={{ width: '100%', height: '100%', backgroundColor: '#000' }} nativeControls contentFit="contain" surfaceType={inModal || Platform.OS === 'android' ? 'textureView' : undefined} />;
}

/** O texto da chamada registada na conversa (o corpo é JSON {video, status, durationS}; quem enviou é quem ligou). */
export function callLabel(body: string, mine: boolean): { text: string; missed: boolean; video: boolean } {
  let info: { video?: boolean; status?: string; durationS?: number | null } = {};
  try { info = JSON.parse(body) as typeof info; } catch { /* corpo estranho: mostra o genérico */ }
  const video = !!info.video;
  const kind = video ? 'Videochamada' : 'Chamada de voz';
  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  switch (info.status) {
    case 'ended': return { text: `${kind} · ${mmss(Math.max(0, info.durationS ?? 0))}`, missed: false, video };
    case 'declined': return { text: mine ? `${kind} · não atendeu` : `${kind} · recusada`, missed: false, video };
    case 'missed': return { text: mine ? `${kind} · sem resposta` : (video ? 'Videochamada perdida' : 'Chamada perdida'), missed: !mine, video };
    default: return { text: kind, missed: false, video };
  }
}

/** A chamada na conversa: um cartão pequeno com o ícone, o resultado e a hora; tocar liga de volta (o mesmo tipo de chamada). */
function CallLine({ m, mine, peerHandle }: { m: Msg; mine: boolean; peerHandle?: string }) {
  const { text, missed, video } = callLabel(m.body, mine);
  const back = () => {
    if (!peerHandle) return;
    void import('@/lib/calls').then((c) => c.startCall(peerHandle, video)).catch(() => undefined);
  };
  return (
    <Pressable onPress={back} style={({ pressed }) => [st.callLine, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`${text}. Toca para ligar de volta`}>
      <View style={[st.callIcon, { backgroundColor: missed ? '#fee2e2' : colors.zinc100 }]}>
        {video ? <Icon name="video" size={18} color={missed ? colors.red600 : colors.zinc800} /> : <CallIcon name={missed ? 'missed' : 'handset'} size={18} color={missed ? colors.red600 : colors.zinc800} />}
      </View>
      <View>
        <Text style={[st.callText, missed && { color: colors.red600 }]}>{text}</Text>
        <Text style={st.callSub}>Tocar para ligar de volta</Text>
      </View>
    </Pressable>
  );
}

/**
 * A foto citada numa resposta a um Zás ou a um mimo (entre a legenda e a bolha do texto), pequena: uma linha fina de citação
 * ao lado (à esquerda nas mensagens da outra pessoa, à direita nas minhas) e a foto.
 * O Zás vem em 4:5 (128×160) com cantos grandes e o raio num canto e não abre nada ao tocar (é de ver uma vez); o mimo (9:16, 90×160)
 * abre os mimos de quem o pôs. Se a foto já não existir (o Zás e o mimo duram 24 h, a mensagem fica), mostra um marcador.
 */
function QuotedMedia({ kind, uri, mine, label, onPress }: { kind: 'zas' | 'mimo'; uri: string | null; mine: boolean; label: string; onPress?: () => void }) {
  const [failed, setFailed] = useState(false);
  const zas = kind === 'zas';
  const ok = !!uri && !failed;
  const w = ok ? (zas ? 128 : 90) : 112;
  const h = ok ? 160 : 140;
  // Zás: retângulo 4:5 de cantos grandes e contínuos (o squircle esticado a 4:5 ficava em cápsula); mimo: raio 22.
  const shape: ViewStyle = zas ? { overflow: 'hidden', borderRadius: 30, borderCurve: 'continuous' } : { overflow: 'hidden', borderRadius: 22 };
  const bolt = (s: number) => <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}><Icon name="bolt" size={Math.round(s * 0.55)} solid color="#fff" /></View>;
  const gone = zas ? 'Zás já não disponível' : 'Mimo já não disponível';
  const pic = ok ? (
    <View style={[{ width: w, height: h, backgroundColor: colors.zinc200 }, shape]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
      {/* Dentro da curva do canto, para não ficar cortado. */}
      {zas && <View style={{ position: 'absolute', left: 10, top: 10 }}>{bolt(20)}</View>}
    </View>
  ) : (
    <View style={[OTHER_SURFACE, { width: w, height: h, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 }, shape]}>
      {zas ? bolt(26) : <Icon name="image" size={24} color={colors.zinc500} />}
      <Text style={{ textAlign: 'center', fontSize: 12, lineHeight: 16, color: colors.zinc500 }}>{gone}</Text>
    </View>
  );
  return (
    <View style={{ marginBottom: 4, flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'stretch', gap: 6 }}>
      <View style={{ width: 3, borderRadius: 2, backgroundColor: mine ? QUOTE_BAR_MINE : colors.zinc300 }} />
      {onPress && ok ? (
        <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }} accessibilityRole="button" accessibilityLabel={label}>{pic}</Pressable>
      ) : (
        <View accessible accessibilityRole="image" accessibilityLabel={ok ? label : gone}>{pic}</View>
      )}
    </View>
  );
}

/** O autor de uma bolha da outra pessoa, para o avatar (foto ou iniciais). */
type Who = { username?: string; name: string };

/** Avatar pequeno da outra pessoa ao lado da última bolha do grupo dela; tocar abre o perfil. */
function SideAvatar({ who }: { who: Who }) {
  const router = useRouter();
  const avatar = <Avatar name={who.name || '?'} username={who.username} size={AVATAR} />;
  if (!who.username) return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{avatar}</View>;
  return (
    <Pressable onPress={() => router.push(`/u/${who.username}` as never)} hitSlop={8} accessibilityRole="link" accessibilityLabel={`Perfil de ${who.name}`}>
      {avatar}
    </Pressable>
  );
}

export function Bubble({
  m, group = false, prevSame, nextSame, first, last, seen = false, ticks, flash = false, peerName, peerHandle, peerHasAvatar = true, meHandle, showAvatars = true,
  onMenu, onRetry, onOpenOnce, onJump, onCheer, onStopLive, onReply,
}: {
  m: Msg; group?: boolean;
  /** A mensagem antes/depois (no tempo) é da mesma pessoa e junta-se a esta. */
  prevSame: boolean; nextSame: boolean;
  /** Primeira/última bolha do seu grupo (por omissão: `!prevSame` / `!nextSame`, que vêm de lib/chatTimeline). */
  first?: boolean; last?: boolean;
  /** Compatibilidade: `seen` = esta minha mensagem já foi vista. Preferir `ticks`. */
  seen?: boolean;
  /** Vistos da minha mensagem, ao lado da hora da última bolha do grupo: 'sent' = ✓, 'seen' = ✓✓. Ver `ticksFor()` em lib/chatLayout. */
  ticks?: Ticks | null;
  flash?: boolean;
  /** Nome do outro lado, para a citação e o avatar (só nas conversas diretas). */
  peerName?: string;
  /** Quem é o dono do story citado: o outro lado (se fui eu a responder) ou eu. Também é o avatar nas conversas diretas. */
  peerHandle?: string;
  /** O outro lado tem foto de perfil (se não, o avatar mostra as iniciais). */
  peerHasAvatar?: boolean;
  meHandle?: string;
  /** Avatar da outra pessoa à esquerda (na última bolha do grupo; nas outras, o espaço). */
  showAvatars?: boolean;
  onMenu: (m: Msg) => void; onRetry: (m: Msg) => void; onOpenOnce: (m: Msg) => void;
  onJump?: (id: string) => void; onCheer?: (m: Msg) => void; onStopLive?: (m: Msg) => void; onReply?: (m: Msg) => void;
}) {
  const router = useRouter();
  const mine = m.fromMe;
  const real = !m.id.startsWith('tmp-');
  const [full, setFull] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (tapTimer.current) clearTimeout(tapTimer.current); }, []);
  const isFirst = first ?? !prevSame;
  const isLast = last ?? !nextSame;
  const radius = corners(mine, isFirst, isLast);
  const tone = mine ? { backgroundColor: colors.brand } : OTHER_SURFACE;
  const ink = mine ? '#fff' : colors.zinc900;
  const dimStyle = m.state === 'sending' ? { opacity: 0.7 } : null;
  const tick: Ticks | null = !mine ? null : ticks !== undefined ? ticks : seen ? 'seen' : null;
  // Deslizar para a direita responde (components/ReplySwipe); o ícone fica à esquerda da bolha, à altura do meio dela.
  const swipe = !!onReply && canSwipeReply(m);
  const reply = () => onReply?.(m);
  const [spot, setSpot] = useState<ReplySpot | null>(null);
  const rowAt = useRef({ y: 0, h: 0, x: 0 });
  const place = (p: Partial<{ y: number; h: number; x: number }>) => {
    Object.assign(rowAt.current, p);
    const { x, y, h } = rowAt.current;
    // Nas mensagens da outra pessoa o ícone fica no início da linha (à esquerda do avatar); nas minhas, à esquerda da bolha.
    const at = { x: mine ? x : 0, y, h };
    setSpot((o) => (o && o.x === at.x && o.y === at.y && o.h === at.h ? o : at));
  };

  let content: React.ReactNode;
  if (m.viewOnce) {
    const label = m.opened ? 'Aberta' : mine ? 'Visualização única · por abrir' : m.kind === 'image' ? 'Foto · toca para abrir' : m.kind === 'video' ? 'Vídeo · toca para abrir' : m.kind === 'voice' ? 'Voz · toca para abrir' : 'Mensagem · toca para abrir';
    const surface = m.opened ? OTHER_SURFACE : { backgroundColor: mine ? colors.brand : colors.zinc900 };
    const fg = m.opened ? colors.zinc500 : '#fff';
    content = (
      <Pressable disabled={mine || !!m.opened || m.state === 'sending'} onPress={() => onOpenOnce(m)} style={({ pressed }) => [st.once, radius, surface, dimStyle, pressed && !mine && !m.opened && { transform: [{ scale: 0.95 }] }]}>
        <Icon name="once" size={24} color={fg} />
        <Text style={{ fontSize: 15, fontWeight: '600', color: fg, flexShrink: 1 }}>{label}</Text>
      </Pressable>
    );
  } else if (m.kind === 'gift') {
    content = (
      <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.gift, dimStyle]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12 }}>
          <View style={st.giftIcon}><Icon name="gift" size={24} color="#fff" /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.9)' }}>{mine ? 'Enviaste um presente' : 'Enviou-te um presente'}</Text>
            <Text style={{ fontSize: 24, lineHeight: 30, fontWeight: '800', color: '#fff' }}>{(m.giftAmount ?? 0).toLocaleString('pt-PT')} Txills</Text>
          </View>
        </View>
        <Text style={{ paddingHorizontal: 16, paddingBottom: 12, paddingTop: 4, fontSize: 15, lineHeight: 20.6, color: '#fff' }}>{m.body || ' '}</Text>
      </LinearGradient>
    );
  } else if (m.kind === 'sticker') {
    content = <View style={dimStyle}><Sticker id={m.body} size={120} /></View>;
  } else if (m.kind === 'post') {
    content = <SharedPost post={m.post ?? null} radius={radius} tone={tone} ink={ink} />;
  } else if (m.kind === 'location' && m.lat != null && m.lng != null) {
    content = (
      <Pressable onPress={() => void Linking.openURL(`https://www.google.com/maps?q=${m.lat},${m.lng}`)} style={[st.shared, tone, radius, dimStyle, { overflow: 'hidden' }]} accessibilityRole="link">
        <TileMap lat={m.lat} lng={m.lng} width={240} height={132} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingVertical: 8 }}>
          <Icon name="map-pin" size={16} color={ink} />
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: ink }} numberOfLines={1}>{m.body || 'Localização'}</Text>
        </View>
      </Pressable>
    );
  } else if ((m.kind as string) === 'poll') {
    content = <PollBubble pollId={m.body} initial={(m as { poll?: import('@/lib/api.groups').Poll | null }).poll} />;
  } else if (m.kind === 'call') {
    content = <CallLine m={m} mine={mine} peerHandle={peerHandle} />;
  } else if (m.kind === 'voice') {
    content = <View style={{ maxWidth: '86%' }}><VoiceMessage m={m} dim={m.state === 'sending'} /></View>;
  } else if ((m.kind === 'image' || m.kind === 'video') && m.mediaUrl) {
    const url = abs(m.mediaUrl) ?? m.mediaUrl;
    content = (
      <View style={[st.media, tone, radius, dimStyle]}>
        {m.kind === 'video' ? (
          // Vídeo: toca dentro da bolha, com os controlos (play, pausa, som, barra); o botão do canto abre o visor.
          <View style={{ height: 288, width: '100%', backgroundColor: '#000' }}>
            <ChatVideoPlayer url={url} />
            <Pressable onPress={() => setFull(true)} style={st.expand} accessibilityRole="button" accessibilityLabel="Ver maior"><Icon name="expand" size={18} color="#fff" /></Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setFull(true)} accessibilityRole="imagebutton" accessibilityLabel="Foto enviada">
            <View style={{ height: 288, width: '100%', backgroundColor: colors.zinc200 }}>
              <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
            </View>
          </Pressable>
        )}
        {m.kind === 'image' && m.body ? <Text style={[st.text, { paddingHorizontal: 13, paddingVertical: 8, color: ink }]}>{m.body}</Text> : null}
        {full && <MediaFull url={url} video={m.kind === 'video'} onClose={() => setFull(false)} />}
      </View>
    );
  } else if (m.kind === 'story_reaction') {
    content = <View style={dimStyle}><ReactionArt body={m.body} size={64} /></View>;
  } else {
    // Resposta a uma nota: o servidor manda «Em resposta à tua nota “…”: texto».
    const noteReply = m.kind === 'text' ? /^Em resposta à tua nota “([\s\S]*?)”: ([\s\S]*)$/.exec(m.body) : null;
    const shown = noteReply ? noteReply[2] : m.body;
    content = (
      <View style={{ maxWidth: '100%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
        {noteReply && (
          <View style={{ marginBottom: 4, maxWidth: '82%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
            <Text style={st.caption}>{mine ? 'Respondeste à nota' : 'Respondeu à tua nota'}</Text>
            <View style={[{ borderColor: colors.zinc200, alignItems: mine ? 'flex-end' : 'flex-start' }, mine ? { borderRightWidth: 3, paddingRight: 6 } : { borderLeftWidth: 3, paddingLeft: 6 }]}>
              <Text style={st.noteBubble}>{noteReply[1]}</Text>
            </View>
          </View>
        )}
        <View style={[st.bubble, tone, radius, dimStyle]}><Text selectable style={[st.text, { color: ink }]}>{shown}</Text></View>
      </View>
    );
  }

  // Um toque mostra/esconde a hora; dois toques seguidos brindam (só nas mensagens já enviadas e que não são de ver uma vez).
  const canCheer = real && !m.viewOnce && !!onCheer;
  const onPress = () => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      if (canCheer) onCheer!(m);
      return;
    }
    if (!canCheer) {
      setShowTime((v) => !v);
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      setShowTime((v) => !v);
    }, 280);
  };
  const storyLabel = m.kind === 'zas_reply' ? (mine ? 'Respondeste ao Zás' : 'Respondeu ao teu Zás') : m.kind === 'story_reaction' ? (mine ? 'Reagiste ao mimo' : 'Reagiu ao teu mimo') : mine ? 'Respondeste ao mimo' : 'Respondeu ao teu mimo';

  // O avatar: nos grupos quem enviou; nas conversas diretas o outro lado.
  const who: Who | null = mine || !showAvatars ? null
    : group ? (m.sender ? { name: m.sender.displayName, username: m.sender.hasAvatar ? m.sender.username : undefined } : null)
      : { name: peerName ?? peerHandle ?? '', username: peerHasAvatar ? peerHandle : undefined };
  const indent = !mine && showAvatars && (group ? !!m.sender : true);
  const replyWho = m.replyTo && !m.replyTo.gone ? (m.replyTo.fromMe ? 'Tu' : (m.replyTo.name || peerName || '').split(' ')[0]) : '';
  const wide = m.kind === 'text' || m.kind === 'story_reply' || m.kind === 'zas_reply';
  // Hora por baixo da última bolha de cada grupo (e, nas minhas, os vistos); tocar numa bolha mostra a hora exata (com o dia).
  const timeText = showTime ? timeLabel(m.at) : isLast ? clock(m.at) : null;

  return (
    <ReplySwipe
      enabled={swipe}
      onReply={reply}
      spot={spot}
      // Uma resposta leva sempre o espaço maior por cima: a citação fica colada à SUA bolha, não à de cima.
      style={{ marginTop: isFirst || m.replyTo ? GAP_OUT : GAP_IN }}
      innerStyle={[{ alignItems: mine ? 'flex-end' : 'flex-start', borderRadius: 24 }, indent && { paddingLeft: AVATAR + AVATAR_GAP }, flash && { backgroundColor: 'rgba(214,51,79,0.15)' }]}
    >
      {group && !mine && isFirst && m.sender && <Text style={{ marginBottom: 2, paddingHorizontal: 14, fontSize: 12, fontWeight: '700', color: senderColor(m.sender.username) }}>{m.sender.displayName.split(' ')[0]}</Text>}
      {m.replyTo && (
        <Pressable
          disabled={m.replyTo.gone}
          onPress={() => !m.replyTo!.gone && onJump?.(m.replyTo!.id)}
          hitSlop={{ top: 12, bottom: 6, left: 8, right: 8 }}
          style={({ pressed }) => [st.quote, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={m.replyTo.gone ? 'Resposta a uma mensagem apagada' : `Resposta a ${replyWho}: ${quoteText(m.replyTo.kind, m.replyTo.body)}. Toca para ir à mensagem`}
        >
          <View style={[st.quoteBar, { backgroundColor: mine ? QUOTE_BAR_MINE : colors.zinc300 }]} />
          {m.replyTo.gone ? (
            <Text style={[st.quoteText, { fontStyle: 'italic' }]} numberOfLines={1}>Mensagem apagada</Text>
          ) : (
            <Text style={st.quoteText} numberOfLines={1}>
              <Text style={{ fontWeight: '600', color: colors.zinc700 }}>{replyWho}: </Text>
              {quoteText(m.replyTo.kind, m.replyTo.body)}
            </Text>
          )}
        </Pressable>
      )}
      {(m.kind === 'story_reply' || m.kind === 'story_reaction' || m.kind === 'zas_reply') && <Text style={st.caption}>{storyLabel}</Text>}
      {m.kind === 'zas_reply' ? (
        <QuotedMedia key={m.mediaUrl ?? 'gone'} kind="zas" uri={abs(m.mediaUrl) ?? null} mine={mine} label={mine ? 'Zás a que respondeste' : 'O teu Zás a que respondeu'} />
      ) : m.storyUrl ? (
        <QuotedMedia
          key={m.storyUrl}
          kind="mimo"
          uri={sized(m.storyUrl, 320) ?? null}
          mine={mine}
          label="Ver o mimo"
          onPress={() => { const o = mine ? peerHandle : meHandle; if (o) router.push(`/stories/${o}` as never); }}
        />
      ) : null}
      <View style={[st.row, { justifyContent: mine ? 'flex-end' : 'flex-start' }]} onLayout={swipe ? (e) => place({ y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }) : undefined}>
        {who && isLast && <View style={st.avatar}><SideAvatar who={who} /></View>}
        <Pressable
          onPress={onPress}
          onLongPress={real ? () => onMenu(m) : undefined}
          delayLongPress={450}
          onLayout={swipe && mine ? (e) => place({ x: e.nativeEvent.layout.x }) : undefined}
          style={{ maxWidth: wide ? '78%' : '100%' }}
          accessibilityHint={canCheer ? 'Toca para ver a hora, duas vezes para brindar, mantém para mais opções' : 'Toca para ver a hora'}
          // O mesmo que deslizar para a direita, para quem usa o leitor de ecrã.
          accessibilityActions={swipe ? [{ name: 'reply', label: 'Responder' }] : undefined}
          onAccessibilityAction={swipe ? (e) => { if (e.nativeEvent.actionName === 'reply') reply(); } : undefined}
        >
          {content}
        </Pressable>
      </View>
      {!!m.reactions?.length && (
        <Pressable onPress={() => onMenu(m)} accessibilityRole="button" accessibilityLabel="Reações" style={[st.reactions, mine ? { marginRight: 10 } : { marginLeft: 10 }]}>
          {m.reactions.map((r) => (
            <View key={r.reaction} style={[st.react, r.mine && { backgroundColor: 'rgba(214,51,79,0.1)' }]}>
              <ReactionArt body={r.reaction} size={20} />
              {r.count > 1 && <Text style={{ paddingRight: 4, fontSize: 11, fontWeight: '700', color: colors.zinc700 }}>{r.count}</Text>}
            </View>
          ))}
        </Pressable>
      )}
      {m.kind === 'location' && m.liveUntil ? (
        <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.live ? '#10b981' : colors.zinc300 }} />
          <Text style={{ fontSize: 12, fontWeight: '600', color: '#047857' }}>{m.live ? `Em direto até às ${clock(m.liveUntil)}` : 'Partilha em direto terminada'}</Text>
          {m.live && mine && <Pressable onPress={() => onStopLive?.(m)} style={{ borderRadius: 999, backgroundColor: '#fef2f2', paddingHorizontal: 12, paddingVertical: 4 }}><Text style={{ fontSize: 12, fontWeight: '600', color: '#b91c1c' }}>Parar</Text></Pressable>}
        </View>
      ) : null}
      {m.state === 'failed' ? (
        <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
          <Icon name="alert" size={14} color={colors.red600} />
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.red600 }}>Não enviada</Text>
          <Pressable onPress={() => onRetry(m)} hitSlop={10}><Text style={{ fontSize: 12, fontWeight: '600', color: colors.red600, textDecorationLine: 'underline' }}>Tentar de novo</Text></Pressable>
        </View>
      ) : m.state === 'sending' ? (
        <Text style={st.time}>A enviar…</Text>
      ) : timeText ? (
        <View style={st.meta} accessibilityLiveRegion="polite">
          <Text style={st.time}>{timeText}</Text>
          {tick && (isLast || showTime) ? (
            <Text style={[st.ticks, tick === 'seen' && { color: colors.brand }]} accessibilityLabel={tick === 'seen' ? 'Visto' : 'Entregue'}>{tick === 'seen' ? '✓✓' : '✓'}</Text>
          ) : null}
        </View>
      ) : null}
    </ReplySwipe>
  );
}

/** Os três pontos de "a escrever…" (com o avatar de quem escreve, se vier). */
export function TypingBubble({ avatar }: { avatar?: { username?: string; name: string } | null } = {}) {
  // Uma onda contínua (1,2 s por volta) que corre no lado nativo: antes eram saltos a cada 400 ms com re-render do
  // React, que no Android pareciam em câmara lenta e a encravar.
  const wave = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(wave, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [wave]);
  const dot = (d: number) => {
    const o = d * 0.18; // cada ponto sobe um pouco depois do anterior
    const inputRange = [0, o, o + 0.18, o + 0.36, 1];
    return {
      opacity: wave.interpolate({ inputRange, outputRange: [0.35, 0.35, 1, 0.35, 0.35] }),
      transform: [{ translateY: wave.interpolate({ inputRange, outputRange: [0, 0, -3, 0, 0] }) }],
    };
  };
  return (
    <View style={{ marginTop: GAP_OUT, flexDirection: 'row', alignItems: 'flex-end', gap: AVATAR_GAP }} accessibilityLabel="A escrever">
      {avatar ? <Avatar name={avatar.name || '?'} username={avatar.username} size={AVATAR} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, ...OTHER_SURFACE, paddingHorizontal: 14, paddingVertical: 12 }}>
        {[0, 1, 2].map((d) => <Animated.View key={d} style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.zinc500 }, dot(d)]} />)}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  bubble: { paddingHorizontal: 13, paddingVertical: 8 },
  text: { fontSize: 15, lineHeight: 21 },
  row: { alignSelf: 'stretch', flexDirection: 'row' },
  avatar: { position: 'absolute', left: -(AVATAR + AVATAR_GAP), bottom: 0 },
  meta: { marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6 },
  time: { fontSize: 11, lineHeight: 14, color: colors.zinc500 },
  ticks: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: -2.5, paddingRight: 2.5, color: colors.zinc500 },
  caption: { marginBottom: 4, paddingHorizontal: 6, fontSize: 12, lineHeight: 16, color: colors.zinc500 },
  quote: { maxWidth: '78%', marginBottom: 3, flexDirection: 'row', alignItems: 'stretch', gap: 6, paddingHorizontal: 4 },
  quoteBar: { width: 3, borderRadius: 2 },
  quoteText: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: colors.zinc500 },
  reactions: { marginTop: -8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: colors.white, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: colors.zinc100, boxShadow: '0 1px 4px rgba(0,0,0,0.14)' },
  react: { flexDirection: 'row', alignItems: 'center', borderRadius: 999 },
  media: { width: 240, overflow: 'hidden' },
  expand: { position: 'absolute', right: 8, top: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  viewerBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  viewerCard: { borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' },
  viewerX: { position: 'absolute', right: 10, top: 10, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  callLine: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 20, borderWidth: 1, borderColor: colors.zinc200, backgroundColor: colors.white, paddingVertical: 10, paddingLeft: 10, paddingRight: 16 },
  callIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  callText: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  callSub: { fontSize: 12, color: colors.zinc500 },
  once: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  gift: { width: 240, overflow: 'hidden', borderRadius: 20, boxShadow: '0 2px 10px rgba(214,51,79,0.35)' },
  giftIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  shared: { width: 240 },
  voice: { width: 264, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 999, paddingVertical: 6, paddingLeft: 6, paddingRight: 14 },
  voiceBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  wave: { flex: 1, minWidth: 0, height: 40, flexDirection: 'row', alignItems: 'center', gap: 2 },
  noteBubble: { maxWidth: '100%', borderRadius: 20, backgroundColor: OTHER_BG, borderWidth: 1, borderColor: '#ececf0', paddingHorizontal: 14, paddingVertical: 10, textAlign: 'center', fontSize: 15, lineHeight: 20.6, fontWeight: '500', color: colors.zinc800, overflow: 'hidden' },
});
