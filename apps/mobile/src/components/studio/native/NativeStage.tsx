import { ColorMatrix, Canvas, Image as SkImageNode, Skia, type SkImage } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { CapulanaSpec } from '@/lib/studio/capulana';
import { easeInOutCubic, isIdentity, playbackRateAt, resolveFx, sourceOffset, transitionFor, VIGNETTE_ANGLE, type ClipFx } from '@/lib/studio/effects';
import { videoLook, type VideoLook } from '@/lib/studio/nativeLook';
import { drift, photoZoom, reverseStep, segAt, transitionAt } from '@/lib/studio/previewClock';
import { limitBuffer } from '@/lib/videoMemory';
import { CapulanaSwatch } from '../CapulanaSwatch';
import type { ClockStore } from './clockStore';

/** Um bocado da sequência como a pré-visualização o toca. `volume`: o som do próprio vídeo (0 se calado ou ao contrário). */
export interface StageSeg { key: string; uri: string; video: boolean; start: number; dur: number; from: number; len: number; speed: number; fx?: ClipFx; volume: number }
type Role = 'cur' | 'prev' | 'next';
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const nowMs = () => Date.now();

/** As camadas por cima de um vídeo que aproximam o filtro (ver lib/studio/nativeLook.ts) e a vinheta. */
export function LookLayer({ look }: { look: VideoLook }) {
  if (look.none) return null;
  const edge = look.vignette > 0 ? 1 - Math.pow(Math.cos(look.vignette * VIGNETTE_ANGLE), 4) : 0;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {look.desaturate > 0.01 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: '#808080', opacity: look.desaturate, mixBlendMode: 'saturation' }]} /> : null}
      {look.tint ? <View style={[StyleSheet.absoluteFill, { backgroundColor: look.tint.color, opacity: Math.min(0.8, look.tint.alpha * 1.6), mixBlendMode: 'soft-light' }]} /> : null}
      {look.light ? <View style={[StyleSheet.absoluteFill, { backgroundColor: look.light.color, opacity: look.light.alpha }]} /> : null}
      {edge > 0.01 ? <Vignette strength={edge} /> : null}
    </View>
  );
}
export function Vignette({ strength }: { strength: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="vg" cx="50" cy="50" r="71" gradientUnits="userSpaceOnUse">
          <Stop offset="0.35" stopColor="#000" stopOpacity={0} />
          <Stop offset="1" stopColor="#000" stopOpacity={Math.min(1, strength)} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#vg)" />
    </Svg>
  );
}

/** A foto já reduzida ao tamanho do palco (a Skia não guarda a foto original de 12 MP na memória). */
const photoCache = new Map<string, SkImage>();
function useStagePhoto(uri: string, w: number, h: number): SkImage | null | 'erro' {
  const pw = Math.min(1080, Math.round(w * PixelRatio.get())), ph = Math.min(1920, Math.round(h * PixelRatio.get()));
  const id = `${uri}@${pw}x${ph}`;
  const [img, setImg] = useState<SkImage | null | 'erro'>(() => photoCache.get(id) ?? null);
  useEffect(() => {
    if (!(pw > 0 && ph > 0)) return;
    const have = photoCache.get(id);
    if (have) { setImg(have); return; }
    let off = false;
    void (async () => {
      try {
        const src = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
        if (!src) throw new Error('foto');
        const surface = Skia.Surface.MakeOffscreen(pw, ph) ?? Skia.Surface.Make(pw, ph);
        if (!surface) throw new Error('superfície');
        // Cobre o palco, ao centro (com 7 % de folga para o zoom lento não mostrar as pontas).
        const sw = src.width(), sh = src.height();
        const r = Math.max(pw / sw, ph / sh);
        const cw = pw / r, ch = ph / r;
        surface.getCanvas().drawImageRect(src, Skia.XYWHRect((sw - cw) / 2, (sh - ch) / 2, cw, ch), Skia.XYWHRect(0, 0, pw, ph), Skia.Paint());
        surface.flush();
        const snap = surface.makeImageSnapshot();
        const out = snap.makeNonTextureImage() ?? snap;
        if (photoCache.size >= 8) photoCache.delete(photoCache.keys().next().value as string);
        photoCache.set(id, out);
        if (!off) setImg(out);
      } catch { if (!off) setImg('erro'); }
    })();
    return () => { off = true; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return img;
}

/** Uma foto: a matriz de cor verdadeira (Skia) e o zoom lento (o mesmo do site: 1 a 1,07, ou o enquadramento da Montagem mágica). */
function PhotoLayer({ seg, clock, w, h, pano }: { seg: StageSeg; clock: ClockStore; w: number; h: number; pano: CapulanaSpec }) {
  const img = useStagePhoto(seg.uri, w, h);
  const p = useMemo(() => resolveFx(seg.fx), [seg.fx]);
  const [z, setZ] = useState(() => photoZoom(0, seg.dur, seg.fx));
  useEffect(() => clock.subscribe((t) => {
    const n = photoZoom(clamp(t - seg.start, 0, seg.dur), seg.dur, seg.fx);
    setZ((o) => (Math.abs(o.scale - n.scale) < 0.0015 && o.x === n.x ? o : n));
  }), [clock, seg.start, seg.dur, seg.fx]);
  const look = useMemo(() => videoLook(p.matrix, p.vignette), [p]);
  const frame = !!seg.fx?.moldura;
  const content = img && img !== 'erro' && !frame ? (
    <Canvas style={{ width: w, height: h }}>
      <SkImageNode image={img} x={0} y={0} width={w} height={h} fit="cover">
        {isIdentity(p.matrix) ? null : <ColorMatrix matrix={p.matrix} />}
      </SkImageNode>
    </Canvas>
  ) : (
    <Image source={{ uri: seg.uri }} style={{ width: w, height: h }} contentFit={frame ? 'contain' : 'cover'} />
  );
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {frame ? <CapulanaSwatch spec={seg.fx!.moldura ?? pano} tile={56} style={StyleSheet.absoluteFill} /> : null}
      <View style={{ width: w, height: h, transform: [{ scale: z.scale }], transformOrigin: `${Math.round(z.x * 100)}% ${Math.round(z.y * 100)}%` } as object}>
        {content}
      </View>
      {/* Na Skia já vai a cor; a vinheta vai por cima. Sem Skia (ou na moldura), a aproximação toda. */}
      {img && img !== 'erro' && !frame ? (p.vignette > 0.01 ? <Vignette strength={1 - Math.pow(Math.cos(p.vignette * VIGNETTE_ANGLE), 4)} /> : null) : <LookLayer look={look} />}
    </View>
  );
}

/** Um vídeo: um leitor (expo-video) que segue o relógio, com o corte, a velocidade, a rampa, o inverso e o som do clipe. */
function VideoLayer({ seg, role, clock, origVol }: { seg: StageSeg; role: Role; clock: ClockStore; origVol: number }) {
  const player = useVideoPlayer({ uri: seg.uri }, (p) => {
    p.loop = false;
    p.preservesPitch = true;
    p.timeUpdateEventInterval = 0;
    limitBuffer(p, 'full');
  });
  const roleRef = useRef(role);
  roleRef.current = role;
  const volRef = useRef(origVol * seg.volume);
  volRef.current = seg.fx?.reverse ? 0 : origVol * seg.volume;
  const look = useMemo(() => { const p = resolveFx(seg.fx); return videoLook(p.matrix, p.vignette); }, [seg.fx]);
  const drive = useRef<(t: number, playing: boolean, force?: boolean) => void>(() => undefined);
  const mem = useRef({ lastSeek: 0, lastCheck: 0, lastRev: -1, parked: '' });
  drive.current = (t: number, playing: boolean, force = false) => {
      const m = mem.current;
      const p: VideoPlayer = player;
      try {
        const r = roleRef.current;
        const vol = Math.round(volRef.current * 100) / 100;
        if (Math.abs(p.volume - vol) > 0.01) p.volume = vol;
        p.muted = vol <= 0.001;
        if (r !== 'cur') {
          // O seguinte espera no início do corte; o anterior fica parado no último frame (é dele que sai a transição).
          const at = r === 'next' ? (seg.fx?.reverse ? seg.from + seg.len - 0.04 : seg.from) : seg.fx?.reverse ? seg.from : Math.max(seg.from, seg.from + seg.len - 0.05);
          if (p.playing) p.pause();
          if (m.parked !== `${r}@${at}` || force) { p.currentTime = at; m.parked = `${r}@${at}`; }
          return;
        }
        m.parked = '';
        const ms = nowMs();
        if (playing && !force && p.playing && ms - m.lastCheck < 150) return;
        m.lastCheck = ms;
        const local = clamp(t - seg.start, 0, seg.dur);
        const off = sourceOffset(local, seg.dur, seg.len, seg.speed, seg.fx);
        if (seg.fx?.reverse) {
          // Ao contrário não se toca: salta-se de frame em frame para trás (8 por segundo).
          const src = reverseStep(seg.from + seg.len - off);
          if (p.playing) p.pause();
          if (Math.abs(src - m.lastRev) > 1e-3 || force) { p.currentTime = src; m.lastRev = src; }
          return;
        }
        const src = seg.from + off;
        const rate = clamp(playbackRateAt(local, seg.dur, seg.speed, seg.fx), 0.25, 4);
        if (Math.abs(p.playbackRate - rate) > 0.02) p.playbackRate = rate;
        if (playing) {
          if (!p.playing) { p.currentTime = src; p.play(); m.lastSeek = ms; }
          else if (ms - m.lastSeek > 500 && drift(src, p.currentTime, rate, 0.3) === 'seek') { p.currentTime = src; m.lastSeek = ms; }
        } else {
          if (p.playing) p.pause();
          if ((force || ms - m.lastSeek > 50) && Math.abs(p.currentTime - src) > 0.035) { p.currentTime = src; m.lastSeek = ms; }
        }
      } catch { /* leitor ainda a carregar ou já libertado */ }
  };
  useEffect(() => clock.subscribe((t, playing) => drive.current(t, playing)), [clock, player]);
  useEffect(() => { drive.current(clock.time(), clock.playing(), true); }, [role, seg.from, seg.len, seg.start, seg.dur, seg.speed, seg.fx, clock]);
  useEffect(() => () => { try { player.pause(); } catch { /* já libertado */ } }, [player]);
  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} surfaceType={Platform.OS === 'android' ? 'textureView' : undefined} allowsPictureInPicture={false} />
      <LookLayer look={look} />
    </View>
  );
}

/** O vídeo do dueto (o original), a tocar desde o início com o relógio. */
function ReferenceLayer({ uri, clock, volume }: { uri: string; clock: ClockStore; volume: number }) {
  const player = useVideoPlayer({ uri }, (p) => { p.loop = false; limitBuffer(p, 'full'); });
  useEffect(() => {
    let last = 0;
    return clock.subscribe((t, playing) => {
      try {
        player.volume = volume;
        if (playing) {
          if (!player.playing) { player.currentTime = t; player.play(); last = nowMs(); }
          else if (nowMs() - last > 600 && drift(t, player.currentTime) === 'seek') { player.currentTime = t; last = nowMs(); }
        } else { if (player.playing) player.pause(); if (Math.abs(player.currentTime - t) > 0.05) player.currentTime = t; }
      } catch { /* a carregar */ }
    });
  }, [clock, player, volume]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} surfaceType={Platform.OS === 'android' ? 'textureView' : undefined} />;
}

/** Os estilos de um clipe durante uma transição (o anterior e o que entra), a partir do progresso `p`. */
function transitionStyles(type: string, p: number, W: number, H: number): { prev: object; cur: object; flash: number; pano: boolean } {
  const e = easeInOutCubic(p);
  switch (type) {
    case 'deslizar-esquerda': return { prev: { transform: [{ translateX: -e * W }] }, cur: { transform: [{ translateX: (1 - e) * W }] }, flash: 0, pano: false };
    case 'deslizar-direita': return { prev: { transform: [{ translateX: e * W }] }, cur: { transform: [{ translateX: -(1 - e) * W }] }, flash: 0, pano: false };
    case 'deslizar-cima': return { prev: { transform: [{ translateY: -e * H }] }, cur: { transform: [{ translateY: (1 - e) * H }] }, flash: 0, pano: false };
    case 'deslizar-baixo': return { prev: { transform: [{ translateY: e * H }] }, cur: { transform: [{ translateY: -(1 - e) * H }] }, flash: 0, pano: false };
    case 'zoom': return { prev: { opacity: 1 - e, transform: [{ scale: 1 + 1.2 * e }] }, cur: { transform: [{ scale: 1.4 - 0.4 * e }] }, flash: 0, pano: false };
    case 'girar': return { prev: { opacity: e < 0.5 ? 1 : 0, transform: [{ rotate: `${180 * e}deg` }, { scale: 1.8 }] }, cur: { transform: [{ rotate: `${-90 * (1 - e)}deg` }, { scale: 1 + 0.8 * (1 - e) }] }, flash: 0, pano: false };
    case 'flash': return { prev: { opacity: e < 0.5 ? 1 : 0 }, cur: {}, flash: Math.pow(Math.sin(Math.PI * p), 1.6), pano: false };
    default:
      return { prev: { opacity: 1 - e }, cur: {}, flash: type === 'brilho' ? 0.25 * Math.sin(Math.PI * p) : 0, pano: type.startsWith('capulana-') };
  }
}

/**
 * A pré-visualização nativa: os clipes tocam cada um no seu leitor (o de agora, o anterior durante a transição e o seguinte à
 * espera, já carregado), todos a seguir o relógio do projeto. As fotos levam a matriz de cor verdadeira; os vídeos uma
 * aproximação do filtro (o vídeo montado leva-o completo). As transições aproximam o desenho do site.
 */
export function NativeStage({ segs, clock, W, H, origVol, pano, reference, refVolume }: {
  segs: StageSeg[];
  clock: ClockStore;
  W: number;
  H: number;
  origVol: number;
  pano: CapulanaSpec;
  reference?: { uri: string } | null;
  refVolume: number;
}) {
  const [state, setState] = useState<{ i: number; tr: { type: string; p: number } | null }>({ i: 0, tr: null });
  const segsRef = useRef(segs);
  segsRef.current = segs;
  useEffect(() => {
    const look = (t: number) => {
      const list = segsRef.current;
      const { index, local } = segAt(list, t);
      const s = list[index];
      const tr = s ? transitionAt(local, transitionFor(s.fx, index, s.dur), index) : null;
      setState((o) => (o.i === index && !o.tr && !tr ? o : { i: index, tr: tr ? { type: tr.type, p: Math.round(tr.p * 60) / 60 } : null }));
    };
    look(clock.time());
    return clock.subscribe(look);
  }, [clock, segs]);
  if (!segs.length || !(W > 0 && H > 0)) return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />;
  const i = Math.min(state.i, segs.length - 1);
  const tr = state.tr && i > 0 ? transitionStyles(state.tr.type, state.tr.p, W, H) : null;
  // Num dueto a tcheka fica na metade esquerda (num quadro 9:16 ao meio) e o original na direita, como no vídeo final.
  const duet = !!reference;
  const bw = duet ? W / 2 : W, bh = duet ? Math.min(H, (W / 2) * (16 / 9)) : H;
  const layer = (k: number, role: Role, style: object | null) => {
    const s = segs[k];
    if (!s) return null;
    return (
      <View key={`${s.key}|${s.uri}`} style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, role === 'next' && { opacity: 0 }, style]} pointerEvents="none">
        {s.video ? <VideoLayer seg={s} role={role} clock={clock} origVol={origVol} /> : <PhotoLayer seg={s} clock={clock} w={bw} h={bh} pano={pano} />}
      </View>
    );
  };
  const panoBand = tr?.pano && state.tr ? (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, width: bw * 0.7, left: -bw * 0.7 + easeInOutCubic(state.tr.p) * bw * 1.7 }}>
      <CapulanaSwatch spec={segs[i]?.fx?.transition?.pano ?? pano} tile={48} style={StyleSheet.absoluteFill} />
    </View>
  ) : null;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} pointerEvents="none">
      <View style={duet ? { position: 'absolute', left: 0, top: (H - bh) / 2, width: bw, height: bh, overflow: 'hidden' } : [StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
        {layer(i + 1, 'next', null)}
        {layer(i, 'cur', tr?.cur ?? null)}
        {tr ? layer(i - 1, 'prev', tr.prev) : null}
        {panoBand}
        {tr && tr.flash > 0.01 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: tr.flash }]} /> : null}
      </View>
      {duet && reference ? (
        <View style={{ position: 'absolute', left: W / 2, top: (H - bh) / 2, width: bw, height: bh, overflow: 'hidden' }}>
          <ReferenceLayer uri={reference.uri} clock={clock} volume={refVolume} />
        </View>
      ) : null}
    </View>
  );
}

/** «A imagem final fica com o filtro completo»: o aviso honesto por baixo da pré-visualização, quando um vídeo tem filtro. */
export function LookNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', paddingHorizontal: 16 }} numberOfLines={2}>Nos vídeos o filtro aqui é aproximado: a imagem final fica com o filtro completo.</Text>;
}
