import { useState } from 'react';
import { Platform } from 'react-native';
import { BookmarkIcon } from '@/components/BookmarkIcon';
import { FindContacts } from '@/components/FindContacts';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';

/** Conteúdo e o teu algoritmo: o que vês, o que guardas, a geleira, as estatísticas, o teu local e os convites. */
export default function ContentSettings() {
  const [contacts, setContacts] = useState(false);
  return (
    <SettingsPage title="Conteúdo e o teu algoritmo">
      <SettingsSection title="O que vês">
        <SettingRow anchor="algorithm" icon="sliders" title="O teu algoritmo" description="Ver mais ou menos de cada tema nas Tchekas" to="/reels/filtros" />
        <SettingRow anchor="saved" icon={<BookmarkIcon on={false} size={22} />} title="Guardados" to="/saved" />
        <SettingRow anchor="geleira" icon="snowflake" title="A minha geleira" to="/geleira" />
      </SettingsSection>
      <SettingsSection title="O teu perfil">
        <SettingRow anchor="insights" icon="trending" title="Estatísticas do perfil" to="/insights" />
        <SettingRow anchor="locais" icon="map-pin" title="Tenho um local (bar, restaurante…)" to="/locais" />
      </SettingsSection>
      <SettingsSection title="Amigos">
        <SettingRow anchor="invites" icon="user-plus" title="Convida a tua malta" to="/invites" />
        {Platform.OS === 'web' ? <SettingRow anchor="contacts" icon="users" title="Encontrar amigos nos contactos" onPress={() => setContacts(true)} /> : null}
      </SettingsSection>
      {contacts && <FindContacts onClose={() => setContacts(false)} />}
    </SettingsPage>
  );
}
