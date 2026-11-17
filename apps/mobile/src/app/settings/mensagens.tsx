import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ChoiceSheet } from '@/components/settings/ChoiceSheet';
import { CALLS, WHO, callsLabel, whoLabel } from '@/components/settings/options';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { usePrivacy } from '@/components/settings/usePrivacy';
import { t } from '@/lib/i18n';

/** Mensagens e chamadas: quem te escreve, onde estão as opções de cada conversa (temporárias e limpar), os teus Mixar, quem te liga, esconder o IP nas chamadas e o registo de chamadas. */
export default function MessagesSettings() {
  const { p, save } = usePrivacy();
  const [sheet, setSheet] = useState<null | 'dms' | 'calls'>(null);
  const close = () => setSheet(null);
  // "Esconder o meu IP" só aparece quando o servidor de chamadas (TURN) está ligado: sem ele a chamada não ligaria.
  const ice = useQuery({ queryKey: ['calls-ice'], queryFn: () => import('@/lib/calls/api').then((m) => m.callsApi.ice()), staleTime: 30 * 60_000, retry: false });
  const relayAvailable = (ice.data?.iceServers.length ?? 0) > 1;
  return (
    <SettingsPage title={t('Mensagens e chamadas')}>
      <SettingsSection title={t('Mensagens')}>
        <SettingRow anchor="dms" icon="mail" title={t('Quem pode enviar-me mensagens')} value={p ? whoLabel(p.dmsAllowed) : '…'} onPress={() => setSheet('dms')} />
      </SettingsSection>
      {/* Estas são de cada conversa (menu «⋯»), não da conta: a linha diz onde estão e leva às Mensagens. A das capturas só explica. */}
      <SettingsSection title={t('Em cada conversa')}>
        <SettingRow anchor="temporaryMessages" icon="clock" title={t('Mensagens temporárias')} description={t('No menu ⋯ da conversa. As mensagens novas desaparecem para todos ao fim de 24 horas, 7 dias ou 90 dias. A dois muda qualquer um; num TxillGroup, só quem administra.')} to="/messages" />
        <SettingRow anchor="clearChat" icon="trash" title={t('Limpar conversa')} description={t('No menu ⋯ da conversa. As mensagens desaparecem só para ti: os outros continuam a vê-las.')} to="/messages" />
        {/* Só informa: a API não tem opção para desligar os avisos de captura (POST .../screenshot). */}
        <SettingRow anchor="screenshots" icon="camera" title={t('Capturas de ecrã')} description={t('Na app, no iPhone e no Android 14 ou mais recente, uma captura numa conversa deixa o aviso «Fulano fez uma captura de ecrã.» e avisa os outros. Não se desliga. O Zás dos outros não se captura na app.')} />
      </SettingsSection>
      {/* Mixar (API: src/mixar, 0150, 0170 a 0172): quem te convida segue «Quem pode enviar-me mensagens»; a linha explica e leva aos
          teus Mixar. As opções do Mixar estão noutros ecrãs: os avisos em Notificações («Mixar», 0170) e os temas privados em
          Privacidade (0172, /settings/mixar-temas). */}
      <SettingsSection title="Mixar">
        <SettingRow anchor="mixar" icon="mixar" title={t('Os meus Mixar')} description={t('Os feeds a dois que tens e os convites. Só te convida quem te pode enviar mensagens. Para sair, abre o Mixar, toca no nome em cima e em «Sair do Mixar». Os avisos desligam-se em Notificações, «Mixar».')} to="/mixar" />
        <SettingRow icon="lock" title={t('Temas privados no Mixar')} description={t('Temas que nunca aparecem nos teus Mixar, nem na compatibilidade, nos temas em comum, nas sugestões ou no resumo da semana. Também em Privacidade.')} to="/settings/mixar-temas" />
      </SettingsSection>
      <SettingsSection title={t('Chamadas')}>
        <SettingRow anchor="calls" icon="phone" title={t('Quem me pode ligar')} value={p ? callsLabel(p.callsAllowed ?? 'mutual') : '…'} onPress={() => setSheet('calls')} />
        {p && relayAvailable ? <SettingRow anchor="relay" icon="shield" title={t('Esconder o meu IP nas chamadas')} description={t('A chamada passa sempre pelo servidor do Txillapp, e quem está do outro lado não vê o teu endereço. Pode ficar um pouco mais lenta.')} toggle={{ on: !!p.callsRelayOnly, onChange: (v) => void save({ callsRelayOnly: v }) }} /> : null}
        <SettingRow anchor="callLog" icon="clock" title={t('Registo de chamadas')} to="/calls" />
      </SettingsSection>
      {sheet === 'dms' && p && <ChoiceSheet title={t('Quem pode enviar-me mensagens')} intro={t('Só trava conversas novas: as que já existem continuam. Também decide quem te pode pôr num TxillGroup e convidar para um Mixar. As respostas aos teus mimos seguem a definição dos mimos.')} options={WHO} value={p.dmsAllowed} onPick={(v) => void save({ dmsAllowed: v })} onClose={close} />}
      {sheet === 'calls' && p && <ChoiceSheet title={t('Quem me pode ligar')} intro={t('Chamadas de voz e videochamadas. Quem bloqueaste nunca te liga. O Txillapp não grava chamadas: fica só o registo, que podes apagar em Chamadas.')} options={CALLS} value={p.callsAllowed ?? 'mutual'} onPick={(v) => void save({ callsAllowed: v })} onClose={close} />}
    </SettingsPage>
  );
}
