import { Music2, X } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import type { Track } from '@/lib/api.music';
import { MAX_FADE_S, MAX_SFX, SFX, VOICE_FX, type SfxId, type VoiceFxId } from '@/lib/studio/audioDsp';
import type { StartSuggestion, StudioMix, Template, VoiceTake } from '@/lib/studio/audioMix';
import type { MusicAnalysis } from '@/lib/studio/nativeAudio';
import { fmtS } from '@/lib/tchekaRules';
import { RangeSlider } from '../../RangeSlider';
import { AudioTemplates } from '../AudioTemplates';
import { NativeVoice, type VoiceCtl } from './NativeVoice';
import { playSfx } from './usePreviewAudio';

const CORAL = '#d6334f';
type Sub = 'musica' | 'mistura' | 'voz' | 'efeitos' | 'moldes';
const SUBS: { id: Sub; label: string }[] = [{ id: 'musica', label: 'Música' }, { id: 'mistura', label: 'Mistura' }, { id: 'voz', label: 'Voz-off' }, { id: 'efeitos', label: 'Efeitos' }, { id: 'moldes', label: 'Moldes' }];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A onda da música inteira com a janela do trecho (do tamanho da tcheka): arrastar a janela muda onde a música começa. */
function Wave({ analysis, startMs, windowS, onMove, onCommit, disabled }: { analysis: MusicAnalysis; startMs: number; windowS: number; onMove: (ms: number) => void; onCommit: (ms: number) => void; disabled: boolean }) {
  const [w, setW] = useState(0);
  const dur = Math.max(1, analysis.duration);
  const bars = useMemo(() => {
    const n = Math.max(20, Math.floor(w / 4));
    const src = analysis.peaks;
    return Array.from({ length: n }, (_, i) => { let m = 0; const a = Math.floor((i / n) * src.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * src.length)); for (let k = a; k < b; k++) m = Math.max(m, src[k] ?? 0); return m; });
  }, [analysis.peaks, w]);
  const winW = Math.min(w, (Math.min(windowS, dur) / dur) * w);
  const left = (startMs / 1000 / dur) * w;
  const base = useRef(0);
  const dx = useRef(0);
  const clampMs = (ms: number) => Math.round(Math.max(0, Math.min((dur - Math.min(windowS, dur)) * 1000, ms)));
  const pan = usePanGesture({
    runOnJS: true, minDistance: 2,
    onBegin: () => { base.current = startMs; dx.current = 0; },
    onUpdate: (e) => { dx.current = e.translationX; if (!disabled && w > 0) onMove(clampMs(base.current + (e.translationX / w) * dur * 1000)); },
    onFinalize: () => { if (!disabled && w > 0 && dx.current !== 0) onCommit(clampMs(base.current + (dx.current / w) * dur * 1000)); },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={st.wave} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} accessibilityRole="adjustable" accessibilityLabel="Trecho da música" accessibilityValue={{ text: `começa aos ${mmss(startMs / 1000)}` }}>
        <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', alignItems: 'center', gap: 1 }]} pointerEvents="none">
          {bars.map((v, i) => {
            const x = (i / bars.length) * w;
            const inside = x >= left && x <= left + winW;
            return <View key={i} style={{ flex: 1, height: Math.max(2, v * 48), borderRadius: 1, backgroundColor: inside ? '#fff' : 'rgba(255,255,255,0.3)' }} />;
          })}
        </View>
        {w > 0 ? <View pointerEvents="none" style={[st.window, { left, width: Math.max(12, winW) }]} /> : null}
      </View>
    </GestureDetector>
  );
}

function Chip({ label, on, onPress, disabled, coral }: { label: string; on?: boolean; onPress: () => void; disabled?: boolean; coral?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[st.chip, on && st.chipOn, coral && st.chipCoral, disabled && { opacity: 0.4 }]} accessibilityRole="button" accessibilityState={{ selected: !!on, disabled: !!disabled }}>
      <Text style={[st.chipText, on && !coral && { color: '#111' }]}>{label}</Text>
    </Pressable>
  );
}
function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <View style={st.slider}>
      <View style={st.sliderHead}><Text style={st.label}>{label}</Text><Text style={st.value}>{format(value)}</Text></View>
      <RangeSlider label={label} value={value} min={min} max={max} step={step} format={format} onChange={onChange} />
    </View>
  );
}

export interface ClipSound { key: string; label: string; on: boolean; volume: number; hasAudio?: boolean }

/**
 * O separador «Som» no telemóvel: a música e o trecho pela onda (a onda lê-se do MP3; sem ela, escolhe-se pelo tempo), a
 * mistura (o som dos vídeos e de cada vídeo, a música, os fades, o ducking e os efeitos sonoros), a voz-off, os efeitos de voz
 * e sonoros, e os moldes de ritmo. Os efeitos de voz preparam-se no servidor e ouvem-se aqui (useVoicePreview); os sonoros já se ouvem logo.
 */
export function NativeSoundPanel(p: {
  music: Track | null;
  duet: boolean;
  photosOnly: boolean;
  analysis: MusicAnalysis | null;
  analyzing: boolean;
  suggestion: StartSuggestion | null;
  mix: StudioMix;
  setMix: (fn: (m: StudioMix) => StudioMix, coalesce?: string) => void;
  /** O trecho a mexer (sem passo) e a largar (um passo, e a pré-visualização volta a tocar dali). */
  onStartMove: (ms: number) => void;
  onStartCommit: (ms: number) => void;
  total: number;
  playT: number;
  hasVideo: boolean;
  origVol: number;
  setOrigVol: (v: number) => void;
  musicVol: number;
  setMusicVol: (v: number) => void;
  clipSounds: ClipSound[];
  onClipSound: (key: string, v: { on?: boolean; volume?: number }) => void;
  onPickMusic: () => void;
  onRemoveMusic: () => void;
  canFit: boolean;
  fitNote: string;
  onFit: () => void;
  onTemplate: (t: Template) => void;
  applied: string | null;
  voiceCtl: VoiceCtl;
  onVoice: (t: VoiceTake | null) => void;
  locked: boolean;
  /** Os efeitos de voz a preparar: a carregar (o botão diz «A preparar o efeito…») e a nota quando não deu. */
  fxState?: { voice: { loading: boolean; note: string | null }; orig: { loading: boolean; note: string | null } };
  /** Escolher outra vez um efeito volta a tentar os que falharam. */
  onFxRetry?: () => void;
}) {
  const [sub, setSub] = useState<Sub>('musica');
  const { mix, locked } = p;
  const voice = mix.voice;
  const dur = p.analysis?.duration ?? (p.music?.durationMs ? p.music.durationMs / 1000 : 0);
  const addSfx = (id: SfxId) => {
    if (locked || mix.sfx.length >= MAX_SFX) return;
    const at = Math.round(Math.max(0, Math.min(p.total, p.playT)) * 1000) / 1000;
    p.setMix((m) => ({ ...m, sfx: [...m.sfx, { key: `${id}-${Date.now().toString(36)}-${Math.round(Math.random() * 1e5)}`, id, at }] }));
    playSfx(id, mix.sfxVolume);
  };
  const fxRow = (label: string, value: VoiceFxId, on: (id: VoiceFxId) => void, state?: { loading: boolean; note: string | null }) => (
    <View style={{ marginTop: 8 }}>
      <Text style={[st.label, { paddingHorizontal: 16 }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.rowScroll}>
        {VOICE_FX.map((f) => <Chip key={f.id} label={value === f.id && f.id !== 'normal' && state?.loading ? 'A preparar o efeito…' : f.name} on={value === f.id} onPress={() => { if (value === f.id) p.onFxRetry?.(); on(f.id); }} disabled={locked} />)}
      </ScrollView>
      {value !== 'normal' && state?.note ? <Text style={[st.note, { marginTop: 4 }]} accessibilityLiveRegion="polite">{state.note}</Text> : null}
    </View>
  );
  return (
    <View style={{ paddingBottom: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.subs} accessibilityRole="tablist">
        {SUBS.map((s) => (
          <Pressable key={s.id} onPress={() => setSub(s.id)} style={[st.sub, sub === s.id && st.subOn]} accessibilityRole="tab" accessibilityState={{ selected: sub === s.id }}>
            <Text style={[st.subText, sub === s.id && { color: '#fff' }]}>{s.label}</Text>
            {s.id === 'voz' && voice ? <View style={st.badge} /> : null}
          </Pressable>
        ))}
      </ScrollView>

      {sub === 'musica' ? (
        <>
          <View style={st.musicRow}>
            <Music2 size={20} color="#fff" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.title} numberOfLines={1}>{p.music ? p.music.title : p.duet ? 'Som do dueto' : 'Sem música'}</Text>
              <Text style={st.sub2} numberOfLines={1}>{p.music ? p.music.artist || 'Toca em ciclo' : p.photosOnly ? 'Só com fotos, escolhe uma música' : 'Fica o som dos vídeos'}</Text>
            </View>
            <Chip label={p.music ? 'Trocar' : 'Escolher'} onPress={p.onPickMusic} disabled={locked} />
            {p.music ? <Pressable onPress={p.onRemoveMusic} disabled={locked} style={st.x} accessibilityRole="button" accessibilityLabel="Tirar a música"><X size={18} color="#fff" /></Pressable> : null}
          </View>
          {p.music && p.music.kind !== 'sound' ? (
            p.analysis ? (
              <>
                <Text style={[st.note, { marginTop: 8 }]}>Arrasta a janela para escolher o trecho · começa aos {mmss(mix.musicStartMs / 1000)}</Text>
                <View style={{ paddingHorizontal: 16 }}>
                  <Wave analysis={p.analysis} startMs={mix.musicStartMs} windowS={Math.max(1, p.total)} onMove={p.onStartMove} onCommit={p.onStartCommit} disabled={locked} />
                </View>
              </>
            ) : p.analyzing ? <Text style={[st.note, { marginTop: 8 }]}>A ler a música…</Text> : dur > p.total + 1 ? (
              <>
                <Text style={[st.note, { marginTop: 8 }]}>Esta música não mostra a onda: escolhe o trecho pelo tempo.</Text>
                <Slider label="Começa aos" value={Math.round(mix.musicStartMs / 1000)} min={0} max={Math.max(1, Math.floor(dur - p.total))} step={1} format={(v) => mmss(v)} onChange={(v) => p.onStartCommit(v * 1000)} />
              </>
            ) : null
          ) : null}
          {p.music ? (
            <View style={st.rowWrap}>
              {p.suggestion ? <Chip label={`${p.suggestion.label} · ${mmss(p.suggestion.start)}`} on={Math.abs(mix.musicStartMs - p.suggestion.start * 1000) < 60} onPress={() => p.onStartCommit(Math.round(p.suggestion!.start * 1000))} disabled={locked} /> : null}
              <Chip label="Do início" on={mix.musicStartMs === 0} onPress={() => p.onStartCommit(0)} disabled={locked} />
              <Chip label="Ajustar ao ritmo" coral onPress={p.onFit} disabled={locked || !p.canFit} />
            </View>
          ) : null}
          {p.music ? <Text style={st.note}>{p.fitNote}</Text> : null}
        </>
      ) : null}

      {sub === 'mistura' ? (
        <>
          {p.hasVideo ? <Slider label="Som dos vídeos" value={Math.round(p.origVol * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => p.setOrigVol(v / 100)} /> : null}
          {p.clipSounds.map((c) => (
            <View key={c.key} style={st.clipSound}>
              <View style={st.sliderHead}>
                <Text style={st.label}>{c.label}{c.hasAudio === false ? ' · sem som' : ''}</Text>
                <Chip label={c.on ? 'Ligado' : 'Calado'} on={c.on && c.hasAudio !== false} onPress={() => p.onClipSound(c.key, { on: !c.on })} disabled={locked || c.hasAudio === false} />
              </View>
              {c.on && c.hasAudio !== false ? <RangeSlider label={`Volume: ${c.label}`} value={Math.round(c.volume * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => p.onClipSound(c.key, { volume: v / 100 })} /> : null}
            </View>
          ))}
          {p.music || p.duet ? <Slider label={p.duet && !p.music ? 'Som do original' : 'Música'} value={Math.round(p.musicVol * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => p.setMusicVol(v / 100)} /> : null}
          {p.music ? (
            <>
              <Slider label="Fade de entrada" value={mix.fadeIn} min={0} max={MAX_FADE_S} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => p.setMix((m) => ({ ...m, fadeIn: v }), 'fade-in')} />
              <Slider label="Fade de saída" value={mix.fadeOut} min={0} max={MAX_FADE_S} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => p.setMix((m) => ({ ...m, fadeOut: v }), 'fade-out')} />
            </>
          ) : null}
          {p.music && voice ? (
            <View style={st.rowWrap}>
              <Chip label={mix.ducking ? 'Baixar a música quando falas: sim' : 'Baixar a música quando falas: não'} on={mix.ducking} onPress={() => p.setMix((m) => ({ ...m, ducking: !m.ducking }))} disabled={locked} />
            </View>
          ) : null}
          {mix.sfx.length ? <Slider label="Efeitos sonoros" value={Math.round(mix.sfxVolume * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => p.setMix((m) => ({ ...m, sfxVolume: v / 100 }), 'sfx-vol')} /> : null}
          {voice ? <Slider label="Voz-off" value={Math.round(voice.volume * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => p.setMix((m) => (m.voice ? { ...m, voice: { ...m.voice, volume: v / 100 } } : m), 'voice-vol')} /> : null}
          {!p.hasVideo && !p.music && !voice ? <Text style={st.note}>Ainda não há som: escolhe uma música, grava uma voz-off ou junta um vídeo com som.</Text> : null}
        </>
      ) : null}

      {sub === 'voz' ? (
        <NativeVoice ctl={p.voiceCtl} take={voice} onTake={(t) => p.onVoice(t)} onVolume={(v) => p.setMix((m) => (m.voice ? { ...m, voice: { ...m.voice, volume: v } } : m), 'voice-vol')} onDelete={() => p.onVoice(null)} locked={locked} />
      ) : null}

      {sub === 'efeitos' ? (
        <>
          {voice ? fxRow('Efeito na voz-off', voice.fx, (id) => p.setMix((m) => (m.voice ? { ...m, voice: { ...m.voice, fx: id } } : m)), p.fxState?.voice) : null}
          {p.hasVideo ? fxRow('Efeito no som original', mix.origFx, (id) => p.setMix((m) => ({ ...m, origFx: id })), p.fxState?.orig) : null}
          {voice || p.hasVideo ? <Text style={st.note}>O efeito prepara-se no servidor e ouve-se aqui ao tocar (a primeira vez demora uns segundos).</Text> : null}
          <View style={[st.sliderHead, { paddingHorizontal: 16, marginTop: 10 }]}>
            <Text style={st.label}>Efeitos sonoros</Text>
            <Text style={st.note2}>Toca para pôr aos {fmtS(Math.min(p.total, Math.max(0, p.playT)))} s</Text>
          </View>
          <View style={st.grid}>
            {SFX.map((s) => (
              <Pressable key={s.id} onPress={() => addSfx(s.id)} disabled={locked || mix.sfx.length >= MAX_SFX} style={({ pressed }) => [st.pad, pressed && st.padOn]} accessibilityRole="button" accessibilityLabel={`Pôr o efeito ${s.name} aqui`}>
                <Text style={st.padText}>{s.name}</Text>
              </Pressable>
            ))}
          </View>
          {mix.sfx.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.rowScroll}>
              {[...mix.sfx].sort((a, b) => a.at - b.at).map((s) => (
                <View key={s.key} style={st.cue}>
                  <Text style={st.chipText}>{SFX.find((x) => x.id === s.id)?.name} · {fmtS(s.at)} s</Text>
                  <Pressable onPress={() => p.setMix((m) => ({ ...m, sfx: m.sfx.filter((x) => x.key !== s.key) }))} disabled={locked} hitSlop={10} accessibilityRole="button" accessibilityLabel="Tirar este efeito"><X size={16} color="#fff" /></Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}
        </>
      ) : null}

      {sub === 'moldes' ? (
        <AudioTemplates applied={p.applied} onApply={p.onTemplate} onFit={p.onFit} canFit={p.canFit} fitNote={p.fitNote} hasMusic={!!p.music} disabled={locked} />
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  subs: { gap: 6, paddingHorizontal: 16, paddingTop: 8 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, borderRadius: 12, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  subOn: { backgroundColor: 'rgba(214,51,79,0.22)', borderColor: CORAL },
  subText: { color: 'rgba(255,255,255,0.72)', fontSize: 14, fontWeight: '800' },
  badge: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffd60a' },
  musicRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 8 },
  title: { color: '#fff', fontWeight: '800', fontSize: 15 },
  sub2: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  x: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  wave: { height: 56, marginTop: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
  window: { position: 'absolute', top: 2, bottom: 2, borderRadius: 10, borderWidth: 2, borderColor: CORAL, backgroundColor: 'rgba(214,51,79,0.18)' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, marginTop: 8 },
  rowScroll: { gap: 6, paddingHorizontal: 16, paddingTop: 6 },
  chip: { minHeight: 44, borderRadius: 22, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  chipOn: { backgroundColor: '#fff' },
  chipCoral: { backgroundColor: CORAL },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  note: { color: 'rgba(255,255,255,0.6)', fontSize: 14, paddingHorizontal: 16, marginTop: 6 },
  note2: { color: 'rgba(255,255,255,0.55)', fontSize: 14 },
  slider: { paddingHorizontal: 16, marginTop: 8 },
  sliderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '800' },
  value: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  clipSound: { marginHorizontal: 16, marginTop: 8, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: 'rgba(255,255,255,0.12)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginTop: 6 },
  pad: { width: '22%', flexGrow: 1, minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  padOn: { backgroundColor: 'rgba(214,51,79,0.35)', borderColor: CORAL },
  padText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  cue: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderRadius: 22, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.1)' },
});
