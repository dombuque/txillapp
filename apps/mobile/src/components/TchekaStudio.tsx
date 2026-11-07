import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Track } from '@/lib/api.music';
import { abs } from '@/lib/config';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { MusicPicker } from './MusicPicker';
import { LOOKS, lookCss, type Shot } from './TxCamera';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const W = 1080;
const H = 1920;
const MAX_S = 60;
const PHOTO_S = [2, 3, 5] as const;

export interface Clip { uri: string; video: boolean; mime: string; durationMs?: number }
type Item = Clip & { key: string; seconds: number };

const recorderType = () => ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';

function cover(g: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, zoom = 1) {
  const k = Math.max(W / sw, H / sh) * zoom;
  const dw = sw * k, dh = sh * k;
  g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/**
 * Estúdio de tchekas: junta fotos e vídeos numa sequência, com um filtro e uma música, e grava um vídeo só (9:16, até 60 s).
 * Tudo acontece no telemóvel: a sequência é desenhada num canvas e gravada em tempo real; a música mistura-se por Web Audio.
 * Sem música, fica o som dos próprios vídeos.
 */
export function TchekaStudio({ clips, initialMusic, onDone, onClose }: { clips: Clip[]; initialMusic: Track | null; onDone: (shot: Shot, music: Track | null) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>(() => clips.map((c, i) => ({ ...c, key: `${i}-${c.uri}`, seconds: c.video ? Math.min(MAX_S, Math.max(1, Math.round((c.durationMs ?? 5000) / 1000))) : 3 })));
  const [sel, setSel] = useState(0);
  const [look, setLook] = useState(0);
  const [music, setMusic] = useState<Track | null>(initialMusic);
  const [pickMusic, setPickMusic] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const cancel = useRef(false);
  const total = items.reduce((n, it) => n + it.seconds, 0);
  const capped = Math.min(total, MAX_S);
  const cur = items[sel] ?? items[0];
  useEffect(() => () => { cancel.current = true; }, []);

  const move = (i: number, d: -1 | 1) => setItems((l) => { const j = i + d; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; setSel(j); return n; });
  const remove = (i: number) => setItems((l) => { const n = l.filter((_, k) => k !== i); setSel((s) => Math.max(0, Math.min(s, n.length - 1))); return n; });
  const cycle = (i: number) => setItems((l) => l.map((it, k) => (k === i && !it.video ? { ...it, seconds: PHOTO_S[(PHOTO_S.indexOf(it.seconds as 2 | 3 | 5) + 1) % PHOTO_S.length] } : it)));

  async function build() {
    if (!items.length || progress !== null) return;
    setErr('');
    setProgress(0);
    cancel.current = false;
    const type = recorderType();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const hasFilter = 'filter' in g;
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    const ac = AC ? new AC() : null;
    const dest = ac ? ac.createMediaStreamDestination() : null;
    const stream = (canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream }).captureStream?.(30);
    if (!stream || typeof MediaRecorder === 'undefined') { setErr('Este browser não consegue montar o vídeo'); setProgress(null); return; }
    if (dest) dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    // Música: toca do início, em ciclo se a sequência for mais comprida.
    let musicNode: AudioBufferSourceNode | null = null;
    if (music && ac && dest) {
      try {
        const url = abs(music.url) ?? music.url;
        const buf = await ac.decodeAudioData(await (await fetch(url)).arrayBuffer());
        musicNode = ac.createBufferSource();
        musicNode.buffer = buf;
        musicNode.loop = true;
        musicNode.connect(dest);
      } catch { musicNode = null; }
    }
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<Blob>((res) => { rec.onstop = () => res(new Blob(chunks, { type: (rec.mimeType || type || 'video/mp4').split(';')[0] })); });
    rec.start(500);
    if (musicNode) musicNode.start();
    const t0 = performance.now();
    let elapsed = 0;
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    try {
      for (const it of items) {
        if (cancel.current || elapsed >= MAX_S) break;
        const secs = Math.min(it.seconds, MAX_S - elapsed);
        if (hasFilter) (g as CanvasRenderingContext2D & { filter: string }).filter = lookCss(LOOKS[look]);
        if (it.video) {
          const v = document.createElement('video');
          v.src = it.uri; v.playsInline = true; v.muted = !!music; v.crossOrigin = 'anonymous';
          await new Promise<void>((res, rej) => { v.oncanplay = () => res(); v.onerror = () => rej(new Error('vídeo')); v.load(); });
          if (!music && ac && dest) { try { ac.createMediaElementSource(v).connect(dest); } catch { /* já ligado ou não suportado */ } }
          await v.play();
          const start = performance.now();
          while (!cancel.current && !v.ended && (performance.now() - start) / 1000 < secs) {
            cover(g, v, v.videoWidth || W, v.videoHeight || H);
            setProgress(Math.min(1, (elapsed + (performance.now() - start) / 1000) / capped));
            await frame();
          }
          v.pause();
          elapsed += Math.min(secs, (performance.now() - start) / 1000);
        } else {
          const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('foto')); i.src = it.uri; });
          const start = performance.now();
          while (!cancel.current) {
            const t = (performance.now() - start) / 1000;
            if (t >= secs) break;
            cover(g, img, img.naturalWidth, img.naturalHeight, 1 + 0.06 * (t / secs)); // ligeiro zoom (Ken Burns)
            setProgress(Math.min(1, (elapsed + t) / capped));
            await frame();
          }
          elapsed += secs;
        }
      }
    } catch (e) {
      setErr((e as Error).message === 'vídeo' ? 'Não consegui ler um dos vídeos' : 'Não consegui montar o tcheka');
    }
    await frame();
    rec.stop();
    try { musicNode?.stop(); } catch { /* já parou */ }
    const blob = await done;
    void ac?.close();
    setProgress(null);
    if (cancel.current || !blob.size) return;
    onDone({ uri: URL.createObjectURL(blob), video: true, mime: blob.type || 'video/mp4', durationMs: Math.round(performance.now() - t0) }, music);
  }

  const topPad = Math.max(insets.top, 12);
  const botPad = Math.max(insets.bottom, 16);
  return (
    <View style={[st.root, { paddingTop: topPad, paddingBottom: botPad }]} accessibilityViewIsModal>
      <View style={st.top}>
        <Pressable onPress={onClose} style={st.round} accessibilityRole="button" accessibilityLabel="Voltar"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        <Text style={st.title}>Novo tcheka</Text>
        <Pressable onPress={() => void build()} disabled={!items.length || progress !== null} style={[st.cta, (!items.length || progress !== null) && { opacity: 0.5 }]} accessibilityRole="button">
          <Text style={st.ctaText}>{progress !== null ? `${Math.round(progress * 100)}%` : 'Criar'}</Text>
        </Pressable>
      </View>

      {/* Pré-visualização do clipe escolhido, com o filtro. */}
      <View style={st.preview}>
        {cur ? (cur.video
          ? dom('video', { key: cur.key, src: cur.uri, playsInline: true, muted: true, autoPlay: true, loop: true, style: { width: '100%', height: '100%', objectFit: 'cover', filter: lookCss(LOOKS[look]) } })
          : dom('img', { key: cur.key, src: cur.uri, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', filter: lookCss(LOOKS[look]) } })) : null}
        {progress !== null && (
          <View style={st.building} pointerEvents="none">
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18 }}>A montar o tcheka…</Text>
            <View style={st.track}><View style={[st.fill, { width: `${Math.round(progress * 100)}%` }]} /></View>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>Demora o tempo do vídeo. Não feches a app.</Text>
          </View>
        )}
      </View>

      {/* A sequência: toca para ver; setas para ordenar; x tira; nas fotos o tempo muda ao tocar. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, alignItems: 'center' }} style={{ maxHeight: 112, marginTop: 10 }}>
        {items.map((it, i) => (
          <View key={it.key} style={{ alignItems: 'center', gap: 4 }}>
            <Pressable onPress={() => setSel(i)} style={[st.thumb, i === sel && { borderColor: colors.brand }]} accessibilityRole="button" accessibilityLabel={`Clipe ${i + 1}`}>
              {it.video
                ? dom('video', { src: it.uri, muted: true, playsInline: true, preload: 'metadata', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })
                : dom('img', { src: it.uri, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })}
              <Pressable onPress={() => remove(i)} style={st.rm} hitSlop={6} accessibilityRole="button" accessibilityLabel="Tirar"><Icon name="x" size={12} color="#fff" strokeWidth={3} /></Pressable>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Pressable onPress={() => move(i, -1)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Mover para trás"><Icon name="chevron-left" size={14} color="rgba(255,255,255,0.8)" /></Pressable>
              <Pressable onPress={() => cycle(i)} disabled={it.video} accessibilityRole="button" accessibilityLabel={it.video ? `Vídeo de ${it.seconds} s` : `Foto durante ${it.seconds} s, toca para mudar`}>
                <Text style={st.secs}>{it.seconds} s</Text>
              </Pressable>
              <Pressable onPress={() => move(i, 1)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Mover para a frente"><Icon name="chevron-right" size={14} color="rgba(255,255,255,0.8)" /></Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
      <Text style={st.meta}>{items.length} {items.length === 1 ? 'clipe' : 'clipes'} · {capped} s{total > MAX_S ? ' (corta aos 60 s)' : ''}</Text>

      {/* Filtros */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 6, alignItems: 'center' }} style={{ maxHeight: 40, marginTop: 8 }} accessibilityRole="tablist" accessibilityLabel="Filtros">
        {LOOKS.map((l, i) => (
          <Pressable key={l.id} onPress={() => setLook(i)} style={[st.chip, look === i && st.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: look === i }}>
            <Text style={[st.chipText, look === i && { color: colors.zinc900 }]}>{l.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Música */}
      <View style={st.musicRow}>
        <Icon name="music" size={20} color="#fff" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }} numberOfLines={1}>{music ? music.title : 'Sem música'}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }} numberOfLines={1}>{music ? music.artist || 'Toca em ciclo; os vídeos ficam sem som' : 'Fica o som dos vídeos'}</Text>
        </View>
        <Pressable onPress={() => setPickMusic(true)} style={st.small} accessibilityRole="button"><Text style={st.smallText}>{music ? 'Trocar' : 'Escolher'}</Text></Pressable>
        {music ? <Pressable onPress={() => setMusic(null)} style={st.small} accessibilityRole="button" accessibilityLabel="Tirar a música"><Icon name="x" size={16} color="#fff" strokeWidth={2.4} /></Pressable> : null}
      </View>
      {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
      {pickMusic ? <MusicPicker onClose={() => setPickMusic(false)} onPick={(t) => { setMusic(t); setPickMusic(false); }} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  cta: { height: 40, minWidth: 84, paddingHorizontal: 18, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  preview: { flex: 1, marginHorizontal: 16, borderRadius: 20, overflow: 'hidden', backgroundColor: '#111' },
  building: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  track: { width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  thumb: { width: 64, height: 84, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', backgroundColor: '#222' },
  rm: { position: 'absolute', right: 3, top: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  secs: { color: '#fff', fontSize: 12, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  meta: { color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center', marginTop: 4 },
  chip: { height: 30, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  musicRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14, paddingVertical: 10 },
  small: { height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  smallText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  err: { color: '#fecaca', textAlign: 'center', marginTop: 8, fontSize: 13 },
});
