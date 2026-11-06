import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '@/lib/theme';

interface Point { day: string; value: number }

const W = 320;
const H = 128;
const PAD = { top: 14, right: 4, bottom: 18, left: 4 };
const MONTHS = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
/** "2026-11-05" -> "5 nov." */
const fmtDay = (d: string) => {
  const [, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1] ?? ''}`;
};

/**
 * Barras por dia (igual ao BarChart do site): uma série só, barras finas ancoradas na base com o topo arredondado,
 * só o máximo e as datas das pontas escritos; toca numa barra para ver o dia e o valor. "Ver tabela" mostra os mesmos números.
 */
export function BarChart({ title, data }: { title: string; data: Point[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [w, setW] = useState(0);
  const max = Math.max(1, ...data.map((d) => d.value));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.min(14, slot * 0.62);
  const last = data[data.length - 1];
  const shown = sel ?? data.length - 1;

  return (
    <View style={st.card} accessibilityLabel={`${title}: último dia ${last?.value ?? 0}`}>
      <View style={st.head}>
        <Text style={st.title}>{title}</Text>
        <Text style={st.sub}>
          <Text style={{ fontWeight: '700', color: colors.zinc900 }}>{data[shown]?.value ?? 0}</Text> · {data[shown] ? fmtDay(data[shown].day) : ''}
        </Text>
      </View>
      <View style={{ marginTop: 8 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && (
          <Svg width={w} height={(w * H) / W} viewBox={`0 0 ${W} ${H}`}>
            <Line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke="#d4d4d8" strokeWidth={1} />
            <Line x1={PAD.left} x2={W - PAD.right} y1={PAD.top} y2={PAD.top} stroke="#f4f4f5" strokeWidth={1} />
            <SvgText x={PAD.left} y={PAD.top - 4} fontSize={9} fill="#71717a">{String(max)}</SvgText>
            {data.map((d, i) => {
              const h = d.value === 0 ? 0 : Math.max(2, (d.value / max) * innerH);
              const x = PAD.left + i * slot + (slot - barW) / 2;
              const y = PAD.top + innerH - h;
              const r = Math.min(4, barW / 2, h);
              return (
                <Fragment key={d.day}>
                  {h > 0 && (
                    <Path
                      d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                      fill={colors.brand}
                      opacity={i === shown ? 1 : 0.55}
                    />
                  )}
                </Fragment>
              );
            })}
            {data.map((d, i) => (
              // alvo de toque maior do que a barra
              <Rect key={`t${d.day}`} x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH + PAD.bottom} fill="transparent" onPress={() => setSel(i)} />
            ))}
            <SvgText x={PAD.left} y={H - 4} fontSize={9} fill="#71717a">{data[0] ? fmtDay(data[0].day) : ''}</SvgText>
            <SvgText x={W - PAD.right} y={H - 4} fontSize={9} fill="#71717a" textAnchor="end">{last ? fmtDay(last.day) : ''}</SvgText>
          </Svg>
        )}
      </View>
      <Pressable onPress={() => setTable((t) => !t)} accessibilityRole="button" style={{ marginTop: 4 }}>
        <Text style={st.link}>Ver tabela</Text>
      </Pressable>
      {table && (
        <View style={{ marginTop: 8 }}>
          <View style={st.tr}><Text style={[st.td, { fontWeight: '600' }]}>Dia</Text><Text style={[st.td, { fontWeight: '600', textAlign: 'right' }]}>{title}</Text></View>
          {data.map((d) => (
            <View key={d.day} style={[st.tr, { borderTopWidth: 1, borderTopColor: colors.zinc100 }]}>
              <Text style={st.td}>{fmtDay(d.day)}</Text>
              <Text style={[st.td, { textAlign: 'right' }]}>{d.value}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200, backgroundColor: colors.white, padding: 16 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  title: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  sub: { fontSize: 14, color: colors.zinc600 },
  link: { fontSize: 14, color: colors.zinc600, textDecorationLine: 'underline' },
  tr: { flexDirection: 'row', paddingVertical: 4 },
  td: { flex: 1, fontSize: 14, color: colors.zinc900 },
});
