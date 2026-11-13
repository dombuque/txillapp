import type React from 'react';
import { Image } from 'expo-image';
import { createVideoPlayer, type VideoThumbnail } from 'expo-video';
import { Minus, Pause, Play, Plus } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import type { ProjectClip, TrimEdge } from '@/lib/studio/project';
import { previewClock } from '@/lib/tchekaRules';
import { clampPps, PPS_DEFAULT, preciseClock, reorderIndex, rulerTicks, snapTime, cutPoints } from '@/lib/studio/timeline';
import type { TimelineLayer } from '../Timeline';
import type { ClockStore } from './clockStore';

const CORAL = '#d6334f';
const HOT = '#ff5c6c';
const CLIP_H = 52;
const LANE_H = 30;
const RULER_H = 22;
const HANDLE_W = 18;
const SLOT = 62;
/** As medidas da faixa: a normal (folha fechada) e a densa (folha aberta: régua de 16, clipes de 48, camadas finas). */
export interface Dims { ruler: number; clip: number; lane: number }
const NORMAL: Dims = { ruler: RULER_H, clip: CLIP_H, lane: LANE_H };
const DENSE: Dims = { ruler: 16, clip: 48, lane: 20 };
const LEAD_W = 64;
const tick = () => void Haptics.selectionAsync().catch(() => undefined);

// ---------------------------------------------------------------- miniaturas dos vídeos

const thumbs = new Map<string, Promise<VideoThumbnail[] | null>>();
const resolved = new Map<string, VideoThumbnail[]>();
/** Uma miniatura já feita de um vídeo, perto do instante `at` (null se ainda não houver): para os painéis. */
export function cachedVideoThumb(uri: string, length: number, at: number): VideoThumbnail | null {
  const t = resolved.get(`${uri}|${Math.round(length * 10)}`);
  if (!t?.length) { void videoThumbs(uri, length); return null; }
  return t[Math.max(0, Math.min(t.length - 1, Math.floor((at / Math.max(0.1, length)) * t.length)))];
}
let queue: Promise<unknown> = Promise.resolve();
/** Seis miniaturas ao longo de um vídeo (geradas uma vez, uma de cada vez: o leitor sai logo a seguir). */
function videoThumbs(uri: string, length: number): Promise<VideoThumbnail[] | null> {
  const id = `${uri}|${Math.round(length * 10)}`;
  const have = thumbs.get(id);
  if (have) return have;
  const p = queue.then(async () => {
    let player: ReturnType<typeof createVideoPlayer> | null = null;
    try {
      player = createVideoPlayer({ uri });
      const times = Array.from({ length: 6 }, (_, i) => Math.max(0, Math.min(length - 0.05, ((i + 0.5) / 6) * length)));
      return await Promise.race([player.generateThumbnailsAsync(times, { maxWidth: 120, maxHeight: 200 }), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
    } catch { return null; } finally { try { player?.release(); } catch { /* já libertado */ } }
  });
  queue = p.catch(() => undefined);
  thumbs.set(id, p);
  void p.then((r) => { if (r?.length) resolved.set(id, r); });
  if (thumbs.size > 60) thumbs.delete(thumbs.keys().next().value as string);
  return p;
}
function useThumbs(c: ProjectClip): VideoThumbnail[] | null {
  const [t, setT] = useState<VideoThumbnail[] | null>(null);
  useEffect(() => {
    if (!c.video) return;
    let off = false;
    void videoThumbs(c.uri, c.length).then((r) => { if (!off) setT(r); });
    return () => { off = true; };
  }, [c.uri, c.video, c.length]);
  return t;
}

/** O bocado de um clipe na faixa: as miniaturas (vídeo: as do corte; foto: a própria foto em fila) e o tempo. */
function ClipStrip({ c, w, dur }: { c: ProjectClip; w: number; dur: number }) {
  const t = useThumbs(c);
  const n = Math.max(1, Math.min(10, Math.ceil(w / 40)));
  const tiles = Array.from({ length: n }, (_, i) => {
    if (!c.video) return { uri: c.uri } as { uri: string };
    if (!t?.length) return null;
    const at = c.trim.start + ((i + 0.5) / n) * (c.trim.end - c.trim.start);
    return t[Math.max(0, Math.min(t.length - 1, Math.floor((at / Math.max(0.1, c.length)) * t.length)))];
  });
  return (
    <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]} pointerEvents="none">
      {tiles.map((s, i) => (s ? <Image key={i} source={s} style={{ flex: 1, height: '100%' }} contentFit="cover" recyclingKey={`${c.key}-${i}`} /> : <View key={i} style={{ flex: 1, backgroundColor: '#22222c' }} />))}
      <View style={st.durTag}><Text style={st.durText}>{dur.toFixed(1).replace('.', ',')} s</Text></View>
    </View>
  );
}

interface Props {
  clips: ProjectClip[];
  durations: number[];
  total: number;
  clock: ClockStore;
  selected: string | null;
  locked: boolean;
  beats?: number[];
  layers: TimelineLayer[];
  selectedLayer: string | null;
  width: number;
  onSelect: (key: string | null) => void;
  onSeek: (t: number, phase: 'start' | 'move' | 'end') => void;
  onTrim: (key: string, edge: TrimEdge, delta: number, phase: 'start' | 'move' | 'end') => 'min' | 'max' | null;
  onMove: (from: number, to: number) => void;
  onSelectLayer: (id: string | null) => void;
  onLayer: (id: string, start: number, end: number, phase: 'start' | 'move' | 'end') => void;
  onAdd: () => void;
  /** Folha aberta: a faixa densa, com o tocar/pausar e o tempo à esquerda. */
  dense?: boolean;
  playing?: boolean;
  onTogglePlay?: () => void;
  /** A altura da faixa mudou (para quem a põe no ecrã). */
  onHeight?: (h: number) => void;
}

/** Uma pega de cortar (início ou fim do clipe escolhido). */
function TrimHandle({ edge, left, pps, onTrim, k, h }: { edge: TrimEdge; left: number; pps: number; k: string; onTrim: Props['onTrim']; h: number }) {
  const hit = useRef<'min' | 'max' | null>(null);
  const dx = useRef(0);
  const pan = usePanGesture({
    runOnJS: true, minDistance: 1,
    onBegin: () => { hit.current = null; dx.current = 0; onTrim(k, edge, 0, 'start'); },
    onUpdate: (e) => { dx.current = e.translationX; const h = onTrim(k, edge, e.translationX / pps, 'move'); if (h && h !== hit.current) tick(); hit.current = h; },
    onFinalize: () => { onTrim(k, edge, dx.current / pps, 'end'); },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={[st.handle, { left: left - (edge === 'start' ? 0 : HANDLE_W), height: h }]} hitSlop={{ left: 12, right: 12, top: 6, bottom: 6 }} accessibilityRole="adjustable" accessibilityLabel={edge === 'start' ? 'Cortar o início do clipe' : 'Cortar o fim do clipe'}>
        <View style={st.grip} />
      </View>
    </GestureDetector>
  );
}

/** Um clipe na faixa: tocar escolhe; manter e arrastar muda a ordem. */
function ClipBlock({ c, i, x, w, dur, selected, locked, onSelect, onReorder, h }: {
  c: ProjectClip; i: number; x: number; w: number; dur: number; selected: boolean; locked: boolean; h: number;
  onSelect: (key: string) => void; onReorder: (phase: 'start' | 'move' | 'end', i: number, absX: number) => void;
}) {
  const tap = useTapGesture({ runOnJS: true, onActivate: () => onSelect(c.key) });
  const drag = usePanGesture({
    runOnJS: true, activateAfterLongPress: 320,
    onActivate: (e) => { tick(); onReorder('start', i, e.absoluteX); },
    onUpdate: (e) => onReorder('move', i, e.absoluteX),
    onDeactivate: (e) => onReorder('end', i, e.absoluteX),
  });
  const g = useSimultaneousGestures(tap, drag);
  const body = (
    <View style={[st.clip, { left: x, width: Math.max(4, w - 2), height: h }, selected && st.clipOn]} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`Clipe ${i + 1}, ${c.video ? 'vídeo' : 'foto'}, ${dur.toFixed(1).replace('.', ',')} segundos`} accessibilityHint="Toque longo e arrasta para mudar a ordem">
      <ClipStrip c={c} w={w} dur={dur} />
    </View>
  );
  return locked ? body : <GestureDetector gesture={g}>{body}</GestureDetector>;
}

/** Uma faixa de camada (texto, sticker, voz-off ou efeito sonoro): tocar escolhe; arrastar muda de sítio; as pontas, o tempo. */
function LayerBar({ l, pps, top, total, selected, locked, onSelect, onLayer, lane }: {
  l: TimelineLayer; pps: number; top: number; total: number; selected: boolean; locked: boolean; lane: number;
  onSelect: (id: string) => void; onLayer: Props['onLayer'];
}) {
  const span = Math.max(0, l.end - l.start);
  const clampMove = (d: number) => { const s = Math.max(0, Math.min(Math.max(0, total - (l.point ? 0 : span)), l.start + d)); return { s, e: l.point ? s : s + span }; };
  const tap = useTapGesture({ runOnJS: true, onActivate: () => onSelect(l.id) });
  const dx = useRef(0);
  const move = usePanGesture({
    runOnJS: true, minDistance: 6, activeOffsetX: [-8, 8],
    onBegin: () => { dx.current = 0; onLayer(l.id, l.start, l.end, 'start'); },
    onUpdate: (e) => { dx.current = e.translationX; const r = clampMove(e.translationX / pps); onLayer(l.id, r.s, r.e, 'move'); },
    onFinalize: () => { const r = clampMove(dx.current / pps); onLayer(l.id, r.s, r.e, 'end'); },
  });
  const edgePan = (edge: 'start' | 'end') => ({
    runOnJS: true as const, minDistance: 1,
    onBegin: () => { dx.current = 0; onLayer(l.id, l.start, l.end, 'start'); },
    onUpdate: (e: { translationX: number }) => {
      dx.current = e.translationX;
      const d = e.translationX / pps;
      const s = edge === 'start' ? Math.max(0, Math.min(l.end - 0.3, l.start + d)) : l.start;
      const en = edge === 'end' ? Math.min(total, Math.max(l.start + 0.3, l.end + d)) : l.end;
      onLayer(l.id, Math.round(s * 1000) / 1000, Math.round(en * 1000) / 1000, 'move');
    },
    onFinalize: () => {
      const d = dx.current / pps;
      const s = edge === 'start' ? Math.max(0, Math.min(l.end - 0.3, l.start + d)) : l.start;
      const en = edge === 'end' ? Math.min(total, Math.max(l.start + 0.3, l.end + d)) : l.end;
      onLayer(l.id, Math.round(s * 1000) / 1000, Math.round(en * 1000) / 1000, 'end');
    },
  });
  const left = usePanGesture(edgePan('start'));
  const right = usePanGesture(edgePan('end'));
  const g = useSimultaneousGestures(tap, move);
  const color = l.kind === 'text' ? '#7a5cff' : l.kind === 'sticker' ? '#0fa3b1' : l.kind === 'voice' ? CORAL : '#ffd60a';
  if (l.point) {
    const body = <View style={[st.diamondHit, { left: l.start * pps - 13, top, height: lane - 2 }]} accessibilityRole="button" accessibilityLabel={`${l.label} aos ${l.start.toFixed(1).replace('.', ',')} s`}><View style={[st.diamond, selected && { borderColor: '#fff', borderWidth: 2 }]} /></View>;
    return locked ? body : <GestureDetector gesture={g}>{body}</GestureDetector>;
  }
  const body = (
    <View style={[st.layer, { left: l.start * pps, width: Math.max(14, span * pps), top, height: lane - 2, backgroundColor: color }, selected && st.layerOn]} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${l.label}, dos ${l.start.toFixed(1).replace('.', ',')} aos ${l.end.toFixed(1).replace('.', ',')} s`}>
      <Text style={[st.layerText, lane < 24 && { lineHeight: 16 }, l.kind === 'sfx' && { color: '#111' }]} numberOfLines={1}>{l.label}</Text>
    </View>
  );
  return (
    <>
      {locked ? body : <GestureDetector gesture={g}>{body}</GestureDetector>}
      {selected && l.trim && !locked ? (
        <>
          <GestureDetector gesture={left}><View style={[st.layerHandle, { left: l.start * pps - 14, top, height: lane - 2 }]} accessibilityLabel="Mudar quando entra" accessibilityRole="adjustable"><View style={st.layerGrip} /></View></GestureDetector>
          <GestureDetector gesture={right}><View style={[st.layerHandle, { left: l.end * pps - 10, top, height: lane - 2 }]} accessibilityLabel="Mudar quando sai" accessibilityRole="adjustable"><View style={st.layerGrip} /></View></GestureDetector>
        </>
      ) : null}
    </>
  );
}

/**
 * A linha do tempo nativa (ao estilo do CapCut): o cursor fica parado ao meio e a faixa desliza por baixo dele (deslizar =
 * procurar; a tocar, a faixa anda sozinha). Os clipes têm as miniaturas; o escolhido tem as pegas de cortar. Toque longo e
 * arrastar muda a ordem. Com dois dedos (ou os botões − e +) aproxima e afasta. Por baixo, as faixas das camadas: os textos
 * e stickers (com as pontas), a voz-off e os efeitos sonoros.
 */
export function NativeTimeline(p: Props) {
  const { clips, durations, total, clock } = p;
  const d = p.dense ? DENSE : NORMAL;
  const lead = p.dense ? LEAD_W : 0;
  const width = Math.max(120, p.width - lead);
  const [pps, setPps] = useState(() => clampPps(Math.max(PPS_DEFAULT, (width * 0.8) / Math.max(1, total))));
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const user = useRef(false);
  const lastX = useRef(0);
  const pad = Math.max(0, width / 2);
  const starts = useMemo(() => { let t = 0; return durations.map((d) => { const s = t; t += d; return s; }); }, [durations]);
  const cuts = useMemo(() => cutPoints(durations), [durations]);
  const [now, setNow] = useState(() => clock.time());

  // A tocar (ou quando o relógio salta), a faixa segue o cursor.
  useEffect(() => clock.subscribe((t) => {
    setNow((o) => (Math.abs(o - t) < 0.05 ? o : t));
    if (user.current) return;
    const x = t * ppsRef.current;
    if (Math.abs(x - lastX.current) < 0.5) return;
    lastX.current = x;
    scroll.current?.scrollTo({ x, animated: false });
  }), [clock]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!user.current) return;
    const x = e.nativeEvent.contentOffset.x;
    lastX.current = x;
    p.onSeek(Math.max(0, Math.min(total, x / ppsRef.current)), 'move');
  };
  const endUser = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!user.current) return;
    user.current = false;
    const raw = Math.max(0, Math.min(total, e.nativeEvent.contentOffset.x / ppsRef.current));
    const t = snapTime(raw, cuts, ppsRef.current);
    if (t !== raw) scroll.current?.scrollTo({ x: t * ppsRef.current, animated: true });
    p.onSeek(t, 'end');
  };

  // Aproximar e afastar (pinça e botões): o instante debaixo do cursor fica no sítio.
  const zoom = (f: number) => {
    const n = clampPps(ppsRef.current * f);
    if (n === ppsRef.current) return;
    const t = clock.time();
    ppsRef.current = n;
    setPps(n);
    lastX.current = t * n;
    requestAnimationFrame(() => scroll.current?.scrollTo({ x: t * n, animated: false }));
  };
  const pinch = usePinchGesture({ runOnJS: true, onUpdate: (e) => zoom(e.scaleChange) });

  // Reordenar: os clipes viram quadrados iguais e o que se arrasta segue o dedo.
  const [reorder, setReorder] = useState<{ from: number; x: number; x0: number } | null>(null);
  const rowLeft = useRef(0);
  const rowRef = useRef<React.ComponentRef<typeof View>>(null);
  const onReorder = (phase: 'start' | 'move' | 'end', i: number, absX: number) => {
    if (p.locked) return;
    if (phase === 'start') {
      rowRef.current?.measureInWindow((x: number) => { rowLeft.current = x; });
      setReorder({ from: i, x: absX, x0: absX });
      return;
    }
    if (phase === 'move') { setReorder((r) => (r ? { ...r, x: absX } : r)); return; }
    setReorder(null);
    const rowW = clips.length * SLOT;
    const offset = Math.max(0, (width - rowW) / 2);
    const to = reorderIndex(absX - rowLeft.current - offset, SLOT, clips.length);
    if (to !== i) p.onMove(i, to);
  };

  const sel = clips.findIndex((c) => c.key === p.selected);
  // As camadas em faixas: os textos e stickers em até 2 (sem se taparem), e o som (voz-off e efeitos) numa.
  const lanes = useMemo(() => {
    const ov = p.layers.filter((l) => l.kind === 'text' || l.kind === 'sticker').sort((a, b) => a.start - b.start);
    const ends: number[] = [];
    const placed = ov.map((l) => { let lane = ends.findIndex((e) => e <= l.start + 1e-3); if (lane < 0) { lane = Math.min(1, ends.length); } ends[lane] = Math.max(ends[lane] ?? 0, l.end); return { l, lane }; });
    const sound = p.layers.filter((l) => l.kind === 'voice' || l.kind === 'sfx');
    const ovLanes = placed.length ? Math.max(...placed.map((x) => x.lane)) + 1 : 0;
    return { placed, sound, ovLanes, count: ovLanes + (sound.length ? 1 : 0) };
  }, [p.layers]);
  const contentW = total * pps;
  const ticks = useMemo(() => rulerTicks(pps, total, { minGap: 14, labelGap: 60 }), [pps, total]);
  const tracksTop = d.ruler + d.clip + (p.dense ? 4 : 6);
  const height = tracksTop + lanes.count * d.lane + (p.dense ? 4 : 6);
  useEffect(() => { p.onHeight?.(height); }, [height]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ height, flexDirection: 'row' }}>
      {p.dense ? (
        <View style={st.lead}>
          <Pressable onPress={p.onTogglePlay} style={st.leadBtn} accessibilityRole="button" accessibilityLabel={p.playing ? 'Pausar' : 'Tocar'}>
            {p.playing ? <Pause size={20} color="#fff" fill="#fff" /> : <Play size={20} color="#fff" fill="#fff" />}
          </Pressable>
          <Text style={st.leadTime} numberOfLines={1}>{previewClock(now, total).split(' / ')[0]}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
      <GestureDetector gesture={pinch}>
        <View style={StyleSheet.absoluteFill}>
          <ScrollView
            ref={scroll}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScrollBeginDrag={() => { user.current = true; clock.pause(); p.onSeek(clock.time(), 'start'); }}
            onScroll={onScroll}
            onScrollEndDrag={(e) => { if (Math.abs((e.nativeEvent.velocity?.x ?? 0)) < 0.05) endUser(e); }}
            onMomentumScrollEnd={endUser}
            contentContainerStyle={{ paddingHorizontal: pad, width: contentW + pad * 2 }}
            scrollEnabled={!reorder}
          >
            <View style={{ width: contentW, height: '100%' }}>
              {/* A régua (com as batidas, ao ritmo). */}
              <View style={{ height: d.ruler }} pointerEvents="none">
                {ticks.ticks.map((tk) => (
                  <View key={tk.t} style={[st.tick, { left: tk.t * pps, height: tk.major ? (p.dense ? 5 : 8) : 3 }]}>
                    {tk.label ? <Text style={[st.tickText, p.dense && { top: 0, left: 4, lineHeight: 16 }]} numberOfLines={1}>{tk.label}</Text> : null}
                  </View>
                ))}
                {(p.beats ?? []).filter((b) => b <= total).map((b) => <View key={`b${b}`} style={[st.beat, { left: b * pps }]} />)}
              </View>
              {/* Os clipes. */}
              <View style={{ height: d.clip }}>
                {clips.map((c, i) => (
                  <ClipBlock key={c.key} c={c} i={i} x={(starts[i] ?? 0) * pps} w={(durations[i] ?? 0) * pps} dur={durations[i] ?? 0} selected={c.key === p.selected} locked={p.locked} onSelect={(k) => p.onSelect(k === p.selected ? null : k)} onReorder={onReorder} h={d.clip} />
                ))}
                {sel >= 0 && !p.locked ? (
                  <>
                    <TrimHandle k={clips[sel].key} edge="start" left={(starts[sel] ?? 0) * pps} pps={pps} onTrim={p.onTrim} h={d.clip} />
                    <TrimHandle k={clips[sel].key} edge="end" left={((starts[sel] ?? 0) + (durations[sel] ?? 0)) * pps} pps={pps} onTrim={p.onTrim} h={d.clip} />
                  </>
                ) : null}
              </View>
              {/* As camadas. */}
              <View style={{ marginTop: p.dense ? 4 : 6, height: lanes.count * d.lane }}>
                {lanes.placed.map(({ l, lane }) => <LayerBar key={l.id} l={l} pps={pps} top={lane * d.lane} lane={d.lane} total={total} selected={p.selectedLayer === l.id} locked={p.locked} onSelect={(id) => p.onSelectLayer(id === p.selectedLayer ? null : id)} onLayer={p.onLayer} />)}
                {lanes.sound.map((l) => <LayerBar key={l.id} l={l} pps={pps} top={lanes.ovLanes * d.lane} lane={d.lane} total={total} selected={p.selectedLayer === l.id} locked={p.locked} onSelect={(id) => p.onSelectLayer(id === p.selectedLayer ? null : id)} onLayer={p.onLayer} />)}
              </View>
            </View>
            {!p.locked ? (
              <Pressable onPress={p.onAdd} style={[st.add, { left: contentW + pad + 8, top: d.ruler + Math.max(0, (d.clip - 44) / 2) }]} accessibilityRole="button" accessibilityLabel="Juntar fotos ou vídeos">
                <Plus size={22} color="#fff" strokeWidth={2.6} />
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </GestureDetector>
      {/* O cursor, parado ao meio, e o tempo dele. */}
      <View pointerEvents="none" style={[st.playhead, { left: pad - 1 }]} />
      {p.dense ? null : <View pointerEvents="none" style={[st.nowTag, { left: pad - 34 }]}><Text style={st.nowText}>{preciseClock(now)}</Text></View>}
      {p.dense ? null : <View style={st.zoom} pointerEvents="box-none">
        <Pressable onPress={() => zoom(1 / 1.5)} hitSlop={8} style={st.zoomBtn} accessibilityRole="button" accessibilityLabel="Afastar a linha do tempo"><Minus size={16} color="#fff" strokeWidth={2.6} /></Pressable>
        <Pressable onPress={() => zoom(1.5)} hitSlop={8} style={st.zoomBtn} accessibilityRole="button" accessibilityLabel="Aproximar a linha do tempo"><Plus size={16} color="#fff" strokeWidth={2.6} /></Pressable>
      </View>}
      {reorder ? (
        <View ref={rowRef} style={[st.reorderRow, { top: Math.max(0, d.ruler - 6), height: d.clip + 16 }]} pointerEvents="none">
          <View style={{ flexDirection: 'row', alignSelf: 'center' }}>
            {clips.map((c, i) => {
              const dragging = i === reorder.from;
              return (
                <View key={c.key} style={[st.slot, dragging && { opacity: 0.25 }]}>
                  <ClipStrip c={c} w={SLOT - 6} dur={durations[i] ?? 0} />
                </View>
              );
            })}
          </View>
          <View style={[st.slot, st.slotLifted, { position: 'absolute', left: reorder.x - rowLeft.current - SLOT / 2, top: -8 }]}>
            {clips[reorder.from] ? <ClipStrip c={clips[reorder.from]} w={SLOT - 6} dur={durations[reorder.from] ?? 0} /> : null}
          </View>
        </View>
      ) : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  tick: { position: 'absolute', top: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
  tickText: { position: 'absolute', top: 4, left: 3, width: 60, lineHeight: 16, color: 'rgba(255,255,255,0.6)', fontSize: 14, fontVariant: ['tabular-nums'] },
  beat: { position: 'absolute', bottom: 0, width: 2, height: 6, marginLeft: -1, borderRadius: 1, backgroundColor: '#ffd60a' },
  clip: { position: 'absolute', top: 0, height: CLIP_H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#22222c', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  clipOn: { borderWidth: 2, borderColor: HOT },
  durTag: { position: 'absolute', right: 3, bottom: 3, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 4 },
  durText: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  handle: { position: 'absolute', top: 0, width: HANDLE_W, height: CLIP_H, borderRadius: 6, backgroundColor: HOT, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  grip: { width: 3, height: 18, borderRadius: 2, backgroundColor: '#fff' },
  layer: { position: 'absolute', height: LANE_H - 4, borderRadius: 7, paddingHorizontal: 6, justifyContent: 'center', opacity: 0.92 },
  layerOn: { borderWidth: 2, borderColor: '#fff' },
  layerText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  layerHandle: { position: 'absolute', width: 24, height: LANE_H - 4, alignItems: 'center', justifyContent: 'center', zIndex: 4 },
  layerGrip: { width: 6, height: LANE_H - 8, borderRadius: 3, backgroundColor: '#fff' },
  diamondHit: { position: 'absolute', width: 26, height: LANE_H - 4, alignItems: 'center', justifyContent: 'center' },
  diamond: { width: 12, height: 12, transform: [{ rotate: '45deg' }], borderRadius: 2, backgroundColor: '#ffd60a', borderWidth: 1, borderColor: 'rgba(0,0,0,0.5)' },
  add: { position: 'absolute', width: 44, height: 44, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,79,109,0.8)', backgroundColor: 'rgba(214,51,79,0.15)', alignItems: 'center', justifyContent: 'center' },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, borderRadius: 1, backgroundColor: '#fff', boxShadow: '0 0 6px rgba(0,0,0,0.6)' } as object,
  nowTag: { position: 'absolute', top: -4, width: 68, alignItems: 'center' },
  nowText: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'], backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 6, paddingHorizontal: 4, overflow: 'hidden' },
  lead: { width: LEAD_W, alignItems: 'center', justifyContent: 'center', gap: 2, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.08)' },
  leadBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  leadTime: { color: '#fff', fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  zoom: { position: 'absolute', right: 6, top: -2, flexDirection: 'row', gap: 6 },
  zoomBtn: { width: 44, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  reorderRow: { position: 'absolute', left: 0, right: 0, height: CLIP_H + 16, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center' },
  slot: { width: SLOT - 6, height: CLIP_H - 6, marginHorizontal: 3, borderRadius: 8, overflow: 'hidden', backgroundColor: '#22222c' },
  slotLifted: { borderWidth: 2, borderColor: HOT, transform: [{ scale: 1.08 }] },
});
