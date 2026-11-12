import type { AudioPlayer } from 'expo-audio';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { listenLevel } from '@/lib/audioLevel';
import { breath, glowOf, wavePath } from '@/lib/musicLook';
import { useReduceMotion } from '@/lib/reduceMotion';
import { claimWaves, releaseWaves, runningWaves, subscribeWaves } from '@/lib/wavesRunner';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** As três fitas: quantas ondas cabem na largura, a velocidade (rad/s), o desvio de fase e quanto da amplitude levam. */
const WAVES = [
  { cycles: 1.4, speed: 1.6, shift: 0, k: 1, width: 2.2, alpha: 0.24 },
  { cycles: 2.1, speed: -1.1, shift: 2.1, k: 0.7, width: 1.6, alpha: 0.19 },
  { cycles: 0.9, speed: 0.8, shift: 4.2, k: 0.5, width: 1.2, alpha: 0.15 },
] as const;

export interface SoundWavesProps {
  /** Há som a sair agora (a tocar, com som e à vista). Ao passar a falso, as ondas apagam-se com um fade. */
  active: boolean;
  /** O nível do som (0 a 1; negativo = sem análise), se quem toca já o mede. Sem ele, mede-se o `player` na web ou respira. */
  level?: SharedValue<number>;
  /** As cores do brilho (as da capa); sem elas, o coral da marca. */
  colors?: readonly [string, string] | null;
  /** O leitor de áudio (expo-audio), para seguir o som na web quando o áudio deixa (ver lib/audioLevel). */
  player?: AudioPlayer | null;
  /** A altura da faixa das ondas (fração do espaço, a meio). */
  band?: number;
  /** A cor das fitas: branco por cima de fotos e vídeos; noutra cor por cima de fundos claros (notas, seletor). */
  tint?: string;
  /** Versão discreta (bolhas de voz, linhas do seletor): fitas mais finas e sem o brilho largo. */
  subtle?: boolean;
}

/**
 * Ondas de som transparentes que atravessam o meio do que está a tocar: fotos e vídeos com som (publicações, mimos, tchekas,
 * visor de fotos), a música das notas, a faixa a tocar no seletor e as notas de voz do chat.
 * - Um só SVG com três fitas (e um brilho leve das cores), desenhadas no fio da interface.
 * - A amplitude segue o som quando dá (`level`, ou o `player` na web com o AnalyserNode); senão, «respira» com um ritmo plausível.
 * - Não apanham toques; entram e saem com um fade; não aparecem com «reduzir movimento».
 * - Só um conjunto corre de cada vez (o do som que começou por último); os outros esperam apagados e sem desenhar.
 * Quem as usa põe-nas logo a seguir à imagem, para ficarem por baixo dos controlos e dos stickers.
 */
export function SoundWaves({ active, level: external, colors, player, band = 0.42, tint = '#ffffff', subtle = false }: SoundWavesProps) {
  const reduce = useReduceMotion();
  const me = useRef(Symbol('waves')).current;
  const wants = active && !reduce;
  useEffect(() => {
    if (!wants) return;
    claimWaves(me);
    return () => releaseWaves(me);
  }, [wants, me]);
  const front = useSyncExternalStore(subscribeWaves, () => runningWaves() === me, () => false);
  const on = wants && front;

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [mounted, setMounted] = useState(on);
  const id = `sw${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const glow = glowOf(colors?.[0]);

  const t = useSharedValue(0);
  const amp = useSharedValue(0.4);
  const level = useSharedValue(-1);
  const stamp = useSharedValue(-10);
  const fade = useSharedValue(0);

  const frame = useFrameCallback((f) => {
    t.value = f.timeSinceFirstFrame / 1000;
    const fresh = level.value >= 0 && t.value - stamp.value < 0.5;
    const target = fresh ? 0.22 + 0.78 * level.value : breath(t.value);
    amp.value += (target - amp.value) * 0.12;
  }, false);

  useEffect(() => {
    if (on) setMounted(true);
    fade.value = withTiming(on ? 1 : 0, { duration: on ? 420 : 320 });
    if (on) { frame.setActive(true); return; }
    // Deixa acabar o fade antes de parar de desenhar (e de largar o SVG).
    const stop = setTimeout(() => { frame.setActive(false); setMounted(false); }, 360);
    return () => clearTimeout(stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  // O nível que vem de fora (quem toca já o mede).
  useAnimatedReaction(() => external?.value ?? -1, (v) => {
    if (v >= 0) { level.value = v; stamp.value = t.value; }
  }, [external]);

  // Na web, o nível do próprio leitor (quando o áudio deixa).
  useEffect(() => {
    if (!on || !player || external) return;
    return listenLevel(player, (v) => { level.value = v; stamp.value = t.value; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, player, external]);

  const H = Math.max(subtle ? 16 : 40, box.h * band);
  const W = box.w;
  const room = H / 2 - (subtle ? 2 : 4);
  const pg = useAnimatedProps(() => ({ d: wavePath(W, H, t.value * WAVES[0].speed + WAVES[0].shift, room * amp.value * WAVES[0].k, WAVES[0].cycles) }));
  const p0 = useAnimatedProps(() => ({ d: wavePath(W, H, t.value * WAVES[0].speed + WAVES[0].shift, room * amp.value * WAVES[0].k, WAVES[0].cycles) }));
  const p1 = useAnimatedProps(() => ({ d: wavePath(W, H, t.value * WAVES[1].speed + WAVES[1].shift, room * amp.value * WAVES[1].k, WAVES[1].cycles) }));
  const p2 = useAnimatedProps(() => ({ d: wavePath(W, H, t.value * WAVES[2].speed + WAVES[2].shift, room * amp.value * WAVES[2].k, WAVES[2].cycles) }));
  const style = useAnimatedStyle(() => ({ opacity: fade.value }));
  const thin = subtle ? 0.6 : 1;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (Math.abs(width - box.w) > 1 || Math.abs(height - box.h) > 1) setBox({ w: width, h: height }); }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {mounted && W > 0 ? (
        <Animated.View style={[s.band, { top: (box.h - H) / 2, height: H }, style, Platform.OS === 'web' && !subtle && ({ filter: `drop-shadow(0 0 6px ${glow}88)` } as object)]}>
          <Svg width={W} height={H}>
            <Defs>
              <LinearGradient id={`${id}w`} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={tint} stopOpacity="0" />
                <Stop offset="0.18" stopColor={tint} stopOpacity="1" />
                <Stop offset="0.82" stopColor={tint} stopOpacity="1" />
                <Stop offset="1" stopColor={tint} stopOpacity="0" />
              </LinearGradient>
              <LinearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={glow} stopOpacity="0" />
                <Stop offset="0.5" stopColor={glow} stopOpacity="1" />
                <Stop offset="1" stopColor={colors?.[1] ? glowOf(colors[1]) : glow} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            {/* O brilho da cor da capa, largo e muito leve, por baixo da fita principal. */}
            {!subtle ? <AnimatedPath animatedProps={pg} stroke={`url(#${id}g)`} strokeWidth={9} strokeOpacity={0.16} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
            <AnimatedPath animatedProps={p0} stroke={`url(#${id}w)`} strokeWidth={WAVES[0].width * thin} strokeOpacity={WAVES[0].alpha} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <AnimatedPath animatedProps={p1} stroke={`url(#${id}w)`} strokeWidth={WAVES[1].width * thin} strokeOpacity={WAVES[1].alpha} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <AnimatedPath animatedProps={p2} stroke={`url(#${id}w)`} strokeWidth={WAVES[2].width * thin} strokeOpacity={WAVES[2].alpha} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  band: { position: 'absolute', left: 0, right: 0 },
});
