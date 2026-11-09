import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Platform, Vibration } from 'react-native';

/**
 * Sons da chamada: o toque de quem recebe (com vibração no telemóvel) e o sinal de chamada de quem liga.
 * Os dois ficheiros são pequenos (8 kHz, mono) e tocam em loop até a chamada atender, recusar ou acabar.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RING = require('../../../assets/sounds/ring.wav') as number;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RINGBACK = require('../../../assets/sounds/ringback.wav') as number;

let player: AudioPlayer | null = null;
let vibrating = false;

function play(src: number, volume: number) {
  stopSounds();
  try {
    player = createAudioPlayer(src);
    player.loop = true;
    player.volume = volume;
    player.play();
  } catch {
    player = null; // no browser sem um toque do utilizador o som pode ser bloqueado: fica só o ecrã
  }
}

/** Chamada a entrar: toque e vibração (no telemóvel). */
export function startRinging() {
  play(RING, 1);
  if (Platform.OS !== 'web') {
    vibrating = true;
    Vibration.vibrate([0, 700, 500, 700, 1400], true);
  }
}

/** Chamada a sair: o "tuu… tuu…" enquanto o outro lado não atende. */
export function startRingback() {
  play(RINGBACK, 0.6);
}

export function stopSounds() {
  if (player) {
    try {
      player.pause();
      player.remove();
    } catch { /* já parado */ }
    player = null;
  }
  if (vibrating) {
    Vibration.cancel();
    vibrating = false;
  }
}
