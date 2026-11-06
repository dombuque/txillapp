import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { PullView, usePullToRefresh } from '@/components/PullToRefresh';
import { StackPage } from '@/components/StackPage';
import { api, type AppNotification } from '@/lib/api';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

const ICON: Record<AppNotification['kind'], { name: IconName; color: string }> = {
  blocked: { name: 'block', color: '#dc2626' },
  follow: { name: 'user-plus', color: '#0284c7' },
  follow_request: { name: 'bell', color: '#d97706' },
  request_accepted: { name: 'check-circle', color: '#059669' },
  gift: { name: 'gift', color: colors.brand },
  comment: { name: 'comment', color: '#0284c7' },
  reply: { name: 'comment', color: '#0284c7' },
  story_reply: { name: 'camera', color: '#7c3aed' },
  repost: { name: 'repeat', color: '#059669' },
  mention: { name: 'at', color: '#d97706' },
  tag: { name: 'tag', color: '#7c3aed' },
  verified: { name: 'check-circle', color: '#0284c7' },
};

/** Texto de cada tipo de notificação (o mesmo do site). */
function describe(n: AppNotification): { text: ReactNode; sub?: string } {
  const quote = n.data.snippet ? `“${n.data.snippet}”` : undefined;
  switch (n.kind) {
    case 'blocked': return { text: 'bloqueou-te', sub: 'Já não podes seguir esta conta nem ver as publicações e stories dela.' };
    case 'follow': return { text: 'começou a seguir-te' };
    case 'follow_request': return { text: 'pediu para te seguir' };
    case 'request_accepted': return { text: 'aceitou o teu pedido para seguir' };
    case 'gift': return { text: <>presenteou-te com <Text style={{ fontWeight: '700' }}>{(n.data.amount ?? 0).toLocaleString('pt-PT')} Txills</Text></>, sub: n.data.note ? `${n.data.note}` : undefined };
    case 'comment': return { text: 'comentou a tua publicação', sub: quote };
    case 'reply': return { text: 'respondeu ao teu comentário', sub: quote };
    case 'story_reply':
      if (n.data.replyKind === 'comment') return { text: 'comentou o teu story', sub: quote };
      return n.data.replyKind === 'reaction' ? { text: `reagiu ao teu story ${n.data.snippet ?? ''}` } : { text: 'respondeu ao teu story', sub: quote };
    case 'repost': return { text: 'repostou a tua publicação', sub: quote };
    case 'tag': return { text: 'identificou-te numa foto' };
    case 'mention': return { text: 'mencionou-te', sub: quote };
    case 'verified': return { text: 'agora tem o selo de conta verificada' };
  }
}

/** Para onde leva tocar numa notificação. */
function targetOf(n: AppNotification): string | null {
  const post = n.data.postId;
  switch (n.kind) {
    case 'comment':
    case 'reply': return post ? `/p/${post}?comments=1` : null;
    case 'mention':
    case 'tag':
    case 'repost':
    case 'gift': return post ? `/p/${post}` : n.kind === 'gift' ? '/wallet' : `/u/${n.actor.username}`;
    case 'story_reply': return n.data.replyKind === 'comment' ? '/profile' : `/messages/${n.actor.username}`;
    case 'follow':
    case 'verified':
    case 'request_accepted': return `/u/${n.actor.username}`;
    default: return null;
  }
}

function Row({ n, fresh }: { n: AppNotification; fresh: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const target = targetOf(n);
  const [answer, setAnswer] = useState<'accepted' | 'declined' | null>(null);
  const [busy, setBusy] = useState(false);
  const { text, sub } = describe(n);

  async function respond(accept: boolean) {
    setBusy(true);
    try {
      await (accept ? api.acceptRequest(n.actor.username) : api.declineRequest(n.actor.username));
      setAnswer(accept ? 'accepted' : 'declined');
      void qc.invalidateQueries({ queryKey: ['profile'] });
    } catch {
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable onPress={target ? () => router.push(target as never) : undefined} disabled={!target} style={({ pressed }) => [styles.row, fresh && { backgroundColor: 'rgba(255,241,242,0.7)' }, pressed && target && { backgroundColor: colors.zinc100 }]}>
      <View>
        <Avatar name={n.actor.displayName} username={n.actor.username} size={46} />
        <View style={styles.badge}>
          <Icon name={ICON[n.kind].name} size={14} color={ICON[n.kind].color} strokeWidth={2.4} />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.line}>
          <Text style={{ fontWeight: '700' }}>{n.actor.username}</Text> {text} <Text style={{ color: colors.zinc500 }}>{timeAgo(n.createdAt)}</Text>
        </Text>
        {sub ? <Text style={styles.sub} numberOfLines={3}>{sub}</Text> : null}
        {n.kind === 'follow_request' && !answer && (
          <View style={styles.btns}>
            <Pressable disabled={busy} onPress={() => void respond(true)} style={styles.accept}><Text style={styles.acceptText}>Aceitar</Text></Pressable>
            <Pressable disabled={busy} onPress={() => void respond(false)} style={styles.decline}><Text style={styles.declineText}>Recusar</Text></Pressable>
          </View>
        )}
        {answer ? <Text style={styles.answer}>{answer === 'accepted' ? 'Pedido aceite' : 'Pedido recusado'}</Text> : null}
      </View>
    </Pressable>
  );
}

/** Notificações: bloqueios, seguidores, pedidos, presentes, comentários, respostas a stories e reposts. */
export default function Notifications() {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) => api.notifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    refetchOnMount: 'always',
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  // O que era novo quando abri fica destacado nesta visita, mesmo depois de marcado como lido.
  const freshIds = useRef<Set<string> | null>(null);
  if (q.isSuccess && freshIds.current === null) freshIds.current = new Set(items.filter((n) => !n.read).map((n) => n.id));

  useEffect(() => {
    if (!q.isSuccess) return;
    const t = setTimeout(() => {
      api.markNotificationsRead().then(() => qc.invalidateQueries({ queryKey: ['unread'] })).catch(() => undefined);
    }, 1200);
    return () => clearTimeout(t);
  }, [q.isSuccess, qc]);

  const pull = usePullToRefresh(() => q.refetch());
  const fresh = items.filter((n) => freshIds.current?.has(n.id));
  const older = items.filter((n) => !freshIds.current?.has(n.id));
  type Entry = { kind: 'h'; id: string; label: string } | { kind: 'n'; n: AppNotification; fresh: boolean };
  const data: Entry[] = [
    ...(fresh.length > 0 ? [{ kind: 'h' as const, id: 'h-new', label: 'Novas' }] : []),
    ...fresh.map((n) => ({ kind: 'n' as const, n, fresh: true })),
    ...(older.length > 0 && fresh.length > 0 ? [{ kind: 'h' as const, id: 'h-old', label: 'Anteriores' }] : []),
    ...older.map((n) => ({ kind: 'n' as const, n, fresh: false })),
  ];

  return (
    <StackPage title="Notificações">
      <PullView pull={pull}>
      <FlatList
        onScroll={pull.onScroll}
        scrollEventThrottle={16}
        refreshControl={pull.control}
        data={data}
        keyExtractor={(e) => (e.kind === 'h' ? e.id : e.n.id)}
        renderItem={({ item }) => (item.kind === 'h' ? <Text style={styles.h}>{item.label}</Text> : <Row n={item.n} fresh={item.fresh} />)}
        ListEmptyComponent={
          q.isLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
          ) : q.isError ? (
            <View style={styles.empty} accessibilityRole="alert">
              <Text style={styles.emptyTitle}>Ups, não consegui carregar</Text>
              <Pressable onPress={() => void q.refetch()} style={styles.ghost}><Text style={styles.ghostText}>Tentar outra vez</Text></Pressable>
            </View>
          ) : (
            <View style={styles.empty}>
              <Icon name="bell-off" size={52} color={colors.zinc300} />
              <Text style={[styles.emptyTitle, { marginTop: 16, fontSize: 24 }]}>Tudo calmo por aqui</Text>
              <Text style={styles.emptySub}>Quando alguém te seguir, comentar ou presentear, aparece aqui.</Text>
            </View>
          )
        }
        ListFooterComponent={
          q.hasNextPage ? (
            <Pressable onPress={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} style={[styles.ghost, { alignSelf: 'center', marginVertical: 16 }]}>
              <Text style={styles.ghostText}>{q.isFetchingNextPage ? 'A carregar…' : 'Ver mais'}</Text>
            </Pressable>
          ) : <View style={{ height: 24 }} />
        }
      />
      </PullView>
    </StackPage>
  );
}

const styles = StyleSheet.create({
  h: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, fontSize: 14, fontWeight: '700', color: colors.zinc600 },
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  badge: { position: 'absolute', right: -4, bottom: -4, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.white, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.12)' },
  line: { fontSize: 15, lineHeight: 20, color: colors.zinc900 },
  sub: { marginTop: 4, fontSize: 14, color: colors.zinc600 },
  btns: { marginTop: 10, flexDirection: 'row', gap: 8 },
  accept: { borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 20, paddingVertical: 8 },
  acceptText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  decline: { borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, paddingHorizontal: 20, paddingVertical: 8 },
  declineText: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  answer: { marginTop: 8, fontSize: 14, fontWeight: '500', color: colors.zinc600 },
  empty: { marginHorizontal: 24, marginTop: 64, alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  emptySub: { marginTop: 8, fontSize: 18, fontWeight: '300', color: colors.zinc600, textAlign: 'center' },
  ghost: { marginTop: 16, height: 44, paddingHorizontal: 24, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 15, fontWeight: '600', color: colors.zinc800 },
});
