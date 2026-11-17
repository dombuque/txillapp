import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { confirm } from '@/lib/confirm';
import { showToast } from '@/lib/toast';
import { mixarApi, mixarKeys } from '@/lib/api.mixar';
import { existingMixarId } from '@/lib/mixar';
import { GROUP_MIN, groupCanMixar, groupProposeError, groupShowDot, mixarOfGroup } from '@/lib/mixarGrupo';
import { useMixarSeen } from '@/lib/mixarSeen';
import { useMixarList } from './MixarEntry';

/**
 * «Mixar do grupo» (0173) no cabeçalho e no menu de um TxillGroup: se o grupo já tem um Mixar (pendente ou ativo), abre-o;
 * se não, pergunta e propõe (os outros membros recebem o aviso). Só num grupo de 3 a 5 pessoas (`show` falso com mais de
 * 5: a opção nem aparece). `dot`: a bolinha azul (convite por responder ou novidades de hoje, até abrir).
 */
export function useGroupMixar(groupId: string, members: number | null | undefined) {
  const router = useRouter();
  const qc = useQueryClient();
  const list = useMixarList(!!groupId);
  const seen = useMixarSeen();
  const running = useRef(false);
  const here = mixarOfGroup(list.data?.groups, groupId);
  const show = !!here || groupCanMixar(members);
  const dot = groupShowDot(here, here ? seen[here.id] : null);
  const open = (id: string) => router.push(`/mixar/${id}` as never);

  async function propose() {
    try {
      const m = await mixarApi.proposeGroup(groupId);
      qc.setQueryData(mixarKeys.one(m.id), m);
      void qc.invalidateQueries({ queryKey: mixarKeys.list() });
      open(m.id);
    } catch (e) {
      const id = existingMixarId(e);
      if (id) return open(id);
      showToast(groupProposeError(e));
    }
  }

  function run() {
    if (running.current) return;
    if (here) return open(here.id);
    running.current = true;
    void confirm({ title: 'Mixar do grupo?', message: `Um feed do grupo com os gostos de quem entrar, com uma seleção nova todos os dias. Começa quando ${GROUP_MIN} pessoas aceitarem; quem não aceitar não entra.`, confirm: 'Propor', cancel: 'Agora não' }).then((ok) => {
      running.current = false;
      if (ok) void propose();
    });
  }

  return { show, dot, here, run };
}
