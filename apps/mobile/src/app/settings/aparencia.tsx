import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';

/**
 * Idioma (o grupo `aparencia` das Definições; o id fica pelas ligações antigas). Só o que existe: a app está em português,
 * sem tema nem traduções por vir (App Store 2.1/2.2, Google Play).
 */
export default function LanguageSettings() {
  return (
    <SettingsPage title="Idioma">
      <SettingsSection title="Idioma da app">
        <SettingRow anchor="language" icon="globe" title="Português (Moçambique)" description="A app está em português." />
      </SettingsSection>
    </SettingsPage>
  );
}
