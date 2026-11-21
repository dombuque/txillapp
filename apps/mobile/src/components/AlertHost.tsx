import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Modal } from '@/components/Modal';
import { closeAlert, useAlertRequest } from '@/lib/alertHost';
import { useOverlay } from '@/lib/overlays';
import { colors, typo } from '@/lib/theme';
import { Button } from './ui/Button';
import { alertInRow } from '@/lib/alertLayout';

/**
 * Caixa de confirmação (apagar, sair, bloquear…): título, texto e botões; o cancelar fecha sem fazer nada.
 * É a mesma no APK e no site (lib/alertHost liga o `Alert.alert` a ela; lib/confirm usa-a para perguntas de sim/não).
 */
export function AlertHost() {
  const r = useAlertRequest();
  useOverlay(!!r);
  if (!r) return null;
  const cancel = r.buttons.find((b) => b.style === 'cancel');
  // Lado a lado só com dois botões de texto curto («Cancelar» e «Apagar»); com textos compridos («Continuar a editar»)
  // ficam um por cima do outro, a toda a largura: a ação em cima, o cancelar em baixo (como no iPhone e no Instagram).
  const row = alertInRow(r.buttons.map((b) => b.text ?? 'OK'));
  const buttons = row ? r.buttons : [...r.buttons.filter((b) => b.style !== 'cancel'), ...r.buttons.filter((b) => b.style === 'cancel')];
  return (
    <Modal transparent animationType="fade" onRequestClose={() => closeAlert(cancel)} statusBarTranslucent>
      <Pressable style={st.back} onPress={() => closeAlert(cancel)} accessibilityRole="none">
        <Pressable style={st.card} onPress={() => undefined} accessibilityRole="alert">
          <Text style={st.title} accessibilityRole="header">{r.title}</Text>
          {r.message ? <Text style={st.msg}>{r.message}</Text> : null}
          <View style={[st.btns, row && { flexDirection: 'row' }]}>
            {buttons.map((b, i) => (
              <Button
                key={i}
                label={b.text ?? 'OK'}
                onPress={() => closeAlert(b)}
                kind={b.style === 'destructive' ? 'dangerSolid' : b.style === 'cancel' ? 'secondary' : 'primary'}
                size="lg"
                style={row ? { flex: 1, paddingHorizontal: 12 } : undefined}
              />
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
  title: { ...typo.sheetTitle, color: colors.zinc900, textAlign: 'center' },
  msg: { marginTop: 8, fontSize: 15, lineHeight: 21, color: colors.zinc600, textAlign: 'center' },
  btns: { marginTop: 20, gap: 8 },
});
