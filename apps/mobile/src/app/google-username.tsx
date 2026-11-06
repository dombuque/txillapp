import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { googleSignup } from '@/components/GoogleButton';
import { Icon } from '@/components/Icon';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SITE_URL } from '@/lib/config';
import { colors } from '@/lib/theme';
import { Field, Screen } from './login';
import { problemOf, useAvailability } from './register';

/** Depois do Google, numa conta nova: escolher o @, o género e a data de nascimento. */
export default function GoogleUsername() {
  const { signInWith } = useAuth();
  const router = useRouter();
  const state = googleSignup.get();
  const [username, setUsername] = useState(state?.suggestedUsername ?? '');
  const [gender, setGender] = useState<string | null>(null);
  const [birth, setBirth] = useState('');
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const check = useAvailability('username', username, true);
  const birthProblem = birth ? problemOf('birthDate', birth) : null;
  const ready = !!gender && !!birth && !birthProblem && terms;
  const usernameOk = check.state === 'ok' || check.state === 'error';
  if (!state?.signupToken) return <Redirect href={'/login' as never} />;
  const first = state.displayName.split(' ')[0];
  const legal = (p: string) => (Platform.OS === 'web' ? router.push(p as never) : void Linking.openURL(`${SITE_URL || 'https://txillapp.com'}${p}`));

  const onDate = (t: string) => {
    const d = t.replace(/\D/g, '').slice(0, 8);
    setError('');
    setBirth(d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d);
  };

  async function submit() {
    if (busy || !usernameOk || !ready) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.googleComplete(state!.signupToken, username.trim().replace(/^@/, ''), gender!, birth);
      googleSignup.set(null);
      signInWith(r);
      router.replace('/');
    } catch (x) {
      setError(x instanceof ApiError && x.status === 401 ? 'O pedido expirou. Volta atrás e entra com a Google outra vez' : (x as Error).message);
      setBusy(false);
    }
  }

  const blocked = busy || !ready || !usernameOk;
  return (
    <Screen>
      <View style={st.topRow}>
        <Pressable onPress={() => { googleSignup.set(null); router.replace('/login' as never); }} style={st.back} accessibilityRole="button" accessibilityLabel="Voltar">
          <Icon name="back" size={30} strokeWidth={2} color={colors.brand} />
        </Pressable>
      </View>

      <View style={{ marginTop: 40 }}>
        <Text style={st.title}>Quase lá, {first}!</Text>
        <Text style={st.sub}>Escolhe o teu @ — é único e é assim que a malta te encontra</Text>

        <View style={{ marginTop: 32 }}>
          <Field
            icon="at"
            value={username}
            onChangeText={(v) => { setError(''); setUsername(v); }}
            placeholder="utilizador"
            autoFocus
            autoCapitalize="none"
            autoComplete="username"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            status={check.state === 'ok' ? 'ok' : check.state === 'bad' ? 'bad' : check.state === 'checking' ? 'checking' : undefined}
            accessibilityLabel="utilizador"
          />
          <View style={st.avail}>
            {check.state === 'ok' && <Text style={[st.hint, { color: '#16a34a', fontWeight: '600' }]}>@{username.trim().replace(/^@/, '')} está livre</Text>}
            {check.state === 'bad' && (
              <View>
                <Text style={[st.hint, { color: colors.red600, fontWeight: '600' }]}>{check.message}</Text>
                {check.suggestions && check.suggestions.length > 0 && (
                  <View style={st.sugs}>
                    {check.suggestions.slice(0, 4).map((u) => <Pressable key={u} onPress={() => setUsername(u)} style={st.sug}><Text style={st.sugText}>@{u}</Text></Pressable>)}
                  </View>
                )}
              </View>
            )}
          </View>
        </View>

        <Text style={st.label}>Como te identificas?</Text>
        <View style={{ flexDirection: 'row', gap: 12 }} accessibilityRole="radiogroup">
          {[['female', 'Feminino'], ['male', 'Masculino']].map(([v, label]) => {
            const on = gender === v;
            return (
              <Pressable key={v} onPress={() => { setError(''); setGender(v); }} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[st.opt, on ? { borderColor: colors.brand, backgroundColor: colors.rose50 } : { borderColor: colors.zinc200, backgroundColor: '#fff' }]}>
                <Text style={[st.optText, on && { color: colors.brand }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={st.label}>Quando nasceste?</Text>
        <Field
          icon="calendar"
          value={birth}
          onChangeText={onDate}
          placeholder="AAAA-MM-DD"
          keyboardType="number-pad"
          autoComplete="birthdate-full"
          status={birth.length === 10 ? (birthProblem ? 'bad' : 'ok') : undefined}
          accessibilityLabel="Data de nascimento"
        />
        {birthProblem && birth.length === 10 ? <Text style={[st.hint, { color: colors.red600, fontWeight: '600', marginTop: 8, paddingHorizontal: 4 }]}>{birthProblem}</Text> : null}

        <Pressable onPress={() => { setError(''); setTerms(!terms); }} style={st.terms} accessibilityRole="checkbox" accessibilityState={{ checked: terms }}>
          <View style={[st.box, terms && { backgroundColor: colors.brand, borderColor: colors.brand }]}>{terms && <Icon name="check" size={14} color="#fff" strokeWidth={3} />}</View>
          <Text style={st.termsText}>
            Li e aceito os <Text style={st.link} onPress={() => legal('/terms')}>Termos de Uso</Text> e a{' '}
            <Text style={st.link} onPress={() => legal('/privacy')}>Política de Privacidade</Text>.
          </Text>
        </Pressable>
      </View>

      <View style={st.alert} accessibilityRole="alert"><Text style={st.alertText}>{error}</Text></View>
      <View style={{ marginTop: 'auto', paddingBottom: 24 }}>
        <Pressable onPress={() => void submit()} disabled={blocked} style={({ pressed }) => [st.ctaWrap, blocked && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
          <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.cta}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.ctaText}>Continuar</Text>}
          </LinearGradient>
        </Pressable>
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  topRow: { paddingTop: 8 },
  back: { marginLeft: -4, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 36, fontWeight: '300', lineHeight: 40, color: colors.zinc900 },
  sub: { marginTop: 12, fontSize: 20, fontWeight: '300', lineHeight: 28, color: colors.zinc600 },
  label: { marginTop: 32, marginBottom: 12, fontSize: 18, lineHeight: 28, fontWeight: '600', color: colors.zinc900 },
  avail: { marginTop: 12, minHeight: 36, paddingHorizontal: 4 },
  hint: { fontSize: 14, color: colors.zinc600 },
  sugs: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sug: { borderRadius: 999, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6 },
  sugText: { fontSize: 14, fontWeight: '600', color: colors.brand },
  opt: { flex: 1, minHeight: 72, borderWidth: 2, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  optText: { fontSize: 15, fontWeight: '700', color: colors.zinc800 },
  link: { fontSize: 15, fontWeight: '600', color: colors.brand, textDecorationLine: 'underline' },
  terms: { marginTop: 24, flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 4 },
  box: { marginTop: 2, width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  termsText: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.zinc700 },
  alert: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  alertText: { fontSize: 15, color: colors.red600, textAlign: 'center' },
  ctaWrap: { borderRadius: 999, boxShadow: '0 10px 24px rgba(214,51,79,0.35)' },
  cta: { borderRadius: 999, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 18, lineHeight: 28, fontWeight: '600' },
});
