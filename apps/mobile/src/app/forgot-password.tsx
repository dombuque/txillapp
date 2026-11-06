import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Field, Screen } from './login';

/** Esqueci a senha: pede o email e manda a ligação para repor (a resposta é a mesma exista a conta ou não). */
export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError('Esse email não parece certo');
    setBusy(true);
    setError('');
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (e) {
      setError((e as Error).message || 'Não consegui enviar. Tenta outra vez');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Pressable onPress={() => router.back()} style={st.back} accessibilityRole="button" accessibilityLabel="Voltar"><Icon name="back" size={30} strokeWidth={2} color={colors.brand} /></Pressable>
      <View style={{ marginTop: 32 }}>
        <Text style={st.title}>{sent ? 'Verifica o teu email' : 'Esqueceste a senha?'}</Text>
        <Text style={st.sub}>{sent ? 'Se esse email tem conta, enviámos uma ligação para criares uma senha nova. Dura pouco tempo.' : 'Diz-nos o teu email e mandamos uma ligação para criares uma senha nova.'}</Text>
        {!sent && (
          <View style={{ marginTop: 28, gap: 12 }}>
            <Field icon="mail" value={email} onChangeText={(t) => { setEmail(t); setError(''); }} placeholder="email@exemplo.com" autoFocus autoCapitalize="none" keyboardType="email-address" autoComplete="email" returnKeyType="go" onSubmitEditing={() => void submit()} accessibilityLabel="Email" />
            <View style={st.alert} accessibilityRole="alert"><Text style={st.alertText}>{error}</Text></View>
            <Pressable onPress={() => void submit()} disabled={busy || !email.trim()} style={({ pressed }) => [st.ctaWrap, (busy || !email.trim()) && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
              <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.cta}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.ctaText}>Enviar ligação</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        )}
        {sent && <Pressable onPress={() => router.replace('/login')} style={[st.ctaWrap, { marginTop: 28 }]}><LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.cta}><Text style={st.ctaText}>Voltar a entrar</Text></LinearGradient></Pressable>}
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  back: { marginLeft: -4, marginTop: 8, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 36, fontWeight: '300', lineHeight: 40, color: colors.zinc900 },
  sub: { marginTop: 12, fontSize: 20, fontWeight: '300', lineHeight: 28, color: colors.zinc600 },
  alert: { minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  alertText: { fontSize: 15, color: colors.red600, textAlign: 'center' },
  ctaWrap: { borderRadius: 999, boxShadow: '0 10px 24px rgba(214,51,79,0.35)' },
  cta: { borderRadius: 999, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 18, lineHeight: 28, fontWeight: '600' },
});
