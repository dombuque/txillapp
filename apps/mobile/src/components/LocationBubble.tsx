import type { ReactNode } from 'react';
import { Linking, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { bubbleLines } from '@/lib/sendLocation';
import { Icon } from './Icon';

/**
 * A bolha de uma localização no chat: o nome e a morada do sítio por cima do mapa pequeno (quando a mensagem os traz),
 * senão a linha antiga por baixo ("Localização" ou o texto). Tocar abre o mapa; manter carregado abre o menu da mensagem
 * (`onLongPress`): o mapa não apanha toques (`pointerEvents="none"`), para não roubar o toque longo à bolha.
 */
export function LocationBubble({ m, ink, style, map, onLongPress }: {
  m: { lat: number; lng: number; body?: string | null; placeName?: string | null; placeAddress?: string | null; liveUntil?: string | null };
  ink: string;
  style: StyleProp<ViewStyle>;
  /** O mapa pequeno (desenhado por quem chama). */
  map: ReactNode;
  onLongPress?: () => void;
}) {
  const l = bubbleLines(m);
  const muted = ink === '#fff' ? 'rgba(255,255,255,0.85)' : '#52525b';
  return (
    <Pressable
      onPress={() => void Linking.openURL(`https://www.google.com/maps?q=${m.lat},${m.lng}`)}
      onLongPress={onLongPress}
      delayLongPress={450}
      style={[style, { overflow: 'hidden' }]}
      accessibilityRole="link"
      accessibilityLabel={`Localização: ${l.title}${l.sub ? `, ${l.sub}` : ''}. Abrir no mapa`}
    >
      {l.named ? (
        <View style={{ paddingHorizontal: 13, paddingTop: 9, paddingBottom: 8, gap: 1 }}>
          <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: '700', color: ink }} numberOfLines={2}>{l.title}</Text>
          {l.sub ? <Text style={{ fontSize: 13, lineHeight: 17, color: muted }} numberOfLines={2}>{l.sub}</Text> : null}
        </View>
      ) : null}
      <View pointerEvents="none">{map}</View>
      {!l.named ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingVertical: 8 }}>
          <Icon name="map-pin" size={16} color={ink} />
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: ink }} numberOfLines={1}>{l.title}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
