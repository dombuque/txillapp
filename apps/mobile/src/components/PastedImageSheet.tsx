import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

/**
 * A imagem colada ou arrastada para a caixa de mensagem (site), antes de ir: a pré-visualização com "Cancelar" e
 * "Enviar". Nada se envia sem o toque em Enviar. Vai pelo mesmo caminho da galeria (com o texto escrito como legenda e,
 * nas conversas a dois, com "Ver uma vez" se estiver ligado).
 */
export function PastedImageSheet({ uri, caption, once, onCancel, onSend }: {
  uri: string;
  /** O texto que está escrito na caixa (vai com a imagem). */
  caption?: string;
  once?: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  return (
    <Sheet title="Enviar imagem" onClose={onCancel}>
      <View style={st.body}>
        <View style={st.frame}>
          <Image source={{ uri }} resizeMode="contain" style={st.img} accessibilityRole="image" accessibilityLabel="A imagem que colaste" />
        </View>
        {caption ? <Text style={st.caption} numberOfLines={2}>Com o texto: {caption}</Text> : null}
        {once ? (
          <View style={st.once}>
            <Icon name="once" size={16} color={colors.brand} strokeWidth={2.2} />
            <Text style={st.onceText}>Ver uma vez: só se abre uma vez.</Text>
          </View>
        ) : null}
        <View style={st.row}>
          <Pressable onPress={onCancel} style={({ pressed }) => [st.btn, st.cancel, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Cancelar">
            <Text style={st.cancelText}>Cancelar</Text>
          </Pressable>
          <Pressable onPress={onSend} style={({ pressed }) => [st.btn, st.send, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="Enviar a imagem">
            <Text style={st.sendText}>Enviar</Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 12 },
  frame: { borderRadius: 16, overflow: 'hidden', backgroundColor: colors.zinc100 },
  img: { width: '100%', height: 320 },
  caption: { fontSize: 14, lineHeight: 19, color: colors.zinc700 },
  once: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  onceText: { fontSize: 13, fontWeight: '600', color: colors.brand },
  row: { flexDirection: 'row', gap: 10, paddingTop: 4 },
  btn: { flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: colors.zinc100 },
  cancelText: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  send: { backgroundColor: colors.brand },
  sendText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
