import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { emitTabPress } from '@/lib/tabPress';
import { Avatar } from './Avatar';
import { Icon, type IconName } from './Icon';

const badge = (n: number) => (n > 9 ? '9+' : String(n));

/** Barra de baixo igual à do site: Início, Reels, "+" verde que sobe acima da linha, Mensagens e o teu perfil. */
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigateToTab: (routeKey: string) => void;
}

export function TabBar({ state, navigateToTab }: TabBarProps) {
  const insets = useSafeAreaInsets();
  // Nos Reels a barra flutua por cima do vídeo: translúcida e arredondada nos cantos.
  const onReels = state.routes[state.index]?.name === 'reels';
  const ink = onReels ? '#fff' : colors.zinc900;
  const { user } = useAuth();
  const chats = useQuery({ queryKey: ['chat-unread'], queryFn: api.chatUnread, refetchInterval: 20_000, staleTime: 8_000 });
  const chatCount = chats.data?.conversations ?? 0;

  const press = (focused: boolean, key: string) => {
    if (!focused) navigateToTab(key);
    else emitTabPress(state.routes.find((r) => r.key === key)?.name ?? '');
  };

  return (
    <View style={onReels ? [styles.floatWrap, { bottom: Math.max(insets.bottom, 8) }] : undefined} pointerEvents="box-none">
    <View style={onReels ? styles.glass : [styles.nav, { paddingBottom: insets.bottom }]}>
      <View style={styles.row}>
        {state.routes.map((r, idx) => {
          const focused = state.index === idx;
          const go = () => press(focused, r.key);
          if (r.name === 'new') {
            return (
              <Pressable
                key={r.key}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  go();
                }}
                style={({ pressed }) => [styles.plus, { backgroundColor: focused ? colors.green600 : colors.white, transform: [{ scale: pressed ? 0.9 : 1 }] }]}
                accessibilityRole="button"
                accessibilityLabel="Nova publicação"
              >
                <Icon name="square-plus" size={38} strokeWidth={2.2} color={focused ? colors.white : colors.green600} />
              </Pressable>
            );
          }
          if (r.name === 'profile') {
            return (
              <Pressable key={r.key} onPress={go} style={styles.tab} accessibilityRole="button" accessibilityLabel="Perfil">
                <View style={[styles.ava, { borderColor: focused ? ink : 'transparent' }]}>
                  <Avatar name={user?.displayName ?? '?'} username={user?.username} size={26} />
                </View>
              </Pressable>
            );
          }
          const icon: IconName = r.name === 'index' ? 'home' : r.name === 'reels' ? 'film' : 'messages';
          const label = r.name === 'index' ? 'Início' : r.name === 'reels' ? 'Reels' : 'Mensagens';
          return (
            <Pressable key={r.key} onPress={go} style={styles.tab} accessibilityRole="button" accessibilityLabel={label}>
              <View>
                <Icon name={icon} size={27} color={ink} solid={focused && icon !== 'film'} strokeWidth={focused && (icon === 'home' || icon === 'film') ? 2.3 : 1.9} />
                {r.name === 'messages' && chatCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge(chatCount)}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  floatWrap: { position: 'absolute', left: 12, right: 12 },
  glass: { borderRadius: 32, paddingVertical: 4, backgroundColor: 'rgba(24,24,27,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', boxShadow: '0 8px 28px rgba(0,0,0,0.35)', ...({ backdropFilter: 'blur(18px) saturate(1.4)', WebkitBackdropFilter: 'blur(18px) saturate(1.4)' } as object) },
  nav: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.zinc100, paddingTop: 4, boxShadow: '0 -6px 24px rgba(0,0,0,0.05)' },
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', paddingHorizontal: 12 },
  tab: { height: 48, flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  plus: { width: 62, height: 62, borderRadius: 22, marginTop: -16, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.22)' },
  ava: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -8, top: -8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700', lineHeight: 13 },
});
