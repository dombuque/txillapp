import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Icon } from '@/components/Icon';
import { useHumanCheck } from '@/components/HumanCheck';
import { Wordmark } from '@/components/Wordmark';
import { ApiError, api } from '@/lib/api';
import { needsHumanCheck, securityErrorText } from '@/lib/humanCheck';
import { colors } from '@/lib/theme';
import { Field, Screen } from './login';

/** Esqueci a senha: pede o e-mail e responde sempre o mesmo, exista a conta ou não (igual ao site). */
export default function ForgotPassword() {
  const router = useRouter();
  const wide = useWindowDimensions().width >= 1024;
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const human = useHumanCheck();

  async function submit() {
    if (busy) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Esse e-mail não parece certo');
    setBusy(true);
    setError('');
    try {
      // Prova de humano (invisível; sem a chave do site não faz nada). Se o código falhar no servidor, tenta-se outro uma vez.
      try {
        await api.forgotPassword(email.trim(), await human.getToken());
      } catch (x) {
        if (!(x instanceof ApiError) || !needsHumanCheck(x)) throw x;
        await api.forgotPassword(email.trim(), await human.getToken());
      }
      setSent(true);
    } catch (x) {
      setError(x instanceof ApiError ? securityErrorText(x, 'forgot') : 'Não consegui enviar agora. Tenta outra vez.');
    } finally {
      setBusy(false);
    }
  }

  const footer = <Text style={st.footerText} onPress={() => router.replace('/login?entrar=1' as never)} accessibilityRole="link"><Text style={{ color: colors.brand, fontWeight: '600' }}>Voltar a entrar</Text></Text>;
  return (
    <>
    <Screen footer={footer}>
      {wide ? null : <View style={{ paddingTop: 40 }} accessibilityRole="header"><Wordmark height={44} /></View>}
      {sent ? (
        <View style={{ marginTop: 40 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="mail" size={32} color={colors.brand} />
            <Text style={st.sentTitle}>Vê o teu e-mail</Text>
          </View>
          <Text style={st.sentText}>
            Se existir uma conta com <Text style={{ fontWeight: '700' }}>{email.trim()}</Text>, enviámos um link para escolheres uma senha nova. Vale 1 hora. Se não chegar, vê também o spam.
          </Text>
        </View>
      ) : (
        <>
          <Text style={st.title}>Esqueceste{'\n'}a senha?</Text>
          <Text style={st.sub}>Diz-nos o teu e-mail e enviamos um link para escolheres outra.</Text>
          <View style={{ marginTop: 28, gap: 12 }}>
            <Field icon="mail" value={email} onChangeText={(t) => { setEmail(t); setError(''); }} placeholder="E-mail" autoFocus autoCapitalize="none" keyboardType="email-address" autoComplete="email" returnKeyType="go" onSubmitEditing={() => void submit()} accessibilityLabel="E-mail" />
            <Text style={st.alertText} accessibilityRole="alert">{error}</Text>
            <Pressable onPress={() => void submit()} disabled={busy} style={({ pressed }) => [st.ctaWrap, busy && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
              <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.cta}>
                {busy ? <ActivityIndicator color="#fff" style={{ height: 28 }} /> : <Text style={st.ctaText}>Enviar link</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </>
      )}
    </Screen>
    {human.node}
    </>
  );
}

const st = StyleSheet.create({
  title: { marginTop: 28, fontSize: 34, fontWeight: '800', lineHeight: 36, color: colors.zinc900 },
  sub: { marginTop: 8, fontSize: 18, fontWeight: '300', lineHeight: 28, color: colors.zinc600 },
  sentTitle: { flexShrink: 1, fontSize: 30, fontWeight: '800', lineHeight: 36, color: colors.zinc900 },
  sentText: { marginTop: 12, fontSize: 18, lineHeight: 28, color: colors.zinc600 },
  alertText: { minHeight: 24, fontSize: 15, color: colors.red600, textAlign: 'center' },
  ctaWrap: { borderRadius: 999, boxShadow: '0 10px 24px rgba(214,51,79,0.35)' },
  cta: { borderRadius: 999, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 18, lineHeight: 28, fontWeight: '600' },
  footerText: { fontSize: 18, lineHeight: 28, color: colors.zinc800, textAlign: 'center' },
});
