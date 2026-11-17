import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { ScrollView, Text, View } from 'react-native';
import { Group, Line } from '@/components/Lines';
import { StackPage } from '@/components/StackPage';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { buildId } from '@/lib/push';
import { colors } from '@/lib/theme';
import { t } from '@/lib/i18n';

const SUPPORT = 'suporte@txillapp.com';
const MONTHS = () => [t('janeiro'), t('fevereiro'), t('março'), t('abril'), t('maio'), t('junho'), t('julho'), t('agosto'), t('setembro'), t('outubro'), t('novembro'), t('dezembro')];
const longDate = (iso: string) => {
  const d = new Date(iso);
  return t('{date} de {month} de {fullYear}', { date: d.getDate(), month: MONTHS()[d.getMonth()], fullYear: d.getFullYear() });
};

/** Sobre: a tua conta, a política de privacidade, os termos e a versão. */
export default function About() {
  const { user } = useAuth();
  const me = useQuery({ queryKey: ['profile', user?.username], queryFn: () => api.profile(user!.username), enabled: !!user });
  const ver = useQuery({ queryKey: ['verification'], queryFn: api.verificationStatus, staleTime: 60_000 });
  const geo = useQuery({ queryKey: ['geo'], queryFn: api.geo, staleTime: 5 * 60_000 });
  const since = me.data?.joinedAt ? longDate(me.data.joinedAt) : '…';
  let country = geo.data?.country ?? '';
  try {
    if (country) country = new Intl.DisplayNames(['pt'], { type: 'region' }).of(country) ?? country;
  } catch {
    /* sem Intl.DisplayNames: mantém o código */
  }
  return (
    <StackPage title={t('Sobre')}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Group title={t('Sobre o teu perfil')}>
          <Line icon="user" label={t('Nome de utilizador')} value={`@${user?.username ?? ''}`} />
          <Line icon="clock" label={t('Conta criada em')} value={since} />
          {country ? <Line icon="globe" label={t('Região')} value={country} /> : null}
          <Line icon="check-circle" label={t('Verificação')} value={ver.data?.verified ? (ver.data.tier === 'official' ? t('Conta oficial do Txillapp') : ver.data.tier === 'paid' ? t('Verificado com subscrição') : t('Conta verificada')) : t('Sem selo')} to="/verification" />
        </Group>
        <Group title={t('Legal')}>
          <Line icon="shield" label={t('Política de privacidade')} to="/privacy" />
          <Line icon="file-text" label={t('Termos de utilização')} to="/terms" />
        </Group>
        <Group title="Txillapp">
          <Line icon="info" label={t('Versão')} value={`${Constants.expoConfig?.version ?? '?'}${buildId() ? (' ' + t('(build {id})', { id: buildId()!.slice(0, 8) })) : ''}`} />
          <Line icon="mail" label={t('Contactar-nos')} value={SUPPORT} href={`mailto:${SUPPORT}`} />
        </Group>
        <View style={{ marginHorizontal: 24, marginTop: 24, alignItems: 'center' }}>
          <Text style={{ textAlign: 'center', fontSize: 14, color: colors.zinc500 }}>
            {t('O Txillapp é a rede da malta: fotos, vídeos, mimos, tchekas e chat, com vibes para brindar e oferecer.')}
          </Text>
          {user && ver.data?.verified ? <View style={{ marginTop: 6 }}><VerifiedBadge size={14} tier={ver.data.tier} /></View> : null}
        </View>
      </ScrollView>
    </StackPage>
  );
}
