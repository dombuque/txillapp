import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { api, type FeedSettings } from '@/lib/api';
import { colors } from '@/lib/theme';
import { t } from '@/lib/i18n';

type T = { id: string; label: string };

/** O teu algoritmo: uma frase com o que andas a ver, "o que queres ver mais" e "o que queres ver menos". */
export default function ReelPrefs() {
  const qc = useQueryClient();
  const topics = useQuery({ queryKey: ['explore-topics', 'all'], queryFn: () => api.exploreTopics(true), staleTime: 60_000, retry: false });
  const prefs = useQuery({ queryKey: ['explore-prefs'], queryFn: api.explorePrefs, retry: false });
  const activity = useQuery({ queryKey: ['explore-activity'], queryFn: api.exploreActivity, retry: false });
  const settings = useQuery({ queryKey: ['feed-settings'], queryFn: api.feedSettings, retry: false });
  const people = useQuery({ queryKey: ['feed-people'], queryFn: api.feedPeople, retry: false });
  const [who, setWho] = useState('');
  const [personErr, setPersonErr] = useState('');
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
  const refreshFeeds = () => { void qc.invalidateQueries({ queryKey: ['reels'] }); void qc.invalidateQueries({ queryKey: ['explore'] }); };
  async function setOpt<K extends keyof FeedSettings>(k: K, v: FeedSettings[K]) {
    const prev = settings.data;
    if (prev) qc.setQueryData(['feed-settings'], { ...prev, [k]: v });
    try {
      qc.setQueryData(['feed-settings'], await api.setFeedSettings({ [k]: v }));
      refreshFeeds();
    } catch {
      qc.setQueryData(['feed-settings'], prev);
    }
  }
  async function addPerson(pref: -1 | 1) {
    setPersonErr('');
    try {
      qc.setQueryData(['feed-people'], await api.setFeedPerson(who.trim().replace(/^@/, ''), pref));
      setWho('');
      refreshFeeds();
    } catch (e) {
      setPersonErr((e as Error).message);
    }
  }
  async function removePerson(username: string) {
    qc.setQueryData(['feed-people'], await api.setFeedPerson(username, 0));
    refreshFeeds();
  }
  const cur = settings.data;
  const opt = <K extends 'following' | 'freshness' | 'media' | 'variety'>(title: string, key: K, options: [FeedSettings[K], string][]) => (
    <View style={{ marginBottom: 16 }}>
      <Text style={st.optTitle}>{title}</Text>
      <View style={st.seg} accessibilityRole="radiogroup">
        {options.map(([v, label]) => {
          const on = cur?.[key] === v;
          return (
            <Pressable key={String(v)} onPress={() => void setOpt(key, v)} style={[st.segBtn, on && st.segOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
              <Text style={[st.segText, on && { color: '#fff' }]} numberOfLines={1}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
  const sw = (title: string, text: string, key: 'hideSeen' | 'calm') => (
    <View style={st.swRow}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }}>{title}</Text>
        <Text style={{ fontSize: 14, color: colors.zinc600 }}>{text}</Text>
      </View>
      <Switch value={!!cur?.[key]} onValueChange={(v) => void setOpt(key, v)} trackColor={{ true: colors.brand, false: colors.zinc300 }} thumbColor="#fff" {...({ activeThumbColor: '#fff' } as object)} accessibilityLabel={title} />
    </View>
  );
  async function reset() {
    setBusy(true);
    await api.resetExplore().catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['explore-prefs'] });
    await qc.invalidateQueries({ queryKey: ['explore-activity'] });
    await qc.invalidateQueries({ queryKey: ['feed-settings'] });
    await qc.invalidateQueries({ queryKey: ['feed-people'] });
    void qc.invalidateQueries({ queryKey: ['reels'] });
    void qc.invalidateQueries({ queryKey: ['explore'] });
    setBusy(false);
  }

  const headline = top.length
    ? t('Ultimamente tens andado a ver {value}.', { value: top.length > 1 ? `${top.slice(0, -1).join(', ')} e ${top[top.length - 1]}` : top[0] })
    : t('Ainda estou a conhecer-te. Brinda, comenta e guarda o que gostas para eu aprender.');
  const filled = (tv: T, onX: () => void) => (
    <View key={tv.id} style={[st.chip, { backgroundColor: colors.zinc100 }]}>
      <Text style={st.chipText}>{tv.label}</Text>
      <Pressable onPress={onX} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Tirar {label}', { label: tv.label })} style={{ marginRight: -4 }}><Icon name="x" size={18} color={colors.zinc500} strokeWidth={2.4} /></Pressable>
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
        {list.length === 0 ? <Text style={{ textAlign: 'center', fontSize: 14, color: colors.zinc500, paddingVertical: 8 }}>{t('Já escolheste todos os temas.')}</Text> : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {list.map((t) => <Pressable key={t.id} onPress={() => onPick(t.id)} style={st.small} accessibilityRole="button"><Text style={{ fontSize: 14, fontWeight: '600', color: colors.zinc800 }}>{t.label}</Text></Pressable>)}
          </View>
        )}
      </View>
    );
  };

  return (
    <StackPage title={t('O teu algoritmo')}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48 }}>
        <Text style={st.headline}>{headline}</Text>


        <Text style={[st.h3, { marginTop: 36 }]}>{t('Constrói o teu algoritmo')}</Text>
        <Text style={st.sub}>{t('Escolhe como o Explorar e as Tchekas te mostram as coisas')}</Text>
        {opt(t('De onde vem o que vês'), 'following', [['less', t('Descobrir mais')], ['balanced', t('Equilibrado')], ['more', t('Mais de quem sigo')]])}
        {opt(t('Ordem'), 'freshness', [['recent', t('Mais recentes')], ['balanced', t('Equilibrado')], ['popular', t('Mais populares')]])}
        {opt(t('Tipo de conteúdo'), 'media', [['all', t('Tudo')], ['photos', t('Fotos')], ['videos', t('Vídeos')]])}
        {opt(t('Variedade de contas'), 'variety', [['low', t('Poucas contas')], ['normal', 'Normal'], ['high', t('Muitas contas')]])}
        <View style={st.switches}>
          {sw(t('Esconder o que já vi'), t('Não repete publicações que já te apareceram.'), 'hideSeen')}
          {sw(t('Modo tranquilo'), t('Menos festa e bebidas, para dias mais calmos.'), 'calm')}
        </View>

        <Text style={[st.h3, { marginTop: 36 }]}>{t('Pessoas')}</Text>
        <Text style={st.sub}>{t('Quem queres ver mais ou menos no Explorar e nas Tchekas')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={who} onChangeText={setWho} placeholder={t('@utilizador')} placeholderTextColor={colors.zinc500} autoCapitalize="none" autoCorrect={false} style={[st.input, { flex: 1 }]} accessibilityLabel={t('Utilizador')} />
          <Pressable onPress={() => void addPerson(1)} disabled={!who.trim()} style={[st.mini, { backgroundColor: colors.brand }, !who.trim() && { opacity: 0.5 }]} accessibilityRole="button"><Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{t('Mais')}</Text></Pressable>
          <Pressable onPress={() => void addPerson(-1)} disabled={!who.trim()} style={[st.mini, { backgroundColor: colors.zinc100 }, !who.trim() && { opacity: 0.5 }]} accessibilityRole="button"><Text style={{ color: colors.zinc900, fontWeight: '700', fontSize: 14 }}>{t('Menos')}</Text></Pressable>
        </View>
        {personErr ? <Text style={{ marginTop: 6, fontSize: 14, color: colors.danger }}>{personErr}</Text> : null}
        <View style={[st.wrap, { marginTop: 12 }]}>
          {(people.data ?? []).map((p) => (
            <View key={p.username} style={[st.chip, { backgroundColor: p.pref > 0 ? colors.rose50 : colors.zinc100 }]}>
              <Text style={st.chipText}>{p.pref > 0 ? t('Mais') : t('Menos')} · @{p.username}</Text>
              <Pressable onPress={() => void removePerson(p.username)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Tirar @{username}', { username: p.username })} style={{ marginRight: -4 }}><Icon name="x" size={18} color={colors.zinc500} strokeWidth={2.4} /></Pressable>
            </View>
          ))}
        </View>

        <Text style={[st.h3, { marginTop: 36 }]}>{t('O que queres ver mais')}</Text>
        <Text style={st.sub}>{t('Com base na tua atividade e nas tuas escolhas')}</Text>
        <View style={st.wrap}>
          {more.map((t) => filled(t, () => void set(t.id, t.learned ? -1 : 0)))}
          {suggestions.map((t) => outline(t.id, t.label, () => void set(t.id, 1)))}
          {outline('add-more', t('Adicionar'), () => setPicking(picking === 'more' ? null : 'more'))}
        </View>
        {picking === 'more' && allTopics((id) => { void set(id, 1); setPicking(null); })}

        <Text style={[st.h3, { marginTop: 36, marginBottom: 12 }]}>{t('O que queres ver menos')}</Text>
        <View style={st.wrap}>
          {less.map((t) => filled(t, () => void set(t.id, 0)))}
          {outline('add-less', t('Adicionar'), () => setPicking(picking === 'less' ? null : 'less'))}
        </View>
        {picking === 'less' && allTopics((id) => { void set(id, -1); setPicking(null); })}

        <Pressable onPress={() => void reset()} disabled={busy} style={[st.reset, busy && { opacity: 0.6 }]} accessibilityRole="button"><Text style={{ fontSize: 16, fontWeight: '700', color: colors.zinc800 }}>{t('Repor o algoritmo')}</Text></Pressable>
        <Text style={{ marginTop: 8, textAlign: 'center', fontSize: 12, color: colors.zinc500 }}>{t('Apaga as tuas escolhas e o «Interessado / Não interessado» que deste.')}</Text>
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
  all: { marginTop: 16, borderRadius: 24, backgroundColor: colors.zinc50, padding: 14 },
  small: { height: 40, justifyContent: 'center', borderRadius: 999, backgroundColor: '#fff', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.zinc200 },
  optTitle: { marginBottom: 8, fontSize: 15, fontWeight: '600', color: colors.zinc800 },
  seg: { flexDirection: 'row', borderRadius: 999, backgroundColor: colors.zinc100, padding: 4 },
  segBtn: { flex: 1, minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segOn: { backgroundColor: colors.brand },
  segText: { fontSize: 13, fontWeight: '700', color: colors.zinc700 },
  switches: { marginTop: 4, gap: 4 },
  swRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  input: { borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  mini: { height: 48, borderRadius: 999, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  reset: { marginTop: 48, height: 48, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
});
