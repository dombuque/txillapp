import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { Post } from '@/lib/api';
import { duetHref, remixActions, remixCount, remixesHref, remixLabel, remixTarget, stickerText, type RemixOf, type RemixPerson } from '@/lib/remix';
import { colors } from '@/lib/theme';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';

/** O símbolo do dueto: dois ecrãs lado a lado (não há ícone Tx para isto). */
export function DuetGlyph({ size = 26, color = '#fff' }: { size?: number; color?: string }) {
  const w = size * 0.36, h = size * 0.62, r = size * 0.08, b = Math.max(1.6, size * 0.08);
  return (
    <View style={{ width: size, height: size, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: size * 0.08 }} accessible={false}>
      <View style={{ width: w, height: h, borderRadius: r, borderWidth: b, borderColor: color }} />
      <View style={{ width: w, height: h, borderRadius: r, borderWidth: b, borderColor: color, backgroundColor: color }} />
    </View>
  );
}

/**
 * O autocolante do comentário (avatar, @ e texto), igual no estúdio e por cima da tcheka. `onPress` leva ao comentário;
 * no estúdio não leva nada (arrasta-se).
 */
export function CommentSticker({ author, body, onPress, style, compact = false }: { author: RemixPerson; body: string; onPress?: () => void; style?: StyleProp<ViewStyle>; compact?: boolean }) {
  const inner = (
    <>
      <View style={st.stickerHead}>
        <Avatar name={author.displayName} username={author.username} size={compact ? 20 : 24} />
        <Text style={st.stickerUser} numberOfLines={1}>Resposta a @{author.username}</Text>
      </View>
      <Text style={[st.stickerBody, compact && { fontSize: 13 }]} numberOfLines={3}>{stickerText(body)}</Text>
    </>
  );
  if (!onPress) return <View style={[st.sticker, style]} accessible accessibilityLabel={`Comentário de @${author.username}: ${stickerText(body)}`}>{inner}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.sticker, style, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="link" accessibilityLabel={`Comentário de @${author.username}: ${stickerText(body)}. Abrir o comentário`}>
      {inner}
    </Pressable>
  );
}

/** «Dueto com @x» / «Resposta a @y»: a etiqueta por cima do texto da tcheka. Leva ao original. */
export function RemixTag({ remix, dark = true }: { remix: RemixOf | null | undefined; dark?: boolean }) {
  const router = useRouter();
  const label = remixLabel(remix);
  if (!remix || !label) return null;
  const to = remixTarget(remix);
  const color = dark ? '#fff' : colors.zinc800;
  const body = (
    <>
      {remix.kind === 'duet' ? <DuetGlyph size={16} color={color} /> : <Icon name="reply" size={14} color={color} />}
      <Text style={[st.tagText, { color }]} numberOfLines={1}>{label}</Text>
    </>
  );
  if (!to) return <View style={[st.tag, !dark && st.tagLight, { opacity: 0.8 }]}>{body}</View>;
  return (
    <Pressable onPress={() => router.push(to as never)} style={({ pressed }) => [st.tag, !dark && st.tagLight, pressed && { opacity: 0.7 }]} accessibilityRole="link" accessibilityLabel={`${label}. Abrir o original`}>
      {body}
    </Pressable>
  );
}

/** O autocolante por cima de uma resposta com tcheka, no sítio onde a pessoa o deixou. Leva ao comentário no original. */
export function ReplyStickerOverlay({ remix }: { remix: RemixOf | null | undefined }) {
  const router = useRouter();
  if (!remix || remix.kind !== 'reply' || !remix.comment) return null;
  const s = remix.sticker ?? { x: 0.06, y: 0.16 };
  const to = remixTarget(remix);
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 6 }]} pointerEvents="box-none">
      <CommentSticker
        author={remix.comment.author}
        body={remix.comment.body}
        onPress={to ? () => router.push(to as never) : undefined}
        style={{ position: 'absolute', left: `${s.x * 100}%`, top: `${s.y * 100}%`, maxWidth: '62%' }}
      />
    </View>
  );
}

/**
 * O botão «Remix» das ações de uma tcheka (a equipa «ver» só tem de o pôr no lado). Abre o menu: «Fazer dueto» (se o dono
 * deixa) e «Duetos e respostas» (se já houver). `variant`: 'rail' (círculo nos Reels) ou 'row' (botão com texto).
 */
export function RemixButton({ post, variant = 'rail', circleStyle, labelStyle }: { post: Post; variant?: 'rail' | 'row'; circleStyle?: StyleProp<ViewStyle>; labelStyle?: object }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const a = remixActions(post);
  if (!a.show) return null;
  const go = (to: string) => { setOpen(false); router.push(to as never); };
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [variant === 'rail' ? st.rail : st.rowBtn, pressed && { transform: [{ scale: 0.92 }] }]}
        accessibilityRole="button"
        accessibilityLabel={a.count ? `Remix (${remixCount(a.count)})` : 'Remix: fazer dueto'}
      >
        {variant === 'rail' ? (
          <>
            <View style={[st.circle, circleStyle]}><DuetGlyph size={26} /></View>
            <Text style={[st.railText, labelStyle]}>{a.count > 0 ? a.count : 'Remix'}</Text>
          </>
        ) : (
          <>
            <DuetGlyph size={20} color={colors.zinc800} />
            <Text style={st.rowText}>Remix{a.count > 0 ? ` · ${a.count}` : ''}</Text>
          </>
        )}
      </Pressable>
      {open && (
        <Sheet title="Remix" onClose={() => setOpen(false)} variant="menu">
          <View style={st.menu}>
            {a.duet ? (
              <Pressable onPress={() => go(duetHref(post.id))} style={st.menuRow} accessibilityRole="button">
                <DuetGlyph size={24} color={colors.zinc800} />
                <View style={{ flex: 1 }}>
                  <Text style={st.menuText}>Fazer dueto</Text>
                  <Text style={st.menuSub}>O teu vídeo ao lado desta tcheka, com o som dela</Text>
                </View>
              </Pressable>
            ) : null}
            <Pressable onPress={() => go(remixesHref(post.id))} style={st.menuRow} accessibilityRole="button">
              <Icon name="film" size={24} />
              <View style={{ flex: 1 }}>
                <Text style={st.menuText}>Duetos e respostas</Text>
                <Text style={st.menuSub}>{a.count ? remixCount(a.count) : 'Ainda ninguém fez. Sê o primeiro!'}</Text>
              </View>
            </Pressable>
            {!a.duet && post.canRemix === false ? <Text style={st.menuNote}>{post.author.displayName} não deixa fazer duetos com esta tcheka.</Text> : null}
          </View>
        </Sheet>
      )}
    </>
  );
}

/**
 * Por baixo de uma publicação aberta: «Duetos e respostas · N» (a lista) quando já há algum; numa tcheka sem nenhum e que
 * o dono deixa, «Fazer dueto com esta tcheka».
 */
export function RemixesLink({ post }: { post: Post }) {
  const router = useRouter();
  const a = remixActions(post);
  if (!a.show) return null;
  const to = a.list ? remixesHref(post.id) : duetHref(post.id);
  return (
    <Pressable onPress={() => router.push(to as never)} style={({ pressed }) => [st.link, pressed && { opacity: 0.7 }]} accessibilityRole="link">
      <DuetGlyph size={18} color={colors.zinc800} />
      <Text style={st.linkText}>{a.list ? `Duetos e respostas · ${a.count}` : 'Fazer dueto com esta tcheka'}</Text>
      <Icon name="chevron-right" size={16} color={colors.zinc500} />
    </Pressable>
  );
}

const SHADOW = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;
const st = StyleSheet.create({
  sticker: { backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, gap: 5, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4, minWidth: 150 },
  stickerHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stickerUser: { color: colors.zinc600, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  stickerBody: { color: colors.zinc900, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, maxWidth: '100%' },
  tagLight: { backgroundColor: colors.zinc100 },
  tagText: { fontSize: 13, fontWeight: '700', flexShrink: 1, ...SHADOW },
  rail: { alignItems: 'center', gap: 4 },
  circle: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  railText: { color: '#fff', fontSize: 12, fontWeight: '600', ...SHADOW },
  rowBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 10, borderRadius: 18 },
  rowText: { color: colors.zinc800, fontSize: 14, fontWeight: '600' },
  menu: { paddingHorizontal: 12, paddingBottom: 12, gap: 2 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12 },
  menuText: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  menuSub: { fontSize: 13, color: colors.zinc500, marginTop: 1 },
  menuNote: { fontSize: 13, color: colors.zinc500, paddingHorizontal: 8, paddingTop: 6 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, marginHorizontal: 12, marginTop: 6, borderRadius: 12, backgroundColor: colors.zinc100 },
  linkText: { flex: 1, color: colors.zinc800, fontSize: 14, fontWeight: '700' },
});
