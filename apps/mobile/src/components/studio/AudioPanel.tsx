import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import type { Track } from '@/lib/api.music';
import { SFX, type SfxId, type VoiceFxId } from '@/lib/studio/audioDsp';
import { auditionSfx, createScrubber, type MixSchedule, type StudioGraph } from '@/lib/studio/audioEngine';
import { defaultMix, type StartSuggestion, type StudioMix, type Template, type VoiceTake } from '@/lib/studio/audioMix';
import { fmtS } from '@/lib/tchekaRules';
import { colors } from '@/lib/theme';
import { AudioFx } from './AudioFx';
import { AudioMixer, type MixChannel } from './AudioMixer';
import { AudioTemplates } from './AudioTemplates';
import { AudioVoice, type VoiceCtl } from './AudioVoice';
import { AudioWave, useMusicAnalysis, type MusicAnalysis } from './AudioWave';

const CORAL = colors.brand;
const mmss = (s: number) => { const v = Math.max(0, Math.floor(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };

/** O que o painel do som precisa do estúdio. */
export interface StudioAudioCtl extends VoiceCtl {
  isPlaying(): boolean;
  /** A música já descodificada (a mesma do estúdio). */
  musicBuffer(): Promise<AudioBuffer | null>;
  /** A volta que está a tocar (para pôr ou tirar efeitos sonoros sem recomeçar). */
  schedule(): MixSchedule | null;
  /** Recomeça a pré-visualização em `at` quando a mudança chegar (a tocar se `play`). */
  restartAt(at: number, play?: boolean): void;
}

/**
 * O estado do som do estúdio: o trecho (com a sugestão automática enquanto ninguém mexer), os fades, o ducking, a voz-off,
 * os efeitos e a análise da música. `onTiming` corre antes de cada mudança que obriga a recomeçar a pré-visualização.
 */
export function useStudioAudio(o: { music: Track | null; total: number; load: () => Promise<AudioBuffer | null>; onTiming: () => void }) {
  const [mix, setMix] = useState<StudioMix>(defaultMix);
  const mixRef = useRef(mix);
  mixRef.current = mix;
  const totalRef = useRef(o.total);
  totalRef.current = o.total;
  const timing = useRef(o.onTiming);
  timing.current = o.onTiming;
  const url = o.music?.url ?? null;
  // Sons de outra tcheka começam sempre no 0 (são para dobrar); as músicas têm o trecho sugerido.
  const auto = !!o.music && o.music.kind !== 'sound';
  const autoRef = useRef(auto);
  autoRef.current = auto;
  /** Muda o som; com `restart`, a pré-visualização recomeça do ponto onde está. */
  const update = (fn: (m: StudioMix) => StudioMix, restart = false) => { if (restart) timing.current(); setMix((m) => fn(m)); };
  const suggestFor = (a: MusicAnalysis, w: number) => (a.duration >= w + 4 ? a.suggest(w) : null);
  const applySuggestion = (a: MusicAnalysis) => {
    if (!autoRef.current || !mixRef.current.musicStartAuto) return;
    const s = suggestFor(a, Math.max(3, totalRef.current));
    const ms = s ? Math.round(s.start * 1000) : 0;
    if (ms !== mixRef.current.musicStartMs) update((m) => ({ ...m, musicStartMs: ms }), true);
  };
  // Outra música: o trecho volta ao início (e à sugestão quando a análise chegar).
  const prevUrl = useRef(url);
  useEffect(() => {
    if (prevUrl.current === url) return;
    prevUrl.current = url;
    setMix((m) => ({ ...m, musicStartMs: 0, musicStartAuto: true }));
  }, [url]);
  const analysis = useMusicAnalysis(url, o.load, applySuggestion);
  // Enquanto o trecho é o sugerido, acompanha a duração da tcheka (com folga, para não saltar a cada toque).
  const lastW = useRef(o.total);
  useEffect(() => {
    if (!analysis || Math.abs(o.total - lastW.current) < 2) return;
    const id = setTimeout(() => { lastW.current = o.total; applySuggestion(analysis); }, 700);
    return () => clearTimeout(id);
  }, [o.total, analysis]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggestion: StartSuggestion | null = analysis && auto ? suggestFor(analysis, Math.max(3, o.total)) : null;
  return { mix, update, analysis, suggestion };
}

type Sub = 'trecho' | 'mistura' | 'voz' | 'efeitos' | 'moldes';
const SUBS: { id: Sub; label: string; icon: IconName }[] = [
  { id: 'trecho', label: 'Trecho', icon: 'waves' },
  { id: 'mistura', label: 'Mistura', icon: 'sliders' },
  { id: 'voz', label: 'Voz-off', icon: 'mic' },
  { id: 'efeitos', label: 'Efeitos', icon: 'sparkles' },
  { id: 'moldes', label: 'Moldes', icon: 'grid' },
];
let lastSub: Sub | null = null;

/**
 * O separador «Som» do estúdio, como numa mesa de mistura: o trecho da música pela onda, o misturador (volumes, fades e
 * ducking), a voz-off, os efeitos (de voz e sonoros) e os moldes de ritmo. Fica dentro da caixa que a montagem bloqueia.
 */
export function AudioPanel(p: {
  ctl: StudioAudioCtl;
  mix: StudioMix;
  update: (fn: (m: StudioMix) => StudioMix, restart?: boolean) => void;
  analysis: MusicAnalysis | null;
  suggestion: StartSuggestion | null;
  music: Track | null;
  duet: boolean;
  total: number;
  playT: number;
  playing: boolean;
  hasVideo: boolean;
  origNote: string | null;
  origVol: number;
  setOrigVol: (v: number) => void;
  musicVol: number;
  setMusicVol: (v: number) => void;
  canFit: boolean;
  fitNote: string;
  onFit: () => void;
  onTemplate: (t: Template) => void;
  applied: string | null;
  locked: boolean;
}) {
  const { ctl, mix, update, music, locked } = p;
  const [sub, setSub] = useState<Sub>(() => lastSub ?? (music ? 'trecho' : 'mistura'));
  useEffect(() => { lastSub = sub; }, [sub]);
  const scrub = useRef<ReturnType<typeof createScrubber> | null>(null);
  const resumeAfterScrub = useRef(false);
  const scrubAt = useRef({ at: -1, when: 0 });

  const graph = (): StudioGraph | null => ctl.graph();
  const onScrub = (s: number) => {
    const g = graph();
    if (!g || !p.analysis) return;
    if (scrubAt.current.at < 0) { resumeAfterScrub.current = ctl.isPlaying(); if (ctl.isPlaying()) ctl.pause(); }
    // Recomeça o bocado a ouvir quando se mexe mais de 0,25 s (e no máximo 6 vezes por segundo).
    const now = performance.now();
    if (Math.abs(s - scrubAt.current.at) < 0.25 || now - scrubAt.current.when < 160) return;
    scrubAt.current = { at: s, when: now };
    void ctl.musicBuffer().then((buf) => { if (buf) (scrub.current ??= createScrubber(g.ac)).play(buf, s, p.musicVol); });
  };
  const onScrubEnd = () => { scrub.current?.stop(); scrubAt.current = { at: -1, when: 0 }; };
  useEffect(() => () => scrub.current?.stop(), []);
  const commitStart = (ms: number) => {
    // Depois de escolher o trecho, a tcheka toca desde o início (ouve-se como fica).
    ctl.restartAt(0, true);
    update((m) => ({ ...m, musicStartMs: ms, musicStartAuto: false }));
    resumeAfterScrub.current = false;
  };

  const voice = mix.voice;
  const channels: MixChannel[] = [];
  if (p.hasVideo) channels.push({ id: 'orig', label: 'Som original', icon: 'video', value: p.origVol, onChange: p.setOrigVol, meter: () => graph()?.meters.orig ?? null, note: p.origNote });
  if (music || p.duet) channels.push({ id: 'music', label: music ? 'Música' : 'Som do dueto', icon: 'music', value: p.musicVol, onChange: p.setMusicVol, meter: () => graph()?.meters.music ?? null, note: music ? music.title : null });
  if (voice) channels.push({ id: 'voice', label: 'Voz-off', icon: 'mic', value: voice.volume, onChange: (v) => update((m) => (m.voice ? { ...m, voice: { ...m.voice, volume: v } } : m)), meter: () => graph()?.meters.voice ?? null });
  if (mix.sfx.length) channels.push({ id: 'sfx', label: 'Efeitos sonoros', icon: 'sparkles', value: mix.sfxVolume, onChange: (v) => update((m) => ({ ...m, sfxVolume: v })), meter: () => graph()?.meters.sfx ?? null, note: `${mix.sfx.length}` });

  const addSfx = (id: SfxId) => {
    const at = Math.round(Math.min(Math.max(0, p.total - 0.05), Math.max(0, ctl.nowT())) * 100) / 100;
    const cue = { key: `${id}-${Date.now().toString(36)}-${Math.round(Math.random() * 1e6)}`, id, at };
    update((m) => ({ ...m, sfx: [...m.sfx, cue] }));
    const sched = ctl.isPlaying() ? ctl.schedule() : null;
    if (sched) sched.addSfx(cue);
    else { const g = graph(); if (g) auditionSfx(g.ac, id, mix.sfxVolume); }
  };
  const removeSfx = (key: string) => { ctl.schedule()?.removeSfx(key); update((m) => ({ ...m, sfx: m.sfx.filter((s) => s.key !== key) })); };
  const setFx = (which: 'voice' | 'orig', id: VoiceFxId) => update((m) => (which === 'orig' ? { ...m, origFx: id } : m.voice ? { ...m, voice: { ...m.voice, fx: id } } : m));
  const onTake = (t: VoiceTake) => { ctl.restartAt(t.at, true); update((m) => ({ ...m, voice: t })); };

  return (
    <View style={st.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.subs} accessibilityRole="tablist" accessibilityLabel="Partes do som">
        {SUBS.map((s) => {
          const on = sub === s.id;
          const badge = s.id === 'voz' ? !!voice : s.id === 'efeitos' ? mix.sfx.length > 0 || mix.origFx !== 'normal' || (voice?.fx ?? 'normal') !== 'normal' : false;
          return (
            <Pressable key={s.id} onPress={() => setSub(s.id)} style={[st.sub, on && st.subOn]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={s.label}>
              <Icon name={s.icon} size={15} color={on ? '#fff' : 'rgba(255,255,255,0.7)'} strokeWidth={2.2} />
              <Text style={[st.subText, on && { color: '#fff' }]}>{s.label}</Text>
              {badge ? <View style={st.subBadge} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {sub === 'trecho' ? (
        !music ? (
          <Text style={st.empty}>{p.duet ? 'No dueto, o som é o do original.' : 'Escolhe uma música para escolher o trecho pela onda.'}</Text>
        ) : !p.analysis ? (
          <View style={st.loading}><View style={st.loadBar} /><Text style={st.loadText}>A ler a música…</Text></View>
        ) : (
          <>
            <AudioWave
              analysis={p.analysis}
              startMs={mix.musicStartMs}
              windowS={Math.max(1, p.total)}
              playT={p.playing ? p.playT : null}
              suggestion={p.suggestion}
              onScrub={onScrub}
              onScrubEnd={onScrubEnd}
              onCommit={commitStart}
              disabled={locked}
            />
            <View style={st.row}>
              {p.suggestion ? (
                <Pressable onPress={() => commitStart(Math.round(p.suggestion!.start * 1000))} disabled={locked} style={[st.chip, Math.abs(mix.musicStartMs - p.suggestion.start * 1000) < 60 && st.chipOn]} accessibilityRole="button" accessibilityLabel={`Usar o trecho sugerido: ${p.suggestion.label} aos ${mmss(p.suggestion.start)}`}>
                  <View style={st.star} />
                  <Text style={st.chipText}>{p.suggestion.label} · {mmss(p.suggestion.start)}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => commitStart(0)} disabled={locked} style={[st.chip, mix.musicStartMs === 0 && st.chipOn]} accessibilityRole="button" accessibilityLabel="Começar no início da música"><Text style={st.chipText}>Do início</Text></Pressable>
              <Pressable onPress={p.onFit} disabled={locked || !p.canFit} style={[st.chip, st.chipCoral, !p.canFit && { opacity: 0.45 }]} accessibilityRole="button" accessibilityLabel="Ajustar ao ritmo" accessibilityHint={p.fitNote}>
                <Icon name="bolt" size={14} color="#fff" strokeWidth={2.4} />
                <Text style={st.chipText}>Ajustar ao ritmo</Text>
              </Pressable>
            </View>
          </>
        )
      ) : null}

      {sub === 'mistura' ? (
        <AudioMixer
          channels={channels}
          fadeIn={mix.fadeIn}
          fadeOut={mix.fadeOut}
          onFade={(w, v) => update((m) => ({ ...m, [w === 'in' ? 'fadeIn' : 'fadeOut']: v }))}
          ducking={mix.ducking}
          onDucking={(on) => update((m) => ({ ...m, ducking: on }))}
          hasMusic={!!music}
          hasVoice={!!voice}
        />
      ) : null}

      {sub === 'voz' ? (
        <AudioVoice
          ctl={ctl}
          take={voice}
          onTake={onTake}
          onVolume={(v) => update((m) => (m.voice ? { ...m, voice: { ...m.voice, volume: v } } : m))}
          onDelete={() => { ctl.restartAt(ctl.nowT()); update((m) => ({ ...m, voice: null })); }}
          locked={locked}
        />
      ) : null}

      {sub === 'efeitos' ? (
        <AudioFx
          voiceFx={voice?.fx ?? 'normal'}
          origFx={mix.origFx}
          onVoiceFx={(id) => setFx('voice', id)}
          onOrigFx={(id) => setFx('orig', id)}
          hasVoice={!!voice}
          hasOrig={p.hasVideo}
          sfx={mix.sfx}
          onAddSfx={addSfx}
          onRemoveSfx={removeSfx}
          nowLabel={`${fmtS(Math.min(p.total, Math.max(0, p.playT)))} s`}
          disabled={locked}
        />
      ) : null}

      {sub === 'moldes' ? (
        <AudioTemplates applied={p.applied} onApply={p.onTemplate} onFit={p.onFit} canFit={p.canFit} fitNote={p.fitNote} hasMusic={!!music} disabled={locked} />
      ) : null}
    </View>
  );
}

/** As marcas do som na barra do tempo da pré-visualização: a voz-off (uma faixa) e os efeitos sonoros (losangos). */
export function AudioMarks({ mix, total }: { mix: StudioMix; total: number }) {
  if (!(total > 0)) return null;
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / total) * 100))}%` as `${number}%`;
  const v = mix.voice;
  return (
    <>
      {v ? <View style={[st.voiceBar, { left: pct(v.at), width: pct(Math.min(v.duration, total - v.at)) }]} accessibilityLabel={`Voz-off dos ${fmtS(v.at)} aos ${fmtS(v.at + v.duration)} s`} /> : null}
      {mix.sfx.map((s) => <View key={s.key} style={[st.sfxMark, { left: pct(s.at) }]} accessibilityLabel={`Efeito ${SFX.find((x) => x.id === s.id)?.name} aos ${fmtS(s.at)} s`} />)}
    </>
  );
}

const st = StyleSheet.create({
  // No computador o painel não estica a toda a largura (a onda e as barras ficam do tamanho de um telemóvel grande).
  root: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  subs: { gap: 6, paddingHorizontal: 16, paddingTop: 8 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, borderRadius: 12, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  subOn: { backgroundColor: 'rgba(214,51,79,0.22)', borderColor: CORAL },
  subText: { color: 'rgba(255,255,255,0.72)', fontSize: 13, fontWeight: '800' },
  subBadge: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffd60a', marginLeft: -2 },
  empty: { color: 'rgba(255,255,255,0.65)', fontSize: 13, paddingHorizontal: 16, marginTop: 12 },
  loading: { marginHorizontal: 16, marginTop: 10, gap: 8 },
  loadBar: { height: 70, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  loadText: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, borderRadius: 999, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'transparent' },
  chipOn: { borderColor: '#ffd60a', backgroundColor: 'rgba(255,214,10,0.12)' },
  chipCoral: { backgroundColor: CORAL, boxShadow: '0 0 16px rgba(214,51,79,0.5)' },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  star: { width: 8, height: 8, borderRadius: 2, transform: [{ rotate: '45deg' }], backgroundColor: '#ffd60a' },
  voiceBar: { position: 'absolute', top: -1, height: 6, borderRadius: 3, backgroundColor: 'rgba(214,51,79,0.85)' },
  sfxMark: { position: 'absolute', top: -5, width: 9, height: 9, marginLeft: -4.5, borderRadius: 2, transform: [{ rotate: '45deg' }], backgroundColor: '#ffd60a', borderWidth: 1, borderColor: 'rgba(0,0,0,0.5)' },
});
