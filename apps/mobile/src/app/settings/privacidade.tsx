import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from 'react-native';
import { CloseFriendsSheet } from '@/components/StoryParts';
import { ChoiceSheet } from '@/components/settings/ChoiceSheet';
import { CONNECTIONS, NEARBY, VIEWERS, WHO, nearbyLabel, viewersLabel, whoLabel } from '@/components/settings/options';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { BlockedSheet, HiddenSheet } from '@/components/settings/sheets';
import { usePrivacy } from '@/components/settings/usePrivacy';
import { ApiError, api } from '@/lib/api';
import { nearbyApi, type NearbyVisibility } from '@/lib/api.nearby';

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
  // Aparecer em À tua volta: a mesma chave de cache do mapa, para os dois ecrãs ficarem iguais.
  const nearby = useQuery({ queryKey: ['nearby-settings'], queryFn: nearbyApi.settings, staleTime: 5 * 60_000, retry: false });
  async function saveNearby(v: NearbyVisibility) {
    try {
      const r = await nearbyApi.setSettings(v);
      qc.setQueryData(['nearby-settings'], { ...(nearby.data ?? {}), visibility: r?.visibility ?? v });
      if (v === 'off') void nearbyApi.clearPresence().catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['nearby'] });
    } catch (e) {
      Alert.alert('Não deu', e instanceof ApiError && e.message ? e.message : 'Não consegui mudar isto agora. Tenta outra vez.');
    }
  }

  return (
    <SettingsPage title="Privacidade">
      <SettingsSection title="O teu perfil">
        <SettingRow anchor="accountType" icon={p?.isPrivate ? 'lock' : 'globe'} title="Tipo de perfil" value={p ? (p.isPrivate ? 'Privado' : 'Público') : '…'} onPress={() => setSheet('type')} />
        <SettingRow anchor="connections" icon="users" title="Quem vê seguidores e a quem sigo" value={p ? CONNECTIONS.find((c) => c.value === p.showConnections)!.title : '…'} onPress={() => setSheet('connections')} />
        {p ? <SettingRow anchor="suggestable" icon="sparkles" title="Aparecer nas sugestões" description="Outras pessoas podem descobrir-te." toggle={{ on: p.suggestable, onChange: (v) => void save({ suggestable: v }) }} /> : null}
        {p ? <SettingRow anchor="presence" icon="eye" title="Mostrar quando estou online" description="Aparece Online ou Visto há… no chat. Se desligares, também não vês o dos outros." toggle={{ on: p.showPresence, onChange: (v) => void save({ showPresence: v }) }} /> : null}
        {nearby.data && nearby.data.canEnable !== false ? <SettingRow anchor="nearby" icon="map-pin" title="Aparecer em À tua volta" value={nearbyLabel(nearby.data.visibility)} onPress={() => setSheet('nearby')} /> : null}
      </SettingsSection>

      <SettingsSection title="Interações">
        <SettingRow anchor="comments" icon="comment" title="Quem pode comentar" value={p ? whoLabel(p.commentsAllowed) : '…'} onPress={() => setSheet('comments')} />
        <SettingRow anchor="mentions" icon="at" title="Quem pode mencionar-me" value={p ? whoLabel(p.mentionsAllowed) : '…'} onPress={() => setSheet('mentions')} />
        <SettingRow anchor="gifts" icon="gift" title="Quem pode presentear-me" value={p ? whoLabel(p.giftsAllowed) : '…'} onPress={() => setSheet('gifts')} />
        <SettingRow icon="messages" title="Mensagens e chamadas" description="Quem te pode escrever e quem te pode ligar" to="/settings/mensagens" />
      </SettingsSection>

      <SettingsSection title="Quem vê os nomes" note="Os números continuam visíveis; isto muda só quem pode ver quem foi.">
        <SettingRow anchor="repostsVisible" icon="repeat" title="Quem vê quem repostou" value={p ? viewersLabel(p.repostsVisible) : '…'} onPress={() => setSheet('repostsVisible')} />
        <SettingRow anchor="cheersVisible" icon="cheers" title="Quem vê quem brindou" value={p ? viewersLabel(p.cheersVisible) : '…'} onPress={() => setSheet('cheersVisible')} />
        <SettingRow anchor="giftsVisible" icon="gift" title="Quem vê quem presenteou" value={p ? viewersLabel(p.giftsVisible) : '…'} onPress={() => setSheet('giftsVisible')} />
      </SettingsSection>

      <SettingsSection title="Mimos">
        <SettingRow anchor="storyReplies" icon="camera" title="Quem pode responder" value={stories.data ? whoLabel(stories.data.replies) : '…'} onPress={() => setSheet('storyReplies')} />
        <SettingRow anchor="closeFriends" icon="heart" title="Amigos próximos" value={closeFriends.data ? String(closeFriends.data.length) : '…'} onPress={() => setSheet('closeFriends')} />
        <SettingRow anchor="hiddenStory" icon="eye-off" title="Esconder mimo de…" value={stories.data ? String(stories.data.hidden.length) : '…'} onPress={() => setSheet('hidden')} />
      </SettingsSection>

      <SettingsSection title="Contactos e dados">
        {p ? <SettingRow anchor="findByContacts" icon="search" title="Deixar que me encontrem pelos contactos" description="Quem tem o teu email nos contactos pode sugerir-te a seguir. Só vê que estás no Txillapp." toggle={{ on: p.findByContacts, onChange: (v) => void save({ findByContacts: v }) }} /> : null}
        {p ? <SettingRow anchor="analytics" icon="info" title="Ajudar a melhorar o Txillapp" description="Estatísticas de uso só nossas, sem terceiros: aberturas, ecrãs, erros e o que fazes (publicar, brindar, seguir, enviar mensagens…). Nunca o conteúdo nem a posição. Desligado, o que estava à espera é apagado." toggle={{ on: p.shareAnalytics, onChange: (v) => void save({ shareAnalytics: v }) }} /> : null}
      </SettingsSection>

      <SettingsSection title="Bloqueados">
        <SettingRow anchor="blocked" icon="block" title="Contas bloqueadas" value={blocked.data ? String(blocked.data.length) : '…'} onPress={() => setSheet('blocked')} />
      </SettingsSection>

      {sheet === 'type' && p && (
        <ChoiceSheet title="Tipo de perfil" intro="Num perfil privado só vê o teu conteúdo quem aprovares; seguir passa a ser um pedido." options={[{ value: 'public', title: 'Público', text: 'Qualquer pessoa vê as tuas publicações e mimos.' }, { value: 'private', title: 'Privado', text: 'Só os seguidores aprovados.' }]} value={p.isPrivate ? 'private' : 'public'} onPick={(v) => void save({ isPrivate: v === 'private' })} onClose={close} />
      )}
      {sheet === 'comments' && p && <ChoiceSheet title="Quem pode comentar" intro="Aplica-se às tuas publicações. Os comentários que já existem mantêm-se." options={WHO} value={p.commentsAllowed} onPick={(v) => void save({ commentsAllowed: v })} onClose={close} />}
      {sheet === 'mentions' && p && <ChoiceSheet title="Quem pode mencionar-me" intro="Quem escreve @o-teu-nome e te faz aparecer nas sugestões. Quem eu sigo mantém-se sempre disponível para mim; contas privadas só são mencionadas por quem as segue." options={WHO} value={p.mentionsAllowed} onPick={(v) => void save({ mentionsAllowed: v })} onClose={close} />}
      {sheet === 'repostsVisible' && p && <ChoiceSheet title="Quem vê quem repostou" intro="Os números continuam visíveis; isto muda só quem pode ver os nomes." options={VIEWERS} value={p.repostsVisible} onPick={(v) => void save({ repostsVisible: v })} onClose={close} />}
      {sheet === 'cheersVisible' && p && <ChoiceSheet title="Quem vê quem brindou" intro="Os números continuam visíveis; isto muda só quem pode ver os nomes." options={VIEWERS} value={p.cheersVisible} onPick={(v) => void save({ cheersVisible: v })} onClose={close} />}
      {sheet === 'giftsVisible' && p && <ChoiceSheet title="Quem vê quem presenteou" intro="Os números continuam visíveis; isto muda só quem pode ver os nomes (nunca os valores)." options={VIEWERS} value={p.giftsVisible} onPick={(v) => void save({ giftsVisible: v })} onClose={close} />}
      {sheet === 'nearby' && nearby.data && <ChoiceSheet title="Aparecer em À tua volta" intro="Quem te pode ver no mapa. Só aparece a zona aproximada (cerca de 1,5 km), nunca o sítio exato, e só enquanto tens o mapa aberto com a localização do telemóvel (com uma cidade escolhida, não apareces). Some ao fim de 3 horas, ou logo que escolhes uma cidade, terminas a sessão ou desligas isto." options={NEARBY} value={nearby.data.visibility} onPick={(v) => void saveNearby(v)} onClose={close} />}
      {sheet === 'gifts' && p && <ChoiceSheet title="Quem pode presentear-me" options={WHO} value={p.giftsAllowed} onPick={(v) => void save({ giftsAllowed: v })} onClose={close} />}
      {sheet === 'connections' && p && <ChoiceSheet title="Quem vê seguidores e a quem sigo" intro="Os números continuam visíveis; muda só quem pode ver as listas." options={CONNECTIONS} value={p.showConnections} onPick={(v) => void save({ showConnections: v })} onClose={close} />}
      {sheet === 'storyReplies' && stories.data && <ChoiceSheet title="Respostas aos mimos" intro="Quem pode responder ou reagir aos teus mimos." options={WHO} value={stories.data.replies} onPick={async (v) => qc.setQueryData(['story-settings'], await api.setStoryReplies(v))} onClose={close} />}
      {sheet === 'closeFriends' && <CloseFriendsSheet onClose={close} />}
      {sheet === 'hidden' && <HiddenSheet onClose={close} />}
      {sheet === 'blocked' && <BlockedSheet onClose={close} />}
    </SettingsPage>
  );
}
