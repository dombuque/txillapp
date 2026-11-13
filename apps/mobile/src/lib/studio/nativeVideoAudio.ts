/**
 * «Este vídeo tem som?» no telemóvel, sem rede: o expo-video diz que pistas de áudio o ficheiro tem quando o carrega
 * (`sourceLoad`). No Android (ExoPlayer) a lista é de confiança: vazia = sem pista de áudio. No iPhone a lista vem dos
 * grupos de escolha do AVFoundation, que muitos vídeos simples não têm: aí só um «sim» conta (vazia fica por saber).
 * Uma pista só com silêncio não se apanha aqui: isso é o servidor que diz (lib/studio/magicSound.ts).
 */
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { Platform } from 'react-native';

export interface TrackInfo {
  /** Tem pista de áudio (`undefined`: não se sabe). */
  hasAudio?: boolean;
  /** A duração que o leitor leu (s), se chegou a ler. */
  duration?: number;
}

/** Espera pelo `sourceLoad` de um leitor (no máximo `timeoutMs`) e diz se tem pista de áudio. */
export function trackInfoOf(player: VideoPlayer, timeoutMs: number): Promise<TrackInfo> {
  return new Promise((resolve) => {
    let done = false;
    let sub: { remove: () => void } | null = null;
    const end = (v: TrackInfo) => { if (done) return; done = true; try { sub?.remove(); } catch { /* já saiu */ } clearTimeout(timer); resolve(v); };
    const read = (tracks: unknown[] | undefined, duration: number | undefined): TrackInfo => ({
      hasAudio: tracks?.length ? true : tracks && Platform.OS === 'android' ? false : undefined,
      ...(duration && duration > 0 ? { duration } : {}),
    });
    const timer = setTimeout(() => {
      // Sem o evento: o que o leitor já souber (se já carregou antes de se ouvir).
      try { end(player.status === 'readyToPlay' ? read(player.availableAudioTracks, player.duration) : {}); } catch { end({}); }
    }, timeoutMs);
    try {
      sub = player.addListener('sourceLoad', (p) => end(read(p.availableAudioTracks, p.duration)));
    } catch { end({}); }
  });
}

const known = new Map<string, Promise<TrackInfo>>();
let queue: Promise<unknown> = Promise.resolve();

/**
 * Se o vídeo `uri` tem pista de áudio (um de cada vez; o leitor sai logo a seguir). Só no Android responde «não»;
 * no iPhone e no site fica `undefined` quando não sabe.
 */
export function probeVideoAudio(uri: string): Promise<TrackInfo> {
  const have = known.get(uri);
  if (have) return have;
  const p = queue.then(async () => {
    let player: VideoPlayer | null = null;
    try {
      player = createVideoPlayer({ uri });
      player.muted = true;
      return await trackInfoOf(player, 2500);
    } catch { return {}; } finally { try { player?.release(); } catch { /* já libertado */ } }
  });
  queue = p.catch(() => undefined);
  known.set(uri, p);
  if (known.size > 80) known.delete(known.keys().next().value as string);
  return p;
}
