import { Canvas, ColorMatrix, Image as SkImageNode, Skia, type SkImage } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { PixelRatio, Pressable, ScrollView, Text, View } from 'react-native';
import { FILTERS, isIdentity, resolveFx, type ClipFx } from '@/lib/studio/effects';
import { videoLook } from '@/lib/studio/nativeLook';
import { fxc } from '../FxUi';
import { LookLayer } from './NativeStage';

const TW = 56, TH = 84;

/** A foto pequena (uma vez), para as 16 miniaturas com a matriz de cor verdadeira. */
function useSmall(uri: string | null): SkImage | null {
  const [img, setImg] = useState<SkImage | null>(null);
  useEffect(() => {
    setImg(null);
    if (!uri) return;
    let off = false;
    void (async () => {
      try {
        const src = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
        if (!src) return;
        const w = Math.round(TW * PixelRatio.get()), h = Math.round(TH * PixelRatio.get());
        const s = Skia.Surface.MakeOffscreen(w, h) ?? Skia.Surface.Make(w, h);
        if (!s) return;
        const r = Math.max(w / src.width(), h / src.height());
        const cw = w / r, ch = h / r;
        s.getCanvas().drawImageRect(src, Skia.XYWHRect((src.width() - cw) / 2, (src.height() - ch) / 2, cw, ch), Skia.XYWHRect(0, 0, w, h), Skia.Paint());
        s.flush();
        const snap = s.makeImageSnapshot();
        if (!off) setImg(snap.makeNonTextureImage() ?? snap);
      } catch { /* fica a aproximação */ }
    })();
    return () => { off = true; };
  }, [uri]);
  return img;
}

/**
 * Os filtros em fila, cada um com a miniatura do clipe: nas fotos com a matriz de cor verdadeira (Skia), nos vídeos com a
 * mesma aproximação da pré-visualização.
 */
export function NativeFilterStrip({ fx, thumb, photo, onPick }: { fx: ClipFx | undefined; thumb: string | object | null; photo: boolean; onPick: (id: string) => void }) {
  const current = fx?.filter?.id ?? 'normal';
  const small = useSmall(photo && typeof thumb === 'string' ? thumb : null);
  const looks = useMemo(() => FILTERS.map((f) => resolveFx({ filter: { id: f.id, amount: 1 }, adjust: fx?.adjust })), [fx?.adjust]);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 9, paddingVertical: 4 }} accessibilityRole="tablist" accessibilityLabel="Filtros">
      {FILTERS.map((f, i) => {
        const on = f.id === current;
        const p = looks[i];
        return (
          <Pressable key={f.id} onPress={() => onPick(f.id)} style={({ pressed }) => [{ width: TW + 8, alignItems: 'center', gap: 4 }, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`Filtro ${f.name}: ${f.mood}`}>
            <View style={[{ width: TW, height: TH, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: on ? fxc.coralHot : 'rgba(255,255,255,0.12)', backgroundColor: f.swatch }]}>
              {small ? (
                <Canvas style={{ width: TW - 4, height: TH - 4 }}>
                  <SkImageNode image={small} x={0} y={0} width={TW - 4} height={TH - 4} fit="cover">
                    {isIdentity(p.matrix) ? null : <ColorMatrix matrix={p.matrix} />}
                  </SkImageNode>
                </Canvas>
              ) : thumb ? (
                <>
                  <Image source={thumb as never} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  <LookLayer look={videoLook(p.matrix, p.vignette)} />
                </>
              ) : null}
            </View>
            <Text numberOfLines={2} style={{ color: on ? fxc.coralHot : 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 16, textAlign: 'center', fontWeight: on ? '800' : '700', width: TW + 12 }}>{f.name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
