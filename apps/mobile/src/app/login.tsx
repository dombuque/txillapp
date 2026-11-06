import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
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
function Field({ icon, secure, ...rest }: { icon: 'at' | 'lock'; secure?: boolean } & React.ComponentProps<typeof TextInput>) {
  const [focus, setFocus] = useState(false);
  const [shown, setShown] = useState(false);
  const tint = focus ? colors.brand : colors.zinc600;
  return (
    <View style={[styles.field, { boxShadow: focus ? `0 0 0 2px ${colors.brand}` : '0 1px 10px rgba(0,0,0,0.06)' }]}>
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
      {secure && (
        <Pressable onPress={() => setShown((s) => !s)} hitSlop={8} accessibilityRole="button" accessibilityLabel={shown ? 'Esconder a senha' : 'Mostrar a senha'}>
          <Icon name={shown ? 'eye-off' : 'eye'} size={22} color={colors.zinc600} />
        </Pressable>
      )}
    </View>
  );
}

function Screen({ children, footer }: { children: ReactNode; footer: ReactNode }) {
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
      <View style={[styles.footer, { paddingBottom: 20 + insets.bottom }]}>{footer}</View>
    </KeyboardAvoidingView>
  );
}

/** Entrar: "Qual é a Vibe?", @ ou email e senha. */
export default function Login() {
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pass = useRef<React.ComponentRef<typeof TextInput>>(null);

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
          <Text style={{ color: colors.brand, fontWeight: '600' }} onPress={() => open('/register')} accessibilityRole="link">
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
        <Text style={styles.forgot} onPress={() => open('/forgot-password')} accessibilityRole="link">Esqueceste a senha?</Text>
      </View>
      <View style={{ height: 24 }} />
    </Screen>
  );
}

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
