import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Modal } from '@/components/Modal';
import { closeAlert, useAlertRequest } from '@/lib/alertHost';
import { useOverlay } from '@/lib/overlays';
import { colors } from '@/lib/theme';

/** Caixa de confirmação (apagar, sair, bloquear…): título, texto e botões; o cancelar fecha sem fazer nada. */
export function AlertHost() {
  const r = useAlertRequest();
  useOverlay(!!r);
  if (!r) return null;
  const cancel = r.buttons.find((b) => b.style === 'cancel');
  const row = r.buttons.length === 2;
  return (
    <Modal transparent animationType="fade" onRequestClose={() => closeAlert(cancel)} statusBarTranslucent>
      <Pressable style={st.back} onPress={() => closeAlert(cancel)} accessibilityRole="none">
        <Pressable style={st.card} onPress={() => undefined} accessibilityRole="alert">
          <Text style={st.title}>{r.title}</Text>
          {r.message ? <Text style={st.msg}>{r.message}</Text> : null}
          <View style={[st.btns, row && { flexDirection: 'row' }]}>
            {r.buttons.map((b, i) => (
              <Pressable key={i} onPress={() => closeAlert(b)} style={({ pressed }) => [st.btn, row && { flex: 1 }, b.style === 'destructive' && { backgroundColor: '#b91c1c' }, b.style !== 'destructive' && b.style !== 'cancel' && { backgroundColor: colors.brand }, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                <Text style={[st.btnText, b.style === 'cancel' && { color: colors.zinc800 }]}>{b.text ?? 'OK'}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const st = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 340, borderRadius: 24, backgroundColor: '#fff', padding: 22, boxShadow: '0 12px 40px rgba(0,0,0,0.3)' },
  title: { fontSize: 19, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  msg: { marginTop: 8, fontSize: 15, lineHeight: 21, color: colors.zinc600, textAlign: 'center' },
  btns: { marginTop: 20, gap: 8 },
  btn: { height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.zinc100, paddingHorizontal: 12 },
  btnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
