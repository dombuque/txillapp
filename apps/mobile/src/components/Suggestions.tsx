import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { feedApi, type Suggestion } from '@/lib/api.feed';
import { snoozeSuggestions } from '@/lib/suggestPacing';
import { cardShadow, colors } from '@/lib/theme';
import { Avatar } from './Avatar';
import { FollowButton } from './FollowButton';
import { Icon } from './Icon';
import { NameWithBadge } from './NameWithBadge';

/** "Bora conhecer malta nova?": amigos em comum primeiro; dá para dispensar com o X. */
export function Suggestions() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data } = useQuery({ queryKey: ['suggestions'], queryFn: feedApi.suggestions, staleTime: 60_000 });
  if (!data || data.length === 0) return null;

  function dismiss(p: Suggestion) {
    void snoozeSuggestions(24);
    qc.setQueryData<Suggestion[]>(['suggestions'], (d) => d?.filter((x) => x.username !== p.username));
    feedApi.dismissSuggestion(p.username).catch(() => qc.invalidateQueries({ queryKey: ['suggestions'] }));
  }

  return (
    <View accessibilityLabel="Sugestões de pessoas" style={[st.card, cardShadow]}>
      <Text style={st.title}>Bora conhecer malta nova?</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 4 }} style={{ marginTop: 16 }}>
        {data.map((p) => (
          <View key={p.username} style={st.item}>
            <Pressable onPress={() => dismiss(p)} hitSlop={6} style={st.close} accessibilityRole="button" accessibilityLabel={`Não sugerir ${p.displayName}`}>
              <Icon name="x" size={14} color={colors.zinc500} strokeWidth={2.4} />
            </Pressable>
            <Pressable onPress={() => router.push(`/u/${p.username}` as never)} style={{ width: '100%', alignItems: 'center' }} accessibilityRole="link">
              <Avatar name={p.displayName} username={p.username} size={64} />
              <NameWithBadge name={p.displayName} who={p} style={st.name} gap={4} containerStyle={{ marginTop: 12, maxWidth: '100%' }}>
                {p.isPrivate ? <Icon name="lock" size={14} color={colors.zinc500} /> : null}
              </NameWithBadge>
              <Text style={st.handle} numberOfLines={1}>@{p.username}</Text>
              <Text style={st.reason} numberOfLines={2}>{p.reason}</Text>
            </Pressable>
            <View style={{ marginTop: 12, width: '100%' }}>
              <FollowButton username={p.username} following={false} requested={p.requested} isPrivate={p.isPrivate} />
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 24, borderRadius: 28, backgroundColor: colors.white, paddingVertical: 20 },
  title: { paddingHorizontal: 20, fontSize: 18, fontWeight: '700', color: colors.zinc900 },
  item: { width: 152, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200, paddingHorizontal: 12, paddingBottom: 12, paddingTop: 20 },
  close: { position: 'absolute', right: 6, top: 6, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  name: { fontSize: 16, fontWeight: '600', color: colors.zinc900, flexShrink: 1 },
  handle: { width: '100%', textAlign: 'center', fontSize: 14, color: colors.zinc500 },
  reason: { marginTop: 4, minHeight: 32, textAlign: 'center', fontSize: 12, lineHeight: 16, color: colors.zinc500 },
});
