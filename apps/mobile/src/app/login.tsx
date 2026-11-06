import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { GoogleButton } from '@/components/GoogleButton';
import { Icon } from '@/components/Icon';
import { Wordmark } from '@/components/Wordmark';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SITE_URL } from '@/lib/config';
import { colors } from '@/lib/theme';

const open = (path: string) => void Linking.openURL(`${SITE_URL || 'https://txillapp.com'}${path}`);

/** Mancha de cor suave (o "blur" do site): círculo com degradê radial. */
function Blob({ size, color, style }: { size: number; color: string; style: object }) {
  return (
    <Svg width={size} height={size} style={[{ position: 'absolute' }, style]} pointerEvents="none">
      <Defs>
        <RadialGradient id={`b${color}`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={0.3} />
          <Stop offset="0.55" stopColor={color} stopOpacity={0.14} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#b${color})`} />
    </Svg>
  );
}

/** Campo arredondado e branco, com ícone, como no site (anel coral ao escrever). */
export function Field({ icon, secure, status, ...rest }: { icon: 'at' | 'lock' | 'user' | 'mail' | 'calendar'; secure?: boolean; status?: 'ok' | 'bad' | 'checking' } & React.ComponentProps<typeof TextInput>) {
  const [focus, setFocus] = useState(false);
  const [shown, setShown] = useState(false);
  const tint = focus ? colors.brand : colors.zinc600;
  return (
    <View style={[styles.field, { boxShadow: status === 'ok' ? '0 0 0 2px #22c55e' : status === 'bad' ? '0 0 0 2px #ef4444' : focus ? `0 0 0 2px ${colors.brand}` : '0 1px 10px rgba(0,0,0,0.06)' }]}>
      <Icon name={icon} size={22} color={tint} />
      <TextInput
        {...rest}
        secureTextEntry={secure && !shown}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholderTextColor={colors.zinc600}
        autoCorrect={false}
        spellCheck={false}
        style={styles.input}
      />
      {status === 'checking' && <ActivityIndicator size="small" color={colors.zinc600} />}
      {status === 'ok' && <Icon name="check" size={22} color="#22c55e" strokeWidth={2.4} />}
      {status === 'bad' && <Icon name="x" size={22} color="#ef4444" strokeWidth={2.4} />}
      {secure && (
        <Pressable onPress={() => setShown((s) => !s)} hitSlop={8} accessibilityRole="button" accessibilityLabel={shown ? 'Esconder a senha' : 'Mostrar a senha'}>
          <Icon name={shown ? 'eye-off' : 'eye'} size={22} color={colors.zinc600} />
        </Pressable>
      )}
    </View>
  );
}

export function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas, overflow: 'hidden' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Blob size={380} color="#d6334f" style={{ right: -150, top: -150 }} />
        <Blob size={340} color="#fcd34d" style={{ left: -170, top: 190 }} />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 24, paddingHorizontal: 28 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { paddingBottom: 20 + insets.bottom }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

/** Entrar: "Qual é a Vibe?", @ ou email e senha. */
export default function Login() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pass = useRef<React.ComponentRef<typeof TextInput>>(null);
  // Ligação de convite (/login?convite=CODIGO): quem chega assim é novo, vai direto para criar conta.
  const { convite } = useLocalSearchParams<{ convite?: string }>();
  useEffect(() => {
    const code = String(convite ?? '').trim().toUpperCase().slice(0, 20);
    if (code) router.replace({ pathname: '/register', params: { convite: code } } as never);
  }, [convite, router]);

  async function submit() {
    if (busy) return;
    if (!identifier.trim() || !password) return setError('Por favor preencha as suas credenciais');
    setBusy(true);
    setError('');
    try {
      await signIn(identifier.trim().replace(/^@/, ''), password);
    } catch (x) {
      setError(x instanceof ApiError && x.status === 401 ? 'Hmm, essas credenciais não batem' : (x as Error).message);
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <Text style={styles.footerText}>
          É novo no txillapp?{' '}
          <Text style={{ color: colors.brand, fontWeight: '600' }} onPress={() => router.push('/register' as never)} accessibilityRole="link">
            Cria a tua conta
          </Text>
        </Text>
      }
    >
      <View style={{ paddingTop: 40 }} accessibilityRole="header">
        <Wordmark height={44} />
      </View>
      <Text style={styles.title}>Qual é a{'\n'}Vibe?</Text>
      <Text style={styles.sub}>Entra e vê o que a malta anda a fazer</Text>

      <View style={{ marginTop: 28, gap: 12 }}>
        <Field
          icon="at"
          value={identifier}
          onChangeText={setIdentifier}
          placeholder="Utilizador ou email"
          autoCapitalize="none"
          autoComplete="username"
          keyboardType="email-address"
          returnKeyType="next"
          onSubmitEditing={() => pass.current?.focus()}
          accessibilityLabel="Utilizador ou email"
        />
        <Field
          icon="lock"
          secure
          ref={pass}
          value={password}
          onChangeText={setPassword}
          placeholder="Senha"
          autoCapitalize="none"
          autoComplete="current-password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          accessibilityLabel="Senha"
        />
        <View style={styles.alert} accessibilityRole="alert">
          <Text style={styles.alertText}>{error}</Text>
        </View>
        <Pressable onPress={() => void submit()} disabled={busy} style={({ pressed }) => [styles.ctaWrap, busy && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
          <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.cta}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Entrar</Text>}
          </LinearGradient>
        </Pressable>
        <Text style={styles.forgot} onPress={() => router.push('/forgot-password' as never)} accessibilityRole="link">Esqueceste a senha?</Text>
      </View>
      <GoogleButton mode="login" onError={setError} />
      <View style={{ height: 24 }} />
    </Screen>
  );
}

export const authStyles = () => styles;
const styles = StyleSheet.create({
  title: { marginTop: 28, fontSize: 38, fontWeight: '800', lineHeight: 40, color: colors.zinc900 },
  sub: { marginTop: 8, fontSize: 18, fontWeight: '300', lineHeight: 28, color: colors.zinc600 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16 },
  input: { flex: 1, minWidth: 0, fontSize: 18, lineHeight: 24, color: colors.zinc900, padding: 0, outlineStyle: 'none' } as object,
  alert: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  alertText: { fontSize: 15, color: colors.red600, textAlign: 'center' },
  ctaWrap: { borderRadius: 999, boxShadow: '0 10px 24px rgba(214,51,79,0.35)' },
  cta: { borderRadius: 999, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 18, lineHeight: 28, fontWeight: '600' },
  forgot: { paddingTop: 4, textAlign: 'center', fontSize: 15, fontWeight: '600', color: colors.zinc600, textDecorationLine: 'underline' },
  footer: { borderTopWidth: 1, borderTopColor: colors.zinc200, backgroundColor: 'rgba(255,255,255,0.7)', paddingTop: 20, alignItems: 'center' },
  footerText: { fontSize: 18, lineHeight: 28, color: colors.zinc800, textAlign: 'center' },
});
