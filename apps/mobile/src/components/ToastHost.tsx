import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pressToast, useToast } from '@/lib/toast';
import { colors } from '@/lib/theme';
import { useDesktop } from '@/lib/desktop';

/** O aviso curto do fundo do ecrã (lib/toast): o texto e, se houver, o botão («Desfazer»). */
export function ToastHost() {
  const t = useToast();
  const insets = useSafeAreaInsets();
  // No telemóvel fica por cima da barra de baixo; no computador (sem essa barra) mais em baixo.
  const desktop = useDesktop();
  if (!t) return null;
  return (
    <View pointerEvents="box-none" style={[st.wrap, { bottom: insets.bottom + (desktop ? 32 : 88) }]}>
      <View style={[st.toast, !t.action && { paddingRight: 20 }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text style={st.text}>{t.text}</Text>
        {t.action ? (
          <Pressable onPress={() => pressToast(t)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.action.label} style={({ pressed }) => [st.btn, pressed && { opacity: 0.7 }]}>
            <Text style={st.btnText}>{t.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 1000 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 14, maxWidth: 440, borderRadius: 999, backgroundColor: colors.zinc900, paddingLeft: 20, paddingRight: 8, paddingVertical: 8, minHeight: 44, boxShadow: '0 8px 28px rgba(0,0,0,0.25)' },
  text: { flexShrink: 1, fontSize: 14, fontWeight: '500', color: '#fff', paddingVertical: 4 },
  btn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  btnText: { fontSize: 14, fontWeight: '700', color: '#fda4af' },
});
