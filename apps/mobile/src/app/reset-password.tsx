import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/Icon';
import { Wordmark } from '@/components/Wordmark';
import { ApiError } from '@/lib/api';
import { emailApi } from '@/lib/api.email';
import { colors } from '@/lib/theme';
import { Field, Screen } from './login';
import { t } from '@/lib/i18n';

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
  const second = useRef<React.ComponentRef<typeof TextInput>>(null);
  // No computador o logótipo já está no painel da esquerda (como em entrar e em esqueci a senha).
  const wide = useWindowDimensions().width >= 1024;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function submit() {
    if (busy || done) return;
    if (!token) return setError(t('Este link está incompleto. Abre outra vez o link do email ou pede um novo.'));
    if (pass.length < 10) return setError(t('A senha precisa de pelo menos 10 caracteres'));
    if (pass !== again) return setError(t('As duas senhas não são iguais'));
    setBusy(true);
    setError('');
    try {
      await emailApi.resetPassword(String(token), pass);
      setDone(true);
      timer.current = setTimeout(() => router.replace('/login'), 2500);
    } catch (x) {
      setError(x instanceof ApiError ? x.message : t('Não consegui mudar agora. Tenta outra vez.'));
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || !pass;

  return (
    <Screen footer={<Text style={{ textAlign: 'center', fontSize: 16, color: colors.zinc600 }} onPress={() => router.replace('/login')} accessibilityRole="link"><Text style={{ color: colors.brand, fontWeight: '600' }}>{t('Voltar a entrar')}</Text></Text>}>
      {wide ? null : <View style={{ paddingTop: 40 }} accessibilityRole="header"><Wordmark height={44} /></View>}
      {done ? (
        <View style={{ marginTop: 40 }}>
          <View style={st.row}><Icon name="check-circle" size={32} color={colors.green600} /><Text style={st.title}>{t('Senha mudada')}</Text></View>
          <Text style={st.sub}>{t('Já podes entrar com a senha nova. A levar-te ao login…')}</Text>
        </View>
      ) : (
        <>
          <Text style={[st.title, { marginTop: 28, fontSize: 34, fontWeight: '800', lineHeight: 36 }]}>{t('Escolhe uma\nsenha nova')}</Text>
          <Text style={[st.sub, { fontWeight: '300' }]}>{t('Mínimo 10 caracteres. Vamos terminar a sessão nos outros aparelhos.')}</Text>
          <View style={{ marginTop: 28, gap: 12 }}>
            <Field icon="lock" secure value={pass} onChangeText={(t) => { setPass(t); setError(''); }} placeholder={t('Senha nova')} autoComplete="new-password" returnKeyType="next" onSubmitEditing={() => second.current?.focus()} submitBehavior="submit" accessibilityLabel={t('Senha nova')} />
            <Field icon="lock" secure ref={second} value={again} onChangeText={(t) => { setAgain(t); setError(''); }} placeholder={t('Repete a senha')} autoComplete="new-password" returnKeyType="go" onSubmitEditing={() => void submit()} accessibilityLabel={t('Repete a senha')} />
            <View style={{ minHeight: 32, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="alert"><Text style={{ fontSize: 15, color: colors.danger, textAlign: 'center' }}>{error}</Text></View>
            <Button label={t('Guardar senha')} onPress={() => void submit()} loading={busy} disabled={disabled} block style={st.cta} />
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
  /** Button lg com a sombra coral da marca (como em entrar). */
  cta: { boxShadow: '0 10px 24px rgba(214,51,79,0.35)' },
});
