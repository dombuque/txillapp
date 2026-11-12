import { Platform } from 'react-native';
import type { AudioPlayer } from 'expo-audio';
import { rmsLevel } from '@/lib/musicLook';

/**
 * O nível do som que está a tocar (0 a 1), para as ondas acompanharem a música. Só na web, com o `AnalyserNode` da Web Audio
 * que o expo-audio monta sobre o elemento de áudio (`setAudioSamplingEnabled`), e só quando dá:
 * - o áudio é da mesma origem (ou tem CORS): o expo-audio recusa os outros, que ficariam mudos dentro da Web Audio;
 * - a pessoa já tocou na página (`userActivation`): sem isso o AudioContext fica suspenso e calava a música;
 * - o leitor está mesmo a tocar.
 * Sem isto (e no telemóvel), não chama `cb` e as ondas «respiram» com um ritmo plausível. Devolve a função para largar.
 */
export function listenLevel(player: AudioPlayer | null | undefined, cb: (level: number) => void): () => void {
  if (Platform.OS !== 'web' || !player || typeof navigator === 'undefined') return () => undefined;
  const activated = (navigator as { userActivation?: { hasBeenActive?: boolean } }).userActivation?.hasBeenActive === true;
  if (!activated) return () => undefined;
  let on = false;
  let sub: { remove: () => void } | null = null;
  try {
    if (!player.playing) return () => undefined;
    const n = users.get(player) ?? 0;
    if (n === 0) player.setAudioSamplingEnabled(true);
    users.set(player, n + 1);
    on = true;
    let smooth = 0;
    sub = player.addListener('audioSampleUpdate', (s) => {
      const lvl = rmsLevel(s.channels?.[0]?.frames);
      smooth = smooth * 0.7 + lvl * 0.3;
      cb(smooth);
    });
  } catch { /* sem Web Audio: as ondas respiram */ }
  return () => {
    sub?.remove();
    if (!on) return;
    on = false;
    const n = (users.get(player) ?? 1) - 1;
    users.set(player, Math.max(0, n));
    if (n <= 0) try { player.setAudioSamplingEnabled(false); } catch { /* leitor já libertado */ }
  };
}

/** Quantas ondas ouvem cada leitor (o último a sair desliga a análise, que custa uma leitura por frame). */
const users = new WeakMap<AudioPlayer, number>();
