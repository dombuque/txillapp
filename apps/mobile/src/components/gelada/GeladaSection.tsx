import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { geladaApi, geladaKeys, type GeladaBook } from '@/lib/api.gelada';
import { bookSummary, debtLine, debtState } from '@/lib/gelada';
import { colors } from '@/lib/theme';
import { Icon } from '../Icon';
import { TasteBubble } from '../TasteBubble';

const AMBER_INK = '#92400e';

/**
 * «Geladas» no cartão da geleira: «Deves 2 · Devem-te 3» e as dívidas por pagar (até 3), com «Ver o livro». No meu perfil, o
 * meu livro todo. No de outra pessoa, o que o servidor deixa ver: o livro dela (se o mostra) ou só o que há entre nós; sem
 * nada, a secção não aparece.
 */
export function GeladaSection({ username, isMe }: { username: string; isMe: boolean }) {
  const router = useRouter();
  const q = useQuery<GeladaBook>({ queryKey: geladaKeys.book(isMe ? undefined : username), queryFn: () => (isMe ? geladaApi.myBook() : geladaApi.book(username)), retry: false, staleTime: 30_000 });
  if (!q.data) return null;
  const b = q.data;
  if (!isMe && b.items.length === 0) return null;
  const open = b.items.filter((d) => d.status === 'open').slice(0, 3);
  const mine = isMe || b.scope === 'between';
  const go = () => router.push((isMe ? '/geladas' : `/geladas?u=${encodeURIComponent(username)}`) as never);
  return (
    <View style={st.box} accessibilityLabel="Geladas">
      <Pressable onPress={go} style={({ pressed }) => [st.head, pressed && { opacity: 0.7 }]} accessibilityRole="link" accessibilityLabel={`Geladas: ${bookSummary(b.owe, b.owed, mine)}. Ver o livro`}>
        <Icon name="cheers" size={18} color={colors.amber600} />
        <Text style={st.title}>Geladas</Text>
        <Text style={st.sum} numberOfLines={1}>{bookSummary(b.owe, b.owed, mine)}</Text>
        <Icon name="chevron-right" size={16} color={colors.zinc500} />
      </Pressable>
      {open.map((d) => (
        <View key={d.id} style={st.row} accessible accessibilityLabel={`${debtLine(d)}. ${debtState(d)}`}>
          <TasteBubble item={{ slug: d.drink.slug, kind: 'bebida', category: d.drink.category }} size={30} />
          <Text style={st.line} numberOfLines={1}>{debtLine(d)}</Text>
          <Text style={[st.state, d.claimed && { color: AMBER_INK }]} numberOfLines={1}>{debtState(d)}</Text>
        </View>
      ))}
      {isMe && b.items.length === 0 ? <Text style={st.empty}>Ainda não há geladas no livro. Toca numa bebida e pede uma à malta!</Text> : null}
      {!isMe && b.scope === 'between' ? <Text style={st.empty}>Só tu e {`@${username}`} veem isto.</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  box: { marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: '#fde68a', backgroundColor: '#fffbeb', paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  head: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '800', color: colors.zinc900 },
  sum: { flex: 1, minWidth: 0, textAlign: 'right', fontSize: 13, fontWeight: '700', color: AMBER_INK },
  row: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8 },
  line: { flex: 1, minWidth: 0, fontSize: 13, color: colors.zinc800 },
  state: { fontSize: 12, fontWeight: '600', color: colors.zinc500 },
  empty: { fontSize: 12, lineHeight: 16, color: colors.zinc600, paddingBottom: 4 },
});
