import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { languageName, t } from '@/lib/i18n';

/**
 * Idiomas (o grupo `aparencia` das Definições; o id fica pelas ligações antigas): leva ao ecrã «Idiomas», com o idioma
 * escolhido à direita. Só o que existe, sem tema nem traduções de publicações (App Store 2.1/2.2, Google Play).
 */
export default function LanguageSettings() {
  return (
    <SettingsPage title={t('Idiomas')}>
      <SettingsSection title={t('Idioma da app')}>
        <SettingRow anchor="language" icon="globe" title={t('Idiomas')} value={languageName()} to="/language" />
      </SettingsSection>
    </SettingsPage>
  );
}
