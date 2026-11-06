import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, FlatList, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { api, type Page, type Post } from '@/lib/api';
import { SITE_URL, sized } from '@/lib/config';
import { cardShadow, colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { Avatar } from './Avatar';
import { BookmarkIcon } from './BookmarkIcon';
import { CommentsSheet } from './CommentsSheet';
import { Icon } from './Icon';
import { GiftSheet, PostMenuSheet, RepostSheet } from './PostSheets';
import { ShareSheet } from './ShareSheet';
import { TrackCard } from './TrackCard';
import { VerifiedBadge } from './VerifiedBadge';

/** Toque simples ou duplo: o duplo chama `double`; o simples só corre (com um pequeno atraso) se não vier segundo toque. */
function useTap(double?: () => void) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return (single?: () => void) => {
    if (!double) return single?.();
    if (t.current != null) {
      clearTimeout(t.current);
      t.current = null;
      double();
      return;
    }
    t.current = setTimeout(() => {
      t.current = null;
      single?.();
    }, 260);
  };
}

/** Duplo toque: brinda (só põe, nunca tira) e dá o sinal para a animação do copo. */
function useBrindar(post: Post, patch: (p: Partial<Post>) => void) {
  const [burst, setBurst] = useState(0);
  async function brindar() {
    setBurst((n) => n + 1);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    if (post.cheered) return;
    patch({ cheered: true, cheers: post.cheers + 1 });
    try {
      patch(await api.cheer(post.id));
    } catch {
      patch({ cheered: post.cheered, cheers: post.cheers });
    }
  }
  return { burst, brindar };
}

/** O copo grande que aparece e desvanece no meio do cartão quando se brinda com duplo toque. */
function BurstCup({ n }: { n: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (n === 0) return;
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 800, useNativeDriver: false }).start();
  }, [n, v]);
  if (n === 0) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 10, opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.5, 1.15, 1.35] }) }] }}
    >
      <Icon name="cheers" size={96} strokeWidth={1.6} color={colors.brand} />
    </Animated.View>
  );
}

/** Atualiza uma publicação na lista do feed (também dentro de um repost). */
function usePatch(id: string) {
  const qc = useQueryClient();
  return (p: Partial<Post>) => {
    const merge = (i: Post): Post => (i.id === id ? { ...i, ...p } : i.repostOf?.id === id ? { ...i, repostOf: { ...i.repostOf, ...p } } : i);
    for (const key of ['feed', 'profile-posts']) {
      qc.setQueriesData<InfiniteData<Page<Post>>>({ queryKey: [key] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map(merge) })) });
    }
    qc.setQueriesData<Post>({ queryKey: ['post'] }, (d) => (d ? merge(d) : d));
  };
}

/** O cartão de uma publicação, igual ao do site: cantos de 26, sombra suave, autor, texto, fotos e a barra de ações. */
function PostCardBase({ post, me }: { post: Post; me?: string }) {
  if (post.kind === 'repost' && post.repostOf && !post.body) {
    return (
      <View>
        <View style={styles.repostBar}>
          <Icon name="repeat" size={16} color={colors.zinc600} />
          <Text style={styles.repostText}>{post.author.id === me ? 'Repostaste' : `${post.author.displayName} repostou`}</Text>
        </View>
        <PostCard post={post.repostOf} me={me} />
      </View>
    );
  }
  return <PostBody post={post} me={me} />;
}

function PostBody({ post, me }: { post: Post; me?: string }) {
  const { width } = useWindowDimensions();
  const patch = usePatch(post.id);
  const { burst, brindar } = useBrindar(post, patch);
  const mine = post.author.id === me;
  const margin = width >= 360 ? 8 : 6;
  const pad = width >= 360 ? 16 : 14;
  const inner = width - margin * 2 - pad * 2;
  const [sheet, setSheet] = useState<null | 'menu' | 'comments' | 'repost' | 'share' | { gift: { username: string; displayName: string; amount?: number; note?: string } }>(null);

  async function toggleSave() {
    const next = !post.saved;
    patch({ saved: next });
    try {
      await (next ? api.savePost(post.id) : api.unsavePost(post.id));
    } catch {
      patch({ saved: !next });
    }
  }

  return (
    <View style={[styles.card, cardShadow, { marginHorizontal: margin, paddingHorizontal: pad }]}>
      <View style={styles.header}>
        <Avatar name={post.author.displayName} username={post.author.username} size={52} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { flexShrink: 1 }]} numberOfLines={1}>{post.author.displayName}</Text>
            {post.author.verified && <VerifiedBadge size={16} tier={post.author.verifiedTier} />}
          </View>
          {post.locationLabel ? (
            <View style={styles.locRow}>
              <Icon name="map-pin" size={14} color={colors.zinc600} />
              <Text style={styles.loc} numberOfLines={1}>{post.locationLabel}</Text>
            </View>
          ) : (
            <Text style={styles.handle} numberOfLines={1}>@{post.author.username}</Text>
          )}
        </View>
        <Text style={styles.time}>
          {timeAgo(post.createdAt)}
          {post.editedAt ? ' · editado' : ''}
        </Text>
        <Pressable onPress={() => void toggleSave()} hitSlop={6} style={styles.save} accessibilityRole="button" accessibilityLabel={post.saved ? 'Tirar dos guardados' : 'Guardar'}>
          <BookmarkIcon on={!!post.saved} size={24} />
        </Pressable>
        <Pressable onPress={() => setSheet('menu')} hitSlop={6} style={styles.more} accessibilityRole="button" accessibilityLabel="Mais opções da publicação">
          <Icon name="more" size={26} strokeWidth={3} />
        </Pressable>
      </View>

      {post.kind === 'gift' && post.gift ? (
        <GiftBlock post={post} g={post.gift} me={me} onDouble={() => void brindar()} />
      ) : (
        <>
          {post.body ? <Text style={styles.body}>{post.body}</Text> : null}
          <Carousel media={post.media} width={inner} reelId={post.id} onDouble={() => void brindar()} />
        </>
      )}
      <BurstCup n={burst} />
      {post.music ? <TrackCard track={post.music} autoplay /> : null}
      <Actions post={post} mine={mine} patch={patch} open={(k) => setSheet(k === 'gift' ? { gift: { username: post.author.username, displayName: post.author.displayName } } : k)} />
      {sheet === 'menu' && <PostMenuSheet post={post} mine={mine} onClose={() => setSheet(null)} onSaved={(saved) => patch({ saved })} onShare={() => setSheet('share')} />}
      {sheet === 'share' && <ShareSheet post={post} onClose={() => setSheet(null)} />}
      {sheet === 'comments' && (
        <CommentsSheet
          post={post}
          onClose={() => setSheet(null)}
          onDelta={(d) => patch({ comments: Math.max(0, post.comments + d) })}
          onGift={(to, amount, note) => setSheet({ gift: { ...to, amount, note } })}
        />
      )}
      {sheet === 'repost' && <RepostSheet post={post} onChange={patch} onClose={() => setSheet(null)} />}
      {typeof sheet === 'object' && sheet && (
        <GiftSheet
          recipient={sheet.gift}
          postId={sheet.gift.username === post.author.username && !sheet.gift.amount ? post.id : undefined}
          preset={sheet.gift.amount ? { amount: sheet.gift.amount, note: sheet.gift.note, visibility: 'private' } : undefined}
          onClose={() => setSheet(null)}
        />
      )}
    </View>
  );
}


/** Cartão de presente (X presenteou Y): degradê coral, as duas fotos, o valor e a mensagem. Duplo toque também brinda. */
function GiftBlock({ post, g, me, onDouble }: { post: Post; g: NonNullable<Post['gift']>; me?: string; onDouble?: () => void }) {
  const router = useRouter();
  const tap = useTap(onDouble);
  const sender = post.author;
  const go = (u: string) => router.push((u === (me ?? '') ? '/profile' : `/u/${u}`) as never);
  return (
    <>
      <View style={styles.giftHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="gift" size={15} color={colors.brand} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.brand }}>Presente</Text>
        </View>
        <Text style={{ fontSize: 14, color: colors.zinc500 }}>{timeAgo(post.createdAt)}{post.editedAt ? ' · editado' : ''}</Text>
      </View>
      <Pressable onPress={() => tap()} style={styles.giftCard} accessibilityLabel="Presente (toca duas vezes para brindar)">
        <LinearGradient colors={[colors.brand, '#e8475f', '#ff8a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={[styles.giftDot, { left: -24, top: -24, width: 96, height: 96, borderRadius: 48 }]} />
        <View style={[styles.giftDot, { right: -16, bottom: -32, width: 112, height: 112, borderRadius: 56 }]} />
        <View style={{ width: 132, height: 76, alignSelf: 'center' }}>
          <Pressable onPress={() => go(g.recipient.username)} style={[styles.giftAva, { right: 0 }]} accessibilityLabel={`Perfil de ${g.recipient.displayName}`}>
            <Avatar name={g.recipient.displayName} username={g.recipient.username} size={68} />
          </Pressable>
          <Pressable onPress={() => go(sender.username)} style={[styles.giftAva, { left: 0, zIndex: 2 }]} accessibilityLabel={`Perfil de ${sender.displayName}`}>
            <Avatar name={sender.displayName} username={sender.username} size={68} />
          </Pressable>
          <View style={styles.giftBadge}><Icon name="gift" size={20} color={colors.brand} /></View>
        </View>
        <Text style={styles.giftLine}>
          <Text style={{ fontWeight: '800' }} onPress={() => go(sender.username)}>{sender.displayName}</Text> presenteou <Text style={{ fontWeight: '800' }} onPress={() => go(g.recipient.username)}>{g.recipient.displayName}</Text>
        </Text>
        <Text style={styles.giftAmount}>{g.amount.toLocaleString('pt-PT')}</Text>
        <Text style={styles.giftUnit}>TXILLS</Text>
        {post.body ? <Text style={styles.giftNote}>{post.body}</Text> : null}
      </Pressable>
    </>
  );
}

/** Fotos e vídeos: arredondados (12), no máximo 448 de altura, com contador e pontos, como no site. */
function Carousel({ media, width, reelId, onDouble }: { media: Post['media']; width: number; reelId?: string; onDouble?: () => void }) {
  const router = useRouter();
  const tap = useTap(onDouble);
  const [i, setI] = useState(0);
  if (media.length === 0) return null;
  const heightOf = (m: Post['media'][number]) => {
    const natural = m.width && m.height ? (width * m.height) / m.width : width;
    return Math.min(448, Math.max(120, natural));
  };
  const h = heightOf(media[i] ?? media[0]);
  const onView = ({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    const first = viewableItems[0]?.index;
    if (first != null) setI(first);
  };
  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ borderRadius: 12, overflow: 'hidden', height: h, backgroundColor: colors.zinc100 }}>
        <FlatList
          data={media}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(m) => m.url}
          onViewableItemsChanged={onView}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          renderItem={({ item: m }) => (
            <Pressable style={{ width, height: h }} onPress={() => tap(m.kind === 'video' && reelId ? () => router.push(`/r/${reelId}` as never) : undefined)} accessibilityRole="button" accessibilityLabel={m.kind === 'video' ? 'Abrir o reel' : 'Foto (toca duas vezes para brindar)'}>
              <Image source={{ uri: sized(m.kind === 'video' ? m.posterUrl ?? m.url : m.url, 720) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
              {m.kind === 'video' && (
                <View style={styles.playWrap} pointerEvents="none">
                  <View style={styles.play}>
                    <Icon name="play" size={28} color="#fff" solid />
                  </View>
                </View>
              )}
            </Pressable>
          )}
        />
        {media.length > 1 && (
          <View style={styles.counter} pointerEvents="none">
            <Text style={styles.counterText}>{i + 1}/{media.length}</Text>
          </View>
        )}
      </View>
      {media.length > 1 && (
        <View style={styles.dots}>
          {media.map((_, n) => (
            <View key={n} style={[styles.dot, { backgroundColor: n === i ? colors.brand : colors.zinc300 }]} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Contadores em cima e, por baixo da linha, as ações com ícone e nome (Brindar, Comentar, Repostar, Presentear, Partilhar). */
function Actions({ post, mine, patch, open }: { post: Post; mine: boolean; patch: (p: Partial<Post>) => void; open: (k: 'comments' | 'repost' | 'gift' | 'share') => void }) {
  const cheer = useMutation({
    mutationFn: () => api.cheer(post.id),
    onMutate: () => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      patch({ cheered: !post.cheered, cheers: post.cheers + (post.cheered ? -1 : 1) }); // responde já, confirma depois
    },
    onSuccess: (r) => patch(r),
    onError: () => patch({ cheered: post.cheered, cheers: post.cheers }),
  });
  const chips = [
    { n: post.cheers, icon: 'cheers' as const },
    { n: post.reposts, icon: 'repeat' as const },
    { n: post.gifts, icon: 'present' as const },
  ].filter((c) => c.n > 0);

  const share = () => open('share');

  const Btn = ({ label, icon, onPress, color = colors.zinc800, size = 22, strokeWidth }: { label: string; icon: Parameters<typeof Icon>[0]['name']; onPress: () => void; color?: string; size?: number; strokeWidth?: number }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.barBtn, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={icon} size={size} color={color} strokeWidth={strokeWidth} />
      <Text style={[styles.word, { color }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <View style={styles.counts}>
        <View style={styles.chips}>
          {chips.map((c) => (
            <View key={c.icon} style={styles.chip}>
              <Icon name={c.icon} size={18} color={colors.zinc700} />
              <Text style={styles.chipText}>{c.n}</Text>
            </View>
          ))}
        </View>
        {post.comments > 0 && (
          <Pressable onPress={() => open('comments')} hitSlop={6}>
            <Text style={styles.commentsCount}>{post.comments} {post.comments === 1 ? 'Comentário' : 'Comentários'}</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.bar}>
        <Btn label={post.cheered ? 'Brindou' : 'Brindar'} icon="cheers" size={24} color={post.cheered ? colors.amber600 : colors.zinc800} onPress={() => cheer.mutate()} />
        <Btn label="Comentar" icon="comment" onPress={() => open('comments')} />
        <Btn label={post.reposted ? 'Repostado' : 'Repostar'} icon="repeat" color={post.reposted ? colors.green700 : colors.zinc800} onPress={() => open('repost')} />
        {!mine && post.canGift && <Btn label="Presentear" icon="present" onPress={() => open('gift')} />}
        <Btn label="Partilhar" icon="share" size={24} onPress={share} />
      </View>
    </>
  );
}

export const PostCard = memo(PostCardBase);

const styles = StyleSheet.create({
  giftHead: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  giftCard: { marginTop: 8, overflow: 'hidden', borderRadius: 24, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20, alignItems: 'center', boxShadow: '0 6px 18px rgba(214,51,79,0.35)' },
  giftDot: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.1)' },
  giftAva: { position: 'absolute', top: 0, borderRadius: 38, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)' },
  giftBadge: { position: 'absolute', bottom: -4, left: 48, zIndex: 3, width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' },
  giftLine: { marginTop: 16, fontSize: 16, lineHeight: 20, color: '#fff', textAlign: 'center' },
  giftAmount: { marginTop: 8, fontSize: 40, lineHeight: 40, fontWeight: '900', color: '#fff', letterSpacing: -1 },
  giftUnit: { fontSize: 13, fontWeight: '700', letterSpacing: 2.6, color: 'rgba(255,255,255,0.85)' },
  giftNote: { marginTop: 16, maxWidth: '92%', overflow: 'hidden', borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 16, paddingVertical: 10, fontSize: 16, lineHeight: 22, color: '#fff', textAlign: 'center' },
  card: { backgroundColor: colors.white, borderRadius: 26, paddingTop: 16, marginBottom: 20 },
  repostBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 24, marginBottom: 6 },
  repostText: { fontSize: 14, fontWeight: '500', color: colors.zinc600, lineHeight: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 19, fontWeight: '500', color: colors.zinc800, lineHeight: 24 },
  handle: { fontSize: 15, color: colors.zinc500, lineHeight: 22 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  loc: { fontSize: 15, color: colors.zinc600, lineHeight: 22, flexShrink: 1 },
  time: { fontSize: 15, color: colors.zinc500, alignSelf: 'flex-start', lineHeight: 22 },
  save: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  more: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', marginRight: -8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  body: { marginTop: 16, fontSize: 19, lineHeight: 28.5, color: colors.zinc800 },
  playWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  counter: { position: 'absolute', right: 12, top: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  counterText: { color: '#fff', fontSize: 12, fontWeight: '600', lineHeight: 16 },
  dots: { marginTop: 8, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  counts: { marginTop: 12, minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap', flexShrink: 1 },
  chip: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 15, color: colors.zinc700 },
  commentsCount: { fontSize: 14, fontWeight: '500', color: colors.zinc700 },
  bar: { marginTop: 4, flexDirection: 'row', alignItems: 'stretch', borderTopWidth: 1, borderTopColor: colors.zinc200 },
  barBtn: { flex: 1, minHeight: 56, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 2 },
  word: { fontSize: 13, fontWeight: '500', lineHeight: 16, maxWidth: '100%' },
});
