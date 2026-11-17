import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { t } from '@/lib/i18n';

/** Aparência e idioma: o idioma da app e as traduções; o tema (por agora só o claro). */
export default function AppearanceSettings() {
  return (
    <SettingsPage title={t('Aparência e idioma')}>
      <SettingsSection title={t('Idioma')}>
        <SettingRow anchor="language" icon="globe" title={t('Idioma e traduções')} value={t('Português')} to="/language" />
      </SettingsSection>
      <SettingsSection title={t('Aparência')}>
        <SettingRow anchor="theme" icon="sun" title={t('Tema')} value={t('Claro')} description={t('O modo escuro ainda não existe na app.')} locked />
      </SettingsSection>
    </SettingsPage>
  );
}
