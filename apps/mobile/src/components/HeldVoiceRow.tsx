import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { heldVoiceLabel, type HeldVoice } from '@/lib/heldVoice';
import { colors } from '@/lib/theme';

/**
 * Por cima da barra de escrever: as mensagens de voz gravadas sem rede (lib/heldVoice), com o reloginho e «Apagar».
 * Vão sozinhas quando a rede voltar.
 */
export function HeldVoiceRow({ held, trying, onDrop }: { held: readonly HeldVoice[]; trying: boolean; onDrop: () => void }) {
  if (!held.length) return null;
  return (
    <View style={st.row} accessibilityLiveRegion="polite">
      <Icon name="clock" size={14} strokeWidth={2.2} color={colors.zinc500} />
      <Text style={st.text}>{heldVoiceLabel(held.length, trying)}</Text>
      {!trying ? (
        <Pressable onPress={onDrop} hitSlop={10} accessibilityRole="button" accessibilityLabel={held.length > 1 ? 'Apagar as mensagens de voz por enviar' : 'Apagar a mensagem de voz por enviar'}>
          <Text style={st.link}>Apagar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingBottom: 6 },
  text: { flex: 1, fontSize: 13, color: colors.zinc600 },
  link: { fontSize: 13, fontWeight: '600', color: colors.zinc700 },
});
