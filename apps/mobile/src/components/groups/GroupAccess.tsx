import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { ApiError } from '@/lib/api';
import { groupKeys, groupsApi, type JoinRequest, type TxillGroupInfo } from '@/lib/api.groups';
import { ACCESS_OPTIONS, accessBody, accessLabel, accessOf, mapWarning, showRequests, type GroupAccess } from '@/lib/groupAccess';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { ErrText } from './GroupParts';

const ICON: Record<GroupAccess, IconName> = { private: 'lock', map: 'map-pin', public: 'globe' };

/**
 * Quem vê e quem entra (nos detalhes do grupo). Administradores escolhem entre Privado, Privado visível no mapa e Público,
 * e respondem aos pedidos para entrar; os outros membros só veem o estado.
 */
export function GroupAccessSection({ group, onChanged }: { group: TxillGroupInfo; onChanged: () => void }) {
  const admin = group.myRole === 'admin';
  const server = accessOf(group);
  const [access, setAccess] = useState<GroupAccess>(server);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => setAccess(server), [server]);
  // O mapa precisa de um local no Plano (o PlanPanel usa a mesma query, por isso costuma já estar em cache).
  const plan = useQuery({ queryKey: groupKeys.plan(group.id), queryFn: () => groupsApi.plan(group.id), enabled: admin, staleTime: 30_000 });

  if (!admin) {
    return (
      <View style={s.status} accessibilityLabel={accessLabel(server)}>
        <Icon name={ICON[server]} size={16} color={colors.zinc600} />
        <Text style={s.statusText}>{accessLabel(server)}</Text>
      </View>
    );
  }

  async function pick(a: GroupAccess) {
    if (a === access || busy) return;
    const before = access;
    setAccess(a);
    setBusy(true);
    setErr('');
    try {
      await groupsApi.setAccess(group.id, accessBody(a));
      onChanged();
    } catch (e) {
      setAccess(before);
      setErr((e as Error).message || 'Não consegui mudar. Tenta outra vez.');
    } finally {
      setBusy(false);
    }
  }

  const warn = mapWarning(access, plan.data ? !!plan.data.venue : null);
  return (
    <View style={{ gap: 8, marginBottom: 8 }}>
      <Text style={s.head}>QUEM VÊ E QUEM ENTRA</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Quem vê e quem entra no grupo" style={{ gap: 8 }}>
        {ACCESS_OPTIONS.map((o) => {
          const on = o.id === access;
          return (
            <Pressable
              key={o.id}
              onPress={() => void pick(o.id)}
              disabled={busy}
              style={({ pressed }) => [s.opt, on && s.optOn, pressed && !on && { backgroundColor: colors.zinc100 }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: busy }}
              accessibilityLabel={`${o.title}. ${o.text}`}
            >
              <Icon name={ICON[o.id]} size={20} color={on ? colors.brand : colors.zinc600} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.optTitle}>{o.title}</Text>
                <Text style={s.optText}>{o.text}</Text>
              </View>
              <View style={[s.radio, on && { borderColor: colors.brand }]}>{on && <View style={s.radioDot} />}</View>
            </Pressable>
          );
        })}
      </View>
      {warn ? (
        <View style={s.warn} accessibilityRole="alert">
          <Icon name="info" size={16} color="#92400e" />
          <Text style={s.warnText}>{warn}</Text>
        </View>
      ) : null}
      <ErrText text={err} />
      {showRequests(access, group.pendingRequests) ? <JoinRequests groupId={group.id} hint={group.pendingRequests} onChanged={onChanged} /> : null}
    </View>
  );
}

/** "Pedidos para entrar": Aceitar / Recusar por pessoa. */
function JoinRequests({ groupId, hint, onChanged }: { groupId: string; hint?: number; onChanged: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: groupKeys.joinRequests(groupId), queryFn: () => groupsApi.joinRequests(groupId), staleTime: 10_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const list = q.data ?? [];
  const count = q.data ? list.length : hint ?? 0;

  async function answer(r: JoinRequest, accept: boolean) {
    setBusy(r.username);
    setErr('');
    try {
      await (accept ? groupsApi.acceptJoin(groupId, r.username) : groupsApi.declineJoin(groupId, r.username));
    } catch (e) {
      // 404/409: o pedido já foi respondido (por outro administrador) ou foi cancelado; sai da lista na mesma.
      if (!(e instanceof ApiError && (e.status === 404 || e.status === 409))) {
        setErr((e as Error).message || 'Não consegui responder. Tenta outra vez.');
        setBusy(null);
        return;
      }
    }
    qc.setQueryData<JoinRequest[]>(groupKeys.joinRequests(groupId), (l) => l?.filter((x) => x.username !== r.username));
    setBusy(null);
    void qc.invalidateQueries({ queryKey: groupKeys.joinRequests(groupId) });
    void qc.invalidateQueries({ queryKey: ['chat-groups'] });
    onChanged();
  }

  return (
    <View style={{ gap: 4, marginTop: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={s.head}>PEDIDOS PARA ENTRAR</Text>
        {count > 0 && <View style={s.count}><Text style={s.countText}>{count}</Text></View>}
      </View>
      {q.isLoading ? (
        <Text style={s.none}>A carregar…</Text>
      ) : q.isError ? (
        <Pressable onPress={() => void q.refetch()} accessibilityRole="button"><Text style={s.none}>Não consegui carregar os pedidos. Toca para tentar outra vez.</Text></Pressable>
      ) : list.length === 0 ? (
        <Text style={s.none}>Sem pedidos por agora.</Text>
      ) : (
        list.map((r) => (
          <View key={r.username} style={s.req}>
            <Avatar name={r.displayName} username={r.avatarUrl ? r.username : undefined} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.reqName} numberOfLines={1}>{r.displayName}</Text>
              <Text style={s.reqSub} numberOfLines={1}>@{r.username} · {timeAgo(r.createdAt)}</Text>
            </View>
            <Pressable disabled={!!busy} onPress={() => void answer(r, true)} style={[s.accept, busy === r.username && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`Aceitar ${r.displayName}`}>
              <Text style={s.acceptText}>Aceitar</Text>
            </Pressable>
            <Pressable disabled={!!busy} onPress={() => void answer(r, false)} style={[s.decline, busy === r.username && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`Recusar ${r.displayName}`}>
              <Text style={s.declineText}>Recusar</Text>
            </Pressable>
          </View>
        ))
      )}
      <ErrText text={err} />
    </View>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: 4, paddingTop: 8, fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.zinc500 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200 },
  optOn: { borderColor: colors.brand, backgroundColor: colors.rose50 },
  optTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  optText: { marginTop: 2, fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 12, backgroundColor: '#fffbeb' },
  warnText: { flex: 1, fontSize: 13, lineHeight: 18, color: '#92400e' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 6, marginBottom: 4 },
  statusText: { fontSize: 14, fontWeight: '600', color: colors.zinc700 },
  count: { marginTop: 8, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  none: { paddingHorizontal: 4, paddingVertical: 6, fontSize: 14, color: colors.zinc500 },
  req: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  reqName: { fontSize: 15, fontWeight: '600', color: colors.zinc900 },
  reqSub: { fontSize: 13, color: colors.zinc500 },
  accept: { borderRadius: 12, backgroundColor: colors.brand, paddingHorizontal: 14, paddingVertical: 8 },
  acceptText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  decline: { borderRadius: 12, backgroundColor: colors.zinc100, paddingHorizontal: 14, paddingVertical: 8 },
  declineText: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
});
