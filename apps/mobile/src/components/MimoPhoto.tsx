import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { panBy, shownBox, toggleView, WHOLE, zoomAt, type MimoView, type Size } from '@/lib/mimoCrop';

/**
 * A foto do mimo dentro da moldura 9:16 do editor (lib/mimoCrop.ts): entra inteira; dois dedos aumentam ou diminuem e
 * arrastam; um dedo arrasta; dois toques alternam entre inteira e a preencher. No computador: a roda do rato (ou o pinçar do
 * trackpad) aumenta onde está o rato e arrastar com o rato move. Durante o gesto só este componente se redesenha; a vista
 * final sobe em `onView` quando os dedos saem.
 */
export function MimoPhoto({ uri, width, height, view, onView, img, onImg }: {
  uri: string;
  /** O tamanho da moldura (px do ecrã). */
  width: number;
  height: number;
  view: MimoView;
  onView: (v: MimoView) => void;
  /** O tamanho da foto (px), quando já se sabe (no carregar). */
  img: Size | null;
  onImg: (s: Size) => void;
}) {
  const [live, setLive] = useState<MimoView>(view);
  const liveRef = useRef(view);
  const frameRef = useRef<Size>({ w: width, h: height });
  frameRef.current = { w: width, h: height };
  const imgRef = useRef(img);
  imgRef.current = img;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  // A vista que vem de fora (o botão «Preencher o ecrã», outra foto) manda.
  useEffect(() => { liveRef.current = view; setLive(view); }, [view]);
  const set = (v: MimoView) => { liveRef.current = v; setLive(v); };
  const commit = () => onViewRef.current(liveRef.current);

  const ready = !!img && width > 0 && height > 0;
  const pinch = usePinchGesture({
    runOnJS: true,
    enabled: ready,
    onUpdate: (e) => {
      const im = imgRef.current;
      if (!im || !(e.scaleChange > 0)) return;
      const v = liveRef.current;
      set(zoomAt(v, v.z * e.scaleChange, e.focalX, e.focalY, im, frameRef.current));
    },
    onFinalize: () => commit(),
  });
  const pan = usePanGesture({
    runOnJS: true,
    enabled: ready,
    minDistance: 4,
    onUpdate: (e) => {
      const im = imgRef.current;
      if (im) set(panBy(liveRef.current, e.changeX, e.changeY, im, frameRef.current));
    },
    onFinalize: () => commit(),
  });
  const twice = useTapGesture({
    runOnJS: true,
    enabled: ready,
    numberOfTaps: 2,
    onActivate: () => {
      const im = imgRef.current;
      if (!im) return;
      set(toggleView(liveRef.current, im, frameRef.current));
      commit();
    },
  });
  const gestures = useSimultaneousGestures(pinch, pan, twice);

  // No computador: a roda do rato (e o pinçar do trackpad, que chega como roda com Ctrl) aumenta onde está o rato.
  const node = useRef<React.ComponentRef<typeof View>>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = node.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      const im = imgRef.current;
      if (!im) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const k = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
      const v = liveRef.current;
      set(zoomAt(v, v.z * k, e.clientX - r.left, e.clientY - r.top, im, frameRef.current));
      if (t) clearTimeout(t);
      t = setTimeout(commit, 160);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); if (t) clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A foto desenha-se do tamanho «inteira» ao centro e move-se só com transformações (sem refazer o layout a cada passo).
  const base = useMemo(() => (img ? shownBox(WHOLE, img, { w: width, h: height }) : null), [img, width, height]);
  const style = base
    ? { position: 'absolute' as const, left: base.x, top: base.y, width: base.w, height: base.h, transform: [{ translateX: live.tx }, { translateY: live.ty }, { scale: live.z }] }
    : StyleSheet.absoluteFill;

  return (
    <GestureDetector gesture={gestures}>
      <View ref={node} collapsable={false} style={[StyleSheet.absoluteFill, Platform.OS === 'web' ? ({ cursor: ready ? 'grab' : 'auto', touchAction: 'none' } as object) : null]} accessibilityLabel="Pré-visualização do mimo" accessibilityHint="Pinça com dois dedos para aumentar ou diminuir, arrasta para mover e toca duas vezes para alternar entre a foto inteira e preencher o ecrã">
        <Image
          source={{ uri }}
          style={style}
          contentFit="contain"
          onLoad={(e) => { const w = e.source?.width, h = e.source?.height; if (w && h && (!img || img.w !== w || img.h !== h)) onImg({ w, h }); }}
        />
      </View>
    </GestureDetector>
  );
}
