import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BookmarkIcon } from '@/components/BookmarkIcon';
import { FindContacts } from '@/components/FindContacts';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { ChoiceSheet } from '@/components/settings/ChoiceSheet';
import { setDataSaverMode, useDataSaverMode } from '@/lib/dataSaver';
import type { DataSaverMode } from '@/lib/dataSaverRules';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { usePrivacy } from '@/components/settings/usePrivacy';
import { ApiError } from '@/lib/api';
import { soundsApi } from '@/lib/api.sounds';
import { settingsApi, type GeleiraSettings } from '@/lib/api.settings';
import { reuseSetting } from '@/lib/sounds';
import { downloadSetting } from '@/lib/tchekaDownload';
import { repostSetting } from '@/lib/repost';
import { showToast } from '@/lib/toast';
import { t } from '@/lib/i18n';

/** Conteúdo e o teu algoritmo: o que vês, o que guardas, a geleira, os reposts das tuas publicações, as tchekas (duetos, o teu som e guardá-las), as estatísticas, o teu local e os convites. */
export default function ContentSettings() {
  const [contacts, setContacts] = useState(false);
  const saverMode = useDataSaverMode();
  const [saverOpen, setSaverOpen] = useState(false);
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
      showToast(e instanceof ApiError && e.message ? e.message : t('Não consegui mudar isto agora. Tenta outra vez.'));
    }
  }
  // «Deixar guardar as minhas tchekas» (0153): ligado por omissão; numa conta privada (ou de menor) fica desligado e bloqueado.
  const dl = useQuery({ queryKey: ['downloads', 'settings'], queryFn: settingsApi.downloadSettings, retry: false });
  const dlRow = downloadSetting(dl.data);
  async function setDownloads(on: boolean) {
    const before = dl.data;
    if (before) qc.setQueryData(['downloads', 'settings'], { ...before, allow: on, effective: on });
    try {
      qc.setQueryData(['downloads', 'settings'], await settingsApi.setDownloadSettings(on));
    } catch (e) {
      qc.setQueryData(['downloads', 'settings'], before);
      showToast(e instanceof ApiError && e.message ? e.message : t('Não consegui mudar isto agora. Tenta outra vez.'));
    }
  }
  // «Deixar repostar as minhas publicações» (0156): ligado por omissão (as contas que já eram privadas ficaram desligadas).
  const rp = useQuery({ queryKey: ['reposts', 'settings'], queryFn: settingsApi.repostSettings, retry: false });
  const rpRow = repostSetting(rp.data);
  async function setReposts(on: boolean) {
    const before = rp.data;
    if (before) qc.setQueryData(['reposts', 'settings'], { ...before, allow: on });
    try {
      qc.setQueryData(['reposts', 'settings'], await settingsApi.setRepostSettings(on));
    } catch (e) {
      qc.setQueryData(['reposts', 'settings'], before);
      showToast(e instanceof ApiError && e.message ? e.message : t('Não consegui mudar isto agora. Tenta outra vez.'));
    }
  }
  // «Mostrar o livro das geladas a quem vê a geleira» (0145): desligado por omissão; servidor antigo não manda (sem linha).
  const gel = useQuery({ queryKey: ['geleira', 'settings'], queryFn: settingsApi.geleiraSettings, retry: false });
  async function setBook(on: boolean) {
    const before = gel.data;
    if (before) qc.setQueryData<GeleiraSettings>(['geleira', 'settings'], { ...before, bookPublic: on });
    try {
      qc.setQueryData(['geleira', 'settings'], await settingsApi.setGeleiraSettings({ bookPublic: on }));
      void qc.invalidateQueries({ queryKey: ['gelada-book'] });
    } catch (e) {
      qc.setQueryData(['geleira', 'settings'], before);
      showToast(e instanceof ApiError && e.message ? e.message : t('Não consegui mudar isto agora. Tenta outra vez.'));
    }
  }
  const saverOptions: { value: DataSaverMode; title: string; text: string }[] = [
    { value: 'off', title: t('Desligado'), text: t('Fotos na melhor qualidade e os vídeos do feed a tocar sozinhos.') },
    { value: 'mobile', title: t('Só nos dados móveis'), text: t('No Wi-Fi fica tudo igual; nos dados móveis a app poupa.') },
    { value: 'always', title: t('Sempre'), text: t('Poupa também no Wi-Fi.') },
  ];
  const saverLabel = saverOptions.find((o) => o.value === saverMode)?.title ?? '';
  return (
    <SettingsPage title={t('Conteúdo e o teu algoritmo')}>
      <SettingsSection title={t('Dados e megas')}>
        <SettingRow
          anchor="dataSaver"
          icon="bolt"
          title={t('Poupar megas')}
          value={saverLabel}
          description={t('Fotos mais leves, vídeos do feed só quando tocas e nada descarregado antes do tempo. Gasta bem menos dados.')}
          onPress={() => setSaverOpen(true)}
        />
      </SettingsSection>
      <SettingsSection title={t('O que vês')}>
        <SettingRow anchor="algorithm" icon="sliders" title={t('O teu algoritmo')} description={t('Ver mais ou menos de cada tema nas Tchekas')} to="/reels/filtros" />
        <SettingRow anchor="saved" icon={<BookmarkIcon on={false} size={22} />} title={t('Guardados')} to="/saved" />
        <SettingRow anchor="geleira" icon="snowflake" title={t('A minha geleira')} to="/geleira" />
        {typeof gel.data?.bookPublic === 'boolean' ? (
          <SettingRow
            anchor="geladaBook"
            icon="cheers"
            title={t('Mostrar o livro das geladas a quem vê a geleira')}
            description={gel.data.bookPublic ? t('Quem pode ver a tua geleira vê quem te deve e a quem deves.') : t('Desligado: cada pessoa só vê o que há entre vocês os dois.')}
            toggle={{ on: gel.data.bookPublic, onChange: (v) => void setBook(v) }}
          />
        ) : null}
      </SettingsSection>
      {rp.data ? (
        <SettingsSection title={t('As tuas publicações')}>
          <SettingRow anchor="allowReposts" icon="repeat" title={t('Deixar repostar as minhas publicações')} description={rpRow.description} toggle={{ on: rpRow.on, disabled: rpRow.disabled, onChange: (v) => void setReposts(v) }} />
        </SettingsSection>
      ) : null}
      <SettingsSection title={t('As tuas tchekas')}>
        {p ? (
          <SettingRow
            anchor="remix"
            icon="film"
            title={t('Deixar fazer duetos e respostas com as minhas tchekas')}
            description={p.isPrivate
              ? t('A tua conta é privada: ninguém faz duetos com as tuas tchekas nem responde com tcheka aos teus comentários.')
              : t('Outras pessoas podem pôr as tuas tchekas ao lado do vídeo delas (dueto), com o teu vídeo e o teu som, e responder com uma tcheka aos teus comentários. Desligado, os que já existem ficam.')}
            toggle={{ on: remixOn, disabled: p.isPrivate, onChange: (v) => void save({ remixAllowed: v }) }}
          />
        ) : null}
        {sounds.data ? (
          <SettingRow anchor="soundReuse" icon="music" title={t('Deixar usar o meu som')} description={reuse.description} toggle={{ on: reuse.on, disabled: reuse.disabled, onChange: (v) => void setReuse(v) }} />
        ) : null}
        {dl.data ? (
          <SettingRow anchor="allowDownloads" icon="download" title={t('Deixar guardar as minhas tchekas')} description={dlRow.description} toggle={{ on: dlRow.on, disabled: dlRow.disabled, onChange: (v) => void setDownloads(v) }} />
        ) : null}
        <SettingRow anchor="mySounds" icon="music" title={t('Os meus sons')} description={t('Os sons das tuas tchekas e «Retirar o som», que o tira de todo o lado.')} to="/settings/sons" />
      </SettingsSection>
      <SettingsSection title={t('O teu perfil')}>
        <SettingRow anchor="insights" icon="trending" title={t('Estatísticas do perfil')} to="/insights" />
        <SettingRow anchor="locais" icon="map-pin" title={t('Tenho um local (bar, restaurante…)')} to="/locais" />
      </SettingsSection>
      <SettingsSection title={t('Amigos')}>
        <SettingRow anchor="invites" icon="user-plus" title={t('Convida a tua malta')} to="/invites" />
        <SettingRow anchor="contacts" icon="users" title={t('Encontrar amigos nos contactos')} onPress={() => setContacts(true)} />
      </SettingsSection>
      {contacts && <FindContacts onClose={() => setContacts(false)} />}
      {saverOpen ? (
        <ChoiceSheet
          title={t('Poupar megas')}
          intro={t('Os megas são caros. Com isto ligado, as fotos vêm mais leves, os vídeos do feed só descarregam quando lhes tocas e a app não descarrega o mimo nem a tcheka seguinte antes do tempo.')}
          options={saverOptions}
          value={saverMode}
          onPick={(v) => { void setDataSaverMode(v); setSaverOpen(false); showToast(v === 'off' ? t('Poupar megas desligado') : t('Poupar megas ligado')); }}
          onClose={() => setSaverOpen(false)}
        />
      ) : null}
    </SettingsPage>
  );
}
