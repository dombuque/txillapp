import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Icon } from '@/components/Icon';
import { Sticker } from '@/components/StickerPanel';
import { ReactionArt } from '@/components/StoryParts';
import { type ChatMessage } from '@/lib/api';
import { abs, sized } from '@/lib/config';
import { colors } from '@/lib/theme';

/** Bolhas do chat, iguais às do site (apps/web/src/pages/Thread.tsx), com o nome de quem envia nos grupos. */
export type Msg = ChatMessage & { state?: 'sending' | 'failed'; realId?: string; live?: boolean; liveUntil?: string | null; sender?: { username: string; displayName: string; hasAvatar: boolean } };

/** Cada pessoa tem a sua cor nos grupos (a mesma do site, apps/web/src/lib/senderColor.ts). */
const PALETTE = ['#d6334f', '#ea580c', '#b45309', '#15803d', '#0f766e', '#9f1239', '#3f3f46', '#4d7c0f'];
export function senderColor(username: string): string {
  let h = 7;
  for (const c of username.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const KIND_LABEL: Record<string, string> = { image: 'Foto', video: 'Vídeo', voice: 'Mensagem de voz', sticker: 'Sticker', post: 'Publicação', location: 'Localização', gift: 'Presente' };
/** Excerto de uma mensagem para citar (na bolha e na barra de resposta). */
export const quoteText = (kind: ChatMessage['kind'], body: string) => (kind === 'text' || kind === 'story_reply' ? body : KIND_LABEL[kind] ?? 'Mensagem');
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
        <Image key={`${t.x}/${t.y}`} source={{ uri: `https://tile.openstreetmap.org/${Z}/${t.x}/${t.y}.png` }} style={{ position: 'absolute', width: T, height: T, left: t.x * T - left, top: t.y * T - top }} />
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
    <View style={[st.voice, { backgroundColor: mine ? colors.brand : colors.zinc100 }, dim && { opacity: 0.7 }]}>
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
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: ink, opacity: 0.9 }} numberOfLines={1}>{video ? 'Reel' : 'Publicação'} de {shown.author.displayName}</Text>
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

/** Vídeo da conversa: miniatura com ▶ e um botão que o abre em ecrã inteiro. */
function MediaFull({ url, video, onClose }: { url: string; video: boolean; onClose: () => void }) {
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Fechar">
        {video ? <ChatVideoPlayer url={url} /> : <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} contentFit="contain" />}
        <Pressable onPress={onClose} style={st.fullX} accessibilityRole="button" accessibilityLabel="Fechar"><Icon name="x" size={22} color="#fff" /></Pressable>
      </Pressable>
    </Modal>
  );
}
function ChatVideoPlayer({ url }: { url: string }) {
  const p = useVideoPlayer(url, (x) => { x.play(); });
  return <VideoView player={p} style={{ width: '100%', height: '100%' }} nativeControls contentFit="contain" />;
}

export function Bubble({
  m, group = false, prevSame, nextSame, seen = false, flash = false, peerName, peerHandle, meHandle, onMenu, onRetry, onOpenOnce, onJump, onCheer, onStopLive, onReply,
}: {
  m: Msg; group?: boolean; prevSame: boolean; nextSame: boolean; seen?: boolean; flash?: boolean;
  /** Nome do outro lado, para a citação "Respondeu…" (só nas conversas diretas). */
  peerName?: string;
  /** Quem é o dono do story citado: o outro lado (se fui eu a responder) ou eu. */
  peerHandle?: string;
  meHandle?: string;
  onMenu: (m: Msg) => void; onRetry: (m: Msg) => void; onOpenOnce: (m: Msg) => void;
  onJump?: (id: string) => void; onCheer?: (m: Msg) => void; onStopLive?: (m: Msg) => void; onReply?: (m: Msg) => void;
}) {
  const router = useRouter();
  const mine = m.fromMe;
  const real = !m.id.startsWith('tmp-');
  const [full, setFull] = useState(false);
  const lastTap = useRef(0);
  const radius = mine
    ? { borderRadius: 20, borderBottomRightRadius: 6, ...(prevSame ? { borderTopRightRadius: 6 } : null) }
    : { borderRadius: 20, borderBottomLeftRadius: 6, ...(prevSame ? { borderTopLeftRadius: 6 } : null) };
  const tone = mine ? { backgroundColor: colors.brand } : { backgroundColor: colors.zinc100 };
  const ink = mine ? '#fff' : colors.zinc900;
  const dimStyle = m.state === 'sending' ? { opacity: 0.7 } : null;
  void onReply;

  let content: React.ReactNode;
  if (m.viewOnce) {
    const label = m.opened ? 'Aberta' : mine ? 'Visualização única · por abrir' : m.kind === 'image' ? 'Foto · toca para abrir' : m.kind === 'video' ? 'Vídeo · toca para abrir' : m.kind === 'voice' ? 'Voz · toca para abrir' : 'Mensagem · toca para abrir';
    const bg = m.opened ? colors.zinc100 : mine ? colors.brand : colors.zinc900;
    const fg = m.opened ? colors.zinc500 : '#fff';
    content = (
      <Pressable disabled={mine || !!m.opened || m.state === 'sending'} onPress={() => onOpenOnce(m)} style={({ pressed }) => [st.once, radius, { backgroundColor: bg }, dimStyle, pressed && !mine && !m.opened && { transform: [{ scale: 0.95 }] }]}>
        <Icon name="once" size={26} color={fg} />
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
    content = <View style={dimStyle}><Sticker id={m.body} size={132} /></View>;
  } else if (m.kind === 'post') {
    content = <SharedPost post={m.post ?? null} radius={radius} tone={tone} ink={ink} />;
  } else if (m.kind === 'location' && m.lat != null && m.lng != null) {
    content = (
      <Pressable onPress={() => void Linking.openURL(`https://www.google.com/maps?q=${m.lat},${m.lng}`)} style={[st.shared, tone, radius, dimStyle, { overflow: 'hidden' }]} accessibilityRole="link">
        <TileMap lat={m.lat} lng={m.lng} width={240} height={132} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Icon name="map-pin" size={16} color={ink} />
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: ink }} numberOfLines={1}>{m.body || 'Localização'}</Text>
        </View>
      </Pressable>
    );
  } else if (m.kind === 'voice') {
    content = <View style={{ maxWidth: '86%' }}><VoiceMessage m={m} dim={m.state === 'sending'} /></View>;
  } else if ((m.kind === 'image' || m.kind === 'video') && m.mediaUrl) {
    const url = abs(m.mediaUrl) ?? m.mediaUrl;
    content = (
      <View style={[st.media, tone, radius, dimStyle]}>
        <Pressable onPress={() => setFull(true)} accessibilityRole="imagebutton" accessibilityLabel={m.kind === 'video' ? 'Vídeo' : 'Foto enviada'}>
          <View style={{ height: m.kind === 'video' ? 288 : 288, width: '100%', backgroundColor: m.kind === 'video' ? '#000' : colors.zinc100 }}>
            <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
            {m.kind === 'video' && <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}><Icon name="play" size={24} solid color="#fff" /></View></View>}
            {m.kind === 'video' && <View style={st.expand}><Icon name="expand" size={18} color="#fff" /></View>}
          </View>
        </Pressable>
        {m.kind === 'image' && m.body ? <Text style={{ paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, color: ink }}>{m.body}</Text> : null}
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
            <Text style={{ marginBottom: 6, paddingHorizontal: 4, fontSize: 12, color: colors.zinc500 }}>{mine ? 'Respondeste à nota' : 'Respondeu à tua nota'}</Text>
            <View style={[{ borderColor: colors.zinc200, alignItems: mine ? 'flex-end' : 'flex-start' }, mine ? { borderRightWidth: 2, paddingRight: 8 } : { borderLeftWidth: 2, paddingLeft: 8 }]}>
              <Text style={st.noteBubble}>{noteReply[1]}</Text>
            </View>
          </View>
        )}
        <View style={[st.bubble, tone, radius, dimStyle]}><Text selectable style={[st.text, { color: ink }]}>{shown}</Text></View>
      </View>
    );
  }

  const onPress = () => {
    if (!real || m.viewOnce || !onCheer) return;
    const now = Date.now();
    if (now - lastTap.current < 320) {
      lastTap.current = 0;
      onCheer(m);
    } else lastTap.current = now;
  };
  const storyLabel = m.kind === 'story_reaction' ? (mine ? 'Reagiste ao story' : 'Reagiu ao teu story') : mine ? 'Respondeste ao story' : 'Respondeu ao teu story';

  return (
    <View style={[{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: prevSame ? 2 : 12, borderRadius: 24 }, flash && { backgroundColor: 'rgba(214,51,79,0.15)' }]}>
      {group && !mine && !prevSame && m.sender && <Text style={{ marginBottom: 2, paddingHorizontal: 4, fontSize: 12, fontWeight: '700', color: senderColor(m.sender.username) }}>{m.sender.displayName.split(' ')[0]}</Text>}
      {m.replyTo && <Text style={{ marginBottom: 4, paddingHorizontal: 4, fontSize: 12, color: colors.zinc500 }}>{mine ? 'Respondeste' : !m.replyTo.gone && m.replyTo.fromMe ? 'Respondeu-te' : 'Respondeu'}</Text>}
      {m.replyTo && (
        <Pressable
          disabled={m.replyTo.gone}
          onPress={() => !m.replyTo!.gone && onJump?.(m.replyTo!.id)}
          style={({ pressed }) => [st.reply, mine ? { borderLeftColor: 'rgba(214,51,79,0.7)', backgroundColor: 'rgba(214,51,79,0.1)' } : { borderLeftColor: '#a1a1aa', backgroundColor: '#fafafa' }, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          {m.replyTo.gone ? <Text style={{ fontStyle: 'italic', color: colors.zinc600, fontSize: 13 }}>Mensagem apagada</Text> : (
            <>
              <Text style={{ fontWeight: '700', color: colors.zinc700, fontSize: 13, lineHeight: 18 }} numberOfLines={1}>{m.replyTo.fromMe ? 'Tu' : m.replyTo.name || peerName}</Text>
              <Text style={{ color: colors.zinc600, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>{quoteText(m.replyTo.kind, m.replyTo.body)}</Text>
            </>
          )}
        </Pressable>
      )}
      {m.storyUrl ? (
        <Pressable onPress={() => { const o = mine ? peerHandle : meHandle; if (o) router.push(`/stories/${o}` as never); }} style={{ marginBottom: 4 }} accessibilityRole="button" accessibilityLabel="Ver o story">
          <Image source={{ uri: sized(m.storyUrl, 160) }} style={{ height: 112, width: 72, borderRadius: 12, opacity: 0.9 }} contentFit="cover" />
        </Pressable>
      ) : null}
      {(m.kind === 'story_reply' || m.kind === 'story_reaction') && <Text style={{ marginBottom: 2, fontSize: 12, color: colors.zinc500 }}>{storyLabel}</Text>}
      <Pressable onPress={onPress} onLongPress={real ? () => onMenu(m) : undefined} delayLongPress={450} style={{ maxWidth: m.kind === 'text' || m.kind === 'story_reply' ? '82%' : m.kind === 'image' || m.kind === 'video' ? '75%' : '100%' }}>{content}</Pressable>
      {!!m.reactions?.length && (
        <Pressable onPress={() => onMenu(m)} accessibilityRole="button" accessibilityLabel="Reações" style={[st.reactions, mine ? { marginRight: 12 } : { marginLeft: 12 }]}>
          {m.reactions.map((r) => (
            <View key={r.reaction} style={[st.react, r.mine && { backgroundColor: 'rgba(214,51,79,0.1)' }]}>
              <ReactionArt body={r.reaction} size={22} />
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
          <Pressable onPress={() => onRetry(m)} hitSlop={6}><Text style={{ fontSize: 12, fontWeight: '600', color: colors.red600, textDecorationLine: 'underline' }}>Tentar de novo</Text></Pressable>
        </View>
      ) : m.state === 'sending' ? (
        <Text style={st.time}>A enviar…</Text>
      ) : (
        !nextSame && <Text style={st.time}>{clock(m.at)}{mine && seen ? ' · Visto' : ''}</Text>
      )}
    </View>
  );
}

/** Os três pontos de "a escrever…". */
export function TypingBubble() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x + 1) % 3), 400);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={{ marginTop: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, borderBottomLeftRadius: 6, backgroundColor: colors.zinc100, paddingHorizontal: 14, paddingVertical: 12 }} accessibilityLabel="A escrever">
      {[0, 1, 2].map((d) => <View key={d} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.zinc500, opacity: n === d ? 1 : 0.4, transform: [{ translateY: n === d ? -2 : 0 }] }} />)}
    </View>
  );
}

const st = StyleSheet.create({
  bubble: { paddingHorizontal: 16, paddingVertical: 10 },
  text: { fontSize: 16, lineHeight: 22 },
  time: { marginTop: 2, paddingHorizontal: 4, fontSize: 11, color: colors.zinc500 },
  reply: { marginBottom: 2, maxWidth: '78%', borderLeftWidth: 4, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  reactions: { marginTop: -8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: colors.white, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: colors.zinc100, boxShadow: '0 1px 6px rgba(0,0,0,0.18)' },
  react: { flexDirection: 'row', alignItems: 'center', borderRadius: 999 },
  media: { width: 240, overflow: 'hidden' },
  expand: { position: 'absolute', right: 8, top: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  fullX: { position: 'absolute', right: 12, top: 40, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  once: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  gift: { width: 240, overflow: 'hidden', borderRadius: 20, boxShadow: '0 2px 10px rgba(214,51,79,0.35)' },
  giftIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  shared: { width: 240 },
  voice: { width: 264, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 999, paddingVertical: 6, paddingLeft: 6, paddingRight: 14 },
  voiceBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  wave: { flex: 1, minWidth: 0, height: 40, flexDirection: 'row', alignItems: 'center', gap: 2 },
  noteBubble: { maxWidth: '100%', borderRadius: 22, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12, textAlign: 'center', fontSize: 15, lineHeight: 20.6, fontWeight: '500', color: colors.zinc800, overflow: 'hidden' },
});
