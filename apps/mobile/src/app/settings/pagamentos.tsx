import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';

/** Txills e pagamentos: a carteira (Txills e presentes) e os pedidos de recarga. */
export default function PaymentSettings() {
  return (
    <SettingsPage title="Txills e pagamentos">
      <SettingsSection>
        <SettingRow anchor="wallet" icon="wallet" title="Txills e presentes" description="O teu saldo e os presentes" to="/wallet" />
        <SettingRow anchor="orders" icon="file-text" title="Pedidos e pagamentos" description="Recarregar Txills e ver os teus pedidos" to="/orders" />
      </SettingsSection>
      <SettingsSection title="Presentes">
        <SettingRow icon="gift" title="Quem pode presentear-me" description="Está em Privacidade" to="/settings/privacidade?o=gifts" />
      </SettingsSection>
    </SettingsPage>
  );
}
