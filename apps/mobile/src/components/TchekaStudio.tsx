import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import stickers from '../assets/stickers.json';
import type { Track } from '@/lib/api.music';
import { useAuth } from '@/lib/auth';
import { abs } from '@/lib/config';
import { colors } from '@/lib/theme';
import { sealOf } from '@/lib/wordmark';
import { Icon } from './Icon';
import { MusicPicker } from './MusicPicker';
import { Sticker } from './StickerPanel';
import { LOOKS, lookCss, stampTxillapp, type Shot } from './TxCamera';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
const W = 1080;
const H = 1920;
const MAX_S = 60;
const PHOTO_S = [2, 3, 5] as const;
const SPEEDS = [0.5, 1, 1.5, 2] as const;
const TR = 0.5; // segundos de transição
/** As personagens que se podem pôr no tcheka (o sticker de cada uma). */
const CAST: { id: string; name: string }[] = [
  { id: 'saude', name: 'Txilla' }, { id: 'bom-dia', name: 'Gelinho' }, { id: 'bora', name: 'Zazá' },
  { id: 'amor', name: 'Mimo' }, { id: 'cool', name: 'Txeka' }, { id: 'estrela', name: 'Super' },
];
type Transition = 'none' | 'fade' | 'slide';

export interface Clip { uri: string; video: boolean; mime: string; durationMs?: number }
type Item = Clip & { key: string; seconds: number; speed: number };

const recorderType = () => ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';

function cover(g: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, zoom = 1, dx = 0) {
  const k = Math.max(W / sw, H / sh) * zoom;
  const dw = sw * k, dh = sh * k;
  g.drawImage(src, (W - dw) / 2 + dx, (H - dh) / 2, dw, dh);
}
/** Quebra o texto em linhas que cabem na largura. */
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? `${line} ${word}` : word;
      if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out.slice(0, 4);
}
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/**
 * Estúdio de tchekas: junta fotos e vídeos numa sequência com transições, filtro, texto animado, uma personagem do
 * Txillapp e música, e grava um vídeo só (9:16, até 60 s). Tudo no telemóvel: a sequência é desenhada num canvas e
 * gravada em tempo real; a música mistura-se por Web Audio. Sem música, fica o som dos próprios vídeos.
 */
export function TchekaStudio({ clips, initialMusic, onDone, onClose }: { clips: Clip[]; initialMusic: Track | null; onDone: (shot: Shot, music: Track | null) => void; onClose: () => void }) {
  const { user } = useAuth();
  const username = user?.username;
  const seal = sealOf(user);
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>(() => clips.map((c, i) => ({ ...c, key: `${i}-${c.uri}`, speed: 1, seconds: c.video ? Math.min(MAX_S, Math.max(1, Math.round((c.durationMs ?? 5000) / 1000))) : 3 })));
  const [sel, setSel] = useState(0);
  const [look, setLook] = useState(0);
  const [transition, setTransition] = useState<Transition>('fade');
  const [title, setTitle] = useState('');
  const [titleStyle, setTitleStyle] = useState<'branco' | 'coral'>('branco');
  const [cast, setCast] = useState<string | null>(null);
  const [music, setMusic] = useState<Track | null>(initialMusic);
  const [pickMusic, setPickMusic] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const cancel = useRef(false);
  const total = items.reduce((n, it) => n + it.seconds / (it.video ? it.speed : 1), 0);
  const capped = Math.min(total, MAX_S);
  const cur = items[sel] ?? items[0];
  useEffect(() => () => { cancel.current = true; }, []);

  const move = (i: number, d: -1 | 1) => setItems((l) => { const j = i + d; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; setSel(j); return n; });
  const remove = (i: number) => setItems((l) => { const n = l.filter((_, k) => k !== i); setSel((s) => Math.max(0, Math.min(s, n.length - 1))); return n; });
  const cycle = (i: number) => setItems((l) => l.map((it, k) => (k === i && !it.video ? { ...it, seconds: PHOTO_S[(PHOTO_S.indexOf(it.seconds as 2 | 3 | 5) + 1) % PHOTO_S.length] } : it)));
  const setSpeed = (i: number, speed: number) => setItems((l) => l.map((it, k) => (k === i ? { ...it, speed } : it)));

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
    // A personagem: o sticker em SVG passa a imagem para o canvas.
    let castImg: HTMLImageElement | null = null;
    if (cast) {
      // Como imagem (data URL) o SVG precisa do xmlns; dentro da página não precisava.
      const raw = (stickers.items as { id: string; svg: string }[]).find((x) => x.id === cast)?.svg;
      const svg = raw && !/xmlns=/.test(raw) ? raw.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ') : raw;
      if (svg) {
        try { castImg = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('sticker')); i.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }); } catch { castImg = null; }
      }
    }
    const lastFrame = document.createElement('canvas');
    lastFrame.width = W;
    lastFrame.height = H;
    const lg = lastFrame.getContext('2d')!;
    let hasLast = false;
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<Blob>((res) => { rec.onstop = () => res(new Blob(chunks, { type: (rec.mimeType || type || 'video/mp4').split(';')[0] })); });
    rec.start(500);
    if (musicNode) musicNode.start();
    const t0 = performance.now();
    let elapsed = 0;
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    const titleLines = title.trim() ? title.trim() : '';

    /** Por cima de cada frame: a transição a partir do frame anterior, o texto animado e a personagem. */
    const overlay = (tGlobal: number, tSeg: number, first: boolean) => {
      if (hasLast && !first && transition !== 'none' && tSeg < TR) {
        const p = ease(tSeg / TR);
        g.save();
        if (hasFilter) (g as CanvasRenderingContext2D & { filter: string }).filter = 'none';
        if (transition === 'fade') { g.globalAlpha = 1 - p; g.drawImage(lastFrame, 0, 0); }
        else { g.drawImage(lastFrame, -W * p, 0); }
        g.restore();
      }
      if (hasFilter) (g as CanvasRenderingContext2D & { filter: string }).filter = 'none';
      if (titleLines) {
        const inA = ease(tGlobal / 0.45);
        const outA = tGlobal > 3.6 ? 1 - ease((tGlobal - 3.6) / 0.4) : 1;
        const a = Math.min(inA, outA);
        if (a > 0) {
          g.save();
          g.globalAlpha = a;
          g.font = `900 74px Inter, system-ui, -apple-system, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          const lines = wrap(g, titleLines, W - 200);
          const lh = 88;
          const y0 = H * 0.62 - ((lines.length - 1) * lh) / 2 + (1 - inA) * 60;
          lines.forEach((ln, i) => {
            const y = y0 + i * lh;
            if (titleStyle === 'coral') {
              const tw = g.measureText(ln).width + 56;
              g.fillStyle = '#d6334f';
              g.beginPath();
              (g as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect?.(W / 2 - tw / 2, y - 48, tw, 96, 24);
              g.fill();
              g.fillStyle = '#fff';
              g.shadowColor = 'transparent';
            } else {
              g.fillStyle = '#fff';
              g.shadowColor = 'rgba(0,0,0,0.6)';
              g.shadowBlur = 18;
            }
            g.fillText(ln, W / 2, y);
          });
          g.restore();
        }
      }
      stampTxillapp(g, W, H, username, seal);
      if (castImg) {
        const size = Math.round(W * 0.24);
        const bounce = Math.abs(Math.sin(tGlobal * 2.2)) * 28;
        const pop = ease(tGlobal / 0.5);
        g.save();
        g.globalAlpha = pop;
        g.drawImage(castImg, 36, H - size - 150 - bounce, size * pop, size * (129 / 132) * pop);
        g.restore();
      }
    };
    const snapshot = () => { lg.drawImage(canvas, 0, 0); hasLast = true; };

    try {
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        if (cancel.current || elapsed >= MAX_S) break;
        const secs = Math.min(it.seconds / (it.video ? it.speed : 1), MAX_S - elapsed);
        const first = idx === 0;
        if (it.video) {
          const v = document.createElement('video');
          v.src = it.uri; v.playsInline = true; v.muted = !!music; v.crossOrigin = 'anonymous'; v.playbackRate = it.speed;
          await new Promise<void>((res, rej) => { v.oncanplay = () => res(); v.onerror = () => rej(new Error('vídeo')); v.load(); });
          if (!music && ac && dest) { try { ac.createMediaElementSource(v).connect(dest); } catch { /* já ligado ou não suportado */ } }
          await v.play();
          const start = performance.now();
          while (!cancel.current && !v.ended) {
            const t = (performance.now() - start) / 1000;
            if (t >= secs) break;
            if (hasFilter) (g as CanvasRenderingContext2D & { filter: string }).filter = lookCss(LOOKS[look]);
            const slideIn = !first && transition === 'slide' && t < TR ? W * (1 - ease(t / TR)) : 0;
            cover(g, v, v.videoWidth || W, v.videoHeight || H, 1, slideIn);
            overlay(elapsed + t, t, first);
            setProgress(Math.min(1, (elapsed + t) / capped));
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
            if (hasFilter) (g as CanvasRenderingContext2D & { filter: string }).filter = lookCss(LOOKS[look]);
            const slideIn = !first && transition === 'slide' && t < TR ? W * (1 - ease(t / TR)) : 0;
            cover(g, img, img.naturalWidth, img.naturalHeight, 1 + 0.07 * (t / secs), slideIn); // zoom suave (Ken Burns)
            overlay(elapsed + t, t, first);
            setProgress(Math.min(1, (elapsed + t) / capped));
            await frame();
          }
          elapsed += secs;
        }
        snapshot();
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
    // O vídeo sai com a assinatura do Txillapp em todos os frames (signed): o servidor não a volta a pôr.
    onDone({ uri: URL.createObjectURL(blob), video: true, mime: blob.type || 'video/mp4', durationMs: Math.round(performance.now() - t0), signed: true }, music);
  }

  const topPad = Math.max(insets.top, 12);
  const botPad = Math.max(insets.bottom, 16);
  const chip = (on: boolean, label: string, onPress: () => void, key?: string) => (
    <Pressable key={key ?? label} onPress={onPress} style={[st.chip, on && st.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Text style={[st.chipText, on && { color: colors.zinc900 }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={[st.root, { paddingTop: topPad, paddingBottom: botPad }]} accessibilityViewIsModal>
      <View style={st.top}>
        <Pressable onPress={onClose} style={st.round} accessibilityRole="button" accessibilityLabel="Voltar"><Icon name="x" size={24} color="#fff" strokeWidth={2.2} /></Pressable>
        <Text style={st.title}>Novo tcheka</Text>
        <Pressable onPress={() => void build()} disabled={!items.length || progress !== null} style={[st.cta, (!items.length || progress !== null) && { opacity: 0.5 }]} accessibilityRole="button">
          <Text style={st.ctaText}>{progress !== null ? `${Math.round(progress * 100)}%` : 'Criar'}</Text>
        </Pressable>
      </View>

      {/* Pré-visualização do clipe escolhido, com o filtro, o texto e a personagem por cima. */}
      <View style={st.preview}>
        {cur ? (cur.video
          ? dom('video', { key: cur.key, src: cur.uri, playsInline: true, muted: true, autoPlay: true, loop: true, style: { width: '100%', height: '100%', objectFit: 'cover', filter: lookCss(LOOKS[look]) } })
          : dom('img', { key: cur.key, src: cur.uri, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', filter: lookCss(LOOKS[look]) } })) : null}
        {title.trim() ? (
          <View style={st.titleWrap} pointerEvents="none">
            <Text style={[st.titleText, titleStyle === 'coral' && st.titleCoral]}>{title.trim()}</Text>
          </View>
        ) : null}
        {cast ? <View style={st.castWrap} pointerEvents="none"><Sticker id={cast} size={72} /></View> : null}
        {progress !== null && (
          <View style={st.building} pointerEvents="none">
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18 }}>A montar o tcheka…</Text>
            <View style={st.track}><View style={[st.fill, { width: `${Math.round(progress * 100)}%` }]} /></View>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>Demora o tempo do vídeo. Não feches a app.</Text>
          </View>
        )}
      </View>

      <ScrollView style={{ maxHeight: 330 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
                  <Text style={st.secs}>{it.video ? `${Math.round(it.seconds / it.speed)} s` : `${it.seconds} s`}</Text>
                </Pressable>
                <Pressable onPress={() => move(i, 1)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Mover para a frente"><Icon name="chevron-right" size={14} color="rgba(255,255,255,0.8)" /></Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
        <Text style={st.meta}>{items.length} {items.length === 1 ? 'clipe' : 'clipes'} · {Math.round(capped)} s{total > MAX_S ? ' (corta aos 60 s)' : ''}</Text>

        {cur?.video ? (
          <View style={st.rowWrap}>
            <Text style={st.label}>Velocidade</Text>
            {SPEEDS.map((sp) => chip(cur.speed === sp, `${sp}×`, () => setSpeed(sel, sp), `sp-${sp}`))}
          </View>
        ) : null}

        <View style={st.rowWrap}>
          <Text style={st.label}>Transição</Text>
          {chip(transition === 'none', 'Seca', () => setTransition('none'))}
          {chip(transition === 'fade', 'Fundir', () => setTransition('fade'))}
          {chip(transition === 'slide', 'Deslizar', () => setTransition('slide'))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 6, alignItems: 'center' }} style={{ maxHeight: 40, marginTop: 8 }} accessibilityRole="tablist" accessibilityLabel="Filtros">
          <Text style={[st.label, { paddingHorizontal: 0 }]}>Filtro</Text>
          {LOOKS.map((l, i) => chip(look === i, l.name, () => setLook(i), l.id))}
        </ScrollView>

        <View style={st.textRow}>
          <TextInput value={title} onChangeText={(v) => setTitle(v.slice(0, 80))} placeholder="Texto por cima (aparece animado no início)" placeholderTextColor="rgba(255,255,255,0.55)" style={st.input} accessibilityLabel="Texto do tcheka" maxLength={80} />
          {chip(titleStyle === 'branco', 'Branco', () => setTitleStyle('branco'))}
          {chip(titleStyle === 'coral', 'Coral', () => setTitleStyle('coral'))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }} style={{ maxHeight: 64, marginTop: 8 }} accessibilityLabel="Personagem">
          <Text style={[st.label, { paddingHorizontal: 0 }]}>Personagem</Text>
          <Pressable onPress={() => setCast(null)} style={[st.castBtn, cast === null && { borderColor: colors.brand }]} accessibilityRole="button" accessibilityLabel="Sem personagem"><Icon name="x" size={18} color="#fff" /></Pressable>
          {CAST.map((c) => (
            <Pressable key={c.id} onPress={() => setCast(c.id)} style={[st.castBtn, cast === c.id && { borderColor: colors.brand }]} accessibilityRole="button" accessibilityLabel={c.name} accessibilityState={{ selected: cast === c.id }}>
              <Sticker id={c.id} size={40} />
            </Pressable>
          ))}
        </ScrollView>

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
      </ScrollView>
      {pickMusic ? <MusicPicker allowLocal onClose={() => setPickMusic(false)} onPick={(t) => { setMusic(t); setPickMusic(false); }} /> : null}
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
  preview: { flex: 1, minHeight: 200, marginHorizontal: 16, borderRadius: 20, overflow: 'hidden', backgroundColor: '#111' },
  titleWrap: { position: 'absolute', left: 16, right: 16, top: '58%', alignItems: 'center' },
  titleText: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  titleCoral: { backgroundColor: colors.brand, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, textShadowRadius: 0, overflow: 'hidden' },
  castWrap: { position: 'absolute', left: 10, bottom: 40 },
  building: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  track: { width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  thumb: { width: 64, height: 84, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', backgroundColor: '#222' },
  rm: { position: 'absolute', right: 3, top: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  secs: { color: '#fff', fontSize: 12, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  meta: { color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center', marginTop: 4 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginTop: 8 },
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', paddingRight: 4 },
  chip: { height: 30, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  textRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginTop: 8 },
  input: { flex: 1, minWidth: 0, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', paddingHorizontal: 12, fontSize: 14 },
  castBtn: { width: 52, height: 52, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  musicRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14, paddingVertical: 10 },
  small: { height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  smallText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  err: { color: '#fecaca', textAlign: 'center', marginTop: 8, fontSize: 13 },
});
