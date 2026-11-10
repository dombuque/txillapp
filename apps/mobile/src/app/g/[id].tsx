import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { AccessBadge, JoinButton, usePublicGroup } from '@/components/groups/GroupJoin';
import { GroupCover } from '@/components/groups/GroupParts';
import { ApiError } from '@/lib/api';
import { countdown, dateRange, kindInfo } from '@/lib/api.groups';
import { abs, sized } from '@/lib/config';
import { joinModeOf } from '@/lib/groupAccess';
import { colors } from '@/lib/theme';

/**
 * Página pública de um TxillGroup (para quem não está no grupo): capa, foto, nome, tipo, descrição, plano e quantos são,
 * e o botão para entrar (público) ou pedir para entrar (privado visível no mapa). As conversas e o resto ficam só para o grupo.
 */
export default function PublicGroupPage() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = usePublicGroup(id);
  const g = q.data;
  const openChat = () => router.replace(`/messages/g/${id}` as never);

  if (q.isLoading) {
    return <StackPage title="TxillGroup"><View style={st.center}><ActivityIndicator color={colors.brand} /></View></StackPage>;
  }
  // Um 404/403 a meio (ex.: bloqueio ou o grupo ficou privado depois de abrir a página) ganha à página que estava em cache.
  const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
  if (!g || gone) {
    return (
      <StackPage title="TxillGroup">
        <View style={st.center} accessibilityRole="alert">
          <Icon name={gone ? 'lock' : 'alert'} size={36} color={colors.zinc300} />
          <Text style={st.emptyTitle}>{gone ? 'Este grupo é privado ou já não existe.' : 'Não consegui abrir o grupo.'}</Text>
          {!gone && (
            <Pressable onPress={() => void q.refetch()} style={st.ghost} accessibilityRole="button"><Text style={st.ghostText}>Tentar outra vez</Text></Pressable>
          )}
        </View>
      </StackPage>
    );
  }

  const kind = kindInfo(g.groupKind);
  const cover = g.coverUrl ? abs(g.coverUrl) ?? g.coverUrl : null;
  const when = dateRange(g.startsOn, g.endsOn);
  const soon = countdown(g.startsOn, g.endsOn);
  const hasPlan = !!(g.destination || g.venueName || when);

  return (
    <StackPage title={g.name}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <View style={st.cover}>
          <Icon name={kind.icon} size={40} color="rgba(255,255,255,0.75)" />
          {cover ? <Image source={{ uri: sized(cover, 1080) }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={`Capa de ${g.name}`} /> : null}
        </View>
        <View style={st.avatarWrap}>
          <View style={st.avatarRing}><GroupCover url={g.avatarUrl ?? g.coverUrl} kind={g.groupKind} size={84} radius={42} /></View>
        </View>
        <View style={{ paddingHorizontal: 16, gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Text style={st.title} accessibilityRole="header">{g.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <AccessBadge visibility={g.visibility} />
              <View style={st.meta}>
                <Icon name={kind.icon} size={14} color={colors.zinc600} />
                <Text style={st.metaText}>{kind.label}</Text>
              </View>
              <View style={st.meta}>
                <Icon name="users" size={14} color={colors.zinc600} />
                <Text style={st.metaText}>{g.members} {g.members === 1 ? 'membro' : 'membros'}</Text>
              </View>
            </View>
          </View>

          {g.description ? <Text style={st.desc}>{g.description}</Text> : null}

          {hasPlan ? (
            <View style={st.plan} accessibilityLabel="Plano">
              <Text style={st.planTitle}>Plano</Text>
              {g.destination ? <PlanLine icon="map" text={g.destination} /> : null}
              {g.venueName ? <PlanLine icon="map-pin" text={g.venueName} /> : null}
              {when ? <PlanLine icon="calendar" text={soon ? `${when} · ${soon}` : when} /> : null}
            </View>
          ) : null}

          <JoinButton groupId={id} mode={joinModeOf(g)} me={g.me} onOpen={openChat} />
        </View>
      </ScrollView>
    </StackPage>
  );
}

function PlanLine({ icon, text }: { icon: 'map' | 'map-pin' | 'calendar'; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name={icon} size={16} color={colors.brand} />
      <Text style={st.planText}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  ghost: { height: 40, paddingHorizontal: 18, borderRadius: 999, backgroundColor: colors.zinc100, justifyContent: 'center' },
  ghostText: { fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  cover: { width: '100%', aspectRatio: 2, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarWrap: { paddingHorizontal: 16, marginTop: -42, marginBottom: 8 },
  avatarRing: { alignSelf: 'flex-start', borderRadius: 46, borderWidth: 4, borderColor: colors.white, backgroundColor: colors.white },
  title: { fontSize: 24, fontWeight: '800', color: colors.zinc900 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, fontWeight: '600', color: colors.zinc600 },
  desc: { fontSize: 15, lineHeight: 22, color: colors.zinc800 },
  plan: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: colors.zinc100 },
  planTitle: { fontSize: 15, fontWeight: '800', color: colors.zinc900 },
  planText: { flex: 1, fontSize: 14, color: colors.zinc800 },
});
