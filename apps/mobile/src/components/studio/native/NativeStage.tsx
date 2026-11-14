import { ColorMatrix, Canvas, Image as SkImageNode, Skia, TileMode, type SkImage } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { CapulanaSpec } from '@/lib/studio/capulana';
import { isIdentity, playbackRateAt, resolveFx, sourceOffset, transitionFor, VIGNETTE_ANGLE, type ClipFx } from '@/lib/studio/effects';
import { BLUR_DIM_MATRIX, blurSigma, clipFit, containRect, coverSource, type ClipFit, type FitRect } from '@/lib/studio/fit';
import { videoLook, type VideoLook } from '@/lib/studio/nativeLook';
import { skiaVideoOk } from '@/lib/studio/nativeVideoFx';
import { clockAt, drift, photoZoom, reverseStep, segAt, smoothNow, transitionAt, transitionLook, transitionProgress, type ClockAnchor } from '@/lib/studio/previewClock';
import { limitBuffer } from '@/lib/videoMemory';
import { CapulanaSwatch } from '../CapulanaSwatch';
import type { ClockStore } from './clockStore';
import { mediaSize, rememberSize, useMediaSizes } from './mediaSize';
import { cachedVideoThumb } from './NativeTimeline';
import { canOpenSkia, fxEffect, onSkiaFail, resetSkiaVideos, skiaFailed, SkiaPhoto, SkiaVideoLayer } from './SkiaVideo';

/** Os vídeos com o filtro completo pela Skia (false: todos pelo caminho antigo, o expo-video com as camadas). */
const SKIA_VIDEO = true;

/** Um bocado da sequência como a pré-visualização o toca. `volume`: o som do próprio vídeo (0 se calado ou ao contrário). */
export interface StageSeg {
  key: string; uri: string; video: boolean; start: number; dur: number; from: number; len: number; speed: number; fx?: ClipFx; volume: number;
  /** O som original com o efeito de voz (preparado no servidor; os mesmos tempos do ficheiro). */
  soundUri?: string | null;
  /** A duração do ficheiro do vídeo (s), para a miniatura enquanto o primeiro frame não chega. */
  length?: number;
  /** «Encher» (`cover`) ou «Inteiro» (`blur`) escolhido pela pessoa; sem ele, o automático (lib/studio/fit.ts). */
  fit?: ClipFit;
}

/**
 * O tempo do projeto no fio da interface, frame a frame: a âncora do relógio (`clock.onAnchor`, que só muda ao tocar,
 * pausar ou saltar) e o relógio de parede liso do vsync (`smoothNow`). O zoom das fotos e as transições leem daqui, sem
 * passar pelo JS a cada tique.
 */
function useStageTime(clock: ClockStore): SharedValue<number> {
  const anchor = useSharedValue<ClockAnchor>(clock.anchor());
  const t = useSharedValue(clockAt(clock.anchor(), Date.now()));
  const smooth = useSharedValue(0);
  const cb = useFrameCallback((info) => {
    'worklet';
    const now = smoothNow(smooth.value, info.timeSincePreviousFrame ?? 0, Date.now());
    smooth.value = now;
    t.value = clockAt(anchor.value, now);
  }, false);
  useEffect(() => clock.onAnchor((a) => {
    anchor.value = a;
    if (!a.playing) t.value = a.base;
    cb.setActive(a.playing);
  }), [clock]); // eslint-disable-line react-hooks/exhaustive-deps
  return t;
}
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

/**
 * A foto já reduzida ao tamanho do palco (a Skia não guarda a foto original de 12 MP na memória), preparada: `img` a cobrir o palco (no «Inteiro», o fundo já desfocado e escurecido) e, no «Inteiro»,
 * `fg` com a foto inteira e o retângulo onde fica (em pontos do palco).
 */
interface StagePhoto { img: SkImage; fit: ClipFit; fg: { img: SkImage; rect: FitRect } | null }
const photoCache = new Map<string, StagePhoto>();
function snapshot(surface: ReturnType<typeof Skia.Surface.MakeOffscreen>): SkImage {
  surface!.flush();
  const snap = surface!.makeImageSnapshot();
  return snap.makeNonTextureImage() ?? snap;
}
function useStagePhoto(uri: string, w: number, h: number, want: ClipFit | undefined, focus: boolean): StagePhoto | null | 'erro' {
  const pd = PixelRatio.get();
  const pw = Math.min(1080, Math.round(w * pd)), ph = Math.min(1920, Math.round(h * pd));
  const id = `${uri}@${pw}x${ph}|${want ?? 'auto'}|${focus ? 'f' : ''}`;
  const [img, setImg] = useState<StagePhoto | null | 'erro'>(() => photoCache.get(id) ?? null);
  useEffect(() => {
    if (!(pw > 0 && ph > 0)) return;
    const have = photoCache.get(id);
    if (have) { setImg(have); return; }
    let off = false;
    void (async () => {
      try {
        const src = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
        if (!src) throw new Error('foto');
        const sw = src.width(), sh = src.height();
        rememberSize(uri, sw, sh);
        const fit = clipFit({ fit: want, video: false, fx: focus ? { focus: true } : null }, sw, sh);
        const surface = Skia.Surface.MakeOffscreen(pw, ph) ?? Skia.Surface.Make(pw, ph);
        if (!surface) throw new Error('superfície');
        // Cobre o palco, ao centro. No «Inteiro» este é o fundo: desfocado (sigma 40 em 1080, à escala) e a 70 % do brilho.
        const c = coverSource(sw, sh, pw, ph);
        const paint = Skia.Paint();
        if (fit === 'blur') {
          const s = blurSigma(pw);
          paint.setImageFilter(Skia.ImageFilter.MakeBlur(s, s, TileMode.Clamp, null));
          paint.setColorFilter(Skia.ColorFilter.MakeMatrix([...BLUR_DIM_MATRIX]));
        }
        surface.getCanvas().drawImageRect(src, Skia.XYWHRect(c.x, c.y, c.w, c.h), Skia.XYWHRect(0, 0, pw, ph), paint);
        const bg = snapshot(surface);
        let fg: StagePhoto['fg'] = null;
        if (fit === 'blur') {
          // A foto inteira, do tamanho em que fica no palco (contida, ao centro).
          const r = containRect(sw, sh, pw, ph);
          const fw = Math.max(1, Math.round(r.w)), fh = Math.max(1, Math.round(r.h));
          const fs = Skia.Surface.MakeOffscreen(fw, fh) ?? Skia.Surface.Make(fw, fh);
          if (!fs) throw new Error('superfície');
          fs.getCanvas().drawImageRect(src, Skia.XYWHRect(0, 0, sw, sh), Skia.XYWHRect(0, 0, fw, fh), Skia.Paint());
          fg = { img: snapshot(fs), rect: { x: r.x / pd, y: r.y / pd, w: r.w / pd, h: r.h / pd } };
        }
        const out: StagePhoto = { img: bg, fit, fg };
        if (photoCache.size >= 8) photoCache.delete(photoCache.keys().next().value as string);
        photoCache.set(id, out);
        if (!off) setImg(out);
      } catch { if (!off) setImg('erro'); }
    })();
    return () => { off = true; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return img;
}

/** O zoom lento (Ken Burns) num retângulo `bw`×`bh`, no fio da interface: a escala à volta do ponto (x, y) de `photoZoom`. */
function useZoomStyle(t: SharedValue<number>, start: number, dur: number, fx: { freeze?: unknown; focus?: { x: number; y: number; from: number; to: number } } | null, bw: number, bh: number) {
  return useAnimatedStyle(() => {
    const z = photoZoom(Math.min(dur, Math.max(0, t.value - start)), dur, fx);
    const s = z.scale;
    // Sem `transformOrigin` (arredondado a %): a mesma conta com translações em pontos, sem degraus.
    return { transform: [{ translateX: (1 - s) * (z.x * bw - bw / 2) }, { translateY: (1 - s) * (z.y * bh - bh / 2) }, { scale: s }] };
  }, [start, dur, fx, bw, bh]);
}

/**
 * Uma foto: a matriz de cor verdadeira (Skia) e o zoom lento (o mesmo do site: 1 a 1,07, ou o enquadramento da Montagem
 * mágica), frame a frame no fio da interface. No «Inteiro» o fundo desfocado fica parado e o zoom é só na foto da frente.
 */
function PhotoLayer({ seg, t, w, h, pano }: { seg: StageSeg; t: SharedValue<number>; w: number; h: number; pano: CapulanaSpec }) {
  const frame = !!seg.fx?.moldura;
  const ph = useStagePhoto(seg.uri, w, h, seg.fit, !!seg.fx?.focus && !seg.fx?.freeze);
  const ready = ph && ph !== 'erro' ? ph : null;
  const p = useMemo(() => resolveFx(seg.fx), [seg.fx]);
  const fg = ready && !frame ? ready.fg : null;
  // No «Inteiro» o zoom é ao centro da foto da frente (sem o enquadramento); um frame congelado fica parado.
  const zfx = useMemo(() => (fg ? (seg.fx?.freeze ? { freeze: true } : null) : seg.fx ? { freeze: seg.fx.freeze, focus: seg.fx.focus } : null), [fg, seg.fx]);
  const bw = fg ? fg.rect.w : w, bh = fg ? fg.rect.h : h;
  const zoom = useZoomStyle(t, seg.start, seg.dur, zfx, bw, bh);
  const look = useMemo(() => videoLook(p.matrix, p.vignette), [p]);
  // No «Inteiro» a vinheta é do quadro inteiro (por cima), não de cada imagem.
  const pFg = useMemo(() => (fg && p.vignette > 0 ? { ...p, vignette: 0 } : p), [fg, p]);
  const shader = !!fxEffect();
  const skImage = (image: SkImage, iw: number, ih: number, q: typeof p) => (shader ? (
    <SkiaPhoto image={image} p={q} w={iw} h={ih} />
  ) : (
    <Canvas style={{ width: iw, height: ih }}>
      <SkImageNode image={image} x={0} y={0} width={iw} height={ih} fit="cover">
        {isIdentity(q.matrix) ? null : <ColorMatrix matrix={q.matrix} />}
      </SkImageNode>
    </Canvas>
  ));
  const vignette = p.vignette > 0.01 ? <Vignette strength={1 - Math.pow(Math.cos(p.vignette * VIGNETTE_ANGLE), 4)} /> : null;
  if (ready && !frame && fg) {
    return (
      <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
        {skImage(ready.img, w, h, pFg)}
        <View style={{ position: 'absolute', left: fg.rect.x, top: fg.rect.y, width: fg.rect.w, height: fg.rect.h, overflow: 'hidden' }}>
          <Animated.View style={[{ width: fg.rect.w, height: fg.rect.h }, zoom]}>{skImage(fg.img, fg.rect.w, fg.rect.h, pFg)}</Animated.View>
        </View>
        {vignette}
      </View>
    );
  }
  const content = ready && !frame ? skImage(ready.img, w, h, p) : (
    <Image source={{ uri: seg.uri }} style={{ width: w, height: h }} contentFit={frame ? 'contain' : 'cover'} />
  );
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {frame ? <CapulanaSwatch spec={seg.fx!.moldura ?? pano} tile={56} style={StyleSheet.absoluteFill} /> : null}
      <Animated.View style={[{ width: w, height: h }, zoom]}>
        {content}
      </Animated.View>
      {/* Na Skia já vai a cor (e, com o shader, a vinheta, a nitidez e o grão); sem o shader, a vinheta vai por cima. Sem Skia (ou na moldura), a aproximação toda. */}
      {ready && !frame ? (!shader ? vignette : null) : <LookLayer look={look} />}
    </View>
  );
}

/**
 * Põe um leitor do expo-video a seguir o relógio: o corte, a velocidade, a rampa e o inverso. `volume`: o som que o leitor
 * deve ter (0 = calado). Serve ao vídeo do caminho antigo e ao som dos clipes (o leitor sem imagem, `ClipAudio`).
 */
function useClockPlayer(player: VideoPlayer, seg: StageSeg, role: Role, clock: ClockStore, volume: number) {
  const roleRef = useRef(role);
  roleRef.current = role;
  const volRef = useRef(volume);
  volRef.current = seg.fx?.reverse ? 0 : volume;
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
  useEffect(() => { drive.current(clock.time(), clock.playing(), true); }, [role, seg.from, seg.len, seg.start, seg.dur, seg.speed, seg.fx, volume, clock]);
  useEffect(() => () => { try { player.pause(); } catch { /* já libertado */ } }, [player]);
}

const setupPlayer = (p: VideoPlayer) => {
  p.loop = false;
  p.preservesPitch = true;
  p.timeUpdateEventInterval = 0;
};

/** O vídeo pelo caminho antigo (expo-video), com as camadas que aproximam o filtro. `volume` 0 quando o som vai à parte. */
function LegacyVideoLayer({ seg, role, clock, volume, poster, w }: { seg: StageSeg; role: Role; clock: ClockStore; volume: number; poster: { uri?: string; width?: number; height?: number } | null; w: number }) {
  const player = useVideoPlayer({ uri: seg.uri }, (p) => { setupPlayer(p); limitBuffer(p, 'full'); });
  useClockPlayer(player, seg, role, clock, volume);
  const look = useMemo(() => { const p = resolveFx(seg.fx); return videoLook(p.matrix, p.vignette); }, [seg.fx]);
  // «Inteiro» pelo caminho antigo: o vídeo contido e, por trás, a miniatura desfocada e escurecida (uma aproximação parada).
  useMediaSizes();
  const size = mediaSize(seg.uri) ?? (poster?.width && poster?.height ? { w: poster.width, h: poster.height } : null);
  const fit = size ? clipFit({ fit: seg.fit, video: true }, size.w, size.h) : seg.fit ?? 'cover';
  useEffect(() => { if (poster?.width && poster?.height && !mediaSize(seg.uri)) rememberSize(seg.uri, poster.width, poster.height); }, [poster, seg.uri]);
  return (
    <View style={StyleSheet.absoluteFill}>
      {fit === 'blur' && poster?.uri ? (
        <>
          <Image source={poster as never} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={Math.max(4, Math.round(blurSigma(w) / 2))} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: 1 - BLUR_DIM_MATRIX[0] }]} />
        </>
      ) : null}
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fit === 'blur' ? 'contain' : 'cover'} nativeControls={false} surfaceType={Platform.OS === 'android' ? 'textureView' : undefined} allowsPictureInPicture={false} />
      <LookLayer look={look} />
    </View>
  );
}

/**
 * O som de um clipe sem imagem: o ficheiro do vídeo, ou o som com o efeito de voz que o servidor preparou (`seg.soundUri`,
 * com os mesmos tempos do original). Segue o relógio como o vídeo (corte, velocidade, rampa).
 */
function ClipAudio({ seg, uri, role, clock, volume }: { seg: StageSeg; uri: string; role: Role; clock: ClockStore; volume: number }) {
  const player = useVideoPlayer({ uri }, (p) => { setupPlayer(p); limitBuffer(p, 'full'); });
  useClockPlayer(player, seg, role, clock, volume);
  return null;
}

/** Os vídeos que estão no caminho antigo por ter falhado na Skia mudam (para o aviso do filtro aproximado). */
export function useSkiaFailures(): number {
  const [n, setN] = useState(0);
  useEffect(() => onSkiaFail(() => setN((x) => x + 1)), []);
  return n;
}
/** Este clipe vai pela Skia (com o filtro completo)? */
export function skiaClip(seg: Pick<StageSeg, 'uri' | 'speed' | 'fx'>): boolean {
  return SKIA_VIDEO && !!fxEffect() && skiaVideoOk({ os: Platform.OS, version: Platform.Version, reverse: seg.fx?.reverse, speed: seg.speed, ramp: seg.fx?.ramp }) && !skiaFailed(seg.uri);
}

/**
 * Um vídeo: a imagem pela Skia (o filtro completo, `SkiaVideoLayer`) e o som num leitor à parte (`ClipAudio`); se a Skia
 * não servir para este clipe (ao contrário, iPhone com outra velocidade, um ficheiro que não abre), o caminho antigo.
 */
function VideoLayer({ seg, role, clock, origVol, w, h }: { seg: StageSeg; role: Role; clock: ClockStore; origVol: number; w: number; h: number }) {
  const [legacy, setLegacy] = useState(() => !skiaClip(seg) || !canOpenSkia(seg.uri));
  useEffect(() => { if (!legacy && !skiaClip(seg)) setLegacy(true); }, [seg.speed, seg.fx]); // eslint-disable-line react-hooks/exhaustive-deps
  const volume = seg.fx?.reverse ? 0 : origVol * seg.volume;
  // Com efeito no som original, o som vem do ficheiro que o servidor preparou e o vídeo fica calado.
  const sound = seg.soundUri && volume > 0.001 ? seg.soundUri : null;
  const poster = useMemo(() => (seg.length ? cachedVideoThumb(seg.uri, seg.length, seg.from) : null), [seg.uri, seg.length, seg.from]);
  if (legacy) {
    return (
      <>
        <LegacyVideoLayer seg={seg} role={role} clock={clock} volume={sound ? 0 : volume} poster={poster as { uri?: string; width?: number; height?: number } | null} w={w} />
        {sound && role !== 'prev' ? <ClipAudio key={sound} seg={seg} uri={sound} role={role} clock={clock} volume={volume} /> : null}
      </>
    );
  }
  const audio = sound ?? (volume > 0.001 ? seg.uri : null);
  return (
    <>
      <SkiaVideoLayer seg={seg} role={role} clock={clock} w={w} h={h} poster={poster} onFail={() => setLegacy(true)} />
      {audio && role !== 'prev' ? <ClipAudio key={audio} seg={seg} uri={audio} role={role} clock={clock} volume={volume} /> : null}
    </>
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

/** A transição que está a decorrer (o tipo, quando começa o clipe que entra e quanto dura): o progresso faz-se no fio da interface. */
interface StageTransition { type: string; start: number; dur: number }

/**
 * A caixa de um clipe no palco, com o estilo da transição frame a frame no fio da interface (`transitionLook`). Antes o
 * progresso ia pelo estado do React a cada tique: o palco inteiro voltava a desenhar-se 60 vezes por segundo durante a
 * transição e qualquer atraso do JS via-se como um soluço.
 */
function StageLayer({ role, tr, t, W, H, children }: { role: Role; tr: StageTransition | null; t: SharedValue<number>; W: number; H: number; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => {
    if (role === 'next') return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }, { scale: 1 }] };
    if (!tr) return { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }, { scale: 1 }] };
    const look = transitionLook(tr.type, transitionProgress(t.value, tr.start, tr.dur), W, H);
    const l = role === 'prev' ? look.prev : look.cur;
    return { opacity: l.opacity, transform: [{ translateX: l.translateX }, { translateY: l.translateY }, { rotate: `${l.rotate}deg` }, { scale: l.scale }] };
  }, [role, tr, W, H]);
  return <Animated.View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, style]} pointerEvents="none">{children}</Animated.View>;
}

/** O branco do flash e do brilho e a faixa de pano das transições de capulana, frame a frame. */
function TransitionExtras({ tr, t, W, H, spec }: { tr: StageTransition; t: SharedValue<number>; W: number; H: number; spec: CapulanaSpec }) {
  const flash = useAnimatedStyle(() => ({ opacity: transitionLook(tr.type, transitionProgress(t.value, tr.start, tr.dur), W, H).flash }), [tr, W, H]);
  const band = useAnimatedStyle(() => {
    const p = transitionLook(tr.type, transitionProgress(t.value, tr.start, tr.dur), W, H).pano;
    return { transform: [{ translateX: (p ?? -1) * W }] };
  }, [tr, W, H]);
  const pano = tr.type.startsWith('capulana-');
  const flashes = tr.type === 'flash' || tr.type === 'brilho';
  return (
    <>
      {pano ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: W * 0.7 }, band]}>
          <CapulanaSwatch spec={spec} tile={48} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
      {flashes ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }, flash]} /> : null}
    </>
  );
}

/**
 * A pré-visualização nativa: os clipes tocam cada um no seu leitor (o de agora, o anterior durante a transição e o seguinte à
 * espera, já carregado), todos a seguir o relógio do projeto. As fotos e os vídeos levam o filtro completo pela Skia (o shader
 * do site: SkiaVideo.tsx); os vídeos que não vão pela Skia, uma aproximação. As transições aproximam o desenho do site.
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
  // O JS só diz qual é o clipe de agora e se há uma transição a decorrer (muda poucas vezes); o progresso é do fio da interface.
  const [state, setState] = useState<{ i: number; tr: StageTransition | null }>({ i: 0, tr: null });
  const segsRef = useRef(segs);
  segsRef.current = segs;
  const t = useStageTime(clock);
  // Ao fechar o estúdio, os vídeos da Skia parados largam-se.
  useEffect(() => () => resetSkiaVideos(), []);
  useEffect(() => {
    const look = (now: number) => {
      const list = segsRef.current;
      const { index, local } = segAt(list, now);
      const s = list[index];
      const def = s ? transitionFor(s.fx, index, s.dur) : null;
      const tr = s && def && transitionAt(local, def, index) ? { type: def.type, start: s.start, dur: def.dur } : null;
      setState((o) => (o.i === index && o.tr?.type === tr?.type && o.tr?.start === tr?.start && o.tr?.dur === tr?.dur ? o : { i: index, tr }));
    };
    look(clock.time());
    return clock.subscribe(look);
  }, [clock, segs]);
  if (!segs.length || !(W > 0 && H > 0)) return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />;
  const i = Math.min(state.i, segs.length - 1);
  const tr = state.tr && i > 0 ? state.tr : null;
  // Num dueto a tcheka fica na metade esquerda (num quadro 9:16 ao meio) e o original na direita, como no vídeo final.
  const duet = !!reference;
  const bw = duet ? W / 2 : W, bh = duet ? Math.min(H, (W / 2) * (16 / 9)) : H;
  const layer = (k: number, role: Role) => {
    const s = segs[k];
    if (!s) return null;
    return (
      <StageLayer key={`${s.key}|${s.uri}`} role={role} tr={role === 'next' ? null : tr} t={t} W={bw} H={bh}>
        {s.video ? <VideoLayer seg={s} role={role} clock={clock} origVol={origVol} w={bw} h={bh} /> : <PhotoLayer seg={s} t={t} w={bw} h={bh} pano={pano} />}
      </StageLayer>
    );
  };
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} pointerEvents="none">
      <View style={duet ? { position: 'absolute', left: 0, top: (H - bh) / 2, width: bw, height: bh, overflow: 'hidden' } : [StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
        {layer(i + 1, 'next')}
        {layer(i, 'cur')}
        {tr ? layer(i - 1, 'prev') : null}
        {tr ? <TransitionExtras tr={tr} t={t} W={bw} H={bh} spec={segs[i]?.fx?.transition?.pano ?? pano} /> : null}
      </View>
      {duet && reference ? (
        <View style={{ position: 'absolute', left: W / 2, top: (H - bh) / 2, width: bw, height: bh, overflow: 'hidden' }}>
          <ReferenceLayer uri={reference.uri} clock={clock} volume={refVolume} />
        </View>
      ) : null}
    </View>
  );
}

/** «A imagem final fica com o filtro completo»: o aviso honesto por baixo da pré-visualização, quando um vídeo com filtro não vai pela Skia. */
export function LookNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', paddingHorizontal: 16 }} numberOfLines={2}>Nos vídeos o filtro aqui é aproximado: a imagem final fica com o filtro completo.</Text>;
}
