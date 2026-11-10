import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Sheet } from '@/components/Sheet';
import { api } from '@/lib/api';
import { newKey } from '@/lib/api.extra';
import { groupKeys, groupsApi, txills, type PotView, type VenueHit, type VenueRef } from '@/lib/api.groups';
import { abs, sized } from '@/lib/config';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { ConfirmSheet, ErrText, Field, Pill, Section, VenuePickerSheet } from './GroupParts';

const PRESETS = [50, 100, 250, 500, 1000];
const intOf = (t: string) => {
  const n = Number(t.replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * A vaquinha de Txills do TxillGroup: saldo e meta, meter Txills da carteira, quem já meteu e, para quem administra,
 * a meta, o local escolhido (só locais que aceitam Txills), pagar ao local e devolver tudo.
 */
export function PotPanel({ groupId, me, admin: isAdmin }: { groupId: string; me: string; admin: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: groupKeys.pot(groupId), queryFn: () => groupsApi.pot(groupId), staleTime: 15_000 });
  const [sheet, setSheet] = useState<null | 'contribute' | 'goal' | 'venue' | 'pay' | 'refund'>(null);
  // Trocar o local da vaquinha muda para onde vão os Txills de toda a malta: escolhe-se na lista e confirma-se.
  const [venuePick, setVenuePick] = useState<VenueHit | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: groupKeys.pot(groupId) });
    void qc.invalidateQueries({ queryKey: groupKeys.plan(groupId) });
    void qc.invalidateQueries({ queryKey: ['chat-groups'] });
    void qc.invalidateQueries({ queryKey: ['chat-group', groupId] });
    void qc.invalidateQueries({ queryKey: ['wallet'] });
  };

  if (q.isLoading) return <View style={st.center}><ActivityIndicator color={colors.zinc500} /></View>;
  if (!q.data) {
    return (
      <View style={st.center}>
        <Text style={st.muted}>{(q.error as Error | null)?.message || 'Não consegui abrir os Txills do TxillGroup.'}</Text>
        <Pill label="Tentar outra vez" kind="soft" small onPress={() => void q.refetch()} style={{ marginTop: 12 }} />
      </View>
    );
  }
  const pot = q.data;
  const admin = pot.canManage ?? isAdmin;
  const pct = pot.goal ? Math.min(100, Math.round((pot.balance / pot.goal) * 100)) : 0;
  const mine = pot.totalByMember.find((m) => m.username === me)?.amount ?? 0;
  const ranking = [...pot.totalByMember].filter((m) => m.amount > 0).sort((a, b) => b.amount - a.amount);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#fafafa' }} contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
      <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.hero}>
        <Text style={st.heroLabel}>Txills do TxillGroup</Text>
        <Text style={st.heroValue}>{pot.balance.toLocaleString('pt-PT')}</Text>
        {pot.goal ? (
          <View style={{ marginTop: 10 }}>
            <View style={st.track}><View style={[st.fill, { width: `${pct}%` }]} /></View>
            <Text style={st.heroSub}>{pct}% da meta de {txills(pot.goal)}{pot.balance >= pot.goal ? ' · meta batida!' : ` · faltam ${(pot.goal - pot.balance).toLocaleString('pt-PT')}`}</Text>
          </View>
        ) : (
          <Text style={st.heroSub}>{admin ? 'Sem meta. Põe uma para a malta saber até onde vai.' : 'Sem meta definida.'}</Text>
        )}
        {mine > 0 && <Text style={[st.heroSub, { marginTop: 4 }]}>Já meteste {txills(mine)}</Text>}
        <Pill label="Meter Txills" icon="plus" kind="soft" onPress={() => setSheet('contribute')} style={{ marginTop: 14, backgroundColor: '#fff' }} />
      </LinearGradient>

      <Section title="Para onde vão" icon="store" style={{ marginTop: 14 }} action={admin ? <Pill label={pot.venue ? 'Trocar' : 'Escolher'} kind="soft" small onPress={() => setSheet('venue')} /> : undefined}>
        {pot.venue ? (
          <VenueLine venue={pot.venue} onPress={() => router.push(`/v/${pot.venue!.slug}` as never)} />
        ) : (
          <Text style={st.muted}>{admin ? 'Escolhe o local (que aceite Txills) onde a malta vai gastar a vaquinha.' : 'Ainda sem local escolhido.'}</Text>
        )}
      </Section>

      {admin && (
        <Section title="Gerir" icon="settings">
          <View style={{ gap: 8 }}>
            <Pill label={pot.goal ? `Mudar a meta · ${txills(pot.goal)}` : 'Pôr uma meta'} kind="soft" icon="flag" onPress={() => setSheet('goal')} />
            <Pill label="Pagar ao local" icon="wallet" disabled={!pot.venue || pot.balance <= 0} onPress={() => setSheet('pay')} />
            {!pot.venue && <Text style={st.muted}>Para pagar, escolhe primeiro o local.</Text>}
            <Pill label="Devolver tudo a quem meteu" kind="danger" icon="undo" disabled={pot.balance <= 0} onPress={() => setSheet('refund')} />
          </View>
        </Section>
      )}

      {ranking.length > 0 && (
        <Section title="Quem já meteu" icon="users">
          {ranking.map((m) => (
            <View key={m.username} style={st.row}>
              <Avatar name={m.displayName} username={m.username} size={36} />
              <Text style={st.rowName} numberOfLines={1}>{m.username === me ? 'Tu' : m.displayName}</Text>
              <Text style={st.amount}>{txills(m.amount)}</Text>
            </View>
          ))}
        </Section>
      )}

      {pot.payments.length > 0 && (
        <Section title="Pagamentos" icon="wallet">
          {pot.payments.map((p, i) => (
            <View key={`${p.at}-${i}`} style={st.row}>
              <View style={st.payIcon}><Icon name="store" size={16} color={colors.zinc700} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.rowName} numberOfLines={1}>{p.venue?.name ?? 'Local'}</Text>
                <Text style={st.muted} numberOfLines={1}>{[p.note, p.by ? `por ${p.by.username === me ? 'ti' : p.by.displayName}` : null, timeAgo(p.at)].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={[st.amount, { color: colors.red600 }]}>-{p.amount.toLocaleString('pt-PT')}</Text>
            </View>
          ))}
        </Section>
      )}

      <Section title="Movimentos" icon="clock">
        {!pot.contributions.length ? (
          <Text style={st.muted}>Ainda ninguém meteu Txills. Abre tu a vaquinha.</Text>
        ) : pot.contributions.map((c, i) => (
          <View key={`${c.at}-${c.username}-${i}`} style={st.row}>
            <Avatar name={c.displayName} username={c.username} size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.rowName} numberOfLines={1}>{c.username === me ? 'Tu' : c.displayName}</Text>
              <Text style={st.muted}>{timeAgo(c.at)}</Text>
            </View>
            <Text style={st.amount}>+{c.amount.toLocaleString('pt-PT')}</Text>
          </View>
        ))}
        {(pot.refunds ?? []).map((r, i) => (
          <View key={`r-${r.at}-${i}`} style={st.row}>
            <View style={st.payIcon}><Icon name="undo" size={16} color={colors.zinc700} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.rowName} numberOfLines={1}>Devolução a quem meteu</Text>
              <Text style={st.muted}>{[r.by ? `por ${r.by.username === me ? 'ti' : r.by.displayName}` : null, timeAgo(r.at)].filter(Boolean).join(' · ')}</Text>
            </View>
            <Text style={[st.amount, { color: colors.zinc600 }]}>-{r.amount.toLocaleString('pt-PT')}</Text>
          </View>
        ))}
      </Section>

      {sheet === 'contribute' && <ContributeSheet groupId={groupId} onClose={() => setSheet(null)} onDone={refresh} />}
      {sheet === 'goal' && <GoalSheet groupId={groupId} goal={pot.goal} onClose={() => setSheet(null)} onDone={refresh} />}
      {sheet === 'venue' && <VenuePickerSheet title="Local da vaquinha" txillsOnly onPick={(v) => setVenuePick(v)} onClose={() => setSheet(null)} />}
      {venuePick && (
        <ConfirmSheet
          title={`Usar ${venuePick.name} na vaquinha?`}
          lines={[pot.venue ? `Os Txills do TxillGroup passam a ser para ${venuePick.name} em vez de ${pot.venue.name}. Toda a malta vê a mudança.` : `Os Txills do TxillGroup passam a ser para ${venuePick.name}. Toda a malta vê o local escolhido.`]}
          onConfirm={async () => { await groupsApi.setPot(groupId, { venueSlug: venuePick.slug }); refresh(); }}
          onClose={() => setVenuePick(null)}
        />
      )}
      {sheet === 'pay' && pot.venue && <PaySheet groupId={groupId} pot={pot} venue={pot.venue} onClose={() => setSheet(null)} onDone={refresh} />}
      {sheet === 'refund' && <RefundSheet groupId={groupId} balance={pot.balance} onClose={() => setSheet(null)} onDone={refresh} />}
    </ScrollView>
  );
}

function VenueLine({ venue, onPress }: { venue: VenueRef; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [st.venue, pressed && { opacity: 0.8 }]} accessibilityRole="link">
      {venue.avatarUrl ? <Image source={{ uri: sized(abs(venue.avatarUrl) ?? venue.avatarUrl, 120) }} style={{ width: 40, height: 40, borderRadius: 12 }} /> : <View style={st.payIcon}><Icon name="store" size={18} color={colors.zinc600} /></View>}
      <Text style={[st.rowName, { flex: 1 }]} numberOfLines={1}>{venue.name}</Text>
      <Icon name="chevron-right" size={18} color={colors.zinc500} />
    </Pressable>
  );
}

/** Meter Txills: mostra o saldo da carteira, escolhe o valor e confirma (a chave de idempotência fica fixa enquanto a folha está aberta). */
function ContributeSheet({ groupId, onClose, onDone }: { groupId: string; onClose: () => void; onDone: () => void }) {
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: api.wallet, staleTime: 10_000 });
  const key = useRef(newKey());
  const [amount, setAmount] = useState(100);
  const [custom, setCustom] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const balance = wallet.data?.balance;
  const value = custom ? intOf(custom) : amount;
  const short = balance != null && value > balance;
  const tooSmall = value > 0 && value < 10;
  async function go() {
    setBusy(true);
    setErr('');
    try {
      await groupsApi.contribute(groupId, value, key.current);
      setDone(true);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      key.current = newKey();
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  if (done) {
    return (
      <Sheet title="Feito" onClose={onClose}>
        <View style={{ paddingHorizontal: 24, alignItems: 'center', gap: 8 }}>
          <View style={st.okIcon}><Icon name="check" size={30} strokeWidth={3} color="#fff" /></View>
          <Text style={st.big}>{txills(value)} na vaquinha</Text>
          <Text style={[st.muted, { textAlign: 'center' }]}>A malta já vê. Obrigado por puxares pela malta.</Text>
          <Pill label="Fechar" onPress={onClose} style={{ alignSelf: 'stretch', marginTop: 8 }} />
        </View>
      </Sheet>
    );
  }
  return (
    <Sheet title="Meter Txills" onClose={onClose}>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <View style={st.walletRow}>
          <Icon name="wallet" size={18} color={colors.zinc700} />
          <Text style={{ flex: 1, fontSize: 15, color: colors.zinc700 }}>Na tua carteira</Text>
          <Text style={st.amount}>{balance == null ? (wallet.isLoading ? '…' : '?') : txills(balance)}</Text>
        </View>
        {!confirm ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PRESETS.map((p) => {
                const on = !custom && amount === p;
                return (
                  <Pressable key={p} onPress={() => { setCustom(''); setAmount(p); }} style={[st.preset, on && { backgroundColor: colors.brand }]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <Text style={[st.presetText, on && { color: '#fff' }]}>{p.toLocaleString('pt-PT')}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Field value={custom} onChangeText={(t) => setCustom(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={7} placeholder="Outro valor" accessibilityLabel="Outro valor em Txills" />
            {short && <Text style={[st.muted, { color: colors.red600 }]}>Não tens Txills suficientes. Carrega a carteira primeiro.</Text>}
            {tooSmall && <Text style={st.muted}>O mínimo são 10 Txills.</Text>}
            <ErrText text={err} />
            <Pill label={value ? `Meter ${txills(value)}` : 'Escolhe um valor'} disabled={!value || short || tooSmall || value > 100000} onPress={() => setConfirm(true)} />

          </>
        ) : (
          <>
            <Text style={st.big}>Meter {txills(value)}?</Text>
            <Text style={st.muted}>Saem da tua carteira para a vaquinha do TxillGroup. Só quem administra pode pagar ao local ou devolver.</Text>
            <ErrText text={err} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pill label="Voltar" kind="ghost" onPress={() => setConfirm(false)} />
              <Pill label="Confirmar" busy={busy} onPress={() => void go()} style={{ flex: 1 }} />
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}

function GoalSheet({ groupId, goal, onClose, onDone }: { groupId: string; goal: number | null; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(goal ? String(goal) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save(v: number | null) {
    setBusy(true);
    setErr('');
    try {
      await groupsApi.setPot(groupId, { goal: v });
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Sheet title="Meta da vaquinha" onClose={onClose}>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <Field value={text} onChangeText={(t) => setText(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={8} autoFocus placeholder="Quantos Txills?" accessibilityLabel="Meta em Txills" />
        <ErrText text={err} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {goal ? <Pill label="Tirar a meta" kind="ghost" disabled={busy} onPress={() => void save(null)} /> : null}
          <Pill label="Guardar" busy={busy} disabled={!intOf(text)} onPress={() => void save(intOf(text))} style={{ flex: 1 }} />
        </View>
      </View>
    </Sheet>
  );
}

function PaySheet({ groupId, pot, venue, onClose, onDone }: { groupId: string; pot: PotView; venue: VenueRef; onClose: () => void; onDone: () => void }) {
  const key = useRef(newKey());
  const [text, setText] = useState(String(pot.balance));
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const value = intOf(text);
  const over = value > pot.balance;
  async function go() {
    setBusy(true);
    setErr('');
    try {
      await groupsApi.pay(groupId, { venueSlug: venue.slug, amount: value, note: note.trim() }, key.current);
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      key.current = newKey();
      setConfirm(false);
      setBusy(false);
    }
  }
  return (
    <Sheet title={`Pagar a ${venue.name}`} onClose={onClose}>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        {!confirm ? (
          <>
            <Text style={st.muted}>Na vaquinha: {txills(pot.balance)}</Text>
            <Field value={text} onChangeText={(t) => setText(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={8} placeholder="Quantos Txills?" accessibilityLabel="Valor a pagar em Txills" />
            <Field value={note} onChangeText={setNote} maxLength={120} placeholder="Nota · ex.: Mesa de fim de ano" accessibilityLabel="Nota do pagamento" />
            {over && <Text style={[st.muted, { color: colors.red600 }]}>A vaquinha não tem tanto.</Text>}
            <ErrText text={err} />
            <Pill label={value ? `Pagar ${txills(value)}` : 'Escolhe um valor'} disabled={!value || over} onPress={() => setConfirm(true)} />
          </>
        ) : (
          <>
            <Text style={st.big}>Pagar {txills(value)} a {venue.name}?</Text>
            <Text style={st.muted}>Sai da vaquinha do TxillGroup e a malta vê o pagamento. Não dá para desfazer.</Text>
            <ErrText text={err} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pill label="Voltar" kind="ghost" onPress={() => setConfirm(false)} />
              <Pill label="Pagar" busy={busy} onPress={() => void go()} style={{ flex: 1 }} />
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}

function RefundSheet({ groupId, balance, onClose, onDone }: { groupId: string; balance: number; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true);
    setErr('');
    try {
      await groupsApi.refund(groupId);
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Sheet title="Devolver os Txills?" onClose={onClose}>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <Text style={{ fontSize: 16, lineHeight: 22, color: colors.zinc600 }}>Os {txills(balance)} da vaquinha voltam para a carteira de cada pessoa, na parte que meteu.</Text>
        <ErrText text={err} />
        <Pill label="Devolver" kind="danger" busy={busy} onPress={() => void go()} />
        <Pill label="Cancelar" kind="ghost" onPress={onClose} />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  muted: { fontSize: 13, color: colors.zinc500, lineHeight: 18 },
  hero: { borderRadius: 24, padding: 18 },
  heroLabel: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  heroValue: { fontSize: 40, lineHeight: 46, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'] },
  heroSub: { marginTop: 6, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.92)' },
  track: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: '#fff' },
  row: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  rowName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.zinc900 },
  amount: { fontSize: 15, fontWeight: '800', color: colors.zinc900, fontVariant: ['tabular-nums'] },
  payIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  venue: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: colors.zinc100, padding: 8 },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 14, paddingVertical: 12 },
  preset: { minWidth: 72, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  presetText: { fontSize: 16, fontWeight: '800', color: colors.zinc900 },
  big: { fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  okIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.green600, alignItems: 'center', justifyContent: 'center' },
});
