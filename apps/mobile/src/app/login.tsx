import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/** Entrada: @ ou email e senha. O registo e a recuperação da senha abrem no site, por agora. */
export default function Login() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pass = useRef<React.ComponentRef<typeof TextInput>>(null);

  async function go() {
    if (busy || !identifier.trim() || !password) return;
    setBusy(true);
    setErr('');
    try {
      await signIn(identifier.trim(), password);
    } catch (e) {
      setErr((e as Error).message || 'Não foi possível entrar');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.white }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <Image source={require('../../assets/images/icon.png')} style={styles.logo} contentFit="contain" />
        <Text style={styles.title}>Entra no Txillapp</Text>
        <Text style={styles.sub}>A rede da malta.</Text>

        <TextInput
          value={identifier}
          onChangeText={setIdentifier}
          placeholder="@utilizador ou email"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          keyboardType="email-address"
          returnKeyType="next"
          onSubmitEditing={() => pass.current?.focus()}
          style={styles.input}
          accessibilityLabel="Utilizador ou email"
        />
        <TextInput
          ref={pass}
          value={password}
          onChangeText={setPassword}
          placeholder="Senha"
          placeholderTextColor={colors.muted}
          secureTextEntry
          autoComplete="current-password"
          returnKeyType="go"
          onSubmitEditing={() => void go()}
          style={styles.input}
          accessibilityLabel="Senha"
        />
        {err ? <Text style={styles.err} accessibilityRole="alert">{err}</Text> : null}
        <Pressable onPress={() => void go()} disabled={busy || !identifier.trim() || !password} style={[styles.btn, (busy || !identifier.trim() || !password) && { opacity: 0.45 }]} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Entrar</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 28, alignItems: 'stretch' },
  logo: { width: 150, height: 150, alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  sub: { fontSize: 16, color: colors.muted, textAlign: 'center', marginBottom: 28, marginTop: 4 },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.soft, paddingHorizontal: 16, fontSize: 16, color: colors.ink, marginBottom: 12 },
  err: { color: colors.danger, fontSize: 14, marginBottom: 10 },
  btn: { height: 52, borderRadius: 26, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
