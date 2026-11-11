import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Icon } from '@/components/Icon';
import { colors } from '@/lib/theme';

/**
 * Editar uma mensagem (como no WhatsApp): no lugar da barra de escrever, a faixa "A editar mensagem" com o texto antigo e
 * um X para cancelar, e a caixa já com o texto. Enviar grava (a conversa mostra logo o texto novo, com "editada").
 * Fica num componente à parte para não mexer no ChatComposer nem no GroupComposer.
 */
export function ChatEditBar({ original, bottom, onCancel, onSave }: {
  original: string;
  bottom: number;
  onCancel: () => void;
  /** Grava o texto novo; se o servidor recusar, lança o erro (que aparece por cima da caixa). */
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(original);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const clean = text.trim();
  const can = !busy && clean.length > 0 && clean !== original.trim();

  async function save() {
    if (!can) return;
    setBusy(true);
    setErr('');
    try {
      await onSave(clean);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <View style={[st.wrap, { paddingBottom: Math.max(bottom, 10) }]}>
      <View style={st.bar}>
        <View style={st.barLine} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.barTitle}>A editar mensagem</Text>
          <Text style={st.barText} numberOfLines={1}>{original}</Text>
        </View>
        <Pressable onPress={onCancel} hitSlop={10} style={st.x} accessibilityRole="button" accessibilityLabel="Cancelar a edição">
          <Icon name="x" size={18} color={colors.zinc600} />
        </Pressable>
      </View>
      {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
      <View style={st.row}>
        <TextInput
          value={text}
          onChangeText={setText}
          autoFocus
          multiline
          maxLength={2000}
          placeholder="Mensagem"
          placeholderTextColor={colors.zinc500}
          style={st.input}
          accessibilityLabel="Texto da mensagem"
        />
        <Pressable onPress={() => void save()} disabled={!can} style={[st.send, !can && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Guardar a edição" accessibilityState={{ disabled: !can }}>
          {busy ? <ActivityIndicator color="#fff" /> : <Icon name="check" size={20} strokeWidth={2.6} color="#fff" />}
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { borderTopWidth: 1, borderTopColor: colors.zinc100, backgroundColor: colors.white, paddingHorizontal: 12, paddingTop: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingBottom: 8 },
  barLine: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.brand },
  barTitle: { fontSize: 13, fontWeight: '700', color: colors.brand },
  barText: { fontSize: 13, color: colors.zinc500 },
  x: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  err: { paddingHorizontal: 4, paddingBottom: 6, fontSize: 13, color: colors.red600 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 22, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 16, lineHeight: 21, color: colors.zinc900 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
