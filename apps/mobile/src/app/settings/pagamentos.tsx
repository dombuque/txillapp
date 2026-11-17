import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { usePurchases } from '@/lib/purchases';
import { t } from '@/lib/i18n';

/**
 * Vibes e pagamentos: a carteira (Vibes e presentes) e os pedidos de recarga. Nas versões das lojas não se recarregam
 * Txills por fora da loja (lib/storeRules.ts): fica só a carteira.
 */
export default function PaymentSettings() {
  const rules = usePurchases();
  return (
    <SettingsPage title={t('Vibes e pagamentos')}>
      <SettingsSection>
        <SettingRow anchor="wallet" icon="wallet" title={t('Vibes e presentes')} description={t('O teu saldo e os presentes')} to="/wallet" />
        {rules.buyTxills ? <SettingRow anchor="orders" icon="file-text" title={t('Pedidos e pagamentos')} description={t('Recarregar vibes e ver os teus pedidos')} to="/orders" /> : null}
      </SettingsSection>
      <SettingsSection title={t('Presentes')}>
        <SettingRow icon="gift" title={t('Quem pode presentear-me')} description={t('Está em Privacidade')} to="/settings/privacidade?o=gifts" />
      </SettingsSection>
    </SettingsPage>
  );
}
