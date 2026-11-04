/**
 * Um único leitor de música para toda a app (posts e stories).
 * Os telemóveis só deixam tocar sozinho um elemento de áudio que já tenha sido "desbloqueado" por um toque da pessoa.
 * Por isso o leitor é um só, desbloqueado no primeiro toque em qualquer sítio, e depois muda de faixa à vontade.
 */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const MUTE_KEY = 'tx_music_muted';
const MUTE_EVENT = 'tx-music-muted';

let el: HTMLAudioElement | null = null;
let unlocked = false;
let owner: symbol | null = null;
let onStop: (() => void) | null = null;

const AUTO_KEY = 'tx_music_auto';
/** A música só toca sozinha nos posts depois de a pessoa ter carregado em "tocar" numa faixa (e enquanto não a parar à mão). */
export const autoAllowed = () => {
  try {
    return localStorage.getItem(AUTO_KEY) === '1';
  } catch {
    return false;
  }
};
export const allowAuto = (on: boolean) => {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0');
  } catch {
    /* sem armazenamento: vale só até fechar a app */
  }
};

export const isMuted = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
};

function audio() {
  if (!el) {
    el = new Audio();
    el.preload = 'auto';
    (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  }
  return el;
}

/** Primeiro toque (ou tecla) em qualquer sítio: toca um instante de silêncio para o leitor poder tocar sozinho depois. */
function unlock() {
  if (unlocked || typeof window === 'undefined') return;
  const a = audio();
  if (owner) return; // já está a tocar alguma coisa: está desbloqueado
  a.src = SILENT;
  a.muted = true;
  a.play()
    .then(() => {
      a.pause();
      a.muted = isMuted();
      unlocked = true;
      remove();
    })
    .catch(() => undefined);
}
const events = ['pointerdown', 'touchend', 'keydown', 'click'] as const;
function remove() {
  events.forEach((e) => window.removeEventListener(e, unlock, true));
}
if (typeof window !== 'undefined') events.forEach((e) => window.addEventListener(e, unlock, true));

/** Toca uma faixa (pára a que estava a tocar). Devolve false se o telemóvel recusou. */
export async function playTrack(id: symbol, url: string, opts: { loop: boolean; onStop: () => void }): Promise<boolean> {
  const a = audio();
  if (owner && owner !== id) {
    const prev = onStop;
    owner = null;
    onStop = null;
    prev?.();
  }
  owner = id;
  onStop = opts.onStop;
  if (a.src !== url) a.src = url;
  a.loop = opts.loop;
  a.muted = isMuted();
  a.onended = () => {
    if (owner === id) stopTrack(id);
  };
  try {
    await a.play();
    return true;
  } catch {
    if (owner === id) {
      owner = null;
      onStop = null;
    }
    return false;
  }
}

/** Pára (e liberta) a faixa, se for esta a tocar. */
export function stopTrack(id: symbol) {
  if (owner !== id) return;
  const cb = onStop;
  owner = null;
  onStop = null;
  el?.pause();
  cb?.();
}

/** Pausa e retoma sem largar a faixa (stories). */
export function pauseTrack(id: symbol) {
  if (owner === id) el?.pause();
}
export function resumeTrack(id: symbol) {
  if (owner === id) void el?.play().catch(() => undefined);
}
export const isPlaying = (id: symbol) => owner === id && !!el && !el.paused;

export function setMusicMuted(m: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    /* sem armazenamento: vale só até fechar a app */
  }
  if (el) el.muted = m;
  window.dispatchEvent(new Event(MUTE_EVENT));
}
export const MUSIC_MUTE_EVENT = MUTE_EVENT;
