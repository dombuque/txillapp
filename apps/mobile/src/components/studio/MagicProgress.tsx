import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Sparkles, X } from 'lucide-react-native';
import { MAGIC_PHASES, waveById, type MagicPhase, type WaveId } from '@/lib/studio/magic';
import { CapulanaSwatch } from './CapulanaSwatch';
import { CORAL_GRADIENT, MagicBackdrop, MagicRound, MagicTag, mg } from './MagicUi';

/**
 * O ecrã «a montar»: o pano da onda a rodar e as fases a aparecer uma a uma («A ver os teus vídeos…», «A apanhar o
 * ritmo…»). `done` são as fases acabadas e `active` a que está a decorrer; as que ainda não começaram não aparecem.
 */
export function MagicProgress({ wave, active, done, onCancel, topInset = 0 }: { wave: WaveId; active: MagicPhase | null; done: MagicPhase[]; onCancel: () => void; topInset?: number }) {
  const w = waveById(wave);
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }));
    const b = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [spin, pulse]);
  const shown = MAGIC_PHASES.filter((p) => done.includes(p.id) || p.id === active);
  const progress = Math.min(1, (done.length + (active ? 0.5 : 0)) / MAGIC_PHASES.length);
  return (
    <View style={st.root} accessibilityLiveRegion="polite">
      <MagicBackdrop />
      <View style={[st.top, { paddingTop: topInset + 12 }]}>
        <MagicTag hot label={w.name} icon={<Sparkles size={16} color="#fff" />} />
        <MagicRound onPress={onCancel} a11y="Cancelar a montagem"><X size={22} color="#fff" /></MagicRound>
      </View>

      <View style={st.center}>
        <View style={st.emblemBox}>
          <Animated.View style={[st.halo, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.08] }) }] }]} />
          <Animated.View style={[st.emblem, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['45deg', '405deg'] }) }] }]}>
            <CapulanaSwatch spec={{ ...w.pano, seed: 1 }} tile={64} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.3)']} style={StyleSheet.absoluteFill} />
          </Animated.View>
          <View style={st.core}>
            <LinearGradient colors={CORAL_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <View><Sparkles size={34} color="#fff" strokeWidth={2.2} /></View>
          </View>
        </View>

        <Text style={st.title} accessibilityRole="header">A montar a tua tcheka</Text>
        <Text style={st.sub}>Só uns segundos. Fica tudo no teu telemóvel.</Text>

        <View style={st.list}>
          {shown.map((p) => {
            const ok = done.includes(p.id);
            return (
              <View key={p.id} style={st.row}>
                {ok ? (
                  <View style={st.dotDone}><Check size={16} color="#fff" strokeWidth={3} /></View>
                ) : (
                  <Animated.View style={[st.dotLive, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }]} />
                )}
                <Text style={[st.rowText, ok && st.rowDone]} numberOfLines={1}>{ok ? p.done : p.label}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={st.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
        <View style={[st.fill, { width: `${Math.round(progress * 100)}%` }]}>
          <LinearGradient colors={CORAL_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: mg.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 30 },
  emblemBox: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,92,108,0.3)', boxShadow: '0 0 80px rgba(255,92,108,0.75)' },
  emblem: { width: 148, height: 148, borderRadius: 30, overflow: 'hidden', borderWidth: 3, borderColor: '#fff', boxShadow: mg.shadow },
  core: { position: 'absolute', width: 76, height: 76, borderRadius: 38, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' },
  title: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.3, marginTop: 26, textAlign: 'center' },
  sub: { color: mg.muted, fontSize: 15, lineHeight: 21, marginTop: 6, textAlign: 'center' },
  list: { alignSelf: 'stretch', marginTop: 26, gap: 8, minHeight: 5 * 52 },
  row: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, borderRadius: 22, backgroundColor: mg.glass, borderWidth: 1, borderColor: mg.line },
  rowText: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 },
  rowDone: { color: mg.muted, fontWeight: '600' },
  dotDone: { width: 26, height: 26, borderRadius: 13, backgroundColor: mg.coral, alignItems: 'center', justifyContent: 'center' },
  dotLive: { width: 14, height: 14, borderRadius: 7, marginHorizontal: 6, backgroundColor: mg.coralHot, boxShadow: '0 0 12px rgba(255,92,108,0.9)' },
  track: { height: 6, marginHorizontal: 24, marginBottom: 34, borderRadius: 3, backgroundColor: mg.glassHi, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, overflow: 'hidden' },
});
