import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CloseFriendsSheet } from '@/components/StoryParts';
import { ChoiceSheet } from '@/components/settings/ChoiceSheet';
import { CONNECTIONS, NEARBY, VIEWERS, WHO, nearbyLabel, viewersLabel, whoLabel } from '@/components/settings/options';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { BlockedSheet, HiddenSheet } from '@/components/settings/sheets';
import { usePrivacy } from '@/components/settings/usePrivacy';
import { ApiError, api } from '@/lib/api';
import { instantsApi, type ZasSettings } from '@/lib/api.geleira';
import { nearbyApi, type NearbyVisibility } from '@/lib/api.nearby';
import { KEEP_OFF_PROMPT } from '@/components/zas/zasRecapLogic';
import { mixarControloApi, mixarControloKeys } from '@/lib/api.mixarControlo';
import { privateCountLabel } from '@/lib/mixarControlo';
import { confirm } from '@/lib/confirm';
import { showToast } from '@/lib/toast';
import { t } from '@/lib/i18n';

type SheetName = null | 'type' | 'connections' | 'nearby' | 'blocked' | 'comments' | 'mentions' | 'gifts' | 'repostsVisible' | 'cheersVisible' | 'giftsVisible' | 'storyReplies' | 'closeFriends' | 'hidden';

/** Privacidade: quem te vê, quem interage contigo, os mimos, os contactos e os dados de uso, e os bloqueados. */
export default function PrivacySettingsScreen() {
  const qc = useQueryClient();
  const { p, save } = usePrivacy();
  const [sheet, setSheet] = useState<SheetName>(null);
  const close = () => setSheet(null);
  const stories = useQuery({ queryKey: ['story-settings'], queryFn: api.storySettings });
  const closeFriends = useQuery({ queryKey: ['close-friends'], queryFn: api.closeFriends });
  const blocked = useQuery({ queryKey: ['blocked'], queryFn: api.blocked });
  // Mixar (0172): os temas privados. Servidor antigo (404): a linha não aparece.
  const mixarPrivate = useQuery({ queryKey: mixarControloKeys.privateTopics(), queryFn: mixarControloApi.privateTopics, retry: false });
  // Aparecer em À tua volta: a mesma chave de cache do mapa, para os dois ecrãs ficarem iguais.
  const nearby = useQuery({ queryKey: ['nearby-settings'], queryFn: nearbyApi.settings, staleTime: 5 * 60_000, retry: false });
  async function saveNearby(v: NearbyVisibility) {
    try {
      const r = await nearbyApi.setSettings(v);
      qc.setQueryData(['nearby-settings'], { ...(nearby.data ?? {}), visibility: r?.visibility ?? v });
      if (v === 'off') void nearbyApi.clearPresence().catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['nearby'] });
    } catch (e) {
      showToast(e instanceof ApiError && e.message ? e.message : t('Não consegui mudar isto agora. Tenta outra vez.'));
    }
  }

  // Zás: «Guardar os meus Zás para o resumo semanal» (ligada por omissão). Servidor antigo (404): a secção não aparece.
  const zas = useQuery({ queryKey: ['zas-settings'], queryFn: instantsApi.settings, retry: false });
  async function saveZasKeep(on: boolean) {
    const before = zas.data;
    qc.setQueryData<ZasSettings>(['zas-settings'], { keepForRecap: on });
    try {
      const r = await instantsApi.setSettings(on);
      qc.setQueryData<ZasSettings>(['zas-settings'], { keepForRecap: r?.keepForRecap ?? on });
      void qc.invalidateQueries({ queryKey: ['zas-recaps'] });
      qc.removeQueries({ queryKey: ['zas-recap'] });
      if (!on && r?.removed) showToast(t('Apagámos {count} Zás guardado.', { count: r.removed, other: 'Apagámos {count} Zás guardados.' }));
    } catch (e) {
      qc.setQueryData(['zas-settings'], before);
      showToast(e instanceof ApiError && e.message ? e.message : t('Não consegui mudar isto agora. Tenta outra vez.'));
    }
  }
  async function toggleZasKeep(on: boolean) {
    // Desligar apaga logo os Zás guardados e o resumo por partilhar: pergunta antes.
    if (on) return void saveZasKeep(true);
    if (await confirm({ title: KEEP_OFF_PROMPT.title, message: KEEP_OFF_PROMPT.message, confirm: KEEP_OFF_PROMPT.confirm, danger: true })) void saveZasKeep(false);
  }

  async function saveStoryReplies(v: Parameters<typeof api.setStoryReplies>[0]) {
    try {
      qc.setQueryData(['story-settings'], await api.setStoryReplies(v));
    } catch (e) {
      showToast(e instanceof ApiError && e.message ? e.message : t('Não consegui mudar isto agora. Tenta outra vez.'));
    }
  }

  return (
    <SettingsPage title={t('Privacidade')}>
      <SettingsSection title={t('O teu perfil')}>
        <SettingRow anchor="accountType" icon={p?.isPrivate ? 'lock' : 'globe'} title={t('Tipo de perfil')} value={p ? (p.isPrivate ? t('Privado') : t('Público')) : '…'} onPress={() => setSheet('type')} />
        <SettingRow anchor="connections" icon="users" title={t('Quem vê seguidores e a quem sigo')} value={p ? CONNECTIONS.find((c) => c.value === p.showConnections)!.title : '…'} onPress={() => setSheet('connections')} />
        {p ? <SettingRow anchor="suggestable" icon="sparkles" title={t('Aparecer nas sugestões')} description={t('Outras pessoas podem descobrir-te.')} toggle={{ on: p.suggestable, onChange: (v) => void save({ suggestable: v }) }} /> : null}
        {p ? <SettingRow anchor="presence" icon="eye" title={t('Mostrar quando estou online')} description={t('Aparece Online ou Visto há… no chat. Se desligares, também não vês o dos outros.')} toggle={{ on: p.showPresence, onChange: (v) => void save({ showPresence: v }) }} /> : null}
        {nearby.data && nearby.data.canEnable !== false ? <SettingRow anchor="nearby" icon="map-pin" title={t('Aparecer em À tua volta')} value={nearbyLabel(nearby.data.visibility)} onPress={() => setSheet('nearby')} /> : null}
      </SettingsSection>

      <SettingsSection title={t('Interações')}>
        <SettingRow anchor="comments" icon="comment" title={t('Quem pode comentar')} value={p ? whoLabel(p.commentsAllowed) : '…'} onPress={() => setSheet('comments')} />
        <SettingRow anchor="mentions" icon="at" title={t('Quem pode mencionar-me')} value={p ? whoLabel(p.mentionsAllowed) : '…'} onPress={() => setSheet('mentions')} />
        <SettingRow anchor="gifts" icon="gift" title={t('Quem pode presentear-me')} value={p ? whoLabel(p.giftsAllowed) : '…'} onPress={() => setSheet('gifts')} />
        <SettingRow icon="messages" title={t('Mensagens e chamadas')} description={t('Quem te pode escrever e quem te pode ligar')} to="/settings/mensagens" />
      </SettingsSection>

      <SettingsSection title={t('Quem vê os nomes')} note={t('Os números continuam visíveis; isto muda só quem pode ver quem foi.')}>
        <SettingRow anchor="repostsVisible" icon="repeat" title={t('Quem vê quem repostou')} value={p ? viewersLabel(p.repostsVisible) : '…'} onPress={() => setSheet('repostsVisible')} />
        <SettingRow anchor="cheersVisible" icon="cheers" title={t('Quem vê quem brindou')} value={p ? viewersLabel(p.cheersVisible) : '…'} onPress={() => setSheet('cheersVisible')} />
        <SettingRow anchor="giftsVisible" icon="gift" title={t('Quem vê quem presenteou')} value={p ? viewersLabel(p.giftsVisible) : '…'} onPress={() => setSheet('giftsVisible')} />
      </SettingsSection>

      <SettingsSection title="Mimos">
        <SettingRow anchor="storyReplies" icon="camera" title={t('Quem pode responder')} value={stories.data ? whoLabel(stories.data.replies) : '…'} onPress={() => setSheet('storyReplies')} />
        <SettingRow anchor="closeFriends" icon="heart" title={t('Amigos próximos')} value={closeFriends.data ? String(closeFriends.data.length) : '…'} onPress={() => setSheet('closeFriends')} />
        <SettingRow anchor="hiddenStory" icon="eye-off" title={t('Esconder mimo de…')} value={stories.data ? String(stories.data.hidden.length) : '…'} onPress={() => setSheet('hidden')} />
      </SettingsSection>

      {zas.data ? (
        <SettingsSection title="Zás">
          <SettingRow anchor="zasKeep" icon="bolt" title={t('Guardar os meus Zás para o resumo semanal')} description={t('Os outros veem os teus Zás 24 horas; para ti ficam 7 dias em «Os meus Zás» e, ao domingo à noite, fazemos o resumo da semana (com 3 Zás ou mais). Só tu os vês, até partilhares o resumo nos mimos. Desligado, os Zás apagam-se às 24 horas e não há resumo.')} toggle={{ on: zas.data.keepForRecap, onChange: toggleZasKeep }} />
        </SettingsSection>
      ) : null}

      {mixarPrivate.data ? (
        <SettingsSection title="Mixar">
          <SettingRow anchor="mixarPrivateTopics" icon="mixar" title={t('Temas privados no Mixar')} description={t('Temas que nunca aparecem nos teus Mixar nem nos temas em comum.')} value={privateCountLabel(mixarPrivate.data.topics.length)} to="/settings/mixar-temas" />
        </SettingsSection>
      ) : null}

      <SettingsSection title={t('Contactos e dados')}>
        {p ? <SettingRow anchor="findByContacts" icon="search" title={t('Deixar que me encontrem pelos contactos')} description={t('Quem tem o teu email nos contactos pode sugerir-te a seguir. Só vê que estás no Txillapp.')} toggle={{ on: p.findByContacts, onChange: (v) => void save({ findByContacts: v }) }} /> : null}
        {p ? <SettingRow anchor="analytics" icon="info" title={t('Ajudar a melhorar o Txillapp')} description={t('Estatísticas de uso só nossas, sem terceiros: aberturas, ecrãs, erros e o que fazes (publicar, brindar, seguir, enviar mensagens…). Nunca o conteúdo nem a posição. Desligado, o que estava à espera é apagado.')} toggle={{ on: p.shareAnalytics, onChange: (v) => void save({ shareAnalytics: v }) }} /> : null}
      </SettingsSection>

      <SettingsSection title={t('Bloqueados')}>
        <SettingRow anchor="blocked" icon="block" title={t('Contas bloqueadas')} value={blocked.data ? String(blocked.data.length) : '…'} onPress={() => setSheet('blocked')} />
      </SettingsSection>

      {sheet === 'type' && p && (
        <ChoiceSheet title={t('Tipo de perfil')} intro={t('Num perfil privado só vê o teu conteúdo quem aprovares; seguir passa a ser um pedido.')} options={[{ value: 'public', title: t('Público'), text: t('Qualquer pessoa vê as tuas publicações e mimos.') }, { value: 'private', title: t('Privado'), text: t('Só os seguidores aprovados.') }]} value={p.isPrivate ? 'private' : 'public'} onPick={(v) => void save({ isPrivate: v === 'private' })} onClose={close} />
      )}
      {sheet === 'comments' && p && <ChoiceSheet title={t('Quem pode comentar')} intro={t('Aplica-se às tuas publicações e às tuas Txilladas. Os comentários que já existem mantêm-se.')} options={WHO} value={p.commentsAllowed} onPick={(v) => void save({ commentsAllowed: v })} onClose={close} />}
      {sheet === 'mentions' && p && <ChoiceSheet title={t('Quem pode mencionar-me')} intro={t('Quem escreve @o-teu-nome e te faz aparecer nas sugestões. Quem eu sigo mantém-se sempre disponível para mim; contas privadas só são mencionadas por quem as segue.')} options={WHO} value={p.mentionsAllowed} onPick={(v) => void save({ mentionsAllowed: v })} onClose={close} />}
      {sheet === 'repostsVisible' && p && <ChoiceSheet title={t('Quem vê quem repostou')} intro={t('Os números continuam visíveis; isto muda só quem pode ver os nomes.')} options={VIEWERS} value={p.repostsVisible} onPick={(v) => void save({ repostsVisible: v })} onClose={close} />}
      {sheet === 'cheersVisible' && p && <ChoiceSheet title={t('Quem vê quem brindou')} intro={t('Os números continuam visíveis; isto muda quem pode ver os nomes, na lista e na publicação («Brindado por @fulano»).')} options={VIEWERS} value={p.cheersVisible} onPick={(v) => void save({ cheersVisible: v })} onClose={close} />}
      {sheet === 'giftsVisible' && p && <ChoiceSheet title={t('Quem vê quem presenteou')} intro={t('Os números continuam visíveis; isto muda só quem pode ver os nomes (nunca os valores). Numa Txillada, as ofertas veem-se sempre na sala, com o nome e o valor.')} options={VIEWERS} value={p.giftsVisible} onPick={(v) => void save({ giftsVisible: v })} onClose={close} />}
      {sheet === 'nearby' && nearby.data && <ChoiceSheet title={t('Aparecer em À tua volta')} intro={t('Quem te pode ver no mapa. Só aparece a zona aproximada (cerca de 1,5 km), nunca o sítio exato, e só enquanto tens o mapa aberto com a localização do telemóvel (com uma cidade escolhida, não apareces). Some ao fim de 3 horas, ou logo que escolhes uma cidade, terminas a sessão ou desligas isto.')} options={NEARBY} value={nearby.data.visibility} onPick={(v) => void saveNearby(v)} onClose={close} />}
      {sheet === 'gifts' && p && <ChoiceSheet title={t('Quem pode presentear-me')} intro={t('Não vale nas tuas Txilladas: lá, quem está a ver pode oferecer-te vibes.')} options={WHO} value={p.giftsAllowed} onPick={(v) => void save({ giftsAllowed: v })} onClose={close} />}
      {sheet === 'connections' && p && <ChoiceSheet title={t('Quem vê seguidores e a quem sigo')} intro={t('Os números continuam visíveis; muda só quem pode ver as listas.')} options={CONNECTIONS} value={p.showConnections} onPick={(v) => void save({ showConnections: v })} onClose={close} />}
      {sheet === 'storyReplies' && stories.data && <ChoiceSheet title={t('Respostas aos mimos')} intro={t('Quem pode responder ou reagir aos teus mimos.')} options={WHO} value={stories.data.replies} onPick={(v) => void saveStoryReplies(v)} onClose={close} />}
      {sheet === 'closeFriends' && <CloseFriendsSheet onClose={close} />}
      {sheet === 'hidden' && <HiddenSheet onClose={close} />}
      {sheet === 'blocked' && <BlockedSheet onClose={close} />}
    </SettingsPage>
  );
}
