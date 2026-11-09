import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { AppState } from 'react-native';
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
  try { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false }); } catch { /* sem modo de áudio: usa o padrão */ }
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
    // Entretanto pararam-na (ex.: fechou a nota antes de a música começar): não toca.
    if (owner !== id) return false;
    if (!player) player = createAudioPlayer(src);
    else player.replace(src);
    endSub?.remove();
    endSub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish && owner === id && !player?.loop) stopTrack(id);
    });
    player.loop = opts.loop;
    player.muted = muted;
    await player.seekTo(0).catch(() => undefined);
    if (owner !== id) { try { player.pause(); } catch { /* */ } return false; }
    player.play();
    // No browser (sobretudo iPhone), o som sem um toque recente é bloqueado: o leitor fica parado sem dar erro.
    // Nesse caso fica à espera do primeiro toque no ecrã e arranca nessa altura (se ainda for esta a faixa pedida).
    if (Platform.OS === 'web') {
      await new Promise((r) => setTimeout(r, 350));
      if (owner === id && player && !player.playing) waitForGesture(id, url, opts);
    }
    return true;
  } catch {
    if (owner === id) { owner = null; onStop = null; }
    return false;
  }
}

let gestureArmed = false;
let pending: { id: symbol; url: string; opts: { loop: boolean; onStop: () => void } } | null = null;
/** Guarda o pedido e toca-o no próximo toque (uma vez); o toque desbloqueia o áudio para o resto da visita. */
function waitForGesture(id: symbol, url: string, opts: { loop: boolean; onStop: () => void }) {
  pending = { id, url, opts };
  if (gestureArmed || typeof document === 'undefined') return;
  gestureArmed = true;
  const go = () => {
    document.removeEventListener('pointerdown', go, true);
    document.removeEventListener('touchend', go, true);
    document.removeEventListener('keydown', go, true);
    gestureArmed = false;
    const p = pending;
    pending = null;
    if (p && owner === p.id && player) {
      try { player.play(); } catch { /* */ }
    }
  };
  document.addEventListener('pointerdown', go, true);
  document.addEventListener('touchend', go, true);
  document.addEventListener('keydown', go, true);
}

// A app saiu do ecrã (outra app, ecrã bloqueado, botão de início): a música pára, seja de que cartão for.
AppState.addEventListener('change', (st) => {
  if (st !== 'active' && owner) stopTrack(owner);
});

/** Pára (e liberta) a faixa, se for esta a tocar. */
export function stopTrack(id: symbol) {
  if (pending?.id === id) pending = null;
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
