import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { feedApi } from '@/lib/api.feed';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';

/**
 * "Interessado / Não interessado": ensina o algoritmo (só aparece em publicações de quem não segues).
 * Não interessado esconde-a e mostra menos disto; Interessado mostra mais.
 */
export function TeachBar({ postId, onNo }: { postId: string; onNo?: () => void }) {
  const [done, setDone] = useState<null | 'yes' | 'no'>(null);
  const [busy, setBusy] = useState(false);
  async function pick(v: 1 | -1) {
    if (busy) return;
    setBusy(true);
    try {
      await feedApi.setInterest(postId, v);
      setDone(v > 0 ? 'yes' : 'no');
      if (v < 0) setTimeout(() => onNo?.(), 450);
    } catch {
      /* sem rede: não conta */
    }
    setBusy(false);
  }
  if (done) {
    return (
      <View style={[st.btn, { marginTop: 4, marginBottom: 12, flex: 0, height: 44 }]} accessibilityRole="alert">
        <Text style={st.text}>{done === 'yes' ? 'Boa! Vamos mostrar mais disto.' : 'Ok, vamos mostrar menos disto.'}</Text>
      </View>
    );
  }
  return (
    <View style={{ marginTop: 4, marginBottom: 12, flexDirection: 'row', gap: 8 }}>
      <Pressable onPress={() => void pick(-1)} style={({ pressed }) => [st.btn, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button">
        <Icon name="x" size={16} strokeWidth={2.6} color={colors.zinc800} />
        <Text style={st.text}>Não interessado</Text>
      </Pressable>
      <Pressable onPress={() => void pick(1)} style={({ pressed }) => [st.btn, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button">
        <Icon name="check" size={16} strokeWidth={2.6} color={colors.zinc800} />
        <Text style={st.text}>Interessado</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  btn: { flex: 1, height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, backgroundColor: colors.zinc100 },
  text: { fontSize: 14, fontWeight: '600', color: colors.zinc800 },
});
