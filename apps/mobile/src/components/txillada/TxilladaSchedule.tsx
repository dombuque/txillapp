import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Sheet, useSheetScroll } from '@/components/Sheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { ApiError } from '@/lib/api';
import { UPCOMING_KEY, scheduleKey, txilladaApi } from '@/lib/api.txillada';
import { SITE_URL } from '@/lib/config';
import { linkShare } from '@/lib/shareLink';
import { colors, dark as D } from '@/lib/theme';
import { showToast } from '@/lib/toast';
import { TITLE_MAX } from '@/lib/txillada';
import {
  WEEK_INITIALS, dayKey, daySlots, defaultStart, fmtWhen, monthGrid, monthRange, monthTitle, moveToDay, offeredDays, dayLabel,
  isNotScheduled, scheduleErrorText, scheduleKindText, withReminded, scheduleGoalText, scheduleShareLink, scheduleShareMessage, scheduledText, shiftMonth, startOfDay, validStart,
  type NextTxillada, type ScheduleInput, type ScheduledTxillada,
} from '@/lib/txilladaSchedule';

/** Pôr o lembrete (ou tirá-lo) em todas as cópias que a app tem: o cartão, a fila «Em breve», as listas e o perfil. */
function markReminded(qc: QueryClient, id: string, on: boolean) {
  qc.setQueryData<ScheduledTxillada>(scheduleKey(id), (old) => (old ? withReminded(old, on) : old));
  const inList = (old: { items: ScheduledTxillada[] } | undefined) => (old?.items ? { ...old, items: old.items.map((x) => (x.id === id ? withReminded(x, on) : x)) } : old);
  qc.setQueryData<{ items: ScheduledTxillada[] }>(UPCOMING_KEY, inList);
  qc.setQueriesData<{ items: ScheduledTxillada[] }>({ queryKey: ['txillada-schedules'] }, inList);
  qc.setQueriesData<{ nextTxillada?: NextTxillada | null }>({ queryKey: ['profile'] }, (old) =>
    old?.nextTxillada?.id === id ? { ...old, nextTxillada: { ...old.nextTxillada, reminded: on } } : old);
}

/**
 * «Lembrar-me» otimista: muda já em todo o lado e pede ao servidor; se falhar, volta atrás e diz porquê.
 * Devolve a função `(id, on)`.
 */
export function useRemindToggle(): (id: string, on: boolean) => Promise<void> {
  const qc = useQueryClient();
  const busy = useRef(new Set<string>());
  return async (id, on) => {
    if (busy.current.has(id)) return;
    busy.current.add(id);
    markReminded(qc, id, on);
    try {
      const r = await txilladaApi.remind(id, on);
      if (r && typeof r.reminded === 'boolean' && r.reminded !== on) markReminded(qc, id, r.reminded);
      if (on) showToast('Vais ser lembrado quando começar.');
    } catch (e) {
      markReminded(qc, id, !on);
      const err = e instanceof ApiError ? e : null;
      showToast(scheduleErrorText(err));
      // Já não está à espera (começou, foi cancelada, expirou): as cópias vão buscar o estado novo.
      if (isNotScheduled(err)) { void qc.invalidateQueries({ queryKey: scheduleKey(id) }); void qc.invalidateQueries({ queryKey: UPCOMING_KEY }); void qc.invalidateQueries({ queryKey: ['profile'] }); }
    } finally {
      busy.current.delete(id);
    }
  };
}

/** A hora de agora, posta em dia de `every` em `every` ms (as contagens e as horas que já passaram). */
export function useClock(every = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/** Partilhar o agendamento (o mesmo Share da Txillada); num browser sem partilha, copia a ligação. */
export async function shareSchedule(s: Pick<ScheduledTxillada, 'id' | 'host' | 'title' | 'startsAt'>): Promise<void> {
  const url = scheduleShareLink(s.id, SITE_URL || 'https://txillapp.com');
  const message = scheduleShareMessage(s, Date.now());
  const noShare = Platform.OS === 'web' && typeof navigator !== 'undefined' && typeof (navigator as { share?: unknown }).share !== 'function';
  if (noShare) {
    try { await Clipboard.setStringAsync(url); showToast('Copiei a ligação da Txillada.'); } catch { showToast(url); }
    return;
  }
  try {
    await Share.share(linkShare(message, url), { dialogTitle: `Txillada de @${s.host.username}` });
  } catch { /* cancelado */ }
}

/** A parte da folha que rola: avisa a folha se está no topo (só aí arrastar para baixo a fecha). */
function SheetBody({ children }: { children: ReactNode }) {
  const sc = useSheetScroll();
  return (
    <ScrollView
      style={st.scroll}
      contentContainerStyle={st.body}
      bounces={false}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={(e) => { if (sc) sc.top.current = e.nativeEvent.contentOffset.y <= 0; }}
    >
      {children}
    </ScrollView>
  );
}

/**
 * Escolher o dia e a hora, tudo em JS (sem módulos nativos): as pastilhas Hoje, Amanhã e os 5 dias seguintes, «Outro dia»
 * com o calendário simples do mês, e a grelha das horas de 15 em 15 min (só a partir de daqui a 15 min).
 */
export function SchedulePicker({ value, onChange, now }: { value: number | null; onChange: (at: number) => void; now: number }) {
  const pills = useMemo(() => offeredDays(now), [Math.floor(now / 60_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const selDay = value != null ? startOfDay(value) : null;
  const selKey = selDay != null ? dayKey(selDay) : null;
  const inPills = pills.some((p) => p.key === selKey);
  const [cal, setCal] = useState(false);
  const range = monthRange(now);
  const [month, setMonth] = useState(() => (value != null ? { year: new Date(value).getFullYear(), month: new Date(value).getMonth() } : range.first));
  const pickDay = (day: number) => {
    const at = moveToDay(day, value, now);
    if (at != null) onChange(at);
  };
  return (
    <View style={{ gap: 10 }}>
      <Text style={st.label}>Dia</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.pills} keyboardShouldPersistTaps="handled">
        {pills.map((p) => (
          <Chip key={p.key} label={p.label} dark selected={!cal && selKey === p.key} onPress={() => { setCal(false); pickDay(p.day); }} accessibilityLabel={p.label === 'Hoje' || p.label === 'Amanhã' ? p.label : fmtWhen(p.day, now, true).split(',')[0]} />
        ))}
        {selDay != null && !inPills ? <Chip label={dayLabel(selDay, now)} dark selected={!cal} onPress={() => setCal(false)} /> : null}
        <Chip label="Outro dia" icon="calendar" dark selected={cal} onPress={() => setCal((v) => !v)} accessibilityLabel="Escolher outro dia no calendário" />
      </ScrollView>
      {cal ? (
        <MonthCalendar
          year={month.year}
          month={month.month}
          now={now}
          selected={selKey}
          onPrev={shiftMonth(month, -1, now) ? () => setMonth(shiftMonth(month, -1, now)!) : undefined}
          onNext={shiftMonth(month, 1, now) ? () => setMonth(shiftMonth(month, 1, now)!) : undefined}
          onPick={(day) => { pickDay(day); setCal(false); }}
        />
      ) : null}
      <Text style={[st.label, { marginTop: 4 }]}>Hora</Text>
      {selDay != null ? <TimeGrid day={selDay} value={value} now={now} onPick={onChange} /> : <Text style={st.sub}>Escolhe primeiro o dia.</Text>}
    </View>
  );
}

/** O calendário do mês: semanas de segunda a domingo, os dias fora do prazo apagados. */
function MonthCalendar({ year, month, now, selected, onPrev, onNext, onPick }: { year: number; month: number; now: number; selected: string | null; onPrev?: () => void; onNext?: () => void; onPick: (day: number) => void }) {
  const weeks = monthGrid(year, month, now);
  return (
    <View style={st.cal} accessibilityLabel={`Calendário de ${monthTitle(year, month)}`}>
      <View style={st.calHead}>
        <IconButton icon="chevron-left" label="Mês anterior" variant="dark" size={40} iconSize={20} onPress={onPrev ?? (() => undefined)} disabled={!onPrev} />
        <Text style={st.calTitle}>{monthTitle(year, month)}</Text>
        <IconButton icon="chevron-right" label="Mês seguinte" variant="dark" size={40} iconSize={20} onPress={onNext ?? (() => undefined)} disabled={!onNext} />
      </View>
      <View style={st.week}>
        {WEEK_INITIALS.map((w, i) => <Text key={i} style={st.weekDay}>{w}</Text>)}
      </View>
      {weeks.map((wk, i) => (
        <View key={i} style={st.week}>
          {wk.map((c, j) => {
            if (!c) return <View key={j} style={st.cell} />;
            const on = c.key === selected;
            return (
              <Pressable
                key={j}
                onPress={() => onPick(c.day)}
                disabled={!c.ok}
                style={({ pressed }) => [st.cell, st.dayBtn, c.today && st.today, on && st.dayOn, !c.ok && { opacity: 0.28 }, pressed && c.ok && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: !c.ok }}
                accessibilityLabel={fmtWhen(c.day, now, true).split(',').slice(0, -1).join(',') || String(c.date)}
              >
                <Text style={[st.dayText, on && { color: colors.zinc900 }]}>{c.date}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** A grelha das horas desse dia, de 15 em 15 min (uma linha por hora); rola por dentro e abre na hora escolhida. */
function TimeGrid({ day, value, now, onPick }: { day: number; value: number | null; now: number; onPick: (at: number) => void }) {
  const rows = daySlots(day, now);
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  const sc = useSheetScroll();
  const ROW = 46;
  const selRow = rows.findIndex((r) => r.some((s) => s.at === value));
  useEffect(() => {
    if (selRow < 0) return;
    const t = setTimeout(() => ref.current?.scrollTo({ y: Math.max(0, selRow - 1) * ROW, animated: false }), 30);
    return () => clearTimeout(t);
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return <Text style={st.sub}>Já não há horas neste dia. Escolhe outro.</Text>;
  return (
    <ScrollView
      ref={ref}
      style={st.times}
      nestedScrollEnabled
      showsVerticalScrollIndicator
      onTouchStart={() => { if (sc) sc.top.current = false; }}
      onTouchEnd={() => { if (sc) sc.top.current = true; }}
      accessibilityLabel="Hora"
    >
      {rows.map((r) => (
        <View key={r[0].label} style={[st.timeRow, { height: ROW }]}>
          {r.map((s) => {
            const on = s.at === value;
            return (
              <Pressable
                key={s.label}
                onPress={() => onPick(s.at)}
                disabled={!s.ok}
                style={({ pressed }) => [st.time, on && st.timeOn, !s.ok && { opacity: 0.25 }, pressed && s.ok && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: !s.ok }}
                accessibilityLabel={s.label}
              >
                <Text style={[st.timeText, on && { color: colors.zinc900 }]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

/** O que vem do preparar (o tipo, o preço e a meta) para o agendamento. */
export type ScheduleForm = Omit<ScheduleInput, 'startsAt'>;

/**
 * A folha «Agendar» do preparar: o dia e a hora, e «Agendar para sáb., 20:00». Depois mostra «Agendada para sábado, 20:00»
 * com «Partilhar» e «Ver no perfil».
 */
export function ScheduleSheet({ form, onClose, onDone, onProfile }: { form: ScheduleForm; onClose: () => void; onDone: (s: ScheduledTxillada) => void; onProfile: () => void }) {
  const now = useClock();
  const [at, setAt] = useState<number | null>(() => defaultStart(Date.now()));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<ScheduledTxillada | null>(null);
  async function save() {
    if (at == null) { setMsg('Escolhe o dia e a hora.'); return; }
    if (!validStart(at, Date.now())) { setMsg('Escolhe uma hora pelo menos 15 min à frente.'); return; }
    setBusy(true);
    setMsg(null);
    try {
      const s = await txilladaApi.schedule({ ...form, startsAt: new Date(at).toISOString() });
      setDone(s);
      onDone(s);
    } catch (e) {
      setMsg(scheduleErrorText(e instanceof ApiError ? e : null));
    } finally {
      setBusy(false);
    }
  }
  if (done) {
    const goal = scheduleGoalText(done);
    return (
      <Sheet dark onClose={onClose}>
        <View style={[st.body, { alignItems: 'stretch' }]}>
          <View style={st.doneIcon}><Icon name="check" size={30} color="#fff" strokeWidth={2.4} /></View>
          <Text style={st.doneTitle} accessibilityRole="header">{scheduledText(done.startsAt, now)}</Text>
          {done.title ? <Text style={st.doneSub} numberOfLines={2}>{done.title}</Text> : null}
          <Text style={st.doneMeta}>{goal ? `${scheduleKindText(done)}. ${goal}` : scheduleKindText(done)}</Text>
          <Text style={st.doneHint}>Quem te segue vê-a no teu perfil e pode pedir para ser lembrado. Recebes um aviso 15 min antes.</Text>
          <View style={st.doneBtns}>
            <Button label="Partilhar" icon="share" kind="secondary" dark onPress={() => void shareSchedule(done)} style={{ flex: 1 }} />
            <Button label="Ver no perfil" icon="user" dark onPress={onProfile} style={{ flex: 1 }} />
          </View>
        </View>
      </Sheet>
    );
  }
  return (
    <Sheet dark title="Agendar a Txillada" onClose={onClose}>
      <SheetBody>
        <Text style={st.sub}>Quem te segue vê-a no teu perfil e pode pedir para ser lembrado. Na hora recebes um aviso e começas com um toque.</Text>
        <SchedulePicker value={at} onChange={(v) => { setAt(v); setMsg(null); }} now={now} />
      </SheetBody>
      <View style={st.foot}>
        {msg ? <Text style={st.msg} accessibilityRole="alert">{msg}</Text> : null}
        <Button label={at != null ? `Agendar para ${fmtWhen(at, now)}` : 'Agendar'} icon="calendar" dark loading={busy} disabled={at == null} onPress={() => void save()} block />
      </View>
    </Sheet>
  );
}

/** Editar o agendamento (o anfitrião): o título, o dia e a hora. O tipo, o preço e a meta não mudam. */
export function EditScheduleSheet({ s, onClose, onSaved }: { s: ScheduledTxillada; onClose: () => void; onSaved: (s: ScheduledTxillada) => void }) {
  const now = useClock();
  const qc = useQueryClient();
  const first = new Date(s.startsAt).getTime();
  const [title, setTitle] = useState(s.title ?? '');
  const [at, setAt] = useState<number | null>(() => (validStart(first, Date.now()) ? first : defaultStart(Date.now())));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    const body: { title?: string; startsAt?: string } = {};
    const t = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
    if (t !== (s.title ?? '').trim()) body.title = t;
    if (at != null && at !== first) {
      if (!validStart(at, Date.now())) { setMsg('Escolhe uma hora pelo menos 15 min à frente.'); return; }
      body.startsAt = new Date(at).toISOString();
    }
    if (body.title === undefined && !body.startsAt) { onClose(); return; }
    setBusy(true);
    setMsg(null);
    try {
      onSaved(await txilladaApi.editSchedule(s.id, body));
      onClose();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setMsg(scheduleErrorText(err));
      if (isNotScheduled(err)) void qc.invalidateQueries({ queryKey: scheduleKey(s.id) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet dark title="Editar a Txillada" onClose={onClose}>
      <SheetBody>
        <View style={st.field}>
          <TextInput
            value={title}
            onChangeText={(v) => { setTitle(v.slice(0, TITLE_MAX)); setMsg(null); }}
            maxLength={TITLE_MAX}
            placeholder="Título (opcional)"
            placeholderTextColor={D.sub}
            style={st.input}
            accessibilityLabel="Título da Txillada"
          />
          <Text style={st.count}>{TITLE_MAX - title.length}</Text>
        </View>
        <Text style={st.sub}>{`${scheduleKindText(s)}. O tipo, o preço e a meta não mudam. Se mudares a hora, quem pediu para ser lembrado recebe um aviso.`}</Text>
        <SchedulePicker value={at} onChange={(v) => { setAt(v); setMsg(null); }} now={now} />
      </SheetBody>
      <View style={st.foot}>
        {msg ? <Text style={st.msg} accessibilityRole="alert">{msg}</Text> : null}
        <Button label="Guardar" dark loading={busy} onPress={() => void save()} block />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  foot: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  label: { color: D.text, fontSize: 14, fontWeight: '700' },
  sub: { color: D.sub, fontSize: 14, lineHeight: 20 },
  pills: { gap: 8, paddingRight: 8 },
  cal: { borderRadius: 18, backgroundColor: D.raised, paddingHorizontal: 8, paddingVertical: 8, gap: 2 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  calTitle: { color: D.text, fontSize: 15, fontWeight: '700' },
  week: { flexDirection: 'row' },
  weekDay: { flex: 1, textAlign: 'center', color: D.sub, fontSize: 12, fontWeight: '700', paddingVertical: 4 },
  cell: { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center' },
  dayBtn: { borderRadius: 20, marginHorizontal: 2 },
  today: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  dayOn: { backgroundColor: '#fff', borderColor: '#fff' },
  dayText: { color: D.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  times: { maxHeight: 46 * 4 + 4, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.04)' },
  timeRow: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 4 },
  time: { flex: 1, height: 38, borderRadius: 999, backgroundColor: D.raised, alignItems: 'center', justifyContent: 'center' },
  timeOn: { backgroundColor: '#fff' },
  timeText: { color: D.text, fontSize: 14.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  msg: { color: '#fff', backgroundColor: 'rgba(220,38,38,0.85)', borderRadius: 12, overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, fontWeight: '600' },
  field: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: 24, backgroundColor: D.raised, paddingRight: 14 },
  input: { flex: 1, minWidth: 0, height: 46, paddingLeft: 18, paddingRight: 8, color: D.text, fontSize: 16, fontWeight: '600', outlineStyle: 'none' as never },
  count: { color: D.sub, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  doneIcon: { alignSelf: 'center', width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  doneTitle: { color: D.text, fontSize: 20, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  doneSub: { color: D.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  doneMeta: { color: D.sub, fontSize: 14, textAlign: 'center' },
  doneHint: { color: D.sub, fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
  doneBtns: { flexDirection: 'row', gap: 8, marginTop: 8 },
});
