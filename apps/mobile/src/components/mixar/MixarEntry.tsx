import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mixarApi, mixarKeys } from '@/lib/api.mixar';
import { inboxEntry, mixarsWithDot } from '@/lib/mixar';
import { useMixarSeen } from '@/lib/mixarSeen';
import { colors } from '@/lib/theme';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { MixarBadge, MixarDot } from './MixarBits';
import { t } from '@/lib/i18n';

/** A lista dos meus Mixar (a mesma query do ecrã /mixar). Falhar não incomoda ninguém: o acesso simplesmente não aparece. */
export function useMixarList(enabled = true) {
  return useQuery({ queryKey: mixarKeys.list(), queryFn: mixarApi.list, enabled, staleTime: 30_000, refetchInterval: 120_000, retry: 1 });
}

/**
 * O acesso ao Mixar nas Mensagens (por cima dos separadores), só quando há novidades: aparece se algum Mixar tem a bolinha
 * azul (um convite por responder, sugestões de hoje por ver ou o desafio, e ainda não o abri desde que mudou: mixarShowDot),
 * com o selo, o que há de novo, os avatares e a bolinha. Sem novidades (ou sem servidor do Mixar, ou a carregar), nada.
 */
export function MixarEntry() {
  const router = useRouter();
  const q = useMixarList();
  const seen = useMixarSeen();
  const fresh = mixarsWithDot(q.data?.items, seen);
  if (!fresh.length) return null;
  const e = inboxEntry(fresh);
  const go = () => router.push('/mixar' as never);
  const faces = fresh.slice(0, 3).map((s) => s.partner);
  return (
    <Pressable onPress={go} style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={t('Mixar: {line}. Abrir os teus Mixar', { line: e.line })}>
      <MixarBadge size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.title}>Mixar</Text>
        <Text style={[st.sub, e.hot && st.subHot]} numberOfLines={1}>{e.line}</Text>
      </View>
      <View style={st.faces} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {faces.map((p, i) => (
          <View key={p.username} style={[st.face, i > 0 && { marginLeft: -10 }]}>
            <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={26} />
          </View>
        ))}
      </View>
      <MixarDot inline label={t('Há novidades')} />
      <Icon name="chevron-right" size={16} color={colors.zinc500} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingHorizontal: 8, paddingVertical: 8, marginBottom: 4, borderWidth: 1, borderColor: colors.zinc100 },
  title: { fontSize: 15, fontWeight: '800', color: colors.zinc900 },
  sub: { fontSize: 13, color: colors.zinc500 },
  subHot: { color: colors.brand, fontWeight: '700' },
  faces: { flexDirection: 'row', alignItems: 'center' },
  face: { borderRadius: 15, borderWidth: 2, borderColor: '#fff' },
});
