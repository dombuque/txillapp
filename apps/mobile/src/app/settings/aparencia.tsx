import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';

/** Aparência e idioma: o idioma da app e as traduções; o tema (por agora só o claro). */
export default function AppearanceSettings() {
  return (
    <SettingsPage title="Aparência e idioma">
      <SettingsSection title="Idioma">
        <SettingRow anchor="language" icon="globe" title="Idioma e traduções" value="Português" to="/language" />
      </SettingsSection>
      <SettingsSection title="Aparência">
        <SettingRow anchor="theme" icon="sun" title="Tema" value="Claro" description="O modo escuro ainda não existe na app." locked />
      </SettingsSection>
    </SettingsPage>
  );
}
