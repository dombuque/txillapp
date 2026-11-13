import { ANALYZE_HZ, rmsBlocks, SILENCE_RMS, soundAnalysis } from './analyze';

/** `seconds` de som a `rate` Hz, com a amplitude de cada instante dada por `amp(t)`. */
function tone(seconds: number, rate: number, amp: (t: number) => number) {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = amp(i / rate) * Math.sin((2 * Math.PI * 440 * i) / rate);
  return out;
}

describe('a energia do som de um vídeo (analyze.ts)', () => {
  it('blocos de 0,25 s, de 0 a 1, com o mais forte no sítio certo', () => {
    const mono = tone(4, 8000, (t) => (t >= 2 && t < 2.5 ? 0.9 : 0.1));
    const r = soundAnalysis(true, mono, 8000, 4);
    expect(r.hasAudio).toBe(true);
    expect(r.rate).toBe(ANALYZE_HZ);
    expect(r.energy).toHaveLength(16);
    expect(Math.max(...r.energy)).toBe(1);
    expect(r.energy.every((e) => e >= 0 && e <= 1)).toBe(true);
    // O pico está nos blocos 8 e 9 (2,0 a 2,5 s); o resto anda pelos 0,11.
    expect(r.energy[8]).toBeGreaterThan(0.95);
    expect(r.energy[3]).toBeLessThan(0.2);
    expect(r.loudestMs).toBeGreaterThanOrEqual(2000);
    expect(r.loudestMs).toBeLessThanOrEqual(2500);
    expect(r.durationMs).toBe(4000);
  });

  it('sem pista de áudio, ou só com silêncio, não tem som', () => {
    expect(soundAnalysis(false, null, 8000, 3)).toEqual({ hasAudio: false, energy: [], rate: ANALYZE_HZ, loudestMs: null, durationMs: 3000 });
    const quiet = tone(3, 8000, () => SILENCE_RMS / 4);
    expect(soundAnalysis(true, quiet, 8000, 3).hasAudio).toBe(false);
    expect(soundAnalysis(true, new Float32Array(0), 8000, 3).hasAudio).toBe(false);
  });

  it('o último bloco incompleto conta, e o instante mais alto nunca passa do fim', () => {
    const mono = tone(1.1, 8000, (t) => (t > 1 ? 1 : 0.2));
    const b = rmsBlocks(mono, 8000);
    expect(b.rms).toHaveLength(5);
    const r = soundAnalysis(true, mono, 8000, 1.1);
    expect(r.loudestMs).toBeLessThanOrEqual(1100);
  });
});
