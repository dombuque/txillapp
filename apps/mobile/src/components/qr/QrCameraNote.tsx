import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { colors } from '@/lib/theme';

/** O que o visor mostra quando a câmara não está a dar imagem: o porquê e, se houver, o botão para resolver. */
export function QrCameraNote({ title, sub, steps, action, onAction, busy = false }: { title: string; sub?: string; steps?: string[]; action?: string; onAction?: () => void; busy?: boolean }) {
  return (
    <View style={st.wrap} accessibilityLiveRegion="polite">
      {busy ? <ActivityIndicator color="#fff" /> : <Icon name="camera" size={34} color="rgba(255,255,255,0.85)" />}
      <Text style={st.title}>{title}</Text>
      {sub ? <Text style={st.sub}>{sub}</Text> : null}
      {steps?.length ? (
        <View style={{ marginTop: 8, gap: 4, alignSelf: 'stretch' }}>
          {steps.map((s, i) => <Text key={i} style={st.step}>{`${i + 1}. ${s}`}</Text>)}
        </View>
      ) : null}
      {action && onAction ? (
        <Pressable onPress={onAction} style={({ pressed }) => [st.btn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
          <Text style={st.btnText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 6, backgroundColor: '#111114' },
  title: { marginTop: 6, color: '#fff', fontSize: 16, lineHeight: 22, fontWeight: '700', textAlign: 'center' },
  sub: { color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  step: { color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 18 },
  btn: { marginTop: 12, height: 44, paddingHorizontal: 20, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: colors.zinc900, fontSize: 15, fontWeight: '700' },
});
