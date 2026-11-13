import { Copy, Gauge, Replace, Scissors, Timer, Trash2, Volume2, VolumeX } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COMPOSE_SPEEDS } from '@/lib/studio/composeRequest';
import type { ProjectClip } from '@/lib/studio/project';
import { fmtS, speedLabel } from '@/lib/tchekaRules';
import { RangeSlider } from '../../RangeSlider';

const PHOTO_SECONDS = [1, 2, 3, 5, 8] as const;
const PHOTO_BEATS = [1, 2, 4] as const;
const HOT = '#ff5c6c';

function Btn({ label, icon, onPress, disabled, on, danger }: { label: string; icon: ReactNode; onPress: () => void; disabled?: boolean; on?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [st.btn, on && st.btnOn, disabled && { opacity: 0.35 }, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected: !!on }}>
      {icon}
      <Text style={[st.btnText, danger && { color: '#fecaca' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[st.chip, on && st.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[st.chipText, on && { color: '#111' }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A barra do clipe escolhido na linha do tempo (sempre à vista por baixo dela): Dividir no cursor, Duplicar, Velocidade (nos
 * vídeos, as quatro que a montagem aceita: 0,5×, 1×, 2× e 3×) ou Duração (nas fotos, ou as batidas ao ritmo), o som do vídeo,
 * Substituir e Apagar.
 */
export function NativeClipActions({ clip, duration, rhythm, locked, onSplit, onDuplicate, onSpeed, onPhoto, onSound, onReplace, onDelete }: {
  clip: ProjectClip | null;
  duration: number;
  rhythm: boolean;
  locked: boolean;
  onSplit: () => void;
  onDuplicate: () => void;
  onSpeed: (s: number) => void;
  onPhoto: (p: { seconds?: number; beats?: number }) => void;
  onSound: (v: { on?: boolean; volume?: number }) => void;
  onReplace: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState<'tempo' | 'som' | null>(null);
  const off = locked || !clip;
  if (!clip) return <Text style={st.hint}>Toca num clipe da linha do tempo para o cortar, dividir ou mudar.</Text>;
  const soundOn = clip.sound !== false;
  // Um vídeo sem som não tem «Som do vídeo» para ligar ou calar.
  const mute = clip.video && clip.hasAudio === false;
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row} keyboardShouldPersistTaps="handled">
        <Btn label="Dividir" icon={<Scissors size={20} color="#fff" />} onPress={onSplit} disabled={off} />
        <Btn label="Duplicar" icon={<Copy size={20} color="#fff" />} onPress={onDuplicate} disabled={off} />
        {clip.video ? (
          <Btn label={`Velocidade ${speedLabel(clip.speed)}`} icon={<Gauge size={20} color="#fff" />} onPress={() => setOpen((o) => (o === 'tempo' ? null : 'tempo'))} on={open === 'tempo'} disabled={off} />
        ) : (
          <Btn label={`Duração ${fmtS(duration)} s`} icon={<Timer size={20} color="#fff" />} onPress={() => setOpen((o) => (o === 'tempo' ? null : 'tempo'))} on={open === 'tempo'} disabled={off} />
        )}
        {clip.video ? (
          <Btn label={mute ? 'Sem som' : soundOn ? 'Som do vídeo' : 'Calado'} icon={soundOn && !mute ? <Volume2 size={20} color="#fff" /> : <VolumeX size={20} color="#fff" />} onPress={() => setOpen((o) => (o === 'som' ? null : 'som'))} on={open === 'som' && !mute} disabled={off || mute} />
        ) : null}
        <Btn label="Substituir" icon={<Replace size={20} color="#fff" />} onPress={onReplace} disabled={off} />
        <Btn label="Apagar" icon={<Trash2 size={20} color="#fecaca" />} onPress={onDelete} disabled={off} danger />
      </ScrollView>
      {open === 'tempo' ? (
        <View style={st.panel}>
          {clip.video ? (
            COMPOSE_SPEEDS.map((s) => <Chip key={s} label={speedLabel(s)} on={clip.speed === s} onPress={() => onSpeed(s)} />)
          ) : rhythm ? (
            <>
              <Text style={st.label}>Batidas</Text>
              {PHOTO_BEATS.map((b) => <Chip key={b} label={`${b}`} on={clip.beats === b} onPress={() => onPhoto({ beats: b })} />)}
            </>
          ) : (
            PHOTO_SECONDS.map((s) => <Chip key={s} label={`${s} s`} on={Math.abs(clip.seconds - s) < 0.01} onPress={() => onPhoto({ seconds: s })} />)
          )}
        </View>
      ) : null}
      {open === 'som' && clip.video && !mute ? (
        <View style={[st.panel, { flexDirection: 'column', alignItems: 'stretch' }]}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Chip label="Ligado" on={soundOn} onPress={() => onSound({ on: true })} />
            <Chip label="Calado" on={!soundOn} onPress={() => onSound({ on: false })} />
            {clip.hasAudio === false ? <Text style={st.hint2}>Este vídeo não tem som</Text> : null}
          </View>
          {soundOn ? <RangeSlider label="Volume deste vídeo" value={Math.round((clip.volume ?? 1) * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => onSound({ volume: v / 100 })} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { gap: 6, paddingHorizontal: 10, alignItems: 'center' },
  btn: { minHeight: 48, minWidth: 64, paddingHorizontal: 10, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: 'rgba(255,255,255,0.07)' },
  btnOn: { backgroundColor: 'rgba(255,92,108,0.22)', borderWidth: 1, borderColor: HOT },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  panel: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 6 },
  chip: { minHeight: 44, minWidth: 52, borderRadius: 22, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  chipOn: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '800', marginRight: 4 },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  hint2: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
});
