import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/Empty';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { LiveBadge } from '@/components/txillada/TxilladaParts';
import { EditScheduleSheet, shareSchedule, useClock, useRemindToggle } from '@/components/txillada/TxilladaSchedule';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { ApiError } from '@/lib/api';
import { UPCOMING_KEY, scheduleKey, txilladaApi, txilladaKey } from '@/lib/api.txillada';
import { confirm } from '@/lib/confirm';
import { useDesktop } from '@/lib/desktop';
import { useNoIndex } from '@/lib/noIndex';
import { colors, dark as D } from '@/lib/theme';
import { errorText } from '@/lib/txillada';
import { handOff } from '@/lib/txilladaRoom';
import {
  canStartNow, countdown, earliest, fmtWhen, remindersText, scheduleErrorText, scheduleGoalText, scheduleKindIcon, scheduleKindText, scheduleTitle,
  scheduleView, viewText, type ScheduledTxillada,
} from '@/lib/txilladaSchedule';

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * O cartão de uma Txillada agendada (docs/txillada-agendar.md): a capa com o anfitrião e o selo, o título, o tipo (com o preço
 * numa privada e a meta numa Angariação), o dia e a hora e a contagem. Quem vê: «Lembrar-me» (passa a «Vais ser lembrado»)
 * e «Partilhar». O anfitrião: quantos pediram para ser lembrados, «Começar» (a partir de 60 min antes; antes disso «Começar
 * agora», com confirmação), «Editar» e «Cancelar a Txillada». Começada e a decorrer: «Entrar»; acabada, cancelada ou que
 * não chegou a começar, diz o que aconteceu (a ligação partilhada continua a abrir).
 */
export default function ScheduledTxilladaScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  useNoIndex();
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const desktop = useDesktop();
  const now = useClock(15_000);
  const remind = useRemindToggle();
  // A app volta a pedir o agendamento ao abrir o cartão (não há tempo real) e de minuto a minuto enquanto está aberto.
  const q = useQuery({ queryKey: scheduleKey(id), queryFn: () => txilladaApi.getSchedule(id), enabled: !!id, retry: false, staleTime: 0, refetchInterval: 60_000 });
  const s = q.data;
  const [busy, setBusy] = useState<null | 'start' | 'cancel'>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['txillada-schedules'] });
    void qc.invalidateQueries({ queryKey: UPCOMING_KEY });
    void qc.invalidateQueries({ queryKey: ['profile'] });
  };

  /** A hora passa para agora (para começar antes da hora). Se o servidor só aceitar daqui a 15 min, vai a primeira que der. */
  async function moveToNow(cur: ScheduledTxillada): Promise<ScheduledTxillada> {
    try {
      return await txilladaApi.editSchedule(cur.id, { startsAt: new Date().toISOString() });
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) return txilladaApi.editSchedule(cur.id, { startsAt: new Date(earliest(Date.now())).toISOString() });
      throw e;
    }
  }

  /** Entrar no ecrã da Txillada como anfitrião, como o «Começar» do preparar (a câmara abre lá). */
  function enter(txilladaId: string, access: { token: string; url: string }) {
    handOff(txilladaId, access, null, true);
    refresh();
    router.replace(`/txillada/${encodeURIComponent(txilladaId)}` as never);
  }

  async function begin(cur: ScheduledTxillada, early: boolean) {
    if (busy) return;
    if (early) {
      const ok = await confirm({
        title: 'Começar agora?',
        message: `Estava marcada para ${fmtWhen(cur.startsAt, Date.now(), true)}. A hora passa para agora e quem pediu para ser lembrado recebe logo o aviso.`,
        confirm: 'Começar agora',
      });
      if (!ok) return;
    }
    setBusy('start');
    setMsg(null);
    try {
      let at = cur;
      if (early) at = await moveToNow(cur);
      const r = await txilladaApi.start(at.title, at.audience, { price: at.price, goal: at.goal, purpose: at.goalPurpose, scheduleId: at.id });
      qc.setQueryData(txilladaKey(r.txillada.id), r.txillada);
      qc.setQueryData<ScheduledTxillada>(scheduleKey(at.id), { ...at, status: 'started', txilladaId: r.txillada.id, live: true });
      enter(r.txillada.id, { token: r.token, url: r.url });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      const code = err?.code ?? (typeof err?.extra?.code === 'string' ? err.extra.code : undefined);
      // Ainda cedo para o servidor (a hora do telemóvel estava atrasada): pergunta e muda a hora para agora.
      if (err?.status === 409 && code === 'too_early' && !early) {
        setBusy(null);
        void begin(cur, true);
        return;
      }
      // Já tenho uma Txillada a decorrer: volto a entrar nela como anfitrião (como no preparar).
      const running = err?.status === 409 && typeof err.extra?.id === 'string' ? (err.extra.id as string) : null;
      if (running) {
        try {
          enter(running, await txilladaApi.join(running));
        } catch (j) {
          setMsg(j instanceof ApiError ? errorText(j.status, j.message) : errorText(undefined));
        }
        return;
      }
      setMsg(err && (err.status === 400 || code) ? scheduleErrorText(err) : err ? errorText(err.status, err.message) : errorText(undefined));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(cur: ScheduledTxillada) {
    if (busy) return;
    const ok = await confirm({
      title: 'Cancelar a Txillada?',
      message: cur.reminders ? `${remindersText(cur.reminders)}. Vão receber um aviso de que a cancelaste.` : 'Quem pediu para ser lembrado recebe um aviso de que a cancelaste.',
      confirm: 'Cancelar a Txillada',
      cancel: 'Manter',
      danger: true,
    });
    if (!ok) return;
    setBusy('cancel');
    setMsg(null);
    try {
      await txilladaApi.cancelSchedule(cur.id);
      qc.setQueryData<ScheduledTxillada>(scheduleKey(cur.id), { ...cur, status: 'cancelled' });
      refresh();
    } catch (e) {
      setMsg(scheduleErrorText(e instanceof ApiError ? e : null));
    } finally {
      setBusy(null);
    }
  }

  let body: React.ReactNode;
  if (!s && q.isPending) {
    body = <View style={st.center}><ActivityIndicator color="#fff" /></View>;
  } else if (!s) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    body = (
      <View style={st.center}>
        {missing
          ? <EmptyState dark icon="calendar" title="Esta Txillada não existe" text="Ou não a podes ver. Se te mandaram a ligação, pede outra a quem ta mandou." />
          : <ErrorState dark what="esta Txillada" onRetry={() => void q.refetch()} />}
      </View>
    );
  } else {
    const view = scheduleView(s);
    const goal = scheduleGoalText(s);
    const state = viewText(view, s.isHost);
    const ready = canStartNow(s.startsAt, now);
    body = (
      <ScrollView contentContainerStyle={[st.scroll, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <View style={[st.col, desktop && { paddingTop: 24 }]}>
          <LinearGradient colors={view === 'scheduled' || view === 'live' ? ['#e5506a', '#8a1d3a', '#2a0f18'] : ['#3f3f46', '#27272a', '#18181b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.cover}>
            <View style={st.tagRow}>
              {view === 'live' ? <LiveBadge small /> : <><Icon name="txillada" size={16} color="#fff" strokeWidth={2.2} /><Text style={st.tag}>TXILLADA AGENDADA</Text></>}
            </View>
            <View style={st.avatar}><Avatar name={s.host.displayName} username={s.host.avatarUrl ? s.host.username : undefined} size={84} /></View>
            <NameWithBadge name={s.host.displayName} who={s.host} center size={17} style={st.host} />
            <Text style={st.handle}>@{s.host.username}</Text>
            <Text style={st.title} accessibilityRole="header">{scheduleTitle(s)}</Text>
            <View style={st.facts}>
              <View style={st.fact}><Icon name={scheduleKindIcon(s)} size={15} color="#fff" strokeWidth={2.1} /><Text style={st.factText}>{scheduleKindText(s)}</Text></View>
              {goal ? <View style={st.fact}><Icon name="gift" size={15} color="#fff" strokeWidth={2.1} /><Text style={st.factText} numberOfLines={2}>{goal}</Text></View> : null}
            </View>
            <View style={st.when}>
              <View style={st.whenRow}><Icon name="calendar" size={18} color="#fff" strokeWidth={2.1} /><Text style={st.whenText}>{cap(fmtWhen(s.startsAt, now, true))}</Text></View>
              {view === 'scheduled' ? <View style={st.whenRow}><Icon name="clock" size={16} color="rgba(255,255,255,0.85)" strokeWidth={2.1} /><Text style={st.countText}>{countdown(s.startsAt, now)}</Text></View> : null}
            </View>
          </LinearGradient>

          {state ? (
            <View style={st.state} accessibilityRole="summary">
              <Text style={st.stateText}>{state}</Text>
              {view === 'ended' ? <Text style={st.stateSub}>As Txilladas não ficam gravadas: só se veem ao vivo.</Text> : null}
              {view === 'expired' && s.isHost ? <Text style={st.stateSub}>Podes agendar outra em Criar, no modo Txillada.</Text> : null}
            </View>
          ) : null}

          {msg ? <Text style={st.msg} accessibilityRole="alert">{msg}</Text> : null}

          {view === 'live' && s.txilladaId ? (
            <Button label="Entrar" icon="txillada" dark block onPress={() => router.replace(`/txillada/${encodeURIComponent(s.txilladaId!)}` as never)} />
          ) : null}

          {view === 'scheduled' && !s.isHost ? (
            <View style={st.actions}>
              {s.reminded
                ? <Button label="Vais ser lembrado" icon="check" kind="secondary" dark block onPress={() => void remind(s.id, false)} accessibilityHint="Toca para deixares de ser lembrado" />
                : <Button label="Lembrar-me" icon="bell" dark block onPress={() => void remind(s.id, true)} />}
              <Button label="Partilhar" icon="share" kind="secondary" dark block onPress={() => void shareSchedule(s)} />
              {s.kind === 'paid' || s.audience === 'paid' ? <Text style={st.hint}>A entrada só se paga quando a Txillada estiver a decorrer.</Text> : null}
            </View>
          ) : null}

          {view === 'scheduled' && s.isHost ? (
            <View style={st.actions}>
              <View style={st.reminders}><Icon name="bell" size={17} color={D.icon} /><Text style={st.remindersText}>{remindersText(s.reminders)}</Text></View>
              {ready
                ? <Button label="Começar" icon="txillada" dark block loading={busy === 'start'} onPress={() => void begin(s, false)} />
                : <Button label="Começar agora" icon="txillada" kind="secondary" dark block loading={busy === 'start'} onPress={() => void begin(s, true)} accessibilityHint="Falta mais de uma hora: pede confirmação e muda a hora para agora" />}
              <View style={st.pair}>
                <Button label="Editar" icon="pencil" kind="secondary" dark onPress={() => setEditing(true)} style={{ flex: 1 }} />
                <Button label="Partilhar" icon="share" kind="secondary" dark onPress={() => void shareSchedule(s)} style={{ flex: 1 }} />
              </View>
              <Button label="Cancelar a Txillada" icon="trash" kind="danger" dark block loading={busy === 'cancel'} onPress={() => void cancel(s)} />
              {!ready ? <Text style={st.hint}>«Começar» fica pronto 1 hora antes. Recebes um aviso 15 min antes e outro na hora.</Text> : null}
            </View>
          ) : null}

          {view !== 'scheduled' && view !== 'live' ? (
            <Button label={s.isHost ? 'Ver o meu perfil' : `Ver o perfil de @${s.host.username}`} kind="secondary" dark block onPress={() => router.push(`/u/${encodeURIComponent(s.host.username)}` as never)} />
          ) : null}
        </View>
      </ScrollView>
    );
  }

  return (
    <StackPage title="Txillada agendada" dark>
      {body}
      {editing && s ? <EditScheduleSheet s={s} onClose={() => setEditing(false)} onSaved={(n) => { qc.setQueryData(scheduleKey(n.id), n); refresh(); }} /> : null}
    </StackPage>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: '#000' },
  scroll: { flexGrow: 1, backgroundColor: '#000', paddingHorizontal: 16, paddingTop: 16 },
  col: { width: '100%', maxWidth: 460, alignSelf: 'center', gap: 12 },
  cover: { borderRadius: 28, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 22, alignItems: 'center', overflow: 'hidden' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  tag: { color: '#fff', fontSize: 11.5, fontWeight: '800', letterSpacing: 1 },
  avatar: { marginTop: 14, borderRadius: 48, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)', padding: 2 },
  host: { marginTop: 10, color: '#fff', fontSize: 17, fontWeight: '800' },
  handle: { color: 'rgba(255,255,255,0.75)', fontSize: 14, marginTop: 1 },
  title: { marginTop: 14, color: '#fff', fontSize: 22, lineHeight: 28, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3 },
  facts: { marginTop: 12, gap: 6, alignItems: 'center', alignSelf: 'stretch' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 12, paddingVertical: 6 },
  factText: { flexShrink: 1, color: '#fff', fontSize: 13.5, fontWeight: '600' },
  when: { marginTop: 16, alignSelf: 'stretch', borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.3)', paddingVertical: 12, paddingHorizontal: 16, gap: 6, alignItems: 'center' },
  whenRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  whenText: { color: '#fff', fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  countText: { color: 'rgba(255,255,255,0.88)', fontSize: 14.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  state: { borderRadius: 20, backgroundColor: D.bg, paddingVertical: 14, paddingHorizontal: 16, gap: 4 },
  stateText: { color: D.text, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  stateSub: { color: D.sub, fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
  actions: { gap: 10 },
  pair: { flexDirection: 'row', gap: 10 },
  reminders: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 4 },
  remindersText: { color: D.text, fontSize: 15, fontWeight: '700' },
  hint: { color: D.sub, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  msg: { color: '#fff', backgroundColor: 'rgba(220,38,38,0.85)', borderRadius: 12, overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  danger: { color: colors.danger },
});
