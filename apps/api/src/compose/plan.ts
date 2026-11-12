import { echoTaps, FX, type VoiceFxId } from './audio';
import { type ClipFx } from './effects';
import { mergedPieces, rampAudio, rampSetpts, serverFxChain } from './fx';
import { lookFilter } from './looks';

/**
 * As contas da montagem sem ffmpeg nem disco (testadas em plan.spec.ts): a grelha dos frames, os argumentos de cada clipe
 * (1.º passo) e o grafo final (2.º passo). Ver docs/montagem.md.
 *
 * 1.º passo, um clipe de cada vez (pouca memória): cada clipe sai já no tamanho final, a 30 fps, cortado, à velocidade dele,
 * com o filtro e, nas fotos, o zoom suave (Ken Burns). A transição faz-se aqui, como no estúdio do site: o último frame do
 * clipe anterior (parado) funde-se ou desliza para dar lugar a este, durante 0,5 s, sem mudar a duração de nenhum.
 * 2.º passo: junta os bocados (sem voltar a descodificar nada de fora), o dueto ao lado, o texto, os stickers, a
 * assinatura e a mistura do som, e grava o MP4 final.
 */

export const FPS = 30;
export const RATE = 48_000;
/** Amostras de áudio por frame (48 000 / 30). */
export const SPF = RATE / FPS;
/** Duração da transição (como `TR` no TchekaStudio). */
export const TR = 0.5;
/** O tamanho final (9:16). */
export const OUT_W = 1080;
export const OUT_H = 1920;
/** O dueto (como `duetLayout` em apps/mobile/src/lib/remix.ts): duas metades com um quadro 9:16 ao meio, faixas pretas. */
export const DUET = { w: OUT_W / 2, h: Math.min(OUT_H, ((OUT_W / 2) * 16) / 9), y: (OUT_H - Math.min(OUT_H, ((OUT_W / 2) * 16) / 9)) / 2 };
/** Quanto a foto aproxima no fim (Ken Burns, como no estúdio: 1 → 1,07). */
export const KEN_BURNS = 0.07;
/** As fotos vão para o ffmpeg já maiores do que o quadro (o zoom fica suave, sem saltos de um píxel). */
export const PHOTO_OVERSCAN = 1.5;

export type Transition = 'cut' | 'fade' | 'slide';

export interface Slot { start: number; frames: number }

/**
 * A grelha em frames: cada clipe começa no frame arredondado do seu início e acaba no do seu fim (assim a soma não escorrega
 * com os arredondamentos). Corta em `maxSeconds`; os clipes que já não cabem ficam com 0 frames.
 */
export function frameSlots(durations: number[], maxSeconds: number): Slot[] {
  const max = Math.round(maxSeconds * FPS);
  let t = 0;
  return durations.map((d) => {
    const a = Math.min(max, Math.round(t * FPS));
    t += Math.max(0, d);
    const b = Math.min(max, Math.round(t * FPS));
    return { start: a, frames: Math.max(0, b - a) };
  });
}

/** O `atempo` de uma velocidade (o ffmpeg só aceita 0,5 a 2 por filtro: 3× = 2× seguido de 1,5×). */
export function atempo(speed: number): string {
  if (speed === 1) return '';
  const out: string[] = [];
  let s = speed;
  while (s > 2 + 1e-9) { out.push('atempo=2'); s /= 2; }
  while (s < 0.5 - 1e-9) { out.push('atempo=0.5'); s /= 0.5; }
  out.push(`atempo=${+s.toFixed(6)}`);
  return out.join(',');
}

const n = (x: number, d = 3) => (Math.round(x * 10 ** d) / 10 ** d).toString();

export interface ClipJob {
  kind: 'video' | 'photo';
  /** O ficheiro de entrada (no diretório do trabalho). */
  input: string;
  /** Vídeos: o bocado que entra (segundos no ficheiro) e a velocidade. */
  trimStart: number;
  trimLen: number;
  speed: number;
  hasAudio: boolean;
  frames: number;
  /** Tamanho do quadro deste clipe (1080×1920, ou 540×960 num dueto). */
  w: number;
  h: number;
  look: string | null;
  /** O último frame do clipe anterior, para a transição (nada no primeiro, ou com corte seco). */
  prevStill: string | null;
  transition: Transition;
  /** Onde ficam o vídeo, o som e o último frame deste clipe. */
  out: { video: string; audio: string; last: string };
  threads?: number;
  /**
   * Os efeitos do estúdio (docs/estudio-efeitos.md): cor (`lut`: o ficheiro .cube desta matriz), rampa e congelar. Com `fx`, o
   * `look` e a `transition` de sempre não contam (a transição do estúdio desenha-se no canvas: `head`).
   */
  fx?: ClipFx;
  lut?: string;
  /** Os primeiros `frames` frames saem à parte em RGBA (`file`), para a transição no canvas; o vídeo leva só o resto. */
  head?: { frames: number; file: string };
}

/** Quanto dura a transição para um clipe com `frames` frames (nunca mais do que o próprio clipe). */
export const transitionSeconds = (frames: number) => Math.min(TR, Math.max(0, (frames - 1) / FPS));

/** Os argumentos do ffmpeg para um clipe (1.º passo). */
export function clipArgs(c: ClipJob): string[] {
  const N = c.frames;
  const W = c.w, H = c.h;
  const look = c.fx ? serverFxChain(c.fx, c.lut ?? 'clip.cube') : lookFilter(c.look);
  const lk = look ? `,${look}` : '';
  // A rampa (só vídeos): os frames da fonte vão para o instante de saída de cada bocado (rampPieces, a 0,1 s).
  const pieces = c.kind === 'video' && c.fx?.ramp ? mergedPieces(c.trimLen, c.speed, c.fx) : null;
  const timing = pieces ? rampSetpts(pieces) : `setpts=(PTS-STARTPTS)/${c.speed}`;
  const args: string[] = ['-y'];
  const graph: string[] = [];
  if (c.kind === 'video') {
    args.push('-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,matroska,webm', '-ss', n(c.trimStart), '-t', n(c.trimLen), '-i', c.input);
    // Velocidade, 30 fps, a cobrir o quadro (corta o que sobra, ao centro), o filtro; se faltar um frame no fim, repete o último.
    graph.push(
      `[0:v]${pieces ? 'setpts=PTS-STARTPTS,' : ''}${timing},fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bicubic,crop=${W}:${H},setsar=1${lk},format=yuv420p,` +
        `tpad=stop_mode=clone:stop_duration=2,trim=end_frame=${N},setpts=N/(${FPS}*TB)[c]`,
    );
  } else {
    args.push('-i', c.input);
    // Ken Burns: de 1 a 1,07 ao longo da foto, sempre ao centro (um frame congelado fica parado).
    graph.push(
      `[0:v]zoompan=z='${c.fx?.freeze ? '1' : `1+${KEN_BURNS}*on/${N}`}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${N}:s=${W}x${H}:fps=${FPS},setsar=1${lk},format=yuv420p,trim=end_frame=${N},setpts=N/(${FPS}*TB)[c]`,
    );
  }
  let v = '[c]';
  const td = !c.fx && c.prevStill && c.transition !== 'cut' ? transitionSeconds(N) : 0;
  if (td > 0) {
    args.push('-loop', '1', '-framerate', String(FPS), '-t', n(td + 0.2), '-i', c.prevStill!);
    graph.push(`[1:v]scale=${W}:${H},setsar=1,format=yuv420p,fps=${FPS},setpts=N/(${FPS}*TB)[p]`);
    graph.push(`[p][c]xfade=transition=${c.transition === 'slide' ? 'slideleft' : 'fade'}:duration=${n(td)}:offset=0,trim=end_frame=${N}[x]`);
    v = '[x]';
  }
  const H0 = c.head && c.head.frames > 0 && c.head.frames < N ? c.head.frames : 0;
  if (H0) {
    // A cabeça (a transição, no canvas) sai em RGBA; o vídeo deste passo começa a seguir a ela.
    graph.push(`${v}split=3[o0][l][h0]`, `[o0]trim=start_frame=${H0},setpts=PTS-STARTPTS[o]`, `[h0]trim=end_frame=${H0},format=rgba[head]`);
  } else graph.push(`${v}split[o][l]`);
  graph.push(`[l]select='eq(n,${N - 1})'[last]`);
  // O som: o do vídeo (à mesma velocidade) ou silêncio; sempre com o número certo de amostras.
  const audioIdx = td > 0 ? 2 : 1;
  if (c.kind === 'video' && c.hasAudio && pieces) {
    graph.push(`[0:a]asetpts=PTS-STARTPTS,aresample=${RATE}[ar]`, ...rampAudio(pieces, '[ar]', '[arr]'));
    graph.push(`[arr]aformat=sample_fmts=s16:channel_layouts=stereo,apad,atrim=end_sample=${N * SPF}[a]`);
  } else if (c.kind === 'video' && c.hasAudio) {
    const t = atempo(c.speed);
    graph.push(`[0:a]asetpts=PTS-STARTPTS${t ? `,${t}` : ''},aresample=${RATE},aformat=sample_fmts=s16:channel_layouts=stereo,apad,atrim=end_sample=${N * SPF}[a]`);
  } else {
    args.push('-f', 'lavfi', '-i', `anullsrc=r=${RATE}:cl=stereo`);
    graph.push(`[${audioIdx}:a]aformat=sample_fmts=s16:channel_layouts=stereo,atrim=end_sample=${N * SPF}[a]`);
  }
  const threads = c.threads ? ['-threads', String(c.threads)] : [];
  args.push(
    '-filter_complex', graph.join(';'),
    '-map', '[o]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '17', '-g', String(FPS * 2), '-pix_fmt', 'yuv420p', '-r', String(FPS), ...threads, '-an', c.out.video,
    '-map', '[last]', '-frames:v', '1', '-update', '1', c.out.last,
    ...(H0 ? ['-map', '[head]', '-f', 'rawvideo', '-pix_fmt', 'rgba', c.head!.file] : []),
    '-map', '[a]', '-c:a', 'pcm_s16le', '-ar', String(RATE), '-ac', '2', c.out.audio,
  );
  return args;
}

/**
 * Inverter (docs/estudio-efeitos.md, 4): um bocado do corte, já no quadro e a `fps`, ao contrário (o filtro `reverse` guarda
 * o bocado todo em memória: por isso vai aos bocados, do fim para o início, e junta-se com o concat). Sem som (fica calado).
 */
export function reverseChunkArgs(o: { input: string; from: number; len: number; fps: number; w: number; h: number; out: string; threads?: number }): string[] {
  return [
    '-y', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,matroska,webm', '-ss', n(o.from), '-t', n(o.len), '-i', o.input,
    '-vf', `setpts=PTS-STARTPTS,fps=${o.fps},scale=${o.w}:${o.h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${o.w}:${o.h},setsar=1,format=yuv420p,reverse`,
    '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-g', String(o.fps), '-pix_fmt', 'yuv420p', ...(o.threads ? ['-threads', String(o.threads)] : []), o.out,
  ];
}

// ------------------------------------------------------------------ texto

export interface TextItem { text: string; color: string; bg: string | null; x: number; y: number; size: number; start: number; end: number }

/** Largura média de uma letra da DejaVu Sans Bold (fração do tamanho), para partir as linhas sem medir. */
const CHAR_W = 0.64;

/** Tira o que a letra não tem (emojis, variações, juntadores) e os controlos; espaços seguidos ficam um. */
export function cleanText(s: string): string {
  return Array.from(s.normalize('NFC'))
    .filter((ch) => {
      const cp = ch.codePointAt(0)!;
      if (cp > 0xffff) return false; // emojis e afins (fora do plano básico)
      if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return false;
      if (cp === 0x0a) return true;
      return cp >= 0x20 && !(cp >= 0x7f && cp < 0xa0);
    })
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/** Parte o texto em linhas que cabem em `maxW` píxeis com letra de `px` (como `wrap` no estúdio: até 4 linhas). */
export function wrapText(text: string, px: number, maxW: number): string[] {
  const per = Math.max(4, Math.floor(maxW / (px * CHAR_W)));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const parts = word.length > per ? word.match(new RegExp(`.{1,${per}}`, 'g'))! : [word];
      for (const w of parts) {
        const t = line ? `${line} ${w}` : w;
        if (t.length > per && line) { out.push(line); line = w; } else line = t;
      }
    }
    out.push(line);
  }
  return out.filter((l, i) => l || i === 0).slice(0, 4);
}

/** A opacidade do texto (a `textAlpha` do estúdio): entra em 0,45 s a partir de `a` e sai em 0,4 s até `b`. */
export function alphaExpr(a: number, b: number): string {
  const inA = `(1-pow(1-clip((t-${n(a)})/0.45,0,1),3))`;
  const outA = `if(gt(t,${n(b - 0.4)}),pow(1-clip((t-${n(b - 0.4)})/0.4,0,1),3),1)`;
  return `min(${inA},${outA})`;
}

/** Cada linha de cada texto como um `drawtext` (o ficheiro de cada linha escreve-se à parte: nada de escapes no grafo). */
export function textFilters(items: TextItem[], W: number, H: number, font: string, lineFile: (i: number, j: number) => string): { filters: string[]; files: { name: string; text: string }[] } {
  const filters: string[] = [];
  const files: { name: string; text: string }[] = [];
  const k = H / OUT_H;
  items.forEach((t, i) => {
    const px = Math.max(12, Math.round(t.size * W));
    const lines = wrapText(t.text, px, W * 0.82);
    const lh = Math.round(px * 1.19);
    const top = t.y * H - (lines.length * lh) / 2;
    lines.forEach((ln, j) => {
      if (!ln) return;
      const name = lineFile(i, j);
      files.push({ name, text: ln });
      // Entra a subir 60 px (à escala do quadro), como no estúdio.
      const y = `${n(top + j * lh + (lh - px) / 2, 1)}+${n(60 * k, 1)}*pow(1-clip((t-${n(t.start)})/0.45,0,1),3)`;
      const look = t.bg
        ? `:box=1:boxcolor=${t.bg}:boxborderw=${Math.round(px * 0.35)}`
        : `:shadowcolor=black@0.6:shadowx=0:shadowy=${Math.max(1, Math.round(3 * k))}`;
      filters.push(
        `drawtext=fontfile=${font}:textfile=${name}:expansion=none:fontsize=${px}:fontcolor=${t.color}${look}` +
          `:x='${n(t.x * W, 1)}-text_w/2':y='${y}':alpha='${alphaExpr(t.start, t.end)}':enable='between(t,${n(t.start)},${n(t.end)})'`,
      );
    });
  });
  return { filters, files };
}

// ------------------------------------------------------------------ efeitos de voz

/** A folga depois da voz-off para a cauda do eco e do reverb (o reverb dura 2,4 s). */
export const VOICE_TAIL_S = 2.5;
/**
 * O ducking no servidor: a voz-off comanda um compressor na música (`sidechaincompress`). Com uma voz normal (−15 a −20 dBFS
 * de RMS) a música desce uns 10 dB, como os −10,5 dB (ganho 0,3) do estúdio no browser; desce em 20 ms e volta em 0,4 s.
 */
export const DUCK_SC = 'threshold=0.03:ratio=4:attack=20:release=400:knee=2.8:makeup=1:detection=rms';

const ch2 = (e: (c: string) => string) => `'${e('val(0)')}|${e('val(1)')}'`;

/**
 * Um efeito de voz em filtros do ffmpeg, com os números do estúdio (compose/audio.ts, cópia de lib/studio/audioDsp.ts):
 * - Robô: modulação em anel (`aeval` × seno de 60 Hz) e o pente curto com realimentação (`aecho` com as repetições dela);
 * - Esquilo e Grave: o tom sobe ou desce sem mudar a duração (`asetrate` + `aresample` + `atempo`);
 * - Eco: `aecho` com as mesmas repetições do browser (280 ms, cada uma 0,45 da anterior);
 * - Rádio: passa-alto 500 Hz, passa-baixo 3,2 kHz (Butterworth, como no browser), presença de +6 dB aos 1,5 kHz e a mesma
 *   saturação `tanh` (`aeval`);
 * - Estádio: a mesma resposta ao impulso gerada (`afir` sem ganho automático: a conta do ConvolverNode sem normalizar),
 *   molhado a 0,6 por cima da voz seca.
 * `inp` e `out` são as etiquetas do grafo; `ir` a da resposta ao impulso (só no Estádio); `tag` prefixa as etiquetas internas.
 */
export function voiceFxGraph(id: VoiceFxId, inp: string, out: string, tag: string, ir: string | null): string[] {
  const taps = (t: { ms: number; gain: number }[]) => `aecho=1:1:${t.map((x) => n(x.ms)).join('|')}:${t.map((x) => n(x.gain, 4)).join('|')}`;
  switch (id) {
    case 'robo': {
      const ring = ch2((v) => `${v}*sin(2*PI*${FX.robo.ringHz}*t)`);
      return [`${inp}aeval=exprs=${ring}:c=same,${taps(echoTaps(FX.robo.combMs, FX.robo.combFeedback, FX.robo.combFeedback, 4))}${out}`];
    }
    case 'esquilo':
    case 'grave': {
      const r = FX[id].pitch;
      return [`${inp}asetrate=${Math.round(RATE * r)},aresample=${RATE},${atempo(1 / r)}${out}`];
    }
    case 'eco':
      return [`${inp}${taps(echoTaps(FX.eco.delayMs, FX.eco.wet, FX.eco.feedback, FX.eco.taps))}${out}`];
    case 'radio': {
      const shape = ch2((v) => `tanh(${FX.radio.drive}*${v})/tanh(${FX.radio.drive})`);
      return [`${inp}highpass=f=${FX.radio.highpassHz},lowpass=f=${FX.radio.lowpassHz},equalizer=f=${FX.radio.peakHz}:t=q:w=1:g=${FX.radio.peakDb},aeval=exprs=${shape}:c=same${out}`];
    }
    case 'estadio': {
      if (!ir) throw new Error('o Estádio precisa da resposta ao impulso');
      return [
        `${inp}asplit=2[${tag}_d][${tag}_w]`,
        `[${tag}_w]${ir}afir=dry=1:wet=1:gtype=-1:irgain=1,volume=${n(FX.estadio.wet)}[${tag}_r]`,
        `[${tag}_d]volume=${n(FX.estadio.dry)}[${tag}_dd]`,
        // `longest`: com `first` o amix fecha antes do fim (o afir entrega o último bocado depois do seco acabar).
        `[${tag}_dd][${tag}_r]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0${out}`,
      ];
    }
    default:
      return [`${inp}anull${out}`];
  }
}

// ------------------------------------------------------------------ grafo final

export interface OverlayImage {
  file: string; x: number; y: number; start: number | null; end: number | null;
  /** As camadas do estúdio: entre os frames k0 e k1 (inclusive) do vídeo final; `anim`: um vídeo com alfa (.mov) que começa em k0. */
  frames?: { k0: number; k1: number; anim: boolean; cycle?: boolean };
}

export interface FinalJob {
  /** Duração final (segundos). */
  seconds: number;
  /** Lista de bocados de vídeo e de som (concat), já com o tamanho do quadro da pessoa. */
  videoList: string;
  audioList: string;
  /** A música: o volume, onde começa o trecho (`startS`, segundos na faixa) e os fades (segundos). */
  music: { file: string; volume: number; startS?: number; fadeIn?: number; fadeOut?: number } | null;
  duet: { file: string; hasAudio: boolean; volume: number } | null;
  originalVolume: number;
  /** O efeito de voz no som original. */
  originalFx?: VoiceFxId;
  /** A voz-off: o ficheiro, quando entra (s), o volume, o efeito e se a música baixa por baixo dela. */
  voice?: { file: string; startS: number; volume: number; fx: VoiceFxId; duck: boolean } | null;
  /** Os efeitos sonoros já misturados numa faixa (WAV), com o volume deles. */
  sfx?: { file: string; volume: number } | null;
  /** A resposta ao impulso do Estádio (WAV estéreo), se algum canal a usar. */
  irFile?: string | null;
  texts: string[];
  /** Por cima, pela ordem: stickers, e a assinatura no fim. */
  overlays: OverlayImage[];
  out: string;
  threads?: number;
}

/** Os argumentos do ffmpeg do 2.º passo (o grafo vai num ficheiro: `graphFile`). */
export function finalArgs(j: FinalJob, graphFile: string): { args: string[]; graph: string } {
  const T = n(j.seconds);
  const inputs: string[] = ['-f', 'concat', '-safe', '0', '-i', j.videoList, '-f', 'concat', '-safe', '0', '-i', j.audioList];
  let idx = 2;
  let musicIdx = -1, duetIdx = -1;
  if (j.music) { inputs.push('-stream_loop', '-1', '-protocol_whitelist', 'file', '-format_whitelist', 'mp3,mov,mp4,m4a,aac,ogg,wav,flac,matroska,webm', '-i', j.music.file); musicIdx = idx++; }
  if (j.duet) { inputs.push('-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,matroska,webm', '-t', T, '-i', j.duet.file); duetIdx = idx++; }
  // A voz-off (um áudio de quem monta), a faixa dos efeitos sonoros e a resposta ao impulso do Estádio (geradas aqui).
  let voiceIdx = -1, sfxIdx = -1, origIrIdx = -1, voiceIrIdx = -1;
  const AUDIO_IN = ['-protocol_whitelist', 'file', '-format_whitelist', 'mp3,mov,mp4,m4a,aac,ogg,wav,flac,matroska,webm'];
  if (j.voice) { inputs.push(...AUDIO_IN, '-i', j.voice.file); voiceIdx = idx++; }
  if (j.sfx) { inputs.push(...AUDIO_IN, '-i', j.sfx.file); sfxIdx = idx++; }
  if ((j.originalFx ?? 'normal') === 'estadio') { if (!j.irFile) throw new Error('falta a resposta ao impulso'); inputs.push(...AUDIO_IN, '-i', j.irFile); origIrIdx = idx++; }
  if (j.voice?.fx === 'estadio') { if (!j.irFile) throw new Error('falta a resposta ao impulso'); inputs.push(...AUDIO_IN, '-i', j.irFile); voiceIrIdx = idx++; }
  const ovIdx = j.overlays.map((o) => {
    inputs.push(...(o.frames?.anim ? ['-protocol_whitelist', 'file', '-format_whitelist', 'mov'] : []), ...(o.frames?.cycle ? ['-stream_loop', '-1'] : []), '-i', o.file);
    return idx++;
  });

  const g: string[] = [];
  let v: string;
  if (j.duet) {
    // O dueto como no site: a pessoa à esquerda, o original à direita, cada um num quadro 9:16 ao meio de cada metade.
    g.push(`color=c=black:s=${OUT_W}x${OUT_H}:r=${FPS}:d=${T}[bg]`);
    g.push(`[0:v]setpts=PTS-STARTPTS[me]`);
    g.push(`[${duetIdx}:v]setpts=PTS-STARTPTS,fps=${FPS},scale=${DUET.w}:${DUET.h}:force_original_aspect_ratio=increase,crop=${DUET.w}:${DUET.h},setsar=1,format=yuv420p[or]`);
    g.push(`[bg][me]overlay=0:${DUET.y}:eof_action=pass[d1]`, `[d1][or]overlay=${DUET.w}:${DUET.y}:eof_action=pass[d2]`);
    v = '[d2]';
  } else {
    g.push(`[0:v]setpts=PTS-STARTPTS[m]`);
    v = '[m]';
  }
  if (j.texts.length) {
    g.push(`${v}${j.texts.join(',')}[tx]`);
    v = '[tx]';
  }
  j.overlays.forEach((o, i) => {
    if (o.frames) {
      // Uma camada do estúdio: a imagem parada, ou o vídeo com alfa posto a começar no frame k0; só entre k0 e k1.
      const { k0, k1, anim } = o.frames;
      let src = `[${ovIdx[i]}:v]`;
      // Um ciclo (um período repetido pelo -stream_loop) corta-se no número de frames da camada.
      const cut = o.frames.cycle ? `trim=end_frame=${k1 - k0 + 1},` : '';
      if (anim) { g.push(`${src}${cut}setpts=PTS-STARTPTS+${k0}/(${FPS}*TB)[ly${i}]`); src = `[ly${i}]`; }
      // A imagem parada repete-se (eof_action=repeat); o vídeo com alfa, quando acaba, deixa passar. O `enable` vai pelo tempo
      // (meio frame de folga), não pelo `n`: o overlay avalia-o também nos frames da camada, que contam desde 0.
      g.push(`${v}${src}overlay=${Math.round(o.x)}:${Math.round(o.y)}:format=auto:eof_action=${anim ? 'pass' : 'repeat'}:enable='between(t,${n((k0 - 0.5) / FPS, 4)},${n((k1 + 0.5) / FPS, 4)})'[o${i}]`);
    } else {
      const when = o.start !== null && o.end !== null ? `:enable='between(t,${n(o.start)},${n(o.end)})'` : '';
      g.push(`${v}[${ovIdx[i]}:v]overlay=${Math.round(o.x)}:${Math.round(o.y)}:format=auto${when}[o${i}]`);
    }
    v = `[o${i}]`;
  });
  g.push(`${v}format=yuv420p[vout]`);

  // O som, como os canais do estúdio (lib/studio/audioEngine no site): o original dos clipes (com o efeito de voz), a música
  // ou o som desde o trecho escolhido (em ciclo), com os fades e o ducking por baixo da voz-off, a voz-off (com o efeito, no
  // instante dela), os efeitos sonoros (já misturados numa faixa) e, no dueto, o som do original.
  const mix: string[] = [];
  const fmt = `aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
  const pad = `apad,atrim=end=${T}`;
  g.push(`[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo[ao_in]`);
  g.push(...voiceFxGraph(j.originalFx ?? 'normal', '[ao_in]', '[ao_fx]', 'ofx', origIrIdx >= 0 ? `[${origIrIdx}:a]` : null));
  g.push(`[ao_fx]volume=${n(j.originalVolume)}[ao]`);
  mix.push('[ao]');
  const duck = !!(j.voice && j.voice.duck && j.music);
  if (j.voice) {
    const delay = Math.round(j.voice.startS * 1000);
    // Com folga no fim antes do efeito: o eco e o reverb continuam depois de a gravação acabar (como no browser).
    g.push(`[${voiceIdx}:a]asetpts=PTS-STARTPTS,${fmt},apad=pad_dur=${n(VOICE_TAIL_S)}[av_in]`);
    g.push(...voiceFxGraph(j.voice.fx, '[av_in]', '[av_fx]', 'vfx', voiceIrIdx >= 0 ? `[${voiceIrIdx}:a]` : null));
    g.push(`[av_fx]adelay=delays=${delay}:all=1,${pad}${duck ? ',asplit=2[av_raw][av_sc]' : '[av_raw]'}`);
    g.push(`[av_raw]volume=${n(j.voice.volume)}[av]`);
    mix.push('[av]');
  }
  if (j.music) {
    const start = Math.max(0, j.music.startS ?? 0);
    const fi = Math.min(j.seconds, j.music.fadeIn ?? 0), fo = Math.min(j.seconds, j.music.fadeOut ?? 0);
    const fades = `${fi > 0 ? `,afade=t=in:st=0:d=${n(fi)}` : ''}${fo > 0 ? `,afade=t=out:st=${n(j.seconds - fo)}:d=${n(fo)}` : ''}`;
    g.push(`[${musicIdx}:a]atrim=${n(start)}:${n(start + j.seconds)},asetpts=PTS-STARTPTS,${fmt}${fades},volume=${n(j.music.volume)}${duck ? '[am_dry]' : '[am]'}`);
    // Ducking: a voz-off comanda um compressor na música (cerca de −10 dB por baixo de uma voz normal).
    if (duck) g.push(`[am_dry][av_sc]sidechaincompress=${DUCK_SC}[am]`);
    mix.push('[am]');
  }
  if (j.sfx) {
    g.push(`[${sfxIdx}:a]asetpts=PTS-STARTPTS,${fmt},volume=${n(j.sfx.volume)},${pad}[ae]`);
    mix.push('[ae]');
  }
  if (j.duet?.hasAudio) {
    g.push(`[${duetIdx}:a]asetpts=PTS-STARTPTS,aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${n(j.duet.volume)}[ad]`);
    mix.push('[ad]');
  }
  if (mix.length > 1) g.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97:level=0[aout]`);
  else g.push(`[ao]anull[aout]`);

  const threads = j.threads ? ['-threads', String(j.threads), '-filter_complex_threads', String(j.threads)] : [];
  const args = [
    '-y', ...inputs,
    '-filter_complex_script', graphFile,
    '-map', '[vout]', '-map', '[aout]', '-t', T,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-maxrate', '6M', '-bufsize', '12M', '-profile:v', 'high', '-level', '4.1',
    '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2), ...threads,
    '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', String(RATE),
    '-movflags', '+faststart', '-map_metadata', '-1', j.out,
  ];
  return { args, graph: g.join(';\n') };
}
