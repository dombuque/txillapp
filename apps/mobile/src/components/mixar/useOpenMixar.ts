import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import { ApiError } from '@/lib/api';
import { mixarApi, mixarKeys } from '@/lib/api.mixar';
import { existingMixarId, firstName, mixarErrorText } from '@/lib/mixar';

/**
 * «Mixar com Fulano» (menu da conversa, menu «+» do chat, menu da lista de Mensagens): se já há um Mixar com essa pessoa
 * (ativo ou pendente), abre-o; se não, pergunta e convida (o convite aparece como cartão na conversa). Um pedido de cada
 * vez (tocar duas vezes não convida duas vezes).
 */
export function useOpenMixar() {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const open = (id: string) => router.push(`/mixar/${id}` as never);

  async function invite(username: string, name: string) {
    try {
      const m = await mixarApi.invite(username);
      qc.setQueryData(mixarKeys.one(m.id), m);
      void qc.invalidateQueries({ queryKey: mixarKeys.list() });
      void qc.invalidateQueries({ queryKey: mixarKeys.with(username) });
      void qc.invalidateQueries({ queryKey: ['chat-thread', username] });
      void qc.invalidateQueries({ queryKey: ['chat-list'] });
      Alert.alert('Convite enviado', `Quando ${name} aceitar, o vosso Mixar abre com a primeira seleção.`);
    } catch (e) {
      const id = existingMixarId(e);
      if (id) return open(id);
      Alert.alert('Não deu para convidar', mixarErrorText(e));
    }
  }

  async function run(username: string, displayName: string) {
    if (running.current || !username) return;
    running.current = true;
    setBusy(true);
    const name = firstName(displayName);
    try {
      const m = await mixarApi.with(username).catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      });
      if (m) return open(m.id);
      Alert.alert(`Mixar com ${name}?`, `Juntam os gostos dos dois num feed só vosso, com uma seleção nova todos os dias. ${name} recebe o convite nesta conversa.`, [
        { text: 'Agora não', style: 'cancel' },
        { text: 'Convidar', onPress: () => void invite(username, name) },
      ]);
    } catch (e) {
      Alert.alert('Não deu', mixarErrorText(e, 'Não consegui ver o Mixar agora. Tenta outra vez.'));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return { busy, run };
}
