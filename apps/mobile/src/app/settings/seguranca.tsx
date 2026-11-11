import { useState } from 'react';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { PasswordSheet } from '@/components/settings/sheets';

/** Segurança: a senha e os aparelhos onde a conta tem sessão iniciada (o ecrã /settings/aparelhos). */
export default function SecuritySettings() {
  const [password, setPassword] = useState(false);
  return (
    <SettingsPage title="Segurança">
      <SettingsSection>
        <SettingRow anchor="password" icon="key" title="Alterar senha" description="Ao mudar, as sessões nos outros aparelhos terminam" onPress={() => setPassword(true)} />
        <SettingRow anchor="devices" icon="laptop" title="Os teus aparelhos" description="Onde a tua conta tem sessão iniciada" to="/settings/aparelhos" />
      </SettingsSection>
      {password && <PasswordSheet onClose={() => setPassword(false)} />}
    </SettingsPage>
  );
}
