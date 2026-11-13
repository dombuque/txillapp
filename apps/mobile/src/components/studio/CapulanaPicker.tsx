import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Shuffle } from 'lucide-react-native';
import { CAPULANA_PALETTES, CAPULANA_PATTERNS, nextSeed, paletteById, patternById, type CapulanaSpec } from '@/lib/studio/capulana';
import { CapulanaSwatch } from './CapulanaSwatch';
import { mg } from './MagicUi';

/**
 * O seletor de panos: os 8 padrões e as 6 paletas em miniaturas (o pano a sério, não um ícone), e «Baralhar» para outra
 * variação do mesmo padrão (outra semente: outra escala, outras cores em cada parte).
 */
export function CapulanaPicker({ value, onChange }: { value: CapulanaSpec; onChange: (v: CapulanaSpec) => void }) {
  const pat = patternById(value.pattern), pal = paletteById(value.palette);
  return (
    <View style={{ gap: 14 }}>
      <View style={st.hero}>
        <CapulanaSwatch spec={value} tile={96} style={StyleSheet.absoluteFill} />
        <View style={st.heroLabel}>
          <Text style={st.heroName} numberOfLines={1}>{pat.name} · {pal.name}</Text>
          <Text style={st.heroMood} numberOfLines={1}>{pat.mood}</Text>
        </View>
        <Pressable onPress={() => onChange({ ...value, seed: nextSeed(value.seed) })} accessibilityRole="button" accessibilityLabel="Baralhar o pano" testID="baralhar" style={({ pressed }) => [st.shuffle, pressed && { transform: [{ scale: 0.95 }] }]}>
          <Shuffle size={20} color="#fff" strokeWidth={2.4} />
          <Text style={st.shuffleText}>Baralhar</Text>
        </Pressable>
      </View>

      <View>
        <Text style={st.label}>Padrão</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row} accessibilityRole="radiogroup">
          {CAPULANA_PATTERNS.map((p) => {
            const on = p.id === value.pattern;
            return (
              <Pressable key={p.id} onPress={() => onChange({ ...value, pattern: p.id })} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${p.name}. ${p.mood}`} testID={`padrao-${p.id}`} style={st.item}>
                <View style={[st.thumb, on && st.on]}><CapulanaSwatch spec={{ ...value, pattern: p.id }} tile={76} style={StyleSheet.absoluteFill} /></View>
                <Text style={[st.name, on && st.nameOn]} numberOfLines={1}>{p.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View>
        <Text style={st.label}>Cores</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row} accessibilityRole="radiogroup">
          {CAPULANA_PALETTES.map((p) => {
            const on = p.id === value.palette;
            return (
              <Pressable key={p.id} onPress={() => onChange({ ...value, palette: p.id })} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`Cores ${p.name}`} testID={`paleta-${p.id}`} style={st.item}>
                <View style={[st.dots, on && st.on]}>
                  {p.colors.map((c) => <View key={c} style={{ flex: 1, backgroundColor: c }} />)}
                </View>
                <Text style={[st.name, on && st.nameOn]} numberOfLines={1}>{p.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  hero: { height: 132, marginHorizontal: 16, borderRadius: mg.radius, overflow: 'hidden', borderWidth: 1, borderColor: mg.line, justifyContent: 'flex-end' },
  heroLabel: { alignSelf: 'flex-start', margin: 10, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: 'rgba(8,8,12,0.82)' },
  heroName: { color: '#fff', fontSize: 16, fontWeight: '800' },
  heroMood: { color: mg.muted, fontSize: 14, marginTop: 1 },
  shuffle: { position: 'absolute', right: 10, top: 10, height: 44, borderRadius: 22, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(8,8,12,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  shuffleText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  label: { color: mg.muted, fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 16, marginBottom: 8 },
  row: { paddingHorizontal: 16, gap: 10 },
  item: { width: 80, alignItems: 'center', gap: 6 },
  thumb: { width: 80, height: 80, borderRadius: 18, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.16)' },
  dots: { width: 80, height: 48, borderRadius: 16, overflow: 'hidden', flexDirection: 'row', borderWidth: 2, borderColor: 'rgba(255,255,255,0.16)' },
  on: { borderColor: mg.coralHot, boxShadow: '0 0 0 2px rgba(255,92,108,0.35), 0 6px 20px rgba(255,92,108,0.4)' },
  name: { color: mg.muted, fontSize: 14, fontWeight: '600' },
  nameOn: { color: '#fff', fontWeight: '800' },
});
