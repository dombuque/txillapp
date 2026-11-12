import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Frame, RectangleHorizontal, Type } from 'lucide-react-native';
import type { CapulanaSpec } from '@/lib/studio/capulana';
import { CAPULANA_SHAPES, CAPULANA_TRANSITIONS, type CapulanaShapeId, type CapulanaTransitionId } from '@/lib/studio/capulanaShapes';
import { CapulanaPicker } from './CapulanaPicker';
import { CapulanaSticker } from './CapulanaSticker';
import { mg } from './MagicUi';

/**
 * O painel «Capulana» do estúdio: escolhe-se o pano e onde ele entra (na transição para o clipe escolhido, na moldura da
 * foto, numa faixa de texto, nas letras ou num sticker). O painel não guarda nada: diz ao estúdio o que a pessoa escolheu.
 */
export function CapulanaPanel({ pano, onPano, transition, onTransition, frame, onFrame, canFrame, onBand, onText, onSticker }: {
  pano: CapulanaSpec;
  onPano: (v: CapulanaSpec) => void;
  /** A transição de capulana do clipe escolhido (null = não tem) e a escolha (null tira-a). */
  transition: CapulanaTransitionId | null;
  onTransition: (id: CapulanaTransitionId | null) => void;
  /** A moldura do clipe escolhido; `canFrame` é falso nos vídeos e sem clipe escolhido. */
  frame: boolean;
  onFrame: (on: boolean) => void;
  canFrame: boolean;
  onBand: () => void;
  onText: () => void;
  onSticker: (shape: CapulanaShapeId) => void;
}) {
  return (
    <View style={{ gap: 18, paddingVertical: 12 }}>
      <CapulanaPicker value={pano} onChange={onPano} />

      <View>
        <Text style={st.label}>Transição de pano</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row} accessibilityRole="radiogroup">
          {CAPULANA_TRANSITIONS.map((t) => {
            const on = t.id === transition;
            return (
              <Pressable key={t.id} onPress={() => onTransition(on ? null : t.id)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${t.name}. ${t.mood}`} testID={`transicao-${t.id}`} style={({ pressed }) => [st.chip, on && st.chipOn, pressed && { transform: [{ scale: 0.96 }] }]}>
                <Text style={st.chipText}>{t.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={st.actions}>
        <Action icon={<Frame size={22} color="#fff" />} label={frame ? 'Tirar a moldura' : 'Moldura de pano'} sub="A foto inteira, sem fundo desfocado" on={frame} disabled={!canFrame} onPress={() => onFrame(!frame)} testID="moldura" />
        <Action icon={<RectangleHorizontal size={22} color="#fff" />} label="Faixa de texto" sub="Uma barra de pano com o teu texto" onPress={onBand} testID="faixa" />
        <Action icon={<Type size={22} color="#fff" />} label="Letras de pano" sub="O texto cheio com o padrão" onPress={onText} testID="letras" />
      </View>

      <View>
        <Text style={st.label}>Stickers de pano</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row}>
          {CAPULANA_SHAPES.map((s) => (
            <Pressable key={s.id} onPress={() => onSticker(s.id)} accessibilityRole="button" accessibilityLabel={`Sticker ${s.name}`} testID={`sticker-${s.id}`} style={({ pressed }) => [st.sticker, pressed && { transform: [{ scale: 0.94 }] }]}>
              <CapulanaSticker shape={s.id} spec={pano} size={72} />
              <Text style={st.stickerName} numberOfLines={1}>{s.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function Action({ icon, label, sub, onPress, on, disabled, testID }: { icon: React.ReactNode; label: string; sub: string; onPress: () => void; on?: boolean; disabled?: boolean; testID?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={sub} accessibilityState={{ disabled: !!disabled, selected: !!on }} style={({ pressed }) => [st.action, on && st.chipOn, disabled && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.98 }] }]}>
      <View style={[st.actionIcon, on && { backgroundColor: mg.coral }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={st.actionLabel} numberOfLines={1}>{label}</Text>
        <Text style={st.actionSub} numberOfLines={1}>{sub}</Text>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  label: { color: mg.muted, fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 16, marginBottom: 8 },
  row: { paddingHorizontal: 16, gap: 10, alignItems: 'flex-start' },
  chip: { height: 48, paddingHorizontal: 18, borderRadius: 24, justifyContent: 'center', backgroundColor: mg.glass, borderWidth: 1, borderColor: mg.line },
  chipOn: { backgroundColor: mg.coralSoft, borderColor: mg.coralHot },
  chipText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  actions: { paddingHorizontal: 16, gap: 10 },
  action: { minHeight: 64, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: mg.glass, borderWidth: 1, borderColor: mg.line },
  actionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: mg.glassHi, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { color: '#fff', fontSize: 16, fontWeight: '800' },
  actionSub: { color: mg.muted, fontSize: 14, marginTop: 1 },
  sticker: { width: 84, alignItems: 'center', gap: 4, paddingVertical: 4 },
  stickerName: { color: mg.muted, fontSize: 14, fontWeight: '600' },
});
