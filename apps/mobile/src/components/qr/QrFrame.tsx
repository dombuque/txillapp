import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import { colors } from '@/lib/theme';

/**
 * A moldura do leitor: os quatro cantos com o gradiente do Txillapp (do vermelho da marca ao laranja), a respirar
 * devagar, e uma linha que varre o visor. Quando lê (`pulse` muda), a moldura aperta um instante. Com «Reduzir movimento»,
 * fica parada.
 */
export function QrFrame({ size, pulse, reduce }: { size: number; pulse: number; reduce: boolean }) {
  const breathe = useState(() => new Animated.Value(0))[0];
  const sweep = useState(() => new Animated.Value(0))[0];
  const snap = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    if (reduce) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    const b = Animated.loop(Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sweep, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [reduce, breathe, sweep]);

  useEffect(() => {
    if (!pulse) return;
    snap.setValue(0);
    Animated.sequence([
      Animated.timing(snap, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(snap, { toValue: 0, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [pulse, snap]);

  const scale = Animated.add(
    breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }),
    snap.interpolate({ inputRange: [0, 1], outputRange: [0, -0.08] }),
  );
  const inset = Math.round(size * 0.12);
  const box = size - inset * 2;
  const arm = Math.round(box * 0.22);
  const r = Math.round(box * 0.09);
  const w = 5;
  const e = w / 2;
  const s = box - e;
  // Os cantos: um L arredondado em cada um (desenhados num SVG do tamanho da moldura).
  const d = [
    `M${e} ${arm}V${r + e}a${r} ${r} 0 0 1 ${r} -${r}H${arm}`,
    `M${box - arm} ${e}H${s - r}a${r} ${r} 0 0 1 ${r} ${r}V${arm}`,
    `M${s} ${box - arm}V${s - r}a${r} ${r} 0 0 1 -${r} ${r}H${box - arm}`,
    `M${arm} ${s}H${e + r}a${r} ${r} 0 0 1 -${r} -${r}V${box - arm}`,
  ];
  const lineY = sweep.interpolate({ inputRange: [0, 1], outputRange: [box * 0.1, box * 0.9] });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <Animated.View style={{ width: box, height: box, transform: [{ scale }] }}>
        <Svg width={box} height={box} viewBox={`0 0 ${box} ${box}`}>
          <Defs>
            <SvgGradient id="qrFrame" x1="0" y1={String(box)} x2={String(box)} y2="0" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={colors.brand} />
              <Stop offset="1" stopColor={colors.brandWarm} />
            </SvgGradient>
          </Defs>
          {d.map((p, i) => <Path key={i} d={p} stroke="url(#qrFrame)" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
        </Svg>
        {reduce ? null : (
          <Animated.View style={[st.line, { left: box * 0.08, right: box * 0.08, transform: [{ translateY: lineY }] }]}>
            <LinearGradient colors={['rgba(214,51,79,0)', colors.brand, colors.brandWarm, 'rgba(255,154,91,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  line: { position: 'absolute', top: 0, height: 3, borderRadius: 2, opacity: 0.9 },
});
