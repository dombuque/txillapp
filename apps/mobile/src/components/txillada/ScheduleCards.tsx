import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { Sheet } from '@/components/Sheet';
import { Button } from '@/components/ui/Button';
import { UPCOMING_KEY, schedulesKey, txilladaApi, useTxilladaEnabled } from '@/lib/api.txillada';
import { useDesktop } from '@/lib/desktop';
import { navTap } from '@/lib/tapGuard';
import { colors } from '@/lib/theme';
import { fmtShort, remindersText, scheduleRoute, type NextTxillada, type ScheduledTxillada } from '@/lib/txilladaSchedule';
import { useClock, useRemindToggle } from './TxilladaSchedule';

/**
 * O cartão «Txillada agendada» do perfil (docs/txillada-agendar.md), por baixo da bio: o ícone da Txillada, o título, «Sáb.,
 * 20:00» e «Lembrar-me». No meu perfil diz «A tua Txillada agendada», leva ao cartão e, com mais agendamentos, mostra «Ver
 * todas (N)».
 */
export function NextTxilladaCard({ username, isMe, next }: { username: string; isMe: boolean; next?: NextTxillada | null }) {
  const router = useRouter();
  const on = useTxilladaEnabled();
  const now = useClock(60_000);
  const remind = useRemindToggle();
  const [all, setAll] = useState(false);
  // As minhas (para «Ver todas (N)» e para o cartão, se o perfil ainda não trouxer `nextTxillada`).
  const mine = useQuery({ queryKey: schedulesKey(null), queryFn: () => txilladaApi.schedules(), enabled: isMe && on, staleTime: 30_000, retry: false });
  const items = (mine.data?.items ?? []).filter((x) => x.status === 'scheduled');
  const shown: NextTxillada | null = next ?? (isMe && items[0] ? { id: items[0].id, startsAt: items[0].startsAt, title: items[0].title, reminded: false } : null);
  if (!on || !shown) return null;
  const open = (id: string) => { const to = scheduleRoute(id); if (navTap(to)) router.push(to as never); };
  const title = (shown.title ?? '').trim();
  return (
    <View style={{ marginTop: 14 }}>
      <Pressable
        onPress={() => open(shown.id)}
        style={(s) => [st.card, (s as { hovered?: boolean }).hovered && { backgroundColor: '#ffe4e8' }, s.pressed && { opacity: 0.9 }]}
        accessibilityRole="button"
        accessibilityLabel={`${isMe ? 'A tua Txillada agendada' : `Txillada agendada de @${username}`}: ${title ? `${title}, ` : ''}${fmtShort(shown.startsAt, now)}`}
      >
        <View style={st.icon}><Icon name="txillada" size={24} color="#fff" strokeWidth={2.1} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.label} numberOfLines={1}>{isMe ? 'A tua Txillada agendada' : 'Txillada agendada'}</Text>
          {title ? <Text style={st.title} numberOfLines={1}>{title}</Text> : null}
          <Text style={st.when} numberOfLines={1}>{fmtShort(shown.startsAt, now)}</Text>
        </View>
        {isMe ? (
          <Icon name="chevron-right" size={20} color={colors.zinc500} />
        ) : shown.reminded ? (
          <Button label="Lembrado" icon="check" kind="secondary" size="sm" onPress={() => void remind(shown.id, false)} accessibilityLabel="Vais ser lembrado. Toca para deixares de ser lembrado" />
        ) : (
          <Button label="Lembrar-me" icon="bell" size="sm" onPress={() => void remind(shown.id, true)} />
        )}
      </Pressable>
      {isMe && items.length > 1 ? (
        <Pressable onPress={() => setAll(true)} hitSlop={8} style={st.all} accessibilityRole="button">
          <Text style={st.allText}>Ver todas ({items.length})</Text>
        </Pressable>
      ) : null}
      {all ? (
        <Sheet title="As tuas Txilladas agendadas" onClose={() => setAll(false)}>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 4 }}>
            {items.map((x) => (
              <Pressable key={x.id} onPress={() => { setAll(false); open(x.id); }} style={(s) => [st.row, (s as { hovered?: boolean }).hovered && { backgroundColor: colors.zinc50 }, s.pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
                <View style={[st.icon, { width: 40, height: 40, borderRadius: 20 }]}><Icon name="calendar" size={20} color="#fff" strokeWidth={2.1} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.title} numberOfLines={1}>{(x.title ?? '').trim() || 'Sem título'}</Text>
                  <Text style={st.when} numberOfLines={1}>{`${fmtShort(x.startsAt, now)} · ${remindersText(x.reminders)}`}</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.zinc500} />
              </Pressable>
            ))}
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}

/**
 * «Em breve», no Início, por baixo da fila dos mimos (sem mexer nela): as Txilladas agendadas das próximas 48 h de quem
 * sigo, em cartões pequenos com a hora e «Lembrar-me». Sem nenhuma, não aparece.
 */
export function UpcomingRow() {
  const router = useRouter();
  const on = useTxilladaEnabled();
  const now = useClock(60_000);
  const remind = useRemindToggle();
  const desktop = useDesktop();
  const q = useQuery({ queryKey: UPCOMING_KEY, queryFn: txilladaApi.upcoming, enabled: on, staleTime: 60_000, refetchInterval: 5 * 60_000, retry: false });
  // Volta-se ao Início: a fila põe-se em dia (na primeira vez não: o useQuery acabou de pedir).
  const once = useRef(false);
  const refetch = q.refetch;
  useFocusEffect(useCallback(() => {
    if (once.current && on) void refetch();
    once.current = true;
  }, [refetch, on]));
  const items = (q.data?.items ?? []).filter((x: ScheduledTxillada) => x.status === 'scheduled' && !x.isHost);
  if (!on || !items.length) return null;
  const open = (id: string) => { const to = scheduleRoute(id); if (navTap(to)) router.push(to as never); };
  return (
    <View style={{ marginBottom: 16 }} accessibilityLabel="Txilladas em breve">
      <View style={st.head}>
        <Icon name="calendar" size={16} color={colors.brand} strokeWidth={2.2} />
        <Text style={st.headText}>Em breve</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={desktop} contentContainerStyle={st.rowList}>
        {items.map((x) => {
          const title = (x.title ?? '').trim();
          return (
            <Pressable key={x.id} onPress={() => open(x.id)} style={(s) => [st.small, (s as { hovered?: boolean }).hovered && { borderColor: colors.zinc300 }, s.pressed && { opacity: 0.9 }]} accessibilityRole="button" accessibilityLabel={`Txillada de @${x.host.username}, ${fmtShort(x.startsAt, now)}${title ? `: ${title}` : ''}`}>
              <View style={st.who}>
                <Avatar name={x.host.displayName} username={x.host.avatarUrl ? x.host.username : undefined} size={34} />
                <NameWithBadge name={x.host.username} who={x.host} style={st.whoName} containerStyle={{ flex: 1, minWidth: 0 }} size={12} />
              </View>
              <Text style={st.smallWhen} numberOfLines={1}>{fmtShort(x.startsAt, now)}</Text>
              <Text style={st.smallTitle} numberOfLines={1}>{title || 'Txillada'}</Text>
              {x.reminded
                ? <Button label="Lembrado" icon="check" kind="secondary" size="sm" block onPress={() => void remind(x.id, false)} accessibilityLabel="Vais ser lembrado. Toca para deixares de ser lembrado" />
                : <Button label="Lembrar-me" icon="bell" size="sm" block onPress={() => void remind(x.id, true)} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, backgroundColor: colors.rose50, paddingVertical: 12, paddingLeft: 12, paddingRight: 12 },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '800', color: colors.brand, letterSpacing: 0.2 },
  title: { fontSize: 15, fontWeight: '700', color: colors.zinc900, marginTop: 1 },
  when: { fontSize: 13, color: colors.zinc600, marginTop: 1, fontVariant: ['tabular-nums'] },
  all: { alignSelf: 'flex-start', marginTop: 8, marginLeft: 4 },
  allText: { fontSize: 14, fontWeight: '700', color: colors.brand },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginBottom: 8 },
  headText: { fontSize: 15, fontWeight: '800', color: colors.zinc900 },
  rowList: { paddingHorizontal: 16, gap: 10 },
  small: { width: 168, borderRadius: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.zinc200, padding: 12, gap: 4 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  whoName: { fontSize: 13, fontWeight: '700', color: colors.zinc900 },
  smallWhen: { fontSize: 14, fontWeight: '800', color: colors.brand, fontVariant: ['tabular-nums'] },
  smallTitle: { fontSize: 13, color: colors.zinc600, marginBottom: 6 },
});
