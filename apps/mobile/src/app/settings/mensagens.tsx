import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ChoiceSheet } from '@/components/settings/ChoiceSheet';
import { CALLS, WHO, callsLabel, whoLabel } from '@/components/settings/options';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { usePrivacy } from '@/components/settings/usePrivacy';

/** Mensagens e chamadas: quem te escreve, quem te liga, esconder o IP nas chamadas e o registo de chamadas. */
export default function MessagesSettings() {
  const { p, save } = usePrivacy();
  const [sheet, setSheet] = useState<null | 'dms' | 'calls'>(null);
  const close = () => setSheet(null);
  // "Esconder o meu IP" só aparece quando o servidor de chamadas (TURN) está ligado: sem ele a chamada não ligaria.
  const ice = useQuery({ queryKey: ['calls-ice'], queryFn: () => import('@/lib/calls/api').then((m) => m.callsApi.ice()), staleTime: 30 * 60_000, retry: false });
  const relayAvailable = (ice.data?.iceServers.length ?? 0) > 1;
  return (
    <SettingsPage title="Mensagens e chamadas">
      <SettingsSection title="Mensagens">
        <SettingRow anchor="dms" icon="mail" title="Quem pode enviar-me mensagens" value={p ? whoLabel(p.dmsAllowed) : '…'} onPress={() => setSheet('dms')} />
      </SettingsSection>
      <SettingsSection title="Chamadas">
        <SettingRow anchor="calls" icon="phone" title="Quem me pode ligar" value={p ? callsLabel(p.callsAllowed ?? 'mutual') : '…'} onPress={() => setSheet('calls')} />
        {p && relayAvailable ? <SettingRow anchor="relay" icon="shield" title="Esconder o meu IP nas chamadas" description="A chamada passa sempre pelo servidor do Txillapp, e quem está do outro lado não vê o teu endereço. Pode ficar um pouco mais lenta." toggle={{ on: !!p.callsRelayOnly, onChange: (v) => void save({ callsRelayOnly: v }) }} /> : null}
        <SettingRow anchor="callLog" icon="clock" title="Registo de chamadas" to="/calls" />
      </SettingsSection>
      {sheet === 'dms' && p && <ChoiceSheet title="Quem pode enviar-me mensagens" intro="Só trava conversas novas: as que já existem continuam. Também decide quem te pode pôr num TxillGroup. As respostas aos teus mimos seguem a definição dos mimos." options={WHO} value={p.dmsAllowed} onPick={(v) => void save({ dmsAllowed: v })} onClose={close} />}
      {sheet === 'calls' && p && <ChoiceSheet title="Quem me pode ligar" intro="Chamadas de voz e videochamadas. Quem bloqueaste nunca te liga. O Txillapp não grava chamadas: fica só o registo, que podes apagar em Chamadas." options={CALLS} value={p.callsAllowed ?? 'mutual'} onPick={(v) => void save({ callsAllowed: v })} onClose={close} />}
    </SettingsPage>
  );
}
