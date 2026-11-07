import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { BarChart } from '@/components/BarChart';
import { Icon, type IconName } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { extraApi } from '@/lib/api.extra';
import { abs } from '@/lib/config';
import { colors } from '@/lib/theme';

type Period = 7 | 30 | 90;
const num = (n: number) => n.toLocaleString('pt-PT');
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const GENDER: Record<string, string> = { female: 'Mulheres', male: 'Homens', other: 'Outro' };

function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[st.card, style]}>{children}</View>;
}

function Delta({ v }: { v: number }) {
  if (!v) return <Text style={st.deltaGrey}>igual ao período anterior</Text>;
  return (
    <Text style={[st.delta, { color: v > 0 ? colors.green700 : colors.red600 }]}>
      {v > 0 ? '+' : ''}{v}% <Text style={{ fontWeight: '400', color: colors.zinc500 }}>face ao período anterior</Text>
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
    <StackPage title="Estatísticas do perfil">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="tablist">
          {([7, 30, 90] as const).map((p) => (
            <Pressable key={p} onPress={() => setDays(p)} accessibilityRole="tab" accessibilityState={{ selected: days === p }} style={[st.tab, days === p && { backgroundColor: colors.zinc900 }]}>
              <Text style={[st.tabText, days === p && { color: '#fff' }]}>{p} dias</Text>
            </Pressable>
          ))}
        </View>

        {q.isLoading && <ActivityIndicator style={{ marginVertical: 64 }} color={colors.brand} />}
        {q.isError && <Text style={{ paddingVertical: 64, textAlign: 'center', fontSize: 16, color: colors.zinc600 }}>Não consegui ver as estatísticas agora</Text>}
        {d && (
          <>
            <Text style={{ fontSize: 14, color: colors.zinc600 }}>Só tu vês isto. Mostramos números, nunca quem é quem.</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Stat icon="eye" label="Contas alcançadas" value={d.overview.reach} delta={d.overview.reachDelta} />
              <Stat icon="cheers" label="Interações" value={d.overview.interactions} delta={d.overview.interactionsDelta} />
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Stat icon="user-plus" label="Novos seguidores" value={d.overview.newFollowers} delta={d.overview.newFollowersDelta} />
              <Stat icon="user" label="Visitas ao perfil" value={d.overview.profileVisitors} delta={d.overview.profileVisitorsDelta} />
            </View>
            <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }}>Seguidores</Text>
              <Text style={{ fontSize: 24, fontWeight: '800', color: colors.zinc900 }}>{num(d.overview.followers)}</Text>
            </Card>

            <BarChart title="Contas alcançadas por dia" data={d.series.map((s) => ({ day: s.day, value: s.reach }))} />
            <BarChart title="Interações por dia" data={d.series.map((s) => ({ day: s.day, value: s.interactions }))} />
            <BarChart title="Novos seguidores por dia" data={d.series.map((s) => ({ day: s.day, value: s.followers }))} />

            <Card>
              <Text style={st.bold}>Interações</Text>
              <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 }}>
                {([
                  ['Brindes', d.interactions.cheers], ['Comentários', d.interactions.comments],
                  ['Reposts', d.interactions.reposts], ['Presentes', d.interactions.gifts],
                  ['Brindes em mimos', d.interactions.storyCheers], ['Respostas a mimos', d.interactions.storyReplies],
                  ['Visualizações de mimos', d.overview.storyViews],
                ] as const).map(([label, v]) => (
                  <View key={label} style={{ width: '50%' }}>
                    <Text style={{ fontSize: 14, color: colors.zinc600 }}>{label}</Text>
                    <Text style={{ fontSize: 20, fontWeight: '800', color: colors.zinc900 }}>{num(v)}</Text>
                  </View>
                ))}
              </View>
            </Card>

            <Card>
              <Text style={st.bold}>Quando a malta reage mais</Text>
              {bestHour && bestHour.value > 0 && bestDay ? (
                <Text style={{ marginTop: 4, fontSize: 14, color: colors.zinc600 }}>Melhor hora: {bestHour.hour}h · melhor dia: {DAYS[bestDay.dow]}</Text>
              ) : (
                <Text style={{ marginTop: 4, fontSize: 14, color: colors.zinc500 }}>Ainda sem dados suficientes.</Text>
              )}
              <View style={{ marginTop: 12, height: 80, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }} accessibilityLabel="Reações por hora do dia">
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
                <Text style={st.bold}>Publicações em destaque</Text>
                <View style={{ marginTop: 8 }}>
                  {d.top.map((p, i) => (
                    <Pressable key={p.id} onPress={() => router.push((p.video ? `/r/${p.code}` : `/p/${p.code}`) as never)} accessibilityRole="button" style={({ pressed }) => [st.top, i > 0 && { borderTopWidth: 1, borderTopColor: colors.zinc100 }, pressed && { backgroundColor: '#fafafa' }]}>
                      {p.mediaUrl ? (
                        <Image source={{ uri: abs(p.mediaUrl) }} style={st.thumb} contentFit="cover" />
                      ) : (
                        <View style={[st.thumb, { alignItems: 'center', justifyContent: 'center' }]}><Icon name="file-text" size={22} color="#a1a1aa" /></View>
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 16, fontWeight: '500', color: colors.zinc900 }} numberOfLines={1}>{p.body || 'Publicação'}</Text>
                        <Text style={{ fontSize: 12, color: colors.zinc600 }}>{num(p.reach)} alcançadas · {num(p.cheers)} brindes · {num(p.comments)} comentários · {num(p.reposts)} reposts</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </Card>
            )}

            {aud?.enough ? (
              <>
                <Text style={{ paddingTop: 8, fontSize: 18, fontWeight: '800', color: colors.zinc900 }}>O teu público</Text>
                <Text style={{ marginTop: -8, fontSize: 14, color: colors.zinc600 }}>Os teus {num(aud.followers)} seguidores, em números agregados.</Text>
                <Bars title="Idades" rows={aud.ages} />
                <Bars title="Género" rows={aud.gender.map((g) => ({ ...g, label: GENDER[g.label] ?? g.label }))} />
                <Bars title="Países" rows={aud.countries} />
                <Bars title="Cidades" rows={aud.cities} />
                <Bars title="Interesses do teu público" hint="Da geleira de quem a deixa visível. Só aparecem gostos partilhados por várias pessoas." rows={aud.interests} />
              </>
            ) : aud ? (
              <Card>
                <Text style={st.bold}>O teu público</Text>
                <Text style={{ marginTop: 4, fontSize: 14, color: colors.zinc600 }}>Com pelo menos {aud.minimum} seguidores mostramos as idades, o género, os sítios e os interesses do teu público, sempre em números agregados. Tens {aud.followers}.</Text>
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
  tab: { flex: 1, alignItems: 'center', borderRadius: 999, backgroundColor: colors.zinc100, paddingVertical: 10 },
  tabText: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
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
