import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ChoiceSheet } from '@/components/settings/ChoiceSheet';
import { CALLS, WHO, callsLabel, whoLabel } from '@/components/settings/options';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { usePrivacy } from '@/components/settings/usePrivacy';

/** Mensagens e chamadas: quem te escreve, onde estão as opções de cada conversa (temporárias e limpar), os teus Mixar, quem te liga, esconder o IP nas chamadas e o registo de chamadas. */
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
      {/* Estas são de cada conversa (menu «⋯»), não da conta: a linha diz onde estão e leva às Mensagens. A das capturas só explica. */}
      <SettingsSection title="Em cada conversa">
        <SettingRow anchor="temporaryMessages" icon="clock" title="Mensagens temporárias" description="No menu ⋯ da conversa. As mensagens novas desaparecem para todos ao fim de 24 horas, 7 dias ou 90 dias. A dois muda qualquer um; num TxillGroup, só quem administra." to="/messages" />
        <SettingRow anchor="clearChat" icon="trash" title="Limpar conversa" description="No menu ⋯ da conversa. As mensagens desaparecem só para ti: os outros continuam a vê-las." to="/messages" />
        {/* Só informa: a API não tem opção para desligar os avisos de captura (POST .../screenshot). */}
        <SettingRow anchor="screenshots" icon="camera" title="Capturas de ecrã" description="Na app, no iPhone e no Android 14 ou mais recente, uma captura numa conversa deixa o aviso «Fulano fez uma captura de ecrã.» e avisa os outros. Não se desliga. O Zás dos outros não se captura na app." />
      </SettingsSection>
      {/* Mixar (API: src/mixar, 0150): não tem opções próprias na API. Quem te convida segue «Quem pode enviar-me mensagens»; a linha explica e leva aos teus Mixar. */}
      <SettingsSection title="Mixar">
        <SettingRow anchor="mixar" icon="sparkles" title="Os meus Mixar" description="Os feeds a dois que tens e os convites. Só te convida quem te pode enviar mensagens. Para sair, abre o Mixar, toca no nome em cima e em «Sair do Mixar»." to="/mixar" />
      </SettingsSection>
      <SettingsSection title="Chamadas">
        <SettingRow anchor="calls" icon="phone" title="Quem me pode ligar" value={p ? callsLabel(p.callsAllowed ?? 'mutual') : '…'} onPress={() => setSheet('calls')} />
        {p && relayAvailable ? <SettingRow anchor="relay" icon="shield" title="Esconder o meu IP nas chamadas" description="A chamada passa sempre pelo servidor do Txillapp, e quem está do outro lado não vê o teu endereço. Pode ficar um pouco mais lenta." toggle={{ on: !!p.callsRelayOnly, onChange: (v) => void save({ callsRelayOnly: v }) }} /> : null}
        <SettingRow anchor="callLog" icon="clock" title="Registo de chamadas" to="/calls" />
      </SettingsSection>
      {sheet === 'dms' && p && <ChoiceSheet title="Quem pode enviar-me mensagens" intro="Só trava conversas novas: as que já existem continuam. Também decide quem te pode pôr num TxillGroup e convidar para um Mixar. As respostas aos teus mimos seguem a definição dos mimos." options={WHO} value={p.dmsAllowed} onPick={(v) => void save({ dmsAllowed: v })} onClose={close} />}
      {sheet === 'calls' && p && <ChoiceSheet title="Quem me pode ligar" intro="Chamadas de voz e videochamadas. Quem bloqueaste nunca te liga. O Txillapp não grava chamadas: fica só o registo, que podes apagar em Chamadas." options={CALLS} value={p.callsAllowed ?? 'mutual'} onPick={(v) => void save({ callsAllowed: v })} onClose={close} />}
    </SettingsPage>
  );
}
