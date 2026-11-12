import { createElement, useEffect, useRef, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { FILTERS, resolveFx, type ClipFx } from '@/lib/studio/effects';
import { coverCrop, FxGL } from '@/lib/studio/renderGL';
import { fxc } from './FxUi';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
/** Tamanho das miniaturas (CSS) e no canvas (com a densidade do ecrã). */
const TW = 56, TH = 84;
export interface FrameGrab { src: TexImageSource & CanvasImageSource; w: number; h: number }

let thumbGL: FxGL | null | undefined;
const glFor = () => (thumbGL === undefined ? (thumbGL = FxGL.create(TW * 2, TH * 2)) : thumbGL);

/**
 * Os filtros em fila, cada um com a miniatura ao vivo do frame que está na pré-visualização (o mesmo shader da montagem,
 * em pequeno). A tocar, as miniaturas acompanham o vídeo (duas vezes por segundo).
 */
export function FxFilterStrip({ fx, grab, playing, onPick, refreshKey }: { fx: ClipFx | undefined; grab: () => FrameGrab | null; playing: boolean; onPick: (id: string) => void; refreshKey: string }) {
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const current = fx?.filter?.id ?? 'normal';

  useEffect(() => {
    let off = false;
    const paint = () => {
      if (off) return;
      const fr = grab();
      const gl = glFor();
      const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      const w = Math.round(TW * dpr), h = Math.round(TH * dpr);
      let first = true;
      for (const f of FILTERS) {
        const c = canvases.current.get(f.id);
        const g = c?.getContext('2d');
        if (!c || !g) continue;
        if (c.width !== w) { c.width = w; c.height = h; }
        if (!fr) { g.fillStyle = f.swatch; g.fillRect(0, 0, w, h); continue; }
        const crop = coverCrop(fr.w, fr.h, w, h);
        const p = resolveFx({ filter: { id: f.id, amount: 1 }, adjust: fx?.adjust });
        const out = gl?.render(fr.src, fr.w, fr.h, crop, p, w, h, 0, first);
        first = false;
        if (out) g.drawImage(out, 0, 0, w, h);
        else { try { g.drawImage(fr.src, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h); } catch { g.fillStyle = f.swatch; g.fillRect(0, 0, w, h); } }
      }
    };
    // Espera um pouco (o frame da pré-visualização acabou de mudar) e, a tocar, vai acompanhando.
    const t0 = setTimeout(paint, 60);
    const iv = playing ? setInterval(paint, 500) : null;
    return () => { off = true; clearTimeout(t0); if (iv) clearInterval(iv); };
  }, [playing, refreshKey, fx?.adjust]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 9, paddingVertical: 4 }} accessibilityRole="tablist" accessibilityLabel="Filtros">
      {FILTERS.map((f) => {
        const on = f.id === current;
        return (
          <Pressable key={f.id} onPress={() => onPick(f.id)} style={({ pressed }) => [{ width: TW + 4, alignItems: 'center', gap: 4 }, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`Filtro ${f.name}: ${f.mood}`}>
            <View style={[{ width: TW, height: TH, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: on ? fxc.coralHot : 'rgba(255,255,255,0.12)', backgroundColor: f.swatch }, on && ({ boxShadow: fxc.glow } as object)]}>
              {dom('canvas', { ref: (el: HTMLCanvasElement | null) => { if (el) canvases.current.set(f.id, el); else canvases.current.delete(f.id); }, width: TW * 2, height: TH * 2, style: { width: '100%', height: '100%', display: 'block' }, 'aria-hidden': true })}
              {on ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: fxc.coralHot }} /> : null}
            </View>
            <Text numberOfLines={2} style={{ color: on ? fxc.coralHot : 'rgba(255,255,255,0.8)', fontSize: 10.5, lineHeight: 13, textAlign: 'center', fontWeight: on ? '800' : '700', width: TW + 8 }}>{f.name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
