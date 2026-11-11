import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Icon } from '@/components/Icon';
import { permissionsOnboardingDone } from '@/components/PermissionsOnboarding';
import { Sheet, useSheetScroll } from '@/components/Sheet';
import { TX } from '@/icons/tx';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getCall } from '@/lib/calls';
import { kvGet, kvSet } from '@/lib/kv';
import { overlaysOpen } from '@/lib/overlays';
import {
  INSTALL_NOTE, REMINDER_BUTTON, REMINDER_KEY, REMINDER_LATER, REMINDER_TITLE, SETTINGS_BANNER,
  allCategoriesOff, blockedSteps, decideReminder, installSteps, markActive, markAway, markDismissed, markEnabled, markShown,
  parseMemory, reminderAction, reminderText, remindsFor, screenAllows, serializeMemory, startSession,
  type ReminderMemory, type ReminderTrigger,
} from '@/lib/pushReminder';
import { askDeviceNotifications, deviceNotifications, openDeviceSettings, type DeviceNotif } from '@/lib/pushStatus';
import { colors } from '@/lib/theme';

/**
 * Lembrete "As tuas notificações estão desligadas" (como o do Instagram). Os ecrãs pedem-no com `remindPush(…)` nos
 * momentos certos (depois de enviar uma mensagem, ao abrir as Mensagens) e o anfitrião (`PushReminderHost`, no _layout)
 * decide se aparece mesmo (lib/pushReminder: nunca na primeira sessão, uma vez por dia no máximo, pausas crescentes…).
 * Também aparece sozinho ao voltar à app depois de 1 dia ou mais, no Início ou nas Mensagens.
 */

/* ───────────── pedidos dos ecrãs ───────────── */

const requests = new Set<(trigger: ReminderTrigger, name?: string) => void>();
/** Um ecrã diz que é um bom momento (com o nome de quem acabaste de escrever, se houver). */
export const remindPush = (trigger: ReminderTrigger, name?: string) => requests.forEach((f) => f(trigger, name));

/* ───────────── o que se guarda neste aparelho ───────────── */

let memory: ReminderMemory | null = null;
let sessionCounted = false;
function save(m: ReminderMemory) {
  memory = m;
  void kvSet(REMINDER_KEY, serializeMemory(m)).catch(() => undefined);
}
/** Ligou as notificações (no lembrete ou nas Definições): se um dia as desligar, as pausas recomeçam do início. */
function noteEnabled() {
  if (memory) return save(markEnabled(memory));
  void kvGet(REMINDER_KEY).then((raw) => save(markEnabled(parseMemory(raw)))).catch(() => undefined);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────────── o botão "Ligar notificações" ───────────── */

type Next = 'granted' | 'steps' | 'install' | 'settings' | 'failed';

/**
 * O que o botão faz, por estado e plataforma (lib/pushReminder `reminderAction`): pede a licença e regista o push,
 * abre as definições do sistema, ou diz que é preciso mostrar os passos (cadeado do browser / instalar no iPhone).
 * O pedido da licença tem de sair logo no toque (na web o browser só o mostra assim): nada de esperas antes dele.
 */
async function turnOn(d: DeviceNotif): Promise<{ next: Next; error?: string }> {
  const a = reminderAction(d.status, d.platform);
  if (a === 'install') return { next: 'install' };
  if (a === 'browser-steps') return { next: 'steps' };
  if (a === 'settings') {
    await openDeviceSettings();
    return { next: 'settings' };
  }
  if (a === 'none') return { next: d.status === 'granted' ? 'granted' : 'failed' };
  try {
    const s = await askDeviceNotifications();
    if (s === 'granted') return { next: 'granted' };
    return { next: s === 'blocked' && d.platform === 'web' ? 'steps' : 'failed' };
  } catch (e) {
    return { next: 'failed', error: (e as Error)?.message || 'Não consegui ligar as notificações. Tenta outra vez.' };
  }
}

/* ───────────── a ilustração ───────────── */

/** Um telemóvel com avisos no ecrã e um sino a tocar, nas cores do Txillapp. */
export function NotifArt({ size = 132 }: { size?: number }) {
  const h = Math.round((size * 112) / 132);
  return (
    <View style={{ alignSelf: 'center' }} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width={size} height={h} viewBox="0 0 132 112">
        <Defs>
          <LinearGradient id="txNotifScreen" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.brand} />
            <Stop offset="1" stopColor="#ff9a5b" />
          </LinearGradient>
        </Defs>
        <Circle cx={64} cy={58} r={50} fill={colors.rose50} />
        {/* telemóvel */}
        <Rect x={38} y={14} width={46} height={86} rx={11} fill="#fff" stroke={colors.zinc900} strokeWidth={3} />
        <Rect x={43} y={24} width={36} height={68} rx={6} fill="url(#txNotifScreen)" />
        <Rect x={54} y={18} width={14} height={3} rx={1.5} fill={colors.zinc900} />
        {/* avisos no ecrã */}
        <Rect x={47} y={32} width={28} height={11} rx={5.5} fill="#fff" />
        <Circle cx={52.5} cy={37.5} r={2.8} fill={colors.brand} />
        <Rect x={58} y={36} width={13} height={3} rx={1.5} fill={colors.zinc300} />
        <Rect x={47} y={47} width={22} height={11} rx={5.5} fill="#fff" opacity={0.7} />
        <Rect x={47} y={62} width={26} height={11} rx={5.5} fill="#fff" opacity={0.45} />
        {/* sino */}
        <Circle cx={94} cy={30} r={20} fill="#fff" stroke={colors.brand} strokeWidth={3} />
        <G transform="translate(82 18)" fill="none" stroke={colors.brand} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {TX.bell.p.map((d, i) => <Path key={i} d={d} />)}
        </G>
        <Path d="M119 22a12 12 0 0 1 0 16" fill="none" stroke={colors.brand} strokeWidth={2.6} strokeLinecap="round" />
        <Path d="M124.5 17a19 19 0 0 1 0 26" fill="none" stroke={colors.brand} strokeWidth={2.6} strokeLinecap="round" opacity={0.5} />
      </Svg>
    </View>
  );
}

/* ───────────── a folha ───────────── */

/** A parte que rola: avisa a folha se está no topo (só aí arrastar para baixo a fecha). */
function SheetScroll({ children }: { children: ReactNode }) {
  const scroll = useSheetScroll();
  return (
    <ScrollView
      style={st.scroll}
      contentContainerStyle={st.body}
      bounces={false}
      scrollEventThrottle={16}
      onScroll={(e) => { if (scroll) scroll.top.current = e.nativeEvent.contentOffset.y <= 0; }}
    >
      {children}
    </ScrollView>
  );
}

type View_ = 'main' | 'steps' | 'install';

/**
 * A folha do lembrete. Rola quando não cabe; os botões ficam sempre à vista em baixo (fora da parte que rola).
 * `start`: abrir já nos passos (vindo da faixa das Definições). `onDone(true)` quando ficam ligadas.
 */
export function PushReminderSheet({ device, name, start = 'main', onDone }: { device: DeviceNotif; name?: string; start?: View_; onDone: (enabled: boolean) => void }) {
  const [view, setView] = useState<View_>(start);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [settings, setSettings] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // Voltou das definições (do sistema ou do browser): se já estão ligadas, fecha.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void deviceNotifications().then((d) => { if (d.status === 'granted') doneRef.current(true); });
    });
    return () => sub.remove();
  }, []);

  async function press() {
    setErr('');
    if (view === 'install') return onDone(false);
    if (view === 'steps') {
      // Depois de mudar no cadeado: pede outra vez (se já deixou, liga sem perguntar nada).
      setBusy(true);
      try {
        const s = await askDeviceNotifications();
        if (s === 'granted') return onDone(true);
        setErr('Ainda estão bloqueadas. Segue os passos e tenta outra vez.');
      } catch (e) {
        setErr((e as Error)?.message || 'Não consegui ligar as notificações. Tenta outra vez.');
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    const r = await turnOn(device);
    setBusy(false);
    if (r.next === 'granted') return onDone(true);
    if (r.next === 'steps' || r.next === 'install') return setView(r.next);
    if (r.next === 'settings') return setSettings(true);
    if (r.error) return setErr(r.error);
    onDone(false);
  }

  const steps = view === 'steps' ? blockedSteps(device.kind ?? 'desktop') : view === 'install' ? installSteps(device.safari !== false) : [];
  const title = view === 'install' ? 'Adiciona o Txillapp ao ecrã principal' : view === 'steps' ? 'Liga as notificações no browser' : REMINDER_TITLE;
  const lead =
    view === 'install' ? INSTALL_NOTE
    : view === 'steps' ? 'Bloqueaste as notificações do Txillapp neste browser. Para as ligar:'
    : settings ? 'Nas definições do telemóvel, toca em Notificações e liga-as. Depois volta aqui.'
    : reminderText(name);
  const primary = view === 'install' ? 'Percebi' : view === 'steps' ? 'Já está, tentar outra vez' : settings ? 'Abrir as definições outra vez' : REMINDER_BUTTON;

  return (
    <Sheet onClose={() => onDone(false)}>
      <View style={st.wrap}>
        <SheetScroll>
          <NotifArt />
          <Text style={st.title} accessibilityRole="header">{title}</Text>
          <Text style={st.text}>{lead}</Text>
          {steps.length > 0 ? (
            <View style={st.steps}>
              {steps.map((s, i) => (
                <View key={s} style={st.step}>
                  <View style={st.num}><Text style={st.numText}>{i + 1}</Text></View>
                  <Text style={st.stepText}>{s}</Text>
                  {view === 'install' && i === (device.safari === false ? 1 : 0) ? <Icon name="share" size={20} color={colors.zinc600} /> : null}
                </View>
              ))}
            </View>
          ) : null}
          {err ? <Text style={st.err} accessibilityLiveRegion="polite">{err}</Text> : null}
        </SheetScroll>
        <View style={st.foot}>
          <Pressable
            onPress={() => void press()}
            disabled={busy}
            style={({ pressed }) => [st.primary, (pressed || busy) && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }}
          >
            <Text style={st.primaryText}>{busy ? 'A ligar…' : primary}</Text>
          </Pressable>
          {view !== 'install' ? (
            <Pressable onPress={() => onDone(false)} style={({ pressed }) => [st.later, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
              <Text style={st.laterText}>{REMINDER_LATER}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Sheet>
  );
}

/* ───────────── o anfitrião (no _layout) ───────────── */

/** Decide quando mostrar o lembrete e mostra-o. Montar uma vez, com sessão iniciada. */
export function PushReminderHost() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const path = usePathname();
  const pathRef = useRef(path);
  pathRef.current = path;
  const [open, setOpen] = useState<{ device: DeviceNotif; name?: string } | null>(null);
  const openRef = useRef(false);
  openRef.current = !!open;
  const checking = useRef(false);
  const pendingReturn = useRef(false);
  /** Pedido que chegou antes de ler o que está guardado (por ex. a app abriu logo nas Mensagens). */
  const early = useRef<{ trigger: ReminderTrigger; name?: string } | null>(null);
  const who = user?.username ?? null;

  const tryShow = useCallback(async (trigger: ReminderTrigger, name?: string) => {
    if (!who) return;
    if (!memory) { early.current = { trigger, name }; return; }
    if (openRef.current || checking.current || !screenAllows(trigger, pathRef.current)) return;
    checking.current = true;
    try {
      // Deixa o ecrã assentar (a mensagem a sair, outra folha a abrir) e só depois vê se está tudo livre.
      await sleep(trigger === 'return' ? 2500 : 1100);
      const [device, onboardingDone, settings] = await Promise.all([
        deviceNotifications(),
        permissionsOnboardingDone().catch(() => false),
        qc.fetchQuery({ queryKey: ['notify-settings'], queryFn: api.notifySettings, staleTime: 5 * 60_000 }).catch(() => null),
      ]);
      const m = memory;
      if (!m || openRef.current) return;
      const now = Date.now();
      const busy = overlaysOpen() > 0 || getCall().phase !== 'idle' || AppState.currentState !== 'active';
      const d = decideReminder(m, { now, status: device.status, trigger, path: pathRef.current, onboardingDone, allCategoriesOff: allCategoriesOff(settings), busy });
      // O regresso fica à espera só se faltou o ecrã certo ou estava algo aberto; pelas outras razões, já não vale hoje.
      if (trigger === 'return' && d.why !== 'busy' && d.why !== 'screen') pendingReturn.current = false;
      if (!d.show) return;
      save(markShown(m, now));
      Keyboard.dismiss();
      setOpen({ device, name });
    } catch {
      /* sem armazenamento ou sem rede: fica para a próxima */
    } finally {
      checking.current = false;
    }
  }, [who, qc]);

  // Cada arranque com sessão conta como uma sessão; ao voltar depois de 1 dia ou mais, fica pendente o lembrete.
  useEffect(() => {
    if (!who) return;
    let alive = true;
    void kvGet(REMINDER_KEY).then((raw) => {
      if (!alive) return;
      const base = memory ?? parseMemory(raw);
      if (!sessionCounted) {
        sessionCounted = true;
        const r = startSession(base, Date.now());
        save(r.memory);
        if (r.returned) pendingReturn.current = true;
      } else memory = base;
      const e = early.current;
      early.current = null;
      if (pendingReturn.current) void tryShow('return');
      else if (e) void tryShow(e.trigger, e.name);
    });
    const sub = AppState.addEventListener('change', (s) => {
      if (!memory) return;
      if (s === 'active') {
        const r = markActive(memory, Date.now());
        save(r.memory);
        if (r.returned) pendingReturn.current = true;
        // Também regista outra vez em silêncio se a licença foi dada nas definições (deviceNotifications faz isso).
        if (pendingReturn.current) void tryShow('return');
        else void deviceNotifications().catch(() => undefined);
      } else {
        save(markAway(memory, Date.now()));
        pendingReturn.current = false;
      }
    });
    return () => { alive = false; sub.remove(); };
  }, [who, tryShow]);

  // Voltou à app noutro ecrã: o lembrete espera até chegar ao Início ou às Mensagens.
  useEffect(() => { if (pendingReturn.current) void tryShow('return'); }, [path, tryShow]);

  useEffect(() => {
    const f = (t: ReminderTrigger, n?: string) => void tryShow(t, n);
    requests.add(f);
    return () => void requests.delete(f);
  }, [tryShow]);

  if (!who || !open) return null;
  const done = (enabled: boolean) => {
    setOpen(null);
    if (enabled) noteEnabled();
    else if (memory) save(markDismissed(memory, Date.now()));
  };
  return <PushReminderSheet device={open.device} name={open.name} onDone={done} />;
}

/* ───────────── a faixa nas Definições ───────────── */

/**
 * O estado das notificações neste aparelho, sempre em dia (também ao voltar das definições do sistema ou do browser).
 * `onEnabled` é chamado quando passam a estar ligadas.
 */
export function useDeviceNotifications(onEnabled?: () => void): { device: DeviceNotif | null; refresh: () => void } {
  const [device, setDevice] = useState<DeviceNotif | null>(null);
  const enabled = useRef(onEnabled);
  enabled.current = onEnabled;
  const last = useRef<DeviceNotif | null>(null);
  const refresh = useCallback(() => {
    void deviceNotifications().then((d) => {
      if (last.current && last.current.status !== 'granted' && d.status === 'granted') { noteEnabled(); enabled.current?.(); }
      last.current = d;
      setDevice(d);
    });
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);
  return { device, refresh };
}

/** Se a faixa das Definições deve aparecer para este estado. */
export const showsOffBanner = (d: DeviceNotif | null): d is DeviceNotif => !!d && remindsFor(d.status);

/**
 * Definições › Notificações: se estiverem desligadas neste aparelho, uma faixa com o mesmo botão do lembrete.
 * O estado vem de `useDeviceNotifications` (quem a mostra decide se aparece, com `showsOffBanner`).
 */
export function PushOffBanner({ device, onRefresh }: { device: DeviceNotif; onRefresh: () => void }) {
  const [sheet, setSheet] = useState<View_ | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const refresh = onRefresh;

  async function press() {
    setErr('');
    setBusy(true);
    const r = await turnOn(device);
    setBusy(false);
    if (r.next === 'steps' || r.next === 'install') return setSheet(r.next);
    if (r.error) setErr(r.error);
    refresh(); // se ficaram ligadas, a faixa some e a secção põe-se em dia
  }

  return (
    <View style={st.banner}>
      <View style={st.bannerRow}>
        <View style={st.bannerIcon}><Icon name="bell-off" size={20} color={colors.brand} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.bannerTitle}>{SETTINGS_BANNER}</Text>
          <Text style={st.bannerText}>
            {device.status === 'needs-install' ? INSTALL_NOTE : reminderText()}
          </Text>
        </View>
      </View>
      {err ? <Text style={[st.err, { textAlign: 'left' }]} accessibilityLiveRegion="polite">{err}</Text> : null}
      <Pressable onPress={() => void press()} disabled={busy} style={({ pressed }) => [st.bannerBtn, (pressed || busy) && { opacity: 0.85 }]} accessibilityRole="button" accessibilityState={{ busy, disabled: busy }}>
        <Text style={st.primaryText}>{busy ? 'A ligar…' : REMINDER_BUTTON}</Text>
      </Pressable>
      {sheet ? (
        <PushReminderSheet
          device={device}
          start={sheet}
          onDone={() => {
            setSheet(null);
            refresh();
          }}
        />
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flexShrink: 1, minHeight: 0 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 12, alignItems: 'stretch' },
  title: { marginTop: 16, fontSize: 22, lineHeight: 28, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  text: { marginTop: 8, fontSize: 16, lineHeight: 23, color: colors.zinc600, textAlign: 'center' },
  steps: { marginTop: 16, gap: 12 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 14, fontWeight: '800', color: colors.brand },
  stepText: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.zinc900 },
  err: { marginTop: 12, fontSize: 14, lineHeight: 20, color: colors.red600, textAlign: 'center' },
  foot: { paddingHorizontal: 24, paddingTop: 8, gap: 4 },
  primary: { minHeight: 52, borderRadius: 26, paddingHorizontal: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  later: { minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  laterText: { fontSize: 15, fontWeight: '700', color: colors.zinc600 },
  banner: { padding: 16, gap: 12, backgroundColor: colors.rose50 },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bannerIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  bannerText: { marginTop: 2, fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  bannerBtn: { minHeight: 46, borderRadius: 23, paddingHorizontal: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});

