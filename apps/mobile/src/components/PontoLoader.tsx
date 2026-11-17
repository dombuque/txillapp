import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/lib/theme';
import { Wordmark } from './Wordmark';

/**
 * O carregamento do Txillapp: o ponto do "i" do logótipo a saltar como uma bola (com sombra no chão).
 * Mesmo gesto em todo o lado, só muda o tamanho. `size` é o diâmetro do ponto em px.
 */
export function PontoLoader({ size = 18, color = colors.brand, style }: { size?: number; color?: string; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 950, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [t]);
  const input = [0, 0.38, 0.62, 0.78, 1];
  const translateY = t.interpolate({ inputRange: input, outputRange: [0, -1.15 * size, -0.12 * size, 0, 0] });
  const scaleX = t.interpolate({ inputRange: input, outputRange: [1.18, 0.9, 1, 1.1, 1.18] });
  const scaleY = t.interpolate({ inputRange: input, outputRange: [0.82, 1.12, 1, 0.9, 0.82] });
  const shadowX = t.interpolate({ inputRange: input, outputRange: [1, 0.45, 0.9, 1, 1] });
  const shadowO = t.interpolate({ inputRange: input, outputRange: [0.22, 0.08, 0.18, 0.22, 0.22] });
  return (
    <View style={[{ width: size * 1.6, height: size * 2.4, alignItems: 'center', justifyContent: 'flex-end' }, style]} accessibilityRole="progressbar" accessibilityLabel="A carregar">
      <Animated.View style={{ position: 'absolute', bottom: 0, width: size, height: size * 0.26, borderRadius: size, backgroundColor: '#000', opacity: shadowO, transform: [{ scaleX: shadowX }] }} />
      <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, marginBottom: size * 0.12, transform: [{ translateY }, { scaleX }, { scaleY }] }} />
    </View>
  );
}

/**
 * Substitui o ActivityIndicator do sistema (a roda) em toda a app pelo ponto do Txillapp.
 * Mesma forma de usar: `size` "small" | "large" (ou um número) e `color`.
 */
export function ActivityIndicator({ size = 'small', color, style }: { size?: 'small' | 'large' | number; color?: string; style?: StyleProp<ViewStyle> }) {
  const dot = typeof size === 'number' ? Math.max(8, size * 0.5) : size === 'large' ? 18 : 11;
  return <PontoLoader size={dot} color={color ?? colors.brand} style={style} />;
}

/** Ecrã inteiro: o logótipo com o ponto do "i" a saltar. */
export function BrandLoader({ message }: { message?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, backgroundColor: '#fff' }} accessibilityRole="progressbar">
      <Wordmark height={56} loading />
      <Text style={{ fontSize: 16, color: colors.zinc500 }}>{message ?? 'A carregar a vibe…'}</Text>
    </View>
  );
}

/** A carregar um ecrã ou um bloco: o ponto de 18 ao centro, com 48 de margem em cima (o mesmo em toda a app). */
export function PageLoader({ dark = false, style }: { dark?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ alignItems: 'center', paddingTop: 48, paddingBottom: 24 }, style]}>
      <PontoLoader size={18} color={dark ? '#ffffff' : colors.brand} />
    </View>
  );
}

/**
 * Esqueleto das listas principais enquanto carregam: `rows` linhas com um avatar redondo e dois traços.
 * `avatar` o diâmetro (44 por omissão; 0 tira o avatar).
 */
export function ListSkeleton({ rows = 6, avatar = 44, dark = false, style }: { rows?: number; avatar?: number; dark?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(t, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [t]);
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] });
  const fill = dark ? 'rgba(255,255,255,0.1)' : colors.zinc100;
  return (
    <Animated.View style={[{ paddingHorizontal: 16, paddingTop: 8, opacity }, style]} accessibilityRole="progressbar" accessibilityLabel="A carregar">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
          {avatar ? <View style={{ width: avatar, height: avatar, borderRadius: avatar / 2, backgroundColor: fill }} /> : null}
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ height: 12, borderRadius: 6, width: `${55 + ((i * 17) % 30)}%`, backgroundColor: fill }} />
            <View style={{ height: 10, borderRadius: 5, width: `${30 + ((i * 23) % 35)}%`, backgroundColor: fill }} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}
