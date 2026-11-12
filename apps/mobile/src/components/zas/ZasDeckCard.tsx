import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { colors } from '@/lib/theme';
import { CurvedCaption } from './CurvedCaption';
import { squircle } from './squircle';
import { deckPose } from './zasDeck';

type Props = {
  /** Lugar do cartão na lista do visor. */
  index: number;
  /** Onde está a pilha (o índice do de cima; contínuo durante o arrastar e a animação). */
  pos: SharedValue<number>;
  w: number;
  h: number;
  /** Largura do ecrã: até onde voa o que sai. */
  screenW: number;
  uri: string | undefined;
  caption: string;
  /** Ordem de desenho (o que sai por cima de todos, o de cima a seguir, os de trás por baixo). */
  z: number;
  /** O de cima: a foto pede-se primeiro e diz-se ao leitor de ecrã. */
  top: boolean;
};

const isWeb = Platform.OS === 'web';
/** A sombra: na web o recorte squircle (clip-path) cortaria o box-shadow, por isso vai como drop-shadow por fora. */
const shadow = (w: number) =>
  isWeb
    ? ({ filter: 'drop-shadow(0 14px 28px rgba(0,0,0,0.55))' } as object)
    : { borderRadius: Math.round(w * 0.28), boxShadow: '0 14px 32px rgba(0,0,0,0.5)' };

/**
 * Um cartão da pilha do Zás: a foto numa moldura squircle, com a legenda na curva. A pose (onde está, o tamanho, a
 * rotação, a sombra dos de trás) vem toda de `deckPose(index - pos)`, no worklet do Reanimated no telemóvel e no JS na
 * web: avançar é só mudar `pos`, e o cartão de trás, já desenhado e com a foto em memória, sobe sem esperar pela rede.
 */
export const ZasDeckCard = memo(function ZasDeckCard({ index, pos, w, h, screenW, uri, caption, z, top }: Props) {
  const move = useAnimatedStyle(() => {
    const p = deckPose(index - pos.value, screenW, h);
    return { opacity: p.opacity, transform: [{ translateX: p.translateX }, { translateY: p.translateY }, { rotate: `${p.rotate}deg` }, { scale: p.scale }] };
  });
  const shade = useAnimatedStyle(() => ({ opacity: deckPose(index - pos.value, screenW, h).shade }));
  return (
    <Animated.View pointerEvents="none" importantForAccessibility={top ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!top} style={[{ position: 'absolute', left: 0, top: 0, width: w, height: h, zIndex: z }, shadow(w), move]}>
      <View style={[{ flex: 1, backgroundColor: colors.zinc900 }, squircle(w)]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
            priority={top ? 'high' : 'normal'}
            recyclingKey={uri}
            accessibilityLabel={caption || 'Zás'}
          />
        ) : null}
        <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 96 }} pointerEvents="none" />
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 140 }} pointerEvents="none" />
        {caption ? <CurvedCaption w={w} h={h} text={caption} arc="top" /> : null}
        {/* Os de trás ficam um pouco mais escuros: lê-se logo qual é o de cima. */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 6 }, shade]} />
      </View>
    </Animated.View>
  );
});
