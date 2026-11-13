import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Music2, ShieldCheck, Sparkles, X } from 'lucide-react-native';
import { WAVES, waveById, type WaveId } from '@/lib/studio/magic';
import { CapulanaSwatch } from './CapulanaSwatch';
import { MagicBackdrop, MagicCta, MagicRound, MagicTag, mg } from './MagicUi';

/**
 * O primeiro ecrã da «Montagem mágica»: as 6 ondas em cartões (cada uma com o pano e as cores dela), o que a onda escolhida
 * faz e o botão para montar. `privacy`: a frase de privacidade por baixo do botão (por omissão, tudo no telemóvel).
 */
export function MagicWaves({ value, onChange, onStart, onClose, photos, videos, musicTitle, bottomInset = 0, topInset = 0, privacy }: {
  value: WaveId;
  onChange: (id: WaveId) => void;
  onStart: () => void;
  onClose: () => void;
  photos: number;
  videos: number;
  /** O nome da música ou do som escolhido (sem música, a montagem faz-se a 120 BPM). */
  musicTitle?: string | null;
  bottomInset?: number;
  topInset?: number;
  privacy?: string;
}) {
  const wave = waveById(value);
  const count = [photos ? `${photos} ${photos === 1 ? 'foto' : 'fotos'}` : '', videos ? `${videos} ${videos === 1 ? 'vídeo' : 'vídeos'}` : ''].filter(Boolean).join(' e ');
  return (
    <View style={st.root}>
      <MagicBackdrop />
      <ScrollView contentContainerStyle={{ paddingTop: topInset + 12, paddingBottom: 168 + bottomInset, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        <View style={st.head}>
          <View style={{ flex: 1 }}>
            <View style={st.titleRow}>
              <Sparkles size={26} color={mg.coralHot} strokeWidth={2.4} />
              <Text style={st.title} accessibilityRole="header">Montagem mágica</Text>
            </View>
            <Text style={st.sub}>Escolhe a onda. Nós cortamos, pomos por ordem e acertamos tudo no ritmo.</Text>
          </View>
          <MagicRound onPress={onClose} a11y="Fechar a montagem mágica"><X size={22} color="#fff" /></MagicRound>
        </View>

        <View style={st.tags}>
          {count ? <MagicTag label={count} /> : null}
          <MagicTag hot={!!musicTitle} icon={<Music2 size={16} color="#fff" />} label={musicTitle || 'Sem música: ritmo de 120 BPM'} />
        </View>

        <View style={st.grid} accessibilityRole="radiogroup">
          {WAVES.map((w) => {
            const on = w.id === value;
            return (
              <Pressable
                key={w.id}
                onPress={() => onChange(w.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${w.name}. ${w.mood}`}
                testID={`onda-${w.id}`}
                style={({ pressed }) => [st.card, on && st.cardOn, pressed && { transform: [{ scale: 0.97 }] }]}
              >
                <CapulanaSwatch spec={{ ...w.pano, seed: 1 }} tile={58} style={StyleSheet.absoluteFill} />
                <LinearGradient colors={[`${w.colors[0]}26`, `${w.colors[1]}e6`, w.colors[1]]} locations={[0, 0.5, 0.82]} style={StyleSheet.absoluteFill} />
                <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)']} locations={[0.4, 1]} style={StyleSheet.absoluteFill} />
                {on ? <View style={st.check}><Check size={18} color="#fff" strokeWidth={3} /></View> : null}
                <View style={st.cardText}>
                  <Text style={st.cardName} numberOfLines={2}>{w.name}</Text>
                  <Text style={st.cardMood} numberOfLines={2}>{w.mood}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={st.recipe}>
          <Text style={st.recipeTitle}>{wave.name}</Text>
          <Text style={st.recipeText}>{wave.recipe}.</Text>
          <Text style={st.recipeText}>Abre com «{wave.openers[0]}» (podes mudar depois).</Text>
        </View>
      </ScrollView>

      <View style={[st.bar, { paddingBottom: 16 + bottomInset }]}>
        <LinearGradient pointerEvents="none" colors={['rgba(8,8,12,0)', 'rgba(8,8,12,0.96)', mg.bg]} locations={[0, 0.2, 1]} style={StyleSheet.absoluteFill} />
        <MagicCta label="Montar a tcheka" onPress={onStart} icon={<Sparkles size={22} color="#fff" strokeWidth={2.4} />} testID="montar" a11y={`Montar a tcheka na onda ${wave.name}`} />
        <View style={st.private}>
          <ShieldCheck size={16} color={mg.muted} />
          <Text style={st.privateText}>{privacy ?? 'Tudo acontece no teu telemóvel. Nada é enviado.'}</Text>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: mg.bg },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: -0.4 },
  sub: { color: mg.muted, fontSize: 16, lineHeight: 22, marginTop: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  card: { width: '47.9%', flexGrow: 1, height: 172, borderRadius: mg.radius, overflow: 'hidden', backgroundColor: mg.panel, borderWidth: 1, borderColor: mg.line, justifyContent: 'flex-end' },
  cardOn: { borderColor: mg.coralHot, boxShadow: mg.glow },
  cardText: { padding: 14, gap: 3 },
  cardName: { color: '#fff', fontSize: 18, lineHeight: 22, fontWeight: '900', letterSpacing: -0.2 },
  cardMood: { color: 'rgba(255,255,255,0.9)', fontSize: 14, lineHeight: 18, fontWeight: '500' },
  check: { position: 'absolute', top: 10, right: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: mg.coralHot, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  recipe: { marginTop: 16, padding: 16, borderRadius: mg.radius, backgroundColor: mg.glass, borderWidth: 1, borderColor: mg.line, gap: 4 },
  recipeTitle: { color: mg.coralHot, fontSize: 15, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  recipeText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 34, gap: 10 },
  private: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  privateText: { color: mg.muted, fontSize: 14, flexShrink: 1, textAlign: 'center' },
});
