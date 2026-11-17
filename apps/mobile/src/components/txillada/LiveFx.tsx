import { useEffect } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, interpolate, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { InlineBadge, NameWithBadge } from '@/components/NameWithBadge';
import { colors } from '@/lib/theme';
import { REACTIONS, joinedParts, partsText, viewerStack, type FxParticle, type FxPerson, type Hello, type ReactionKind, type TextPart } from '@/lib/txilladaFx';
import { viewersLabel } from '@/lib/txillada';

/** Um texto com @: cada conta verificada leva o selo logo a seguir ao @ (em todo o lado, como nos comentários). */
function Parts({ parts, style, lines = 1 }: { parts: readonly TextPart[]; style: object; lines?: number }) {
  const size = (style as { fontSize?: number }).fontSize ?? 14;
  return (
    <Text style={style} numberOfLines={lines}>
      {parts.map((p, i) => (p.t === 'text' ? p.s : (
        <Text key={i}>@{p.u.username}<InlineBadge who={p.u} fontSize={size} /></Text>
      )))}
    </Text>
  );
}

/**
 * A Txillada moderna, por cima do vídeo: as reações a subir (FxLayer), a barra das reações de um toque (ReactionBar), os
 * olás (HelloStack), «@fulano entrou» (JoinedToast), os avatares de quem está a ver (ViewersStack) e a lista «A ver agora»
 * (ViewersList). A lógica pura está em lib/txilladaFx.ts; o estado em lib/txilladaFxRoom.ts. Com «reduzir movimento», nada
 * viaja nem roda: os emojis aparecem e desvanecem no sítio.
 */

const glass = Platform.OS === 'web' ? ({ backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)' } as object) : {};
const shadow = Platform.OS === 'web' ? ({ textShadow: '0 2px 10px rgba(0,0,0,0.35)' } as object) : { textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 2 } };

// ─── As reações a subir ─────────────────────────────────────────────────────────────────────────────────────────────

function Particle({ p, travel, reduce }: { p: FxParticle; travel: number; reduce: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    // O tempo corre a direito; a subida abranda no fim (o emoji fica à vista quase todo o tempo e desvanece lá em cima).
    t.value = withDelay(p.delay, withTiming(1, { duration: p.dur, easing: Easing.linear }));
  }, [p.delay, p.dur, t]);
  const a = useAnimatedStyle(() => {
    const v = t.value;
    if (reduce) return { opacity: interpolate(v, [0, 0.2, 0.75, 1], [0, 1, 1, 0]), transform: [{ translateY: -24 * v }] };
    const rise = 1 - (1 - v) * (1 - v) * (1 - v) * 0.6 - (1 - v) * 0.4;
    return {
      opacity: interpolate(v, [0, 0.06, 0.78, 1], [0, 1, 1, 0]),
      transform: [
        { translateY: -travel * rise },
        { translateX: p.x * v + Math.sin(v * Math.PI * 2.2) * 7 },
        { rotate: `${p.rot * v}deg` },
        { scale: interpolate(v, [0, 0.14, 1], [0.35, p.scale * 1.18, p.scale * 0.85]) },
      ],
    };
  });
  return (
    <Animated.Text style={[fx.particle, { fontSize: p.size, lineHeight: p.size * 1.2 }, a]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {p.emoji}
    </Animated.Text>
  );
}

/** A faixa da direita por onde sobem as reações (de todos). `bottom`/`height`: onde começa e até onde sobem. */
export function FxLayer({ items, bottom, height, right, reduce }: { items: readonly FxParticle[]; bottom: number; height: number; right: number; reduce: boolean }) {
  if (!items.length) return null;
  return (
    <View style={[fx.layer, { bottom, height, right }]} pointerEvents="none">
      {items.map((p) => <Particle key={p.id} p={p} travel={Math.max(120, height - 40)} reduce={reduce} />)}
    </View>
  );
}

// ─── A barra das reações ────────────────────────────────────────────────────────────────────────────────────────────

/** Os botões de um toque: «👋 Olá», 🍻, 🔥, 😂, ❤️. `only`: as que esta pessoa pode mandar (o anfitrião não brinda). */
export function ReactionBar({ onReact, only }: { onReact: (k: ReactionKind) => void; only?: readonly ReactionKind[] }) {
  const list = only ? REACTIONS.filter((r) => only.includes(r.kind)) : REACTIONS;
  return (
    <View style={fx.bar} accessibilityRole="toolbar" accessibilityLabel="Reações">
      {list.map((r) => (
        <Pressable
          key={r.kind}
          onPress={() => onReact(r.kind)}
          hitSlop={3}
          style={({ pressed }) => [fx.react, r.label ? fx.reactWide : null, pressed && { transform: [{ scale: 0.86 }], backgroundColor: 'rgba(214,51,79,0.55)' }]}
          accessibilityRole="button"
          accessibilityLabel={r.a11y}
        >
          <Text style={fx.reactEmoji}>{r.emoji}</Text>
          {r.label ? <Text style={fx.reactLabel}>{r.label}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** O botão do anfitrião: «👋 Olá a todos» (a saudação aparece em grande a quem está a ver). */
export function HelloAllButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={4} style={({ pressed }) => [fx.helloAll, pressed && { transform: [{ scale: 0.94 }] }]} accessibilityRole="button" accessibilityLabel="Dizer olá a todos">
      <Text style={fx.reactEmoji}>👋</Text>
      <Text style={fx.helloAllText}>Olá a todos</Text>
    </Pressable>
  );
}

// ─── Os olás ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Os balões curtos «@rui: Olá 👋» (em cima, por baixo dos números) e a saudação do anfitrião em grande, ao centro. */
export function HelloStack({ items, top, left, width }: { items: readonly Hello[]; top: number; left: number; width: number }) {
  const big = items.find((h) => h.big);
  const small = items.filter((h) => !h.big);
  return (
    <>
      {big ? (
        <View style={fx.bigWrap} pointerEvents="none">
          <Animated.View key={big.id} entering={FadeIn.duration(220)} exiting={FadeOut.duration(260)} style={fx.big} accessibilityRole="alert" accessibilityLabel={big.text}>
            <Text style={fx.bigEmoji}>👋</Text>
            <View style={fx.bigWho}>
              <View style={fx.bigRing}><Avatar name={big.avatar.displayName} username={big.avatar.avatarUrl ? big.avatar.username : undefined} size={30} /></View>
              <Parts parts={big.parts.map((x) => (x.t === 'text' ? { ...x, s: x.s.replace(/ 👋$/u, '') } : x))} style={fx.bigText} lines={2} />
            </View>
          </Animated.View>
        </View>
      ) : null}
      {small.length ? (
        <View style={[fx.helloCol, { top, left, width }]} pointerEvents="none">
          {small.map((h) => (
            <Animated.View key={h.id} entering={FadeIn.duration(180)} exiting={FadeOut.duration(240)} style={fx.hello} accessibilityLabel={h.text}>
              <Avatar name={h.avatar.displayName} username={h.avatar.avatarUrl ? h.avatar.username : undefined} size={22} />
              <Parts parts={h.parts} style={fx.helloText} />
            </Animated.View>
          ))}
        </View>
      ) : null}
    </>
  );
}

// ─── «@fulano entrou» ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * O aviso discreto de quem entrou (um de cada vez, agrupado: «@a, @b e mais 3 entraram»). O anfitrião pode responder com
 * um toque («Dizer olá»): a uma pessoa, «Olá @rui» com o aceno; a várias, «Olá a todos».
 */
export function JoinedToast({ users, bottom, left, onHello }: { users: readonly FxPerson[] | null; bottom: number; left: number; onHello?: (u: FxPerson | null) => void }) {
  if (!users?.length) return null;
  const parts = joinedParts(users);
  const text = partsText(parts);
  const first = users[0];
  const body = (
    <>
      <View style={fx.joinAvatars}>
        {users.slice(0, 3).map((u, i) => (
          <View key={u.username} style={[fx.joinAv, i > 0 && { marginLeft: -8 }]}>
            <Avatar name={u.displayName} username={u.avatarUrl ? u.username : undefined} size={20} />
          </View>
        ))}
      </View>
      <Parts parts={parts} style={fx.joinText} />
      {onHello ? <View style={fx.joinBtn}><Text style={fx.joinBtnText}>{users.length === 1 ? 'Dizer olá' : 'Olá a todos'}</Text></View> : null}
    </>
  );
  return (
    <View style={[fx.joinWrap, { bottom, left }]} pointerEvents="box-none">
      <Animated.View key={text} entering={FadeIn.duration(200)} exiting={FadeOut.duration(220)}>
        {onHello ? (
          <Pressable onPress={() => onHello(users.length === 1 ? first : null)} style={({ pressed }) => [fx.join, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`${text}. Toca para dizer olá`}>
            {body}
          </Pressable>
        ) : (
          <View style={fx.join} accessibilityRole="text" accessibilityLabel={text} accessibilityLiveRegion="polite">{body}</View>
        )}
      </Animated.View>
    </View>
  );
}

// ─── Quem está a ver ────────────────────────────────────────────────────────────────────────────────────────────────

/** Os avatares empilhados de quem está a ver, com o olho e o número. Tocar abre a lista «A ver agora». */
export function ViewersStack({ items, total, onPress }: { items: readonly FxPerson[]; total: number; onPress: () => void }) {
  const s = viewerStack(items, total, 3);
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [fx.stack, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`${viewersLabel(s.count)}. Ver quem está a ver`}>
      {s.shown.length ? (
        <View style={fx.stackAvatars}>
          {s.shown.map((u, i) => (
            <View key={u.username} style={[fx.stackAv, i > 0 && { marginLeft: -9 }, { zIndex: 3 - i }]}>
              <Avatar name={u.displayName} username={u.avatarUrl ? u.username : undefined} size={22} />
            </View>
          ))}
        </View>
      ) : null}
      <Icon name="eye" size={14} color="#fff" strokeWidth={2.2} />
      <Text style={fx.stackText}>{s.count > 999 ? viewersLabel(s.count).replace(' a ver', '') : String(s.count)}</Text>
    </Pressable>
  );
}

/** A lista «A ver agora» (avatar, nome e @). Vazia: «Ainda ninguém está a ver». */
export function ViewersList({ items, onOpen }: { items: readonly FxPerson[]; onOpen?: (u: FxPerson) => void }) {
  if (!items.length) {
    return (
      <View style={fx.empty}>
        <Icon name="users" size={28} color={colors.zinc300} />
        <Text style={fx.emptyText}>Ainda ninguém está a ver.</Text>
      </View>
    );
  }
  return (
    <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 8 }}>
      {items.map((u) => (
        <Pressable key={u.username} onPress={onOpen ? () => onOpen(u) : undefined} style={({ pressed }) => [fx.row, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole={onOpen ? 'link' : undefined} accessibilityLabel={`${u.displayName}, @${u.username}`}>
          <Avatar name={u.displayName} username={u.avatarUrl ? u.username : undefined} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <NameWithBadge name={u.displayName} who={u} style={fx.rowName} />
            <Text style={fx.rowUser} numberOfLines={1}>@{u.username}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const fx = StyleSheet.create({
  layer: { position: 'absolute', width: 92, zIndex: 6, elevation: 6 },
  particle: { position: 'absolute', bottom: 0, right: 14, textAlign: 'center', ...(shadow as object) },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  react: { height: 40, minWidth: 40, paddingHorizontal: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: 'rgba(14,14,18,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', ...glass },
  reactWide: { paddingHorizontal: 12 },
  reactEmoji: { fontSize: 19, lineHeight: 23 },
  reactLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  helloAll: { height: 40, paddingHorizontal: 14, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brand, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  helloAllText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  bigWrap: { position: 'absolute', left: 0, right: 0, top: '34%', alignItems: 'center', zIndex: 8, elevation: 8, paddingHorizontal: 24 },
  big: { alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 16, borderRadius: 22, backgroundColor: 'rgba(14,14,18,0.55)', borderWidth: 1, borderColor: 'rgba(255,154,91,0.45)', maxWidth: 360, ...glass },
  bigEmoji: { fontSize: 56, lineHeight: 66 },
  bigWho: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bigRing: { borderRadius: 999, padding: 1.5, borderWidth: 2, borderColor: colors.brandWarm },
  bigText: { flexShrink: 1, color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  helloCol: { position: 'absolute', zIndex: 5, elevation: 5, gap: 6, alignItems: 'flex-start' },
  hello: { flexDirection: 'row', alignItems: 'center', gap: 7, maxWidth: '100%', paddingLeft: 4, paddingRight: 12, height: 30, borderRadius: 15, backgroundColor: 'rgba(214,51,79,0.82)' },
  helloText: { flexShrink: 1, color: '#fff', fontSize: 13.5, fontWeight: '700' },
  joinWrap: { position: 'absolute', zIndex: 5, elevation: 5, right: 100 },
  join: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingLeft: 5, paddingRight: 6, height: 32, borderRadius: 16, backgroundColor: 'rgba(14,14,18,0.5)', ...glass },
  joinAvatars: { flexDirection: 'row', alignItems: 'center' },
  joinAv: { borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(14,14,18,0.9)' },
  joinText: { flexShrink: 1, color: 'rgba(255,255,255,0.94)', fontSize: 13, fontWeight: '600' },
  joinBtn: { height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center' },
  joinBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  stack: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingLeft: 3, paddingRight: 9, borderRadius: 14, backgroundColor: 'rgba(14,14,18,0.5)' },
  stackAvatars: { flexDirection: 'row', alignItems: 'center', marginRight: 2 },
  stackAv: { borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(14,14,18,0.9)' },
  stackText: { color: '#fff', fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  emptyText: { color: colors.zinc500, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 12 },
  rowName: { color: colors.zinc900, fontSize: 15.5, fontWeight: '700' },
  rowUser: { color: colors.zinc500, fontSize: 13.5, marginTop: 1 },
});
