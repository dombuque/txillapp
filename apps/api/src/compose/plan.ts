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
}

/** Quanto dura a transição para um clipe com `frames` frames (nunca mais do que o próprio clipe). */
export const transitionSeconds = (frames: number) => Math.min(TR, Math.max(0, (frames - 1) / FPS));

/** Os argumentos do ffmpeg para um clipe (1.º passo). */
export function clipArgs(c: ClipJob): string[] {
  const N = c.frames;
  const W = c.w, H = c.h;
  const look = lookFilter(c.look);
  const lk = look ? `,${look}` : '';
  const args: string[] = ['-y'];
  const graph: string[] = [];
  if (c.kind === 'video') {
    args.push('-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,matroska,webm', '-ss', n(c.trimStart), '-t', n(c.trimLen), '-i', c.input);
    // Velocidade, 30 fps, a cobrir o quadro (corta o que sobra, ao centro), o filtro; se faltar um frame no fim, repete o último.
    graph.push(
      `[0:v]setpts=(PTS-STARTPTS)/${c.speed},fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bicubic,crop=${W}:${H},setsar=1${lk},format=yuv420p,` +
        `tpad=stop_mode=clone:stop_duration=2,trim=end_frame=${N},setpts=N/(${FPS}*TB)[c]`,
    );
  } else {
    args.push('-i', c.input);
    // Ken Burns: de 1 a 1,07 ao longo da foto, sempre ao centro.
    graph.push(
      `[0:v]zoompan=z='1+${KEN_BURNS}*on/${N}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${N}:s=${W}x${H}:fps=${FPS},setsar=1${lk},format=yuv420p,trim=end_frame=${N},setpts=N/(${FPS}*TB)[c]`,
    );
  }
  let v = '[c]';
  const td = c.prevStill && c.transition !== 'cut' ? transitionSeconds(N) : 0;
  if (td > 0) {
    args.push('-loop', '1', '-framerate', String(FPS), '-t', n(td + 0.2), '-i', c.prevStill!);
    graph.push(`[1:v]scale=${W}:${H},setsar=1,format=yuv420p,fps=${FPS},setpts=N/(${FPS}*TB)[p]`);
    graph.push(`[p][c]xfade=transition=${c.transition === 'slide' ? 'slideleft' : 'fade'}:duration=${n(td)}:offset=0,trim=end_frame=${N}[x]`);
    v = '[x]';
  }
  graph.push(`${v}split[o][l]`, `[l]select='eq(n,${N - 1})'[last]`);
  // O som: o do vídeo (à mesma velocidade) ou silêncio; sempre com o número certo de amostras.
  const audioIdx = td > 0 ? 2 : 1;
  if (c.kind === 'video' && c.hasAudio) {
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
    '-map', '[a]', '-c:a', 'pcm_s16le', '-ar', String(RATE), '-ac', '2', c.out.audio,
  );
  return args;
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

// ------------------------------------------------------------------ grafo final

export interface OverlayImage { file: string; x: number; y: number; start: number | null; end: number | null }

export interface FinalJob {
  /** Duração final (segundos). */
  seconds: number;
  /** Lista de bocados de vídeo e de som (concat), já com o tamanho do quadro da pessoa. */
  videoList: string;
  audioList: string;
  music: { file: string; volume: number } | null;
  duet: { file: string; hasAudio: boolean; volume: number } | null;
  originalVolume: number;
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
  const ovIdx = j.overlays.map((o) => { inputs.push('-i', o.file); return idx++; });

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
    const when = o.start !== null && o.end !== null ? `:enable='between(t,${n(o.start)},${n(o.end)})'` : '';
    g.push(`${v}[${ovIdx[i]}:v]overlay=${Math.round(o.x)}:${Math.round(o.y)}:format=auto${when}[o${i}]`);
    v = `[o${i}]`;
  });
  g.push(`${v}format=yuv420p[vout]`);

  // O som: o original dos clipes, a música ou o som (em ciclo, como no estúdio) e, no dueto, o som do original.
  const mix: string[] = [];
  g.push(`[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${n(j.originalVolume)}[ao]`);
  mix.push('[ao]');
  if (j.music) {
    g.push(`[${musicIdx}:a]atrim=0:${T},asetpts=PTS-STARTPTS,aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${n(j.music.volume)}[am]`);
    mix.push('[am]');
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
