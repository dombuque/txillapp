import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mixarAvisosApi, mixarAvisosKeys, type MixarSuggestion } from '@/lib/api.mixarAvisos';
import { suggestionLine, suggestionTitle, visibleSuggestions } from '@/lib/mixarAvisos';
import { colors } from '@/lib/theme';
import { Avatar } from '../Avatar';
import { NameWithBadge } from '../NameWithBadge';
import { useMixarList } from './MixarEntry';
import { TopicChips } from './MixarBits';
import { useOpenMixar } from './useOpenMixar';

/**
 * «Faz um Mixar com…» (0170): até 3 pessoas com quem falo muito, que me seguem e eu sigo e com gostos parecidos (o servidor
 * escolhe: GET /mixar/suggestions). Um cartão discreto na lista dos meus Mixar (também quando ainda não há nenhum), com
 * «Convidar» (o mesmo convite do chat: useOpenMixar) e «Agora não» (a pessoa some durante 30 dias, guardado no servidor).
 * Sem sugestões, ou num servidor que ainda não as tem, nada.
 */
export function MixarSuggestions() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: mixarAvisosKeys.suggestions(), queryFn: mixarAvisosApi.suggestions, staleTime: 5 * 60_000, retry: false });
  const list = useMixarList();
  const mixar = useOpenMixar();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const shown = visibleSuggestions(q.data?.items, list.data?.items, gone);
  if (!shown.length) return null;

  function later(s: MixarSuggestion) {
    setGone((g) => new Set(g).add(s.username.toLowerCase()));
    void mixarAvisosApi.dismiss(s.username).then(
      () => qc.setQueryData<{ items: MixarSuggestion[] }>(mixarAvisosKeys.suggestions(), (d) => (d ? { items: d.items.filter((x) => x.username !== s.username) } : d)),
      () => undefined,
    );
  }

  return (
    <View style={st.wrap}>
      <Text style={st.section}>Sugestões</Text>
      <View style={st.card}>
        {shown.map((s, i) => (
          <View key={s.username} style={[st.item, i > 0 && st.divider]}>
            <View style={st.top}>
              <Avatar name={s.displayName} username={s.hasAvatar ? s.username : undefined} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <NameWithBadge name={suggestionTitle(s.displayName)} who={s} style={st.title} />
                <Text style={st.sub} numberOfLines={1}>{suggestionLine(s.match)}</Text>
              </View>
            </View>
            {s.common.length ? <View style={st.chips}><TopicChips topics={s.common} max={3} /></View> : null}
            <View style={st.actions}>
              <Pressable onPress={() => void mixar.run(s.username, s.displayName)} disabled={mixar.busy} style={({ pressed }) => [st.btn, st.primary, (pressed || mixar.busy) && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`Convidar ${s.displayName} para um Mixar`}>
                <Text style={st.primaryText}>Convidar</Text>
              </Pressable>
              <Pressable onPress={() => later(s)} style={({ pressed }) => [st.btn, st.ghost, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`Agora não: esconder a sugestão de ${s.displayName}`}>
                <Text style={st.ghostText}>Agora não</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { marginTop: 18 },
  section: { marginBottom: 6, paddingHorizontal: 4, fontSize: 12, fontWeight: '800', letterSpacing: 1, color: colors.zinc500, textTransform: 'uppercase' },
  card: { borderRadius: 18, borderWidth: 1, borderColor: colors.zinc100, overflow: 'hidden' },
  item: { paddingHorizontal: 12, paddingVertical: 12, gap: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.zinc100 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 15, fontWeight: '700', color: colors.zinc900, flexShrink: 1 },
  sub: { marginTop: 2, fontSize: 13, color: colors.zinc500 },
  chips: { paddingLeft: 56 },
  actions: { flexDirection: 'row', gap: 8, paddingLeft: 56 },
  btn: { minHeight: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primary: { backgroundColor: colors.brand },
  primaryText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  ghost: { borderWidth: 1, borderColor: colors.zinc300, backgroundColor: '#fff' },
  ghostText: { fontSize: 14, fontWeight: '600', color: colors.zinc800 },
});
