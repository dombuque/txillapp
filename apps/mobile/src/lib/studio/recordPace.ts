/**
 * O ritmo dos frames da gravação no site (canvas + MediaRecorder), sem React nem browser (testado em
 * tests/studioRecordPace.test.mjs).
 *
 * Antes desenhava-se «quando já tinham passado 30 ms desde o último frame», com o instante do relógio de cada volta do
 * requestAnimationFrame. Num ecrã de 60 Hz os tiques vêm de 16,7 em 16,7 ms com alguns ms de variação: um frame que
 * calhasse aos 29,9 ms ficava para o tique seguinte (50 ms), e o gravador (`captureStream(30)`) ainda deitava fora os
 * frames que chegavam antes do tempo dele. O vídeo saía com frames de 33 e 50 ms misturados e, depois da conversão do
 * servidor para 30 fps certos, com frames repetidos e saltados: a tcheka «estremecia».
 *
 * Agora os frames têm uma grelha fixa: o frame `n` é o instante `n / fps` da tcheka (o desenho usa esse instante, não o do
 * relógio) e desenha-se no primeiro tique que chegue a meio tique do instante dele (`slack`). Se a página se atrasou mais
 * de um frame, salta para o frame certo (perde frames em vez de os acumular). Quem grava pede cada frame ao gravador
 * (`captureStream(0)` + `requestFrame()`), por isso cada frame desenhado é um frame do vídeo, com o tempo dele.
 */

/** Os frames por segundo da gravação (os do vídeo final do servidor: docs/montagem.md, 4). */
export const REC_FPS = 30;

export interface FramePacer {
  fps: number;
  /** O instante do relógio (ms) do frame 0. */
  t0: number;
  /** O próximo frame a desenhar. */
  next: number;
  /** O intervalo entre tiques do ecrã (ms), medido; 16,7 até se saber. */
  vsync: number;
  /** O último tique (ms), para medir o intervalo. */
  lastTick: number | null;
}

export const makePacer = (t0: number, fps = REC_FPS): FramePacer => ({ fps, t0, next: 0, vsync: 1000 / 60, lastTick: null });

export interface PaceTick {
  pacer: FramePacer;
  /** O frame a desenhar neste tique (null: ainda não é tempo). */
  frame: number | null;
  /** Quantos frames ficaram por desenhar (a página atrasou-se). */
  skipped: number;
}

/** Mais um tique do ecrã, no instante `now` (ms): desenha-se agora? */
export function paceTick(p: FramePacer, now: number): PaceTick {
  const period = 1000 / p.fps;
  let vsync = p.vsync;
  if (p.lastTick !== null) {
    const dt = now - p.lastTick;
    // Só os intervalos de um tique (de 120 Hz a 30 Hz) contam para a medida; um tique perdido não a estraga.
    if (dt > 4 && dt < 40) vsync = vsync * 0.9 + Math.min(dt, period) * 0.1;
  }
  const slack = Math.min(period, vsync) / 2;
  const base = { ...p, vsync, lastTick: now };
  const due = p.t0 + p.next * period;
  if (now < due - slack) return { pacer: base, frame: null, skipped: 0 };
  const late = Math.floor((now + slack - p.t0) / period);
  const frame = Math.max(p.next, late);
  return { pacer: { ...base, next: frame + 1 }, frame, skipped: frame - p.next };
}

/** A sequência esperou (um vídeo a carregar): a grelha anda `ms` para a frente, sem perder frames. */
export const shiftPacer = (p: FramePacer, ms: number): FramePacer => ({ ...p, t0: p.t0 + (Number.isFinite(ms) ? ms : 0), lastTick: null });

/** O instante da tcheka (s) do frame `n`, numa volta que começou em `from`. */
export const frameTime = (p: FramePacer, from: number, n: number) => from + n / p.fps;

/**
 * Os formatos do gravador, pela ordem: H.264 em MP4 pedido pelo nome (o Chrome recente e o Safari; quase sempre com o
 * codificador do aparelho, o que deixa o canvas a 30 fps num telemóvel), H.264 em WebM (Chrome mais antigo), VP8 (leve a
 * codificar em tempo real), o MP4 do browser, VP9 e o WebM do browser.
 *
 * Antes ia `video/mp4` sem codec à frente: num Chromium sem H.264 isso é VP9 dentro de MP4, e o VP9 a 1080×1920 em tempo
 * real, por software, não chega aos 30 fps: medido no Chromium (Playwright), ~100 frames em 8 s.
 */
export const RECORDER_TYPES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp8,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm',
] as const;
export function pickRecorderType(supported: (t: string) => boolean): string {
  for (const t of RECORDER_TYPES) { try { if (supported(t)) return t; } catch { /* este browser não sabe responder */ } }
  return '';
}
/** O débito do vídeo gravado: o servidor volta a converter (CRF 23, até 6 Mbit/s); com menos de 8 a imagem perdia duas vezes. */
export const REC_BITRATE = 8_000_000;
