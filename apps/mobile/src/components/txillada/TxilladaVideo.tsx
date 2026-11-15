import { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { VideoTrack } from 'livekit-client';
import { nativeVideoView } from '@/lib/txilladaLive';

/**
 * Um vídeo da Txillada no telemóvel (a câmara de quem transmite, ou a de quem se vê): o VideoView do @livekit/react-native.
 * O site usa o TxilladaVideo.web.tsx (um <video>). Sem faixa, um fundo preto.
 */
export function TxilladaVideo({ track, mirror = false, style }: { track: VideoTrack | null; mirror?: boolean; style?: StyleProp<ViewStyle> }) {
  // O componente nativo é pedido uma vez, ao montar (o módulo só se carrega quando se entra numa Txillada).
  const [Native] = useState(() => nativeVideoView());
  if (!Native || !track) return <View style={[{ backgroundColor: '#000' }, style]} />;
  return (
    <View style={[{ backgroundColor: '#000', overflow: 'hidden' }, style]}>
      <Native videoTrack={track} objectFit="cover" mirror={mirror} style={{ flex: 1 }} />
    </View>
  );
}
