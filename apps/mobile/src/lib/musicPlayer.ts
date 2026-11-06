import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { abs } from '@/lib/config';

/**
 * Um único leitor de música para toda a app (posts, stories, pré-escuta): só toca uma faixa de cada vez,
 * como no site (apps/web/src/lib/musicPlayer.ts). Quem pede a faixa identifica-se com um `symbol`.
 */
const MUTE_KEY = 'tx_music_muted';
const AUTO_KEY = 'tx_music_auto';

const web = Platform.OS === 'web' && typeof localStorage !== 'undefined';
const read = (k: string) => {
  try { return web ? localStorage.getItem(k) === '1' : null; } catch { return null; }
};
const write = (k: string, v: boolean) => {
  try { if (web) localStorage.setItem(k, v ? '1' : '0'); } catch { /* sem armazenamento: vale até fechar a app */ }
};

let muted = read(MUTE_KEY) === true;
let auto = read(AUTO_KEY) === true;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

let player: AudioPlayer | null = null;
let owner: symbol | null = null;
let onStop: (() => void) | null = null;
let endSub: { remove: () => void } | null = null;
let modeSet = false;

/** A música só toca sozinha nos posts depois de a pessoa ter carregado em "tocar" numa faixa (e enquanto não a parar à mão). */
export const autoAllowed = () => auto;
export const allowAuto = (on: boolean) => { auto = on; write(AUTO_KEY, on); };
export const isMuted = () => muted;

export function setMusicMuted(m: boolean) {
  muted = m;
  write(MUTE_KEY, m);
  try { if (player) player.muted = m; } catch { /* leitor já libertado */ }
  emit();
}

/** Silenciar a música: vale para posts e stories. Devolve [silenciado, alternar]. */
export function useMusicMuted(): [boolean, () => void] {
  const m = useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => muted, () => muted);
  return [m, () => setMusicMuted(!muted)];
}

async function ensureMode() {
  if (modeSet) return;
  modeSet = true;
  try { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, interruptionMode: 'mixWithOthers' }); } catch { /* sem modo de áudio: usa o padrão */ }
}

/** Toca uma faixa (pára a que estava a tocar). Devolve false se o aparelho recusou. */
export async function playTrack(id: symbol, url: string, opts: { loop: boolean; onStop: () => void }): Promise<boolean> {
  if (owner && owner !== id) {
    const prev = onStop;
    owner = null;
    onStop = null;
    try { player?.pause(); } catch { /* */ }
    prev?.();
  }
  owner = id;
  onStop = opts.onStop;
  const src = /^(file|blob|content|data):/i.test(url) ? url : abs(url);
  if (!src) { owner = null; onStop = null; return false; }
  try {
    await ensureMode();
    if (!player) player = createAudioPlayer(src);
    else player.replace(src);
    endSub?.remove();
    endSub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish && owner === id && !player?.loop) stopTrack(id);
    });
    player.loop = opts.loop;
    player.muted = muted;
    await player.seekTo(0).catch(() => undefined);
    player.play();
    return true;
  } catch {
    if (owner === id) { owner = null; onStop = null; }
    return false;
  }
}

/** Pára (e liberta) a faixa, se for esta a tocar. */
export function stopTrack(id: symbol) {
  if (owner !== id) return;
  const cb = onStop;
  owner = null;
  onStop = null;
  try { player?.pause(); } catch { /* */ }
  cb?.();
}

/** Pausa e retoma sem largar a faixa (stories). */
export function pauseTrack(id: symbol) {
  if (owner === id) try { player?.pause(); } catch { /* */ }
}
export function resumeTrack(id: symbol) {
  if (owner === id) try { player?.play(); } catch { /* */ }
}
export const isPlaying = (id: symbol) => owner === id && !!player && player.playing;
