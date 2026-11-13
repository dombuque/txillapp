import type React from 'react';
import { ImageFormat, makeImageFromView } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { createVideoPlayer, type VideoThumbnail } from 'expo-video';
import { useRef, useState, type ReactNode } from 'react';
import { PixelRatio, View } from 'react-native';

interface Job { thumb: VideoThumbnail; w: number; h: number; done: (r: { uri: string } | null) => void }

/**
 * «Congelar este frame» no telemóvel: o expo-video dá o frame (uma miniatura nativa, até 1080 px), mostra-se fora do ecrã e a
 * Skia fotografa essa vista para um JPEG na cache: é a foto que entra na tcheka (e que vai para o servidor como `freeze`).
 */
export function useFrameGrab(): { node: ReactNode; grab: (uri: string, at: number) => Promise<{ uri: string } | null> } {
  const [job, setJob] = useState<Job | null>(null);
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const grab = async (uri: string, at: number) => {
    let player: ReturnType<typeof createVideoPlayer> | null = null;
    try {
      player = createVideoPlayer({ uri });
      const got = await Promise.race([player.generateThumbnailsAsync([Math.max(0, at)], { maxWidth: 1080, maxHeight: 1920 }), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
      const thumb = got?.[0];
      if (!thumb) return null;
      return await new Promise<{ uri: string } | null>((done) => {
        const timer = setTimeout(() => { setJob(null); done(null); }, 8000);
        setJob({ thumb, w: thumb.width, h: thumb.height, done: (r) => { clearTimeout(timer); setJob(null); done(r); } });
      });
    } catch { return null; } finally { try { player?.release(); } catch { /* já libertado */ } }
  };
  const shoot = async () => {
    const j = job;
    if (!j) return;
    try {
      await new Promise((r) => setTimeout(r, 60));
      const img = await makeImageFromView(ref as unknown as React.RefObject<number>);
      const bytes = img?.encodeToBytes(ImageFormat.JPEG, 92);
      if (!bytes?.length) return j.done(null);
      const f = new File(Paths.cache, `txill-congelado-${Date.now()}.jpg`);
      f.create({ intermediates: true, overwrite: true });
      f.writeSync(bytes);
      j.done({ uri: f.uri });
    } catch { j.done(null); }
  };
  const r = PixelRatio.get();
  const node = job ? (
    <View pointerEvents="none" style={{ position: 'absolute', left: -6000, top: 0 }}>
      <View ref={ref} collapsable={false} style={{ width: job.w / r, height: job.h / r }}>
        <Image source={job.thumb} style={{ width: job.w / r, height: job.h / r }} contentFit="fill" onLoad={() => void shoot()} onError={() => job.done(null)} />
      </View>
    </View>
  ) : null;
  return { node, grab };
}
