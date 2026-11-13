/**
 * O filtro completo na pré-visualização nativa: o frame do vídeo (ou a foto) desenhado num Canvas da Skia, do tamanho da
 * imagem no ecrã, com o mesmo shader do site (lib/studio/nativeVideoFx.ts: nitidez, matriz de cor, vinheta e grão).
 *
 * Os vídeos abrem-se com o `Skia.Video` (o mesmo objeto do `useVideo` da Skia 2.14), mas o ritmo é nosso: o `useVideo` no
 * Android descodifica um frame por cada frame do ecrã, sem olhar para o tempo, e não tem velocidade. Aqui, em cada frame do
 * ecrã (no fio da interface), vê-se onde o relógio do estúdio quer o vídeo (`wantMs`) e pede-se só o que falta
 * (`androidPace`); no iPhone o AVPlayer toca a 1× e corrige-se com saltos exatos (`applePace`). O vídeo da Skia vai sempre
 * calado: o som do clipe toca à parte (`ClipAudio` em NativeStage), com a velocidade e o efeito de voz.
 *
 * Se o ficheiro não abrir (ou não der um frame em 5 s), `onFail` passa o clipe para o caminho antigo (expo-video com as
 * camadas aproximadas) e o erro fica registado.
 */
import { Canvas, Fill, ImageShader, Shader, Skia, type SkImage, type SkRuntimeEffect, type Video } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { createWorkletRuntime, scheduleOnRN, scheduleOnRuntime, scheduleOnUI, type WorkletRuntime } from 'react-native-worklets';
import { playbackRateAt, resolveFx, sourceOffset, type FxParams } from '@/lib/studio/effects';
import { androidPace, applePace, coverTransform, FX_SKSL, fxUniforms, grainSeed, wantMs } from '@/lib/studio/nativeVideoFx';
import type { ClockStore } from './clockStore';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const IS_ANDROID = Platform.OS === 'android';

let effect: SkRuntimeEffect | null | undefined;
/** O shader do filtro (null se a Skia não o compilar: aí fica o caminho antigo). */
export function fxEffect(): SkRuntimeEffect | null {
  if (effect === undefined) {
    try { effect = Skia.RuntimeEffect.Make(FX_SKSL); } catch { effect = null; }
    if (!effect) console.warn('[estúdio] o shader do filtro não compilou: os vídeos ficam com o filtro aproximado');
  }
  return effect;
}

// ------------------------------------------------------------------ os vídeos falhados e o limite da sessão

const failed = new Set<string>();
const failListeners = new Set<() => void>();
let failures = 0;
let opened = 0;
/**
 * Quantos vídeos da Skia se abrem por estúdio. No Android o objeto da Skia não liberta o descodificador quando se larga
 * (fica para o recolhedor do Java), por isso os vídeos guardam-se e reutilizam-se (`pool`) e há um teto: depois dele, os
 * clipes seguintes vão pelo caminho antigo.
 */
const MAX_OPEN = 12;
const POOL_IDLE = 4;

/** Este ficheiro já falhou na Skia (ou a sessão deixou de a usar)? */
export const skiaFailed = (uri: string) => failed.has(uri) || failures >= 2;
export function onSkiaFail(fn: () => void) { failListeners.add(fn); return () => { failListeners.delete(fn); }; }
function markFailed(uri: string, why: string) {
  console.warn(`[estúdio] vídeo da Skia: ${why} (${uri.slice(-48)}); fica o leitor antigo`);
  if (!failed.has(uri)) { failed.add(uri); failures += 1; }
  for (const f of failListeners) f();
}

interface Meta { video: Video; iw: number; ih: number; rot: number; dur: number; fps: number }
interface Entry { meta: Meta; uri: string; used: boolean; at: number }
const pool: Entry[] = [];
const disposeOnUI = (v: Video) => { try { scheduleOnUI((x: Video) => { 'worklet'; try { x.pause(); x.dispose(); } catch { /* já saiu */ } }, v); } catch { /* sem UI */ } };
function take(uri: string): Meta | null {
  const e = pool.find((x) => x.uri === uri && !x.used);
  if (!e) return null;
  e.used = true;
  return e.meta;
}
function give(uri: string, meta: Meta) {
  let e = pool.find((x) => x.meta === meta);
  if (!e) { e = { meta, uri, used: false, at: Date.now() }; pool.push(e); }
  e.used = false;
  e.at = Date.now();
  try { scheduleOnUI((x: Video) => { 'worklet'; try { x.pause(); } catch { /* já saiu */ } }, meta.video); } catch { /* sem UI */ }
  const idle = pool.filter((x) => !x.used).sort((a, b) => a.at - b.at);
  while (idle.length > POOL_IDLE) {
    const old = idle.shift()!;
    pool.splice(pool.indexOf(old), 1);
    disposeOnUI(old.meta.video);
  }
}
/** Fecha o estúdio: larga os vídeos parados e volta a deixar abrir (o teto é por estúdio). */
export function resetSkiaVideos() {
  for (let i = pool.length - 1; i >= 0; i--) if (!pool[i].used) { disposeOnUI(pool[i].meta.video); pool.splice(i, 1); }
  opened = pool.length;
}
/** Ainda se pode abrir mais um vídeo na Skia? */
export const canOpenSkia = (uri: string) => !skiaFailed(uri) && (opened < MAX_OPEN || pool.some((x) => x.uri === uri && !x.used));

let runtime: WorkletRuntime | null = null;
const rt = () => (runtime ??= createWorkletRuntime({ name: 'estudio-video' }));

/** Abre (ou reutiliza) o vídeo da Skia de `uri`, fora do fio do JS (abrir o descodificador demora). */
function useSkiaVideoFile(uri: string, onFail: (why: string) => void): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(null);
  const failRef = useRef(onFail);
  failRef.current = onFail;
  useEffect(() => {
    let off = false;
    let mine: Meta | null = take(uri);
    if (mine) { setMeta(mine); }
    else {
      opened += 1;
      const ok = (video: Video, iw: number, ih: number, rot: number, dur: number, fps: number) => {
        const m: Meta = { video, iw, ih, rot, dur, fps: fps > 1 && fps < 241 ? fps : 30 };
        if (off) { give(uri, m); return; }
        if (!(iw > 0 && ih > 0)) { disposeOnUI(video); failRef.current('sem tamanho'); return; }
        mine = m;
        setMeta(m);
      };
      const bad = (why: string) => { if (!off) failRef.current(`não abriu: ${why}`); };
      try {
        scheduleOnRuntime(rt(), (src: string) => {
          'worklet';
          try {
            const v = Skia.Video(src) as Video;
            const s = v.size();
            v.setVolume(0);
            v.setLooping(true);
            scheduleOnRN(ok, v, s.width, s.height, v.rotation(), v.duration(), v.framerate());
          } catch (e) {
            scheduleOnRN(bad, String((e as Error)?.message ?? e));
          }
        }, uri);
      } catch (e) { bad(String((e as Error)?.message ?? e)); }
    }
    return () => { off = true; if (mine) give(uri, mine); setMeta(null); };
  }, [uri]);
  return meta;
}

/** O que o leitor da Skia precisa de saber de um clipe (os mesmos campos do `StageSeg`). */
export interface SkiaSeg { uri: string; start: number; dur: number; from: number; len: number; speed: number; fx?: import('@/lib/studio/effects').ClipFx }
type Role = 'cur' | 'prev' | 'next';

/**
 * Um vídeo pela Skia, com o filtro completo. `w`×`h`: o palco (o Canvas é deste tamanho, não 1080×1920). `poster`: a
 * miniatura que se vê enquanto o primeiro frame não chega.
 */
export function SkiaVideoLayer({ seg, role, clock, w, h, poster, onFail }: { seg: SkiaSeg; role: Role; clock: ClockStore; w: number; h: number; poster?: object | null; onFail: () => void }) {
  const fail = (why: string) => { markFailed(seg.uri, why); onFail(); };
  const meta = useSkiaVideoFile(seg.uri, fail);
  const p: FxParams = useMemo(() => resolveFx(seg.fx), [seg.fx]);
  const frame = useSharedValue<SkImage | null>(null);
  const target = useSharedValue({ src: seg.from, rate: 1, playing: false, stamp: Date.now(), end: seg.from + seg.len });
  const pace = useSharedValue({ lastSeekAt: 0, lastSeekTo: -1e9, shown: -1, first: false });
  const seed = useSharedValue(0);
  const [hasFrame, setHasFrame] = useState(false);

  // O relógio (no JS) diz ao fio da interface onde o vídeo deve estar; entre avisos, o fio da interface anda sozinho.
  const roleRef = useRef(role);
  roleRef.current = role;
  const drive = useRef<(t: number, playing: boolean, force?: boolean) => void>(() => undefined);
  const last = useRef({ at: 0, rate: 1, playing: false, role: '' as string, src: -1 });
  drive.current = (t, playing, force = false) => {
    const r = roleRef.current;
    const end = Math.max(seg.from, seg.from + seg.len - 0.04);
    let src: number, rate = 1, on = false;
    if (r === 'next') src = seg.from;
    else if (r === 'prev') src = Math.max(seg.from, seg.from + seg.len - 0.05);
    else {
      const local = clamp(t - seg.start, 0, seg.dur);
      src = seg.from + sourceOffset(local, seg.dur, seg.len, seg.speed, seg.fx);
      rate = clamp(playbackRateAt(local, seg.dur, seg.speed, seg.fx), 0.25, 4);
      on = playing && t < seg.start + seg.dur;
    }
    const now = Date.now();
    const L = last.current;
    const changed = force || on !== L.playing || r !== L.role || Math.abs(rate - L.rate) > 0.02 || (!on && Math.abs(src - L.src) > 1e-3) || (on && now - L.at > 120);
    if (!changed) return;
    last.current = { at: now, rate, playing: on, role: r, src };
    target.value = { src: Math.min(src, end), rate, playing: on, stamp: now, end };
  };
  useEffect(() => clock.subscribe((t, playing) => drive.current(t, playing)), [clock]);
  useEffect(() => { drive.current(clock.time(), clock.playing(), true); }, [role, seg.from, seg.len, seg.start, seg.dur, seg.speed, seg.fx, clock, meta]);

  // Sem frame em 5 s: este ficheiro não serve na Skia.
  useEffect(() => {
    if (!meta || hasFrame) return;
    const id = setTimeout(() => fail('sem frames em 5 s'), 5000);
    return () => clearTimeout(id);
  }, [meta, hasFrame]); // eslint-disable-line react-hooks/exhaustive-deps

  const video = meta?.video ?? null;
  const frameMs = 1000 / (meta?.fps ?? 30);
  const grain = p.grain > 0;
  const gotFirst = () => setHasFrame(true);
  useFrameCallback(() => {
    'worklet';
    if (!video) return;
    const now = Date.now();
    const tg = target.value;
    const want = wantMs(tg, now);
    const ps = pace.value;
    let cur = 0;
    try { cur = video.currentTime(); } catch { return; }
    let got: SkImage | null = null;
    let seekAt = ps.lastSeekAt, seekTo = ps.lastSeekTo;
    if (IS_ANDROID) {
      const d = androidPace({ want, cur, frameMs, now, lastSeekAt: ps.lastSeekAt, lastSeekTo: ps.lastSeekTo });
      if (d.seek !== null) { video.seek(d.seek); seekAt = now; seekTo = d.seek; }
      const need = d.advance > 0 || d.seek !== null || !ps.first;
      // O vídeo da Skia só dá frames novos enquanto «toca» (calado): toca-se quando há frames a pedir.
      if ((need || tg.playing) && !video.isPlaying()) video.play();
      else if (!need && !tg.playing && video.isPlaying()) video.pause();
      const n = d.seek !== null || !ps.first ? 1 : d.advance;
      for (let i = 0; i < n; i++) {
        const img = video.nextImage();
        if (img) { if (got && got !== img) got.dispose(); got = img; }
        if (Date.now() - now > 8) break;
      }
    } else {
      const d = applePace({ want, cur, frameMs, now, lastSeekAt: ps.lastSeekAt, lastSeekTo: ps.lastSeekTo, playing: tg.playing && Math.abs(tg.rate - 1) < 0.02, isPlaying: video.isPlaying() });
      if (d.seek !== null) { video.seek(d.seek); seekAt = now; seekTo = d.seek; }
      if (d.play === true) video.play();
      else if (d.play === false) video.pause();
      if (Math.abs(cur - ps.shown) > 0.5 || !ps.first) got = video.nextImage();
    }
    let shown = ps.shown, first = ps.first;
    if (got) {
      const at = video.currentTime();
      if (first && Math.abs(at - ps.shown) < 0.5) {
        got.dispose(); // o mesmo frame de antes
      } else {
        let img = got;
        if (IS_ANDROID) {
          // No Android o frame é uma textura do descodificador que se reutiliza: copia-se antes que mude (como no useVideo).
          const copy = img.makeNonTextureImage();
          if (copy) { img.dispose(); img = copy; }
        }
        const old = frame.value;
        frame.value = img;
        if (old) old.dispose();
        shown = at;
        if (!first) { first = true; scheduleOnRN(gotFirst); }
      }
    }
    if (seekAt !== ps.lastSeekAt || shown !== ps.shown || first !== ps.first) pace.value = { lastSeekAt: seekAt, lastSeekTo: seekTo, shown, first };
    if (grain) seed.value = grainSeed(want);
  });

  const base = useMemo(() => fxUniforms(p, w, h), [p, w, h]);
  const uniforms = useDerivedValue(() => ({ ...base, seed: seed.value }));
  const tf = useMemo(() => (meta ? coverTransform(meta.iw, meta.ih, meta.rot, w, h) : []), [meta, w, h]);
  const fx = fxEffect();
  return (
    <View style={StyleSheet.absoluteFill}>
      {!hasFrame && poster ? <Image source={poster as never} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      {/* Só com o primeiro frame: o ImageShader sem imagem deixava o shader sem filho. O último frame fica para o GC (como no useVideo). */}
      {meta && fx && hasFrame ? (
        <Canvas style={{ width: w, height: h }}>
          <Fill>
            <Shader source={fx} uniforms={uniforms}>
              <ImageShader image={frame} transform={tf} />
            </Shader>
          </Fill>
        </Canvas>
      ) : null}
    </View>
  );
}

/** Uma foto (já reduzida ao palco) com o mesmo shader: o filtro, a nitidez, a vinheta e o grão (parado). */
export function SkiaPhoto({ image, p, w, h }: { image: SkImage; p: FxParams; w: number; h: number }) {
  const fx = fxEffect()!;
  const uniforms = useMemo(() => fxUniforms(p, w, h, 7), [p, w, h]);
  return (
    <Canvas style={{ width: w, height: h }}>
      <Fill>
        <Shader source={fx} uniforms={uniforms}>
          <ImageShader image={image} fit="cover" rect={{ x: 0, y: 0, width: w, height: h }} />
        </Shader>
      </Fill>
    </Canvas>
  );
}
