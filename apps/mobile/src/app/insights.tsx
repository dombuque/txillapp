import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PageLoader } from '@/components/PontoLoader';
import { ErrorState } from '@/components/ui/ErrorState';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { BarChart } from '@/components/BarChart';
import { Icon, type IconName } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { extraApi } from '@/lib/api.extra';
import { abs } from '@/lib/config';
import { colors } from '@/lib/theme';
import { intlLocale, t, weekdayNames } from '@/lib/i18n';

type Period = 7 | 30 | 90;
const num = (n: number) => n.toLocaleString(intlLocale());
const GENDER: Record<string, string> = { get female() { return t('Mulheres'); }, get male() { return t('Homens'); }, get other() { return t('Outro'); } };

function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[st.card, style]}>{children}</View>;
}

function Delta({ v }: { v: number }) {
  if (!v) return <Text style={st.deltaGrey}>{t('igual ao período anterior')}</Text>;
  return (
    <Text style={[st.delta, { color: v > 0 ? colors.green700 : colors.red600 }]}>
      {v > 0 ? '+' : ''}{v}% <Text style={{ fontWeight: '400', color: colors.zinc500 }}>{t('face ao período anterior')}</Text>
    </Text>
  );
}

function Stat({ icon, label, value, delta }: { icon: IconName; label: string; value: number; delta?: number }) {
  return (
    <Card style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={icon} size={16} color={colors.zinc600} />
        <Text style={st.statLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={st.statValue}>{num(value)}</Text>
      {delta !== undefined && <Delta v={delta} />}
    </Card>
  );
}

/** Barras horizontais (percentagens): idades, género, sítios e interesses do público. */
function Bars({ title, rows, hint }: { title: string; rows: { label: string; pct: number; value: number }[]; hint?: string }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <Text style={st.bold}>{title}</Text>
      {hint ? <Text style={st.hint}>{hint}</Text> : null}
      <View style={{ marginTop: 12, gap: 10 }}>
        {rows.map((r) => (
          <View key={r.label}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ flexShrink: 1, fontSize: 14, fontWeight: '500', color: colors.zinc900 }} numberOfLines={1}>{r.label}</Text>
              <Text style={{ fontSize: 14, color: colors.zinc600 }}>{r.pct}%</Text>
            </View>
            <View style={st.track}><View style={[st.fill, { width: `${Math.max(3, r.pct)}%` }]} /></View>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** As estatísticas do teu perfil, como os Insights de outras redes: só tu as vês. */
export default function Insights() {
  const router = useRouter();
  const [days, setDays] = useState<Period>(30);
  const tz = -new Date().getTimezoneOffset();
  const q = useQuery({ queryKey: ['insights', days, tz], queryFn: () => extraApi.insights(days, tz), staleTime: 60_000, retry: false });
  const d = q.data;
  const bestHour = d ? [...d.hours].sort((a, b) => b.value - a.value)[0] : null;
  const bestDay = d ? [...d.weekdays].sort((a, b) => b.value - a.value)[0] : null;
  const maxHour = d ? Math.max(1, ...d.hours.map((h) => h.value)) : 1;
  const aud = d?.audience;

  return (
    <StackPage title={t('Estatísticas do perfil')}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, gap: 12 }}>
        <SegmentedTabs tabs={([7, 30, 90] as const).map((p) => ({ value: String(p) as `${Period}`, label: t('{p} dias', { p }) }))} value={String(days) as `${Period}`} onChange={(v) => setDays(Number(v) as Period)} />

        {q.isLoading && <PageLoader />}
        {q.isError && <ErrorState what={t('as estatísticas')} onRetry={() => void q.refetch()} />}
        {d && (
          <>
            <Text style={{ fontSize: 14, color: colors.zinc600 }}>{t('Só tu vês isto. Mostramos números, nunca quem é quem.')}</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Stat icon="eye" label={t('Contas alcançadas')} value={d.overview.reach} delta={d.overview.reachDelta} />
              <Stat icon="cheers" label={t('Interações')} value={d.overview.interactions} delta={d.overview.interactionsDelta} />
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Stat icon="user-plus" label={t('Novos seguidores')} value={d.overview.newFollowers} delta={d.overview.newFollowersDelta} />
              <Stat icon="user" label={t('Visitas ao perfil')} value={d.overview.profileVisitors} delta={d.overview.profileVisitorsDelta} />
            </View>
            <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }}>{t('Seguidores')}</Text>
              <Text style={{ fontSize: 24, fontWeight: '800', color: colors.zinc900 }}>{num(d.overview.followers)}</Text>
            </Card>

            <BarChart title={t('Contas alcançadas por dia')} data={d.series.map((s) => ({ day: s.day, value: s.reach }))} />
            <BarChart title={t('Interações por dia')} data={d.series.map((s) => ({ day: s.day, value: s.interactions }))} />
            <BarChart title={t('Novos seguidores por dia')} data={d.series.map((s) => ({ day: s.day, value: s.followers }))} />

            <Card>
              <Text style={st.bold}>{t('Interações')}</Text>
              <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 }}>
                {([
                  [t('Brindes'), d.interactions.cheers], [t('Comentários'), d.interactions.comments],
                  [t('Reposts'), d.interactions.reposts], [t('Presentes'), d.interactions.gifts],
                  [t('Brindes em mimos'), d.interactions.storyCheers], [t('Respostas a mimos'), d.interactions.storyReplies],
                  [t('Visualizações de mimos'), d.overview.storyViews],
                ] as const).map(([label, v]) => (
                  <View key={label} style={{ width: '50%' }}>
                    <Text style={{ fontSize: 14, color: colors.zinc600 }}>{label}</Text>
                    <Text style={{ fontSize: 20, fontWeight: '800', color: colors.zinc900 }}>{num(v)}</Text>
                  </View>
                ))}
              </View>
            </Card>

            <Card>
              <Text style={st.bold}>{t('Quando a malta reage mais')}</Text>
              {bestHour && bestHour.value > 0 && bestDay ? (
                <Text style={{ marginTop: 4, fontSize: 14, color: colors.zinc600 }}>{t('Melhor hora: {hour}h · melhor dia: {day}', { hour: bestHour.hour, day: weekdayNames('short', { capital: true })[bestDay.dow] })}</Text>
              ) : (
                <Text style={{ marginTop: 4, fontSize: 14, color: colors.zinc500 }}>{t('Ainda sem dados suficientes.')}</Text>
              )}
              <View style={{ marginTop: 12, height: 80, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }} accessibilityLabel={t('Reações por hora do dia')}>
                {d.hours.map((h) => (
                  <View key={h.hour} style={{ flex: 1, height: `${Math.max(4, (h.value / maxHour) * 100)}%`, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: h.hour === bestHour?.hour && h.value > 0 ? colors.brand : colors.zinc300 }} />
                ))}
              </View>
              <View style={{ marginTop: 4, flexDirection: 'row', justifyContent: 'space-between' }}>
                {['0h', '6h', '12h', '18h', '23h'].map((l) => <Text key={l} style={{ fontSize: 11, color: colors.zinc500 }}>{l}</Text>)}
              </View>
            </Card>

            {d.top.length > 0 && (
              <Card>
                <Text style={st.bold}>{t('Publicações em destaque')}</Text>
                <View style={{ marginTop: 8 }}>
                  {d.top.map((p, i) => (
                    <Pressable key={p.id} onPress={() => router.push(((p.tcheka ?? p.video) ? `/r/${p.code}` : `/p/${p.code}`) as never)} accessibilityRole="button" style={({ pressed }) => [st.top, i > 0 && { borderTopWidth: 1, borderTopColor: colors.zinc100 }, pressed && { backgroundColor: colors.zinc50 }]}>
                      {p.mediaUrl ? (
                        <Image source={{ uri: abs(p.mediaUrl) }} style={st.thumb} contentFit="cover" />
                      ) : (
                        <View style={[st.thumb, { alignItems: 'center', justifyContent: 'center' }]}><Icon name="file-text" size={22} color={colors.zinc400} /></View>
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 16, fontWeight: '500', color: colors.zinc900 }} numberOfLines={1}>{p.body || t('Publicação')}</Text>
                        <Text style={{ fontSize: 12, color: colors.zinc600 }}>{t('{num} alcançadas · {num2} brindes · {num3} comentários · {num4} reposts', { num: num(p.reach), num2: num(p.cheers), num3: num(p.comments), num4: num(p.reposts) })}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </Card>
            )}

            {aud?.enough ? (
              <>
                <Text style={{ paddingTop: 8, fontSize: 18, fontWeight: '800', color: colors.zinc900 }}>{t('O teu público')}</Text>
                <Text style={{ marginTop: -8, fontSize: 14, color: colors.zinc600 }}>{t('Os teus {num} seguidores, em números agregados.', { num: num(aud.followers) })}</Text>
                <Bars title={t('Idades')} rows={aud.ages} />
                <Bars title={t('Género')} rows={aud.gender.map((g) => ({ ...g, label: GENDER[g.label] ?? g.label }))} />
                <Bars title={t('Países')} rows={aud.countries} />
                <Bars title={t('Cidades')} rows={aud.cities} />
                <Bars title={t('Interesses do teu público')} hint={t('Da geleira de quem a deixa visível. Só aparecem gostos partilhados por várias pessoas.')} rows={aud.interests} />
              </>
            ) : aud ? (
              <Card>
                <Text style={st.bold}>{t('O teu público')}</Text>
                <Text style={{ marginTop: 4, fontSize: 14, color: colors.zinc600 }}>{t('Com pelo menos {minimum} seguidores mostramos as idades, o género, os sítios e os interesses do teu público, sempre em números agregados. Tens {followers}.', { minimum: aud.minimum, followers: aud.followers })}</Text>
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200, backgroundColor: colors.white, padding: 16 },
  statLabel: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.zinc600 },
  statValue: { marginTop: 4, fontSize: 30, fontWeight: '800', color: colors.zinc900 },
  delta: { fontSize: 12, fontWeight: '700' },
  deltaGrey: { fontSize: 12, color: colors.zinc500 },
  bold: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  hint: { fontSize: 12, color: colors.zinc500 },
  track: { marginTop: 4, height: 8, overflow: 'hidden', borderRadius: 999, backgroundColor: colors.zinc100 },
  fill: { height: '100%', borderRadius: 999, backgroundColor: colors.brand },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: colors.zinc100 },
});
