import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createElement, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Modal } from '@/components/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { abs } from '@/lib/config';
import { Icon } from './Icon';

/**
 * Som dos vídeos dos posts: começam sem som (o telemóvel e o browser só deixam arrancar sozinho assim). Se a pessoa liga
 * o som num vídeo, os seguintes já tentam arrancar com som (como no Instagram).
 */
let soundOn = false;

/**
 * Vídeo de um post no feed: arranca sozinho, sem som, quando o post está à vista e pára quando sai (ou quando se passa
 * para outra foto do carrossel). Um toque liga/desliga o som; dois toques brindam. Em modo `passive` (tcheka no feed)
 * só mostra o vídeo a correr: o toque é tratado por fora (abre a Tcheka).
 */
export function CarouselVideo({ url, poster, durationMs, width, height, active, inView = true, mute = false, passive = false, onDouble }: {
  url: string; poster?: string; durationMs?: number | null; width: number; height: number; active: boolean;
  /** O post está à vista (dito pela lista no telemóvel; no browser vê-se sozinho). */ inView?: boolean;
  /** Fica sempre sem som (o post já tem música). */ mute?: boolean;
  passive?: boolean; onDouble?: () => void;
}) {
  const src = abs(url) ?? '';
  const cover = abs(poster);
  const p = { src, cover, durationMs, width, height, active, inView, mute, passive, onDouble };
  return Platform.OS === 'web' ? <WebVideo {...p} /> : <NativeVideo {...p} />;
}

interface Props { src: string; cover?: string; durationMs?: number | null; width: number; height: number; active: boolean; inView: boolean; mute: boolean; passive: boolean; onDouble?: () => void }

/** Dois toques seguidos (< 280 ms) contam como duplo. */
function useDouble(onDouble?: () => void) {
  const last = useRef(0);
  return () => {
    const now = Date.now();
    const dbl = now - last.current < 280;
    last.current = dbl ? 0 : now;
    if (dbl) onDouble?.();
    return dbl;
  };
}

const secs = (ms?: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : '');

function Overlay({ playing, muted, durationMs, showSound }: { playing: boolean; muted: boolean; durationMs?: number | null; showSound: boolean }) {
  return (
    <>
      {!playing && (
        <View style={st.playWrap} pointerEvents="none">
          <View style={st.play}><Icon name="play" size={28} color="#fff" solid /></View>
        </View>
      )}
      {durationMs && !playing ? (
        <View style={st.badge} pointerEvents="none">
          <Icon name="video" size={12} color="#fff" />
          <Text style={st.badgeText}>{secs(durationMs)}</Text>
        </View>
      ) : null}
      {playing && showSound ? (
        <View style={st.sound} pointerEvents="none"><Icon name={muted ? 'volume-off' : 'volume'} size={16} color="#fff" /></View>
      ) : null}
    </>
  );
}

/** O botão do som no canto do vídeo (tem a sua própria área de toque, para não abrir a Tcheka). */
function SoundButton({ muted, onPress }: { muted: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={st.soundBtn} accessibilityRole="button" accessibilityLabel={muted ? 'Ligar o som' : 'Tirar o som'}>
      <Icon name={muted ? 'volume-off' : 'volume'} size={18} color="#fff" />
    </Pressable>
  );
}

function WebVideo({ src, cover, durationMs, width, height, active, mute, passive, onDouble }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const seen = useRef(false);
  const isDouble = useDouble(onDouble);

  function start() {
    const v = ref.current;
    if (!v || !active) return;
    v.muted = !(soundOn && !mute);
    setMuted(v.muted);
    void v.play().catch(() => { v.muted = true; setMuted(true); void v.play().catch(() => undefined); });
  }
  const startRef = useRef(start);
  startRef.current = start;

  // Passou para outra foto do carrossel: pára; voltou e está à vista: arranca.
  useEffect(() => { if (!active) ref.current?.pause(); else if (seen.current) startRef.current(); }, [active]);
  // Entrou no ecrã (60%): arranca sem som; saiu: pára.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      if (!e) return;
      seen.current = e.intersectionRatio >= 0.6;
      if (seen.current) startRef.current();
      else if (e.intersectionRatio < 0.4) el.pause();
    }, { threshold: [0, 0.4, 0.6, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  function press() {
    const v = ref.current;
    if (!v) return;
    if (isDouble()) return; // duplo toque: brinda
    if (v.paused) { start(); return; }
    if (mute) return;
    // Um toque liga/desliga o som (e fica lembrado para os próximos vídeos).
    v.muted = !v.muted;
    soundOn = !v.muted;
    setMuted(v.muted);
  }

  const video = createElement('video', {
    ref,
    src, poster: cover, playsInline: true, loop: true, muted: true, preload: 'metadata',
    onPlay: () => setPlaying(true), onPause: () => setPlaying(false),
    style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' },
  });
  if (passive) {
    // Tcheka no feed: o toque no vídeo abre a Tcheka (tratado por fora); o botão do canto liga/desliga o som.
    const toggle = () => {
      const v = ref.current;
      if (!v || mute) return;
      v.muted = !v.muted;
      soundOn = !v.muted;
      setMuted(v.muted);
      if (v.paused) void v.play().catch(() => undefined);
    };
    return (
      <View style={{ width, height, backgroundColor: '#000' }} pointerEvents="box-none">
        <View style={StyleSheet.absoluteFill} pointerEvents="none">{video}</View>
        <Overlay playing={playing} muted durationMs={durationMs} showSound={false} />
        {!mute && playing ? <SoundButton muted={muted} onPress={toggle} /> : null}
      </View>
    );
  }
  return (
    <Pressable onPress={press} style={{ width, height, backgroundColor: '#000' }} accessibilityRole="button" accessibilityLabel={muted ? 'Ligar o som' : 'Tirar o som'}>
      {video}
      <Overlay playing={playing} muted={muted} durationMs={durationMs} showSound={!mute} />
    </Pressable>
  );
}

function NativeVideo({ src, cover, durationMs, width, height, active, inView, mute, passive, onDouble }: Props) {
  const player = useVideoPlayer(src, (p) => { p.loop = true; p.muted = true; });
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(true);
  const isDouble = useDouble(onDouble);
  useEffect(() => {
    const s = player.addListener('playingChange', ({ isPlaying }) => { setPlaying(isPlaying); if (isPlaying) setStarted(true); });
    return () => s.remove();
  }, [player]);
  // À vista e na foto certa do carrossel: toca (sem som, a menos que o som esteja ligado); senão pára.
  useEffect(() => {
    try {
      if (active && inView) {
        player.muted = !(soundOn && !mute);
        setMuted(player.muted);
        player.play();
      } else player.pause();
    } catch { /* leitor libertado */ }
  }, [active, inView, mute, player]);
  useEffect(() => () => { try { player.pause(); } catch { /* já libertado */ } }, [player]);

  function press() {
    try {
      if (isDouble()) return;
      if (!player.playing) { player.play(); return; }
      if (mute) return;
      player.muted = !player.muted;
      soundOn = !player.muted;
      setMuted(player.muted);
    } catch { /* leitor libertado */ }
  }

  const body = (
    <>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} pointerEvents="none" />
      {cover && !started ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" pointerEvents="none" /> : null}
    </>
  );
  if (passive) {
    const toggle = () => {
      try {
        if (mute) return;
        player.muted = !player.muted;
        soundOn = !player.muted;
        setMuted(player.muted);
      } catch { /* leitor libertado */ }
    };
    return (
      <View style={{ width, height, backgroundColor: '#000' }} pointerEvents="box-none">
        <View style={StyleSheet.absoluteFill} pointerEvents="none">{body}</View>
        <Overlay playing={playing} muted durationMs={durationMs} showSound={false} />
        {!mute && playing ? <SoundButton muted={muted} onPress={toggle} /> : null}
      </View>
    );
  }
  return (
    <Pressable onPress={press} style={{ width, height, backgroundColor: '#000' }} accessibilityRole="button" accessibilityLabel={muted ? 'Ligar o som' : 'Tirar o som'}>
      {body}
      <Overlay playing={playing} muted={muted} durationMs={durationMs} showSound={!mute} />
    </Pressable>
  );
}

/** Ver um vídeo escolhido (antes de publicar) em ecrã inteiro, com som e controlos. */
export function VideoPreview({ uri, onClose }: { uri: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }}>
        {Platform.OS === 'web'
          ? createElement('video', { src: uri, controls: true, autoPlay: true, playsInline: true, style: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' } })
          : <NativePreview uri={uri} />}
        <Pressable onPress={onClose} style={[st.close, { top: Math.max(insets.top, 12) + 4 }]} accessibilityRole="button" accessibilityLabel="Fechar">
          <Icon name="x" size={22} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}
function NativePreview({ uri }: { uri: string }) {
  const p = useVideoPlayer(uri, (x) => { x.loop = true; x.play(); });
  return <VideoView player={p} style={{ width: '100%', height: '100%' }} nativeControls contentFit="contain" surfaceType="textureView" />;
}

const st = StyleSheet.create({
  soundBtn: { position: 'absolute', right: 10, bottom: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  sound: { position: 'absolute', right: 10, bottom: 10, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', right: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  playWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  play: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
