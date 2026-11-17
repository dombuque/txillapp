import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { NameWithBadge } from '@/components/NameWithBadge';
import { CallIcon } from '@/components/calls/CallIcons';
import { EmptyState } from '@/components/Empty';
import { Icon } from '@/components/Icon';
import { ActivityIndicator, ListSkeleton } from '@/components/PontoLoader';
import { ActionRow } from '@/components/ui/ActionRow';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { StackPage } from '@/components/StackPage';
import { Sheet } from '@/components/Sheet';
import { HOLD_MS } from '@/lib/messageMenu';
import { callsApi, fmtDuration, startCall, type CallLogItem } from '@/lib/calls';
import { confirm } from '@/lib/confirm';
import { colors, typo } from '@/lib/theme';
import { showToast } from '@/lib/toast';
import { timeAgo } from '@/lib/time';

/** Perdida: ligaram-me e não atendi (tocou até ao fim, ou desistiram antes). */
/** O tempo para «Desfazer» antes de apagar uma chamada no servidor (o mesmo do aviso com botão). */
const UNDO_MS = 6000;

const isMissed = (c: CallLogItem) => c.direction === 'in' && (c.status === 'missed' || c.status === 'cancelled');

function subtitle(c: CallLogItem): string {
  const kind = c.video ? 'Videochamada' : 'Chamada de voz';
  const when = timeAgo(c.startedAt);
  if (isMissed(c)) return `${kind} perdida · ${when}`;
  if (c.status === 'ringing' || c.status === 'active') return `${kind} · agora`;
  if (c.status === 'declined') return `${kind} recusada · ${when}`;
  if (c.status === 'missed' || c.status === 'cancelled') return `${kind} sem resposta · ${when}`;
  const dur = c.durationS ? ` · ${fmtDuration(c.durationS * 1000)}` : '';
  return `${kind}${dur} · ${when}`;
}

/** Histórico de chamadas: as perdidas a vermelho e um botão para ligar de volta. */
export default function Calls() {
  const router = useRouter();
  const q = useInfiniteQuery({
    queryKey: ['calls'],
    queryFn: ({ pageParam }) => callsApi.history(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    retry: 1,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  /** Segurar uma chamada: todas as opções numa folha (sem deslizes: o deslize fica para mudar de ecrã). */
  const [held, setHeld] = useState<CallLogItem | null>(null);

  const qc = useQueryClient();
  type Pages = InfiniteData<{ items: CallLogItem[]; nextCursor: string | null }>;
  /**
   * Apagar uma chamada: sai da lista na hora e o aviso de baixo dá uns segundos para «Desfazer». Só depois se apaga no
   * servidor (se falhar, volta à lista).
   */
  function remove(c: CallLogItem) {
    const before = qc.getQueryData<Pages>(['calls']);
    qc.setQueryData<Pages>(['calls'], (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== c.id) })) });
    let undone = false;
    showToast('Chamada apagada do registo', { label: 'Desfazer', onPress: () => { undone = true; qc.setQueryData(['calls'], before); } });
    setTimeout(() => {
      if (undone) return;
      callsApi.remove(c.id).catch(() => { qc.setQueryData(['calls'], before); showToast('Não consegui apagar. Tenta outra vez.'); });
    }, UNDO_MS);
  }
  async function clearAll() {
    const ok = await confirm({ title: 'Limpar o histórico?', message: 'Todas as chamadas saem da tua lista. Do lado da outra pessoa ficam.', confirm: 'Limpar', danger: true });
    if (!ok) return;
    void callsApi.removeAll().then(() => qc.invalidateQueries({ queryKey: ['calls'] })).catch(() => showToast('Não consegui limpar o histórico. Tenta outra vez.'));
  }

  function callBack(c: CallLogItem) {
    void startCall(c.peer, c.video).catch((e: Error) => showToast(e.message ? `Não consegui ligar: ${e.message}` : 'Não consegui ligar. Tenta outra vez.'));
  }

  return (
    <StackPage
      title="Chamadas"
      right={items.length ? (
        <Button label="Limpar" kind="ghost" size="sm" onPress={() => void clearAll()} accessibilityLabel="Limpar o histórico de chamadas" />
      ) : undefined}
    >
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        onRefresh={() => void q.refetch()}
        refreshing={q.isRefetching && !q.isFetchingNextPage}
        contentContainerStyle={{ paddingVertical: 6 }}
        ListEmptyComponent={
          q.isLoading ? <ListSkeleton avatar={48} /> :
          q.isError ? <ErrorState what="as chamadas" onRetry={() => void q.refetch()} /> :
          <EmptyState icon="phone" title="Ainda não há chamadas" text="Liga a alguém a partir de uma conversa: o botão está no topo." />
        }
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.brand} /> : undefined}
        renderItem={({ item: c }) => {
          const missed = isMissed(c);
          return (
            <Pressable onPress={() => router.push(`/messages/${c.peer.username}` as never)} onLongPress={() => setHeld(c)} delayLongPress={HOLD_MS} accessibilityHint="Segura para mais opções" accessibilityActions={[{ name: 'more', label: 'Mais opções' }]} onAccessibilityAction={() => setHeld(c)} style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button">
              <Avatar name={c.peer.displayName} username={c.peer.hasAvatar ? c.peer.username : undefined} size={48} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <NameWithBadge name={c.peer.displayName} who={c.peer} style={[st.name, missed && { color: colors.red600 }]} />
                <View style={st.subRow}>
                  <CallIcon name={missed ? 'missed' : c.direction === 'out' ? 'outgoing' : 'incoming'} size={14} color={missed ? colors.red600 : colors.zinc500} />
                  <Text style={[st.sub, missed && { color: colors.red600 }]} numberOfLines={1}>{subtitle(c)}</Text>
                </View>
              </View>
              <IconButton variant="soft" onPress={() => callBack(c)} label={c.video ? `Videochamada a ${c.peer.displayName}` : `Ligar a ${c.peer.displayName}`}>
                {c.video ? <Icon name="video" size={22} color={colors.zinc800} /> : <CallIcon name="handset" size={21} color={colors.zinc800} />}
              </IconButton>
            </Pressable>
          );
        }}
      />
      {held ? (
        <Sheet onClose={() => setHeld(null)} cancel>
          <View style={{ paddingHorizontal: 16 }}>
            <NameWithBadge name={held.peer.displayName} who={held.peer} style={st.sheetName} containerStyle={{ paddingHorizontal: 4, paddingBottom: 8 }} />
            {[
              { label: 'Mensagem', icon: 'comment' as const, run: () => router.push(`/messages/${held.peer.username}` as never) },
              { label: 'Chamada de voz', icon: 'phone' as const, run: () => callBack({ ...held, video: false }) },
              { label: 'Videochamada', icon: 'video' as const, run: () => callBack({ ...held, video: true }) },
              { label: 'Ver perfil', icon: 'user' as const, run: () => router.push(`/u/${held.peer.username}` as never) },
              ...(held.status === 'ringing' || held.status === 'active' ? [] : [{ label: 'Apagar do registo', icon: 'trash' as const, run: () => remove(held), danger: true }]),
            ].map((o) => (
              <ActionRow key={o.label} icon={o.icon} title={o.label} danger={'danger' in o && o.danger} onPress={() => { const c = o.run; setHeld(null); c(); }} />
            ))}
          </View>
        </Sheet>
      ) : null}
    </StackPage>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  sheetName: { ...typo.sheetTitle, color: colors.zinc900 },
  name: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  sub: { fontSize: 14, color: colors.zinc500, flexShrink: 1 },
});
