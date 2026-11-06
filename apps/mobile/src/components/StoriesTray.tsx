import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOwnSeen } from '@/lib/ownSeen';
import { colors } from '@/lib/theme';
import { Avatar } from './Avatar';

/** Anel de stories: um arco por story (já vistos a cinzento, novos a cores; verde se for só para amigos próximos). */
function Ring({ count, seenCount = 0, green = false, children }: { count: number; seenCount?: number; green?: boolean; children: React.ReactNode }) {
  const n = Math.max(1, Math.min(count, 12));
  const step = 100 / n;
  const seg = n === 1 ? 100 : step - 3.2;
  const circ = 2 * Math.PI * 33;
  return (
    <View style={styles.ring}>
      <Svg width={72} height={72} viewBox="0 0 72 72" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="sr" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#d6334f" />
            <Stop offset="1" stopColor="#fbbf24" />
          </LinearGradient>
          <LinearGradient id="srg" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#059669" />
            <Stop offset="1" stopColor="#4ade80" />
          </LinearGradient>
        </Defs>
        {Array.from({ length: n }, (_, i) => (
          <Circle
            key={i}
            cx={36}
            cy={36}
            r={33}
            fill="none"
            strokeWidth={3.5}
            strokeLinecap="round"
            stroke={i < seenCount ? '#d4d4d8' : green ? 'url(#srg)' : 'url(#sr)'}
            strokeDasharray={`${(seg / 100) * circ} ${circ - (seg / 100) * circ}`}
            strokeDashoffset={-(i * step * circ) / 100}
            rotation={-90}
            origin="36, 36"
          />
        ))}
      </Svg>
      <View style={styles.ringInner}>{children}</View>
    </View>
  );
}

/** Tabuleiro de stories no topo do Início: o teu primeiro (com o "+"), depois quem segues. */
export function StoriesTray() {
  const { user } = useAuth();
  const router = useRouter();
  const { data } = useQuery({ queryKey: ['stories'], queryFn: api.stories, refetchInterval: 60_000 });
  const users = data ?? [];
  const others = users.filter((u) => !u.isMe);
  const mine = users.find((u) => u.isMe);
  const ownSeenAt = useOwnSeen();
  const mineSeen = !!mine && mine.latestAt === ownSeenAt;
  const create = () => router.push('/stories/new' as never);
  const view = (u: string) => router.push(`/stories/${u}` as never);

  return (
    <View style={{ marginBottom: 16 }} accessibilityLabel="Stories">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Pressable onPress={() => (mine ? view(user?.username ?? '') : create())} style={styles.bubble} accessibilityRole="button" accessibilityLabel={mine ? 'Ver o teu story' : 'Criar story'}>
          <View>
            <Ring count={mine?.count ?? 1} seenCount={mine ? (mineSeen ? mine.count : 0) : 1} green={mine?.closeFriends}>
              <Avatar name={user?.displayName ?? '?'} username={user?.username} size={56} />
            </Ring>
            <Pressable onPress={create} hitSlop={8} style={styles.plus} accessibilityRole="button" accessibilityLabel="Adicionar ao story">
              <Text style={styles.plusText}>+</Text>
            </Pressable>
          </View>
          <Text style={[styles.label, { color: colors.zinc800, fontWeight: '500' }]} numberOfLines={1}>O teu story</Text>
        </Pressable>

        {others.map((u) => (
          <Pressable key={u.username} onPress={() => view(u.username)} style={styles.bubble} accessibilityRole="button" accessibilityLabel={`Ver story de ${u.displayName}${u.seen ? '' : ' (novo)'}`}>
            <View style={{ opacity: u.seen ? 0.6 : 1 }}>
              <Ring count={u.count} seenCount={u.seenCount} green={u.closeFriends}>
                <Avatar name={u.displayName} username={u.username} size={56} />
              </Ring>
            </View>
            <Text style={[styles.label, u.seen ? { color: colors.zinc500, fontWeight: '400' } : { color: colors.zinc900, fontWeight: '700' }]} numberOfLines={1}>{u.username}</Text>
          </Pressable>
        ))}
        {others.length === 0 && <Text style={styles.empty}>Segue pessoas para ver os stories delas</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4, gap: 12 },
  bubble: { width: 76, alignItems: 'center', gap: 6 },
  ring: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  ringInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  label: { width: '100%', textAlign: 'center', fontSize: 12, lineHeight: 16 },
  plus: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.white, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: '#fff', fontSize: 16, fontWeight: '700', lineHeight: 18, marginTop: -1 },
  empty: { alignSelf: 'center', paddingRight: 16, fontSize: 14, color: colors.zinc500 },
});
