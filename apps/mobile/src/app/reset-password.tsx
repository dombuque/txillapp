import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Wordmark } from '@/components/Wordmark';
import { ApiError } from '@/lib/api';
import { emailApi } from '@/lib/api.email';
import { colors } from '@/lib/theme';
import { Field, Screen } from './login';

/** Abre-se a partir do link do email: escolhe a senha nova. */
export default function ResetPassword() {
  const { token = '' } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function submit() {
    if (pass.length < 10) return setError('A senha precisa de pelo menos 10 caracteres');
    if (pass !== again) return setError('As duas senhas não são iguais');
    setBusy(true);
    setError('');
    try {
      await emailApi.resetPassword(String(token), pass);
      setDone(true);
      timer.current = setTimeout(() => router.replace('/login'), 2500);
    } catch (x) {
      setError(x instanceof ApiError ? x.message : 'Não consegui mudar agora. Tenta outra vez.');
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || !token || !pass;

  return (
    <Screen footer={<Text style={{ textAlign: 'center', fontSize: 16, color: colors.zinc600 }} onPress={() => router.replace('/login')} accessibilityRole="link"><Text style={{ color: colors.brand, fontWeight: '600' }}>Voltar a entrar</Text></Text>}>
      <View style={{ paddingTop: 40 }} accessibilityRole="header"><Wordmark height={44} /></View>
      {done ? (
        <View style={{ marginTop: 40 }}>
          <View style={st.row}><Icon name="check-circle" size={32} color="#16a34a" /><Text style={st.title}>Senha mudada</Text></View>
          <Text style={st.sub}>Já podes entrar com a senha nova. A levar-te ao login…</Text>
        </View>
      ) : (
        <>
          <Text style={[st.title, { marginTop: 28, fontSize: 34, fontWeight: '800', lineHeight: 36 }]}>Escolhe uma{'\n'}senha nova</Text>
          <Text style={[st.sub, { fontWeight: '300' }]}>Mínimo 10 caracteres. Vamos terminar a sessão nos outros aparelhos.</Text>
          <View style={{ marginTop: 28, gap: 12 }}>
            <Field icon="lock" secure value={pass} onChangeText={(t) => { setPass(t); setError(''); }} placeholder="Senha nova" autoComplete="new-password" returnKeyType="next" accessibilityLabel="Senha nova" />
            <Field icon="lock" secure value={again} onChangeText={(t) => { setAgain(t); setError(''); }} placeholder="Repete a senha" autoComplete="new-password" returnKeyType="go" onSubmitEditing={() => void submit()} accessibilityLabel="Repete a senha" />
            <View style={{ minHeight: 32, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="alert"><Text style={{ fontSize: 15, color: colors.red600, textAlign: 'center' }}>{error}</Text></View>
            <Pressable onPress={() => void submit()} disabled={disabled} style={({ pressed }) => [st.ctaWrap, disabled && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
              <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.cta}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.ctaText}>Guardar senha</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 30, fontWeight: '800', lineHeight: 34, color: colors.zinc900, flexShrink: 1 },
  sub: { marginTop: 12, fontSize: 18, lineHeight: 26, color: colors.zinc600 },
  ctaWrap: { borderRadius: 999, boxShadow: '0 10px 24px rgba(214,51,79,0.35)' },
  cta: { borderRadius: 999, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 18, lineHeight: 28, fontWeight: '600' },
});
