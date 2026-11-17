import { useState } from 'react';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { PasswordSheet } from '@/components/settings/sheets';
import { t } from '@/lib/i18n';

/** Segurança: a senha e os aparelhos onde a conta tem sessão iniciada (o ecrã /settings/aparelhos). */
export default function SecuritySettings() {
  const [password, setPassword] = useState(false);
  return (
    <SettingsPage title={t('Segurança')}>
      <SettingsSection>
        <SettingRow anchor="password" icon="key" title={t('Alterar senha')} description={t('Ao mudar, as sessões nos outros aparelhos terminam')} onPress={() => setPassword(true)} />
        <SettingRow anchor="devices" icon="laptop" title={t('Os teus aparelhos')} description={t('Onde a tua conta tem sessão iniciada')} to="/settings/aparelhos" />
      </SettingsSection>
      {password && <PasswordSheet onClose={() => setPassword(false)} />}
    </SettingsPage>
  );
}
