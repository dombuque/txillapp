import { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import type { VideoTrack } from 'livekit-client';
import { nativeVideoView } from '@/lib/txilladaLive';
import { videoFit, type VideoFit } from '@/lib/txilladaFx';

/**
 * Um vídeo da Txillada no telemóvel (a câmara de quem transmite, ou a de quem se vê): o VideoView do @livekit/react-native,
 * de ponta a ponta. O site usa o TxilladaVideo.web.tsx (um <video>). Sem faixa, um fundo preto.
 *
 * `fit = 'auto'` (quem vê): cover quando a imagem tem a forma do ecrã; uma imagem deitada (a webcam de um computador) fica
 * inteira, com o próprio vídeo a encher o fundo, escurecido (lib/txilladaFx `videoFit`). `fit = 'cover'`: o anfitrião.
 */
export function TxilladaVideo({ track, mirror = false, fit = 'auto', box, style }: {
  track: VideoTrack | null; mirror?: boolean; fit?: 'auto' | 'cover';
  /** O tamanho do quadrado (com convidados, 0165); sem ele, o ecrã inteiro. */
  box?: { w: number; h: number };
  style?: StyleProp<ViewStyle>;
}) {
  // O componente nativo é pedido uma vez, ao montar (o módulo só se carrega quando se entra numa Txillada).
  const [Native] = useState(() => nativeVideoView());
  const win = useWindowDimensions();
  const width = box?.w ?? win.width;
  const height = box?.h ?? win.height;
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  // As medidas da imagem (o WebRTC só as sabe depois das primeiras imagens; podem mudar com a rede): de 1,5 em 1,5 s.
  useEffect(() => {
    if (!track || fit === 'cover') return;
    const read = () => {
      // As medidas da faixa (o livekit-client lê-as do getSettings do WebRTC); sem elas ainda, fica o cover.
      const d = (track as unknown as { dimensions?: { width?: number; height?: number } }).dimensions ?? track.mediaStreamTrack?.getSettings?.();
      const w = d?.width ?? 0;
      const h = d?.height ?? 0;
      if (w && h) setDims((o) => (o && o.w === w && o.h === h ? o : { w, h }));
    };
    read();
    const t = setInterval(read, 1500);
    return () => clearInterval(t);
  }, [track, fit]);
  if (!Native || !track) return <View style={[{ backgroundColor: '#000' }, style]} />;
  const mode: VideoFit = fit === 'cover' || !dims ? 'cover' : videoFit(dims.w, dims.h, width, height);
  return (
    <View style={[{ backgroundColor: '#000', overflow: 'hidden' }, style]}>
      {mode === 'contain' ? (
        <>
          <Native videoTrack={track} objectFit="cover" mirror={mirror} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.62)' }]} />
        </>
      ) : null}
      <Native videoTrack={track} objectFit={mode} mirror={mirror} style={StyleSheet.absoluteFill} />
    </View>
  );
}
