import type { VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, View } from 'react-native';
import { clamp01, clock, seekRatio, seekTime } from '@/lib/reelView';

/**
 * A barra de progresso fina de baixo (como no TikTok). Ao segurar nela engrossa, mostra o tempo («0:07 / 0:15») e, ao
 * arrastar, avança ou recua; ao largar o vídeo continua dali. Tem o seu próprio estado para não repintar a tcheka.
 * `onScrub` avisa quando se começa e acaba de arrastar (a tcheka esconde a legenda e os botões enquanto isso).
 */
export function SeekBar({ player, bottom, onScrub }: { player: VideoPlayer; bottom: number; onScrub?: (on: boolean) => void }) {
  const w = useRef(new Animated.Value(0)).current;
  const last = useRef(0);
  const width = useRef(0);
  const drag = useRef<{ start: number; ratio: number; wasPlaying: boolean } | null>(null);
  const [scrub, setScrub] = useState<{ ratio: number; duration: number } | null>(null);
  const scrubCb = useRef(onScrub);
  scrubCb.current = onScrub;

  useEffect(() => {
    player.timeUpdateEventInterval = 0.25;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (drag.current) return; // a arrastar: manda o dedo
      const d = player.duration;
      const p = d > 0 ? clamp01(currentTime / d) : 0;
      if (p < last.current) {
        // Voltou ao início (repetição) ou recuou: salta sem animar para trás.
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

  // O PanResponder é criado uma vez: lê o leitor de agora.
  const playerRef = useRef(player);
  playerRef.current = player;
  const pl = () => playerRef.current;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const start = width.current > 0 ? clamp01(e.nativeEvent.locationX / width.current) : last.current;
        let wasPlaying = false;
        try { wasPlaying = pl().playing; pl().pause(); } catch { /* leitor libertado */ }
        drag.current = { start, ratio: start, wasPlaying };
        w.stopAnimation();
        w.setValue(start);
        setScrub({ ratio: start, duration: safeDuration(pl()) });
        scrubCb.current?.(true);
      },
      onPanResponderMove: (_e, g) => {
        const d = drag.current;
        if (!d) return;
        d.ratio = seekRatio(d.start, g.dx, width.current);
        w.setValue(d.ratio);
        setScrub({ ratio: d.ratio, duration: safeDuration(pl()) });
        try { pl().currentTime = seekTime(d.ratio, pl().duration); } catch { /* ainda a carregar */ }
      },
      onPanResponderRelease: () => finish(),
      onPanResponderTerminate: () => finish(),
    }),
  ).current;

  function finish() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    last.current = d.ratio;
    try {
      pl().currentTime = seekTime(d.ratio, pl().duration);
      if (d.wasPlaying) pl().play();
    } catch { /* leitor libertado */ }
    setScrub(null);
    scrubCb.current?.(false);
  }

  const fill = w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <>
      {scrub && (
        <View style={[st.timeWrap, { bottom: bottom + 36 }]} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={st.time}>
            <Text style={{ color: '#fff' }}>{clock(scrub.ratio * scrub.duration)}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)' }}>{`  /  ${clock(scrub.duration)}`}</Text>
          </Text>
        </View>
      )}
      <View
        {...pan.panHandlers}
        onLayout={(e) => { width.current = e.nativeEvent.layout.width; }}
        style={[st.hit, { bottom: Math.max(0, bottom - 12) }]}
        accessibilityRole="adjustable"
        accessibilityLabel="Progresso da tcheka (arrasta para avançar ou recuar)"
      >
        <View pointerEvents="none" style={[st.track, { marginBottom: Math.min(12, bottom), height: scrub ? 6 : 3, borderRadius: scrub ? 3 : 0 }]}>
          <Animated.View style={{ height: '100%', backgroundColor: '#fff', width: fill }} />
        </View>
        {scrub && (
          <Animated.View pointerEvents="none" style={[st.knob, { bottom: Math.min(12, bottom) - 5, left: fill }]} />
        )}
      </View>
    </>
  );
}

function safeDuration(player: VideoPlayer) {
  try { return player.duration > 0 ? player.duration : 0; } catch { return 0; }
}

const st = StyleSheet.create({
  // A zona de toque é mais alta do que a barra (3 px): fácil de apanhar com o dedo.
  hit: { position: 'absolute', left: 0, right: 0, height: 32, justifyContent: 'flex-end', zIndex: 12 },
  track: { overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.25)' },
  knob: { position: 'absolute', width: 16, height: 16, borderRadius: 8, marginLeft: -8, backgroundColor: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' },
  timeWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 12 },
  time: { fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
});
