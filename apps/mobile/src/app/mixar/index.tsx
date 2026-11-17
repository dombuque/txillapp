import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { GroupAvatars, MixarBadge, MixarDot, PairAvatars } from '@/components/mixar/MixarBits';
import { useMixarList } from '@/components/mixar/MixarEntry';
import { MixarSuggestions } from '@/components/mixar/MixarSuggestions';
import { mixarApi, mixarKeys, type MixarGroupSummary, type MixarSummary } from '@/lib/api.mixar';
import { useAuth } from '@/lib/auth';
import { firstName, mixarErrorText, mixarShowDot, sortSummaries, summaryLine } from '@/lib/mixar';
import { useMixarSeen } from '@/lib/mixarSeen';
import { groupShowDot, groupSummaryLine } from '@/lib/mixarGrupo';
import { MIXAR_PREVIEW_ID, isMixarPreview } from '@/lib/mixarPreview';
import { colors } from '@/lib/theme';

/**
 * Os meus Mixar: os convites que recebi (Aceitar / Agora não), os Mixar ativos (com os «novos hoje» e o desafio à espera)
 * e os convites que mandei (à espera). Sem nenhum, explica o que é e como começar. Os Mixar de grupo (0173) têm a sua
 * secção, «Os vossos Mixar de grupo» (com «Entrar» e «Agora não» enquanto não respondi).
 */
export default function MixarList() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useMixarList();
  const seen = useMixarSeen();
  const [busy, setBusy] = useState<string | null>(null);
  const groups = sortSummaries(q.data?.items ?? []);
  const groupMixars = q.data?.groups ?? [];
  const empty = !!q.data && !q.data.items.length && !groupMixars.length;
  const me = { name: firstName(user?.displayName), username: user?.username };

  async function answer(s: MixarSummary, yes: boolean, group = false) {
    if (busy) return;
    setBusy(s.id);
    try {
      if (yes) {
        const m = await mixarApi.accept(s.id);
        qc.setQueryData(mixarKeys.one(m.id), m);
        router.push(`/mixar/${s.id}` as never);
      } else {
        await mixarApi.decline(s.id);
      }
      void qc.invalidateQueries({ queryKey: mixarKeys.list() });
      if (!group) void qc.invalidateQueries({ queryKey: ['chat-thread', s.partner.username] });
    } catch (e) {
      Alert.alert('Não deu', mixarErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  const row = (s: MixarSummary, kind: 'active' | 'received' | 'sent') => {
    const partner = { name: firstName(s.partner.displayName), username: s.partner.hasAvatar ? s.partner.username : undefined };
    const hot = kind === 'active' && (s.newToday > 0 || s.challengePending);
    const fresh = mixarShowDot(s, seen[s.id]);
    return (
      <View key={s.id} style={st.card}>
        <Pressable onPress={() => router.push(`/mixar/${s.id}` as never)} style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={`${s.name}. ${summaryLine(s, partner.name)}`}>
          {kind === 'active' ? <PairAvatars me={me} them={partner} size={40} /> : <Avatar name={s.partner.displayName} username={partner.username} size={48} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <NameWithBadge name={kind === 'active' ? s.name : s.partner.displayName} who={s.partner} style={st.name} />
            <Text style={[st.sub, hot && st.subHot]} numberOfLines={1}>{summaryLine(s, partner.name)}</Text>
          </View>
          {kind === 'active' && s.challengePending ? <Icon name="sparkles" size={18} color={colors.brand} /> : null}
          {fresh ? <MixarDot inline label="Há novidades" /> : null}
          <Icon name="chevron-right" size={16} color={colors.zinc500} />
        </Pressable>
        {kind === 'received' ? (
          <View style={st.actions}>
            <Pressable onPress={() => void answer(s, true)} disabled={!!busy} style={({ pressed }) => [st.btn, st.primary, pressed && { opacity: 0.8 }, !!busy && busy !== s.id && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`Aceitar o Mixar com ${partner.name}`}>
              {busy === s.id ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryText}>Aceitar</Text>}
            </Pressable>
            <Pressable onPress={() => void answer(s, false)} disabled={!!busy} style={({ pressed }) => [st.btn, st.ghost, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`Agora não: recusar o Mixar com ${partner.name}`}>
              <Text style={st.ghostText}>Agora não</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  /** Um Mixar de grupo: as caras de quem está, o nome do grupo e o que há; sem ter respondido, «Entrar» e «Agora não». */
  const groupRow = (s: MixarGroupSummary) => {
    const g = s.group;
    const line = groupSummaryLine(s);
    const hot = g.myState === 'in' && s.status === 'active' && (s.newToday > 0 || s.challengePending);
    const ask = g.myState === null && g.canJoin;
    return (
      <View key={s.id} style={st.card}>
        <Pressable onPress={() => router.push(`/mixar/${s.id}` as never)} style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={`Mixar de ${g.groupName}. ${line}`}>
          <GroupAvatars people={g.people.length ? g.people : g.proposedBy ? [g.proposedBy] : []} size={34} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.name} numberOfLines={1}>{g.groupName}</Text>
            <Text style={[st.sub, hot && st.subHot]} numberOfLines={1}>{line}</Text>
          </View>
          {hot && s.challengePending ? <Icon name="sparkles" size={18} color={colors.brand} /> : null}
          {groupShowDot(s, seen[s.id]) ? <MixarDot inline label="Há novidades" /> : null}
          <Icon name="chevron-right" size={16} color={colors.zinc500} />
        </Pressable>
        {ask ? (
          <View style={st.actions}>
            <Pressable onPress={() => void answer(s, true, true)} disabled={!!busy} style={({ pressed }) => [st.btn, st.primary, pressed && { opacity: 0.8 }, !!busy && busy !== s.id && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`Entrar no Mixar de ${g.groupName}`}>
              {busy === s.id ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryText}>Entrar</Text>}
            </Pressable>
            <Pressable onPress={() => void answer(s, false, true)} disabled={!!busy} style={({ pressed }) => [st.btn, st.ghost, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`Agora não: não entrar no Mixar de ${g.groupName}`}>
              <Text style={st.ghostText}>Agora não</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <StackPage title="Mixar">
      <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}>
        <View style={st.intro}>
          <MixarBadge size={44} />
          <Text style={st.introText}>Um feed a dois: juntam os gostos e recebem todos os dias, às 05:00, uma seleção que tem a ver com os dois.</Text>
        </View>

        {q.isPending ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
        {q.isError ? (
          <View style={st.empty} accessibilityRole="alert">
            <Icon name="alert" size={40} color={colors.zinc300} />
            <Text style={st.emptyTitle}>Não consegui carregar os teus Mixar</Text>
            <Pressable onPress={() => void q.refetch()} style={[st.btn, st.primary, { marginTop: 14, paddingHorizontal: 24 }]} accessibilityRole="button"><Text style={st.primaryText}>Tentar outra vez</Text></Pressable>
          </View>
        ) : null}

        {groups.received.length ? <Text style={st.section}>Convites</Text> : null}
        {groups.received.map((s) => row(s, 'received'))}
        {groups.active.length ? <Text style={st.section}>Os teus Mixar</Text> : null}
        {groups.active.map((s) => row(s, 'active'))}
        {groups.sent.length ? <Text style={st.section}>À espera de resposta</Text> : null}
        {groups.sent.map((s) => row(s, 'sent'))}
        {groupMixars.length ? <Text style={st.section}>Os vossos Mixar de grupo</Text> : null}
        {groupMixars.map(groupRow)}

        {empty ? (
          <View style={st.empty}>
            <Text style={st.emptyTitle}>Ainda não tens nenhum Mixar</Text>
            <Text style={st.emptySub}>Abre uma conversa e toca em «⋯» ou no «+» e escolhe «Mixar». Quando a pessoa aceitar, o vosso feed a dois começa. Num grupo de 3 a 5 pessoas, toca no ícone do Mixar no cabeçalho do grupo.</Text>
            <Pressable onPress={() => router.navigate('/messages' as never)} style={[st.btn, st.primary, { marginTop: 16, paddingHorizontal: 24 }]} accessibilityRole="button"><Text style={st.primaryText}>Ir às mensagens</Text></Pressable>
          </View>
        ) : null}
        {/* «Faz um Mixar com…» (0170): quem fala muito comigo e tem gostos parecidos (também quando ainda não há nenhum Mixar). */}
        {q.isError ? null : <MixarSuggestions />}
        {/* Só em desenvolvimento: o Mixar de exemplo (lib/mixarPreview), para ver os ecrãs sem a API. */}
        {isMixarPreview(MIXAR_PREVIEW_ID) ? (
          <Pressable onPress={() => router.push(`/mixar/${MIXAR_PREVIEW_ID}` as never)} style={st.dev} accessibilityRole="button">
            <Text style={st.devText}>Ver um Mixar de exemplo (só em desenvolvimento)</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 40 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, backgroundColor: colors.rose50, padding: 14, marginBottom: 8 },
  introText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.zinc700 },
  section: { marginTop: 18, marginBottom: 6, paddingHorizontal: 4, fontSize: 12, fontWeight: '800', letterSpacing: 1, color: colors.zinc500, textTransform: 'uppercase' },
  card: { borderRadius: 18, borderWidth: 1, borderColor: colors.zinc100, marginBottom: 8, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12 },
  name: { fontSize: 16, fontWeight: '700', color: colors.zinc900, flexShrink: 1 },
  sub: { marginTop: 2, fontSize: 14, color: colors.zinc500 },
  subHot: { color: colors.brand, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  btn: { flex: 1, minHeight: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.brand },
  primaryText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  ghost: { borderWidth: 1, borderColor: colors.zinc300, backgroundColor: '#fff' },
  ghostText: { fontSize: 15, fontWeight: '600', color: colors.zinc800 },
  empty: { marginTop: 32, alignItems: 'center', paddingHorizontal: 16 },
  emptyTitle: { marginTop: 10, fontSize: 19, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  emptySub: { marginTop: 6, maxWidth: 340, fontSize: 15, lineHeight: 21, color: colors.zinc600, textAlign: 'center' },
  dev: { marginTop: 28, alignSelf: 'center', borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.zinc300, paddingHorizontal: 14, paddingVertical: 8 },
  devText: { fontSize: 13, color: colors.zinc600 },
});
