import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Icon } from '@/components/Icon';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { emailApi } from '@/lib/api.email';
import { colors } from '@/lib/theme';
import { AUTH_WIDE, Screen } from './login';
import { t } from '@/lib/i18n';

/** Abre-se a partir do link do email: confirma a conta. Pode ser noutro aparelho, por isso não exige sessão. */
export default function VerifyEmail() {
  const { token = '' } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const [state, setState] = useState<'working' | 'ok' | 'bad'>('working');
  const [message, setMessage] = useState('');
  const wide = useWindowDimensions().width >= AUTH_WIDE;

  useEffect(() => {
    let alive = true;
    emailApi
      .verifyEmail(String(token))
      .then(() => alive && setState('ok'))
      .catch((x) => {
        if (!alive) return;
        setMessage(x instanceof ApiError ? x.message : t('Não consegui confirmar agora. Tenta outra vez.'));
        setState('bad');
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <Screen>
      {wide ? null : <View style={{ paddingTop: 40 }} accessibilityRole="header"><Wordmark height={44} /></View>}
      <View style={{ marginTop: 40 }}>
        {state === 'working' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityRole="progressbar">
            <ActivityIndicator color={colors.brand} />
            <Text style={st.sub}>{t('A confirmar o teu email…')}</Text>
          </View>
        )}
        {state === 'ok' && (
          <>
            <View style={st.row}><Icon name="check-circle" size={32} color={colors.green600} /><Text style={st.title}>{t('Email confirmado')}</Text></View>
            <Text style={st.sub}>{t('Já podes publicar, comentar e conversar.')}</Text>
            <Button label={t('Entrar no Txillapp')} onPress={() => router.replace('/')} block style={st.cta} />
          </>
        )}
        {state === 'bad' && (
          <>
            <View style={st.row}><Icon name="alert" size={32} color={colors.brand} /><Text style={st.title}>{t('Link inválido')}</Text></View>
            <Text style={st.sub}>{message}</Text>
            <Button label={t('Ir para o Txillapp')} kind="secondary" onPress={() => router.replace('/')} block style={st.cta} />
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
  cta: { marginTop: 32 },
});
