import { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

/**
 * A legenda só ganha o cursor sozinha no computador (rato). No iPhone o teclado abria logo por cima da folha e tapava
 * o Cancelar e o Enviar (o Safari não sobe a folha): lá, toca-se na legenda para escrever.
 */
const FOCUS_CAPTION = Platform.OS === 'web' && typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;

/**
 * A imagem colada ou arrastada para a caixa de mensagem (site), antes de ir: a pré-visualização com "Cancelar" e
 * "Enviar", e uma legenda (começa com o que já estava escrito na caixa). Nada se envia sem o toque em Enviar. Vai pelo
 * mesmo caminho da galeria (com a legenda e,
 * nas conversas a dois, com "Ver uma vez" se estiver ligado).
 */
export function PastedImageSheet({ uri, caption, once, onCancel, onSend }: {
  uri: string;
  /** O texto que está escrito na caixa: é o começo da legenda, que se pode mudar aqui. */
  caption?: string;
  once?: boolean;
  onCancel: () => void;
  onSend: (caption: string) => void;
}) {
  const [legend, setLegend] = useState(caption ?? '');
  const send = () => onSend(legend);
  return (
    <Sheet title="Enviar imagem" onClose={onCancel}>
      <View style={st.body}>
        <View style={st.frame}>
          <Image source={{ uri }} resizeMode="contain" style={st.img} accessibilityRole="image" accessibilityLabel="A imagem que colaste" />
        </View>
        <TextInput
          value={legend}
          onChangeText={setLegend}
          placeholder="Adicionar uma legenda…"
          placeholderTextColor={colors.zinc500}
          maxLength={2000}
          multiline
          autoFocus={FOCUS_CAPTION}
          blurOnSubmit
          onSubmitEditing={send}
          style={st.caption}
          accessibilityLabel="Legenda"
        />
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
          <Pressable onPress={send} style={({ pressed }) => [st.btn, st.send, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="Enviar a imagem">
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
  img: { width: '100%', height: 260 },
  caption: { minHeight: 44, maxHeight: 110, borderRadius: 14, backgroundColor: colors.zinc100, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, lineHeight: 20, color: colors.zinc900 },
  once: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  onceText: { fontSize: 13, fontWeight: '600', color: colors.brand },
  row: { flexDirection: 'row', gap: 10, paddingTop: 4 },
  btn: { flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: colors.zinc100 },
  cancelText: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  send: { backgroundColor: colors.brand },
  sendText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
