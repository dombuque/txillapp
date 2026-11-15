import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Avatar } from '@/components/Avatar';
import { InlineBadge } from '@/components/NameWithBadge';
import { colors } from '@/lib/theme';
import type { TxilladaComment } from '@/lib/txillada';

/** O alfinete (os ícones da app não o têm): traço, como os outros. */
export function PinIcon({ size = 18, color = '#fff', strokeWidth = 2 }: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 17v5" />
      <Path d="M9 10.76V6h-1a2 2 0 0 1 0-4h8a2 2 0 0 1 0 4h-1v4.76a2 2 0 0 0 1.11 1.79l1.78.9A2 2 0 0 1 19 15.24V17H5v-1.76a2 2 0 0 1 1.11-1.79l1.78-.9A2 2 0 0 0 9 10.76z" />
    </Svg>
  );
}

const glass = Platform.OS === 'web' ? ({ backdropFilter: 'blur(16px) saturate(160%)', WebkitBackdropFilter: 'blur(16px) saturate(160%)' } as object) : null;

/**
 * O comentário fixado pelo anfitrião: uma pílula de vidro em baixo, por cima da barra, sempre à vista (não flutua nem
 * desaparece). A roda da foto, o @ com o selo, «📌 FIXADO» e o texto (até 2 linhas). Tocar abre o menu do comentário.
 */
export function PinnedComment({ c, bottom, left, width, onPress, onHeight }: { c: TxilladaComment; bottom: number; left: number; width: number; onPress?: () => void; onHeight?: (h: number) => void }) {
  return (
    <View style={[st.wrap, { bottom, left, maxWidth: width }]} pointerEvents="box-none" onLayout={(e) => onHeight?.(Math.round(e.nativeEvent.layout.height))}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [st.pill, glass, pressed && { transform: [{ scale: 0.98 }] }]}
        accessibilityRole="button"
        accessibilityLabel={`Comentário fixado de ${c.author.username}: ${c.body}`}
        accessibilityHint={onPress ? 'Abre as opções do comentário' : undefined}
      >
        <View style={st.ring}>
          <Avatar name={c.author.displayName} username={c.author.avatarUrl ? c.author.username : undefined} size={28} />
        </View>
        <View style={st.col}>
          <View style={st.head}>
            <Text style={st.name} numberOfLines={1}>{c.author.username}</Text>
            {c.author.verified ? <InlineBadge who={c.author} fontSize={13} /> : null}
            <View style={st.tag}>
              <Text style={st.tagText}>📌 FIXADO</Text>
            </View>
          </View>
          <Text style={st.text} numberOfLines={2}>{c.body}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', zIndex: 5, elevation: 5, flexDirection: 'row' },
  pill: {
    flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 6, paddingRight: 14, paddingVertical: 6,
    borderRadius: 22, backgroundColor: 'rgba(14,14,18,0.58)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
  },
  ring: { borderRadius: 999, padding: 1.5, borderWidth: 2, borderColor: colors.brand },
  col: { flexShrink: 1, minWidth: 0, gap: 1 },
  head: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  name: { flexShrink: 1, color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: -0.1 },
  tag: { marginLeft: 7, paddingHorizontal: 6, height: 17, borderRadius: 5, backgroundColor: 'rgba(214,51,79,0.92)', justifyContent: 'center' },
  tagText: { color: '#fff', fontSize: 9.5, fontWeight: '900', letterSpacing: 0.6 },
  text: { color: 'rgba(255,255,255,0.94)', fontSize: 13.5, lineHeight: 18, fontWeight: '500' },
});
