import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { confirm } from '@/lib/confirm';
import { showToast } from '@/lib/toast';
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

  /** Sem aviso de «Convite enviado»: o cartão do convite aparece logo na conversa. */
  async function invite(username: string) {
    try {
      const m = await mixarApi.invite(username);
      qc.setQueryData(mixarKeys.one(m.id), m);
      void qc.invalidateQueries({ queryKey: mixarKeys.list() });
      void qc.invalidateQueries({ queryKey: mixarKeys.with(username) });
      void qc.invalidateQueries({ queryKey: ['chat-thread', username] });
      void qc.invalidateQueries({ queryKey: ['chat-list'] });
    } catch (e) {
      const id = existingMixarId(e);
      if (id) return open(id);
      showToast(mixarErrorText(e));
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
      if (await confirm({ title: `Mixar com ${name}?`, message: `Juntam os gostos dos dois num feed só vosso, com uma seleção nova todos os dias. ${name} recebe o convite nesta conversa.`, confirm: 'Convidar', cancel: 'Agora não' })) void invite(username);
    } catch (e) {
      showToast(mixarErrorText(e, 'Não consegui ver o Mixar agora. Tenta outra vez.'));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return { busy, run };
}
