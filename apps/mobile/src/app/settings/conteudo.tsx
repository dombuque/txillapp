import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';
import { BookmarkIcon } from '@/components/BookmarkIcon';
import { FindContacts } from '@/components/FindContacts';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { usePrivacy } from '@/components/settings/usePrivacy';
import { ApiError } from '@/lib/api';
import { soundsApi } from '@/lib/api.sounds';
import { reuseSetting } from '@/lib/sounds';

/** Conteúdo e o teu algoritmo: o que vês, o que guardas, a geleira, as tchekas (duetos e o teu som), as estatísticas, o teu local e os convites. */
export default function ContentSettings() {
  const [contacts, setContacts] = useState(false);
  const qc = useQueryClient();
  const { p, save } = usePrivacy();
  // Numa conta privada ninguém faz remix (o dueto é público e levava as tuas tchekas para fora dos seguidores).
  const remixOn = !!p && !p.isPrivate && p.remixAllowed !== false;
  // «Deixar usar o meu som» (docs/sons.md): ligado por omissão; numa conta privada (ou de menor) fica desligado.
  const sounds = useQuery({ queryKey: ['sounds', 'settings'], queryFn: soundsApi.settings, retry: false });
  const reuse = reuseSetting(sounds.data);
  async function setReuse(on: boolean) {
    const before = sounds.data;
    if (before) qc.setQueryData(['sounds', 'settings'], { ...before, reuse: on, effective: on });
    try {
      qc.setQueryData(['sounds', 'settings'], await soundsApi.setSettings(on));
    } catch (e) {
      qc.setQueryData(['sounds', 'settings'], before);
      Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : 'Não consegui mudar isto agora. Tenta outra vez.');
    }
  }
  return (
    <SettingsPage title="Conteúdo e o teu algoritmo">
      <SettingsSection title="O que vês">
        <SettingRow anchor="algorithm" icon="sliders" title="O teu algoritmo" description="Ver mais ou menos de cada tema nas Tchekas" to="/reels/filtros" />
        <SettingRow anchor="saved" icon={<BookmarkIcon on={false} size={22} />} title="Guardados" to="/saved" />
        <SettingRow anchor="geleira" icon="snowflake" title="A minha geleira" to="/geleira" />
      </SettingsSection>
      <SettingsSection title="As tuas tchekas">
        {p ? (
          <SettingRow
            anchor="remix"
            icon="film"
            title="Deixar fazer duetos e respostas com as minhas tchekas"
            description={p.isPrivate
              ? 'A tua conta é privada: ninguém faz duetos com as tuas tchekas nem responde com tcheka aos teus comentários.'
              : 'Outras pessoas podem gravar ao lado das tuas tchekas (dueto) e responder com uma tcheka aos teus comentários. Desligado, os que já existem ficam.'}
            toggle={{ on: remixOn, disabled: p.isPrivate, onChange: (v) => void save({ remixAllowed: v }) }}
          />
        ) : null}
        {sounds.data ? (
          <SettingRow anchor="soundReuse" icon="music" title="Deixar usar o meu som" description={reuse.description} toggle={{ on: reuse.on, disabled: reuse.disabled, onChange: (v) => void setReuse(v) }} />
        ) : null}
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
