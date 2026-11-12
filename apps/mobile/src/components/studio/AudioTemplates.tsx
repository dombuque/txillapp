import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { TEMPLATES, type Template } from '@/lib/studio/audioMix';
import { colors } from '@/lib/theme';

const CORAL = colors.brand;
const TRANSITION: Record<Template['transition'], string> = { none: 'seco', fade: 'fundir', slide: 'deslizar' };
const START: Record<Template['start'], string> = { forte: 'refrão', subida: 'subida', calmo: 'parte calma', inicio: 'início' };

/** O desenho do ritmo de um molde: uma barra por corte, com a largura da duração. */
function Pattern({ t, on }: { t: Template; on: boolean }) {
  const sum = t.pattern.reduce((a, b) => a + b, 0);
  return (
    <View style={st.pattern} aria-hidden>
      {t.pattern.map((p, i) => (
        <View key={i} style={[st.cut, { flexGrow: p / sum, backgroundColor: on ? (i % 2 ? '#ff8a9c' : CORAL) : i % 2 ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.55)' }, t.transition === 'fade' && { opacity: 0.9, borderRadius: 6 }]} />
      ))}
    </View>
  );
}

/**
 * Os moldes de ritmo: um toque aplica às fotos e aos clipes de agora a duração dos cortes (nas batidas), a transição, o
 * trecho da música e os fades. «Ajustar ao ritmo» encaixa só os cortes nas batidas do trecho escolhido.
 */
export function AudioTemplates({ applied, onApply, onFit, canFit, fitNote, hasMusic, disabled }: {
  applied: string | null;
  onApply: (t: Template) => void;
  onFit: () => void;
  canFit: boolean;
  fitNote: string;
  hasMusic: boolean;
  disabled: boolean;
}) {
  return (
    <View style={{ paddingBottom: 6 }}>
      <Pressable onPress={onFit} disabled={disabled || !canFit} style={({ pressed }) => [st.fit, (!canFit || disabled) && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button" accessibilityLabel="Ajustar ao ritmo" accessibilityHint={fitNote}>
        <View style={st.fitIcon}><Icon name="waves" size={18} color="#fff" strokeWidth={2.2} /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.fitText}>Ajustar ao ritmo</Text>
          <Text style={st.fitSub} numberOfLines={2}>{fitNote}</Text>
        </View>
        <Icon name="bolt" size={18} color="#ffd60a" strokeWidth={2.2} />
      </Pressable>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row} accessibilityLabel="Moldes de ritmo">
        {TEMPLATES.map((t) => {
          const on = applied === t.id;
          return (
            <Pressable key={t.id} onPress={() => onApply(t)} disabled={disabled} style={({ pressed }) => [st.card, on && st.cardOn, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Molde ${t.name}: ${t.desc}`}>
              <View style={st.cardHead}>
                <Text style={st.name}>{t.name}</Text>
                {on ? <Icon name="check" size={14} color="#fff" strokeWidth={3} /> : null}
              </View>
              <Pattern t={t} on={on} />
              <Text style={st.desc} numberOfLines={2}>{t.desc}</Text>
              <Text style={st.meta} numberOfLines={1}>
                {hasMusic ? `${t.photoBeats} ${t.photoBeats === 1 ? 'batida' : 'batidas'}` : `${t.photoSeconds} s`} · {TRANSITION[t.transition]}{hasMusic ? ` · ${START[t.start]}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  fit: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 8, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(214,51,79,0.14)', borderWidth: 1, borderColor: 'rgba(214,51,79,0.5)' },
  fitIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: CORAL, alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 16px rgba(214,51,79,0.6)' },
  fitText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  fitSub: { color: 'rgba(255,255,255,0.65)', fontSize: 12 },
  row: { gap: 10, paddingHorizontal: 16, marginTop: 10 },
  card: { width: 150, borderRadius: 16, padding: 12, gap: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  cardOn: { borderColor: CORAL, backgroundColor: 'rgba(214,51,79,0.16)', boxShadow: '0 0 22px rgba(214,51,79,0.4)' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { color: '#fff', fontSize: 15, fontWeight: '900' },
  pattern: { flexDirection: 'row', gap: 3, height: 14 },
  cut: { height: 14, borderRadius: 3 },
  desc: { color: 'rgba(255,255,255,0.72)', fontSize: 12, minHeight: 32 },
  meta: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '700' },
});
