import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { sized } from '@/lib/config';
import { marqueeMs, type SoundView } from '@/lib/reelView';

const nd = Platform.OS !== 'web';
// As voltas sem fim levam isInteraction: false. Sem isso cada volta conta como «interação» a decorrer e a lista das
// tchekas (que espera pelo fim das interações) deixava de saber qual está em cena ao deslizar: nada mudava de vídeo.
const SHADOW = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;

/**
 * O disco do som, em baixo nas ações do lado: um vinil com a capa do som (ou o avatar de quem fez o som original) que
 * roda enquanto a tcheka toca. O toque abre a página do som.
 */
export function SoundDisc({ sound, spinning, onPress }: { sound: SoundView; spinning: boolean; onPress: () => void }) {
  const turn = useRef(new Animated.Value(0)).current;
  const at = useRef(0);
  useEffect(() => {
    if (!spinning) return;
    // Continua do ângulo onde parou (sem saltar para o início ao retomar).
    const from = at.current;
    turn.setValue(from);
    const spin = Animated.timing(turn, { toValue: from + 1, duration: 5000, easing: Easing.linear, useNativeDriver: nd, isInteraction: false });
    const loop = Animated.loop(spin);
    const id = turn.addListener(({ value }) => { at.current = value % 1; });
    loop.start();
    return () => { loop.stop(); turn.removeListener(id); };
  }, [spinning, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 2], outputRange: ['0deg', '720deg'] });
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.discHit, pressed && { transform: [{ scale: 0.9 }] }]} accessibilityRole="link" accessibilityLabel={`Som: ${sound.label}`}>
      <Animated.View style={[st.disc, { transform: [{ rotate }] }]}>
        <View style={st.grooves} pointerEvents="none" />
        <View style={st.cover}>
          {sound.cover ? (
            <Image source={{ uri: sized(sound.cover, 96) }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          ) : sound.originalBy ? (
            <Avatar name={sound.originalBy} username={sound.originalBy} size={26} />
          ) : (
            <Icon name="music" size={14} color="#fff" />
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
}

/**
 * O letreiro do som em baixo («♪ Som original · @ana» ou «♪ Título · Artista»): corre da direita para a esquerda enquanto
 * a tcheka toca, se não couber. O toque abre a página do som.
 */
export function SoundMarquee({ sound, running, onPress, width }: { sound: SoundView; running: boolean; onPress: () => void; width: number }) {
  const [textW, setTextW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const box = Math.max(80, width);
  const overflow = textW > box - 4;
  const GAP = 36;
  useEffect(() => {
    if (!overflow || !running) return;
    x.setValue(0);
    const loop = Animated.loop(Animated.timing(x, { toValue: -(textW + GAP), duration: marqueeMs(textW + GAP), easing: Easing.linear, useNativeDriver: nd, isInteraction: false }));
    loop.start();
    return () => loop.stop();
  }, [overflow, running, textW, x]);
  const text = (k: string, measure?: boolean) => (
    <Text
      key={k}
      style={st.marqueeText}
      numberOfLines={1}
      onLayout={measure ? (e) => { const w = Math.round(e.nativeEvent.layout.width); if (Math.abs(w - textW) > 1) setTextW(w); } : undefined}
    >
      {sound.label}
    </Text>
  );
  return (
    <Pressable onPress={onPress} style={st.marquee} accessibilityRole="link" accessibilityLabel={`Som: ${sound.label}`}>
      <Icon name="music" size={14} color="#fff" strokeWidth={2.2} />
      <View style={[st.marqueeBox, { width: box }]}>
        <Animated.View style={[st.marqueeRow, { transform: [{ translateX: x }] }]}>
          {text('a', true)}
          {overflow ? <View style={{ width: GAP }} /> : null}
          {overflow ? text('b') : null}
        </Animated.View>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  discHit: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  disc: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#161616', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  grooves: { position: 'absolute', width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  cover: { width: 26, height: 26, borderRadius: 13, overflow: 'hidden', backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' },
  marquee: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 24 },
  marqueeBox: { overflow: 'hidden' },
  // A linha é mais larga do que a caixa (o texto não encolhe): é ela que corre.
  marqueeRow: { flexDirection: 'row', alignSelf: 'flex-start', width: 4000 },
  marqueeText: { color: '#fff', fontSize: 14, fontWeight: '500', flexShrink: 0, ...SHADOW, ...(Platform.OS === 'web' ? ({ whiteSpace: 'nowrap' } as object) : null) },
});
