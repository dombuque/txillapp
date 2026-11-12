import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { DELETION_DELETED, DELETION_KEPT, DELETION_STEPS, DELETION_WHEN } from '@/lib/accountDeletion';
import { ApiError } from '@/lib/api';
import { emailApi } from '@/lib/api.email';
import { colors } from '@/lib/theme';

const SUPPORT = 'privacidade@txillapp.com';

/**
 * txillapp.com/apagar-conta: página pública (sem sessão) para pedir que a conta e os dados sejam apagados, como pede a Google Play.
 * Explica os passos na app e, para quem já não a tem, manda uma ligação de confirmação para o email da conta.
 * Escrever um email nunca apaga nada: só quem abre a ligação nesse email e confirma é que apaga a conta.
 */
export default function DeleteAccountPage() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.title = 'Apagar a conta · Txillapp';
  }, []);
  return (
    <StackPage title="Apagar a conta">
      <ScrollView contentContainerStyle={st.page} keyboardShouldPersistTaps="handled">
        {typeof token === 'string' && token ? <Confirm token={token} /> : <Explain />}
      </ScrollView>
    </StackPage>
  );
}

function Explain() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<null | { mail: boolean }>(null);
  const [error, setError] = useState('');
  async function submit() {
    if (busy) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Escreve o email da tua conta');
    setBusy(true);
    setError('');
    try {
      const r = await emailApi.requestDeletion(email.trim());
      setSent({ mail: r.mail });
    } catch (x) {
      setError(x instanceof ApiError ? x.message : 'Não consegui enviar agora. Tenta outra vez.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Text style={st.h1} accessibilityRole="header">Apagar a conta do Txillapp</Text>
      <Text style={st.p}>Podes apagar a tua conta e os teus dados quando quiseres. Não se desfaz.</Text>

      <Text style={st.h2} accessibilityRole="header">Na app</Text>
      {DELETION_STEPS.map((s, i) => (
        <View key={s} style={st.step}><Text style={st.num}>{i + 1}</Text><Text style={[st.p, { flex: 1 }]}>{s}</Text></View>
      ))}
      <Text style={st.note}>No site txillapp.com é igual: entra na tua conta e segue os mesmos passos.</Text>

      <Text style={st.h2} accessibilityRole="header">Já não tens a app?</Text>
      <Text style={st.p}>Escreve o email da tua conta. Mandamos para esse email uma ligação para confirmares: só quem abre essa ligação pode apagar a conta. Escrever o email, por si só, não apaga nada.</Text>
      {sent ? (
        <View style={st.box} accessibilityLiveRegion="polite">
          <Icon name="mail" size={22} color={colors.brand} />
          <Text style={[st.p, { flex: 1 }]}>
            {sent.mail
              ? 'Se houver uma conta com este email, vais receber uma mensagem com a ligação daqui a pouco. A ligação vale 1 hora. Vê também a pasta de spam.'
              : `Neste momento não conseguimos enviar emails. Apaga a conta na app ou em txillapp.com, ou escreve-nos para ${SUPPORT} a partir do email da conta.`}
          </Text>
        </View>
      ) : (
        <View style={{ gap: 10, marginTop: 12 }}>
          <TextInput
            value={email}
            onChangeText={(t) => { setEmail(t); setError(''); }}
            placeholder="O email da tua conta"
            placeholderTextColor={colors.zinc500}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            accessibilityLabel="O email da tua conta"
            style={st.input}
          />
          <Text style={st.err} accessibilityRole="alert">{error}</Text>
          <Pressable onPress={() => void submit()} disabled={busy} style={({ pressed }) => [st.btn, busy && { opacity: 0.6 }, pressed && { opacity: 0.85 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.btnText}>Enviar a ligação</Text>}
          </Pressable>
        </View>
      )}

      <What />
      <Text style={st.note}>Dúvidas, ou já não tens acesso ao email da conta? Escreve para {SUPPORT}.</Text>
    </>
  );
}

/** O que é apagado e o que fica (e porquê). */
function What() {
  return (
    <>
      <Text style={st.h2} accessibilityRole="header">O que é apagado</Text>
      {DELETION_DELETED.map((t) => <Text key={t} style={st.li}>• {t}</Text>)}
      <Text style={st.h2} accessibilityRole="header">O que fica, e porquê</Text>
      {DELETION_KEPT.map((t) => <Text key={t} style={st.li}>• {t}</Text>)}
      <Text style={st.h2} accessibilityRole="header">Quando</Text>
      <Text style={st.p}>{DELETION_WHEN}</Text>
    </>
  );
}

function Confirm({ token }: { token: string }) {
  const router = useRouter();
  const [who, setWho] = useState<null | { username: string; displayName: string }>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let live = true;
    emailApi.deletionPreview(token)
      .then((r) => { if (live) setWho(r); })
      .catch((x) => { if (live) setError(x instanceof ApiError ? x.message : 'Não consegui abrir a ligação. Tenta outra vez.'); });
    return () => { live = false; };
  }, [token]);
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await emailApi.confirmDeletion(token);
      setDone(true);
    } catch (x) {
      setError(x instanceof ApiError ? x.message : 'Não consegui apagar agora. Tenta outra vez.');
    } finally {
      setBusy(false);
    }
  }
  if (done) {
    return (
      <View style={{ marginTop: 24, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="check-circle" size={30} color="#16a34a" /><Text style={st.h1}>Conta apagada</Text></View>
        <Text style={st.p}>A tua conta do Txillapp e os teus dados foram apagados. Obrigado por teres feito parte da malta.</Text>
        <Pressable onPress={() => router.replace('/')} style={st.ghost} accessibilityRole="link"><Text style={st.ghostText}>Ir para o início</Text></Pressable>
      </View>
    );
  }
  return (
    <>
      <Text style={st.h1} accessibilityRole="header">Confirmar: apagar a conta</Text>
      {!who && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
      {who ? (
        <>
          <Text style={st.p}>Vais apagar a conta <Text style={{ fontWeight: '700' }}>@{who.username}</Text> ({who.displayName}) e os teus dados. Isto não se desfaz.</Text>
          <What />
          <Text style={st.err} accessibilityRole="alert">{error}</Text>
          <Pressable onPress={() => void confirm()} disabled={busy} style={({ pressed }) => [st.btn, st.danger, busy && { opacity: 0.6 }, pressed && { opacity: 0.85 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.btnText}>Apagar a minha conta para sempre</Text>}
          </Pressable>
          <Pressable onPress={() => router.replace('/')} style={st.ghost} accessibilityRole="button"><Text style={st.ghostText}>Cancelar, não quero apagar</Text></Pressable>
        </>
      ) : error ? (
        <>
          <Text style={[st.err, { textAlign: 'left', marginTop: 16 }]} accessibilityRole="alert">{error}</Text>
          <Pressable onPress={() => router.replace('/apagar-conta' as never)} style={st.ghost} accessibilityRole="link"><Text style={st.ghostText}>Pedir uma ligação nova</Text></Pressable>
        </>
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingBottom: 64 },
  h1: { marginTop: 24, fontSize: 28, fontWeight: '800', color: colors.zinc900, flexShrink: 1 },
  h2: { marginTop: 28, marginBottom: 6, fontSize: 19, fontWeight: '700', color: colors.zinc800 },
  p: { marginTop: 6, fontSize: 16, lineHeight: 24, color: colors.zinc800 },
  li: { marginTop: 4, fontSize: 15, lineHeight: 22, color: colors.zinc700, paddingLeft: 4 },
  note: { marginTop: 14, fontSize: 14, lineHeight: 20, color: colors.zinc500 },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 4 },
  num: { marginTop: 6, width: 24, height: 24, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.zinc100, textAlign: 'center', lineHeight: 24, fontSize: 13, fontWeight: '700', color: colors.zinc700 },
  box: { marginTop: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: 16, backgroundColor: colors.zinc100, padding: 14 },
  input: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: colors.zinc200, paddingHorizontal: 16, fontSize: 16, color: colors.zinc900, backgroundColor: '#fff' },
  err: { minHeight: 20, fontSize: 14, color: colors.red600, textAlign: 'center' },
  btn: { minHeight: 50, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 4 },
  danger: { backgroundColor: colors.red600, marginTop: 20 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  ghost: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ghostText: { color: colors.zinc700, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
});
