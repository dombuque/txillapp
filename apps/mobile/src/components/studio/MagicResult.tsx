import { createElement, useState, type ReactNode } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, Film, Lock, LockOpen, Pause, Play, Shuffle, SlidersHorizontal, Sparkles } from 'lucide-react-native';
import { waveById, type MagicClip, type MagicResult as Result } from '@/lib/studio/magic';
import { MagicPreview } from './MagicPreview';
import { MagicBackdrop, MagicCta, MagicRound, MagicTag, mg } from './MagicUi';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const fmt = (s: number) => (Math.round(s * 10) / 10).toString().replace('.', ',');

function Thumb({ clip }: { clip: MagicClip }) {
  if (Platform.OS === 'web') {
    const fit = { width: '100%', height: '100%', objectFit: 'cover', display: 'block', objectPosition: `${Math.round((clip.fx?.focus?.x ?? 0.5) * 100)}% ${Math.round((clip.fx?.focus?.y ?? 0.5) * 100)}%` };
    return clip.video
      ? dom('video', { src: `${clip.uri}#t=${Math.max(0.1, clip.trim.start).toFixed(2)}`, muted: true, playsInline: true, preload: 'metadata', style: fit })
      : dom('img', { src: clip.uri, alt: '', style: fit });
  }
  if (clip.video) return <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: mg.panel }]}><Film size={26} color={mg.muted} /></View>;
  return <Image source={{ uri: clip.uri }} resizeMode="cover" style={StyleSheet.absoluteFill} />;
}

/**
 * O resultado da montagem mágica: a tcheka a tocar, os clipes pela ordem (cada um com o cadeado para o trancar) e os
 * botões «Outra versão» (outra montagem, sem mexer nos trancados) e «Afinar» (abre na linha do tempo do estúdio).
 */
export function MagicResult({ result, musicUrl, locked, onToggleLock, onAnother, onTune, onBack, busy, topInset = 0, bottomInset = 0 }: {
  result: Result;
  musicUrl?: string | null;
  locked: string[];
  onToggleLock: (key: string) => void;
  onAnother: () => void;
  onTune: () => void;
  /** Voltar às ondas. */
  onBack: () => void;
  /** A fazer outra versão (os botões esperam). */
  busy?: boolean;
  topInset?: number;
  bottomInset?: number;
}) {
  const [playing, setPlaying] = useState(true);
  const [now, setNow] = useState(0);
  const wave = waveById(result.wave);
  const cuts = Math.max(0, result.clips.length - 1);
  return (
    <View style={st.root}>
      <MagicBackdrop />
      <View style={[st.top, { paddingTop: topInset + 10 }]}>
        <MagicRound onPress={onBack} a11y="Escolher outra onda"><ChevronLeft size={24} color="#fff" /></MagicRound>
        <View style={{ flex: 1 }}>
          <Text style={st.title} accessibilityRole="header" numberOfLines={1}>A tua tcheka está pronta</Text>
          <Text style={st.sub} numberOfLines={1}>{wave.name}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 150 + bottomInset }} showsVerticalScrollIndicator={false}>
        <View style={st.stage}>
          <View style={st.frame}>
            <MagicPreview result={result} playing={playing && !busy} musicUrl={musicUrl} onClip={setNow} style={{ width: '100%' }} />
            <Pressable onPress={() => setPlaying((p) => !p)} accessibilityRole="button" accessibilityLabel={playing ? 'Pausar a pré-visualização' : 'Tocar a pré-visualização'} style={StyleSheet.absoluteFill}>
              {!playing ? <View style={st.playBig}><Play size={34} color="#fff" fill="#fff" /></View> : null}
            </Pressable>
            <View style={st.playSmall} pointerEvents="box-none">
              <MagicRound onPress={() => setPlaying((p) => !p)} a11y={playing ? 'Pausar' : 'Tocar'} size={48}>
                {playing ? <Pause size={22} color="#fff" fill="#fff" /> : <Play size={22} color="#fff" fill="#fff" />}
              </MagicRound>
            </View>
          </View>
          <View style={st.side}>
            <MagicTag hot icon={<Sparkles size={16} color="#fff" />} label={`${fmt(result.total)} s`} />
            <MagicTag label={`${cuts} ${cuts === 1 ? 'corte' : 'cortes'}`} />
            {result.music ? <MagicTag label={`${Math.round(result.music.bpm)} BPM`} /> : null}
            <Text style={st.sideNote}>Cortes ao ritmo{result.left.length ? `. ${result.left.length} ${result.left.length === 1 ? 'ficheiro não coube' : 'ficheiros não couberam'} nos 60 s` : ''}.</Text>
          </View>
        </View>

        <Text style={st.section}>A história, plano a plano</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
          {result.clips.map((c, i) => {
            const isLocked = locked.includes(c.key);
            const live = i === now;
            return (
              <View key={c.key} style={st.clipCol}>
                <View style={[st.clip, live && st.clipLive, isLocked && st.clipLocked]}>
                  <Thumb clip={c} />
                  <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
                  <Text style={st.clipIndex}>{i + 1}</Text>
                  <Text style={st.clipDur}>{fmt(result.durations[i])} s</Text>
                  <Pressable
                    onPress={() => onToggleLock(c.key)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: isLocked }}
                    accessibilityLabel={`${isLocked ? 'Destrancar' : 'Trancar'} o plano ${i + 1}`}
                    testID={`trancar-${i}`}
                    style={st.lockHit}
                  >
                    <View style={[st.lock, isLocked && st.lockOn]}>{isLocked ? <Lock size={18} color="#fff" strokeWidth={2.6} /> : <LockOpen size={18} color="#fff" strokeWidth={2.2} />}</View>
                  </Pressable>
                </View>
                <Text style={[st.why, live && { color: '#fff' }]} numberOfLines={3}>{result.story[i]?.why}</Text>
              </View>
            );
          })}
        </ScrollView>
        <Text style={st.hint}>Tranca os planos de que gostas: «Outra versão» só muda os outros.</Text>
      </ScrollView>

      <View style={[st.bar, { paddingBottom: 16 + bottomInset }]}>
        <LinearGradient pointerEvents="none" colors={['rgba(8,8,12,0)', 'rgba(8,8,12,0.96)', mg.bg]} locations={[0, 0.2, 1]} style={StyleSheet.absoluteFill} />
        <MagicCta kind="glass" label="Outra versão" onPress={onAnother} disabled={busy} icon={<Shuffle size={20} color="#fff" strokeWidth={2.4} />} style={{ flex: 1.3 }} testID="outra-versao" a11y="Outra versão da montagem" />
        <MagicCta label="Afinar" onPress={onTune} disabled={busy} icon={<SlidersHorizontal size={20} color="#fff" strokeWidth={2.4} />} style={{ flex: 1 }} testID="afinar" a11y="Afinar na linha do tempo" />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: mg.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  title: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  sub: { color: mg.coralHot, fontSize: 15, fontWeight: '700', marginTop: 1 },
  stage: { flexDirection: 'row', gap: 14, paddingHorizontal: 16, alignItems: 'stretch' },
  frame: { width: '62%', borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: mg.line, backgroundColor: '#000', boxShadow: '0 18px 50px rgba(0,0,0,0.6), 0 0 44px rgba(255,92,108,0.2)' },
  playBig: { position: 'absolute', alignSelf: 'center', top: '42%', width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: mg.line },
  playSmall: { position: 'absolute', left: 10, bottom: 10 },
  side: { flex: 1, gap: 8, alignItems: 'flex-start', paddingTop: 4 },
  sideNote: { color: mg.muted, fontSize: 14, lineHeight: 19, marginTop: 4 },
  section: { color: '#fff', fontSize: 17, fontWeight: '800', marginTop: 20, marginBottom: 10, paddingHorizontal: 16 },
  clipCol: { width: 104 },
  clip: { width: 104, height: 150, borderRadius: 16, overflow: 'hidden', backgroundColor: mg.panel, borderWidth: 2, borderColor: 'rgba(255,255,255,0.14)' },
  clipLive: { borderColor: '#fff' },
  clipLocked: { borderColor: mg.coralHot, boxShadow: '0 0 18px rgba(255,92,108,0.55)' },
  clipIndex: { position: 'absolute', left: 9, top: 7, color: '#fff', fontSize: 16, fontWeight: '900' },
  clipDur: { position: 'absolute', left: 9, bottom: 7, color: '#fff', fontSize: 14, fontWeight: '800' },
  lockHit: { position: 'absolute', right: 0, top: 0, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  lock: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  lockOn: { backgroundColor: mg.coral, borderColor: '#fff' },
  why: { color: mg.muted, fontSize: 14, lineHeight: 18, marginTop: 6 },
  hint: { color: mg.muted, fontSize: 14, lineHeight: 19, paddingHorizontal: 16, marginTop: 14 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 34 },
});
