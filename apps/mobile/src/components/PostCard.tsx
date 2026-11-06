import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import Svg, { Path } from 'react-native-svg';
import { Alert, FlatList, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { api, type Page, type Post } from '@/lib/api';
import { SITE_URL, sized } from '@/lib/config';
import { cardShadow, colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { VerifiedBadge } from './VerifiedBadge';

const soon = (what: string) => Alert.alert(what, 'Isto ainda está a ser passado para a app. Já vem aí.');

/** Atualiza uma publicação na lista do feed (também dentro de um repost). */
function usePatch(id: string) {
  const qc = useQueryClient();
  return (p: Partial<Post>) =>
    qc.setQueryData<InfiniteData<Page<Post>>>(['feed'], (d) => {
      const merge = (i: Post): Post => (i.id === id ? { ...i, ...p } : i.repostOf?.id === id ? { ...i, repostOf: { ...i.repostOf, ...p } } : i);
      return d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map(merge) })) };
    });
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
  const mine = post.author.id === me;
  const margin = width >= 360 ? 8 : 6;
  const pad = width >= 360 ? 16 : 14;
  const inner = width - margin * 2 - pad * 2;

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
          <Bookmark on={!!post.saved} />
        </Pressable>
        <Pressable onPress={() => soon('Mais opções')} hitSlop={6} style={styles.more} accessibilityRole="button" accessibilityLabel="Mais opções da publicação">
          <Icon name="more" size={26} strokeWidth={3} />
        </Pressable>
      </View>

      {post.body ? <Text style={styles.body}>{post.body}</Text> : null}
      <Carousel media={post.media} width={inner} />
      <Actions post={post} mine={mine} patch={patch} />
    </View>
  );
}

/** Marcador de guardar (o mesmo desenho do site): cheio quando está guardada. */
function Bookmark({ on }: { on: boolean }) {
  const c = on ? colors.zinc900 : colors.zinc700;
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill={on ? c : 'none'} stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6.5 4.5h11a1 1 0 0 1 1 1V20l-6.5-4.2L5.5 20V5.5a1 1 0 0 1 1-1z" />
    </Svg>
  );
}

/** Fotos e vídeos: arredondados (12), no máximo 448 de altura, com contador e pontos, como no site. */
function Carousel({ media, width }: { media: Post['media']; width: number }) {
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
            <View style={{ width, height: h }}>
              <Image source={{ uri: sized(m.kind === 'video' ? m.posterUrl ?? m.url : m.url, 720) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
              {m.kind === 'video' && (
                <View style={styles.playWrap} pointerEvents="none">
                  <View style={styles.play}>
                    <Icon name="play" size={28} color="#fff" solid />
                  </View>
                </View>
              )}
            </View>
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
function Actions({ post, mine, patch }: { post: Post; mine: boolean; patch: (p: Partial<Post>) => void }) {
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

  async function share() {
    const url = `${SITE_URL || 'https://txillapp.com'}/${post.media[0]?.kind === 'video' ? 'r' : 'p'}/${post.code}`;
    try {
      await Share.share({ message: url, url });
    } catch {
      /* cancelado */
    }
  }

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
        {post.comments > 0 && <Text style={styles.commentsCount}>{post.comments} {post.comments === 1 ? 'Comentário' : 'Comentários'}</Text>}
      </View>
      <View style={styles.bar}>
        <Btn label={post.cheered ? 'Brindou' : 'Brindar'} icon="cheers" size={24} color={post.cheered ? colors.amber600 : colors.zinc800} onPress={() => cheer.mutate()} />
        <Btn label="Comentar" icon="comment" onPress={() => soon('Comentários')} />
        <Btn label={post.reposted ? 'Repostado' : 'Repostar'} icon="repeat" color={post.reposted ? colors.green700 : colors.zinc800} onPress={() => soon('Repostar')} />
        {!mine && post.canGift && <Btn label="Presentear" icon="present" onPress={() => soon('Presentear')} />}
        <Btn label="Partilhar" icon="share" size={24} onPress={() => void share()} />
      </View>
    </>
  );
}

export const PostCard = memo(PostCardBase);

const styles = StyleSheet.create({
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
