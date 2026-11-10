import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Sheet } from '@/components/Sheet';
import { abs, sized } from '@/lib/config';
import { countdown, dateRange, groupKeys, groupsApi, mzn, parseMzn, type ChecklistItem, type Expense, type GroupPlan, type Rsvp, type VenueHit, type VenueRef } from '@/lib/api.groups';
import { colors } from '@/lib/theme';
import { AvatarStack, ConfirmSheet, DateRangeSheet, ErrText, Field, MemberPickSheet, Pill, Section, VenuePickerSheet, type MiniPerson } from './GroupParts';
import { NewPollSheet, PollView, usePlan } from './PollCard';

const RSVP: { id: Rsvp; label: string; icon: IconName }[] = [
  { id: 'going', label: 'Vou', icon: 'check' },
  { id: 'maybe', label: 'Talvez', icon: 'clock' },
  { id: 'not_going', label: 'Não vou', icon: 'x' },
];

/**
 * O Plano do TxillGroup: destino (texto ou página de um local), datas, quem vem, sondagens, lista de coisas a tratar
 * e despesas com as contas feitas ("quem paga a quem"). Os controlos de admin só aparecem a quem administra.
 */
export function PlanPanel({ groupId, me, admin, members }: { groupId: string; me: string; admin: boolean; members: MiniPerson[] }) {
  const q = usePlan(groupId);
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: groupKeys.plan(groupId) });
    void qc.invalidateQueries({ queryKey: ['chat-groups'] });
    void qc.invalidateQueries({ queryKey: ['chat-group', groupId] });
  };
  if (q.isLoading) return <View style={st.center}><ActivityIndicator color={colors.zinc500} /></View>;
  if (!q.data) {
    return (
      <View style={st.center}>
        <Text style={st.muted}>{(q.error as Error | null)?.message || 'Não consegui abrir o Plano.'}</Text>
        <Pill label="Tentar outra vez" kind="soft" small onPress={() => void q.refetch()} style={{ marginTop: 12 }} />
      </View>
    );
  }
  const plan = q.data;
  const name = (u: string) => members.find((m) => m.username === u)?.displayName.split(' ')[0] ?? (u === me ? 'Tu' : `@${u}`);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#fafafa' }} contentContainerStyle={{ padding: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <WhereWhen groupId={groupId} plan={plan} admin={admin} onChanged={refresh} />
      <WhoComes groupId={groupId} plan={plan} me={me} onChanged={refresh} />
      <Polls groupId={groupId} plan={plan} me={me} admin={admin} />
      <Checklist groupId={groupId} items={plan.checklist} me={me} admin={admin} members={members} name={name} onChanged={refresh} />
      <Expenses groupId={groupId} plan={plan} me={me} admin={admin} members={members} name={name} onChanged={refresh} />
    </ScrollView>
  );
}

// ----- onde e quando -----
function WhereWhen({ groupId, plan, admin, onChanged }: { groupId: string; plan: GroupPlan; admin: boolean; onChanged: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [dates, setDates] = useState(false);
  const [err, setErr] = useState('');
  const when = dateRange(plan.startsOn, plan.endsOn);
  const left = countdown(plan.startsOn, plan.endsOn);
  async function saveDates(startsOn: string | null, endsOn: string | null) {
    setErr('');
    try {
      await groupsApi.setPlan(groupId, { startsOn, endsOn: endsOn ?? startsOn });
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const empty = !plan.destination && !plan.venue && !when;
  return (
    <Section title="Onde e quando" icon="map-pin" action={admin ? <Pill label="Editar" kind="soft" small icon="pencil" onPress={() => setEditing(true)} /> : undefined}>
      {empty ? (
        <Text style={st.muted}>{admin ? 'Ainda sem destino nem datas. Toca em Editar e põe a malta a sonhar.' : 'Ainda sem destino nem datas. Quem administra trata disso.'}</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {plan.destination ? <Text style={st.dest}>{plan.destination}</Text> : null}
          {plan.venue && <VenueRow venue={plan.venue} onPress={() => router.push(`/v/${plan.venue!.slug}` as never)} />}
          {when && (
            <Pressable onPress={admin ? () => setDates(true) : undefined} disabled={!admin} style={st.when} accessibilityRole={admin ? 'button' : undefined}>
              <Icon name="calendar" size={18} color={colors.zinc700} />
              <Text style={st.whenText}>{when}</Text>
              {left && <View style={st.badge}><Text style={st.badgeText}>{left}</Text></View>}
            </Pressable>
          )}
        </View>
      )}
      <ErrText text={err} />
      {editing && <PlanEditSheet groupId={groupId} plan={plan} onClose={() => setEditing(false)} onSaved={onChanged} />}
      {dates && <DateRangeSheet start={plan.startsOn} end={plan.endsOn} onSave={(a, b) => void saveDates(a, b)} onClose={() => setDates(false)} />}
    </Section>
  );
}

function VenueRow({ venue, onPress, right }: { venue: VenueRef | VenueHit; onPress?: () => void; right?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [st.venue, pressed && { opacity: 0.8 }]} accessibilityRole={onPress ? 'link' : undefined}>
      {venue.avatarUrl ? <Image source={{ uri: sized(abs(venue.avatarUrl) ?? venue.avatarUrl, 120) }} style={{ width: 40, height: 40, borderRadius: 12 }} /> : <View style={st.venueIcon}><Icon name="store" size={18} color={colors.zinc600} /></View>}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.zinc900 }} numberOfLines={1}>{venue.name}</Text>
        <Text style={st.muted} numberOfLines={1}>{onPress ? 'Ver a página do local' : `@${venue.slug}`}</Text>
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" size={18} color={colors.zinc500} /> : null)}
    </Pressable>
  );
}

function PlanEditSheet({ groupId, plan, onClose, onSaved }: { groupId: string; plan: GroupPlan; onClose: () => void; onSaved: () => void }) {
  const [destination, setDestination] = useState(plan.destination ?? '');
  const [venue, setVenue] = useState<VenueRef | VenueHit | null>(plan.venue);
  const [start, setStart] = useState(plan.startsOn);
  const [end, setEnd] = useState(plan.endsOn);
  const [picking, setPicking] = useState<null | 'venue' | 'dates'>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    setBusy(true);
    setErr('');
    try {
      await groupsApi.setPlan(groupId, { destination: destination.trim() || null, venueSlug: venue?.slug ?? null, startsOn: start, endsOn: end ?? start });
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  if (picking === 'venue') return <VenuePickerSheet title="Ligar a um local" onPick={(v) => { setVenue(v); if (!destination.trim()) setDestination((v.city ? `${v.name}, ${v.city}` : v.name).slice(0, 80)); }} onClose={() => setPicking(null)} />;
  if (picking === 'dates') return <DateRangeSheet start={start} end={end} onSave={(a, b) => { setStart(a); setEnd(b); }} onClose={() => setPicking(null)} />;
  return (
    <Sheet title="Onde e quando" onClose={onClose}>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <Field value={destination} onChangeText={setDestination} maxLength={80} placeholder="Destino · ex.: Tofo, Bilene, Ponta do Ouro" accessibilityLabel="Destino" />
        {venue ? (
          <VenueRow venue={venue} right={<Pressable onPress={() => setVenue(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Tirar o local"><Icon name="x" size={18} color={colors.zinc600} /></Pressable>} />
        ) : (
          <Pill label="Ligar a um local do Txillapp" icon="store" kind="soft" onPress={() => setPicking('venue')} />
        )}
        <Pill label={dateRange(start, end) ?? 'Escolher as datas'} icon="calendar" kind="soft" onPress={() => setPicking('dates')} />
        <ErrText text={err} />
        <Pill label="Guardar" busy={busy} onPress={() => void save()} />
      </View>
    </Sheet>
  );
}

// ----- quem vem -----
function WhoComes({ groupId, plan, me, onChanged }: { groupId: string; plan: GroupPlan; me: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const mine = plan.rsvps.find((r) => r.username === me)?.status ?? null;
  async function set(status: Rsvp) {
    setErr('');
    qc.setQueryData<GroupPlan>(groupKeys.plan(groupId), (p) => p && { ...p, rsvps: p.rsvps.some((r) => r.username === me) ? p.rsvps.map((r) => (r.username === me ? { ...r, status } : r)) : [...p.rsvps, { username: me, displayName: 'Tu', hasAvatar: false, status }] });
    try {
      await groupsApi.rsvp(groupId, status);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      onChanged();
    }
  }
  return (
    <Section title="Quem vem" icon="users">
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {RSVP.map((r) => {
          const on = mine === r.id;
          return (
            <Pressable key={r.id} onPress={() => void set(r.id)} style={[st.rsvp, on && { backgroundColor: r.id === 'not_going' ? colors.zinc800 : colors.brand }]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <Icon name={r.icon} size={16} color={on ? '#fff' : colors.zinc800} strokeWidth={2.4} />
              <Text style={[st.rsvpText, on && { color: '#fff' }]}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <ErrText text={err} />
      <View style={{ marginTop: 12, gap: 10 }}>
        {RSVP.map((r) => {
          const people = plan.rsvps.filter((x) => x.status === r.id);
          if (!people.length) return null;
          return (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={[st.rsvpLabel]}>{r.label} · {people.length}</Text>
              <AvatarStack people={people} size={26} max={8} />
            </View>
          );
        })}
        {!plan.rsvps.length && <Text style={st.muted}>Ninguém respondeu ainda. Sê o primeiro.</Text>}
      </View>
    </Section>
  );
}

// ----- sondagens -----
function Polls({ groupId, plan, me, admin }: { groupId: string; plan: GroupPlan; me: string; admin: boolean }) {
  const [creating, setCreating] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const open = plan.polls.filter((p) => !p.closed);
  const closed = plan.polls.filter((p) => p.closed);
  return (
    <Section title="Sondagens" icon="trending" action={<Pill label="Nova" icon="plus" kind="soft" small onPress={() => setCreating(true)} />}>
      {!plan.polls.length && <Text style={st.muted}>Onde ficamos? Que dia saímos? Lança uma sondagem e a malta decide.</Text>}
      <View style={{ gap: 18 }}>
        {open.map((p) => <PollView key={p.id} poll={p} groupId={groupId} me={me} admin={admin} />)}
        {closed.length > 0 && (
          <Pressable onPress={() => setShowClosed(!showClosed)} accessibilityRole="button">
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.zinc600 }}>{showClosed ? 'Esconder as fechadas' : `Ver as fechadas · ${closed.length}`}</Text>
          </Pressable>
        )}
        {showClosed && closed.map((p) => <PollView key={p.id} poll={p} groupId={groupId} me={me} admin={admin} />)}
      </View>
      {creating && <NewPollSheet groupId={groupId} onClose={() => setCreating(false)} />}
    </Section>
  );
}

// ----- lista -----
function Checklist({ groupId, items, me, admin, members, name, onChanged }: { groupId: string; items: ChecklistItem[]; me: string; admin: boolean; members: MiniPerson[]; name: (u: string) => string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<null | 'new' | ChecklistItem>(null);
  const [err, setErr] = useState('');
  async function run(job: () => Promise<unknown>) {
    setErr('');
    try {
      await job();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      onChanged();
    }
  }
  async function add() {
    const t = text.trim();
    if (!t) return;
    setText('');
    setAssignee(null);
    await run(() => groupsApi.addItem(groupId, { text: t, ...(assignee ? { assignee } : null) }));
  }
  function tick(it: ChecklistItem) {
    qc.setQueryData<GroupPlan>(groupKeys.plan(groupId), (p) => p && { ...p, checklist: p.checklist.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)) });
    void run(() => groupsApi.editItem(groupId, it.id, { done: !it.done }));
  }
  const person = (u: string | null | undefined) => (u ? members.find((m) => m.username === u) : undefined);
  const doneCount = items.filter((i) => i.done).length;
  return (
    <Section title="Lista" icon="check-circle" action={items.length ? <Text style={st.muted}>{doneCount} de {items.length}</Text> : undefined}>
      {items.map((it) => {
        const who = it.assignee ? person(it.assignee.username) ?? { username: it.assignee.username, displayName: it.assignee.displayName, hasAvatar: !!it.assignee.hasAvatar } : undefined;
        return (
          <View key={it.id} style={st.item}>
            <Pressable onPress={() => tick(it)} style={[st.box, it.done && { backgroundColor: colors.brand, borderColor: colors.brand }]} accessibilityRole="checkbox" accessibilityState={{ checked: it.done }} accessibilityLabel={it.text}>
              {it.done && <Icon name="check" size={14} strokeWidth={3} color="#fff" />}
            </Pressable>
            <Text style={[st.itemText, it.done && { color: colors.zinc500, textDecorationLine: 'line-through' }]}>{it.text}</Text>
            <Pressable onPress={() => setAssignFor(it)} style={st.assign} accessibilityRole="button" accessibilityLabel={who ? `Responsável: ${who.displayName}. Mudar` : 'Escolher quem trata'}>
              {who ? <Avatar name={who.displayName} username={who.hasAvatar ? who.username : undefined} size={26} /> : <Icon name="user-plus" size={16} color={colors.zinc500} />}
            </Pressable>
            {(admin || !it.createdBy || it.createdBy === me) && (
              <Pressable onPress={() => void run(() => groupsApi.deleteItem(groupId, it.id))} hitSlop={6} style={st.del} accessibilityRole="button" accessibilityLabel={`Apagar ${it.text}`}>
                <Icon name="trash" size={16} color={colors.zinc500} />
              </Pressable>
            )}
          </View>
        );
      })}
      {!items.length && <Text style={[st.muted, { marginBottom: 10 }]}>Carvão, gelo, colunas, protetor solar… Quem leva o quê?</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <Field value={text} onChangeText={setText} maxLength={120} placeholder="Juntar à lista" accessibilityLabel="Nova coisa na lista" onSubmitEditing={() => void add()} returnKeyType="done" style={{ flex: 1 }} />
        <Pressable onPress={() => setAssignFor('new')} style={[st.assign, { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={assignee ? `Para ${name(assignee)}` : 'Escolher quem trata'}>
          {assignee && person(assignee) ? <Avatar name={person(assignee)!.displayName} username={person(assignee)!.hasAvatar ? assignee : undefined} size={30} /> : <Icon name="user-plus" size={18} color={colors.zinc700} />}
        </Pressable>
        <Pressable onPress={() => void add()} disabled={!text.trim()} style={[st.addBtn, !text.trim() && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Juntar"><Icon name="plus" size={20} color="#fff" /></Pressable>
      </View>
      <ErrText text={err} />
      {assignFor && (
        <MemberPickSheet
          title="Quem trata disto?"
          people={members}
          allowNone
          selected={assignFor === 'new' ? (assignee ? [assignee] : []) : assignFor.assignee ? [assignFor.assignee.username] : []}
          onDone={(l) => {
            const u = l[0] ?? null;
            if (assignFor === 'new') setAssignee(u);
            else void run(() => groupsApi.editItem(groupId, assignFor.id, { assignee: u }));
          }}
          onClose={() => setAssignFor(null)}
        />
      )}
    </Section>
  );
}

// ----- despesas -----
function Expenses({ groupId, plan, me, admin, members, name, onChanged }: { groupId: string; plan: GroupPlan; me: string; admin: boolean; members: MiniPerson[]; name: (u: string) => string; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const { items, balances, settlements } = plan.expenses;
  const total = plan.expenses.total ?? items.reduce((n, e) => n + e.amountMzn, 0);
  // Apagar uma despesa refaz os saldos de toda a malta: pede-se confirmação (o erro do servidor aparece na própria confirmação).
  const [deleting, setDeleting] = useState<Expense | null>(null);
  async function remove(e: Expense) {
    setErr('');
    try {
      await groupsApi.deleteExpense(groupId, e.id);
    } finally {
      onChanged();
    }
  }
  return (
    <Section title="Despesas" icon="wallet" action={<Pill label="Juntar" icon="plus" kind="soft" small onPress={() => setAdding(true)} />}>
      {!items.length ? (
        <Text style={st.muted}>Quem pagou a gasolina? E a casa? Junta aqui e o Txillapp faz as contas.</Text>
      ) : (
        <View style={{ gap: 2 }}>
          <Text style={st.total}>{mzn(total)} <Text style={st.muted}>no total</Text></Text>
          {items.map((e) => (
            <View key={e.id} style={st.exp}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.expDesc} numberOfLines={1}>{e.description}</Text>
                <Text style={st.muted} numberOfLines={1}>{e.paidBy.username === me ? 'Pagaste tu' : `Pagou ${e.paidBy.displayName.split(' ')[0]}`} · dividido por {e.splitAmong.length}</Text>
              </View>
              <Text style={st.expAmount}>{mzn(e.amountMzn)}</Text>
              {(e.canDelete ?? (admin || e.createdBy === me)) && (
                <Pressable onPress={() => setDeleting(e)} hitSlop={6} style={st.del} accessibilityRole="button" accessibilityLabel={`Apagar ${e.description}`}><Icon name="trash" size={16} color={colors.zinc500} /></Pressable>
              )}
            </View>
          ))}
        </View>
      )}
      {balances.some((b) => b.net !== 0) && (
        <View style={{ marginTop: 14 }}>
          <Text style={st.sub}>Saldos</Text>
          {balances.filter((b) => b.net !== 0).map((b) => (
            <View key={b.username} style={st.bal}>
              <Text style={st.balName} numberOfLines={1}>{b.username === me ? 'Tu' : b.displayName}</Text>
              <Text style={[st.balNet, { color: b.net > 0 ? colors.green700 : colors.red600 }]}>{b.net > 0 ? `recebe ${mzn(b.net)}` : `deve ${mzn(-b.net)}`}</Text>
            </View>
          ))}
        </View>
      )}
      {settlements.length > 0 && (
        <View style={{ marginTop: 14 }}>
          <Text style={st.sub}>Quem paga a quem</Text>
          {settlements.map((s, i) => (
            <View key={i} style={[st.settle, (s.from === me || s.to === me) && { backgroundColor: colors.rose50 }]}>
              <Text style={st.settleWho} numberOfLines={1}>{s.from === me ? 'Tu' : name(s.from)}</Text>
              <Icon name="chevron-right" size={16} color={colors.zinc500} />
              <Text style={[st.settleWho, { flex: 1 }]} numberOfLines={1}>{s.to === me ? 'ti' : name(s.to)}</Text>
              <Text style={st.expAmount}>{mzn(s.amount)}</Text>
            </View>
          ))}
        </View>
      )}
      {items.length > 0 && !settlements.length && !balances.some((b) => b.net !== 0) && <Text style={[st.muted, { marginTop: 10 }]}>Contas certas. Ninguém deve nada a ninguém.</Text>}
      <ErrText text={err} />
      {adding && <ExpenseSheet groupId={groupId} me={me} members={members} onClose={() => setAdding(false)} onSaved={onChanged} />}
      {deleting && (
        <ConfirmSheet
          title="Apagar a despesa?"
          lines={[`“${deleting.description}” (${mzn(deleting.amountMzn)}) sai das contas e os saldos de toda a malta são refeitos.`]}
          confirmLabel="Apagar"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </Section>
  );
}

function ExpenseSheet({ groupId, me, members, onClose, onSaved }: { groupId: string; me: string; members: MiniPerson[]; onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(me);
  const [split, setSplit] = useState<string[]>(members.map((m) => m.username));
  const [picking, setPicking] = useState<null | 'paid' | 'split'>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cents = parseMzn(amount);
  const who = (u: string) => (u === me ? 'Tu' : members.find((m) => m.username === u)?.displayName ?? `@${u}`);
  async function save() {
    if (!description.trim()) return setErr('Escreve o que foi.');
    if (!cents) return setErr('Põe um valor válido em meticais.');
    if (!split.length) return setErr('Escolhe entre quem se divide.');
    setBusy(true);
    setErr('');
    try {
      await groupsApi.addExpense(groupId, { description: description.trim(), amountMzn: cents, paidBy, splitAmong: split });
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  if (picking === 'paid') return <MemberPickSheet title="Quem pagou?" people={members} selected={[paidBy]} onDone={(l) => l[0] && setPaidBy(l[0])} onClose={() => setPicking(null)} />;
  if (picking === 'split') return <MemberPickSheet title="Dividir entre" people={members} selected={split} multiple onDone={setSplit} onClose={() => setPicking(null)} />;
  return (
    <Sheet title="Nova despesa" onClose={onClose}>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <Field value={description} onChangeText={setDescription} maxLength={80} autoFocus placeholder="O que foi · ex.: Gasolina para o Tofo" accessibilityLabel="Descrição da despesa" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Field value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="0" accessibilityLabel="Valor em meticais" style={{ flex: 1, fontSize: 22, fontWeight: '800' }} />
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.zinc700 }}>MT</Text>
        </View>
        <Pressable onPress={() => setPicking('paid')} style={st.pickRow} accessibilityRole="button">
          <Text style={st.pickLabel}>Quem pagou</Text>
          <Text style={st.pickValue} numberOfLines={1}>{who(paidBy)}</Text>
          <Icon name="chevron-right" size={16} color={colors.zinc500} />
        </Pressable>
        <Pressable onPress={() => setPicking('split')} style={st.pickRow} accessibilityRole="button">
          <Text style={st.pickLabel}>Dividir entre</Text>
          <Text style={st.pickValue} numberOfLines={1}>{split.length === members.length ? 'Toda a malta' : `${split.length} pessoas`}{cents && split.length ? ` · ${mzn(cents / split.length)} cada` : ''}
</Text>
          <Icon name="chevron-right" size={16} color={colors.zinc500} />
        </Pressable>
        <ErrText text={err} />
        <Pill label="Guardar despesa" busy={busy} onPress={() => void save()} />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  muted: { fontSize: 13, color: colors.zinc500, lineHeight: 18 },
  dest: { fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  when: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  whenText: { fontSize: 15, fontWeight: '700', color: colors.zinc800 },
  badge: { borderRadius: 999, backgroundColor: colors.rose50, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '800', color: colors.brand },
  venue: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: colors.zinc100, padding: 8 },
  venueIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  rsvp: { flex: 1, height: 42, flexDirection: 'row', gap: 6, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  rsvpText: { fontSize: 14, fontWeight: '800', color: colors.zinc800 },
  rsvpLabel: { width: 92, fontSize: 13, fontWeight: '700', color: colors.zinc600 },
  item: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.zinc100 },
  box: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1, fontSize: 15, color: colors.zinc900 },
  assign: { minWidth: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  assignText: { fontSize: 12, fontWeight: '700', color: colors.zinc700 },
  del: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  total: { fontSize: 20, fontWeight: '800', color: colors.zinc900, marginBottom: 6 },
  exp: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.zinc100 },
  expDesc: { fontSize: 15, fontWeight: '600', color: colors.zinc900 },
  expAmount: { fontSize: 15, fontWeight: '800', color: colors.zinc900, fontVariant: ['tabular-nums'] },
  sub: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.zinc500, marginBottom: 6, textTransform: 'uppercase' },
  bal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  balName: { flex: 1, fontSize: 15, color: colors.zinc800 },
  balNet: { fontSize: 14, fontWeight: '700' },
  settle: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 8 },
  settleWho: { fontSize: 15, fontWeight: '700', color: colors.zinc900, maxWidth: '38%' },
  pickRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  pickLabel: { fontSize: 15, fontWeight: '600', color: colors.zinc700 },
  pickValue: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '700', color: colors.zinc900 },
});
