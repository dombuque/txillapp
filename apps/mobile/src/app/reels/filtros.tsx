import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';

type T = { id: string; label: string };

/** O teu algoritmo: uma frase com o que andas a ver, "o que queres ver mais" e "o que queres ver menos". */
export default function ReelPrefs() {
  const qc = useQueryClient();
  const topics = useQuery({ queryKey: ['explore-topics', 'all'], queryFn: () => api.exploreTopics(true), staleTime: 60_000, retry: false });
  const prefs = useQuery({ queryKey: ['explore-prefs'], queryFn: api.explorePrefs, retry: false });
  const activity = useQuery({ queryKey: ['explore-activity'], queryFn: api.exploreActivity, retry: false });
  const [picking, setPicking] = useState<null | 'more' | 'less'>(null);
  const [busy, setBusy] = useState(false);
  const mine = prefs.data ?? {};
  const all: T[] = topics.data ?? [];
  const label = (id: string) => all.find((t) => t.id === id)?.label ?? activity.data?.find((t) => t.id === id)?.label ?? id;

  const less = Object.keys(mine).filter((k) => mine[k] === -1).map((id) => ({ id, label: label(id) }));
  const explicitMore = Object.keys(mine).filter((k) => mine[k] === 1).map((id) => ({ id, label: label(id) }));
  const learned = (activity.data ?? []).filter((t) => mine[t.id] !== -1 && mine[t.id] !== 1);
  const more: (T & { learned: boolean })[] = [...explicitMore.map((t) => ({ ...t, learned: false })), ...learned.slice(0, 6).map((t) => ({ ...t, learned: true }))];
  const used = new Set([...more.map((t) => t.id), ...less.map((t) => t.id)]);
  const suggestions = all.filter((t) => !used.has(t.id)).slice(0, 4);
  const top = (activity.data ?? []).slice(0, 3).map((t) => t.label.toLowerCase());

  async function set(topic: string, pref: -1 | 0 | 1) {
    const next = { ...mine } as Record<string, number>;
    if (pref === 0) delete next[topic];
    else next[topic] = pref;
    qc.setQueryData(['explore-prefs'], next);
    try {
      qc.setQueryData(['explore-prefs'], await api.setExplorePref(topic, pref));
      void qc.invalidateQueries({ queryKey: ['reels'] });
      void qc.invalidateQueries({ queryKey: ['explore'] });
    } catch {
      void qc.invalidateQueries({ queryKey: ['explore-prefs'] });
    }
  }
  async function reset() {
    setBusy(true);
    await api.resetExplore().catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['explore-prefs'] });
    await qc.invalidateQueries({ queryKey: ['explore-activity'] });
    void qc.invalidateQueries({ queryKey: ['reels'] });
    void qc.invalidateQueries({ queryKey: ['explore'] });
    setBusy(false);
  }

  const headline = top.length
    ? `Ultimamente tens andado a ver ${top.length > 1 ? `${top.slice(0, -1).join(', ')} e ${top[top.length - 1]}` : top[0]}.`
    : 'Ainda estou a conhecer-te. Brinda, comenta e guarda o que gostas para eu aprender.';
  const filled = (t: T, onX: () => void) => (
    <View key={t.id} style={[st.chip, { backgroundColor: colors.zinc100 }]}>
      <Text style={st.chipText}>{t.label}</Text>
      <Pressable onPress={onX} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Tirar ${t.label}`} style={{ marginRight: -4 }}><Icon name="x" size={16} color={colors.zinc500} strokeWidth={2.4} /></Pressable>
    </View>
  );
  const outline = (key: string, text: string, onPress: () => void) => (
    <Pressable key={key} onPress={onPress} style={[st.chip, { borderWidth: 1, borderColor: colors.zinc300, backgroundColor: '#fff' }]} accessibilityRole="button">
      <Icon name="plus" size={15} strokeWidth={2.4} />
      <Text style={st.chipText}>{text}</Text>
    </Pressable>
  );
  const allTopics = (onPick: (id: string) => void) => {
    const list = all.filter((t) => !used.has(t.id));
    return (
      <View style={st.all}>
        {list.length === 0 ? <Text style={{ textAlign: 'center', fontSize: 14, color: colors.zinc500, paddingVertical: 8 }}>Já escolheste todos os temas.</Text> : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {list.map((t) => <Pressable key={t.id} onPress={() => onPick(t.id)} style={st.small} accessibilityRole="button"><Text style={{ fontSize: 14, fontWeight: '600', color: colors.zinc800 }}>{t.label}</Text></Pressable>)}
          </View>
        )}
      </View>
    );
  };

  return (
    <StackPage title="O teu algoritmo">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48 }}>
        <Text style={st.headline}>{headline}</Text>

        <Text style={[st.h3, { marginTop: 36 }]}>O que queres ver mais</Text>
        <Text style={st.sub}>Com base na tua atividade e nas tuas escolhas</Text>
        <View style={st.wrap}>
          {more.map((t) => filled(t, () => void set(t.id, t.learned ? -1 : 0)))}
          {suggestions.map((t) => outline(t.id, t.label, () => void set(t.id, 1)))}
          {outline('add-more', 'Adicionar', () => setPicking(picking === 'more' ? null : 'more'))}
        </View>
        {picking === 'more' && allTopics((id) => { void set(id, 1); setPicking(null); })}

        <Text style={[st.h3, { marginTop: 36, marginBottom: 12 }]}>O que queres ver menos</Text>
        <View style={st.wrap}>
          {less.map((t) => filled(t, () => void set(t.id, 0)))}
          {outline('add-less', 'Adicionar', () => setPicking(picking === 'less' ? null : 'less'))}
        </View>
        {picking === 'less' && allTopics((id) => { void set(id, -1); setPicking(null); })}

        <Pressable onPress={() => void reset()} disabled={busy} style={[st.reset, busy && { opacity: 0.6 }]} accessibilityRole="button"><Text style={{ fontSize: 16, fontWeight: '700', color: colors.zinc800 }}>Repor o algoritmo</Text></Pressable>
        <Text style={{ marginTop: 8, textAlign: 'center', fontSize: 12, color: colors.zinc500 }}>Apaga as tuas escolhas e o "Interessado / Não interessado" que deste.</Text>
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  headline: { fontSize: 26, fontWeight: '800', lineHeight: 31, letterSpacing: -0.4, color: colors.zinc900 },
  h3: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  sub: { marginBottom: 12, fontSize: 14, color: colors.zinc500 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 16 },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.zinc900 },
  all: { marginTop: 16, borderRadius: 24, backgroundColor: '#fafafa', padding: 14 },
  small: { height: 40, justifyContent: 'center', borderRadius: 999, backgroundColor: '#fff', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.zinc200 },
  reset: { marginTop: 48, height: 48, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
});
