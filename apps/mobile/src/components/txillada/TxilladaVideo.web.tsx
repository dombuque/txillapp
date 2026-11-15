import { createElement, useEffect, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { VideoTrack } from 'livekit-client';
import { videoFit, type VideoFit } from '@/lib/txilladaFx';

/**
 * Um vídeo da Txillada no site e no PWA: um <video> a que o livekit-client liga a faixa (sem som: o som vai num <audio> à
 * parte, lib/txilladaLive.web). Ocupa a caixa toda, de ponta a ponta.
 *
 * - O <video> fica em `position: absolute` com `inset: 0` (e não `height: 100%` dentro de um flex: o Safari do iPhone não
 *   resolvia a percentagem e o vídeo ficava com a altura natural, uma faixa a meio). O `object-fit` também se escreve no
 *   elemento depois de o livekit-client o ligar.
 * - `fit = 'auto'` (quem vê): cover quando a imagem tem a forma do ecrã; uma imagem deitada num telemóvel (ou ao alto num
 *   computador) fica inteira, com o fundo desfocado do próprio vídeo atrás (lib/txilladaFx `videoFit`). Mede-se o vídeo
 *   (`loadedmetadata`/`resize`) e a caixa (ResizeObserver), sem depender do tamanho da janela no primeiro desenho.
 * - `fit = 'cover'` (a câmara do anfitrião): sempre cheia, espelhada na câmara da frente.
 */
export function TxilladaVideo({ track, mirror = false, fit = 'auto', style }: { track: VideoTrack | null; mirror?: boolean; fit?: 'auto' | 'cover'; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const bgRef = useRef<HTMLVideoElement | null>(null);
  const [mode, setMode] = useState<VideoFit>('cover');

  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    const measure = () => {
      const box = el.parentElement;
      const next = fit === 'cover' ? 'cover' : videoFit(el.videoWidth, el.videoHeight, box?.clientWidth ?? 0, box?.clientHeight ?? 0);
      el.style.objectFit = next;
      setMode(next);
    };
    measure();
    el.addEventListener('loadedmetadata', measure);
    el.addEventListener('resize', measure);
    const box = el.parentElement;
    const ro = typeof ResizeObserver !== 'undefined' && box ? new ResizeObserver(measure) : null;
    if (ro && box) ro.observe(box);
    return () => {
      el.removeEventListener('loadedmetadata', measure);
      el.removeEventListener('resize', measure);
      ro?.disconnect();
      track.detach(el);
    };
  }, [track, fit]);

  // O fundo desfocado (só quando a imagem fica inteira): o mesmo vídeo, a encher, desfocado e escurecido.
  const blur = !!track && mode === 'contain';
  useEffect(() => {
    const bg = bgRef.current;
    if (!bg || !track || !blur) return;
    track.attach(bg);
    return () => { track.detach(bg); };
  }, [track, blur]);

  const flip = mirror ? 'scaleX(-1)' : '';
  const fill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', display: 'block' } as const;
  return (
    <View style={[{ backgroundColor: '#000', overflow: 'hidden' }, style]}>
      {blur
        ? createElement('video', {
            ref: bgRef,
            autoPlay: true,
            playsInline: true,
            muted: true,
            'aria-hidden': true,
            'data-txillada-bg': '',
            style: { ...fill, objectFit: 'cover', transform: `${flip} scale(1.15)`.trim(), filter: 'blur(28px) brightness(0.55) saturate(1.25)', backgroundColor: '#000' },
          })
        : null}
      {track
        ? createElement('video', {
            ref,
            autoPlay: true,
            playsInline: true,
            muted: true,
            'data-txillada-video': '',
            style: { ...fill, objectFit: mode, transform: flip || undefined, backgroundColor: blur ? 'transparent' : '#000' },
          })
        : null}
    </View>
  );
}
