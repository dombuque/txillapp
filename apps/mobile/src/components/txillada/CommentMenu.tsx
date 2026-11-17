import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { colors } from '@/lib/theme';
import { commentCheersLabel, type CommentMenuItem, type TxilladaComment } from '@/lib/txillada';
import { PinIcon } from './PinnedComment';

const glass = Platform.OS === 'web' ? ({ backdropFilter: 'blur(22px) saturate(170%)', WebkitBackdropFilter: 'blur(22px) saturate(170%)' } as object) : null;
/** O vermelho das ações que tiram (apagar, expulsar, denunciar), mais claro para se ler no vidro escuro. */
const DANGER = '#ff6b81';

const ROWS: Record<CommentMenuItem, { icon: IconName | 'pin'; danger?: boolean }> = {
  reply: { icon: 'reply' },
  cheer: { icon: 'cheers' },
  pin: { icon: 'pin' },
  unpin: { icon: 'pin' },
  remove: { icon: 'trash', danger: true },
  ban: { icon: 'block', danger: true },
  report: { icon: 'flag', danger: true },
};

/** O texto de cada linha do menu. */
export function commentMenuLabel(item: CommentMenuItem, c: TxilladaComment): string {
  switch (item) {
    case 'reply': return `Responder a @${c.author.username}`;
    case 'cheer': return c.cheered ? 'Já brindaste' : 'Brindar';
    case 'pin': return 'Fixar comentário';
    case 'unpin': return 'Tirar o fixado';
    case 'remove': return 'Apagar';
    case 'ban': return `Expulsar @${c.author.username}`;
    case 'report': return 'Denunciar comentário';
  }
}

/**
 * O menu de um comentário da Txillada (como nos lives do Instagram): uma folha de vidro escuro que sobe de baixo, com o
 * comentário em cima (a roda da foto, o @ com o selo, o texto e os brindes) e as ações por baixo — as que tiram (apagar,
 * expulsar, denunciar) a vermelho, separadas das outras. Tocar fora ou em «Cancelar» fecha. `left`/`width`: a coluna dos
 * controlos (no computador, ao centro).
 */
export function CommentMenu({ c, items, left, width, bottomInset, reduce, onPick, onClose }: {
  c: TxilladaComment; items: readonly CommentMenuItem[]; left: number; width: number; bottomInset: number; reduce: boolean;
  onPick: (item: CommentMenuItem) => void; onClose: () => void;
}) {
  const y = useSharedValue(reduce ? 0 : 60);
  const op = useSharedValue(0);
  useEffect(() => {
    op.value = withTiming(1, { duration: 180 });
    y.value = withTiming(0, { duration: reduce ? 0 : 240, easing: Easing.out(Easing.cubic) });
  }, [op, y, reduce]);
  const sheet = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ translateY: y.value }] }));
  const back = useAnimatedStyle(() => ({ opacity: op.value }));
  const cheers = commentCheersLabel(c.cheers);
  const main = items.filter((i) => !ROWS[i].danger);
  const danger = items.filter((i) => ROWS[i].danger);

  const row = (item: CommentMenuItem) => {
    const r = ROWS[item];
    const off = item === 'cheer' && !!c.cheered;
    const tint = r.danger ? DANGER : item === 'cheer' ? colors.brandWarm : item === 'pin' || item === 'unpin' ? '#ff8ea0' : '#fff';
    return (
      <Pressable
        key={item}
        onPress={() => onPick(item)}
        disabled={off}
        style={({ pressed }) => [st.row, pressed && st.rowOn, off && { opacity: 0.55 }]}
        accessibilityRole="button"
        accessibilityState={off ? { disabled: true } : undefined}
      >
        <View style={[st.icon, r.danger && st.iconDanger]}>
          {r.icon === 'pin' ? <PinIcon size={18} color={tint} strokeWidth={2.1} /> : <Icon name={r.icon} size={19} color={tint} strokeWidth={2.1} />}
        </View>
        <Text style={[st.label, r.danger && { color: DANGER }]} numberOfLines={1}>{commentMenuLabel(item, c)}</Text>
        {item === 'cheer' && c.cheered ? <Icon name="check" size={17} color={colors.brandWarm} strokeWidth={2.6} /> : null}
      </Pressable>
    );
  };

  return (
    <View style={[StyleSheet.absoluteFill, st.layer]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, st.back, back]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar o menu" />
      </Animated.View>
      <Animated.View style={[st.sheet, glass, { left, width, paddingBottom: Math.max(14, bottomInset + 10) }, sheet]} accessibilityViewIsModal>
        <View style={st.grab} />
        <View style={st.head}>
          <View style={st.ring}>
            <Avatar name={c.author.displayName} username={c.author.avatarUrl ? c.author.username : undefined} size={36} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <NameWithBadge name={c.author.username} who={c.author} style={st.name}>
              {cheers ? (
                <View style={st.cheersRow}>
                  <Icon name="cheers" size={13} color="rgba(255,255,255,0.8)" strokeWidth={2.2} />
                  <Text style={st.cheers}>{cheers}</Text>
                </View>
              ) : null}
            </NameWithBadge>
            <Text style={st.body} numberOfLines={3}>{c.body}</Text>
          </View>
        </View>
        {main.length ? <View style={st.group}>{main.map(row)}</View> : null}
        {danger.length ? <View style={st.group}>{danger.map(row)}</View> : null}
        <Pressable onPress={onClose} style={({ pressed }) => [st.cancel, pressed && { opacity: 0.8 }]} accessibilityRole="button">
          <Text style={st.cancelText}>Cancelar</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  layer: { zIndex: 30, elevation: 30 },
  back: { backgroundColor: 'rgba(0,0,0,0.42)' },
  sheet: {
    position: 'absolute', bottom: 0, paddingHorizontal: 14, paddingTop: 8, gap: 10,
    borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: Platform.OS === 'web' ? 'rgba(22,22,27,0.78)' : 'rgba(22,22,27,0.94)',
    borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: -6 },
  },
  grab: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)', marginBottom: 4 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingHorizontal: 4, paddingBottom: 2 },
  ring: { borderRadius: 999, padding: 1.5, borderWidth: 2, borderColor: colors.brand },

  name: { flexShrink: 1, color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  cheersRow: { marginLeft: 8, flexDirection: 'row', alignItems: 'center', gap: 3 },
  cheers: { color: 'rgba(255,255,255,0.8)', fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  body: { marginTop: 2, color: 'rgba(255,255,255,0.86)', fontSize: 14.5, lineHeight: 20 },
  group: { borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 12 },
  rowOn: { backgroundColor: 'rgba(255,255,255,0.08)' },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.09)' },
  iconDanger: { backgroundColor: 'rgba(255,107,129,0.13)' },
  label: { flex: 1, minWidth: 0, color: '#fff', fontSize: 16, fontWeight: '600', letterSpacing: -0.1 },
  cancel: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  cancelText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
