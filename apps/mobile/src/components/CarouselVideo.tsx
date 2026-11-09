import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createElement, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { abs } from '@/lib/config';
import { Icon } from './Icon';

/**
 * Vídeo dentro de um carrossel (publicação com fotos e vídeos): mostra a capa com o play; tocar põe-no a tocar ali mesmo,
 * com som (o toque é o gesto que o browser exige). Tocar outra vez pausa; dois toques brindam. Pára quando sai do ecrã
 * ou quando se passa para outra foto do carrossel.
 */
export function CarouselVideo({ url, poster, durationMs, width, height, active, onDouble }: {
  url: string; poster?: string; durationMs?: number | null; width: number; height: number; active: boolean; onDouble?: () => void;
}) {
  const src = abs(url) ?? '';
  const cover = abs(poster);
  return Platform.OS === 'web'
    ? <WebVideo src={src} cover={cover} durationMs={durationMs} width={width} height={height} active={active} onDouble={onDouble} />
    : <NativeVideo src={src} cover={cover} durationMs={durationMs} width={width} height={height} active={active} onDouble={onDouble} />;
}

interface Props { src: string; cover?: string; durationMs?: number | null; width: number; height: number; active: boolean; onDouble?: () => void }

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

function Overlay({ playing, durationMs }: { playing: boolean; durationMs?: number | null }) {
  return (
    <>
      {!playing && (
        <View style={st.playWrap} pointerEvents="none">
          <View style={st.play}><Icon name="play" size={28} color="#fff" solid /></View>
        </View>
      )}
      {durationMs ? (
        <View style={st.badge} pointerEvents="none">
          <Icon name="video" size={12} color="#fff" />
          <Text style={st.badgeText}>{secs(durationMs)}</Text>
        </View>
      ) : null}
    </>
  );
}

function WebVideo({ src, cover, durationMs, width, height, active, onDouble }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const isDouble = useDouble(onDouble);

  // Passou para outra foto do carrossel: pára.
  useEffect(() => { if (!active) ref.current?.pause(); }, [active]);
  // Saiu do ecrã (o feed rolou): pára.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => { if (e && e.intersectionRatio < 0.5) el.pause(); }, { threshold: [0, 0.5] });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  function press() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      // Já dentro do toque: o Safari deixa tocar com som.
      v.muted = false;
      void v.play().catch(() => { v.muted = true; void v.play().catch(() => undefined); });
      isDouble();
      return;
    }
    if (isDouble()) return; // segundo toque de um duplo: brinda e continua a tocar
    v.pause();
  }

  return (
    <Pressable onPress={press} style={{ width, height, backgroundColor: '#000' }} accessibilityRole="button" accessibilityLabel={playing ? 'Pausar o vídeo' : 'Tocar o vídeo'}>
      {createElement('video', {
        ref,
        src, poster: cover, playsInline: true, loop: true, preload: 'metadata',
        onPlay: () => setPlaying(true), onPause: () => setPlaying(false),
        style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' },
      })}
      <Overlay playing={playing} durationMs={durationMs} />
    </Pressable>
  );
}

function NativeVideo({ src, cover, durationMs, width, height, active, onDouble }: Props) {
  const player = useVideoPlayer(src, (p) => { p.loop = true; });
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const isDouble = useDouble(onDouble);
  useEffect(() => {
    const s = player.addListener('playingChange', ({ isPlaying }) => { setPlaying(isPlaying); if (isPlaying) setStarted(true); });
    return () => s.remove();
  }, [player]);
  useEffect(() => { if (!active) try { player.pause(); } catch { /* leitor libertado */ } }, [active, player]);
  useEffect(() => () => { try { player.pause(); } catch { /* já libertado */ } }, [player]);

  function press() {
    try {
      if (!player.playing) {
        player.muted = false;
        player.play();
        isDouble();
        return;
      }
      if (isDouble()) return;
      player.pause();
    } catch { /* leitor libertado */ }
  }

  return (
    <Pressable onPress={press} style={{ width, height, backgroundColor: '#000' }} accessibilityRole="button" accessibilityLabel={playing ? 'Pausar o vídeo' : 'Tocar o vídeo'}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} pointerEvents="none" />
      {cover && !started ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" pointerEvents="none" /> : null}
      <Overlay playing={playing} durationMs={durationMs} />
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
  close: { position: 'absolute', right: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  playWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  play: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
