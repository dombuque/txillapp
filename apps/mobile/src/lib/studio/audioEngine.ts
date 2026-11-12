/**
 * O som do estúdio das tchekas no browser (Web Audio). O TchekaStudio cria o contexto e o `master`; daqui saem:
 * - o grafo dos canais: som original (com efeito de voz) → volume; música → fades → ducking → volume; voz-off (com efeito)
 *   → volume; efeitos sonoros → volume. Tudo vai ao `master`, que vai à gravação (MediaRecorder) e às colunas: a gravação
 *   leva exatamente a mistura que se ouve.
 * - os efeitos de voz (Robô, Esquilo, Grave, Eco, Rádio, Estádio) com nós Web Audio, a partir dos números de audioDsp.ts
 *   (os mesmos que o servidor usa no ffmpeg);
 * - o agendamento de uma volta da pré-visualização (fades, ducking, voz-off e efeitos sonoros nos seus instantes);
 * - ouvir a música enquanto se arrasta o trecho (direto às colunas, nunca à gravação);
 * - os medidores de nível do misturador.
 */
import { DUCK, echoTaps, fadePoints, FX, radioShape, reverbImpulse, synthSfx, type SfxId, type VoiceFxId } from './audioDsp';
import { curveAt, duckPoints, type PlacedSfx, type StudioMix } from './audioMix';

type Chain = { input: AudioNode; output: AudioNode; dispose: () => void };

export interface StudioGraph {
  ac: AudioContext;
  /** Onde ligam os vídeos (o som original). */
  origIn: GainNode;
  /** Onde liga a música (o nó dos fades). */
  musicIn: GainNode;
  musicDuck: GainNode;
  voiceIn: GainNode;
  voiceGain: GainNode;
  sfxGain: GainNode;
  meters: { orig: AnalyserNode; music: AnalyserNode; voice: AnalyserNode; sfx: AnalyserNode };
  /** As gravações da voz-off já descodificadas (pelo id da gravação). */
  voiceBufs: Map<string, AudioBuffer>;
  /** A volta agendada mais recente (só ela pode repor as curvas da música ao parar). */
  gen: number;
  /** O estado aplicado agora (para só refazer o que muda). */
  applied: { origFx: VoiceFxId; voiceFx: VoiceFxId; origChain: Chain; voiceChain: Chain; origOut: AudioNode };
}

const ir = new WeakMap<BaseAudioContext, AudioBuffer>();
const sfxBufs = new WeakMap<BaseAudioContext, Map<SfxId, AudioBuffer>>();

/** A resposta ao impulso do Estádio neste contexto (gerada uma vez). */
function impulse(ac: BaseAudioContext): AudioBuffer {
  let b = ir.get(ac);
  if (!b) {
    const [l, r] = reverbImpulse(ac.sampleRate);
    b = ac.createBuffer(2, l.length, ac.sampleRate);
    b.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
    b.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    ir.set(ac, b);
  }
  return b;
}

/** Um efeito sonoro como AudioBuffer (gerado uma vez por contexto). */
export function sfxBuffer(ac: BaseAudioContext, id: SfxId): AudioBuffer {
  let m = sfxBufs.get(ac);
  if (!m) { m = new Map(); sfxBufs.set(ac, m); }
  let b = m.get(id);
  if (!b) {
    const s = synthSfx(id, ac.sampleRate);
    b = ac.createBuffer(1, Math.max(1, s.length), ac.sampleRate);
    b.copyToChannel(s as Float32Array<ArrayBuffer>, 0);
    m.set(id, b);
  }
  return b;
}

/**
 * Mudar o tom sem mudar a duração, em tempo real (também no som dos vídeos a tocar): duas linhas de atraso cujo atraso
 * sobe ou desce a direito (dente de serra), desfasadas meio período, cada uma com uma janela seno² (as duas somam 1).
 */
function pitchShift(ac: BaseAudioContext, ratio: number): Chain {
  const D = 0.08;
  const P = D / Math.abs(ratio - 1);
  const len = Math.max(2, Math.round(P * ac.sampleRate));
  const saw = ac.createBuffer(1, len, ac.sampleRate);
  const win = ac.createBuffer(1, len, ac.sampleRate);
  const s = saw.getChannelData(0), w = win.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const p = i / len;
    s[i] = ratio > 1 ? 1 - p : p; // para cima o atraso encolhe; para baixo cresce
    w[i] = Math.sin(Math.PI * p) ** 2;
  }
  const input = ac.createGain(), output = ac.createGain();
  const srcs: AudioBufferSourceNode[] = [];
  const start = ac.currentTime + 0.01;
  for (const phase of [0, 0.5]) {
    const delay = ac.createDelay(D + 0.05);
    delay.delayTime.value = 0;
    const depth = ac.createGain();
    depth.gain.value = D;
    const mod = ac.createBufferSource(); mod.buffer = saw; mod.loop = true;
    const fade = ac.createBufferSource(); fade.buffer = win; fade.loop = true;
    const vca = ac.createGain();
    vca.gain.value = 0;
    mod.connect(depth).connect(delay.delayTime);
    fade.connect(vca.gain);
    input.connect(delay).connect(vca).connect(output);
    mod.start(start, phase * P);
    fade.start(start, phase * P);
    srcs.push(mod, fade);
  }
  return { input, output, dispose: () => { srcs.forEach((n) => { try { n.stop(); } catch { /* já parou */ } }); input.disconnect(); output.disconnect(); } };
}

const butterworthQ = -3.0103; // em dB nos passa-alto e passa-baixo do Web Audio: Q = 0,707 (o do ffmpeg por omissão)

/** Um efeito de voz como uma cadeia de nós (entrada → saída). */
export function voiceChain(ac: BaseAudioContext, id: VoiceFxId): Chain {
  const input = ac.createGain();
  const output = ac.createGain();
  const extra: AudioNode[] = [];
  const stops: (() => void)[] = [];
  if (id === 'robo') {
    const ring = ac.createGain();
    ring.gain.value = 0;
    const osc = ac.createOscillator();
    osc.frequency.value = FX.robo.ringHz;
    osc.connect(ring.gain);
    osc.start();
    stops.push(() => { try { osc.stop(); } catch { /* já parou */ } });
    const sum = ac.createGain();
    const delay = ac.createDelay(0.05);
    delay.delayTime.value = FX.robo.combMs / 1000;
    const fb = ac.createGain();
    fb.gain.value = FX.robo.combFeedback;
    input.connect(ring).connect(sum).connect(output);
    sum.connect(delay).connect(fb).connect(sum);
    extra.push(ring, sum, delay, fb);
  } else if (id === 'esquilo' || id === 'grave') {
    const ps = pitchShift(ac, FX[id].pitch);
    input.connect(ps.input);
    ps.output.connect(output);
    stops.push(ps.dispose);
  } else if (id === 'eco') {
    // Seco + repetições com realimentação (as primeiras `taps` são as mesmas do `aecho` do servidor).
    input.connect(output);
    const send = ac.createGain();
    send.gain.value = FX.eco.wet;
    const delay = ac.createDelay(1);
    delay.delayTime.value = FX.eco.delayMs / 1000;
    const fb = ac.createGain();
    fb.gain.value = FX.eco.feedback;
    input.connect(send).connect(delay).connect(output);
    delay.connect(fb).connect(delay);
    extra.push(send, delay, fb);
  } else if (id === 'radio') {
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = FX.radio.highpassHz; hp.Q.value = butterworthQ;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = FX.radio.lowpassHz; lp.Q.value = butterworthQ;
    const pk = ac.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = FX.radio.peakHz; pk.gain.value = FX.radio.peakDb; pk.Q.value = 1;
    const sh = ac.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) curve[i] = radioShape((i / (curve.length - 1)) * 2 - 1);
    sh.curve = curve;
    input.connect(hp).connect(lp).connect(pk).connect(sh).connect(output);
    extra.push(hp, lp, pk, sh);
  } else if (id === 'estadio') {
    const dry = ac.createGain(); dry.gain.value = FX.estadio.dry;
    const wet = ac.createGain(); wet.gain.value = FX.estadio.wet;
    const conv = ac.createConvolver();
    conv.normalize = false; // a resposta já vem normalizada (a mesma conta do `afir` do servidor)
    conv.buffer = impulse(ac);
    input.connect(dry).connect(output);
    input.connect(conv).connect(wet).connect(output);
    extra.push(dry, wet, conv);
  } else {
    input.connect(output);
  }
  return {
    input, output,
    dispose: () => { stops.forEach((f) => f()); [input, output, ...extra].forEach((n) => { try { n.disconnect(); } catch { /* já desligado */ } }); },
  };
}

/** Cria o grafo dos canais por cima do que o estúdio já tem (`origGain` e `musicGain` são os volumes, ligados ao `master`). */
export function createStudioGraph(ac: AudioContext, n: { origGain: GainNode; musicGain: GainNode; master: AudioNode }): StudioGraph {
  const origIn = ac.createGain();
  const musicIn = ac.createGain();
  const musicDuck = ac.createGain();
  const voiceIn = ac.createGain();
  const voiceGain = ac.createGain();
  const sfxGain = ac.createGain();
  const meter = () => { const a = ac.createAnalyser(); a.fftSize = 1024; a.smoothingTimeConstant = 0.3; return a; };
  const meters = { orig: meter(), music: meter(), voice: meter(), sfx: meter() };
  musicIn.connect(musicDuck).connect(n.musicGain);
  n.musicGain.connect(meters.music);
  n.origGain.connect(meters.orig);
  voiceGain.connect(n.master);
  voiceGain.connect(meters.voice);
  sfxGain.connect(n.master);
  sfxGain.connect(meters.sfx);
  const origChain = voiceChain(ac, 'normal');
  const voiceCh = voiceChain(ac, 'normal');
  origIn.connect(origChain.input);
  origChain.output.connect(n.origGain);
  voiceIn.connect(voiceCh.input);
  voiceCh.output.connect(voiceGain);
  return { ac, origIn, musicIn, musicDuck, voiceIn, voiceGain, sfxGain, meters, voiceBufs: new Map(), gen: 0, applied: { origFx: 'normal', voiceFx: 'normal', origChain, voiceChain: voiceCh, origOut: n.origGain } };
}

/** Põe no grafo o que muda sem recomeçar: os efeitos de voz e os volumes da voz-off e dos efeitos sonoros. */
export function applyLive(g: StudioGraph, mix: StudioMix) {
  const a = g.applied;
  if (a.origFx !== mix.origFx) {
    g.origIn.disconnect();
    a.origChain.dispose();
    a.origChain = voiceChain(g.ac, mix.origFx);
    g.origIn.connect(a.origChain.input);
    a.origChain.output.connect(a.origOut);
    a.origFx = mix.origFx;
  }
  const vfx = mix.voice?.fx ?? 'normal';
  if (a.voiceFx !== vfx) {
    g.voiceIn.disconnect();
    a.voiceChain.dispose();
    a.voiceChain = voiceChain(g.ac, vfx);
    g.voiceIn.connect(a.voiceChain.input);
    a.voiceChain.output.connect(g.voiceGain);
    a.voiceFx = vfx;
  }
  g.voiceGain.gain.value = mix.voice?.volume ?? 1;
  g.sfxGain.gain.value = mix.sfxVolume;
}

/** Uma curva de pontos num AudioParam, a partir do instante `from` da tcheka (`t0` é o tempo do contexto no 0 da tcheka). */
function automate(p: AudioParam, pts: { t: number; g: number }[], from: number, t0: number) {
  const now = t0 + from;
  p.cancelScheduledValues(0);
  p.setValueAtTime(curveAt(pts, from), now);
  for (const q of pts) if (q.t > from + 1e-4) p.linearRampToValueAtTime(q.g, t0 + q.t);
}

export interface MixSchedule {
  /** Pára tudo (fim da volta, pausa ou mudança). */
  stop(): void;
  /** Refaz as curvas da música (fades e ducking) a partir de agora, sem recomeçar. */
  update(mix: StudioMix): void;
  /** Um efeito sonoro posto agora, a meio da volta: toca já (entra também na gravação, como os outros). */
  addSfx(c: PlacedSfx): void;
  /** Um efeito sonoro tirado: se ainda não tocou nesta volta, já não toca. */
  removeSfx(key: string): void;
}

/**
 * Agenda uma volta da pré-visualização (ou da gravação final) desde `from`: os fades e o ducking da música, a voz-off e os
 * efeitos sonoros. `t0` é `ac.currentTime` no instante 0 da tcheka.
 */
export function scheduleMix(g: StudioGraph, o: { from: number; total: number; t0: number; mix: StudioMix; muteVoice?: boolean }): MixSchedule {
  const { ac } = g;
  const { from, total, t0 } = o;
  const gen = ++g.gen;
  applyLive(g, o.mix);
  /** O instante da tcheka agora (nunca antes de `from`). */
  const tNow = () => Math.max(from, ac.currentTime - t0);
  const curves = (mix: StudioMix, at: number) => {
    automate(g.musicIn.gain, fadePoints(total, mix.fadeIn, mix.fadeOut), at, t0);
    const v = mix.voice && !o.muteVoice ? mix.voice : null;
    const duck = v && g.voiceBufs.has(v.id) && mix.ducking ? duckPoints(v.regions.map((r) => ({ start: r.start + v.at, end: r.end + v.at })), total, DUCK) : [{ t: 0, g: 1 }];
    automate(g.musicDuck.gain, duck, at, t0);
  };
  curves(o.mix, from);
  const srcs = new Map<string, AudioBufferSourceNode>();
  const play = (key: string, buf: AudioBuffer, to: AudioNode, at: number, now: number) => {
    const off = now - at;
    if (off >= buf.duration || at >= total) return;
    const s = ac.createBufferSource();
    s.buffer = buf;
    s.connect(to);
    if (off > 0) s.start(t0 + now, off); else s.start(t0 + at);
    s.stop(t0 + total);
    srcs.set(key, s);
  };
  const v = o.mix.voice && !o.muteVoice ? o.mix.voice : null;
  const vb = v ? g.voiceBufs.get(v.id) : null;
  if (v && vb) play('voice', vb, g.voiceIn, v.at, from);
  for (const c of o.mix.sfx) play(c.key, sfxBuffer(ac, c.id), g.sfxGain, c.at, from);
  let stopped = false;
  return {
    stop() {
      stopped = true;
      srcs.forEach((s) => { try { s.stop(); } catch { /* já parou */ } s.disconnect(); });
      srcs.clear();
      if (g.gen === gen) for (const p of [g.musicIn.gain, g.musicDuck.gain]) { p.cancelScheduledValues(0); p.value = 1; }
    },
    update(mix) { if (!stopped) { applyLive(g, mix); curves(mix, tNow()); } },
    addSfx(c) { if (!stopped) play(c.key, sfxBuffer(ac, c.id), g.sfxGain, c.at, tNow()); },
    removeSfx(key) { const s = srcs.get(key); if (s) { try { s.stop(); } catch { /* já parou */ } srcs.delete(key); } },
  };
}

/** Toca um efeito sonoro já (ao tocar no botão), só nas colunas. */
export function auditionSfx(ac: AudioContext, id: SfxId, volume = 1) {
  const s = ac.createBufferSource();
  s.buffer = sfxBuffer(ac, id);
  const gn = ac.createGain();
  gn.gain.value = volume;
  s.connect(gn).connect(ac.destination);
  s.start();
}

/** O nível de um medidor (0 a 1, em escala de dB de −48 a 0). */
export function meterLevel(a: AnalyserNode, scratch?: Float32Array<ArrayBuffer>): number {
  const d = scratch && scratch.length === a.fftSize ? scratch : new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(d);
  let e = 0;
  for (let i = 0; i < d.length; i++) e += d[i] * d[i];
  const db = 20 * Math.log10(Math.sqrt(e / d.length) + 1e-9);
  return Math.min(1, Math.max(0, (db + 48) / 48));
}

/**
 * Ouvir enquanto se arrasta o trecho: toca a música a partir de `at` (até 2,5 s, com entrada e saída suaves) direto às
 * colunas (nunca ao `master`: não entra na gravação). Cada `play` novo corta o anterior.
 */
export function createScrubber(ac: AudioContext) {
  let cur: { s: AudioBufferSourceNode; g: GainNode } | null = null;
  const stop = () => {
    if (!cur) return;
    const { s, g } = cur;
    const t = ac.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0, t, 0.02);
    try { s.stop(t + 0.1); } catch { /* já parou */ }
    cur = null;
  };
  return {
    play(buf: AudioBuffer, at: number, volume = 1) {
      stop();
      if (ac.state !== 'running') void ac.resume().catch(() => undefined);
      const s = ac.createBufferSource();
      s.buffer = buf;
      const g = ac.createGain();
      const t = ac.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volume, t + 0.03);
      g.gain.setValueAtTime(volume, t + 2.2);
      g.gain.linearRampToValueAtTime(0, t + 2.5);
      s.connect(g).connect(ac.destination);
      s.start(t, Math.max(0, Math.min(buf.duration - 0.05, at)));
      s.stop(t + 2.55);
      cur = { s, g };
    },
    stop,
  };
}

/** Um bip curto (a contagem 3-2-1 da voz-off), só nas colunas. */
export function beep(ac: AudioContext, hz: number, seconds = 0.09) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.frequency.value = hz;
  const t = ac.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.25, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + seconds + 0.02);
}

/** As amostras mono de um AudioBuffer (a média dos canais). */
export function monoOf(b: AudioBuffer): Float32Array {
  if (b.numberOfChannels === 1) return b.getChannelData(0);
  const out = new Float32Array(b.length);
  for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / b.numberOfChannels; }
  return out;
}

/** Um AudioBuffer sem os primeiros `skip` segundos (para acertar a latência da voz-off). */
export function sliceBuffer(ac: BaseAudioContext, b: AudioBuffer, skip: number): AudioBuffer {
  const from = Math.min(b.length - 1, Math.max(0, Math.round(skip * b.sampleRate)));
  if (from <= 0) return b;
  const out = ac.createBuffer(b.numberOfChannels, b.length - from, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(from), c);
  return out;
}

/** O formato da gravação da voz-off (webm/opus no Chrome e no Android, mp4/aac no Safari). */
export const voiceRecorderType = () => ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
