import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { ScrollView, Text, View } from 'react-native';
import { Group, Line } from '@/components/Lines';
import { StackPage } from '@/components/StackPage';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

const SUPPORT = 'suporte@txillapp.com';
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const longDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
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
    <StackPage title="Sobre">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Group title="Sobre o teu perfil">
          <Line icon="user" label="Nome de utilizador" value={`@${user?.username ?? ''}`} />
          <Line icon="clock" label="Conta criada em" value={since} />
          {country ? <Line icon="globe" label="Região" value={country} /> : null}
          <Line icon="check-circle" label="Verificação" value={ver.data?.verified ? (ver.data.tier === 'official' ? 'Conta oficial do Txillapp' : 'Conta verificada') : 'Sem selo'} to="/verification" />
        </Group>
        <Group title="Legal">
          <Line icon="shield" label="Política de privacidade" to="/privacy" />
          <Line icon="file-text" label="Termos de utilização" to="/terms" />
        </Group>
        <Group title="Txillapp">
          <Line icon="info" label="Versão" value={Constants.expoConfig?.version ?? '—'} />
          <Line icon="mail" label="Contactar-nos" value={SUPPORT} href={`mailto:${SUPPORT}`} />
        </Group>
        <View style={{ marginHorizontal: 24, marginTop: 24, alignItems: 'center' }}>
          <Text style={{ textAlign: 'center', fontSize: 14, color: colors.zinc500 }}>
            O Txillapp é a rede da malta: fotos, vídeos, stories, reels e chat, com Txills para brindar e presentear.
          </Text>
          {user && ver.data?.verified ? <View style={{ marginTop: 6 }}><VerifiedBadge size={14} tier={ver.data.tier} /></View> : null}
        </View>
      </ScrollView>
    </StackPage>
  );
}
