import type React from 'react';
import { AlphaType, ColorType, makeImageFromView, Skia, type SkImage } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { PixelRatio, View } from 'react-native';
import { ANALYSIS } from '@/lib/studio/magic';
import { coverCrop, gridCells, gridShape, inset, tileOf, type Cell } from '@/lib/studio/magicFrames';

/** Os píxeis de cada miniatura, a 32×56: cortada ao 9:16 (`cover`) e inteira (`full`); `ok` diz quais carregaram. */
export interface MagicGrab { cover: Uint8Array[]; full: Uint8Array[]; ok: boolean[] }
export type MagicFrameGrabber = (thumbs: VideoThumbnail[]) => Promise<MagicGrab | null>;

interface Job { thumbs: VideoThumbnail[]; cw: number; ch: number; cols: number; done: (r: MagicGrab | null) => void }

/** Quanto se espera que as miniaturas apareçam na grelha antes de a fotografar com as que houver (ms). */
const LOAD_WAIT_MS = 1500;

/**
 * Os píxeis dos frames dos vídeos para a Montagem mágica, sem módulos novos: as miniaturas do expo-video (um `SharedRef` de
 * imagem nativa, que só o expo-image sabe desenhar) vão para uma grelha fora do ecrã, a Skia fotografa a grelha de uma vez
 * (`makeImageFromView`, como o «Congelar este frame») e reduz cada célula a 32×56 numa superfície pequena, lida com
 * `readPixels`. Uma grelha de cada vez; `node` tem de estar montado (fora do ecrã) enquanto se analisa.
 */
export function useMagicFrames(): { node: ReactNode; grab: MagicFrameGrabber } {
  const [job, setJob] = useState<Job | null>(null);
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const seen = useRef<{ n: number; ok: boolean[]; shot: boolean; timer: ReturnType<typeof setTimeout> | null }>({ n: 0, ok: [], shot: false, timer: null });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const current = useRef<Job | null>(null);

  const shoot = useCallback(async () => {
    const j = current.current;
    const s = seen.current;
    if (!j || s.shot) return;
    s.shot = true;
    if (s.timer) clearTimeout(s.timer);
    let snap: SkImage | null = null;
    try {
      await new Promise((r) => setTimeout(r, 60));
      snap = await makeImageFromView(ref as unknown as React.RefObject<number>);
      if (!snap) return j.done(null);
      const n = j.thumbs.length;
      const cells = gridCells(n, j.cols, snap.width(), snap.height());
      const cover = readCells(snap, cells, j.cols, (c) => inset(coverCrop(c, ANALYSIS.w / ANALYSIS.h)));
      const full = readCells(snap, cells, j.cols, (c) => inset(c));
      if (!cover || !full) return j.done(null);
      j.done({ cover, full, ok: s.ok.slice(0, n).map((v) => v !== false) });
    } catch { j.done(null); } finally { try { snap?.dispose(); } catch { /* já saiu */ } }
  }, []);

  const grab: MagicFrameGrabber = useCallback((thumbs) => {
    const run = queue.current.then(() => new Promise<MagicGrab | null>((resolve) => {
      if (!thumbs.length) return resolve(null);
      const r = PixelRatio.get();
      const { cols } = gridShape(thumbs.length);
      let settled = false;
      const done = (v: MagicGrab | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        clearTimeout(wait);
        current.current = null;
        setJob(null);
        resolve(v);
      };
      // Nunca fica preso: passado o tempo todo, desiste (a montagem segue com o que tem).
      const guard = setTimeout(() => done(null), LOAD_WAIT_MS + 2500);
      const j: Job = { thumbs, cw: thumbs[0].width / r, ch: thumbs[0].height / r, cols, done };
      const wait = setTimeout(() => void shoot(), LOAD_WAIT_MS);
      seen.current = { n: 0, ok: [], shot: false, timer: wait };
      current.current = j;
      setJob(j);
    }));
    queue.current = run.catch(() => undefined);
    return run;
  }, [shoot]);

  const settle = (i: number, ok: boolean) => {
    const s = seen.current;
    if (s.ok[i] !== undefined) return;
    s.ok[i] = ok;
    s.n++;
    if (current.current && s.n >= current.current.thumbs.length) void shoot();
  };

  const node = job ? (
    <View pointerEvents="none" style={{ position: 'absolute', left: -6000, top: 0 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View ref={ref} collapsable={false} style={{ width: job.cols * job.cw, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#000' }}>
        {job.thumbs.map((t, i) => (
          <Image key={i} source={t} style={{ width: job.cw, height: job.ch }} contentFit="fill" transition={0} cachePolicy="none" onLoad={() => settle(i, true)} onError={() => settle(i, false)} />
        ))}
      </View>
    </View>
  ) : null;
  return { node, grab };
}

/** Desenha cada célula (o recorte `crop` dela) a 32×56 numa superfície e lê os píxeis de todas de uma vez. */
function readCells(snap: SkImage, cells: Cell[], cols: number, crop: (c: Cell) => Cell): Uint8Array[] | null {
  const { w, h } = ANALYSIS;
  const rows = Math.max(1, Math.ceil(cells.length / cols));
  const W = cols * w, H = rows * h;
  const surface = Skia.Surface.MakeOffscreen(W, H) ?? Skia.Surface.Make(W, H);
  if (!surface) return null;
  try {
    const canvas = surface.getCanvas();
    const paint = Skia.Paint();
    cells.forEach((c, i) => {
      const s = crop(c);
      canvas.drawImageRect(snap, Skia.XYWHRect(s.x, s.y, s.w, s.h), Skia.XYWHRect((i % cols) * w, Math.floor(i / cols) * h, w, h), paint);
    });
    surface.flush();
    const img = surface.makeImageSnapshot();
    const px = img.readPixels(0, 0, { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    try { img.dispose(); } catch { /* já saiu */ }
    if (!px || px.length < W * H * 4 || px instanceof Float32Array) return null;
    return cells.map((_, i) => tileOf(px, W, (i % cols) * w, Math.floor(i / cols) * h, w, h));
  } finally {
    try { surface.dispose(); } catch { /* já saiu */ }
  }
}
