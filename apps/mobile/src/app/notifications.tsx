import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { FollowButton } from '@/components/FollowButton';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { PullView, usePullToRefresh } from '@/components/PullToRefresh';
import { StackPage } from '@/components/StackPage';
import { ReactionArt } from '@/components/StoryParts';
import { ApiError, api, type AppNotification } from '@/lib/api';
import { groupsApi } from '@/lib/api.groups';
import { locaisApi } from '@/lib/api.locais';
import { cheerPeople, cheerTarget, cheerVerb } from '@/lib/cheerNotice';
import { notifGroup, notifGroupTarget } from '@/lib/groupAccess';
import { moderationTarget, moderationVerb } from '@/lib/moderationNotice';
import { sized } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { pastVerb } from '@/lib/notifVerb';

type Filter = 'all' | 'following' | 'comments' | 'follows' | 'gifts';
const FILTERS: [Filter, string][] = [['all', 'Todas'], ['following', 'Quem sigo'], ['comments', 'Comentários'], ['follows', 'Seguidores'], ['gifts', 'Presentes']];
const inFilter = (n: AppNotification, f: Filter) =>
  f === 'all' ? true
  : f === 'following' ? !!n.actor.following
  : f === 'comments' ? ['comment', 'reply', 'mention'].includes(n.kind)
  : f === 'follows' ? ['follow', 'follow_request', 'request_accepted'].includes(n.kind)
  : n.kind === 'gift';

/** Várias notificações iguais seguidas (a mesma publicação, ou o mesmo tipo) juntam-se numa linha: "a, b e 3 outros…". */
interface Group { id: string; kind: AppNotification['kind']; items: AppNotification[]; actors: AppNotification['actor'][]; first: AppNotification; fresh: boolean }
const groupKey = (n: AppNotification): string | null => {
  switch (n.kind) {
    case 'follow': case 'request_accepted': case 'verified': return n.kind;
    case 'comment': case 'repost': case 'tag': case 'mention': return n.data.postId ? `${n.kind}:${n.data.postId}` : null;
    case 'story_reply': return n.data.replyKind === 'reaction' && n.data.storyId ? `react:${n.data.storyId}` : null;
    case 'group_member_joined': { const g = notifGroup(n).id; return g ? `joined:${g}` : null; }
    default: return null;
  }
};
function groupAll(items: AppNotification[], fresh: Set<string> | null): Group[] {
  const out: Group[] = [];
  for (const n of items) {
    const k = groupKey(n);
    const last = out[out.length - 1];
    const sameDay = last && new Date(last.first.createdAt).getTime() - new Date(n.createdAt).getTime() < 24 * 3600_000;
    const isFresh = !!fresh?.has(n.id);
    if (k && last && last.id.startsWith(`${k}|`) && sameDay && last.fresh === isFresh) {
      last.items.push(n);
      if (!last.actors.some((a) => a.username === n.actor.username)) last.actors.push(n.actor);
    } else {
      out.push({ id: `${k ?? n.kind}|${n.id}`, kind: n.kind, items: [n], actors: [n.actor], first: n, fresh: isFresh });
    }
  }
  return out;
}

/** O verbo de cada tipo; `many` quando a linha junta várias pessoas. */
function verb(n: AppNotification, many: boolean): { text: ReactNode; sub?: string } {
  const quote = !many && n.data.snippet ? `“${n.data.snippet}”` : undefined;
  const v = (stem: string) => pastVerb(stem, many);
  switch (n.kind) {
    case 'blocked': return { text: 'bloqueou-te', sub: 'Já não podes seguir esta conta nem ver as publicações e mimos dela.' };
    case 'follow': return { text: many ? 'começaram a seguir-te' : 'começou a seguir-te' };
    case 'follow_request': return { text: 'pediu para te seguir' };
    case 'request_accepted': return { text: `${v('aceit')} o teu pedido para seguir` };
    case 'gift': return { text: <>presenteou-te com <Text style={{ fontWeight: '700' }}>{(n.data.amount ?? 0).toLocaleString('pt-PT')} Txills</Text></>, sub: n.data.note || undefined };
    case 'comment': return { text: `${v('coment')} a tua publicação`, sub: quote };
    case 'reply': return { text: 'respondeu ao teu comentário', sub: quote };
    case 'story_reply':
      if (n.data.replyKind === 'comment') return { text: 'comentou o teu mimo', sub: quote };
      if (n.data.replyKind === 'reaction') return { text: many ? 'reagiram ao teu mimo' : <>reagiu ao teu mimo <ReactionArt body={n.data.snippet ?? ''} size={24} /></> };
      return { text: 'respondeu ao teu mimo', sub: quote };
    case 'repost': return { text: `${v('repost')} a tua publicação` };
    case 'tag': return { text: `${v('identific')}-te numa foto` };
    case 'mention': return { text: `${v('mencion')}-te`, sub: quote };
    case 'verified': return { text: many ? 'agora têm o selo de conta verificada' : 'agora tem o selo de conta verificada' };
    case 'venue_invite': return { text: <>convidou-te para gerir <Text style={{ fontWeight: '700' }}>{n.data.venueName ?? 'um local'}</Text> como {n.data.role === 'admin' ? 'administrador' : 'editor'}</> };
    // Para os gestores: alguém pagou ao local com Txills.
    // Pago com o cofre de um TxillGroup: diz de que grupo veio.
    case 'venue_payment': return { text: <>pagou <Text style={{ fontWeight: '700' }}>{(n.data.amount ?? 0).toLocaleString('pt-PT')} Txills</Text> ao <Text style={{ fontWeight: '700' }}>{n.data.venueName ?? 'teu local'}</Text>{n.data.groupName ? <> com o cofre de <Text style={{ fontWeight: '700' }}>{n.data.groupName}</Text></> : null}</>, sub: n.data.note || undefined };
    case 'missed_call': return { text: n.data.video ? 'tentou fazer-te uma videochamada' : 'tentou ligar-te' };
    // A equipa decidiu sobre um local que criaste.
    case 'venue_review': return n.data.decision === 'approved'
      ? { text: <>aprovou <Text style={{ fontWeight: '700' }}>{n.data.venueName ?? 'o teu local'}</Text>: já está à vista de todos</> }
      : { text: <>não aprovou <Text style={{ fontWeight: '700' }}>{n.data.venueName ?? 'o teu local'}</Text></>, sub: n.data.note ? `Motivo: ${n.data.note}` : 'Vê o motivo na página e corrige' };
    // TxillGroups: pedidos para entrar (para os administradores), a resposta (para quem pediu) e quem entrou num grupo público.
    case 'group_join_request': return { text: <>pediu para entrar em <Text style={{ fontWeight: '700' }}>{notifGroup(n).name}</Text></> };
    case 'group_join_accepted': return { text: <>aceitou-te em <Text style={{ fontWeight: '700' }}>{notifGroup(n).name}</Text></> };
    case 'group_member_joined': return { text: <>{many ? 'entraram' : 'entrou'} em <Text style={{ fontWeight: '700' }}>{notifGroup(n).name}</Text></> };
    case 'group_admin_granted': return { text: <>fez-te administrador de <Text style={{ fontWeight: '700' }}>{notifGroup(n).name}</Text></> };
    case 'geleira_cheer': return { text: many ? 'brindaram a tua geleira' : 'brindou a tua geleira' };
    // Brindes numa publicação (ou tcheka) ou num comentário: o servidor já os juntou numa linha.
    case 'cheer': return { text: cheerVerb(n.data, many) };
    // Entrou com o meu convite (o prémio de quem convidou chega depois, com o seu próprio aviso no telemóvel).
    case 'invite_joined': return { text: many ? 'entraram com o teu convite' : 'entrou com o teu convite' };
    // A equipa do Txillapp removeu ou repôs um conteúdo meu, ou deixou-me um aviso (com o motivo por baixo).
    case 'content_removed':
    case 'content_restored':
    case 'moderation_warning': return moderationVerb(n.kind, n.data);
    // Um tipo novo que esta versão ainda não conhece não pode partir a lista.
    default: return { text: 'tem novidades para ti' };
  }
}

/** Para onde leva tocar numa notificação. */
function targetOf(n: AppNotification, me?: string): string | null {
  const post = n.data.postId;
  const c = n.data.commentId ? `?comments=1&c=${n.data.commentId}` : '?comments=1';
  switch (n.kind) {
    case 'comment':
    case 'reply': return post ? `/p/${post}${c}` : null;
    case 'mention': return post ? `/p/${post}${n.data.commentId ? c : ''}` : `/u/${n.actor.username}`;
    case 'tag':
    case 'repost':
    case 'gift': return post ? `/p/${post}` : n.kind === 'gift' ? '/wallet' : `/u/${n.actor.username}`;
    case 'story_reply': return n.data.replyKind === 'comment' ? '/profile' : `/messages/${n.actor.username}`;
    case 'follow': return me ? `/u/${me}/connections?tab=followers` : `/u/${n.actor.username}`; // `me` só vem quando a linha junta várias pessoas
    case 'follow_request':
    case 'verified':
    case 'request_accepted': return `/u/${n.actor.username}`;
    case 'venue_invite': return n.data.venueSlug ? `/v/${n.data.venueSlug}` : null;
    case 'venue_payment': return n.data.venueSlug ? `/v/${n.data.venueSlug}/gerir?s=txills` : null;
    case 'venue_review': return n.data.venueSlug ? `/v/${n.data.venueSlug}` : null;
    case 'missed_call': return '/calls';
    case 'geleira_cheer': return '/profile';
    case 'cheer': return cheerTarget(n.data);
    case 'invite_joined': return '/invites';
    case 'content_removed':
    case 'content_restored':
    case 'moderation_warning': return moderationTarget(n.kind, n.data);
    case 'group_join_request':
    case 'group_join_accepted':
    case 'group_member_joined':
    case 'group_admin_granted': return notifGroupTarget(n.kind, notifGroup(n).id);
    default: return null;
  }
}

/** Duas fotos sobrepostas quando a linha junta várias pessoas. */
function Faces({ actors }: { actors: AppNotification['actor'][] }) {
  if (actors.length < 2) return <Avatar name={actors[0].displayName} username={actors[0].username} size={48} />;
  return (
    <View style={{ width: 52, height: 48 }}>
      <View style={{ position: 'absolute', left: 0, top: 0 }}><Avatar name={actors[1].displayName} username={actors[1].username} size={34} /></View>
      <View style={{ position: 'absolute', right: 0, bottom: 0, borderRadius: 19, borderWidth: 2, borderColor: colors.white }}><Avatar name={actors[0].displayName} username={actors[0].username} size={34} /></View>
    </View>
  );
}

/** `total`: quantas pessoas são ao todo, quando só vêm as primeiras (os brindes: o servidor manda a contagem e os dois últimos). */
function Names({ actors, total = actors.length }: { actors: AppNotification['actor'][]; total?: number }) {
  const b = (a: AppNotification['actor']) => <Text key={a.username} style={{ fontWeight: '700' }}>{a.username}</Text>;
  const rest = Math.max(total, actors.length) - 2;
  if (actors.length === 1) return b(actors[0]);
  if (rest <= 0) return <>{b(actors[0])} e {b(actors[1])}</>;
  return <>{b(actors[0])}, {b(actors[1])} e {rest === 1 ? 'outra pessoa' : `${rest} outros`}</>;
}

function Row({ g, me }: { g: Group; me?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const n = g.first;
  // Os brindes já vêm juntos do servidor (quem ainda tem o brinde posto e quantos são); os outros juntam-se aqui.
  const people = g.kind === 'cheer' ? cheerPeople(n.cheer, n.actor) : { actors: g.actors, total: g.actors.length };
  const many = people.total > 1;
  // Uma pessoa: abre o perfil/publicação; várias a seguir-te: a lista de seguidores.
  const single = targetOf(n);
  const target = many && g.kind === 'follow' ? targetOf(n, me) : single;
  const [answer, setAnswer] = useState<'accepted' | 'declined' | null>(null);
  const [busy, setBusy] = useState(false);
  const [back, setBack] = useState<{ isPrivate: boolean } | null>(null);
  const { text, sub } = verb(n, many);
  const pending = useQuery({ queryKey: ['requests'], queryFn: api.followRequests, enabled: n.kind === 'follow_request', staleTime: 10_000 });
  const stillPending = n.kind === 'follow_request' && (!pending.isSuccess || pending.data.some((r: { username: string }) => r.username === n.actor.username));
  const thumb = n.thumb ?? g.items.find((x) => x.thumb)?.thumb ?? null;
  // "Seguir de volta": quem te seguiu (ou aceitou) e tu ainda não segues.
  const followBack = !many && n.kind === 'follow' && n.actor.following === false && !n.actor.requested;

  async function respond(accept: boolean) {
    setBusy(true);
    try {
      if (n.kind === 'venue_invite') {
        // Convite para gerir um local: aceitar passa-me a gestor da página.
        await locaisApi.answerInvite(n.data.venueSlug ?? '', accept);
        setAnswer(accept ? 'accepted' : 'declined');
        void qc.invalidateQueries({ queryKey: ['venues-mine'] });
        void qc.invalidateQueries({ queryKey: ['venue', n.data.venueSlug] });
        return;
      }
      if (n.kind === 'group_join_request') {
        // Pedido para entrar num TxillGroup: aceitar põe a pessoa no grupo.
        const gid = notifGroup(n).id ?? '';
        await (accept ? groupsApi.acceptJoin(gid, n.actor.username) : groupsApi.declineJoin(gid, n.actor.username));
        setAnswer(accept ? 'accepted' : 'declined');
        void qc.invalidateQueries({ queryKey: ['chat-groups'] });
        void qc.invalidateQueries({ queryKey: ['chat-group', gid] });
        void qc.invalidateQueries({ queryKey: ['group-join-requests', gid] });
        return;
      }
      await (accept ? api.acceptRequest(n.actor.username) : api.declineRequest(n.actor.username));
      setAnswer(accept ? 'accepted' : 'declined');
      void qc.invalidateQueries({ queryKey: ['profile'] });
      void qc.invalidateQueries({ queryKey: ['requests'] });
      if (accept && n.actor.following === false && !n.actor.requested) setBack({ isPrivate: !!n.actor.isPrivate });
    } catch (e) {
      const st = e instanceof ApiError ? e.status : 0;
      if (st === 404 || st === 409) {
        setAnswer(accept ? 'accepted' : 'declined');
        void qc.invalidateQueries({ queryKey: ['requests'] });
      } else {
        Alert.alert('Não consegui responder ao pedido', (e as Error).message || 'Verifica a internet e tenta outra vez.');
        setAnswer(null);
      }
    } finally {
      setBusy(false);
    }
  }

  const go = (t: string | null) => t && router.push(t as never);
  const right = thumb ? (
    <Pressable onPress={() => go(single ?? target)} accessibilityRole="imagebutton" accessibilityLabel="Abrir a publicação">
      <Image source={{ uri: sized(thumb.url, 160) }} style={styles.thumb} contentFit="cover" />
      {thumb.video && <View style={styles.playDot}><Icon name="play" size={10} color="#fff" solid /></View>}
    </Pressable>
  ) : followBack || back ? (
    <View style={{ width: 128 }}><FollowButton username={n.actor.username} following={false} requested={false} isPrivate={!!(back?.isPrivate ?? n.actor.isPrivate)} /></View>
  ) : n.kind === 'follow' && !many ? (
    <Pressable onPress={() => router.push(`/messages/${n.actor.username}` as never)} style={styles.msg} accessibilityRole="button"><Text style={styles.msgText}>Mensagem</Text></Pressable>
  ) : null;

  return (
    <Pressable onPress={() => go(target)} disabled={!target} style={({ pressed }) => [styles.row, g.fresh && { backgroundColor: 'rgba(255,241,242,0.7)' }, pressed && target && { backgroundColor: colors.zinc100 }]}>
      <Pressable onPress={() => !n.actor.staff && router.push(`/u/${people.actors[0].username}` as never)} disabled={!!n.actor.staff} accessibilityRole="link" accessibilityLabel={people.actors[0].displayName}>
        <Faces actors={people.actors} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.line}>
          <Names actors={people.actors} total={people.total} /> {text} <Text style={{ color: colors.zinc500 }}>{timeAgo(n.createdAt)}</Text>
        </Text>
        {sub ? <Text style={styles.sub} numberOfLines={2}>{sub}</Text> : null}
        {(n.kind === 'comment' || n.kind === 'reply' || (n.kind === 'mention' && n.data.commentId)) && !many ? (
          <Pressable onPress={() => go(single)} hitSlop={6} style={{ marginTop: 6, alignSelf: 'flex-start' }} accessibilityRole="button"><Text style={styles.reply}>Responder</Text></Pressable>
        ) : null}
        {n.kind === 'venue_invite' && !answer && (
          <View style={styles.btns}>
            <Pressable disabled={busy} onPress={() => void respond(true)} style={styles.accept}><Text style={styles.acceptText}>Aceitar</Text></Pressable>
            <Pressable disabled={busy} onPress={() => void respond(false)} style={styles.decline}><Text style={styles.declineText}>Recusar</Text></Pressable>
          </View>
        )}
        {n.kind === 'group_join_request' && !answer && notifGroup(n).id && (
          <View style={styles.btns}>
            <Pressable disabled={busy} onPress={() => void respond(true)} style={styles.accept} accessibilityRole="button" accessibilityLabel={`Aceitar ${n.actor.username} em ${notifGroup(n).name}`}><Text style={styles.acceptText}>Aceitar</Text></Pressable>
            <Pressable disabled={busy} onPress={() => void respond(false)} style={styles.decline} accessibilityRole="button" accessibilityLabel={`Recusar ${n.actor.username}`}><Text style={styles.declineText}>Recusar</Text></Pressable>
          </View>
        )}
        {n.kind === 'follow_request' && !answer && stillPending && (
          <View style={styles.btns}>
            <Pressable disabled={busy} onPress={() => void respond(true)} style={styles.accept}><Text style={styles.acceptText}>Aceitar</Text></Pressable>
            <Pressable disabled={busy} onPress={() => void respond(false)} style={styles.decline}><Text style={styles.declineText}>Recusar</Text></Pressable>
          </View>
        )}
        {answer ? <Text style={styles.answer}>{answer === 'accepted' ? (n.kind === 'venue_invite' ? 'Agora geres esta página' : n.kind === 'group_join_request' ? 'Já está no grupo' : 'Pedido aceite') : (n.kind === 'venue_invite' ? 'Convite recusado' : 'Pedido recusado')}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

/** Notificações, como no Instagram: filtros em cima, linhas agrupadas, miniatura da publicação à direita e ações na linha. */
export default function Notifications() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
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
  const groups = groupAll(items.filter((n) => inFilter(n, filter)), freshIds.current);
  const fresh = groups.filter((g) => g.fresh);
  const older = groups.filter((g) => !g.fresh);
  type Entry = { kind: 'h'; id: string; label: string } | { kind: 'g'; g: Group };
  const data: Entry[] = [
    ...(fresh.length > 0 ? [{ kind: 'h' as const, id: 'h-new', label: 'Novas' }] : []),
    ...fresh.map((g) => ({ kind: 'g' as const, g })),
    ...(older.length > 0 && fresh.length > 0 ? [{ kind: 'h' as const, id: 'h-old', label: 'Anteriores' }] : []),
    ...older.map((g) => ({ kind: 'g' as const, g })),
  ];

  return (
    <StackPage title="Notificações">
      <PullView pull={pull}>
      <FlatList
        onScroll={pull.onScroll}
        scrollEventThrottle={16}
        refreshControl={pull.control}
        data={data}
        keyExtractor={(e) => (e.kind === 'h' ? e.id : e.g.id)}
        stickyHeaderIndices={[0]}
        ListHeaderComponent={
          <View style={styles.filters}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {FILTERS.map(([f, label]) => (
                <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: filter === f }}>
                  <Text style={[styles.chipText, filter === f && { color: colors.brand }]}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        }
        renderItem={({ item }) => (item.kind === 'h' ? <Text style={[styles.h, item.id === 'h-old' && { paddingTop: 16 }]}>{item.label}</Text> : <Row g={item.g} me={user?.username} />)}
        ListEmptyComponent={
          q.isLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
          ) : q.isError ? (
            <View style={styles.empty} accessibilityRole="alert">
              <Text style={styles.errTitle}>Ups, não consegui carregar</Text>
              <Pressable onPress={() => void q.refetch()} style={styles.ghost}><Text style={styles.ghostText}>Tentar outra vez</Text></Pressable>
            </View>
          ) : (
            <View style={styles.empty}>
              <Icon name="bell-off" size={52} color={colors.zinc300} />
              <Text style={[styles.emptyTitle, { marginTop: 16, fontSize: 24 }]}>{filter === 'all' ? 'Tudo calmo por aqui' : 'Nada por aqui'}</Text>
              <Text style={styles.emptySub}>{filter === 'all' ? 'Quando alguém te seguir, comentar ou presentear, aparece aqui.' : 'Não há notificações deste tipo.'}</Text>
            </View>
          )
        }
        ListFooterComponent={
          q.hasNextPage ? (
            <Pressable onPress={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} style={[styles.ghost, { alignSelf: 'center', marginBottom: 16 }]}>
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
  filters: { paddingVertical: 10, backgroundColor: colors.white },
  chip: { height: 38, borderRadius: 12, backgroundColor: colors.zinc100, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.rose50 },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.zinc900 },
  h: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, fontSize: 14, fontWeight: '700', color: colors.zinc600 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  line: { fontSize: 15, lineHeight: 20.6, color: colors.zinc900 },
  sub: { marginTop: 2, fontSize: 14, color: colors.zinc600 },
  reply: { fontSize: 14, fontWeight: '600', color: colors.zinc500 },
  thumb: { width: 46, height: 46, borderRadius: 8, backgroundColor: colors.zinc100 },
  playDot: { position: 'absolute', right: 3, bottom: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  msg: { height: 36, borderRadius: 12, backgroundColor: colors.zinc100, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  msgText: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  btns: { marginTop: 8, flexDirection: 'row', gap: 8 },
  accept: { borderRadius: 12, backgroundColor: colors.brand, paddingHorizontal: 18, paddingVertical: 8 },
  acceptText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  decline: { borderRadius: 12, backgroundColor: colors.zinc100, paddingHorizontal: 18, paddingVertical: 8 },
  declineText: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  answer: { marginTop: 6, fontSize: 14, fontWeight: '500', color: colors.zinc600 },
  empty: { marginHorizontal: 24, marginTop: 64, alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  emptySub: { marginTop: 8, fontSize: 18, fontWeight: '300', color: colors.zinc600, textAlign: 'center' },
  errTitle: { fontSize: 18, color: colors.zinc900, textAlign: 'center' },
  ghost: { marginTop: 16, height: 48, paddingHorizontal: 24, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 16, fontWeight: '600', color: colors.zinc800 },
});
