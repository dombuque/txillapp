import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { HEADER_AVATAR_BOTTOM, HEADER_AVATAR_LEFT, HEADER_AVATAR_SIZE } from '@/components/ChatHeader';
import { Icon } from '@/components/Icon';
import { peerBioLabel, peerBioLines, peerNoteLabel, peerNoteLines, type PeerBubble } from '@/lib/chatPeerNote';
import { colors } from '@/lib/theme';

// Onde ficam as bolinhas e o balão, a contar do fundo do cabeçalho (y = 0) e da esquerda do ecrã. A foto acaba
// HEADER_AVATAR_BOTTOM acima do fundo; as bolinhas descem dela, a pequena primeiro, como num pensamento.
const CX = HEADER_AVATAR_LEFT + HEADER_AVATAR_SIZE / 2;
const DOT1 = { size: 6, left: CX - 1, top: -HEADER_AVATAR_BOTTOM + 4 };
const DOT2 = { size: 10, left: CX + 1, top: 1 };
const BUBBLE_TOP = 13;
const BUBBLE_LEFT = HEADER_AVATAR_LEFT - 4;

/**
 * A nota da outra pessoa por baixo da foto do cabeçalho, como o recado do WhatsApp: duas bolinhas a sair da foto e
 * um balão branco com o texto (e ♪ título, se tiver música). Ao abrir, as bolinhas crescem a partir da foto e o balão
 * entra com uma mola (~320 ms); ao fechar (`open` false) encolhe tudo de volta para a foto. Com "Reduzir movimento",
 * aparece e desaparece sem animação. Tocar no balão abre a nota (ver, brindar, responder).
 *
 * Sem nota, o mesmo balão mostra a bio do perfil (`bubble.kind === 'bio'`): uma linha (duas em ecrãs estreitos) com
 * reticências, sem ♪ nem brinde, com um pequeno ícone de pessoa e o texto num tom mais discreto, para não se confundir
 * com uma nota. Tocar nele abre o perfil.
 */
export function PeerNoteBubble({ bubble, name, online, open, reduceMotion, onPress }: {
  bubble: PeerBubble; name: string; online: boolean; open: boolean; reduceMotion: boolean; onPress: () => void;
}) {
  const { width } = useWindowDimensions();
  const d1 = useSharedValue(0);
  const d2 = useSharedValue(0);
  const b = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      const v = open ? 1 : 0;
      d1.value = v;
      d2.value = v;
      b.value = v;
      return;
    }
    if (open) {
      d1.value = withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) });
      d2.value = withDelay(60, withTiming(1, { duration: 100, easing: Easing.out(Easing.quad) }));
      b.value = withDelay(110, withSpring(1, { duration: 220, dampingRatio: 0.62 }));
    } else {
      b.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) });
      d2.value = withDelay(90, withTiming(0, { duration: 90, easing: Easing.in(Easing.quad) }));
      d1.value = withDelay(140, withTiming(0, { duration: 90, easing: Easing.in(Easing.quad) }));
    }
  }, [open, reduceMotion, d1, d2, b]);

  // Cada bolinha nasce no fundo da foto e desce até ao seu sítio enquanto cresce.
  const dot1Style = useAnimatedStyle(() => ({
    opacity: interpolate(d1.value, [0, 0.3], [0, 1], 'clamp'),
    transform: [{ translateY: (1 - d1.value) * -4 }, { scale: d1.value }],
  }));
  const dot2Style = useAnimatedStyle(() => ({
    opacity: interpolate(d2.value, [0, 0.3], [0, 1], 'clamp'),
    transform: [{ translateX: (1 - d2.value) * -2 }, { translateY: (1 - d2.value) * -12 }, { scale: d2.value }],
  }));
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(b.value, [0, 0.35], [0, 1], 'clamp'),
    transform: [{ translateY: (1 - b.value) * -10 }, { scale: 0.35 + 0.65 * b.value }],
  }));

  const isBio = bubble.kind === 'bio';
  const { text, track } = isBio ? { text: bubble.text, track: '' } : peerNoteLines(bubble.note);
  const label = isBio ? peerBioLabel(name, bubble.text) : peerNoteLabel(name, bubble.note);
  const maxWidth = Math.min(320, width - BUBBLE_LEFT - 16);
  const hidden = !open;
  return (
    <View pointerEvents="box-none" style={st.area}>
      <Animated.View pointerEvents="none" style={[st.dot, { width: DOT1.size, height: DOT1.size, borderRadius: DOT1.size / 2, left: DOT1.left, top: DOT1.top }, dot1Style]} />
      <Animated.View pointerEvents="none" style={[st.dot, { width: DOT2.size, height: DOT2.size, borderRadius: DOT2.size / 2, left: DOT2.left, top: DOT2.top }, dot2Style]} />
      <Animated.View pointerEvents={hidden ? 'none' : 'box-none'} style={[st.bubbleSlot, { maxWidth }, bubbleStyle]}>
        <Pressable
          onPress={onPress}
          disabled={hidden}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityElementsHidden={hidden}
          importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
          aria-hidden={hidden}
          style={({ pressed }) => [st.bubble, pressed && { backgroundColor: colors.zinc100 }]}
        >
          {!!text && (
            <View style={st.line}>
              {online ? <View style={st.online} /> : null}
              {isBio ? <Icon name="user" size={14} strokeWidth={2} color={colors.zinc500} /> : null}
              <Text style={isBio ? st.bio : st.text} numberOfLines={isBio ? peerBioLines(width) : 2} ellipsizeMode="tail">{text}</Text>
            </View>
          )}
          {!!track && (
            <View style={st.line}>
              {online && !text ? <View style={st.online} /> : null}
              <Text style={text ? st.track : st.text} numberOfLines={1}>{track}</Text>
            </View>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** O ponto discreto na foto quando o balão está encolhido (há nota ou bio; tocar na foto volta a mostrá-la). */
export function NoteDot({ visible, reduceMotion }: { visible: boolean; reduceMotion: boolean }) {
  const s = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) s.value = visible ? 1 : 0;
    else s.value = visible ? withDelay(200, withSpring(1, { duration: 260, dampingRatio: 0.6 })) : withTiming(0, { duration: 100 });
  }, [visible, reduceMotion, s]);
  const style = useAnimatedStyle(() => ({ opacity: interpolate(s.value, [0, 0.3], [0, 1], 'clamp'), transform: [{ scale: s.value }] }));
  return <Animated.View pointerEvents="none" style={[st.noteDot, style]} />;
}

const SHADOW = '0 1px 3px rgba(24,24,27,0.16), 0 4px 14px -2px rgba(24,24,27,0.14)';

const st = StyleSheet.create({
  area: { paddingTop: BUBBLE_TOP, paddingLeft: BUBBLE_LEFT, paddingRight: 16, alignItems: 'flex-start' },
  dot: { position: 'absolute', backgroundColor: '#fff', boxShadow: SHADOW } as object,
  bubbleSlot: { transformOrigin: '30px 0px' } as object,
  bubble: { borderRadius: 18, backgroundColor: '#fff', paddingHorizontal: 13, paddingVertical: 8, minHeight: 36, justifyContent: 'center', boxShadow: SHADOW } as object,
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  online: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10b981' },
  text: { flexShrink: 1, fontSize: 14, lineHeight: 19, fontWeight: '500', color: colors.zinc800 },
  bio: { flexShrink: 1, fontSize: 14, lineHeight: 19, fontWeight: '400', color: colors.zinc600 },
  track: { flexShrink: 1, marginTop: 1, fontSize: 12.5, lineHeight: 16, color: colors.zinc500 },
  noteDot: { position: 'absolute', left: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, backgroundColor: '#fff', borderWidth: 2, borderColor: '#fff', boxShadow: '0 0 0 1px rgba(24,24,27,0.10), 0 1px 3px rgba(24,24,27,0.30)' } as object,
});
