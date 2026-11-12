/**
 * O som do estúdio das tchekas que tem de soar igual no browser e no servidor (sem React, sem Web Audio, sem imports):
 * - os efeitos sonoros gerados por código (whoosh, pop, palmas, tambor, ding, riser, boom, vinil), amostra a amostra, com um
 *   gerador de números aleatórios com semente (o mesmo som em todo o lado, nada de ficheiros de terceiros);
 * - a resposta ao impulso do «Estádio» (reverb), normalizada (o browser usa-a num ConvolverNode sem normalizar e o servidor no
 *   `afir` com `irnorm=-1`: a mesma conta);
 * - os efeitos de voz (ids, nomes e números) e os fades da música;
 * - a faixa dos efeitos sonoros já misturada e o WAV (o servidor escreve-os em ficheiro).
 * O servidor tem uma cópia fiel em apps/api/src/compose/audio.ts (o audio-sync.spec.ts compara os dois).
 */

// ---------------------------------------------------------------- aleatório com semente

/** Mulberry32: o mesmo número para a mesma semente (no browser e no Node). Devolve valores de 0 a 1. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- efeitos de voz

export const VOICE_FX = [
  { id: 'normal', name: 'Normal' },
  { id: 'robo', name: 'Robô' },
  { id: 'esquilo', name: 'Esquilo' },
  { id: 'grave', name: 'Grave' },
  { id: 'eco', name: 'Eco' },
  { id: 'radio', name: 'Rádio' },
  { id: 'estadio', name: 'Estádio' },
] as const;
export type VoiceFxId = (typeof VOICE_FX)[number]['id'];
export const VOICE_FX_IDS = VOICE_FX.map((f) => f.id) as [VoiceFxId, ...VoiceFxId[]];
export const isVoiceFx = (v: unknown): v is VoiceFxId => typeof v === 'string' && (VOICE_FX_IDS as string[]).includes(v);

/** Os números de cada efeito (o browser monta-os com nós Web Audio; o servidor com filtros do ffmpeg). */
export const FX = {
  /** Robô: modulação em anel (a voz × um seno de 60 Hz) e um pente curto com realimentação. */
  robo: { ringHz: 60, combMs: 6, combFeedback: 0.45 },
  /** Esquilo e Grave: muda o tom sem mudar a duração. */
  esquilo: { pitch: 1.5 },
  grave: { pitch: 0.72 },
  /** Eco: repetições a cada 280 ms, cada uma 0,45 da anterior, a primeira a 0,6. */
  eco: { delayMs: 280, feedback: 0.45, wet: 0.6, taps: 4 },
  /** Rádio: só a banda do meio (500 a 3200 Hz), com presença aos 1,5 kHz e um pouco de saturação. */
  radio: { highpassHz: 500, lowpassHz: 3200, peakHz: 1500, peakDb: 6, drive: 2.5 },
  /** Estádio: um reverb grande (resposta ao impulso gerada), com a voz seca por cima. */
  estadio: { seconds: 2.4, decay: 3.2, preDelayMs: 25, wet: 0.6, dry: 1 },
} as const;

/** As repetições do eco (atraso em ms e ganho de cada uma): iguais à realimentação do browser, cortadas às `taps` primeiras. */
export function echoTaps(delayMs: number, wet: number, feedback: number, taps: number): { ms: number; gain: number }[] {
  const out: { ms: number; gain: number }[] = [];
  for (let i = 1; i <= taps; i++) out.push({ ms: delayMs * i, gain: Math.round(wet * feedback ** (i - 1) * 10000) / 10000 });
  return out;
}

/** A saturação do Rádio (a mesma curva no WaveShaper do browser e no `aeval` do servidor). */
export const radioShape = (x: number, drive: number = FX.radio.drive) => Math.tanh(drive * x) / Math.tanh(drive);

/**
 * A resposta ao impulso do Estádio: ruído estéreo (uma semente por canal) que decai, depois de um pequeno atraso, com a
 * energia de cada canal normalizada a 1 (o reverb não fica mais alto nem mais baixo do que a voz).
 */
export function reverbImpulse(rate: number, seconds: number = FX.estadio.seconds, decay: number = FX.estadio.decay, preDelayMs: number = FX.estadio.preDelayMs): [Float32Array, Float32Array] {
  const len = Math.max(1, Math.round(rate * seconds));
  const pre = Math.round((rate * preDelayMs) / 1000);
  const make = (seed: number) => {
    const r = seeded(seed);
    const ch = new Float32Array(len);
    let e = 0;
    for (let i = pre; i < len; i++) {
      const v = (r() * 2 - 1) * Math.pow(1 - (i - pre) / (len - pre), decay);
      ch[i] = v;
      e += v * v;
    }
    const k = e > 0 ? 1 / Math.sqrt(e) : 0;
    for (let i = 0; i < len; i++) ch[i] *= k;
    return ch;
  };
  return [make(7), make(11)];
}

// ---------------------------------------------------------------- fades

/** O fade-in e o fade-out vão de 0 a 3 s. */
export const MAX_FADE_S = 3;
export const clampFade = (s: number) => (Number.isFinite(s) ? Math.min(MAX_FADE_S, Math.max(0, Math.round(s * 10) / 10)) : 0);

/**
 * O ganho da música no instante `t` de uma tcheka com `total` segundos: sobe a direito de 0 a 1 durante `fadeIn` e desce a
 * direito até 0 nos últimos `fadeOut` (o `afade` do ffmpeg, curva `tri`, faz o mesmo). Os dois juntos multiplicam-se.
 */
export function fadeGain(t: number, total: number, fadeIn: number, fadeOut: number): number {
  const fi = clampFade(fadeIn), fo = Math.min(clampFade(fadeOut), Math.max(0, total));
  const a = fi > 0 ? Math.min(1, Math.max(0, t / fi)) : 1;
  const b = fo > 0 ? Math.min(1, Math.max(0, (total - t) / fo)) : 1;
  return a * b;
}

/** Os pontos (tempo, ganho) da curva dos fades, para rampas lineares (Web Audio): entre eles a curva é uma reta. */
export function fadePoints(total: number, fadeIn: number, fadeOut: number): { t: number; g: number }[] {
  const fi = Math.min(clampFade(fadeIn), total), fo = Math.min(clampFade(fadeOut), total);
  const ts = new Set<number>([0, total]);
  if (fi > 0) ts.add(fi);
  if (fo > 0) ts.add(Math.max(0, total - fo));
  return [...ts].sort((x, y) => x - y).map((t) => ({ t, g: Math.round(fadeGain(t, total, fi, fo) * 10000) / 10000 }));
}

// ---------------------------------------------------------------- ducking

/** Com voz-off, a música baixa para 0,3 (cerca de −10 dB) enquanto se fala, a descer em 0,12 s e a voltar em 0,45 s. */
export const DUCK = { gain: 0.3, attack: 0.12, release: 0.45 } as const;

// ---------------------------------------------------------------- efeitos sonoros

export const SFX = [
  { id: 'whoosh', name: 'Whoosh', seconds: 0.75 },
  { id: 'pop', name: 'Pop', seconds: 0.16 },
  { id: 'palmas', name: 'Palmas', seconds: 0.9 },
  { id: 'tambor', name: 'Tambor', seconds: 0.55 },
  { id: 'ding', name: 'Ding', seconds: 1.4 },
  { id: 'riser', name: 'Riser', seconds: 2 },
  { id: 'boom', name: 'Boom', seconds: 1.8 },
  { id: 'vinil', name: 'Vinil', seconds: 0.7 },
] as const;
export type SfxId = (typeof SFX)[number]['id'];
export const SFX_IDS = SFX.map((s) => s.id) as [SfxId, ...SfxId[]];
export const isSfx = (v: unknown): v is SfxId => typeof v === 'string' && (SFX_IDS as string[]).includes(v);
/** No máximo 30 efeitos sonoros numa tcheka. */
export const MAX_SFX = 30;

/** Filtro passa-banda simples (state variable, de Chamberlin), uma amostra de cada vez. */
function bandpass(rate: number) {
  let low = 0, band = 0;
  return (x: number, hz: number, q: number) => {
    const f = 2 * Math.sin((Math.PI * Math.min(hz, rate / 6.5)) / rate);
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    return band;
  };
}

/** Deixa o pico em `peak` (os efeitos ficam todos ao mesmo nível). */
function normalize(a: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] = (a[i] / m) * peak;
  return a;
}

/** Um efeito sonoro (mono, a `rate` Hz). Sempre igual para o mesmo id e a mesma taxa. */
export function synthSfx(id: SfxId, rate: number): Float32Array {
  const def = SFX.find((s) => s.id === id);
  if (!def) return new Float32Array(0);
  const n = Math.round(def.seconds * rate);
  const out = new Float32Array(n);
  const rnd = seeded(1000 + SFX_IDS.indexOf(id));
  const noise = () => rnd() * 2 - 1;
  const T = def.seconds;
  if (id === 'whoosh') {
    // Ruído num filtro que varre de 300 Hz a 3 kHz e volta, a abrir e a fechar.
    const bp = bandpass(rate);
    for (let i = 0; i < n; i++) {
      const t = i / rate, p = t / T;
      const hz = 300 + 2700 * Math.sin(Math.PI * Math.min(1, p * 1.15)) ** 2;
      out[i] = bp(noise(), hz, 0.5) * Math.sin(Math.PI * p) ** 2;
    }
  } else if (id === 'pop') {
    // Um seno que cai de 900 para 220 Hz em poucos milissegundos (a «bolha»), com um estalido no início.
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const hz = 220 + 680 * Math.exp(-t * 60);
      ph += (2 * Math.PI * hz) / rate;
      out[i] = Math.sin(ph) * Math.exp(-t * 38) + (t < 0.003 ? noise() * 0.6 * (1 - t / 0.003) : 0);
    }
  } else if (id === 'palmas') {
    // Duas palmas (cada uma com 4 batidas de ruído muito juntas e uma cauda), no meio da banda (1,2 kHz).
    const bp = bandpass(rate);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      let env = 0;
      for (const at of [0, 0.42]) {
        const u = t - at;
        if (u < 0) continue;
        for (const k of [0, 0.011, 0.023, 0.034]) { const v = u - k; if (v >= 0 && v < 0.012) env = Math.max(env, 1 - v / 0.012); }
        if (u >= 0.034) env = Math.max(env, 0.75 * Math.exp(-(u - 0.034) * 22));
      }
      out[i] = bp(noise(), 1200, 0.9) * env;
    }
  } else if (id === 'tambor') {
    // Bombo: um seno que desce de 150 para 48 Hz, a apagar-se, com um estalido de ruído no ataque.
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const hz = 48 + 102 * Math.exp(-t * 28);
      ph += (2 * Math.PI * hz) / rate;
      out[i] = Math.sin(ph) * Math.exp(-t * 7) + noise() * 0.35 * Math.exp(-t * 120);
    }
  } else if (id === 'ding') {
    // Um sino: parciais inarmónicas de 880 Hz, as mais agudas a apagar-se primeiro.
    const parts = [[1, 1, 2.2], [2.0, 0.45, 3.4], [2.76, 0.3, 4.6], [5.4, 0.16, 7.5]] as const;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      let v = 0;
      for (const [k, a, d] of parts) v += a * Math.sin(2 * Math.PI * 880 * k * t) * Math.exp(-t * d);
      out[i] = v * Math.min(1, t / 0.002);
    }
  } else if (id === 'riser') {
    // A subir: ruído num filtro de 400 Hz a 6 kHz e um tom de 200 a 1200 Hz, cada vez mais forte; corta seco no fim.
    const bp = bandpass(rate);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate, p = t / T;
      const hz = 200 * Math.pow(6, p);
      ph += (2 * Math.PI * hz) / rate;
      const tone = Math.sin(ph) + 0.33 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph);
      const env = p * p * (p > 0.985 ? (1 - p) / 0.015 : 1);
      out[i] = (bp(noise(), 400 * Math.pow(15, p), 0.6) * 0.9 + tone * 0.35) * env;
    }
  } else if (id === 'boom') {
    // Grave a cair (70 → 30 Hz) com um rugido de ruído filtrado e uma saturação suave.
    const bp = bandpass(rate);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const hz = 30 + 40 * Math.exp(-t * 3);
      ph += (2 * Math.PI * hz) / rate;
      const v = Math.sin(ph) * Math.exp(-t * 2.2) + bp(noise(), 120, 1.2) * 0.8 * Math.exp(-t * 5);
      out[i] = Math.tanh(1.6 * v * Math.min(1, t / 0.004));
    }
  } else if (id === 'vinil') {
    // «Scratch» de disco: um som rico lido para a frente e para trás (velocidade em vaivém), com estalidos de vinil.
    const bp = bandpass(rate);
    let pos = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate, p = t / T;
      const speed = Math.sin(2 * Math.PI * 2.2 * p) * 2.6;
      pos += speed / rate;
      const src = Math.sin(2 * Math.PI * 340 * pos) + 0.5 * Math.sin(2 * Math.PI * 690 * pos) + 0.3 * Math.sin(2 * Math.PI * 1370 * pos);
      const grit = bp(noise(), 600 + 2200 * Math.abs(speed) / 2.6, 0.7);
      const crackle = rnd() > 0.9993 ? noise() * 2 : 0;
      out[i] = (src * 0.5 + grit * 0.9) * Math.min(1, Math.abs(speed)) * Math.sin(Math.PI * p) ** 0.5 + crackle * 0.4;
    }
  }
  return normalize(out);
}

/** Um efeito sonoro posto na tcheka: qual e quando (segundos). */
export interface SfxCue { id: SfxId; at: number }

/** A faixa dos efeitos sonoros (mono, `seconds` de duração), cada um somado no seu instante; o que passa do fim fica cortado. */
export function renderSfxTrack(cues: SfxCue[], seconds: number, rate: number): Float32Array {
  const out = new Float32Array(Math.max(0, Math.round(seconds * rate)));
  const cache = new Map<SfxId, Float32Array>();
  for (const c of cues) {
    if (!isSfx(c.id) || !(c.at >= 0)) continue;
    const s = cache.get(c.id) ?? synthSfx(c.id, rate);
    cache.set(c.id, s);
    const start = Math.round(c.at * rate);
    for (let i = 0; i < s.length && start + i < out.length; i++) out[start + i] += s[i];
  }
  return out;
}

/** Um WAV PCM de 16 bits (os canais têm de ter o mesmo tamanho). */
export function encodeWav(channels: Float32Array[], rate: number): Uint8Array {
  const ch = Math.max(1, channels.length);
  const len = channels[0]?.length ?? 0;
  const data = len * ch * 2;
  const buf = new Uint8Array(44 + data);
  const v = new DataView(buf.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      v.setInt16(o, Math.round(x < 0 ? x * 32768 : x * 32767), true);
      o += 2;
    }
  }
  return buf;
}
