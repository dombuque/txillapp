import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight, Sparkles } from 'lucide-react-native';
import { CORAL_GRADIENT, mg } from './MagicUi';

/**
 * O botão «Montagem mágica» do estúdio (56 px de altura, à largura que o pai der). `hint` explica porque está desligado
 * (por exemplo «Junta pelo menos 2 fotos ou vídeos»).
 */
export function MagicButton({ onPress, disabled, hint }: { onPress: () => void; disabled?: boolean; hint?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID="montagem-magica"
      accessibilityRole="button"
      accessibilityLabel="Montagem mágica"
      accessibilityHint={hint ?? 'Um toque e a tcheka fica feita'}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [st.btn, disabled && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      <LinearGradient colors={CORAL_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={st.icon}><Sparkles size={22} color={mg.coral} strokeWidth={2.6} /></View>
      <View style={{ flex: 1 }}>
        <Text style={st.label} numberOfLines={1}>Montagem mágica</Text>
        <Text style={st.sub} numberOfLines={1}>{hint ?? 'Um toque e a tcheka fica feita'}</Text>
      </View>
      <View><ChevronRight size={22} color="#fff" /></View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  btn: { minHeight: 64, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden', boxShadow: '0 10px 28px rgba(255,92,108,0.42)' },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  label: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: -0.2 },
  sub: { color: 'rgba(255,255,255,0.92)', fontSize: 14, fontWeight: '600', marginTop: 1 },
});
