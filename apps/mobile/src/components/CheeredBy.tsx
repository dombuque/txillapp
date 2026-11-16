import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { cheeredByA11y, cheeredByView, floatingCheerers, othersLabel, type CheeredBy, type CheeredByUser } from '@/lib/cheeredBy';
import { useReduceMotion } from '@/lib/reduceMotion';
import { compactCount } from '@/lib/sounds';
import { colors } from '@/lib/theme';
import { Avatar } from './Avatar';
import { InlineBadge } from './NameWithBadge';

type Hover = { pressed: boolean; hovered?: boolean };
const NATIVE = Platform.OS !== 'web';
/** A cerveja da caneca (âmbar). */
const BEER = '#fbbf24';

/** A caneca pequenina, com espuma, num disco da cor da marca: o selo de «brindou» nos avatares. */
export function MiniMug({ size = 16 }: { size?: number }) {
  const k = size / 16;
  const px = (n: number) => Math.round(n * k * 10) / 10;
  return (
    <View style={[mug.disc, { width: size, height: size, borderRadius: size / 2 }]} pointerEvents="none">
      {/* asa */}
      <View style={{ position: 'absolute', left: px(9.6), top: px(6.6), width: px(3.4), height: px(4.6), borderWidth: Math.max(1, px(1.3)), borderLeftWidth: 0, borderColor: BEER, borderTopRightRadius: px(2), borderBottomRightRadius: px(2) }} />
      {/* copo */}
      <View style={[mug.beer, { position: 'absolute', left: px(4), top: px(5.6), width: px(6.4), height: px(7), borderBottomLeftRadius: px(1.6), borderBottomRightRadius: px(1.6) }]} />
      {/* espuma */}
      <View style={[mug.foam, { left: px(3.6), top: px(3.6), width: px(3.4), height: px(3.4), borderRadius: px(1.7) }]} />
      <View style={[mug.foam, { left: px(5.6), top: px(2.8), width: px(3.6), height: px(3.6), borderRadius: px(1.8) }]} />
      <View style={[mug.foam, { left: px(7.6), top: px(3.6), width: px(3.2), height: px(3.2), borderRadius: px(1.6) }]} />
      <View style={[mug.foam, { left: px(3.8), top: px(5), width: px(6.8), height: px(1.6), borderRadius: px(0.8) }]} />
    </View>
  );
}

/** «Brindado por @fulano e outras N pessoas», com os avatares empilhados; tocar abre a lista de quem brindou. */
export function CheeredByLine({ post, onOpen, style }: { post: { cheers: number; cheeredBy?: CheeredBy | null }; onOpen: () => void; style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const v = cheeredByView(post);
  if (!v || v.kind !== 'names') return null;
  const goUser = (u: CheeredByUser) => router.push(`/u/${u.username}` as never);
  const name = (u: CheeredByUser) => (
    <Text key={u.username} style={line.strong} onPress={() => goUser(u)} accessibilityRole="link">
      @{u.username}
      <InlineBadge who={u} fontSize={14} />
    </Text>
  );
  return (
    <Pressable
      onPress={onOpen}
      hitSlop={6}
      style={(st) => [line.row, style, (st as Hover).hovered && { opacity: 0.85 }, st.pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={`${cheeredByA11y(v, compactCount)}. Ver quem brindou`}
    >
      <View style={line.stack}>
        {v.avatars.map((u, i) => (
          <View key={u.username} style={[line.ring, i > 0 && { marginLeft: -8 }, { zIndex: v.avatars.length - i }]}>
            <Avatar name={u.displayName} username={u.avatarUrl ? u.username : undefined} size={22} />
          </View>
        ))}
      </View>
      <Text style={line.text} numberOfLines={2}>
        Brindado por {name(v.names[0])}
        {v.names[1] ? <> e {name(v.names[1])}</> : null}
        {v.others > 0 ? <> e <Text style={line.strong}>{othersLabel(v.others, compactCount)}</Text></> : null}
      </Text>
    </Pressable>
  );
}

/** Uma roda a flutuar: entra com mola e sobe e desce devagar (parada com «reduzir movimento»). */
function Floating({ u, i, reduce, size }: { u: CheeredByUser; i: number; reduce: boolean; size: number }) {
  const enter = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) {
      enter.setValue(1);
      bob.setValue(0);
      return;
    }
    const spring = Animated.spring(enter, { toValue: 1, friction: 5, tension: 70, delay: 120 + i * 110, useNativeDriver: NATIVE });
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1700 + i * 260, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
        Animated.timing(bob, { toValue: 0, duration: 1700 + i * 260, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      ]),
    );
    spring.start();
    const t = setTimeout(() => loop.start(), 400 + i * 380);
    return () => {
      clearTimeout(t);
      spring.stop();
      loop.stop();
    };
  }, [reduce, i, enter, bob]);
  const style = {
    opacity: enter.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
    transform: [
      { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) },
      { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
    ],
  };
  return (
    <Animated.View style={[float.item, i > 0 && { marginLeft: -6 }, { zIndex: 5 - i }, style]}>
      <View style={[float.ring, { borderRadius: size / 2 + 2 }]}>
        <Avatar name={u.displayName} username={u.avatarUrl ? u.username : undefined} size={size} />
      </View>
      <View style={float.mug}>
        <MiniMug size={Math.round(size * 0.5)} />
      </View>
    </Animated.View>
  );
}

/**
 * Os meus amigos próximos que brindaram (ou, se nenhum brindou, as pessoas que sigo), em rodas a flutuar sobre a foto ou o vídeo (no canto de baixo à esquerda; quem
 * chama põe-nas acima do selo da música). Nada quando nenhum brindou ou o dono não deixa ver quem brindou.
 */
export function CheeredFriends({ post, onOpen, style, size = 30 }: { post: { cheeredBy?: CheeredBy | null }; onOpen: () => void; style?: StyleProp<ViewStyle>; size?: number }) {
  const reduce = useReduceMotion();
  const { kind, users: friends } = floatingCheerers(post);
  if (!friends.length) return null;
  const who = kind === 'close' ? 'dos teus amigos próximos' : 'que segues';
  const label = friends.length === 1
    ? `@${friends[0].username}, ${who}, brindou. Ver quem brindou`
    : `${friends.map((u) => `@${u.username}`).join(', ')}, ${who}, brindaram. Ver quem brindou`;
  return (
    <Pressable onPress={onOpen} hitSlop={6} style={(st) => [float.row, style, st.pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={label}>
      {friends.map((u, i) => <Floating key={u.username} u={u} i={i} reduce={reduce} size={size} />)}
    </Pressable>
  );
}

const mug = StyleSheet.create({
  disc: { backgroundColor: colors.brand, borderWidth: 1.5, borderColor: '#fff', overflow: 'hidden' },
  beer: { backgroundColor: BEER },
  foam: { position: 'absolute', backgroundColor: '#fff' },
});

const line = StyleSheet.create({
  row: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: '100%' },
  stack: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  ring: { borderRadius: 13, borderWidth: 2, borderColor: '#fff', backgroundColor: '#fff' },
  text: { flexShrink: 1, fontSize: 14, lineHeight: 19, color: colors.zinc700 },
  strong: { fontWeight: '700', color: colors.zinc900 },
});

const float = StyleSheet.create({
  row: { position: 'absolute', left: 12, bottom: 12, flexDirection: 'row', alignItems: 'flex-end', zIndex: 3 },
  item: { position: 'relative', paddingRight: 2, paddingBottom: 2 },
  ring: { borderWidth: 2, borderColor: '#fff', backgroundColor: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.35)' },
  mug: { position: 'absolute', right: -3, bottom: -2 },
});
