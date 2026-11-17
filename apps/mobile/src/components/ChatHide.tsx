import { useQueryClient } from '@tanstack/react-query';
import { Alert, Platform } from 'react-native';
import { api, type Conversation, type GroupSummary } from '@/lib/api';
import { gruposApi } from '@/lib/api.grupos';
import { HIDDEN_KEYS, HIDDEN_QUERY_KEY, hideAsk } from '@/lib/chatHidden';
import { t } from '@/lib/i18n';

/** Que conversa: a dois (o @ do outro lado) ou um TxillGroup (o id). */
export type HideTarget = { username: string } | { groupId: string };
type HiddenData = { conversations: Conversation[]; groups: GroupSummary[] };

/** Pergunta antes de esconder (diz onde a conversa fica). No iPhone espera que a folha que a pediu se feche. */
export function confirmHide(name: string, group: boolean, run: () => void) {
  const p = hideAsk(name, group);
  const ask = () => Alert.alert(p.title, p.body, [
    { text: t('Cancelar'), style: 'cancel' },
    { text: p.ok, onPress: run },
  ]);
  if (Platform.OS === 'ios') setTimeout(ask, 350);
  else ask();
}

/**
 * Esconder e mostrar outra vez uma conversa (lib/chatHidden): tira-a logo da lista certa (otimista), grava no servidor e
 * põe em dia as listas, as escondidas, o contador e a conversa aberta. Se falhar, as listas voltam do servidor e avisa.
 */
export function useChatHiding() {
  const qc = useQueryClient();
  const threadKey = (t: HideTarget) => ('username' in t ? ['chat-thread', t.username] : ['chat-group', t.groupId]);
  async function set(hideTarget: HideTarget, hidden: boolean) {
    const isChat = 'username' in hideTarget;
    const out = <T extends { username?: string; id?: string }>(xs: T[] | undefined) => xs?.filter((x) => (isChat ? x.username !== hideTarget.username : x.id !== hideTarget.groupId));
    if (hidden) {
      if (isChat) qc.setQueryData<Conversation[]>(['chat-list'], (d) => out(d));
      else qc.setQueryData<GroupSummary[]>(['chat-groups'], (d) => out(d));
    } else {
      qc.setQueryData<HiddenData>(HIDDEN_QUERY_KEY, (d) => d && (isChat ? { ...d, conversations: out(d.conversations) ?? [] } : { ...d, groups: out(d.groups) ?? [] }));
    }
    try {
      if (isChat) await api.chatSetHidden(hideTarget.username, hidden);
      else await gruposApi.setHidden(hideTarget.groupId, hidden);
    } catch {
      Alert.alert(hidden ? t('Não consegui esconder a conversa') : t('Não consegui mostrar a conversa'), t('Tenta outra vez.'));
    } finally {
      for (const k of HIDDEN_KEYS) void qc.invalidateQueries({ queryKey: k });
      void qc.invalidateQueries({ queryKey: threadKey(hideTarget) });
    }
  }
  return {
    /** Esconder (pergunta antes). `name`: a pessoa ou o grupo. */
    hide: (t: HideTarget, name: string) => confirmHide(name, 'groupId' in t, () => void set(t, true)),
    /** Mostrar outra vez (sem perguntar). */
    unhide: (t: HideTarget) => void set(t, false),
  };
}
