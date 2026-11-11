import { useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { PushOffBanner, showsOffBanner, useDeviceNotifications } from '@/components/PushReminder';
import { api } from '@/lib/api';
import { pushApi } from '@/lib/api.settings';
import { buildId, checkForUpdate, disablePush, enablePush, hardReload, installApp, installState, pushState } from '@/lib/push';
import { NOTIFY_LABELS, notifyEntryId } from '@/lib/settingsIndex';
import { SettingRow, SettingsSection } from './SettingRow';

/** Cada tipo de aviso liga-se ou desliga-se. Os pedidos de seguir ficam sempre na lista. */
export function NotifyPrefs() {
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
    <SettingsSection title="O que me pode notificar">
      {q.data.categories.filter((c) => NOTIFY_LABELS[c]).map((c) => (
        <SettingRow key={c} anchor={notifyEntryId(c)} icon="bell" title={NOTIFY_LABELS[c][0]} description={NOTIFY_LABELS[c][1]} toggle={{ on: !off.includes(c), onChange: (v) => void set(c, v) }} />
      ))}
    </SettingsSection>
  );
}

/** Linha "Instalar a app" (só na web): instalar com um toque no Android, instruções no iPhone. */
export function InstallRow() {
  const [state, setState] = useState(installState());
  if (state === 'none') return null;
  if (state === 'installed') return <SettingRow anchor="installApp" icon="check-circle" title="App instalada" />;
  const how = state === 'ios' ? 'No Safari: toca em Partilhar (o quadrado com a seta) e depois em "Adicionar ao ecrã principal".' : 'Para instalar no iPhone, abre este endereço no Safari.';
  return <SettingRow anchor="installApp" icon="phone" title="Instalar a app" description="No ecrã principal, como as outras apps" onPress={() => (state === 'prompt' ? void installApp().then(() => setState(installState())) : window.alert(how))} />;
}

/** Ligar ou desligar as notificações no telemóvel (Web Push). Funciona na app instalada, em HTTPS. */
export function PushToggle({ onChange }: { onChange?: () => void }) {
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
    <>
      <SettingRow anchor="deviceNotif" icon="bell" title="Notificações no telemóvel" description={text} tone={err ? 'error' : undefined} toggle={{ on, disabled: !available || busy, onChange: (v) => void (v ? enable() : disable()) }} />
      {on ? <SettingRow icon="send" title="Enviar notificação de teste" description="Para ver se chegam a este aparelho" onPress={() => { setErr(''); pushApi.pushTest().catch((x: Error) => setErr(x.message)); }} /> : null}
    </>
  );
}

/**
 * Notificações neste aparelho: se estiverem desligadas, a faixa com "Ligar notificações" (a mesma do lembrete).
 * Na web também a linha de instalar a app e o interruptor do Web Push; na app nativa a faixa ou, ligadas, o estado.
 */
export function DeviceNotifications() {
  const [rev, setRev] = useState(0);
  // Ligou pela faixa (ou nas definições do sistema): o interruptor volta a ler o estado.
  const { device, refresh } = useDeviceNotifications(() => setRev((r) => r + 1));
  const off = showsOffBanner(device);
  const banner = off ? <PushOffBanner device={device} onRefresh={refresh} /> : null;
  if (Platform.OS !== 'web') {
    return (
      <SettingsSection title="Neste aparelho">
        {banner ?? (device ? <SettingRow anchor="deviceNotif" icon="bell" title="Notificações no telemóvel" value="Ligadas" description="Para as desligar, usa as definições do telemóvel." /> : null)}
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title="Neste aparelho">
      {banner}
      <InstallRow />
      <PushToggle key={rev} onChange={refresh} />
    </SettingsSection>
  );
}

/** A versão da app e o botão para procurar já uma atualização (e, se ficar presa, recarregar do zero). */
export function VersionRows() {
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'updating' | 'error'>('idle');
  async function check() {
    setState('checking');
    setState(await checkForUpdate());
  }
  const busy = state === 'checking' || state === 'updating';
  const version = `${Constants.expoConfig?.version ?? '?'}${buildId() ? ` (build ${buildId()!.slice(0, 8)})` : ''}`;
  return (
    <SettingsSection title="Versão">
      <SettingRow anchor="version" icon="info" title="Txillapp" value={`versão ${version}`} />
      {Platform.OS === 'web' ? (
        <SettingRow
          icon="download"
          title={state === 'checking' ? 'A procurar…' : state === 'updating' ? 'A atualizar…' : 'Procurar atualização'}
          description={state === 'latest' ? 'Já tens a versão mais recente.' : state === 'error' ? 'Não consegui procurar. Tenta outra vez.' : undefined}
          tone={state === 'error' ? 'error' : undefined}
          onPress={busy ? undefined : () => void check()}
        />
      ) : null}
      {Platform.OS === 'web' && (state === 'latest' || state === 'error') ? <SettingRow icon="repeat" title="Ainda vês a versão antiga? Recarregar do zero" onPress={() => void hardReload()} /> : null}
    </SettingsSection>
  );
}

/** Mostra o país onde estás: é a rede que vês. */
export function RegionRow() {
  const geo = useQuery({ queryKey: ['geo'], queryFn: api.geo, staleTime: 5 * 60_000 });
  const code = geo.data?.country;
  let name = 'Não consegui saber';
  if (code) {
    try { name = new Intl.DisplayNames(['pt'], { type: 'region' }).of(code) ?? code; } catch { name = code; }
  }
  return <SettingRow anchor="region" icon="map-pin" title={`A tua região: ${geo.isLoading ? '…' : name}`} description="Cada país é a sua rede: sugestões, Tcheka e pesquisa mostram o que é daqui. Quem segues vês sempre." />;
}
