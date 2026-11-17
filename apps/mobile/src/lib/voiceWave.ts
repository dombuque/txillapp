/**
 * A onda das mensagens de voz nas conversas (components/ChatBubbles `VoiceMessage`). Contas puras, sem React, testadas em
 * tests/voiceWave.test.mjs.
 *
 * Antes havia sempre 42 barras com pelo menos 2 px cada e 2 px entre elas (166 px no mínimo), mas a onda só tinha uns
 * 140 px: as barras passavam por baixo da duração e do «1×», que ficavam por cima do fim da onda. Agora o número de
 * barras sai da largura que a onda tem mesmo (nunca transborda), e a duração e a velocidade ficam numa linha própria,
 * por baixo da onda.
 */

/** A largura de cada barra e o espaço entre elas (px). */
export const BAR_W = 3;
export const BAR_GAP = 2;
/** Quantas barras, no mínimo e no máximo; antes de medir a onda, `BARS_DEFAULT`. */
export const BARS_MIN = 12;
export const BARS_MAX = 48;
export const BARS_DEFAULT = 28;

/** Quantas barras cabem numa onda com `width` px (sem transbordar). */
export function voiceBarCount(width: number): number {
  if (!(width > 0)) return BARS_DEFAULT;
  const n = Math.floor((width + BAR_GAP) / (BAR_W + BAR_GAP));
  return Math.max(BARS_MIN, Math.min(BARS_MAX, n));
}

/**
 * Alturas das `n` barras (0..1): a onda medida na gravação (texto de dígitos 0 a 9) ou, em mensagens antigas, uma onda
 * estável feita a partir do id.
 */
export function waveHeights(id: string, waveform: string | null | undefined, n: number): number[] {
  const out: number[] = [];
  if (waveform && waveform.length >= 8) {
    const w = waveform;
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i * w.length) / n);
      const b = Math.max(a + 1, Math.floor(((i + 1) * w.length) / n));
      let sum = 0;
      for (let k = a; k < b; k++) sum += Number(w[k]) || 0;
      out.push(0.16 + 0.84 * (sum / (b - a) / 9));
    }
    return out;
  }
  let seed = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 17);
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out.push(0.2 + 0.8 * Math.abs(Math.sin(i * 0.55 + (seed % 100) / 40)) * (0.45 + (seed % 55) / 100));
  }
  return out;
}

/** O chip da velocidade (1×, 1,5×, 2×): só enquanto toca ou parada a meio (como no WhatsApp). */
export function showSpeed(playing: boolean, atMs: number): boolean {
  return playing || atMs > 0;
}

/** «1×», «1,5×», «2×». */
export function speedLabel(rate: number): string {
  return `${String(rate).replace('.', ',')}×`;
}
