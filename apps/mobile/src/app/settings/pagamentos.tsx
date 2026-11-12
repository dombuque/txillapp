import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { usePurchases } from '@/lib/purchases';

/**
 * Txills e pagamentos: a carteira (Txills e presentes) e os pedidos de recarga. Nas versões das lojas não se recarregam
 * Txills por fora da loja (lib/storeRules.ts): fica só a carteira.
 */
export default function PaymentSettings() {
  const rules = usePurchases();
  return (
    <SettingsPage title="Txills e pagamentos">
      <SettingsSection>
        <SettingRow anchor="wallet" icon="wallet" title="Txills e presentes" description="O teu saldo e os presentes" to="/wallet" />
        {rules.buyTxills ? <SettingRow anchor="orders" icon="file-text" title="Pedidos e pagamentos" description="Recarregar Txills e ver os teus pedidos" to="/orders" /> : null}
      </SettingsSection>
      <SettingsSection title="Presentes">
        <SettingRow icon="gift" title="Quem pode presentear-me" description="Está em Privacidade" to="/settings/privacidade?o=gifts" />
      </SettingsSection>
    </SettingsPage>
  );
}
