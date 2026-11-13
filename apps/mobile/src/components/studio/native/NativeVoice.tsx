import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Mic, Square, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { peaks as peaksOf, type Region, type VoiceTake } from '@/lib/studio/audioMix';
import { fmtS, MIN_VOICE_S } from '@/lib/tchekaRules';
import { RangeSlider } from '../../RangeSlider';

const CORAL = '#d6334f';
/** Um bocado com voz: acima de -38 dB (o medidor do gravador), em blocos de 0,1 s; falhas de menos de 0,35 s juntam-se. */
export function regionsFromLevels(levels: number[], step = 0.1, thrDb = -38): Region[] {
  const out: Region[] = [];
  let open: Region | null = null;
  levels.forEach((db, i) => {
    const t = i * step;
    if (db > thrDb) {
      if (open && t - open.end <= 0.35) open.end = t + step;
      else { if (open) out.push(open); open = { start: t, end: t + step }; }
    }
  });
  if (open) out.push(open);
  return out.map((r) => ({ start: Math.max(0, Math.round((r.start - 0.06) * 1000) / 1000), end: Math.round((r.end + 0.06) * 1000) / 1000 }));
}

export interface VoiceCtl {
  /** Onde está a pré-visualização (s) e quanto dura a tcheka. */
  nowT: () => number;
  total: number;
  /** Toca a pré-visualização a partir de `at`, sem a voz-off antiga (para se gravar por cima). */
  playForVoice: (at: number) => void;
  stop: () => void;
}

/**
 * A voz-off no telemóvel: contagem 3-2-1, grava por cima da pré-visualização a tocar (a voz antiga calada) e pára no fim da
 * tcheka ou quando se toca outra vez. O microfone só fica aberto enquanto grava. A gravação fica em m4a (AAC), que o servidor
 * aceita para a voz-off (docs/montagem.md, 4-A).
 */
export function NativeVoice({ ctl, take, onTake, onVolume, onDelete, locked }: {
  ctl: VoiceCtl;
  take: VoiceTake | null;
  onTake: (t: VoiceTake) => void;
  onVolume: (v: number) => void;
  onDelete: () => void;
  locked: boolean;
}) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const [phase, setPhase] = useState<'idle' | 'count' | 'rec' | 'saving'>('idle');
  const [count, setCount] = useState(3);
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState('');
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const levels = useRef<number[]>([]);
  const at = useRef(0);
  const stopping = useRef(false);
  const clear = () => { timers.current.forEach(clearInterval); timers.current = []; };
  useEffect(() => () => { clear(); try { void recorder.stop(); } catch { /* não estava a gravar */ } void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    if (locked || phase !== 'idle') return;
    setErr('');
    const p = await requestRecordingPermissionsAsync().catch(() => null);
    if (!p?.granted) { setErr('Sem licença para o microfone. Ativa-a nas definições do telemóvel.'); return; }
    let n = 3;
    setCount(n);
    setPhase('count');
    void Haptics.selectionAsync().catch(() => undefined);
    const iv = setInterval(() => {
      n -= 1;
      if (n > 0) { setCount(n); void Haptics.selectionAsync().catch(() => undefined); return; }
      clearInterval(iv);
      void begin();
    }, 1000);
    timers.current.push(iv);
  }

  async function begin() {
    try {
      const from = ctl.nowT() >= ctl.total - 0.5 ? 0 : ctl.nowT();
      at.current = Math.round(from * 1000) / 1000;
      levels.current = [];
      stopping.current = false;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      ctl.playForVoice(from);
      setSecs(0);
      setPhase('rec');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      const iv = setInterval(() => {
        try {
          const s = recorder.getStatus();
          const db = typeof s.metering === 'number' ? s.metering : -60;
          levels.current.push(db);
          setLevel(Math.max(0, Math.min(1, (db + 60) / 60)));
          const el = (s.durationMillis ?? 0) / 1000;
          setSecs(el);
          if (at.current + el >= ctl.total - 0.05) void finish();
        } catch { /* a arrancar */ }
      }, 100);
      timers.current.push(iv);
    } catch {
      setPhase('idle');
      setErr('Não consegui abrir o microfone.');
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  }

  async function finish() {
    if (stopping.current) return;
    stopping.current = true;
    clear();
    ctl.stop();
    setPhase('saving');
    try {
      const status = recorder.getStatus();
      await recorder.stop();
      const uri = recorder.uri;
      const duration = Math.max(0, Math.min(ctl.total - at.current, (status.durationMillis ?? secs * 1000) / 1000));
      if (!uri || duration < 0.5) { setErr('A gravação ficou curta demais. Tenta outra vez.'); return; }
      const lin = levels.current.map((db) => Math.pow(10, Math.max(-60, db) / 20));
      onTake({
        id: `voz-${Date.now().toString(36)}`, at: at.current, duration: Math.round(duration * 1000) / 1000, volume: take?.volume ?? 1, fx: take?.fx ?? 'normal',
        regions: regionsFromLevels(levels.current), peaks: peaksOf(lin, Math.max(8, Math.min(240, Math.round(duration * 20)))), uri, mime: 'audio/mp4',
      });
    } catch {
      setErr('Não consegui guardar a gravação.');
    } finally {
      setPhase('idle');
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  }

  const busy = phase !== 'idle';
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
      <Pressable
        onPress={() => (phase === 'rec' ? void finish() : phase === 'idle' ? void start() : undefined)}
        disabled={locked || phase === 'saving' || phase === 'count'}
        style={({ pressed }) => [st.rec, phase === 'rec' && st.recOn, (locked || phase === 'saving') && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.97 }] }]}
        accessibilityRole="button"
        accessibilityLabel={phase === 'rec' ? 'Parar de gravar' : take ? 'Gravar a voz-off outra vez' : 'Gravar a voz-off'}
      >
        {phase === 'rec' ? <Square size={20} color="#fff" fill="#fff" /> : <Mic size={22} color="#fff" />}
        <Text style={st.recText}>
          {phase === 'count' ? `A gravar daqui a ${count}…` : phase === 'rec' ? `A gravar · ${fmtS(secs)} s · toca para parar` : phase === 'saving' ? 'A guardar…' : take ? 'Gravar outra vez' : 'Gravar a voz-off'}
        </Text>
      </Pressable>
      {phase === 'count' ? <Text style={st.count} accessibilityLiveRegion="assertive">{count}</Text> : null}
      {phase === 'rec' ? <View style={st.meter}><View style={[st.meterFill, { width: `${Math.round(level * 100)}%` }]} /></View> : null}
      {!busy ? <Text style={st.note}>A gravação começa onde está a pré-visualização e vai até ao fim da tcheka (ou até tocares outra vez). Com {MIN_VOICE_S} s ou mais, a voz-off conta como o som da tcheka.</Text> : null}
      {take && !busy ? (
        <View style={st.card}>
          <View style={st.wave}>
            {take.peaks.map((v, i) => <View key={i} style={[st.bar, { height: Math.max(2, v * 34) }]} />)}
          </View>
          <Text style={st.note}>Dos {fmtS(take.at)} aos {fmtS(take.at + take.duration)} s · muda o sítio na linha do tempo</Text>
          <RangeSlider label="Volume da voz-off" value={Math.round(take.volume * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => onVolume(v / 100)} />
          <Pressable onPress={onDelete} disabled={locked} style={st.del} accessibilityRole="button" accessibilityLabel="Apagar a voz-off">
            <Trash2 size={18} color="#fecaca" />
            <Text style={[st.recText, { color: '#fecaca' }]}>Apagar a voz-off</Text>
          </Pressable>
        </View>
      ) : null}
      {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  rec: { minHeight: 52, borderRadius: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: CORAL, paddingHorizontal: 18 },
  recOn: { backgroundColor: '#b91c1c' },
  recText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  count: { color: '#fff', fontSize: 56, fontWeight: '900', textAlign: 'center' },
  meter: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  meterFill: { height: 6, backgroundColor: '#a3e635' },
  note: { color: 'rgba(255,255,255,0.62)', fontSize: 14 },
  card: { borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', padding: 12, gap: 6 },
  wave: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 1 },
  bar: { flex: 1, borderRadius: 1, backgroundColor: CORAL },
  del: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: 12, borderRadius: 22, backgroundColor: 'rgba(220,38,38,0.16)' },
  err: { color: '#fecaca', fontSize: 14 },
});
