import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { BadgeCheck, Heart, MessageCircle, Play, Repeat2 } from 'lucide-react-native';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { api, type Page, type Post } from '@/lib/api';
import { sized } from '@/lib/config';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';
import { Avatar } from './Avatar';

const FEED_KEY = ['feed'];

/** Uma publicação do feed: autor, foto ou vídeo, texto e ações (brindar, comentar, repostar). */
function PostCardBase({ post }: { post: Post }) {
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const shown = post.kind === 'repost' && post.repostOf ? post.repostOf : post;
  const media = shown.media[0];
  const ratio = media?.width && media?.height ? Math.min(1.25, Math.max(0.75, media.width / media.height)) : 1;
  const long = shown.body.length > 140;

  const cheer = useMutation({
    mutationFn: () => api.cheer(shown.id),
    onMutate: async () => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const patch = (cheered: boolean, cheers: number) =>
        qc.setQueryData<InfiniteData<Page<Post>>>(FEED_KEY, (d) =>
          d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === post.id ? { ...x, cheered, cheers } : x)) })) },
        );
      patch(!post.cheered, post.cheers + (post.cheered ? -1 : 1)); // responde já, confirma depois
      return { patch };
    },
    onSuccess: (r, _v, ctx) => ctx?.patch(r.cheered, r.cheers),
    onError: (_e, _v, ctx) => ctx?.patch(post.cheered, post.cheers),
  });

  return (
    <View style={styles.card}>
      {post.kind === 'repost' && (
        <View style={styles.repostRow}>
          <Repeat2 size={14} color={colors.muted} />
          <Text style={styles.muted}>{post.author.displayName} repostou</Text>
        </View>
      )}
      <View style={styles.head}>
        <Avatar username={shown.author.username} name={shown.author.displayName} size={40} />
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{shown.author.displayName}</Text>
            {shown.author.verified && <BadgeCheck size={15} color={shown.author.verifiedTier === 'official' ? colors.brand : '#0284c7'} />}
          </View>
          <Text style={styles.muted} numberOfLines={1}>
            @{shown.author.username} · {timeAgo(shown.createdAt)}
            {shown.locationLabel ? ` · ${shown.locationLabel}` : ''}
          </Text>
        </View>
      </View>

      {media && (
        <View style={[styles.media, { width, height: width / ratio }]}>
          <Image
            source={{ uri: sized(media.kind === 'video' ? media.posterUrl ?? media.url : media.url, 1080) }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
            recyclingKey={shown.id}
            accessibilityIgnoresInvertColors
          />
          {media.kind === 'video' && (
            <View style={styles.playWrap} pointerEvents="none">
              <View style={styles.play}>
                <Play size={26} color="#fff" fill="#fff" />
              </View>
            </View>
          )}
        </View>
      )}

      <View style={styles.actions}>
        <Pressable onPress={() => cheer.mutate()} hitSlop={10} style={styles.action} accessibilityRole="button" accessibilityLabel={shown.cheered ? 'Tirar o brinde' : 'Brindar'}>
          <Heart size={24} color={post.cheered ? colors.brand : colors.ink} fill={post.cheered ? colors.brand : 'transparent'} />
          <Text style={styles.count}>{post.cheers}</Text>
        </Pressable>
        <View style={styles.action}>
          <MessageCircle size={24} color={colors.ink} />
          <Text style={styles.count}>{shown.comments}</Text>
        </View>
        <View style={styles.action}>
          <Repeat2 size={24} color={post.reposted ? colors.brand : colors.ink} />
          <Text style={styles.count}>{shown.reposts}</Text>
        </View>
      </View>

      {shown.body.length > 0 && (
        <Pressable onPress={() => setExpanded((e) => !e)} disabled={!long} style={styles.bodyWrap}>
          <Text style={styles.body} numberOfLines={expanded ? undefined : 3}>
            <Text style={styles.name}>{shown.author.username} </Text>
            {shown.body}
          </Text>
          {long && !expanded && <Text style={styles.more}>ver mais</Text>}
        </Pressable>
      )}
    </View>
  );
}

export const PostCard = memo(PostCardBase);

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  repostRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  muted: { fontSize: 13, color: colors.muted },
  media: { backgroundColor: colors.soft },
  playWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  play: { width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 22, paddingHorizontal: 14, paddingTop: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  count: { fontSize: 14, fontWeight: '600', color: colors.ink },
  bodyWrap: { paddingHorizontal: 14, paddingTop: 8 },
  body: { fontSize: 15, lineHeight: 21, color: colors.text },
  more: { fontSize: 14, color: colors.muted, marginTop: 2 },
});
