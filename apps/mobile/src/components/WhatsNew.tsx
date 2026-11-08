import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import { useIsNew } from '@/lib/whatsNew';

/**
 * Uma função nova mostra só isto: um pequeno "NOVA" no canto do botão dela (nada de cartões de novidades no Início).
 * Some quando a pessoa a descobre (`markSeen`).
 */
export function NewBadge({ id }: { id: string }) {
  const isNew = useIsNew(id);
  if (!isNew) return null;
  return (
    <View pointerEvents="none" accessibilityLabel="Nova" style={st.badge}>
      <LinearGradient colors={['#d6334f', '#ff9a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      <Text style={st.badgeText}>NOVA</Text>
    </View>
  );
}

const st = StyleSheet.create({
  badge: { height: 18, borderRadius: 9, paddingHorizontal: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', boxShadow: '0 2px 6px rgba(214,51,79,0.5)' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.5, lineHeight: 12 },
});
