import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { languageName, t } from '@/lib/i18n';

/** Aparência e idioma: os idiomas da app (ecrã «Idiomas») e o tema (por agora só o claro). */
export default function AppearanceSettings() {
  return (
    <SettingsPage title={t('Aparência e idioma')}>
      <SettingsSection title={t('Idioma')}>
        <SettingRow anchor="language" icon="globe" title={t('Idiomas')} value={languageName()} to="/language" />
      </SettingsSection>
      <SettingsSection title={t('Aparência')}>
        <SettingRow anchor="theme" icon="sun" title={t('Tema')} value={t('Claro')} description={t('O modo escuro ainda não existe na app.')} locked />
      </SettingsSection>
    </SettingsPage>
  );
}
