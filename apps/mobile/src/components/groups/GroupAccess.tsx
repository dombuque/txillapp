import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { ApiError } from '@/lib/api';
import { groupKeys, groupsApi, type JoinRequest, type TxillGroupInfo } from '@/lib/api.groups';
import { ACCESS_OPTIONS, accessBody, accessChange, accessLabel, accessOf, mapWarning, showRequests, type GroupAccess } from '@/lib/groupAccess';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { ConfirmSheet, ErrText, Pill } from './GroupParts';

const ICON: Record<GroupAccess, IconName> = { private: 'lock', map: 'map-pin', public: 'globe' };

/**
 * Quem vê e quem entra (nos detalhes do grupo). Administradores escolhem entre Privado, Privado visível no mapa e Público,
 * e respondem aos pedidos para entrar; os outros membros só veem o estado. Tocar numa opção só a marca: grava-se em "Guardar",
 * depois de uma confirmação com o que muda.
 */
export function GroupAccessSection({ group, onChanged }: { group: TxillGroupInfo; onChanged: () => void }) {
  const qc = useQueryClient();
  const admin = group.myRole === 'admin';
  const server = accessOf(group);
  // `saved` = o que está gravado (o servidor, ou o que acabámos de gravar enquanto o grupo não se atualiza); `access` = o que está marcado.
  const [saved, setSaved] = useState<GroupAccess>(server);
  const [access, setAccess] = useState<GroupAccess>(server);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setSaved(server); setAccess(server); }, [server]);
  // O mapa precisa de um local no Plano (o PlanPanel usa a mesma query, por isso costuma já estar em cache).
  const plan = useQuery({ queryKey: groupKeys.plan(group.id), queryFn: () => groupsApi.plan(group.id), enabled: admin, staleTime: 30_000 });
  // Os pedidos à espera: a lista (só se já estiver em cache; quem a carrega é a secção dos pedidos) é mais certa do que o número do grupo.
  const requests = useQuery({ queryKey: groupKeys.joinRequests(group.id), queryFn: () => groupsApi.joinRequests(group.id), enabled: false });
  const pending = requests.data?.length ?? group.pendingRequests;

  if (!admin) {
    return (
      <View style={s.status} accessibilityLabel={accessLabel(server)}>
        <Icon name={ICON[server]} size={16} color={colors.zinc600} />
        <Text style={s.statusText}>{accessLabel(server)}</Text>
      </View>
    );
  }

  // Tocar numa opção só a marca; grava-se em "Guardar" → confirmação → "Confirmar".
  function pick(a: GroupAccess) {
    if (busy) return;
    setErr('');
    setAccess(a);
  }
  function cancel() {
    setErr('');
    setAccess(saved);
  }
  async function save() {
    const a = access;
    setBusy(true);
    try {
      await groupsApi.setAccess(group.id, accessBody(a));
      setSaved(a);
      setErr('');
      void qc.invalidateQueries({ queryKey: groupKeys.joinRequests(group.id) });
      void qc.invalidateQueries({ queryKey: ['nearby'] });
      onChanged();
    } catch (e) {
      // A escolha volta ao que está gravado (a confirmação fecha-se) e a mensagem do servidor fica por baixo das opções.
      setAccess(saved);
      setErr((e as Error).message || 'Não consegui mudar. Tenta outra vez.');
      throw e;
    } finally {
      setBusy(false);
    }
  }

  const change = accessChange(saved, access, pending);
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
              onPress={() => pick(o.id)}
              disabled={busy}
              style={({ pressed }) => [s.opt, on && s.optOn, busy && { opacity: 0.6 }, pressed && !on && { backgroundColor: colors.zinc100 }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: busy }}
              accessibilityLabel={`${o.title}${o.id === saved ? ' (atual)' : ''}. ${o.text}`}
            >
              <Icon name={ICON[o.id]} size={20} color={on ? colors.brand : colors.zinc600} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.optTitle}>{o.title}{o.id === saved && access !== saved ? <Text style={s.optNow}>  · atual</Text> : null}</Text>
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
      {change ? (
        <View style={s.change} accessibilityLiveRegion="polite">
          <Text style={s.changeText}>{change.summary}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pill label="Cancelar" kind="soft" onPress={cancel} disabled={busy} style={{ flex: 1 }} />
            <Pill label="Guardar" busy={busy} onPress={() => { setErr(''); setAsking(true); }} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}
      <ErrText text={err} />
      {showRequests(saved, group.pendingRequests) ? <JoinRequests groupId={group.id} hint={group.pendingRequests} onChanged={onChanged} /> : null}
      {asking && change ? (
        <ConfirmSheet title={change.title} lines={change.lines} hint={change.hint} onConfirm={save} onClose={() => setAsking(false)} />
      ) : null}
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
  optNow: { fontSize: 13, fontWeight: '600', color: colors.zinc500 },
  change: { gap: 10, padding: 12, borderRadius: 16, backgroundColor: colors.zinc100 },
  changeText: { fontSize: 14, lineHeight: 20, color: colors.zinc800 },
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
