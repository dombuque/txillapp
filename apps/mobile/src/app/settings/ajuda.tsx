import { VersionRows } from '@/components/settings/device';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { t } from '@/lib/i18n';

/** Ajuda e sobre: a ajuda, os termos, a política de privacidade, o Sobre e a versão (com procurar atualização). */
export default function HelpSettings() {
  return (
    <SettingsPage title={t('Ajuda e sobre')}>
      <SettingsSection>
        <SettingRow anchor="help" icon="info" title={t('Ajuda')} description={t('Perguntas frequentes')} to="/help" />
        <SettingRow anchor="about" icon="shield" title={t('Sobre')} value={t('Perfil, privacidade e termos')} to="/about" />
      </SettingsSection>
      <SettingsSection title={t('Documentos')}>
        <SettingRow anchor="terms" icon="file-text" title={t('Termos de utilização')} to="/terms" />
        <SettingRow anchor="privacyPolicy" icon="lock" title={t('Política de privacidade')} to="/privacy" />
      </SettingsSection>
      <VersionRows />
    </SettingsPage>
  );
}
