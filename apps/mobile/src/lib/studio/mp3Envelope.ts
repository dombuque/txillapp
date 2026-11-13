/**
 * A «onda» de um MP3 sem o descodificar (sem React nem módulos nativos; testado em tests/studioMp3.test.mjs).
 *
 * No site o estúdio descodifica a música com Web Audio e desenha a onda verdadeira. No telemóvel não há descodificador à mão
 * (nem se quer um módulo nativo novo só para isto). Mas cada bocado de um MP3 (um «granule», 576 amostras, ~13 ms a 44,1 kHz)
 * traz escrito o ganho com que foi codificado (`global_gain`, 8 bits na «side info»): o volume desse bocado, em passos de
 * 1,5 dB. Lendo só esses números tem-se uma curva de volume com ~77 pontos por segundo: chega para desenhar a onda, sugerir
 * o trecho mais forte e estimar o andamento. É uma aproximação (o ganho não é a amplitude exata), e só serve para MP3: nos
 * outros formatos (m4a, ogg) não há onda e o ritmo fica nos 120 BPM até o servidor ler as batidas na montagem.
 */

export interface Mp3Envelope {
  /** Pontos por segundo da curva (a taxa de amostragem a dividir por 576). */
  rate: number;
  /** O volume de cada bocado (linear, relativo). */
  env: Float32Array;
  /** Segundos de música lidos. */
  duration: number;
  sampleRate: number;
}

const BITRATE_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATE_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES = [44100, 48000, 32000];
/** No máximo 12 minutos de música (as faixas do catálogo são mais curtas). */
const MAX_FRAMES = 28_000;

interface Header { v1: boolean; sampleRate: number; size: number; mono: boolean; crc: boolean }

/** O cabeçalho de um frame de MPEG Layer III em `i` (null se não for um). */
export function mp3Header(b: Uint8Array, i: number): Header | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[i + 1] >> 3) & 3; // 0 = 2.5, 2 = MPEG-2, 3 = MPEG-1
  const layer = (b[i + 1] >> 1) & 3; // 1 = Layer III
  if (ver === 1 || layer !== 1) return null;
  const brIdx = (b[i + 2] >> 4) & 15, srIdx = (b[i + 2] >> 2) & 3;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const v1 = ver === 3;
  const sampleRate = RATES[srIdx] / (ver === 3 ? 1 : ver === 2 ? 2 : 4);
  const kbps = (v1 ? BITRATE_V1 : BITRATE_V2)[brIdx];
  const pad = (b[i + 2] >> 1) & 1;
  const size = Math.floor(((v1 ? 144000 : 72000) * kbps) / sampleRate) + pad;
  return { v1, sampleRate, size, mono: ((b[i + 3] >> 6) & 3) === 3, crc: (b[i + 1] & 1) === 0 };
}

/** `n` bits (até 16) a partir do bit `pos` (a contar do início de `b`). */
function bits(b: Uint8Array, pos: number, n: number): number {
  let v = 0;
  for (let k = 0; k < n; k++) {
    const p = pos + k;
    v = (v << 1) | ((b[p >> 3] >> (7 - (p & 7))) & 1);
  }
  return v;
}

/** Onde acaba a etiqueta ID3v2 do início (0 se não houver). */
export function id3Size(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  return 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f));
}

/** A curva de volume de um MP3 (null se os bytes não forem um MP3 que se consiga ler). */
export function mp3Envelope(bytes: Uint8Array): Mp3Envelope | null {
  let i = Math.min(bytes.length, id3Size(bytes));
  // O primeiro frame: um cabeçalho válido seguido de outro (para não tomar bytes ao acaso por um frame).
  let first: Header | null = null;
  const limit = Math.min(bytes.length - 4, i + 200_000);
  for (; i < limit; i++) {
    const h = mp3Header(bytes, i);
    if (!h || h.size < 24) continue;
    const next = mp3Header(bytes, i + h.size);
    if (next && next.sampleRate === h.sampleRate) { first = h; break; }
  }
  if (!first) return null;
  const sampleRate = first.sampleRate;
  const out: number[] = [];
  let frames = 0, misses = 0;
  while (i + 4 <= bytes.length && frames < MAX_FRAMES) {
    const h = mp3Header(bytes, i);
    if (!h || h.sampleRate !== sampleRate || h.size < 24) {
      // Lixo a meio (ou o fim: uma etiqueta ID3v1): procura o frame seguinte, sem insistir muito.
      if (++misses > 4096) break;
      i += 1;
      continue;
    }
    misses = 0;
    const side = (i + 4 + (h.crc ? 2 : 0)) * 8;
    const ch = h.mono ? 1 : 2;
    const granules = h.v1 ? 2 : 1;
    const head = h.v1 ? 9 + (h.mono ? 5 : 3) + 4 * ch : 8 + (h.mono ? 1 : 2);
    const block = h.v1 ? 59 : 63;
    if (side + head + block * ch * granules > bytes.length * 8) break;
    for (let g = 0; g < granules; g++) {
      let amp = 0;
      for (let c = 0; c < ch; c++) {
        const at = side + head + (g * ch + c) * block;
        const part23 = bits(bytes, at, 12), big = bits(bytes, at + 12, 9), gain = bits(bytes, at + 21, 8);
        // Um bocado sem dados é silêncio (o frame «Xing/Info» do início também).
        if (part23 > 0 && big > 0) amp += Math.pow(2, (gain - 210) / 4);
      }
      out.push(amp / ch);
    }
    frames += 1;
    i += h.size;
  }
  if (out.length < 8) return null;
  return { rate: sampleRate / 576, env: Float32Array.from(out), duration: (frames * (first.v1 ? 1152 : 576)) / sampleRate, sampleRate };
}

/** Os bytes parecem um MP3? (Pela etiqueta ID3 ou por um frame logo no início.) */
export function looksLikeMp3(bytes: Uint8Array): boolean {
  if (id3Size(bytes) > 0) return true;
  for (let i = 0; i < Math.min(bytes.length - 4, 4096); i++) if (mp3Header(bytes, i)) return true;
  return false;
}
