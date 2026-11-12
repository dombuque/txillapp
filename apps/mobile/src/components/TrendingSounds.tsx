import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { soundsApi } from '@/lib/api.sounds';
import { sized } from '@/lib/config';
import { soundHref, usesLine } from '@/lib/sounds';
import { colors } from '@/lib/theme';

/**
 * «Sons em alta» no Explorar: os sons com mais tchekas nos últimos 7 dias (só números). Tocar abre a página do som.
 * Sem sons (ou com um servidor antigo), não aparece.
 */
export function TrendingSounds() {
  const router = useRouter();
  const q = useQuery({ queryKey: ['sounds', 'trending'], queryFn: () => soundsApi.trending(15), staleTime: 5 * 60_000, retry: false });
  const list = q.data ?? [];
  if (!list.length) return null;
  return (
    <View style={{ paddingBottom: 16 }} accessibilityLabel="Sons em alta">
      <View style={st.headRow}>
        <Text style={st.head}>Sons em alta</Text>
        <Icon name="trending" size={16} strokeWidth={2.2} color="#ea580c" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
        {list.map((s) => (
          <Pressable key={s.id} onPress={() => router.push(soundHref(s.id) as never)} style={({ pressed }) => [st.tile, pressed && { opacity: 0.8 }]} accessibilityRole="link" accessibilityLabel={`${s.title}, ${usesLine(s.uses)}`}>
            <View style={st.cover}>
              {s.cover ? <Image source={{ uri: sized(s.cover, 240) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} accessibilityIgnoresInvertColors /> : <Icon name="music" size={28} color="#fff" />}
            </View>
            <Text style={st.title} numberOfLines={2}>{s.title}</Text>
            <Text style={st.sub} numberOfLines={1}>{usesLine(s.uses)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  headRow: { paddingHorizontal: 20, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  head: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  tile: { width: 112 },
  cover: { width: 112, height: 112, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 6, fontSize: 13, fontWeight: '700', color: colors.zinc900 },
  sub: { fontSize: 12, color: colors.zinc500 },
});
