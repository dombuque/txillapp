import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { MixarFrom, MixarReactionId, MixarTopic } from '@/lib/api.mixar';
import { MIXAR_REACTIONS, reactionA11y, reasonIcon, reasonText, type MixarReaction } from '@/lib/mixar';
import { colors } from '@/lib/theme';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';

const isWeb = Platform.OS === 'web';
const SHADOW = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;
/** As cores do Mixar: a marca a passar para o laranja (como o anel das mensagens por ler). */
export const MIXAR_GRADIENT = [colors.brand, '#ff9a5b'] as const;

type Who = { name: string; username?: string };

/** Os dois avatares sobrepostos (eu atrás, o outro à frente), com um aro branco a separá-los. */
export function PairAvatars({ me, them, size = 32, ring = '#fff' }: { me: Who; them: Who; size?: number; ring?: string }) {
  const overlap = Math.round(size * 0.36);
  const box = size + 4;
  return (
    <View style={{ flexDirection: 'row', width: box * 2 - overlap, height: box }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[st.ringed, { width: box, height: box, borderRadius: box / 2, backgroundColor: ring }]}><Avatar name={me.name} username={me.username} size={size} /></View>
      <View style={[st.ringed, { width: box, height: box, borderRadius: box / 2, backgroundColor: ring, marginLeft: -overlap }]}><Avatar name={them.name} username={them.username} size={size} /></View>
    </View>
  );
}

/** O desenho de uma reação: o ícone dos brindes da app para o «brinde», o emoji para as outras. */
export function ReactionGlyph({ r, size = 22, color = '#fff' }: { r: MixarReaction; size?: number; color?: string }) {
  if (r.id === 'brinde') return <Icon name="cheers" size={size + 2} color={color} strokeWidth={2} />;
  return <Text style={{ fontSize: size, lineHeight: Math.round(size * 1.25) }} allowFontScaling={false}>{r.emoji}</Text>;
}

/**
 * A barra das reações exclusivas do Mixar (por cima do vídeo): a minha fica destacada (fundo cheio, maior) e a do outro
 * leva o avatar dele num cantinho. Tocar na minha tira-a; noutra, troca.
 */
export function ReactionBar({ mine, theirs, partner, onPick, dark = true, style }: {
  mine: MixarReactionId | null;
  theirs: MixarReactionId | null;
  partner: Who;
  onPick: (id: MixarReactionId) => void;
  /** Por cima do vídeo (fundo escuro). */
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[st.bar, dark ? st.barDark : st.barLight, style]} accessibilityRole="toolbar" accessibilityLabel="Reações do Mixar (só vocês os dois veem)">
      {MIXAR_REACTIONS.map((r) => (
        <ReactionButton key={r.id} r={r} mine={mine === r.id} theirs={theirs === r.id} partner={partner} onPress={() => onPick(r.id)} dark={dark} />
      ))}
    </View>
  );
}

function ReactionButton({ r, mine, theirs, partner, onPress, dark }: { r: MixarReaction; mine: boolean; theirs: boolean; partner: Who; onPress: () => void; dark: boolean }) {
  const pop = useRef(new Animated.Value(1)).current;
  function press() {
    if (!isWeb) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    pop.setValue(0.75);
    Animated.spring(pop, { toValue: 1, useNativeDriver: !isWeb, speed: 22, bounciness: 14 }).start();
    onPress();
  }
  return (
    <Pressable
      onPress={press}
      hitSlop={4}
      style={(s) => [st.react, mine && st.reactMine, (s as { hovered?: boolean }).hovered && !mine && { backgroundColor: dark ? 'rgba(255,255,255,0.18)' : colors.zinc100 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: mine }}
      accessibilityLabel={reactionA11y(r, mine, theirs, partner.name)}
    >
      <Animated.View style={{ transform: [{ scale: pop }], opacity: mine || theirs ? 1 : 0.92 }}>
        <ReactionGlyph r={r} size={mine ? 22 : 20} color={mine ? '#fff' : dark ? '#fff' : colors.zinc800} />
      </Animated.View>
      {theirs ? (
        <View style={st.theirs} pointerEvents="none">
          <Avatar name={partner.name} username={partner.username} size={16} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** A razão do item («Porque gostas de Música»), num chip por cima do vídeo. */
export function ReasonChip({ from, topic, partner }: { from: MixarFrom; topic: MixarTopic | null; partner: string }) {
  const text = reasonText(from, topic, partner);
  return (
    <View style={st.reason} accessibilityRole="text" accessibilityLabel={text}>
      <Icon name={reasonIcon(from)} size={13} color="#fff" strokeWidth={2.4} />
      <Text style={st.reasonText} numberOfLines={1}>{text}</Text>
    </View>
  );
}

/** «Visto por Ana»: o outro já viu este item. */
export function SeenBy({ partner }: { partner: Who }) {
  return (
    <View style={st.seen} accessibilityRole="text" accessibilityLabel={`Visto por ${partner.name}`}>
      <Icon name="eye" size={13} color="rgba(255,255,255,0.9)" strokeWidth={2.2} />
      <Text style={st.seenText} numberOfLines={1}>Visto por {partner.name}</Text>
    </View>
  );
}

/** Os temas em chips (no cabeçalho e na Descoberta). `tone`: 'dark' por cima do vídeo, 'light' nas folhas brancas. */
export function TopicChips({ topics, tone = 'light', max, accent = false }: { topics: MixarTopic[]; tone?: 'dark' | 'light'; max?: number; accent?: boolean }) {
  const shown = max ? topics.slice(0, max) : topics;
  if (!shown.length) return null;
  return (
    <View style={st.chips}>
      {shown.map((t) => (
        <View key={t.topic} style={[st.chip, tone === 'dark' ? st.chipDark : accent ? st.chipAccent : st.chipLight]}>
          <Text style={[st.chipText, { color: tone === 'dark' ? '#fff' : accent ? colors.brand : colors.zinc800 }]} numberOfLines={1}>{t.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** O selo redondo do Mixar (o gradiente com as faíscas), para as listas e o cartão do chat. */
export function MixarBadge({ size = 44 }: { size?: number }) {
  return (
    <LinearGradient colors={MIXAR_GRADIENT} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="mixar" size={Math.round(size * 0.52)} color="#fff" strokeWidth={2} />
    </LinearGradient>
  );
}

const st = StyleSheet.create({
  ringed: { alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, borderRadius: 999, padding: 3 },
  barDark: { backgroundColor: 'rgba(0,0,0,0.38)' },
  barLight: { backgroundColor: colors.zinc100 },
  react: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  reactMine: { backgroundColor: colors.brand, boxShadow: '0 2px 8px rgba(214,51,79,0.45)' },
  theirs: { position: 'absolute', right: -1, bottom: -1, borderRadius: 10, borderWidth: 2, borderColor: '#fff', overflow: 'hidden' },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 999, backgroundColor: 'rgba(214,51,79,0.88)', paddingHorizontal: 10, paddingVertical: 5 },
  reasonText: { flexShrink: 1, color: '#fff', fontSize: 13, fontWeight: '700' },
  seen: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  seenText: { flexShrink: 1, color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600', ...SHADOW },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, maxWidth: 180 },
  chipDark: { backgroundColor: 'rgba(255,255,255,0.18)' },
  chipLight: { backgroundColor: colors.zinc100 },
  chipAccent: { backgroundColor: colors.rose50 },
  chipText: { fontSize: 13, fontWeight: '600' },
});
