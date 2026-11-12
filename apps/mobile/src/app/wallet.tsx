import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Avatar } from '@/components/Avatar';
import { Empty } from '@/components/Empty';
import { GeleiraShelf } from '@/components/GeleiraShelf';
import { Icon, type IconName } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { GiftSheet } from '@/components/PostSheets';
import { Sheet } from '@/components/Sheet';
import { StackPage } from '@/components/StackPage';
import { api, type Badged, type WalletView } from '@/lib/api';
import { aoLocal, type WalletTxExtra } from '@/lib/api.locais';
import { useAuth } from '@/lib/auth';
import { cardShadow, colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

const labels: Record<string, string> = { welcome_bonus: 'Boas-vindas, malta!', transfer: 'Txills oferecidos', gift: 'Presente', invite: 'Convite', topup: 'Txills recarregados' };
const icons: Record<string, IconName> = { welcome_bonus: 'party', transfer: 'gift', gift: 'gift', invite: 'user-plus', topup: 'wallet', venue_payment: 'store', group_contribution: 'users', group_refund: 'undo' };

type Mov = WalletView['history'][number] & WalletTxExtra;

/** O texto de um movimento, para onde leva tocar nele (o local, o grupo ou a pessoa) e, quando nomeia uma pessoa, o selo dela. */
function describe(h: Mov): { label: string; to: string | null; who?: Badged | null } {
  const who = h.counterparty;
  const venueTo = h.venue?.slug ? `/v/${h.venue.slug}` : null;
  switch (h.type) {
    case 'venue_payment': {
      // Positivo: eu recebi em nome de um local (lado do local); negativo: paguei a um local.
      const payer = h.from ?? who;
      if (h.amount > 0) return { label: payer ? `Recebido de @${payer.username}` : 'Pagamento recebido', to: venueTo ?? (payer ? `/u/${payer.username}` : null), who: payer };
      return { label: h.venue ? `Pagaste ${aoLocal(h.venue.kind)} ${h.venue.name}` : 'Pagamento a um local', to: venueTo };
    }
    case 'group_contribution':
      return { label: h.group ? `Contribuíste para o cofre de ${h.group.name}` : 'Contribuíste para um cofre', to: h.group ? `/messages/g/${h.group.id}` : null };
    case 'group_refund':
      return { label: h.group ? `Devolução do cofre de ${h.group.name}` : 'Devolução de um cofre', to: h.group ? `/messages/g/${h.group.id}` : null };
    default:
      return { label: labels[h.type] ? `${labels[h.type]}${who ? ` · ${who.displayName}` : ''}` : (h.label ?? 'Movimento'), to: null, who: labels[h.type] ? who : null };
  }
}

/** Escolher a quem oferecer: as pessoas que segues. */
function PickPerson({ me, onPick, onClose }: { me: string; onPick: (p: { username: string; displayName: string }) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const q = useInfiniteQuery({
    queryKey: ['people', 'following', me, term],
    queryFn: ({ pageParam }) => api.following(me, pageParam, term || undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const people = q.data?.pages.flatMap((x) => x.items) ?? [];
  return (
    <Sheet title="A quem queres oferecer?" onClose={onClose}>
      <View style={st.search}>
        <Icon name="search" size={18} color={colors.zinc600} />
        <TextInput value={text} onChangeText={setText} placeholder="Procurar em quem sigo" placeholderTextColor={colors.zinc500} autoCapitalize="none" autoCorrect={false} style={st.searchInput} accessibilityLabel="Procurar" />
        {text ? <Pressable onPress={() => setText('')} hitSlop={10} accessibilityLabel="Limpar pesquisa"><Icon name="x" size={16} color={colors.zinc600} /></Pressable> : null}
      </View>
      <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="handled">
        {q.isLoading && <ActivityIndicator style={{ margin: 24 }} color={colors.brand} />}
        {q.isSuccess && people.length === 0 && <Text style={{ textAlign: 'center', color: colors.zinc600, padding: 24 }}>{term ? 'Ninguém com esse nome' : 'Segue alguém primeiro: só se oferece a quem segues.'}</Text>}
        {people.map((x) => (
          <Pressable key={x.username} onPress={() => onPick(x)} style={st.pick} accessibilityRole="button">
            <Avatar name={x.displayName} username={x.username} size={44} />
            <View style={{ flex: 1 }}>
              <NameWithBadge name={x.displayName} who={x} style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} />
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

            {user ? <GeleiraShelf username={user.username} isMe flush /> : null}

            <View style={[st.card, cardShadow]}>
              <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 8, color: colors.zinc900 }}>Movimentos</Text>
              {data.history.length === 0 && <Text style={{ color: colors.zinc600, fontSize: 16 }}>Ainda sem movimentos. Que tal brindar alguém?</Text>}
              {(data.history as Mov[]).map((h, i) => {
                const { label, to, who } = describe(h);
                return (
                  <Pressable key={h.id} onPress={to ? () => router.push(to as never) : undefined} disabled={!to} accessibilityRole={to ? 'link' : undefined} style={({ pressed }) => [st.mov, i > 0 && { borderTopWidth: 1, borderTopColor: colors.zinc100 }, pressed && to && { opacity: 0.6 }]}>
                    <View style={st.movIcon}><Icon name={icons[h.type] ?? 'wallet'} size={18} color={colors.zinc800} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <NameWithBadge name={label} who={who} style={{ fontSize: 16, fontWeight: '500', color: colors.zinc900 }} numberOfLines={2} />
                      <Text style={{ fontSize: 14, color: colors.zinc500 }} numberOfLines={1}>{timeAgo(h.createdAt)}</Text>
                      {h.note ? <Text style={{ marginTop: 2, fontSize: 14, color: colors.zinc700 }} numberOfLines={2}>{h.note}</Text> : null}
                    </View>
                    <Text style={{ marginLeft: 12, fontSize: 18, fontWeight: '800', color: h.amount > 0 ? '#15803d' : colors.zinc700 }}>{h.amount > 0 ? '+' : ''}{h.amount}</Text>
                  </Pressable>
                );
              })}
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
  mov: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 16 },
  movIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  search: { marginHorizontal: 20, marginBottom: 8, height: 42, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, backgroundColor: colors.zinc100, paddingHorizontal: 14 },
  searchInput: { flex: 1, fontSize: 15, color: colors.zinc900, paddingVertical: 0, outlineStyle: 'none' as never },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
});
