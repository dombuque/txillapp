/**
 * «Tem som?» e a energia do som de um vídeo, para a «Montagem mágica» da app (POST /tchekas/compose/analyze).
 *
 * No telemóvel não há como descodificar o áudio sem um módulo novo: a app envia o clipe (que ia ser enviado na mesma para
 * a montagem) e o servidor ouve-o com o ffmpeg. Aqui ficam só as contas (sem ffmpeg nem base de dados), testadas em
 * analyze.spec.ts: a energia (RMS) em blocos de 0,25 s, de 0 a 1 em relação ao bloco mais forte, o instante mais alto e se
 * há mesmo som (uma pista de áudio só com silêncio conta como sem som, como no site).
 */

/** Blocos por segundo da energia que se devolve (a app lê-a como `SoundEnergy { energy, rate: 4 }`). */
export const ANALYZE_HZ = 4;
/** A que frequência se descodifica o som (chega para a energia e ocupa pouca memória: 32 KB por segundo). */
export const ANALYZE_DECODE_HZ = 8000;
/** Até quantos segundos de cada vídeo se ouvem (os vídeos têm no máximo 60 s; o original pode ter um pouco mais). */
export const ANALYZE_MAX_S = 180;
/** Abaixo disto (RMS do bloco mais forte, cerca de −54 dBFS) é silêncio: o vídeo conta como sem som. */
export const SILENCE_RMS = 0.002;

export interface SoundAnalysis {
  /** O vídeo tem som que se ouça (uma pista só com silêncio dá `false`). */
  hasAudio: boolean;
  /** A energia, um valor (0 a 1) por bloco de 0,25 s; vazio sem som. */
  energy: number[];
  /** Os blocos por segundo de `energy` (4). */
  rate: number;
  /** O meio do bloco mais forte (ms no ficheiro), ou null sem som. */
  loudestMs: number | null;
  /** A duração do ficheiro (ms). */
  durationMs: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A energia (RMS) de `mono` (a `rate` Hz) em blocos de 1/`hz` s: os valores em bruto, o mais forte e onde está. */
export function rmsBlocks(mono: ArrayLike<number>, rate: number, hz = ANALYZE_HZ): { rms: number[]; peak: number; peakAt: number } {
  const size = Math.max(1, Math.round(rate / hz));
  const rms: number[] = [];
  let peak = 0, peakAt = -1;
  for (let i = 0; i < mono.length; i += size) {
    const end = Math.min(mono.length, i + size);
    let s = 0;
    for (let k = i; k < end; k++) s += mono[k] * mono[k];
    const v = Math.sqrt(s / Math.max(1, end - i));
    if (v > peak) { peak = v; peakAt = rms.length; }
    rms.push(v);
  }
  return { rms, peak, peakAt };
}

/**
 * O que a app recebe de um vídeo: `track` diz se o ficheiro tem uma pista de áudio; `mono` são as amostras dela (a `rate`
 * Hz) e `seconds` a duração do ficheiro.
 */
export function soundAnalysis(track: boolean, mono: ArrayLike<number> | null, rate: number, seconds: number): SoundAnalysis {
  const durationMs = Math.max(0, Math.round(seconds * 1000));
  if (!track || !mono || !mono.length) return { hasAudio: false, energy: [], rate: ANALYZE_HZ, loudestMs: null, durationMs };
  const { rms, peak, peakAt } = rmsBlocks(mono, rate, ANALYZE_HZ);
  if (!(peak >= SILENCE_RMS)) return { hasAudio: false, energy: [], rate: ANALYZE_HZ, loudestMs: null, durationMs };
  return {
    hasAudio: true,
    energy: rms.map((v) => r3(v / peak)),
    rate: ANALYZE_HZ,
    loudestMs: Math.min(Math.round(((peakAt + 0.5) / ANALYZE_HZ) * 1000), durationMs || Infinity),
    durationMs,
  };
}
