import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Modal } from '@/components/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { feedApi, type Suggestion } from '@/lib/api.feed';
import { useAuth } from '@/lib/auth';
import { Avatar } from './Avatar';
import { FollowButton } from './FollowButton';
import { NameWithBadge } from './NameWithBadge';
import { FindContacts } from './FindContacts';
import { canPickContacts } from '@/lib/contacts';
import { useOverlay } from '@/lib/overlays';
import { colors, typo } from '@/lib/theme';
import { Icon, type IconName } from './Icon';
import { Button } from './ui/Button';
import { t } from '@/lib/i18n';

interface Step { icon: IconName; title: string; text: string }

/** Sem cartões a explicar a app (o desenho explica-se): as boas-vindas são só «Segue a malta». */
const STEPS: Step[] = [];

/** Quantas pessoas se pede para seguir no primeiro passo (quem segue 3 ou mais no 1.º dia volta muito mais). */
export const FOLLOW_GOAL = 3;

/**
 * O primeiro passo das boas-vindas: «Segue a malta». Sem ninguém para seguir, o Início fica vazio e a pessoa não volta.
 * A lista fica fixa enquanto o passo está aberto (seguir não a faz saltar); a contagem vem do perfil.
 */
function FollowStep({ following }: { following: number }) {
  const sugg = useQuery({ queryKey: ['welcome-suggestions'], queryFn: feedApi.suggestions, staleTime: Infinity });
  const [contacts, setContacts] = useState(false);
  const people: Suggestion[] = (sugg.data ?? []).slice(0, 8);
  const done = Math.min(following, FOLLOW_GOAL);
  return (
    <View>
      <Text style={st.text}>{done >= FOLLOW_GOAL ? t('Boa! O teu Início já tem vida.') : t('Segue pelo menos {n} pessoas para o teu Início ganhar vida.', { n: FOLLOW_GOAL })}</Text>
      <View style={st.goal} accessibilityLabel={t('{done} de {n} pessoas seguidas', { done, n: FOLLOW_GOAL })}>
        {Array.from({ length: FOLLOW_GOAL }, (_, n) => <View key={n} style={[st.goalBar, n < done && st.goalOn]} />)}
      </View>
      <ScrollView style={{ maxHeight: 300, marginTop: 8 }} showsVerticalScrollIndicator={false}>
        {people.map((p) => (
          <View key={p.username} style={st.person}>
            <Avatar name={p.displayName} username={p.username} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <NameWithBadge name={p.displayName} who={p} style={st.pName} gap={4} containerStyle={{ maxWidth: '100%' }} />
              <Text style={st.pReason} numberOfLines={1}>{p.reason}</Text>
            </View>
            <FollowButton username={p.username} following={false} requested={p.requested} isPrivate={p.isPrivate} style={{ minWidth: 96 }} />
          </View>
        ))}
        {sugg.isSuccess && people.length === 0 ? <Text style={st.pReason}>{t('Ainda não há sugestões. Procura pessoas na Pesquisar.')}</Text> : null}
      </ScrollView>
      {canPickContacts() ? (
        <Pressable onPress={() => setContacts(true)} style={st.contacts} accessibilityRole="button">
          <Icon name="users" size={18} color={colors.brand} />
          <Text style={st.contactsText}>{t('Procurar amigos nos meus contactos')}</Text>
        </Pressable>
      ) : null}
      {contacts ? <FindContacts onClose={() => setContacts(false)} /> : null}
    </View>
  );
}

/**
 * Visita guiada para quem acabou de registar: primeiro «Segue a malta» (com sugestões), depois o cartão passo a passo sobre
 * o Início. Só aparece uma vez (o servidor guarda).
 */
export function WelcomeTour() {
  const qc = useQueryClient();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const privacy = useQuery({ queryKey: ['privacy'], queryFn: api.privacy, staleTime: 60_000 });
  const { user } = useAuth();
  const me = useQuery({ queryKey: ['profile', user?.username], queryFn: () => api.profile(user!.username), enabled: !!user, staleTime: 5_000 });
  const [i, setI] = useState(-1);
  const p = privacy.data;
  // Primeiro confirma-se a conta (o painel do código abre logo a seguir ao registo); as boas-vindas vêm depois.
  const email = useQuery({ queryKey: ['email-status'], queryFn: api.emailStatus, staleTime: 30_000 });
  const ready = !!email.data && (email.data.verified || !email.data.required);
  useOverlay(!!p && p.welcomed === false && ready);
  if (!p || p.welcomed !== false || !ready) return null;
  const follow = i === -1;
  const step = follow ? { icon: 'users' as IconName, title: t('Segue a malta') } : STEPS[i];
  const last = i === STEPS.length - 1;

  function finish(openGeleira: boolean) {
    qc.setQueryData(['privacy'], { ...p!, welcomed: true }); // fecha já; o servidor confirma a seguir
    api.setWelcomed().then((r) => qc.setQueryData(['privacy'], r)).catch(() => undefined);
    if (openGeleira) router.push('/geleira');
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => finish(false)} statusBarTranslucent>
      <View style={[st.back, { paddingBottom: insets.bottom + 96 }]} accessibilityViewIsModal accessibilityLabel={t('Visita guiada')}>
        <View style={st.card}>
          <View style={st.head}>
            <View style={st.iconWrap}><Icon name={step.icon} size={22} color={colors.brand} /></View>
            <Text style={st.title}>{step.title}</Text>
          </View>
          {follow ? <FollowStep following={me.data?.counts.following ?? 0} /> : <Text style={st.text}>{(step as Step).text}</Text>}
          <View style={st.foot}>
            {STEPS.length ? (
              <View style={st.dots} accessibilityLabel={t('Passo {n} de {n2}', { n: i + 2, n2: STEPS.length + 1 })}>
                {[-1, ...STEPS.map((_, n) => n)].map((n) => <View key={n} style={[st.dot, n === i && st.dotOn]} />)}
              </View>
            ) : <View />}
            <View style={st.actions}>
              {/* Só «Segue a malta»: saltar ou concluir (sem cartões a explicar a app). */}
              <Button label={t('Saltar')} kind="ghost" size="md" onPress={() => finish(false)} style={st.ghost} />
              {last ? <Button label={t('Concluir')} size="md" onPress={() => finish(false)} /> : <Button label={t('Seguinte')} size="md" onPress={() => setI(i + 1)} />}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 16 },
  card: { width: '100%', maxWidth: 384, borderRadius: 24, backgroundColor: colors.white, padding: 20, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, ...typo.title, color: colors.zinc900, lineHeight: 24 },
  text: { marginTop: 12, fontSize: 16, lineHeight: 22, color: colors.zinc700 },
  foot: { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.zinc300 },
  dotOn: { width: 20, backgroundColor: colors.brand },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ghost: { paddingHorizontal: 12 },
  goal: { flexDirection: 'row', gap: 6, marginTop: 12 },
  goalBar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.zinc200 },
  goalOn: { backgroundColor: colors.brand },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  pName: { fontSize: 15, fontWeight: '700', color: colors.zinc900, flexShrink: 1 },
  pReason: { fontSize: 13, color: colors.zinc500 },
  contacts: { marginTop: 8, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.rose50 },
  contactsText: { fontSize: 15, fontWeight: '700', color: colors.brand },
});
