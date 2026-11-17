import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Post } from '@/lib/api';
import type { MixarPerson } from '@/lib/api.mixar';
import { mixarControloKeys, type MixarShareTo, type MixarWeek, type mixarControloApi } from '@/lib/api.mixarControlo';
import { abs, sized } from '@/lib/config';
import { reactionOf } from '@/lib/mixar';
import { shareDoneText, shareErrorText, weekLine, weekStats } from '@/lib/mixarControlo';
import { colors } from '@/lib/theme';
import { Icon } from '../Icon';
import { NameWithBadge } from '../NameWithBadge';
import { ActivityIndicator } from '../PontoLoader';
import { Sheet } from '../Sheet';
import { PairAvatars, ReactionGlyph, TopicChips } from './MixarBits';
import { t } from '@/lib/i18n';

type Api = typeof mixarControloApi;
type Who = { name: string; username?: string };
const snap = Platform.OS === 'web' ? ({ scrollSnapAlign: 'start', scrollSnapStop: 'always' } as object) : null;
const STAT_ICON = { streak: 'flame', challenge: 'party', videos: 'film' } as const;

const thumbOf = (p: Post) => {
  const m = p.media[0];
  return sized(m?.kind === 'video' ? m.posterUrl ?? null : m?.url ?? null, 240) ?? abs(m?.posterUrl ?? m?.url);
};

/**
 * O cartão do «Resumo da semana» do Mixar: as datas, os dois («Dom + Ana», com o selo de quem é verificado), a série, os
 * acertos no Mixa Challenge, os vídeos vistos, o que mais vos fez reagir (só aqui: não vai na imagem partilhada) e os temas
 * da semana (sem os privados de nenhum dos dois).
 */
export function WeekCard({ week, me, them, partner, onOpenTop }: { week: MixarWeek; me: Who; them: Who; partner: MixarPerson; onOpenTop?: (p: Post) => void }) {
  const stats = weekStats(week);
  const top = week.top;
  const mine = reactionOf(top?.mine);
  const theirs = reactionOf(top?.theirs);
  return (
    <View style={wc.card}>
      <LinearGradient colors={['#2a0b12', '#4a1020', '#120608']} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(214,51,79,0.45)', 'rgba(214,51,79,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.5 }} style={StyleSheet.absoluteFill} />
      <Text style={wc.kicker}>MIXAR</Text>
      <Text style={wc.title} accessibilityRole="header">{t('Resumo da semana')}</Text>
      <Text style={wc.dates}>{week.label}</Text>
      <View style={{ alignItems: 'center', marginTop: 14 }}>
        <PairAvatars me={me} them={them} size={44} ring="#2a0b12" />
        <View style={wc.names}>
          <Text style={wc.name} numberOfLines={1}>{me.name}</Text>
          <Text style={[wc.name, { color: '#ffb4a2' }]}> + </Text>
          <NameWithBadge name={them.name} who={partner} style={wc.name} containerStyle={{ flexShrink: 1 }} />
        </View>
      </View>
      <View style={wc.grid}>
        {stats.map((s, i) => (
          <View key={s.key} style={[wc.stat, i === 2 && { flexBasis: '100%' }]} accessible accessibilityLabel={`${s.value} ${s.label}`}>
            <Icon name={STAT_ICON[s.key]} size={18} color="#ffb4a2" />
            <Text style={wc.statValue} numberOfLines={1} adjustsFontSizeToFit>{s.value}</Text>
            <Text style={wc.statLabel} numberOfLines={2}>{s.label}</Text>
          </View>
        ))}
      </View>
      {top ? (
        <Pressable onPress={onOpenTop ? () => onOpenTop(top.post) : undefined} disabled={!onOpenTop} style={({ pressed }) => [wc.top, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={t('O que mais vos fez reagir: a publicação de {displayName}. Toca para abrir', { displayName: top.post.author.displayName })}>
          <View style={wc.thumb}>
            {thumbOf(top.post) ? <Image source={{ uri: thumbOf(top.post) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
            {top.post.media[0]?.kind === 'video' ? <View style={wc.play}><Icon name="play" size={12} color="#fff" solid /></View> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={wc.topKicker}>{t('O QUE MAIS VOS FEZ REAGIR')}</Text>
            <NameWithBadge name={`@${top.post.author.username}`} who={top.post.author} style={wc.topName} />
            <View style={wc.reacts}>
              {mine ? <View style={wc.react}><ReactionGlyph r={mine} size={18} /><Text style={wc.reactWho}>{t('Tu')}</Text></View> : null}
              {theirs ? <View style={wc.react}><ReactionGlyph r={theirs} size={18} /><Text style={wc.reactWho} numberOfLines={1}>{them.name}</Text></View> : null}
            </View>
          </View>
          <Icon name="chevron-right" size={18} color="rgba(255,255,255,0.7)" />
        </Pressable>
      ) : null}
      {week.topics.length ? (
        <View style={{ marginTop: 16 }}>
          <Text style={wc.topKicker}>{t('OS VOSSOS TEMAS DA SEMANA')}</Text>
          <View style={{ marginTop: 8 }}><TopicChips topics={week.topics} tone="dark" /></View>
        </View>
      ) : null}
      <Text style={wc.line}>{weekLine(week, them.name)}</Text>
    </View>
  );
}

/** «Partilhar no Zás» e «Partilhar nos mimos» (a imagem é desenhada no servidor, sem temas privados). */
export function WeekShare({ mixarId, api, dark = false }: { mixarId: string; api: Api; dark?: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<MixarShareTo | null>(null);
  const [done, setDone] = useState<Partial<Record<MixarShareTo, true>>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function share(to: MixarShareTo) {
    if (busy || done[to]) return;
    setBusy(to);
    setMsg(null);
    try {
      await api.shareWeek(mixarId, to);
      setDone((d) => ({ ...d, [to]: true }));
      setMsg({ ok: true, text: shareDoneText(to) });
      void qc.invalidateQueries({ queryKey: to === 'zas' ? ['instants'] : ['stories'] });
    } catch (e) {
      setMsg({ ok: false, text: shareErrorText(e) });
    } finally {
      setBusy(null);
    }
  }
  const btn = (to: MixarShareTo, icon: 'bolt' | 'plus', text: string, primary: boolean) => (
    <Pressable
      onPress={() => void share(to)}
      disabled={!!busy || !!done[to]}
      style={({ pressed }) => [primary ? ws.primary : [ws.ghost, dark ? ws.ghostDark : ws.ghostLight], done[to] && ws.done, pressed && { transform: [{ scale: 0.97 }] }, !!busy && busy !== to && { opacity: 0.5 }]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!busy || !!done[to], busy: busy === to }}
    >
      {busy === to ? <ActivityIndicator color={primary || dark ? '#fff' : colors.zinc900} /> : (
        <>
          <Icon name={done[to] ? 'check' : icon} size={18} color={primary || dark || done[to] ? '#fff' : colors.zinc900} solid={icon === 'bolt' && !done[to]} strokeWidth={2.4} />
          <Text style={[ws.text, { color: primary || dark || done[to] ? '#fff' : colors.zinc900 }]}>{done[to] ? (to === 'zas' ? t('No teu Zás') : t('Nos teus mimos')) : text}</Text>
        </>
      )}
    </Pressable>
  );
  return (
    <View style={{ gap: 10, width: '100%' }}>
      {btn('zas', 'bolt', t('Partilhar no Zás'), true)}
      {btn('story', 'plus', t('Partilhar nos mimos'), false)}
      {msg ? <Text style={[ws.msg, { color: msg.ok ? (dark ? '#6ee7b7' : colors.green700) : dark ? '#fca5a5' : colors.red600 }]} accessibilityLiveRegion="polite">{msg.text}</Text> : null}
      <Text style={[ws.note, dark && { color: 'rgba(255,255,255,0.6)' }]}>{t('A imagem leva a série, os acertos, os vídeos vistos e os temas da semana. Nunca os temas privados.')}</Text>
    </View>
  );
}

/** A semana carregada (para a página do feed e a folha). */
function useWeek(mixarId: string, api: Api) {
  return useQuery({ queryKey: mixarControloKeys.week(mixarId), queryFn: () => api.week(mixarId), staleTime: 60_000 });
}

/** O cartão da semana como uma página do feed (à segunda-feira, antes do fim da seleção). */
export function WeekPage({ height, mixarId, api, me, them, partner, onOpenTop, topInset }: { height: number; mixarId: string; api: Api; me: Who; them: Who; partner: MixarPerson; onOpenTop: (p: Post) => void; topInset: number }) {
  const w = useWeek(mixarId, api);
  return (
    <View style={[{ height, width: '100%', backgroundColor: '#0b0b0c', overflow: 'hidden' }, snap]}>
      <ScrollView contentContainerStyle={{ minHeight: height, paddingTop: topInset, paddingBottom: 28, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' }} showsVerticalScrollIndicator={false}>
        {w.data ? (
          <View style={{ width: '100%', maxWidth: 420, gap: 16 }}>
            <WeekCard week={w.data} me={me} them={them} partner={partner} onOpenTop={onOpenTop} />
            <WeekShare mixarId={mixarId} api={api} dark />
          </View>
        ) : w.isError ? <Text style={ws.err}>{t('O resumo da semana não carregou.')}</Text> : <ActivityIndicator color="#fff" />}
      </ScrollView>
    </View>
  );
}

/** O resumo da semana numa folha (o botão «Resumo da semana» do cabeçalho). */
export function WeekSheet({ mixarId, api, me, them, partner, onOpenTop, onClose }: { mixarId: string; api: Api; me: Who; them: Who; partner: MixarPerson; onOpenTop: (p: Post) => void; onClose: () => void }) {
  const w = useWeek(mixarId, api);
  return (
    <Sheet title={t('Resumo da semana')} onClose={onClose}>
      <ScrollView style={{ maxHeight: 640 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 16 }}>
        {w.data ? (
          <>
            <WeekCard week={w.data} me={me} them={them} partner={partner} onOpenTop={(p) => { onClose(); onOpenTop(p); }} />
            <WeekShare mixarId={mixarId} api={api} />
          </>
        ) : w.isError ? <Text style={[ws.err, { color: colors.zinc600 }]}>{t('O resumo da semana não carregou. Tenta outra vez daqui a pouco.')}</Text> : <ActivityIndicator style={{ margin: 32 }} color={colors.brand} />}
      </ScrollView>
    </Sheet>
  );
}

const wc = StyleSheet.create({
  card: { borderRadius: 28, overflow: 'hidden', padding: 20, backgroundColor: '#2a0b12' },
  kicker: { textAlign: 'center', fontSize: 12, fontWeight: '900', letterSpacing: 4, color: '#ffb4a2' },
  title: { marginTop: 6, textAlign: 'center', fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#fff' },
  dates: { marginTop: 2, textAlign: 'center', fontSize: 15, fontWeight: '800', color: '#ffb4a2' },
  names: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', maxWidth: '100%' },
  name: { fontSize: 20, fontWeight: '900', color: '#fff' },
  grid: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexGrow: 1, flexBasis: '40%', minWidth: 0, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', padding: 12 },
  statValue: { marginTop: 4, fontSize: 30, lineHeight: 36, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 13, lineHeight: 17, fontWeight: '700', color: 'rgba(255,255,255,0.78)' },
  top: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', padding: 10 },
  thumb: { width: 54, height: 84, borderRadius: 12, overflow: 'hidden', backgroundColor: '#333' },
  play: { position: 'absolute', left: 4, top: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  topKicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, color: '#ffb4a2' },
  topName: { marginTop: 2, fontSize: 15, fontWeight: '700', color: '#fff' },
  reacts: { marginTop: 6, flexDirection: 'row', gap: 10 },
  react: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 8, paddingVertical: 2, maxWidth: 140 },
  reactWho: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  line: { marginTop: 16, textAlign: 'center', fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.8)' },
});

const ws = StyleSheet.create({
  primary: { minHeight: 48, borderRadius: 999, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
  ghost: { minHeight: 48, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20, borderWidth: 1 },
  ghostDark: { borderColor: 'rgba(255,255,255,0.35)' },
  ghostLight: { borderColor: colors.zinc200, backgroundColor: colors.white },
  done: { backgroundColor: colors.green600, borderColor: colors.green600 },
  text: { fontSize: 16, fontWeight: '800' },
  msg: { textAlign: 'center', fontSize: 14, fontWeight: '700' },
  note: { textAlign: 'center', fontSize: 12, lineHeight: 17, color: colors.zinc500 },
  err: { color: 'rgba(255,255,255,0.8)', fontSize: 15, textAlign: 'center' },
});
