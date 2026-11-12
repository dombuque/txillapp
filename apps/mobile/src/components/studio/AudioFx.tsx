import { createElement, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { MAX_SFX, SFX, synthSfx, VOICE_FX, type SfxId, type VoiceFxId } from '@/lib/studio/audioDsp';
import { peaks, type PlacedSfx } from '@/lib/studio/audioMix';
import { fmtS } from '@/lib/tchekaRules';
import { colors } from '@/lib/theme';
import { drawPeaks } from './AudioVoice';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const CORAL = colors.brand;

/** A forma de onda pequena de cada efeito sonoro (a do próprio som gerado). */
const SFX_PEAKS: Record<string, number[]> = {};
const sfxPeaks = (id: SfxId) => (SFX_PEAKS[id] ??= peaks(synthSfx(id, 8000), 28));

function Pad({ id, name, onPress, disabled }: { id: SfxId; name: string; onPress: () => void; disabled: boolean }) {
  const c = useRef<HTMLCanvasElement | null>(null);
  const data = useMemo(() => sfxPeaks(id), [id]);
  useEffect(() => { drawPeaks(c.current, data, 'rgba(255,255,255,0.85)', { bar: 2, gap: 1 }); }, [data]);
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [st.pad, pressed && st.padOn]} accessibilityRole="button" accessibilityLabel={`Pôr o efeito ${name} aqui`}>
      {dom('canvas', { ref: (el: HTMLCanvasElement | null) => { c.current = el; if (el) requestAnimationFrame(() => drawPeaks(el, data, 'rgba(255,255,255,0.85)', { bar: 2, gap: 1 })); }, style: { width: '100%', height: 20, display: 'block' }, 'aria-hidden': true })}
      <Text style={st.padText} numberOfLines={1}>{name}</Text>
    </Pressable>
  );
}

/**
 * Os efeitos: o efeito de voz da voz-off e o do som original (Normal, Robô, Esquilo, Grave, Eco, Rádio, Estádio) e os
 * efeitos sonoros (tocar num botão põe esse som no instante da pré-visualização e ouve-se logo).
 */
export function AudioFx({ voiceFx, origFx, onVoiceFx, onOrigFx, hasVoice, hasOrig, sfx, onAddSfx, onRemoveSfx, nowLabel, disabled }: {
  voiceFx: VoiceFxId;
  origFx: VoiceFxId;
  onVoiceFx: (id: VoiceFxId) => void;
  onOrigFx: (id: VoiceFxId) => void;
  hasVoice: boolean;
  hasOrig: boolean;
  sfx: PlacedSfx[];
  onAddSfx: (id: SfxId) => void;
  onRemoveSfx: (key: string) => void;
  nowLabel: string;
  disabled: boolean;
}) {
  const fxRow = (label: string, value: VoiceFxId, on: (id: VoiceFxId) => void, a11y: string) => (
    <View style={st.fxBlock}>
      <Text style={st.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.fxRow} accessibilityRole="radiogroup" accessibilityLabel={a11y}>
        {VOICE_FX.map((f) => (
          <Pressable key={f.id} onPress={() => on(f.id)} disabled={disabled} style={[st.fx, value === f.id && st.fxOn]} accessibilityRole="radio" accessibilityState={{ checked: value === f.id }} accessibilityLabel={`${a11y}: ${f.name}`}>
            <Text style={[st.fxText, value === f.id && { color: '#fff' }]}>{f.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
  return (
    <View style={{ paddingBottom: 6 }}>
      {hasVoice ? fxRow('Efeito na voz-off', voiceFx, onVoiceFx, 'Efeito na voz-off') : null}
      {hasOrig ? fxRow('Efeito no som original', origFx, onOrigFx, 'Efeito no som original') : null}
      {!hasVoice && !hasOrig ? <Text style={st.note}>Os efeitos de voz aparecem com uma voz-off ou com vídeos com som.</Text> : null}
      <View style={st.sfxHead}>
        <Text style={st.label}>Efeitos sonoros</Text>
        <Text style={st.note2}>Toca para pôr aos {nowLabel}</Text>
      </View>
      <View style={st.grid}>
        {SFX.map((s) => <Pad key={s.id} id={s.id} name={s.name} disabled={disabled || sfx.length >= MAX_SFX} onPress={() => onAddSfx(s.id)} />)}
      </View>
      {sfx.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.placed}>
          {[...sfx].sort((a, b) => a.at - b.at).map((s) => (
            <View key={s.key} style={st.cue}>
              <View style={st.cueDot} />
              <Text style={st.cueText}>{SFX.find((x) => x.id === s.id)?.name} · {fmtS(s.at)} s</Text>
              <Pressable onPress={() => onRemoveSfx(s.key)} disabled={disabled} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Tirar o efeito ${SFX.find((x) => x.id === s.id)?.name} dos ${fmtS(s.at)} s`}>
                <Icon name="x" size={12} color="#fff" strokeWidth={3} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  fxBlock: { paddingHorizontal: 16, marginTop: 8, gap: 6 },
  fxRow: { gap: 6, paddingRight: 16 },
  fx: { height: 32, borderRadius: 999, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  fxOn: { backgroundColor: 'rgba(214,51,79,0.28)', borderColor: CORAL, boxShadow: '0 0 14px rgba(214,51,79,0.45)' },
  fxText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' },
  note: { color: 'rgba(255,255,255,0.6)', fontSize: 12, paddingHorizontal: 16, marginTop: 8 },
  sfxHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 12 },
  note2: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginTop: 6 },
  pad: { width: '22.6%', flexGrow: 1, height: 58, borderRadius: 14, paddingHorizontal: 8, paddingTop: 9, paddingBottom: 6, justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  padOn: { backgroundColor: 'rgba(214,51,79,0.35)', borderColor: CORAL },
  padText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  placed: { gap: 6, paddingHorizontal: 16, marginTop: 8 },
  cue: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, borderRadius: 14, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.1)' },
  cueDot: { width: 8, height: 8, borderRadius: 2, transform: [{ rotate: '45deg' }], backgroundColor: '#ffd60a' },
  cueText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
