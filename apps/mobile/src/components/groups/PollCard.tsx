import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useBubbleHold } from '@/components/bubbleHold';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { groupKeys, groupsApi, type GroupPlan, type Poll } from '@/lib/api.groups';
import { colors } from '@/lib/theme';
import { ConfirmSheet, ErrText, Field, Pill } from './GroupParts';

/** O TxillGroup aberto: a bolha da sondagem no chat precisa de saber de que grupo é e se sou admin. */
export interface GroupCtxValue { id: string; me: string; admin: boolean }
export const GroupCtx = createContext<GroupCtxValue | null>(null);
export const useGroupCtx = () => useContext(GroupCtx);

/** O Plano do TxillGroup (uma query só, partilhada pelo separador Plano e pelas sondagens no chat). */
export function usePlan(id: string, enabled = true) {
  return useQuery({ queryKey: groupKeys.plan(id), queryFn: () => groupsApi.plan(id), enabled: !!id && enabled, staleTime: 15_000, refetchInterval: 60_000 });
}

/** Sondagem: tocar numa opção vota (ou tira o voto); barras com a percentagem; quem criou ou um admin pode fechar. */
export function PollView({ poll, groupId, me, admin, compact = false }: { poll: Poll; groupId: string; me: string; admin: boolean; compact?: boolean }) {
  const qc = useQueryClient();
  // Dentro de uma bolha do chat, segurar uma opção abre o menu da mensagem (fora do chat, no Plano, não faz nada).
  const hold = useBubbleHold();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Fechar não tem volta: pede-se confirmação.
  const [asking, setAsking] = useState(false);
  const total = poll.options.reduce((n, o) => n + o.votes, 0);
  const voters = new Set(poll.options.flatMap((o) => o.voters)).size;
  const voted = poll.myVotes.length > 0;
  const showResults = voted || poll.closed;
  const top = Math.max(0, ...poll.options.map((o) => o.votes));

  async function vote(optionId: string) {
    if (poll.closed || busy) return;
    const mine = poll.myVotes.includes(optionId);
    const next = poll.multiple ? (mine ? poll.myVotes.filter((x) => x !== optionId) : [...poll.myVotes, optionId]) : mine ? [] : [optionId];
    setBusy(true);
    setErr('');
    // Mostra logo o voto; o servidor confirma a seguir.
    qc.setQueryData<GroupPlan>(groupKeys.plan(groupId), (p) => p && {
      ...p,
      polls: p.polls.map((x) => x.id !== poll.id ? x : {
        ...x,
        myVotes: next,
        options: x.options.map((o) => {
          const had = x.myVotes.includes(o.id);
          const has = next.includes(o.id);
          return had === has ? o : { ...o, votes: o.votes + (has ? 1 : -1), voters: has ? [...o.voters, me] : o.voters.filter((v) => v !== me) };
        }),
      }),
    });
    try {
      await groupsApi.vote(groupId, poll.id, next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: groupKeys.plan(groupId) });
      void qc.invalidateQueries({ queryKey: ['chat-group', groupId] });
    }
  }
  async function close() {
    setBusy(true);
    try {
      await groupsApi.closePoll(groupId, poll.id);
      void qc.invalidateQueries({ queryKey: groupKeys.plan(groupId) });
      void qc.invalidateQueries({ queryKey: ['chat-group', groupId] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={[st.q, compact && { fontSize: 15 }]}>{poll.question}</Text>
      <Text style={st.meta}>{poll.closed ? 'Fechada' : poll.multiple ? 'Podes escolher várias' : 'Escolhe uma'} · {voters === 1 ? '1 pessoa votou' : `${voters} pessoas votaram`}</Text>
      {poll.options.map((o) => {
        const mine = poll.myVotes.includes(o.id);
        const pct = total ? Math.round((o.votes / total) * 100) : 0;
        const win = poll.closed && o.votes === top && top > 0;
        return (
          <Pressable key={o.id} {...hold} onPress={() => void vote(o.id)} disabled={poll.closed} style={({ pressed }) => [st.opt, mine && { borderColor: colors.brand }, pressed && { opacity: 0.8 }]} accessibilityRole={poll.multiple ? 'checkbox' : 'radio'} accessibilityState={{ checked: mine, disabled: poll.closed }} accessibilityLabel={`${o.text}, ${o.votes} votos`}>
            {showResults && <View style={[st.bar, { width: `${pct}%` }, (mine || win) && { backgroundColor: 'rgba(214,51,79,0.16)' }]} />}
            <View style={[st.tick, poll.multiple && { borderRadius: 6 }, mine && { backgroundColor: colors.brand, borderColor: colors.brand }]}>{mine && <Icon name="check" size={12} strokeWidth={3} color="#fff" />}</View>
            <Text style={[st.optText, win && { fontWeight: '800' }]} numberOfLines={2}>{o.text}</Text>
            {showResults && <Text style={st.pct}>{pct}%</Text>}
          </Pressable>
        );
      })}
      <ErrText text={err} />
      {!poll.closed && (admin || poll.createdBy === me) && (
        <Pressable {...hold} onPress={() => { setErr(''); setAsking(true); }} disabled={busy} style={{ alignSelf: 'flex-start', paddingVertical: 4 }} accessibilityRole="button">
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.zinc600 }}>Fechar a sondagem</Text>
        </Pressable>
      )}
      {asking && (
        <ConfirmSheet
          title="Fechar a sondagem?"
          lines={['Ninguém mais pode votar e os resultados ficam como estão. Depois de fechada, não volta a abrir.']}
          confirmLabel="Fechar a sondagem"
          onConfirm={close}
          onClose={() => setAsking(false)}
        />
      )}
    </View>
  );
}

/**
 * A sondagem como bolha no chat (mensagem de tipo 'poll' com body = id da sondagem). A mensagem já traz a sondagem (`initial`);
 * depois de votar vale a do Plano, que é a mais fresca.
 */
export function PollBubble({ pollId, initial }: { pollId: string; initial?: Poll | null }) {
  const ctx = useGroupCtx();
  const plan = usePlan(ctx?.id ?? '', !!ctx);
  const poll = plan.data?.polls.find((p) => p.id === pollId) ?? initial ?? undefined;
  return (
    <View style={st.bubble}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Icon name="trending" size={14} color={colors.brand} />
        <Text style={{ fontSize: 12, fontWeight: '800', color: colors.brand, letterSpacing: 0.5 }}>SONDAGEM</Text>
      </View>
      {!ctx ? <Text style={st.meta}>Abre o TxillGroup para votar.</Text>
        : poll ? <PollView poll={poll} groupId={ctx.id} me={ctx.me} admin={ctx.admin} compact />
        : <Text style={st.meta}>{plan.isLoading ? 'A carregar…' : 'Esta sondagem já não existe.'}</Text>}
    </View>
  );
}

/** Criar uma sondagem: pergunta, 2 a 6 opções e "várias respostas". */
export function NewPollSheet({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const filled = options.map((o) => o.trim()).filter(Boolean);
  async function save() {
    if (question.trim().length < 2) return setErr('Escreve a pergunta.');
    if (filled.length < 2) return setErr('Precisas de pelo menos duas opções.');
    if (new Set(filled.map((o) => o.toLowerCase())).size !== filled.length) return setErr('Há opções repetidas.');
    setBusy(true);
    setErr('');
    try {
      await groupsApi.createPoll(groupId, { question: question.trim(), options: filled, multiple });
      void qc.invalidateQueries({ queryKey: groupKeys.plan(groupId) });
      void qc.invalidateQueries({ queryKey: ['chat-group', groupId] });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Sheet title="Nova sondagem" onClose={onClose}>
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        <Field value={question} onChangeText={setQuestion} maxLength={140} autoFocus placeholder="Pergunta · ex.: Onde ficamos?" accessibilityLabel="Pergunta" />
        {options.map((o, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Field value={o} onChangeText={(t) => setOptions((l) => l.map((x, k) => (k === i ? t : x)))} maxLength={60} placeholder={`Opção ${i + 1}`} accessibilityLabel={`Opção ${i + 1}`} style={{ flex: 1 }} />
            {options.length > 2 && <Pressable onPress={() => setOptions((l) => l.filter((_, k) => k !== i))} style={st.rm} accessibilityRole="button" accessibilityLabel={`Tirar a opção ${i + 1}`}><Icon name="x" size={16} color={colors.zinc600} /></Pressable>}
          </View>
        ))}
        {options.length < 6 && <Pill label="Mais uma opção" icon="plus" kind="soft" small onPress={() => setOptions((l) => [...l, ''])} style={{ alignSelf: 'flex-start' }} />}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.zinc800 }}>Várias respostas</Text>
          <Switch value={multiple} onValueChange={setMultiple} trackColor={{ true: colors.brand, false: colors.zinc300 }} thumbColor="#fff" accessibilityLabel="Várias respostas" />
        </View>
        <ErrText text={err} />
        <Pill label="Lançar sondagem" busy={busy} onPress={() => void save()} />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  q: { fontSize: 16, fontWeight: '800', color: colors.zinc900 },
  meta: { fontSize: 12, color: colors.zinc500 },
  opt: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1.5, borderColor: colors.zinc200, paddingHorizontal: 12, paddingVertical: 8, overflow: 'hidden', backgroundColor: colors.white },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.zinc100 },
  tick: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  optText: { flex: 1, fontSize: 15, color: colors.zinc900 },
  pct: { fontSize: 13, fontWeight: '700', color: colors.zinc700, fontVariant: ['tabular-nums'] },
  bubble: { width: 280, maxWidth: '100%', borderRadius: 20, borderWidth: 1, borderColor: colors.zinc200, backgroundColor: colors.white, padding: 12 },
  rm: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.zinc100 },
});
