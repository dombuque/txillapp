import { createElement, useEffect, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { VideoTrack } from 'livekit-client';

/**
 * Um vídeo da Txillada no site e no PWA: um <video> a que o livekit-client liga a faixa (sem som: o som vai num <audio> à
 * parte, lib/txilladaLive.web). Enche o cartão (cover), como no telemóvel.
 */
export function TxilladaVideo({ track, mirror = false, style }: { track: VideoTrack | null; mirror?: boolean; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return (
    <View style={[{ backgroundColor: '#000', overflow: 'hidden' }, style]}>
      {track
        ? createElement('video', {
            ref,
            autoPlay: true,
            playsInline: true,
            muted: true,
            style: { width: '100%', height: '100%', objectFit: 'cover', transform: mirror ? 'scaleX(-1)' : undefined, backgroundColor: '#000' },
          })
        : null}
    </View>
  );
}
