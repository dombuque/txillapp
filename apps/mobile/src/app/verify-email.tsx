import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Icon } from '@/components/Icon';
import { Wordmark } from '@/components/Wordmark';
import { ApiError } from '@/lib/api';
import { emailApi } from '@/lib/api.email';
import { colors } from '@/lib/theme';
import { Screen } from './login';

/** Abre-se a partir do link do email: confirma a conta. Pode ser noutro aparelho, por isso não exige sessão. */
export default function VerifyEmail() {
  const { token = '' } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const [state, setState] = useState<'working' | 'ok' | 'bad'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    emailApi
      .verifyEmail(String(token))
      .then(() => alive && setState('ok'))
      .catch((x) => {
        if (!alive) return;
        setMessage(x instanceof ApiError ? x.message : 'Não consegui confirmar agora. Tenta outra vez.');
        setState('bad');
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <Screen>
      <View style={{ paddingTop: 40 }} accessibilityRole="header"><Wordmark height={44} /></View>
      <View style={{ marginTop: 40 }}>
        {state === 'working' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityRole="progressbar">
            <ActivityIndicator color={colors.brand} />
            <Text style={st.sub}>A confirmar o teu email…</Text>
          </View>
        )}
        {state === 'ok' && (
          <>
            <View style={st.row}><Icon name="check-circle" size={32} color="#16a34a" /><Text style={st.title}>Email confirmado</Text></View>
            <Text style={st.sub}>Já podes publicar, comentar e conversar.</Text>
            <Pressable onPress={() => router.replace('/')} style={[st.cta, { backgroundColor: colors.brand }]} accessibilityRole="button"><Text style={[st.ctaText, { color: '#fff' }]}>Entrar no Txillapp</Text></Pressable>
          </>
        )}
        {state === 'bad' && (
          <>
            <View style={st.row}><Icon name="alert" size={32} color={colors.brand} /><Text style={st.title}>Link inválido</Text></View>
            <Text style={st.sub}>{message}</Text>
            <Pressable onPress={() => router.replace('/')} style={[st.cta, { borderWidth: 2, borderColor: colors.zinc300 }]} accessibilityRole="button"><Text style={[st.ctaText, { color: colors.zinc900 }]}>Ir para o Txillapp</Text></Pressable>
          </>
        )}
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 30, fontWeight: '800', lineHeight: 34, color: colors.zinc900, flexShrink: 1 },
  sub: { marginTop: 12, fontSize: 18, lineHeight: 26, color: colors.zinc600 },
  cta: { marginTop: 32, borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  ctaText: { fontSize: 18, fontWeight: '600' },
});
