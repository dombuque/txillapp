import { VersionRows } from '@/components/settings/device';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';

/** Ajuda e sobre: a ajuda, os termos, a política de privacidade, o Sobre e a versão (com procurar atualização). */
export default function HelpSettings() {
  return (
    <SettingsPage title="Ajuda e sobre">
      <SettingsSection>
        <SettingRow anchor="help" icon="info" title="Ajuda" description="Perguntas frequentes" to="/help" />
        <SettingRow anchor="about" icon="shield" title="Sobre" value="Perfil, privacidade e termos" to="/about" />
      </SettingsSection>
      <SettingsSection title="Documentos">
        <SettingRow anchor="terms" icon="file-text" title="Termos de utilização" to="/terms" />
        <SettingRow anchor="privacyPolicy" icon="lock" title="Política de privacidade" to="/privacy" />
      </SettingsSection>
      <VersionRows />
    </SettingsPage>
  );
}
