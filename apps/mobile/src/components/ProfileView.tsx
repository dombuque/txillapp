import { BackButton } from '@/components/BackButton';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api, type FollowState, type Post, type ProfileTab } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SITE_URL, sized } from '@/lib/config';
import { cardShadow, colors } from '@/lib/theme';
import { Avatar } from './Avatar';
import { BookmarkIcon } from './BookmarkIcon';
import { Icon, type IconName } from './Icon';
import { GiftSheet } from './PostSheets';
import { ReportSheet } from './ReportSheet';
import { RichText } from './RichText';
import { Sheet } from './Sheet';
import { VerifiedBadge } from './VerifiedBadge';

const TABS: { id: ProfileTab; label: string; icon: IconName | 'bookmark' }[] = [
  { id: 'all', label: 'Tudo', icon: 'grid' },
  { id: 'reels', label: 'Reels', icon: 'film' },
  { id: 'reposts', label: 'Reposts', icon: 'repeat' },
  { id: 'gifts', label: 'Presentes', icon: 'gift' },
  { id: 'saved', label: 'Guardados', icon: 'bookmark' },
];
const EMPTY: Record<Exclude<ProfileTab, 'all'>, { me: string; other: string }> = {
  reels: { me: 'Ainda não publicaste reels.', other: 'Ainda sem reels.' },
  reposts: { me: 'Ainda não repostaste nada.', other: 'Ainda sem reposts.' },
  gifts: { me: 'Os presentes que deres ou receberes e publicares aparecem aqui.', other: 'Ainda sem presentes publicados.' },
  saved: { me: 'Toca no marcador de uma publicação para a guardares aqui. Só tu vês isto.', other: '' },
};

function QrGlyph() {
  return (
    <Svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke={colors.zinc900} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3.5} y={3.5} width={6} height={6} rx={1.2} />
      <Rect x={14.5} y={3.5} width={6} height={6} rx={1.2} />
      <Rect x={3.5} y={14.5} width={6} height={6} rx={1.2} />
      <Path d="M14.5 14.5h2.5v2.5M20.5 14.5v.01M14.5 20.5h.01M17.5 20.5h3M20.5 17.5v3" />
    </Svg>
  );
}

/** Seguir / A seguir / Pedido enviado (perfis privados). Responde já e volta atrás se falhar. */
function FollowButton({ username, following, requested, isPrivate }: { username: string; following: boolean; requested: boolean; isPrivate: boolean }) {
  const qc = useQueryClient();
  const [s, setS] = useState({ following, requested });
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (busy) return;
    setBusy(true);
    const prev = s;
    try {
      if (s.following || s.requested) {
        setS({ following: false, requested: false });
        await api.unfollow(username);
      } else {
        setS(isPrivate ? { following: false, requested: true } : { following: true, requested: false });
        const r: FollowState = await api.follow(username);
        setS({ following: r.following, requested: r.requested });
      }
      for (const key of ['stories', 'suggestions', 'feed', 'profile']) void qc.invalidateQueries({ queryKey: [key] });
      void qc.invalidateQueries({ queryKey: ['profile-posts', username] });
    } catch {
      setS(prev);
    } finally {
      setBusy(false);
    }
  }
  const on = s.following || s.requested;
  return (
    <Pressable onPress={() => void toggle()} disabled={busy} style={[styles.small, { flex: 1 }, on ? null : { backgroundColor: colors.brand }, busy && { opacity: 0.7 }]} accessibilityRole="button" accessibilityState={{ selected: s.following }}>
      <Text style={[styles.smallText, !on && { color: '#fff' }]}>{s.following ? 'A seguir' : s.requested ? 'Pedido enviado' : 'Seguir'}</Text>
    </Pressable>
  );
}

function Grid({ posts, onOpen, width }: { posts: Post[]; onOpen: (p: Post) => void; width: number }) {
  const gap = 6;
  const size = (width - 32 - gap * 2) / 3;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {posts.map((post) => {
        const shown = post.kind === 'repost' && post.repostOf ? post.repostOf : post;
        const m = shown.media[0];
        return (
          <Pressable key={post.id} onPress={() => onOpen(post)} style={{ width: size, height: size, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.rose50 }} accessibilityRole="button" accessibilityLabel={`Abrir publicação: ${post.body || shown.body || 'foto'}`}>
            {post.kind === 'gift' && post.gift ? (
              <View style={styles.gift}>
                <Text style={styles.giftAmount}>{post.gift.amount.toLocaleString('pt-PT')}</Text>
                <Text style={styles.giftLabel}>TXILLS</Text>
              </View>
            ) : m ? (
              <Image source={{ uri: m.kind === 'video' ? sized(m.posterUrl ?? m.url, 480) : sized(m.url, 480) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} accessibilityIgnoresInvertColors />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: '500', lineHeight: 16, color: colors.zinc700, textAlign: 'center' }}>{(post.body || shown.body).slice(0, 70)}</Text>
              </View>
            )}
            {shown.media.length > 1 && (
              <View style={styles.multi}><Icon name="grid" size={10} color="#fff" /><Text style={styles.multiText}>{shown.media.length}</Text></View>
            )}
            {post.kind === 'gift' && <View style={[styles.corner, { backgroundColor: 'rgba(255,255,255,0.9)' }]}><Icon name="gift" size={12} color={colors.brand} /></View>}
            {post.kind === 'repost' && <View style={[styles.corner, { backgroundColor: 'rgba(0,0,0,0.55)' }]}><Icon name="repeat" size={12} color="#fff" /></View>}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Perfil (meu ou de outra pessoa): cabeçalho, números, botões, separadores e grelha, como no site. */
export function ProfileView({ username }: { username: string; isMe?: boolean }) {
  const router = useRouter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<ProfileTab>('all');
  const [sheet, setSheet] = useState<null | 'menu' | 'gift' | 'report'>(null);

  const q = useQuery({ queryKey: ['profile', username], queryFn: () => api.profile(username), retry: false });
  const p = q.data;
  const tabs = TABS.filter((x) => x.id !== 'saved' || username === user?.username);
  const posts = useInfiniteQuery({
    queryKey: ['profile-posts', username, tab],
    queryFn: ({ pageParam }) => (tab === 'saved' ? api.savedPosts(pageParam) : api.userPosts(username, pageParam, tab)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: !!p?.canView,
  });
  const items = posts.data?.pages.flatMap((x) => x.items) ?? [];

  if (q.isError) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <View style={[styles.center, { paddingTop: insets.top + 64 }]}>
        <Icon name={missing ? 'search' : 'alert'} size={44} color={colors.zinc300} />
        <Text style={styles.errTitle}>{missing ? 'Essa pessoa não existe' : 'Não consegui abrir este perfil'}</Text>
        <Pressable onPress={() => router.back()} style={styles.ghost}><Text style={styles.ghostText}>Voltar</Text></Pressable>
      </View>
    );
  }
  if (!p) return <View style={{ flex: 1, paddingTop: insets.top + 24 }}><View style={[styles.skel, cardShadow]} /></View>;

  const blocked = p.blockedByMe || p.blockedMe;
  const stat = (n: number, label: string, go?: () => void) => (
    <Pressable onPress={go} disabled={!go} style={styles.stat}>
      <Text style={styles.statN}>{n.toLocaleString('pt-PT')}</Text>
      <Text style={styles.statL}>{label}</Text>
    </Pressable>
  );
  async function inviteCrew() {
    try {
      const d = await api.invites();
      await Share.share({ message: `Entra no Txillapp com o meu convite e ganhamos Txills os dois: ${d.link}`, url: d.link });
    } catch {
      /* cancelado ou sem convites */
    }
  }
  async function shareProfile() {
    const url = `${SITE_URL || 'https://txillapp.com'}/u/${p!.username}`;
    try {
      await Share.share({ message: `Segue @${p!.username} no Txillapp, a rede da malta: ${url}`, url });
    } catch { /* cancelado */ }
  }
  const soon = (what: string) => Alert.alert(what, 'Isto ainda está a ser passado para a app. Já vem aí.');
  async function unblock() {
    await api.unblock(p!.username);
    await qc.invalidateQueries({ queryKey: ['profile'] });
  }
  function confirmBlock() {
    Alert.alert(`Bloquear @${p!.username}?`, 'A pessoa deixa de ver o teu conteúdo e não te pode seguir.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Bloquear', style: 'destructive', onPress: async () => { await api.block(p!.username); for (const k of ['profile', 'feed', 'stories', 'suggestions']) void qc.invalidateQueries({ queryKey: [k] }); setSheet(null); } },
    ]);
  }
  const openPost = (post: Post) => router.push(`/p/${post.code ?? post.id}` as never);

  const header = (
    <View>
      {p.isMe ? (
        <View style={styles.topMe}>
          <Text style={styles.handleTop}>@{p.username}</Text>
          <Pressable onPress={() => router.push('/settings' as never)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Definições e privacidade"><Icon name="menu" size={26} strokeWidth={2} /></Pressable>
        </View>
      ) : (
        <View style={styles.topOther}>
          <BackButton />
          <Text style={[styles.handleTop, { flex: 1 }]} numberOfLines={1}>@{p.username}</Text>
          <Pressable onPress={() => setSheet('menu')} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Mais opções"><Icon name="more" size={24} strokeWidth={2.4} /></Pressable>
        </View>
      )}

      <View style={[styles.card, cardShadow]}>
        <View style={[styles.avRow, p.bio ? { marginTop: 48 } : null]}>
          {p.bio ? (
            <View style={styles.bubble}>
              <RichText text={p.bio} style={styles.bubbleText} />
            </View>
          ) : null}
          <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={84} />
          <View style={{ flex: 1, flexDirection: 'row', minWidth: 0 }}>
            {stat(p.counts.posts, 'publicações')}
            {stat(p.counts.followers, 'seguidores', p.canSeeConnections ? () => soon('Seguidores') : undefined)}
            {stat(p.counts.following, 'a seguir', p.canSeeConnections ? () => soon('A seguir') : undefined)}
          </View>
        </View>
        <View style={{ marginTop: 12 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{p.displayName}</Text>
            {p.verified && <VerifiedBadge size={20} tier={p.verifiedTier} />}
            {p.isPrivate && <Icon name="lock" size={14} color={colors.zinc500} />}
          </View>
          {!p.isMe && p.followsYou && !blocked && <View style={styles.followsYou}><Text style={styles.followsYouText}>Segue-te</Text></View>}
          {(p.city || p.website) && (
            <View style={styles.meta}>
              {p.city ? <View style={styles.metaItem}><Icon name="map-pin" size={14} color={colors.zinc600} /><Text style={styles.metaText}>{p.city}</Text></View> : null}
              {p.website ? (
                <Pressable onPress={() => void Linking.openURL(p.website!)} style={styles.metaItem}>
                  <Icon name="link" size={14} color={colors.brand} />
                  <Text style={[styles.metaText, { color: colors.brand, fontWeight: '600' }]} numberOfLines={1}>{p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</Text>
                </Pressable>
              ) : null}
            </View>
          )}
          {!p.bio && p.isMe ? <Pressable onPress={() => soon('Editar perfil')}><Text style={styles.addBio}>Adiciona uma bio</Text></Pressable> : null}
        </View>

        {p.blockedMe && (
          <View style={styles.notice} accessibilityRole="summary">
            <Text style={styles.noticeTitle}>Foste bloqueado por @{p.username}</Text>
            <Text style={styles.noticeText}>Não podes seguir esta conta nem ver as publicações e stories dela.</Text>
          </View>
        )}
        {p.blockedByMe && !p.blockedMe && (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Bloqueaste @{p.username}</Text>
            <Text style={styles.noticeText}>A pessoa não vê o teu conteúdo nem te pode seguir.</Text>
            <Pressable onPress={() => void unblock()} style={[styles.ghost, { marginTop: 12, height: 40 }]}><Text style={styles.ghostText}>Desbloquear</Text></Pressable>
          </View>
        )}

        {!blocked && (
          <View style={styles.btnRow}>
            {p.isMe ? (
              <>
                <Pressable onPress={() => soon('Editar perfil')} style={[styles.small, { flex: 1, paddingHorizontal: 0 }]} accessibilityLabel="Editar perfil"><Icon name="pencil" size={20} /></Pressable>
                <Pressable onPress={() => void shareProfile()} style={[styles.small, { flex: 1, paddingHorizontal: 0 }]} accessibilityLabel="Partilhar perfil"><QrGlyph /></Pressable>
                <Pressable onPress={() => void inviteCrew()} style={[styles.small, { flex: 1, paddingHorizontal: 0 }]} accessibilityLabel="Convidar a malta"><Icon name="user-plus" size={20} /></Pressable>
                <Pressable onPress={() => soon('Carteira de Txills')} style={[styles.small, { flex: 1, paddingHorizontal: 0 }]} accessibilityLabel="Carteira de Txills"><Icon name="wallet" size={20} /></Pressable>
              </>
            ) : (
              <>
                <FollowButton username={p.username} following={p.following} requested={p.requested} isPrivate={p.isPrivate} />
                {p.following && (
                  <Pressable onPress={() => setSheet('gift')} style={[styles.small, { flex: 1, flexDirection: 'row', gap: 6 }]} accessibilityRole="button">
                    <Icon name="gift" size={18} /><Text style={styles.smallText}>Presentear</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => router.push(`/messages/${p.username}` as never)} style={[styles.small, { width: 44, paddingHorizontal: 0 }]} accessibilityLabel="Enviar mensagem"><Icon name="send" size={18} /></Pressable>
                <Pressable onPress={() => void shareProfile()} style={[styles.small, { width: 44, paddingHorizontal: 0 }]} accessibilityLabel="Partilhar perfil"><Icon name="share" size={18} /></Pressable>
              </>
            )}
          </View>
        )}

        {p.isMe && p.pendingRequests > 0 && (
          <Pressable onPress={() => soon('Pedidos para seguir')} style={styles.requests}>
            <Text style={styles.requestsText}>Pedidos para seguir</Text>
            <View style={styles.requestsN}><Text style={styles.requestsNText}>{p.pendingRequests}</Text></View>
          </Pressable>
        )}
      </View>

      {!p.canView && !blocked ? (
        <View style={[styles.private, cardShadow]}>
          <Icon name="lock" size={44} color={colors.zinc300} />
          <Text style={styles.privateTitle}>Esta conta é privada</Text>
          <Text style={styles.privateText}>{p.requested ? 'Pedido enviado. Quando aceitar, vês as publicações e stories.' : 'Segue para ver as publicações e stories.'}</Text>
        </View>
      ) : p.canView ? (
        <View style={{ marginTop: 24, paddingHorizontal: 16 }}>
          <View style={styles.tabs} accessibilityRole="tablist">
            {tabs.map((t) => (
              <Pressable key={t.id} onPress={() => setTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }} accessibilityLabel={t.label} style={[styles.tab, tab === t.id && { borderBottomColor: colors.zinc900 }]}>
                {t.icon === 'bookmark' ? <BookmarkIcon on={tab === t.id} size={24} /> : <Icon name={t.icon} size={24} color={tab === t.id ? colors.zinc900 : colors.zinc500} />}
              </Pressable>
            ))}
          </View>
          {posts.isLoading && <Text style={styles.loading}>A carregar…</Text>}
          {posts.isSuccess && items.length === 0 && tab !== 'all' && <Text style={styles.emptyText}>{p.isMe ? EMPTY[tab].me : EMPTY[tab].other}</Text>}
          {posts.isSuccess && items.length === 0 && tab === 'all' && (
            <View style={{ marginTop: 32, alignItems: 'center' }}>
              <Icon name="camera" size={36} color={colors.zinc300} />
              <Text style={styles.noPosts}>{p.isMe ? 'Ainda não publicaste nada' : 'Ainda sem publicações'}</Text>
              {p.isMe && <Text style={styles.first} onPress={() => router.push('/new' as never)}>Faz a primeira!</Text>}
            </View>
          )}
          <Grid posts={items} onOpen={openPost} width={Math.min(width, 576)} />
          {posts.hasNextPage && (
            <Pressable onPress={() => void posts.fetchNextPage()} disabled={posts.isFetchingNextPage} style={[styles.ghost, { alignSelf: 'center', marginTop: 16 }]}>
              {posts.isFetchingNextPage ? <ActivityIndicator color={colors.brand} /> : <Text style={styles.ghostText}>Ver mais</Text>}
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.white, paddingTop: insets.top }}>
      <FlatList data={[] as never[]} renderItem={() => null} ListHeaderComponent={header} ListFooterComponent={<View style={{ height: 32 }} />} showsVerticalScrollIndicator={false} />
      {sheet === 'menu' && (
        <Sheet title={`@${p.username}`} onClose={() => setSheet(null)}>
          <View style={{ paddingHorizontal: 24 }}>
            <Pressable onPress={() => { setSheet(null); void shareProfile(); }} style={styles.menuRow}><Icon name="share" size={22} /><Text style={styles.menuText}>Partilhar perfil</Text></Pressable>
            <Pressable onPress={() => setSheet('report')} style={styles.menuRow}><Icon name="flag" size={22} /><Text style={styles.menuText}>Denunciar</Text></Pressable>
            {!p.blockedByMe && <Pressable onPress={confirmBlock} style={styles.menuRow}><Icon name="block" size={22} color={colors.red600} /><Text style={[styles.menuText, { color: colors.red600 }]}>Bloquear</Text></Pressable>}
          </View>
        </Sheet>
      )}
      {sheet === 'report' && <ReportSheet type="user" id={p.username} onClose={() => setSheet(null)} />}
      {sheet === 'gift' && <GiftSheet recipient={{ username: p.username, displayName: p.displayName }} onClose={() => setSheet(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', marginHorizontal: 24 },
  errTitle: { marginTop: 12, fontSize: 20, fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  skel: { marginHorizontal: 16, height: 256, borderRadius: 28, backgroundColor: colors.zinc100 },
  topMe: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  topOther: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingTop: 20, paddingBottom: 8 },
  handleTop: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  card: { marginHorizontal: 16, backgroundColor: colors.white, borderRadius: 28, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 },
  avRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  bubble: { position: 'absolute', top: -52, left: 24, zIndex: 10, maxWidth: '78%', borderRadius: 18, backgroundColor: colors.white, paddingHorizontal: 14, paddingVertical: 8, boxShadow: '0 4px 14px rgba(0,0,0,0.12)' },
  bubbleText: { fontSize: 14, lineHeight: 19, color: colors.zinc800, textAlign: 'center' },
  stat: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  statN: { fontSize: 20, fontWeight: '800', color: colors.zinc900, lineHeight: 24 },
  statL: { fontSize: 13, color: colors.zinc600 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 20, fontWeight: '800', color: colors.zinc900, lineHeight: 25 },
  followsYou: { alignSelf: 'flex-start', marginTop: 4, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 8, paddingVertical: 2 },
  followsYouText: { fontSize: 12, fontWeight: '600', color: colors.zinc700 },
  meta: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  metaText: { fontSize: 14, color: colors.zinc600 },
  addBio: { marginTop: 12, fontSize: 14, fontWeight: '500', color: colors.zinc600, textDecorationLine: 'underline' },
  notice: { marginTop: 16, borderRadius: 16, backgroundColor: colors.zinc100, padding: 16, alignItems: 'center' },
  noticeTitle: { fontWeight: '700', color: colors.zinc900, textAlign: 'center' },
  noticeText: { marginTop: 4, fontSize: 14, color: colors.zinc600, textAlign: 'center' },
  btnRow: { marginTop: 16, flexDirection: 'row', gap: 6 },
  small: { height: 36, borderRadius: 12, backgroundColor: colors.zinc100, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  requests: { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, backgroundColor: colors.rose50, paddingHorizontal: 16, paddingVertical: 12 },
  requestsText: { fontWeight: '600', color: colors.brand },
  requestsN: { borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 10, paddingVertical: 2 },
  requestsNText: { fontSize: 14, color: '#fff' },
  private: { marginHorizontal: 16, marginTop: 24, borderRadius: 28, backgroundColor: colors.white, padding: 32, alignItems: 'center' },
  privateTitle: { marginTop: 12, fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  privateText: { marginTop: 4, color: colors.zinc600, textAlign: 'center' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.zinc200, marginBottom: 12 },
  tab: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  loading: { paddingVertical: 32, textAlign: 'center', fontSize: 14, color: colors.zinc500 },
  emptyText: { marginTop: 32, textAlign: 'center', color: colors.zinc600 },
  noPosts: { marginTop: 8, fontWeight: '600', color: colors.zinc600 },
  first: { marginTop: 12, fontWeight: '600', color: colors.brand, textDecorationLine: 'underline' },
  gift: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.brand },
  giftAmount: { fontSize: 22, fontWeight: '900', color: '#fff', lineHeight: 22 },
  giftLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.6, color: 'rgba(255,255,255,0.85)' },
  multi: { position: 'absolute', right: 6, top: 6, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 6, paddingVertical: 2 },
  multiText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  corner: { position: 'absolute', left: 6, top: 6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  ghost: { height: 44, paddingHorizontal: 24, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  ghostText: { fontSize: 15, fontWeight: '600', color: colors.zinc800 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16 },
  menuText: { fontSize: 17, fontWeight: '600', color: colors.zinc900 },
});
