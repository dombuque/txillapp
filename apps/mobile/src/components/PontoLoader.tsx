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
