import { createElement, useEffect, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RangeSlider } from '@/components/RangeSlider';
import { Icon, type IconName } from '@/components/Icon';
import { MAX_FADE_S } from '@/lib/studio/audioDsp';
import { meterLevel } from '@/lib/studio/audioEngine';
import { fmtS } from '@/lib/tchekaRules';
import { colors } from '@/lib/theme';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;

export interface MixChannel {
  /** 'orig', 'music', 'voice', 'sfx' ou `clip:<chave>` (o som de um vídeo). */
  id: string;
  label: string;
  icon: IconName;
  value: number;
  onChange: (v: number) => void;
  /** O medidor deste canal (o AnalyserNode, depois do volume). */
  meter: () => AnalyserNode | null;
  note?: string | null;
  /** Ligado ou calado à parte do volume (o som de um vídeo): o botão alterna isto em vez de pôr o volume a 0. */
  on?: boolean;
  onToggle?: () => void;
  /** Uma linha por baixo de outra (os vídeos, por baixo do som dos vídeos): sem medidor. */
  sub?: boolean;
}

/** O medidor de nível: uma barra fina a mexer com o som (sem estado React: o desenho é direto, a 30 por segundo). */
function Meter({ get }: { get: () => AnalyserNode | null }) {
  const bar = useRef<HTMLDivElement | null>(null);
  const peak = useRef<HTMLDivElement | null>(null);
  const getRef = useRef(get);
  getRef.current = get;
  useEffect(() => {
    let raf = 0, hold = 0, holdAt = 0, last = 0;
    const scratch = new Float32Array(1024);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 33) return;
      last = now;
      const a = getRef.current();
      const v = a ? meterLevel(a, scratch) : 0;
      if (v >= hold || now - holdAt > 900) { hold = v; holdAt = now; }
      if (bar.current) bar.current.style.transform = `scaleX(${v.toFixed(3)})`;
      if (peak.current) peak.current.style.left = `${(hold * 100).toFixed(1)}%`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return dom('div', { 'aria-hidden': true, style: { position: 'relative', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', margin: '2px 14px 0' } },
    dom('div', { ref: (el: HTMLDivElement | null) => { bar.current = el; }, style: { position: 'absolute', inset: 0, transformOrigin: 'left center', transform: 'scaleX(0)', background: 'linear-gradient(90deg, #2dd4bf 0%, #a3e635 60%, #facc15 82%, #d6334f 100%)', borderRadius: 2 } }),
    dom('div', { ref: (el: HTMLDivElement | null) => { peak.current = el; }, style: { position: 'absolute', top: 0, bottom: 0, width: 2, left: '0%', background: '#fff', opacity: 0.8 } }),
  );
}

/**
 * O misturador: uma barra por canal (som original, música, voz-off e efeitos sonoros), cada uma com o seu medidor de nível,
 * os fades da música (0 a 3 s) e o «ducking» (a música baixa sozinha quando há voz-off).
 */
export function AudioMixer({ channels, fadeIn, fadeOut, onFade, ducking, onDucking, hasMusic, hasVoice }: {
  channels: MixChannel[];
  fadeIn: number;
  fadeOut: number;
  onFade: (which: 'in' | 'out', v: number, commit: boolean) => void;
  ducking: boolean;
  onDucking: (on: boolean) => void;
  hasMusic: boolean;
  hasVoice: boolean;
}) {
  return (
    <View style={{ paddingBottom: 4 }}>
      <View style={st.card}>
        {channels.map((c) => {
          const on = c.on ?? c.value > 0;
          return (
            <View key={c.id} style={[st.strip, c.sub && st.stripSub]}>
              <View style={st.stripHead}>
                <View style={[st.dot, { backgroundColor: on && c.value > 0 ? colors.brand : 'rgba(255,255,255,0.25)' }]}><Icon name={c.icon} size={13} color="#fff" strokeWidth={2.2} /></View>
                <Text style={st.name} numberOfLines={1}>{c.label}</Text>
                {c.note ? <Text style={st.note} numberOfLines={1}>{c.note}</Text> : null}
                <Text style={st.val}>{on ? `${Math.round(c.value * 100)}%` : 'calado'}</Text>
                <Pressable onPress={() => (c.onToggle ? c.onToggle() : c.onChange(c.value > 0 ? 0 : 1))} style={st.mute} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={on ? `Calar: ${c.label}` : `Ligar: ${c.label}`}>
                  <Icon name={on ? 'volume' : 'volume-off'} size={18} color={on ? '#fff' : 'rgba(255,255,255,0.5)'} />
                </Pressable>
              </View>
              <View style={[st.fader, !on && { opacity: 0.45 }]}>
                <RangeSlider label={`Volume: ${c.label}`} value={Math.round(c.value * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => c.onChange(v / 100)} />
              </View>
              {c.sub ? null : <Meter get={c.meter} />}
            </View>
          );
        })}
        {!channels.length ? <Text style={st.empty}>Ainda não há som: escolhe uma música, grava uma voz-off ou junta um vídeo com som.</Text> : null}
      </View>

      {hasMusic ? (
        <View style={st.card}>
          <Text style={st.cardTitle}>Fades da música</Text>
          <View style={st.fadeRow}>
            <Text style={st.fadeLabel}>Entrada</Text>
            <View style={{ flex: 1 }}>
              <RangeSlider label="Fade-in da música" value={fadeIn} min={0} max={MAX_FADE_S} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => onFade('in', v, false)} onCommit={(v) => onFade('in', v, true)} />
            </View>
            <Text style={st.fadeVal}>{fmtS(fadeIn)} s</Text>
          </View>
          <View style={st.fadeRow}>
            <Text style={st.fadeLabel}>Saída</Text>
            <View style={{ flex: 1 }}>
              <RangeSlider label="Fade-out da música" value={fadeOut} min={0} max={MAX_FADE_S} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => onFade('out', v, false)} onCommit={(v) => onFade('out', v, true)} />
            </View>
            <Text style={st.fadeVal}>{fmtS(fadeOut)} s</Text>
          </View>
          {hasVoice ? (
            <Pressable onPress={() => onDucking(!ducking)} style={[st.toggle, ducking && st.toggleOn]} accessibilityRole="switch" accessibilityState={{ checked: ducking }} accessibilityLabel="Baixar a música quando há voz-off">
              <View style={[st.knobTrack, ducking && { backgroundColor: colors.brand }]}><View style={[st.knob, ducking && { transform: [{ translateX: 16 }] }]} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.toggleText}>Baixar a música quando falas</Text>
                <Text style={st.toggleSub}>Ducking automático: a música desce uns 10 dB por baixo da voz-off</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingVertical: 8 },
  cardTitle: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', paddingHorizontal: 14, paddingBottom: 2 },
  strip: { paddingTop: 4, paddingBottom: 8 },
  stripSub: { marginLeft: 18, borderLeftWidth: 2, borderLeftColor: 'rgba(255,255,255,0.1)' },
  // A barra tem 48 de zona de toque; o desenho fica mais junto ao nome e ao medidor.
  fader: { marginTop: -6, marginBottom: -10 },
  stripHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  name: { color: '#fff', fontSize: 14, fontWeight: '800', flexShrink: 1 },
  note: { color: 'rgba(255,255,255,0.55)', fontSize: 14, flexShrink: 1 },
  val: { marginLeft: 'auto', color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  mute: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  empty: { color: 'rgba(255,255,255,0.6)', fontSize: 14, paddingHorizontal: 14, paddingVertical: 6 },
  fadeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  fadeLabel: { color: '#fff', fontSize: 14, fontWeight: '700', width: 58 },
  fadeVal: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '700', width: 40, textAlign: 'right', fontVariant: ['tabular-nums'] },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 10, marginTop: 4, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  toggleOn: { backgroundColor: 'rgba(214,51,79,0.12)' },
  knobTrack: { width: 38, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.2)', padding: 3 },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
  toggleText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  toggleSub: { color: 'rgba(255,255,255,0.55)', fontSize: 14 },
});
