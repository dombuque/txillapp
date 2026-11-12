import * as Clipboard from 'expo-clipboard';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Sheet } from '@/components/Sheet';
import { colors } from '@/lib/theme';

/**
 * Tocar num número de telefone numa mensagem (lib/chatLinks, `phone`): ligar, mandar SMS, abrir no WhatsApp ou copiar.
 * Nada é enviado ao Txillapp: abre a app do telefone, das mensagens ou o WhatsApp do aparelho.
 */
export function PhoneSheet({ shown, tel, onClose }: { /** Como foi escrito na mensagem. */ shown: string; /** Pronto a marcar. */ tel: string; onClose: () => void }) {
  const go = (url: string) => {
    onClose();
    void Linking.openURL(url).catch(() => undefined);
  };
  const items: { label: string; run: () => void }[] = [
    { label: 'Ligar', run: () => go(`tel:${tel}`) },
    { label: 'Enviar SMS', run: () => go(`sms:${tel}`) },
    ...(tel.startsWith('+') ? [{ label: 'Abrir no WhatsApp', run: () => go(`https://wa.me/${tel.slice(1)}`) }] : []),
    { label: 'Copiar número', run: () => { onClose(); void Clipboard.setStringAsync(tel).catch(() => undefined); } },
  ];
  return (
    <Sheet onClose={onClose}>
      <View style={st.wrap}>
        <Text style={st.num} accessibilityRole="header" selectable>{tel.startsWith('+') ? tel : shown}</Text>
        {items.map((it) => (
          <Pressable key={it.label} onPress={it.run} style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={`${it.label} ${tel}`}>
            <Text style={st.label}>{it.label}</Text>
          </Pressable>
        ))}
        <Pressable onPress={onClose} style={({ pressed }) => [st.cancel, pressed && { backgroundColor: colors.zinc200 }]} accessibilityRole="button" accessibilityLabel="Cancelar">
          <Text style={st.cancelText}>Cancelar</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingBottom: 12, gap: 2 },
  num: { fontSize: 20, fontWeight: '800', color: colors.zinc900, textAlign: 'center', paddingVertical: 12 },
  row: { minHeight: 52, borderRadius: 14, paddingHorizontal: 16, justifyContent: 'center' },
  label: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  cancel: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.zinc100, marginTop: 8 },
  cancelText: { fontSize: 16, fontWeight: '700', color: colors.zinc800 },
});
