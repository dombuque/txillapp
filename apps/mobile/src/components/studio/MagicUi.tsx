import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * As cores e as medidas da «Montagem mágica» e da «Capulana»: escuro, vidro e o coral do Txillapp. Nada com menos de 14 px
 * de letra nem menos de 44 px de alvo de toque (os botões principais têm 56).
 */
export const mg = {
  bg: '#08080c',
  panel: '#12121a',
  glass: 'rgba(255,255,255,0.07)',
  glassHi: 'rgba(255,255,255,0.12)',
  line: 'rgba(255,255,255,0.12)',
  coral: '#d6334f',
  coralHot: '#ff5c6c',
  coralSoft: 'rgba(255,92,108,0.16)',
  gold: '#ffc247',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.72)',
  faint: 'rgba(255,255,255,0.5)',
  glow: '0 0 0 2px #ff5c6c, 0 10px 34px rgba(255,92,108,0.45)',
  shadow: '0 14px 40px rgba(0,0,0,0.55)',
  radius: 22,
  /** O alvo de toque mínimo. */
  hit: 44,
} as const;
export const CORAL_GRADIENT = ['#ff7a6b', '#ff5c6c', '#d6334f'] as const;

/** O botão principal (coral, 56 px) e o secundário (vidro). */
export function MagicCta({ label, onPress, icon, kind = 'primary', disabled, style, a11y, testID }: { label: string; onPress: () => void; icon?: ReactNode; kind?: 'primary' | 'glass'; disabled?: boolean; style?: StyleProp<ViewStyle>; a11y?: string; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [ui.cta, kind === 'glass' && ui.ctaGlass, kind === 'primary' && ui.ctaShadow, disabled && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.97 }] }, style]}
    >
      {kind === 'primary' ? <LinearGradient colors={CORAL_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
      {icon ? <View>{icon}</View> : null}
      <Text style={ui.ctaText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Um botão redondo de 44 px (fechar, voltar, tocar). */
export function MagicRound({ onPress, a11y, children, size = 44, on, style }: { onPress: () => void; a11y: string; children: ReactNode; size?: number; on?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} hitSlop={6} style={({ pressed }) => [ui.round, { width: size, height: size, borderRadius: size / 2 }, on && ui.roundOn, pressed && { transform: [{ scale: 0.93 }] }, style]}>
      {children}
    </Pressable>
  );
}

/** Uma etiqueta pequena (a onda, o andamento, a duração). */
export function MagicTag({ label, icon, hot }: { label: string; icon?: ReactNode; hot?: boolean }) {
  return (
    <View style={[ui.tag, hot && ui.tagHot]}>
      {icon}
      <Text style={ui.tagText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** O fundo dos ecrãs: preto com uma luz coral em cima. */
export function MagicBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: mg.bg }]} />
      <LinearGradient colors={['rgba(255,92,108,0.26)', 'rgba(214,51,79,0.08)', 'rgba(8,8,12,0)']} locations={[0, 0.45, 1]} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 380 }} />
    </View>
  );
}

const ui = StyleSheet.create({
  cta: { height: 56, borderRadius: 28, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, overflow: 'hidden' },
  ctaShadow: { boxShadow: '0 10px 28px rgba(255,92,108,0.42)' },
  ctaGlass: { backgroundColor: mg.glassHi, borderWidth: 1, borderColor: mg.line },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  round: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: mg.line },
  roundOn: { backgroundColor: mg.coral, borderColor: mg.coralHot },
  tag: { height: 32, borderRadius: 16, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: mg.glass, borderWidth: 1, borderColor: mg.line },
  tagHot: { backgroundColor: mg.coralSoft, borderColor: 'rgba(255,92,108,0.55)' },
  tagText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
