import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { ApiError } from '@/lib/api';
import { groupKeys, groupsApi, type PublicGroup } from '@/lib/api.groups';
import { joinButton, type GroupVisibility, type JoinMode, type JoinState } from '@/lib/groupAccess';
import { colors } from '@/lib/theme';
import { ErrText, Pill } from './GroupParts';

/** O que quem não está no grupo vê. Um 404 (privado oculto ou bloqueio) não se repete. */
export function usePublicGroup(id: string, enabled = true) {
  return useQuery({
    queryKey: groupKeys.publicView(id),
    queryFn: () => groupsApi.publicView(id),
    enabled: enabled && !!id,
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 403)) && n < 2,
  });
}

/** Selo "Público" / "Privado" (o privado que se vê de fora é o "visível no mapa"). */
export function AccessBadge({ visibility }: { visibility?: GroupVisibility | null }) {
  const pub = visibility === 'public';
  return (
    <View style={[s.badge, pub ? s.badgePub : null]} accessibilityLabel={pub ? 'Grupo público' : 'Grupo privado'}>
      <Icon name={pub ? 'globe' : 'lock'} size={12} color={pub ? '#047857' : colors.zinc700} />
      <Text style={[s.badgeText, pub ? { color: '#047857' } : null]}>{pub ? 'Público' : 'Privado'}</Text>
    </View>
  );
}

/**
 * O botão de quem está de fora: "Entrar no grupo" (público), "Pedir para entrar" (privado no mapa),
 * "Pedido enviado · Cancelar" ou "Abrir conversa". Atualiza a página pública na cache e avisa com `onOpen` quando já se pode entrar na conversa.
 */
export function JoinButton({ groupId, mode, me, onOpen }: { groupId: string; mode: JoinMode; me: JoinState | undefined; onOpen: () => void }) {
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const setMe = (next: JoinState) =>
    qc.setQueryData<PublicGroup>(groupKeys.publicView(groupId), (g) => g && { ...g, me: next, members: next === 'member' && g.me !== 'member' ? g.members + 1 : g.members });
  const m = useMutation({
    mutationFn: async (cancel: boolean): Promise<JoinState> => {
      if (cancel) {
        await groupsApi.cancelJoin(groupId);
        return 'none';
      }
      const r = await groupsApi.requestJoin(groupId);
      return r?.status === 'member' ? 'member' : 'pending';
    },
    onMutate: () => setErr(''),
    onSuccess: (next) => {
      setMe(next);
      void qc.invalidateQueries({ queryKey: ['nearby'] });
      if (next === 'member') {
        void qc.invalidateQueries({ queryKey: ['chat-groups'] });
        onOpen();
      }
    },
    onError: (e) => {
      // 409: já és membro ou o grupo está cheio. O servidor diz qual; a página volta a perguntar o estado.
      // 404/403 a meio (bloqueio, ou deixou de estar à vista): a mesma frase da página; o refetch dá 404 e a página passa ao estado "privado ou já não existe".
      const gone = e instanceof ApiError && (e.status === 404 || e.status === 403);
      setErr(gone ? 'Este grupo é privado ou já não existe.' : e instanceof ApiError && e.message ? e.message : 'Não deu. Verifica a internet e tenta outra vez.');
      if (gone) void qc.invalidateQueries({ queryKey: ['nearby'] });
      if (e instanceof ApiError && (e.status === 409 || e.status === 404 || e.status === 403)) void qc.invalidateQueries({ queryKey: groupKeys.publicView(groupId) });
    },
  });

  if (!me) return <Pill label="A carregar…" onPress={() => undefined} disabled />;
  const b = joinButton(mode, me);
  const press = () => (b.action === 'open' ? onOpen() : m.mutate(b.action === 'cancel'));
  return (
    <View style={{ gap: 6 }}>
      <Pill
        label={b.label}
        kind={b.action === 'cancel' ? 'soft' : 'brand'}
        icon={b.action === 'open' ? 'messages' : b.action === 'cancel' ? 'clock' : b.action === 'join' ? 'users' : 'user-plus'}
        busy={m.isPending}
        onPress={press}
      />
      <Text style={s.note}>
        {b.action === 'cancel'
          ? 'Um administrador do grupo vai ver o teu pedido. Toca para o cancelar.'
          : b.action === 'request'
            ? 'Um administrador aceita ou recusa. As conversas e o resto ficam só para quem está no grupo.'
            : b.action === 'join'
              ? 'Entras logo. As conversas ficam só para quem está no grupo.'
              : 'Já estás neste grupo.'}
      </Text>
      <ErrText text={err} />
    </View>
  );
}

const s = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 8, paddingVertical: 3 },
  badgePub: { backgroundColor: '#ecfdf5' },
  badgeText: { fontSize: 12, fontWeight: '800', color: colors.zinc700 },
  note: { fontSize: 13, lineHeight: 18, color: colors.zinc500, textAlign: 'center' },
});
