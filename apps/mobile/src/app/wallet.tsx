import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Empty } from '@/components/Empty';
import { Icon } from '@/components/Icon';
import { GiftSheet } from '@/components/PostSheets';
import { Sheet } from '@/components/Sheet';
import { StackPage } from '@/components/StackPage';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cardShadow, colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

const labels: Record<string, string> = { welcome_bonus: 'Boas-vindas, malta!', transfer: 'Txills oferecidos', gift: 'Presente', invite: 'Convite', topup: 'Txills recarregados' };

/** Escolher a quem oferecer: as pessoas que segues. */
function PickPerson({ me, onPick, onClose }: { me: string; onPick: (p: { username: string; displayName: string }) => void; onClose: () => void }) {
  const q = useInfiniteQuery({
    queryKey: ['people', 'following', me, ''],
    queryFn: ({ pageParam }) => api.following(me, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const people = q.data?.pages.flatMap((x) => x.items) ?? [];
  return (
    <Sheet title="A quem queres oferecer?" onClose={onClose}>
      <ScrollView style={{ maxHeight: 420 }}>
        {q.isLoading && <ActivityIndicator style={{ margin: 24 }} color={colors.brand} />}
        {q.isSuccess && people.length === 0 && <Text style={{ textAlign: 'center', color: colors.zinc600, padding: 24 }}>Segue alguém primeiro: só se oferece a quem segues.</Text>}
        {people.map((x) => (
          <Pressable key={x.username} onPress={() => onPick(x)} style={st.pick} accessibilityRole="button">
            <Avatar name={x.displayName} username={x.username} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} numberOfLines={1}>{x.displayName}</Text>
              <Text style={{ fontSize: 14, color: colors.zinc600 }} numberOfLines={1}>@{x.username}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

export default function Wallet() {
  const { user } = useAuth();
  const router = useRouter();
  const preset = useLocalSearchParams<{ to?: string; name?: string }>();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['wallet'], queryFn: api.wallet });
  const [picking, setPicking] = useState(false);
  const [to, setTo] = useState<{ username: string; displayName: string } | null>(preset.to ? { username: preset.to, displayName: preset.name ?? `@${preset.to}` } : null);

  return (
    <StackPage title="Carteira">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {isError && (
          <View>
            <Empty icon="wallet" title="Ups, não consegui abrir a carteira" />
            <Pressable onPress={() => void refetch()} style={{ alignSelf: 'center', marginTop: 20 }}><Text style={{ textDecorationLine: 'underline', fontSize: 16 }}>Tentar outra vez</Text></Pressable>
          </View>
        )}
        {isLoading && <View style={{ height: 160, borderRadius: 28, backgroundColor: colors.zinc100 }} />}
        {data && (
          <>
            <LinearGradient colors={[colors.brand, colors.brandLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.balance}>
              <Text style={{ color: '#fff', fontWeight: '300', fontSize: 16 }}>Tens</Text>
              <Text style={{ color: '#fff', fontSize: 48, fontWeight: '800', letterSpacing: -1 }}>
                {data.balance.toLocaleString('pt-PT')} <Text style={{ fontSize: 24, fontWeight: '700' }}>TXL</Text>
              </Text>
            </LinearGradient>

            <Pressable onPress={() => setPicking(true)} style={({ pressed }) => [st.cta, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
              <Icon name="gift" size={20} color="#fff" />
              <Text style={st.ctaText}>Presentear alguém</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/invites' as never)} style={st.ghost} accessibilityRole="button">
              <Icon name="user-plus" size={19} color={colors.zinc800} />
              <Text style={{ fontWeight: '600', fontSize: 16, color: colors.zinc800 }}>Ver os meus convites</Text>
            </Pressable>

            <View style={[st.card, cardShadow]}>
              <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 8, color: colors.zinc900 }}>Movimentos</Text>
              {data.history.length === 0 && <Text style={{ color: colors.zinc600, fontSize: 16 }}>Ainda sem movimentos. Que tal brindar alguém?</Text>}
              {data.history.map((h, i) => (
                <View key={h.id} style={[st.mov, i > 0 && { borderTopWidth: 1, borderTopColor: colors.zinc100 }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 16, fontWeight: '500', color: colors.zinc900 }} numberOfLines={1}>{labels[h.type] ?? h.type}{h.counterparty ? ` · ${h.counterparty.displayName}` : ''}</Text>
                    <Text style={{ fontSize: 14, color: colors.zinc500 }} numberOfLines={1}>{timeAgo(h.createdAt)}</Text>
                    {h.note ? <Text style={{ marginTop: 2, fontSize: 14, color: colors.zinc700 }} numberOfLines={2}>{h.note}</Text> : null}
                  </View>
                  <Text style={{ marginLeft: 12, fontSize: 18, fontWeight: '800', color: h.amount > 0 ? '#15803d' : colors.zinc700 }}>{h.amount > 0 ? '+' : ''}{h.amount}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
      {picking && user && <PickPerson me={user.username} onClose={() => setPicking(false)} onPick={(p) => { setPicking(false); setTo(p); }} />}
      {to && <GiftSheet recipient={to} onClose={() => { setTo(null); void refetch(); }} />}
    </StackPage>
  );
}

const st = StyleSheet.create({
  balance: { borderRadius: 28, padding: 24, boxShadow: '0 10px 30px rgba(214,51,79,0.35)' },
  cta: { marginTop: 20, height: 58, borderRadius: 999, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 10px 24px rgba(214,51,79,0.35)' },
  ctaText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  ghost: { marginTop: 12, height: 48, borderRadius: 999, backgroundColor: colors.zinc100, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  card: { marginTop: 32, borderRadius: 28, backgroundColor: colors.white, padding: 20 },
  mov: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
});
