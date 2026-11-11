import { useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Avatar } from '@/components/Avatar';
import { BookmarkIcon } from '@/components/BookmarkIcon';
import { Icon, type IconName } from '@/components/Icon';
import { FindContacts } from '@/components/FindContacts';
import { EditProfileSheet } from '@/components/ProfileSheets';
import { PushOffBanner, showsOffBanner, useDeviceNotifications } from '@/components/PushReminder';
import { Sheet } from '@/components/Sheet';
import { StackPage } from '@/components/StackPage';
import { CloseFriendsSheet } from '@/components/StoryParts';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { ApiError, api, type CallsWho, type Gender, type PrivacySettings, type Viewers, type Who } from '@/lib/api';
import { accounts } from '@/lib/accounts';
import { useAuth } from '@/lib/auth';
import { pushApi } from '@/lib/api.settings';
import { nearbyApi, type NearbyVisibility } from '@/lib/api.nearby';
import { SITE_URL } from '@/lib/config';
import { buildId, checkForUpdate, disablePush, enablePush, hardReload, installApp, installState, pushState } from '@/lib/push';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

const site = (path: string) => void Linking.openURL(`${SITE_URL || 'https://txillapp.com'}${path}`);

type SheetName = null | 'switch' | 'gender' | 'edit' | 'type' | 'comments' | 'gifts' | 'connections' | 'storyReplies' | 'hidden' | 'mentions' | 'dms' | 'closeFriends' | 'repostsVisible' | 'cheersVisible' | 'giftsVisible' | 'blocked' | 'password' | 'devices' | 'delete' | 'logout' | 'contacts' | 'calls' | 'nearby';

const VIEWERS: { value: Viewers; title: string; text: string }[] = [
  { value: 'everyone', title: 'Todos', text: 'Qualquer pessoa que veja a publicação.' },
  { value: 'followers', title: 'Só os meus seguidores', text: 'Quem me segue.' },
  { value: 'off', title: 'Só eu', text: 'Mais ninguém vê os nomes.' },
];
const viewersLabel = (v: Viewers) => VIEWERS.find((x) => x.value === v)!.title;
const WHO: { value: Who; title: string; text: string }[] = [
  { value: 'everyone', title: 'Todos', text: 'Qualquer pessoa.' },
  { value: 'following', title: 'Quem eu sigo', text: 'Só as pessoas que segues.' },
  { value: 'off', title: 'Ninguém', text: 'Desativado.' },
];
const whoLabel = (w: Who) => WHO.find((o) => o.value === w)!.title;
const CALLS: { value: CallsWho; title: string; text: string }[] = [
  { value: 'everyone', title: 'Todos', text: 'Qualquer pessoa te pode ligar.' },
  { value: 'following', title: 'Quem eu sigo', text: 'Só as pessoas que segues.' },
  { value: 'mutual', title: 'Amigos mútuos', text: 'Só quem segues e te segue de volta. É a opção de origem.' },
  { value: 'off', title: 'Ninguém', text: 'Ninguém te liga pelo Txillapp.' },
];
const callsLabel = (w: CallsWho) => CALLS.find((o) => o.value === w)?.title ?? 'Amigos mútuos';
// Os mesmos três níveis do mapa "À tua volta" (perto.tsx).
const NEARBY: { value: NearbyVisibility; title: string; text: string }[] = [
  { value: 'off', title: 'Ninguém', text: 'Ficas invisível. Vês na mesma o que há à volta.' },
  { value: 'mutual', title: 'Amigos mútuos', text: 'Só quem segues e te segue de volta.' },
  { value: 'following', title: 'Quem eu sigo', text: 'As pessoas que tu segues.' },
];
const nearbyLabel = (v: NearbyVisibility) => NEARBY.find((o) => o.value === v)?.title ?? 'Ninguém';
const CONNECTIONS = [
  { value: 'everyone', title: 'Todos', text: 'Qualquer pessoa que veja o teu perfil.' },
  { value: 'followers', title: 'Só seguidores', text: 'Quem te segue.' },
  { value: 'me', title: 'Só eu', text: 'Ninguém mais vê estas listas.' },
] as const;
const GENDERS: { value: Gender; label: string }[] = [{ value: 'female', label: 'Feminino' }, { value: 'male', label: 'Masculino' }];
const genderLabel = (g: Gender) => GENDERS.find((x) => x.value === g)?.label ?? (g === 'other' ? 'Outro' : g === 'unspecified' ? 'Prefiro não dizer' : '');

const NOTIFY_LABELS: Record<string, [string, string]> = {
  messages: ['Mensagens', 'Conversas e TxillGroups (pedidos para entrar, quem entrou, quem te fez administrador). Desligado, os pedidos para entrar continuam na lista, sem aviso'],
  follows: ['Seguidores', 'Quem começa a seguir-te e pedidos aceites'],
  comments: ['Comentários e respostas', 'Na tua publicação, no teu comentário e nos teus mimos'],
  mentions: ['Menções e marcações', 'Quando alguém te menciona ou te identifica'],
  reposts: ['Reposts', 'Quando repostam uma publicação tua'],
  gifts: ['Presentes', 'Quando te oferecem Txills'],
  reactions: ['Brindes e reações', 'Brindes nas tuas publicações, Tchekas, comentários, notas e geleira, e reações aos teus Zás'],
  invites: ['Convites', 'Quando alguém entra com o teu convite e quando um convite te dá Txills'],
  calls: ['Chamadas perdidas', 'Quando te ligam e não atendes (o toque de quem liga não se desliga aqui)'],
  venues: ['Locais que geres', 'Convites para gerir uma página e pagamentos em Txills recebidos'],
};

function IconDot({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return <View style={[st.icon, danger && { backgroundColor: '#fef2f2' }]}>{children}</View>;
}

/** Linha de definição: ícone, nome, valor atual e seta. Sem `onPress` é só para ver (cadeado). */
function Row({ icon, label, value, onPress, danger }: { icon: ReactNode; label: string; value?: string; onPress?: () => void; danger?: boolean }) {
  const body = (
    <>
      <IconDot danger={danger}>{icon}</IconDot>
      <Text style={[st.label, danger && { color: colors.red600 }]}>{label}</Text>
      {value ? <Text style={st.value} numberOfLines={1}>{value}</Text> : null}
      {onPress ? !danger && <Text style={st.chev}>›</Text> : <Icon name="lock" size={16} color={colors.zinc300} />}
    </>
  );
  if (!onPress) return <View style={st.row}>{body}</View>;
  return <Pressable onPress={onPress} style={({ pressed }) => [st.row, pressed && { backgroundColor: '#fafafa' }]} accessibilityRole="button">{body}</Pressable>;
}

function Toggle({ icon, label, text, on, onChange }: { icon: ReactNode; label: string; text: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={st.row}>
      <IconDot>{icon}</IconDot>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.labelB}>{label}</Text>
        <Text style={st.text}>{text}</Text>
      </View>
      <Switch value={on} onValueChange={onChange} trackColor={{ true: colors.brand, false: colors.zinc300 }} thumbColor="#fff" {...({ activeThumbColor: "#fff" } as object)} accessibilityLabel={label} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const kids = (Array.isArray(children) ? children : [children]).filter(Boolean) as ReactNode[];
  return (
    <View style={{ marginTop: 24 }} accessibilityLabel={title}>
      <Text style={st.sectionTitle}>{title}</Text>
      <View style={st.card}>
        {kids.map((k, i) => (
          <View key={i} style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.zinc100 } : undefined}>{k}</View>
        ))}
      </View>
    </View>
  );
}

/** Folha de escolha única que aplica logo ao tocar. */
function ChoiceSheet<T extends string>({ title, intro, options, value, onPick, onClose }: { title: string; intro?: string; options: readonly { value: T; title: string; text: string }[]; value: T; onPick: (v: T) => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 8 }}>
        {intro ? <Text style={{ marginBottom: 4, fontSize: 14, color: colors.zinc600 }}>{intro}</Text> : null}
        {options.map((o) => {
          const on = value === o.value;
          return (
            <Pressable key={o.value} onPress={() => { onPick(o.value); onClose(); }} style={[st.choice, on && { borderColor: colors.brand, backgroundColor: colors.rose50 }]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.zinc900 }}>{o.title}</Text>
                <Text style={{ fontSize: 14, color: colors.zinc600 }}>{o.text}</Text>
              </View>
              <View style={[st.radio, on && { borderColor: colors.brand, backgroundColor: colors.brand }]}>{on && <Icon name="check" size={14} color="#fff" strokeWidth={3} />}</View>
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

/** Cada tipo de aviso liga-se ou desliga-se. Os pedidos de seguir ficam sempre na lista. */
function NotifyPrefs() {
  const q = useQuery({ queryKey: ['notify-settings'], queryFn: api.notifySettings });
  const qc = useQueryClient();
  if (!q.data) return null;
  const off = q.data.off;
  async function set(cat: string, on: boolean) {
    const next = on ? off.filter((c) => c !== cat) : [...off, cat];
    qc.setQueryData(['notify-settings'], { ...q.data!, off: next });
    try { await api.saveNotifySettings(next); } catch { void qc.invalidateQueries({ queryKey: ['notify-settings'] }); }
  }
  return (
    <>
      {q.data.categories.filter((c) => NOTIFY_LABELS[c]).map((c) => (
        <Toggle key={c} icon={<Icon name="bell" size={20} />} label={NOTIFY_LABELS[c][0]} text={NOTIFY_LABELS[c][1]} on={!off.includes(c)} onChange={(v) => void set(c, v)} />
      ))}
    </>
  );
}

/** Linha "Instalar a app" (só na web): instalar com um toque no Android, instruções no iPhone. */
function InstallRow() {
  const [state, setState] = useState(installState());
  if (state === 'none') return null;
  if (state === 'installed') return <Row icon={<Icon name="check-circle" size={20} color={colors.zinc800} />} label="App instalada" />;
  const how = state === 'ios' ? 'No Safari: toca em Partilhar (o quadrado com a seta) e depois em "Adicionar ao ecrã principal".' : 'Para instalar no iPhone, abre este endereço no Safari.';
  return <Row icon={<Icon name="phone" size={20} color={colors.zinc800} />} label="Instalar a app" onPress={() => (state === 'prompt' ? void installApp().then(() => setState(installState())) : window.alert(how))} />;
}

/** Ligar ou desligar as notificações no telemóvel (Web Push). Funciona na app instalada, em HTTPS. */
function PushToggle({ onChange }: { onChange?: () => void }) {
  const [state, setState] = useState<'checking' | 'none' | 'off-server' | 'denied' | 'ask' | 'on'>('checking');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    void pushState().then((s) => alive && setState(s));
    return () => { alive = false; };
  }, []);
  async function enable() {
    setBusy(true);
    setErr('');
    try {
      const r = await enablePush();
      setState(r === 'on' ? 'on' : r === 'denied' ? 'denied' : 'ask');
      onChange?.();
    } catch (x) {
      setErr((x as Error).message || 'Não consegui ligar as notificações');
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    try { await disablePush(); setState('ask'); } finally { setBusy(false); onChange?.(); }
  }
  const text =
    state === 'none' ? 'Instala a app no ecrã principal e abre-a por lá (no iPhone: iOS 16.4 ou mais recente).'
    : state === 'off-server' ? 'Ainda não estão ativas neste servidor.'
    : state === 'denied' ? 'Bloqueadas no browser: ativa-as nas definições do site.'
    : err || 'Avisa-te de chamadas, mensagens, comentários e pedidos, sem mostrar o conteúdo.';
  const on = state === 'on';
  const available = state === 'on' || state === 'ask';
  return (
    <View style={st.row}>
      <IconDot><Icon name="bell" size={20} color={colors.zinc800} /></IconDot>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.labelB}>Notificações no telemóvel</Text>
        <Text style={[st.text, !!err && { color: colors.red600 }]}>{text}</Text>
        {on ? <Text style={{ marginTop: 4, fontSize: 14, fontWeight: '600', color: colors.brand, textDecorationLine: 'underline' }} onPress={() => { setErr(''); pushApi.pushTest().catch((x: Error) => setErr(x.message)); }} accessibilityRole="button">Enviar notificação de teste</Text> : null}
      </View>
      <Switch value={on} disabled={!available || busy} onValueChange={(v) => void (v ? enable() : disable())} trackColor={{ true: colors.brand, false: colors.zinc300 }} thumbColor="#fff" {...({ activeThumbColor: '#fff' } as object)} accessibilityLabel="Notificações no telemóvel" />
    </View>
  );
}

/**
 * Secção Notificações: se estiverem desligadas neste aparelho, a faixa com "Ligar notificações" (como o lembrete).
 * Na web também a linha de instalar a app e o interruptor do Web Push; na app nativa só aparece com a faixa.
 */
function DeviceNotifications() {
  const [rev, setRev] = useState(0);
  // Ligou pela faixa (ou nas definições do sistema): o interruptor volta a ler o estado.
  const { device, refresh } = useDeviceNotifications(() => setRev((r) => r + 1));
  const banner = showsOffBanner(device) ? <PushOffBanner device={device} onRefresh={refresh} /> : null;
  if (Platform.OS !== 'web') return banner ? <Section title="Notificações">{banner}</Section> : null;
  return (
    <Section title="Notificações">
      {banner}
      <InstallRow />
      <PushToggle key={rev} onChange={refresh} />
    </Section>
  );
}

/** A versão da app e o botão para procurar já uma atualização (e, se ficar presa, recarregar do zero). */
function VersionRow() {
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'updating' | 'error'>('idle');
  async function check() {
    setState('checking');
    setState(await checkForUpdate());
  }
  const busy = state === 'checking' || state === 'updating';
  return (
    <View style={{ marginTop: 8, paddingHorizontal: 16, alignItems: 'center' }}>
      <Text style={{ fontSize: 12, color: colors.zinc500, textAlign: 'center' }}>Txillapp · versão {Constants.expoConfig?.version ?? '?'}{buildId() ? ` (build ${buildId()!.slice(0, 8)})` : ''}</Text>
      {Platform.OS === 'web' ? (
        <>
          <Pressable onPress={() => void check()} disabled={busy} style={({ pressed }) => [{ marginTop: 6, height: 36, borderRadius: 18, paddingHorizontal: 16, justifyContent: 'center' }, pressed && { backgroundColor: colors.rose50 }, busy && { opacity: 0.6 }]} accessibilityRole="button">
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.brand }}>{state === 'checking' ? 'A procurar…' : state === 'updating' ? 'A atualizar…' : 'Procurar atualização'}</Text>
          </Pressable>
          {state === 'latest' ? <Text style={{ fontSize: 12, color: colors.zinc600 }}>Já tens a versão mais recente.</Text> : null}
          {state === 'error' ? <Text style={{ fontSize: 12, color: colors.red600 }} accessibilityRole="alert">Não consegui procurar. Tenta outra vez.</Text> : null}
          {state === 'latest' || state === 'error' ? <Text style={{ marginTop: 4, fontSize: 12, fontWeight: '600', color: colors.zinc600, textDecorationLine: 'underline' }} onPress={() => void hardReload()} accessibilityRole="button">Ainda vês a versão antiga? Recarregar do zero</Text> : null}
        </>
      ) : null}
    </View>
  );
}

/** Mostra o país onde estás: é a rede que vês. */
function RegionInfo() {
  const geo = useQuery({ queryKey: ['geo'], queryFn: api.geo, staleTime: 5 * 60_000 });
  const code = geo.data?.country;
  let name = 'Não consegui saber';
  if (code) {
    try { name = new Intl.DisplayNames(['pt'], { type: 'region' }).of(code) ?? code; } catch { name = code; }
  }
  return (
    <View style={st.row}>
      <IconDot><Icon name="map-pin" size={20} /></IconDot>
      <View style={{ flex: 1 }}>
        <Text style={st.labelB}>A tua região: {geo.isLoading ? '…' : name}</Text>
        <Text style={st.text}>Cada país é a sua rede: sugestões, Tcheka e pesquisa mostram o que é daqui. Quem segues vês sempre.</Text>
      </View>
    </View>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const router = useRouter();
  const { user, signOut, switchTo } = useAuth();
  const [others, setOthers] = useState<{ username: string; displayName: string }[]>([]);
  useEffect(() => {
    void accounts.list().then((l) => setOthers(l.filter((a) => a.username !== user?.username)));
  }, [user?.username]);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [exporting, setExporting] = useState(false);
  const close = () => setSheet(null);
  const go = (path: string) => router.push(path as never);

  const profile = useQuery({ queryKey: ['profile', user!.username], queryFn: () => api.profile(user!.username) });
  const privacy = useQuery({ queryKey: ['privacy'], queryFn: api.privacy });
  // "Esconder o meu IP" só aparece quando o servidor de chamadas (TURN) está ligado: sem ele a chamada não ligaria.
  const ice = useQuery({ queryKey: ['calls-ice'], queryFn: () => import('@/lib/calls/api').then((m) => m.callsApi.ice()), staleTime: 30 * 60_000, retry: false });
  const relayAvailable = (ice.data?.iceServers.length ?? 0) > 1;
  const stories = useQuery({ queryKey: ['story-settings'], queryFn: api.storySettings });
  const closeFriends = useQuery({ queryKey: ['close-friends'], queryFn: api.closeFriends });
  const blocked = useQuery({ queryKey: ['blocked'], queryFn: api.blocked });
  const ver = useQuery({ queryKey: ['verification'], queryFn: api.verificationStatus, staleTime: 60_000 });
  // Aparecer em À tua volta: a mesma chave de cache do mapa, para os dois ecrãs ficarem iguais.
  const nearby = useQuery({ queryKey: ['nearby-settings'], queryFn: nearbyApi.settings, staleTime: 5 * 60_000, retry: false });
  async function saveNearby(v: NearbyVisibility) {
    try {
      const r = await nearbyApi.setSettings(v);
      qc.setQueryData(['nearby-settings'], { ...(nearby.data ?? {}), visibility: r?.visibility ?? v });
      if (v === 'off') void nearbyApi.clearPresence().catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['nearby'] });
    } catch (e) {
      Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : 'Não consegui mudar isto agora. Tenta outra vez.');
    }
  }
  const p = privacy.data;

  async function savePrivacy(patch: Partial<PrivacySettings>) {
    const prev = p;
    if (prev) qc.setQueryData(['privacy'], { ...prev, ...patch });
    try {
      qc.setQueryData(['privacy'], await api.setPrivacy(patch));
      for (const key of ['profile', 'feed', 'suggestions']) void qc.invalidateQueries({ queryKey: [key] });
    } catch {
      qc.setQueryData(['privacy'], prev);
    }
  }
  async function downloadData() {
    if (exporting) return;
    setExporting(true);
    try {
      const json = await api.exportData();
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `txillapp-dados-${user!.username}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } else {
        await Share.share({ message: json, title: `txillapp-dados-${user!.username}.json` });
      }
    } catch (x) {
      Alert.alert('Os meus dados', (x as Error).message);
    } finally {
      setExporting(false);
    }
  }
  const out = () => void signOut().then(() => router.replace('/login'));
  const chevRow = (icon: ReactNode, label: string, onPress: () => void, value?: string) => <Row icon={icon} label={label} value={value} onPress={onPress} />;
  const ic = (name: IconName) => <Icon name={name} size={20} color={colors.zinc800} />;

  return (
    <StackPage title="Definições e privacidade">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {profile.data && (
          <Pressable onPress={() => setSheet('edit')} style={({ pressed }) => [st.me, pressed && { transform: [{ scale: 0.99 }] }]} accessibilityRole="button">
            <Avatar name={profile.data.displayName} username={profile.data.hasAvatar ? user!.username : undefined} size={60} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.zinc900 }} numberOfLines={1}>{profile.data.displayName}</Text>
              <Text style={{ fontSize: 14, color: colors.zinc600 }} numberOfLines={1}>@{user!.username}</Text>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.brand }}>Editar perfil e foto</Text>
            </View>
            <Text style={st.chev}>›</Text>
          </Pressable>
        )}

        <Section title="O teu perfil">
          {chevRow(ic('map-pin'), 'Tenho um local (bar, restaurante…)', () => go('/locais'))}
          {chevRow(<BookmarkIcon on={false} size={22} />, 'Guardados', () => go('/saved'))}
          {chevRow(ic('trending'), 'Estatísticas do perfil', () => go('/insights'))}
          {chevRow(ic('snowflake'), 'A minha geleira', () => go('/geleira'))}
        </Section>

        <Section title="Carteira">{chevRow(ic('wallet'), 'Txills e presentes', () => go('/wallet'))}</Section>

        <Section title="Verificação">
          {chevRow(<VerifiedBadge size={22} tier={ver.data?.tier} />, ver.data?.verified ? 'A tua conta está verificada' : 'Pedir o selo de verificado', () => go('/verification'))}
        </Section>

        <Section title="Privacidade da conta">
          <Row icon={ic(p?.isPrivate ? 'lock' : 'globe')} label="Tipo de perfil" value={p ? (p.isPrivate ? 'Privado' : 'Público') : '…'} onPress={() => setSheet('type')} />
          <Row icon={ic('user-circle')} label="Como me identifico" value={p ? (p.gender ? genderLabel(p.gender) : 'Por escolher') : '…'} onPress={p && !p.gender ? () => setSheet('gender') : undefined} />
          {p && p.gender && p.gender !== 'unspecified' ? <Toggle icon={ic('user')} label="Mostrar no perfil" text="Quem vê o teu perfil vê também isto." on={p.showGender} onChange={(v) => void savePrivacy({ showGender: v })} /> : null}
          <Row icon={ic('block')} label="Contas bloqueadas" value={blocked.data ? String(blocked.data.length) : '…'} onPress={() => setSheet('blocked')} />
          <Row icon={ic('users')} label="Quem vê seguidores e a quem sigo" value={p ? CONNECTIONS.find((c) => c.value === p.showConnections)!.title : '…'} onPress={() => setSheet('connections')} />
          {p ? <Toggle icon={ic('sparkles')} label="Aparecer nas sugestões" text="Outras pessoas podem descobrir-te." on={p.suggestable} onChange={(v) => void savePrivacy({ suggestable: v })} /> : null}
          {p ? <Toggle icon={ic('eye')} label="Mostrar quando estou online" text="Aparece Online ou Visto há… no chat. Se desligares, também não vês o dos outros." on={p.showPresence} onChange={(v) => void savePrivacy({ showPresence: v })} /> : null}
          {nearby.data && nearby.data.canEnable !== false ? <Row icon={ic('map-pin')} label="Aparecer em À tua volta" value={nearbyLabel(nearby.data.visibility)} onPress={() => setSheet('nearby')} /> : null}
        </Section>

        <Section title="Interações">
          <Row icon={ic('comment')} label="Quem pode comentar" value={p ? whoLabel(p.commentsAllowed) : '…'} onPress={() => setSheet('comments')} />
          <Row icon={ic('repeat')} label="Quem vê quem repostou" value={p ? viewersLabel(p.repostsVisible) : '…'} onPress={() => setSheet('repostsVisible')} />
          <Row icon={ic('cheers')} label="Quem vê quem brindou" value={p ? viewersLabel(p.cheersVisible) : '…'} onPress={() => setSheet('cheersVisible')} />
          <Row icon={ic('gift')} label="Quem vê quem presenteou" value={p ? viewersLabel(p.giftsVisible) : '…'} onPress={() => setSheet('giftsVisible')} />
          <Row icon={ic('mail')} label="Quem pode enviar-me mensagens" value={p ? whoLabel(p.dmsAllowed) : '…'} onPress={() => setSheet('dms')} />
          <Row icon={ic('phone')} label="Quem me pode ligar" value={p ? callsLabel(p.callsAllowed ?? 'mutual') : '…'} onPress={() => setSheet('calls')} />
          {p && relayAvailable ? <Toggle icon={ic('shield')} label="Esconder o meu IP nas chamadas" text="A chamada passa sempre pelo servidor do Txillapp, e quem está do outro lado não vê o teu endereço. Pode ficar um pouco mais lenta." on={!!p.callsRelayOnly} onChange={(v) => void savePrivacy({ callsRelayOnly: v })} /> : null}
          <Row icon={ic('at')} label="Quem pode mencionar-me" value={p ? whoLabel(p.mentionsAllowed) : '…'} onPress={() => setSheet('mentions')} />
          <Row icon={ic('gift')} label="Quem pode presentear-me" value={p ? whoLabel(p.giftsAllowed) : '…'} onPress={() => setSheet('gifts')} />
        </Section>

        <Section title="Mimos">
          <Row icon={ic('camera')} label="Quem pode responder" value={stories.data ? whoLabel(stories.data.replies) : '…'} onPress={() => setSheet('storyReplies')} />
          <Row icon={ic('heart')} label="Amigos próximos" value={closeFriends.data ? String(closeFriends.data.length) : '…'} onPress={() => setSheet('closeFriends')} />
          <Row icon={ic('eye-off')} label="Esconder mimo de…" value={stories.data ? String(stories.data.hidden.length) : '…'} onPress={() => setSheet('hidden')} />
        </Section>

        <Section title="Convidar">
          <Row icon={ic('user-plus')} label="Convida a tua malta" onPress={() => go('/invites')} />
          {Platform.OS === 'web' ? <Row icon={ic('users')} label="Encontrar amigos nos contactos" onPress={() => setSheet('contacts')} /> : null}
          {p ? <Toggle icon={ic('search')} label="Deixar que me encontrem pelos contactos" text="Quem tem o teu email nos contactos pode sugerir-te a seguir. Só vê que estás no Txillapp." on={p.findByContacts} onChange={(v) => void savePrivacy({ findByContacts: v })} /> : null}
        </Section>

        <Section title="Região"><RegionInfo /></Section>
        <DeviceNotifications />

        <Section title="O que me pode notificar"><NotifyPrefs /></Section>

        <Section title="Privacidade dos dados">
          {p ? <Toggle icon={ic('info')} label="Ajudar a melhorar o Txillapp" text="Estatísticas de uso só nossas, sem terceiros: aberturas, ecrãs, erros e o que fazes (publicar, brindar, seguir, enviar mensagens…). Nunca o conteúdo nem a posição. Desligado, o que estava à espera é apagado." on={p.shareAnalytics} onChange={(v) => void savePrivacy({ shareAnalytics: v })} /> : null}
        </Section>

        <Section title="Segurança">
          <Row icon={ic('key')} label="Alterar senha" onPress={() => setSheet('password')} />
          <Row icon={ic('phone')} label="Dispositivos com sessão iniciada" onPress={() => setSheet('devices')} />
        </Section>

        <Section title="Apoio e informações">
          <Row icon={ic('info')} label="Ajuda" onPress={() => go('/help')} />
          <Row icon={ic('wallet')} label="Pedidos e pagamentos" onPress={() => go('/orders')} />
          <Row icon={ic('globe')} label="Idioma e traduções" onPress={() => go('/language')} />
          <Row icon={ic('shield')} label="Sobre" value="Perfil, privacidade e termos" onPress={() => go('/about')} />
        </Section>

        <VersionRow />

        <Section title="Conta">
          <Row icon={ic('download')} label={exporting ? 'A preparar…' : 'Descarregar os meus dados'} onPress={() => void downloadData()} />
          <Row icon={ic('user-plus')} label="Adicionar conta" onPress={() => { accounts.beginAdd(); go('/login?entrar=1'); }} />
          {others.length > 0 ? <Row icon={ic('users')} label="Trocar de conta" value={`${others.length + 1} contas`} onPress={() => setSheet('switch')} /> : null}
          <Row icon={ic('logout')} label="Terminar sessão" onPress={() => setSheet('logout')} />
          <Row icon={<Icon name="trash" size={20} color={colors.red600} />} label="Eliminar conta" danger onPress={() => setSheet('delete')} />
        </Section>
      </ScrollView>

      {sheet === 'contacts' && <FindContacts onClose={close} />}
      {sheet === 'gender' && p && (
        <Sheet title="Como te identificas?" onClose={close}>
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingBottom: 8 }}>
            {GENDERS.map((g) => {
              const on = p.gender === g.value;
              return (
                <Pressable key={g.value} onPress={() => { void savePrivacy({ gender: g.value }); close(); }} style={[st.gender, on && { borderColor: colors.brand, backgroundColor: colors.rose50 }]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: on ? colors.brand : colors.zinc800 }}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Sheet>
      )}
      {sheet === 'switch' && (
        <Sheet title="Trocar de conta" onClose={close}>
          <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            {others.map((a) => (
              <Pressable key={a.username} onPress={() => { close(); void switchTo(a.username); }} style={st.person} accessibilityRole="button">
                <Avatar name={a.displayName} username={a.username} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} numberOfLines={1}>{a.displayName}</Text>
                  <Text style={{ fontSize: 14, color: colors.zinc600 }} numberOfLines={1}>@{a.username}</Text>
                </View>
                <Text style={st.chev}>›</Text>
              </Pressable>
            ))}
            <Text style={{ marginTop: 8, fontSize: 13, color: colors.zinc500, textAlign: 'center' }}>Dica: toca duas vezes no perfil, na barra de baixo, para trocar.</Text>
          </View>
        </Sheet>
      )}
      {sheet === 'edit' && profile.data && <EditProfileSheet profile={profile.data} onClose={close} />}
      {sheet === 'type' && p && (
        <ChoiceSheet title="Tipo de perfil" intro="Num perfil privado só vê o teu conteúdo quem aprovares; seguir passa a ser um pedido." options={[{ value: 'public', title: 'Público', text: 'Qualquer pessoa vê as tuas publicações e mimos.' }, { value: 'private', title: 'Privado', text: 'Só os seguidores aprovados.' }]} value={p.isPrivate ? 'private' : 'public'} onPick={(v) => void savePrivacy({ isPrivate: v === 'private' })} onClose={close} />
      )}
      {sheet === 'comments' && p && <ChoiceSheet title="Quem pode comentar" intro="Aplica-se às tuas publicações. Os comentários que já existem mantêm-se." options={WHO} value={p.commentsAllowed} onPick={(v) => void savePrivacy({ commentsAllowed: v })} onClose={close} />}
      {sheet === 'mentions' && p && <ChoiceSheet title="Quem pode mencionar-me" intro="Quem escreve @o-teu-nome e te faz aparecer nas sugestões. Quem eu sigo mantém-se sempre disponível para mim; contas privadas só são mencionadas por quem as segue." options={WHO} value={p.mentionsAllowed} onPick={(v) => void savePrivacy({ mentionsAllowed: v })} onClose={close} />}
      {sheet === 'repostsVisible' && p && <ChoiceSheet title="Quem vê quem repostou" intro="Os números continuam visíveis; isto muda só quem pode ver os nomes." options={VIEWERS} value={p.repostsVisible} onPick={(v) => void savePrivacy({ repostsVisible: v })} onClose={close} />}
      {sheet === 'cheersVisible' && p && <ChoiceSheet title="Quem vê quem brindou" intro="Os números continuam visíveis; isto muda só quem pode ver os nomes." options={VIEWERS} value={p.cheersVisible} onPick={(v) => void savePrivacy({ cheersVisible: v })} onClose={close} />}
      {sheet === 'giftsVisible' && p && <ChoiceSheet title="Quem vê quem presenteou" intro="Os números continuam visíveis; isto muda só quem pode ver os nomes (nunca os valores)." options={VIEWERS} value={p.giftsVisible} onPick={(v) => void savePrivacy({ giftsVisible: v })} onClose={close} />}
      {sheet === 'dms' && p && <ChoiceSheet title="Quem pode enviar-me mensagens" intro="Só trava conversas novas: as que já existem continuam. Também decide quem te pode pôr num TxillGroup. As respostas aos teus mimos seguem a definição dos mimos." options={WHO} value={p.dmsAllowed} onPick={(v) => void savePrivacy({ dmsAllowed: v })} onClose={close} />}
      {sheet === 'calls' && p && <ChoiceSheet title="Quem me pode ligar" intro="Chamadas de voz e videochamadas. Quem bloqueaste nunca te liga. O Txillapp não grava chamadas: fica só o registo, que podes apagar em Chamadas." options={CALLS} value={p.callsAllowed ?? 'mutual'} onPick={(v) => void savePrivacy({ callsAllowed: v })} onClose={close} />}
      {sheet === 'nearby' && nearby.data && <ChoiceSheet title="Aparecer em À tua volta" intro="Quem te pode ver no mapa. Só aparece a zona aproximada (cerca de 1,5 km), nunca o sítio exato, e só enquanto tens o mapa aberto com a localização do telemóvel (com uma cidade escolhida, não apareces). Some ao fim de 3 horas, ou logo que escolhes uma cidade, terminas a sessão ou desligas isto." options={NEARBY} value={nearby.data.visibility} onPick={(v) => void saveNearby(v)} onClose={close} />}
      {sheet === 'gifts' && p && <ChoiceSheet title="Quem pode presentear-me" options={WHO} value={p.giftsAllowed} onPick={(v) => void savePrivacy({ giftsAllowed: v })} onClose={close} />}
      {sheet === 'connections' && p && <ChoiceSheet title="Quem vê seguidores e a quem sigo" intro="Os números continuam visíveis; muda só quem pode ver as listas." options={CONNECTIONS} value={p.showConnections} onPick={(v) => void savePrivacy({ showConnections: v })} onClose={close} />}
      {sheet === 'storyReplies' && stories.data && <ChoiceSheet title="Respostas aos mimos" intro="Quem pode responder ou reagir aos teus mimos." options={WHO} value={stories.data.replies} onPick={async (v) => qc.setQueryData(['story-settings'], await api.setStoryReplies(v))} onClose={close} />}
      {sheet === 'closeFriends' && <CloseFriendsSheet onClose={close} />}
      {sheet === 'hidden' && <HiddenSheet onClose={close} />}
      {sheet === 'blocked' && <BlockedSheet onClose={close} />}
      {sheet === 'password' && <PasswordSheet onClose={close} />}
      {sheet === 'devices' && <DevicesSheet onClose={close} />}
      {sheet === 'delete' && <DeleteSheet username={user!.username} onClose={close} onDeleted={out} />}
      {sheet === 'logout' && (
        <Sheet title="Terminar sessão" onClose={close}>
          <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            <Text style={{ textAlign: 'center', fontSize: 18, paddingVertical: 8, color: colors.zinc900 }}>Já vais?</Text>
            <Text style={{ textAlign: 'center', color: colors.zinc600, marginBottom: 20, fontSize: 16 }}>Vais precisar de entrar outra vez para voltar.</Text>
            <Pressable onPress={out} style={st.primary} accessibilityRole="button"><Text style={st.primaryText}>Sim, sair</Text></Pressable>
            <Pressable onPress={close} style={st.ghost} accessibilityRole="button"><Text style={st.ghostText}>Fico por aqui</Text></Pressable>
          </View>
        </Sheet>
      )}
    </StackPage>
  );
}

function PersonRow({ username, displayName, action, onAction }: { username: string; displayName: string; action: string; onAction: () => void }) {
  return (
    <View style={st.person}>
      <Avatar name={displayName} username={username} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} numberOfLines={1}>{displayName}</Text>
        <Text style={{ fontSize: 14, color: colors.zinc600 }} numberOfLines={1}>@{username}</Text>
      </View>
      <Pressable onPress={onAction} style={st.outline} accessibilityRole="button"><Text style={{ fontSize: 14, fontWeight: '600', color: colors.zinc900 }}>{action}</Text></Pressable>
    </View>
  );
}

/** Pessoas a quem escondo os meus mimos. */
function HiddenSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['story-settings'], queryFn: api.storySettings });
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  async function add() {
    const u = name.trim().replace(/^@/, '');
    if (!u) return;
    setErr('');
    try {
      qc.setQueryData(['story-settings'], await api.hideStoryFrom(u));
      setName('');
    } catch (x) {
      setErr(x instanceof ApiError && x.status === 404 ? 'Esse utilizador não existe' : (x as Error).message);
    }
  }
  return (
    <Sheet title="Esconder mimo de…" onClose={onClose} full>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <Text style={{ marginBottom: 12, fontSize: 14, color: colors.zinc600 }}>Estas pessoas deixam de ver os teus mimos, sem serem avisadas.</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={name} onChangeText={setName} placeholder="@utilizador" placeholderTextColor={colors.zinc500} autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => void add()} style={[st.input, { flex: 1 }]} accessibilityLabel="Utilizador" />
          <Pressable onPress={() => void add()} disabled={!name.trim()} style={[st.add, !name.trim() && { opacity: 0.6 }]} accessibilityRole="button"><Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Esconder</Text></Pressable>
        </View>
        <Text style={{ minHeight: 20, paddingTop: 4, fontSize: 14, color: colors.red600 }}>{err}</Text>
        {q.data?.hidden.length === 0 && <Text style={st.none}>Ninguém escondido</Text>}
        {q.data?.hidden.map((h) => <PersonRow key={h.username} username={h.username} displayName={h.displayName} action="Mostrar" onAction={async () => qc.setQueryData(['story-settings'], await api.unhideStoryFrom(h.username))} />)}
      </ScrollView>
    </Sheet>
  );
}

function BlockedSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['blocked'], queryFn: api.blocked });
  return (
    <Sheet title="Contas bloqueadas" onClose={onClose} full>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <Text style={{ marginBottom: 12, fontSize: 14, color: colors.zinc600 }}>Quem bloqueias não vê o teu conteúdo, não te pode seguir nem interagir contigo. Também deixam de ver, no mapa ou de fora, os TxillGroups onde o outro está, e não podem pedir nem entrar neles. A pessoa é avisada de que foi bloqueada.</Text>
        {q.data?.length === 0 && <Text style={st.none}>Não bloqueaste ninguém</Text>}
        {q.data?.map((b) => <PersonRow key={b.username} username={b.username} displayName={b.displayName} action="Desbloquear" onAction={async () => { qc.setQueryData(['blocked'], await api.unblock(b.username)); void qc.invalidateQueries({ queryKey: ['profile'] }); }} />)}
      </ScrollView>
    </Sheet>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  async function submit() {
    if (next.length < 10) return setErr('A nova senha precisa de pelo menos 10 caracteres');
    if (next !== again) return setErr('As duas senhas novas não são iguais');
    setBusy(true);
    setErr('');
    try {
      await api.changePassword(cur, next);
      setOk(true);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (ok) {
    return (
      <Sheet title="Senha alterada" onClose={onClose}>
        <View style={{ paddingHorizontal: 20 }}>
          <Text style={{ textAlign: 'center', color: colors.zinc700, paddingVertical: 12, fontSize: 16 }}>As sessões nos outros dispositivos foram terminadas.</Text>
          <Pressable onPress={onClose} style={st.primary} accessibilityRole="button"><Text style={st.primaryText}>Feito</Text></Pressable>
        </View>
      </Sheet>
    );
  }
  return (
    <Sheet title="Alterar senha" onClose={onClose}>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <TextInput value={cur} onChangeText={setCur} placeholder="Senha atual" placeholderTextColor={colors.zinc500} secureTextEntry autoComplete="current-password" style={st.input} accessibilityLabel="Senha atual" />
        <TextInput value={next} onChangeText={setNext} placeholder="Nova senha (mínimo 10 caracteres)" placeholderTextColor={colors.zinc500} secureTextEntry autoComplete="new-password" style={st.input} accessibilityLabel="Nova senha" />
        <TextInput value={again} onChangeText={setAgain} placeholder="Repete a nova senha" placeholderTextColor={colors.zinc500} secureTextEntry autoComplete="new-password" style={st.input} accessibilityLabel="Repete a nova senha" />
        <Text style={{ minHeight: 20, textAlign: 'center', fontSize: 14, color: colors.red600 }}>{err}</Text>
        <Pressable onPress={() => void submit()} disabled={busy || !cur || !next} style={[st.primary, (busy || !cur || !next) && { opacity: 0.5 }]} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryText}>Alterar senha</Text>}
        </Pressable>
      </View>
    </Sheet>
  );
}

function DevicesSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['devices'], queryFn: api.sessions });
  const refresh = () => qc.invalidateQueries({ queryKey: ['devices'] });
  const others = (q.data ?? []).filter((d) => !d.current);
  return (
    <Sheet title="Dispositivos" onClose={onClose} full>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <Text style={{ marginBottom: 12, fontSize: 14, color: colors.zinc600 }}>Sítios onde a tua conta está com sessão iniciada. Não reconheces algum? Termina-o.</Text>
        {q.isLoading && <ActivityIndicator style={{ margin: 24 }} color={colors.brand} />}
        {q.data?.map((d) => (
          <View key={d.id} style={st.person}>
            <View style={[st.icon, { width: 44, height: 44, borderRadius: 22 }]}><Icon name={/Android|iOS/.test(d.device) ? 'phone' : 'laptop'} size={22} color={colors.zinc800} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} numberOfLines={1}>{d.device}{d.current ? '  ' : ''}{d.current ? <Text style={{ fontSize: 12, fontWeight: '700', color: '#166534', backgroundColor: '#dcfce7' }}> Este dispositivo </Text> : null}</Text>
              <Text style={{ fontSize: 14, color: colors.zinc600 }}>Última atividade {timeAgo(d.lastUsed).toLowerCase()}</Text>
            </View>
            {!d.current && <Pressable onPress={async () => { await api.revokeSession(d.id); void refresh(); }} style={st.outline} accessibilityRole="button"><Text style={{ fontSize: 14, fontWeight: '600', color: colors.zinc900 }}>Terminar</Text></Pressable>}
          </View>
        ))}
        {others.length > 0 && <Pressable onPress={async () => { await api.revokeOtherSessions(); void refresh(); }} style={[st.ghost, { marginTop: 12 }]} accessibilityRole="button"><Text style={st.ghostText}>Terminar em todos os outros</Text></Pressable>}
      </ScrollView>
    </Sheet>
  );
}

function DeleteSheet({ username, onClose, onDeleted }: { username: string; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const can = confirm.replace(/^@/, '').toLowerCase() === username.toLowerCase();
  async function submit() {
    setBusy(true);
    setErr('');
    try {
      await api.deleteAccount(confirm, password || undefined);
      onDeleted();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }
  return (
    <Sheet title="Eliminar conta" onClose={onClose} full>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, gap: 12 }}>
        <View style={{ borderRadius: 16, backgroundColor: '#fef2f2', padding: 16 }}>
          <Text style={{ fontWeight: '700', color: '#7f1d1d', fontSize: 14 }}>Isto não se desfaz.</Text>
          {['O teu nome, @, bio, foto e email são apagados.', 'Publicações, fotos, mimos, conversas, chamadas, seguidores e notificações são apagados.', 'Também saem check-ins, músicas favoritas, aparelhos, locais que segues, as tuas respostas e votos nos TxillGroups, os pedidos para entrar em grupos e tudo o que é do mapa.', 'Sais dos teus TxillGroups. Os locais que criaste passam para o administrador mais antigo; sem ele, deixam de aparecer.', 'Os teus comentários (também em posts de outras pessoas) e as mensagens que enviaste nos TxillGroups são apagados.', 'Os movimentos de Txills ficam registados sem dados pessoais.'].map((t) => <Text key={t} style={{ marginTop: 4, fontSize: 14, lineHeight: 20, color: '#7f1d1d' }}>• {t}</Text>)}
        </View>
        <TextInput value={confirm} onChangeText={setConfirm} placeholder={`Escreve @${username} para confirmar`} placeholderTextColor={colors.zinc500} autoCapitalize="none" autoCorrect={false} style={st.input} accessibilityLabel="Confirmar o teu @" />
        <TextInput value={password} onChangeText={setPassword} placeholder="A tua senha (se a conta tiver)" placeholderTextColor={colors.zinc500} secureTextEntry autoComplete="current-password" style={st.input} accessibilityLabel="Senha" />
        <Text style={{ minHeight: 20, textAlign: 'center', fontSize: 14, color: colors.red600 }}>{err}</Text>
        <Pressable onPress={() => void submit()} disabled={busy || !can} style={[st.danger, (busy || !can) && { opacity: 0.5 }]} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryText}>Eliminar a minha conta</Text>}
        </Pressable>
        <Pressable onPress={onClose} style={st.ghost} accessibilityRole="button"><Text style={st.ghostText}>Cancelar</Text></Pressable>
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  me: { marginHorizontal: 16, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 24, backgroundColor: '#fff', padding: 16, boxShadow: '0 2px 16px rgba(0,0,0,0.09)' },
  sectionTitle: { paddingHorizontal: 20, paddingBottom: 8, fontSize: 14, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.zinc600 },
  card: { marginHorizontal: 16, overflow: 'hidden', borderRadius: 24, backgroundColor: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,0.09)' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: 16, fontWeight: '500', color: colors.zinc900 },
  labelB: { fontSize: 16, fontWeight: '500', color: colors.zinc900 },
  text: { fontSize: 14, color: colors.zinc600 },
  value: { maxWidth: '40%', fontSize: 14, color: colors.zinc600 },
  chev: { fontSize: 22, color: colors.zinc300 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, paddingHorizontal: 16, paddingVertical: 14 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  gender: { flex: 1, minHeight: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, backgroundColor: '#fff' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  outline: { borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, paddingHorizontal: 16, paddingVertical: 8 },
  input: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  add: { borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  none: { paddingVertical: 24, textAlign: 'center', color: colors.zinc600, fontSize: 16 },
  primary: { height: 54, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  danger: { height: 54, borderRadius: 999, backgroundColor: '#b91c1c', alignItems: 'center', justifyContent: 'center' },
  ghost: { marginTop: 12, height: 50, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 16, fontWeight: '600', color: colors.zinc800 },
});
