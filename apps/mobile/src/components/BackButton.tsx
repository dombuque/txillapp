import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Platform, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/lib/theme';

/**
 * Botão de voltar da app. No iPhone é o chevron fino (‹), como no sistema; no Android e na web é a seta.
 * Área de toque de 48, ondulação ao tocar (Android), vibração leve e acessível. O gesto de deslizar do bordo continua a funcionar.
 */
export function BackButton({ onPress, fallback = '/', color = colors.zinc900, style }: { onPress?: () => void; fallback?: string; color?: string; style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const go = () => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (onPress) return onPress();
    if (router.canGoBack()) router.back();
    else router.replace(fallback as never);
  };
  const ios = Platform.OS === 'ios';
  return (
    <Pressable
      onPress={go}
      hitSlop={6}
      android_ripple={{ color: 'rgba(0,0,0,0.12)', borderless: true, radius: 26 }}
      style={({ pressed }) => [{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }, pressed && Platform.OS !== 'android' && { backgroundColor: colors.zinc100, transform: [{ scale: 0.94 }] }, style]}
      accessibilityRole="button"
      accessibilityLabel="Voltar"
    >
      <Svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
        {ios ? <Path d="M15 5 8 12l7 7" strokeWidth={2.4} /> : <Path d="M19.5 12h-15M10.5 18 4.5 12l6-6" strokeWidth={2.2} />}
      </Svg>
    </Pressable>
  );
}
