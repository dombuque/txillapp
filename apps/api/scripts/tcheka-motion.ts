/**
 * Medição da montagem das tchekas (docs/montagem.md, 6-A): gera entradas de teste, monta-as com o ComposeService
 * verdadeiro (sem base de dados: o armazenamento é falso) e mede o vídeo final.
 *
 *   npx ts-node --transpile-only scripts/tcheka-motion.ts <etiqueta> [legacy|studio|cover|all]
 *
 * Entradas (geradas, cinzento com uma grelha e pontos gaussianos, como os telemóveis as enviam: passam primeiro pela
 * conversão do envio, `UPLOAD_ARGS` = a de media/video.service.ts):
 *   photoP  foto 3:4 (1440×1920) com uma grelha de pontos: o Ken Burns
 *   photoL  foto 4:3 deitada (2000×1500)
 *   land    vídeo 16:9 (1920×1080, 30 fps) com um ponto a andar, um flash no frame 30 e um apito em 1,0 s (sincronia)
 *   vert60  vídeo vertical a 60 fps com tempos irregulares (VFR: ±4 ms de ruído nos tempos), o ponto a andar a direito
 *   vert30  vídeo vertical a 30 fps (para 2× e 3×)
 *   rot     vídeo vertical gravado deitado (1920×1080) com a rotação de 90° nos metadados (displaymatrix)
 *
 * Medidas (em <saída>/<etiqueta>/<montagem>.json):
 *   - tremido: os pontos seguidos frame a frame (centróide com peso, subpíxel); `jerk` = RMS da 2.ª diferença da posição
 *     (px/frame²; um movimento liso dá ~0), `stalls` = frames em que o ponto não andou (a meio de um movimento) e
 *     `reversals` = frames em que andou para trás;
 *   - frames repetidos (nenhum píxel mudou mais de 12 níveis) e pretos (média < 12) em todo o vídeo;
 *   - tempos dos frames (ffprobe: todos a 1/30 s?), duração de cada pista contra o plano, sincronia (flash contra apito),
 *     perfil/nível H.264, B-frames, intervalo dos keyframes, pico de bitrate por segundo, moov antes do mdat, áudio.
 */
import 'reflect-metadata';
import { execFileSync, spawn } from 'child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, writeFileSync, rmSync } from 'fs';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { ComposeService, type ComposeSpec } from '../src/compose/compose.service';
import { FFMPEG, FFPROBE } from '../src/compose/ffmpeg';
import { frameSlots, FPS } from '../src/compose/plan';
import { sourceFps, to30fps } from '../src/media/video.service';

function fpsOf(file: string): number {
  const s = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-select_streams', 'v:0', file]).toString()).streams[0];
  return sourceFps(s.avg_frame_rate, s.r_frame_rate);
}

const OUT = process.env.TCHEKA_OUT ?? 'C:/dombuque/tmp-tcheka';
const label = process.argv[2] ?? 'run';
const which = process.argv[3] ?? 'all';
const dir = join(OUT, label);
/** TCHEKA_UPLOAD=old: a conversão do envio de antes (`fps=30` sozinho), para comparar; por omissão, a de agora. */
const OLD_UPLOAD = process.env.TCHEKA_UPLOAD === 'old';
const IN = join(OUT, OLD_UPLOAD ? 'in' : 'in-new');
mkdirSync(dir, { recursive: true });
mkdirSync(IN, { recursive: true });

/** A conversão do envio (media/video.service.ts, `process`): o que a montagem recebe de um telemóvel. */
const UPLOAD_ARGS = (src: string, out: string) => [
  '-y', '-v', 'error', '-i', src, '-t', '60',
  '-vf', `scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)':flags=lanczos,${OLD_UPLOAD ? 'fps=30' : to30fps(fpsOf(src))},format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'faster', '-crf', '23', '-maxrate', '6M', '-bufsize', '12M', '-profile:v', 'high', '-level', '4.1',
  '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', '-map_metadata', '-1', out,
];

// ------------------------------------------------------------------ entradas

type Dot = { x: number; y: number; s?: number; v?: number };
const bgCache = new Map<string, Buffer>();
function background(w: number, h: number): Buffer {
  const k = `${w}x${h}`;
  let b = bgCache.get(k);
  if (!b) {
    b = Buffer.alloc(w * h);
    const step = Math.round(Math.min(w, h) / 9);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const grid = x % step < 3 || y % step < 3 ? 40 : 0;
      b[y * w + x] = Math.round(60 + 40 * (x / w) + 20 * (y / h)) + grid;
    }
    bgCache.set(k, b);
  }
  return b;
}
function frame(w: number, h: number, dots: Dot[], flash = false): Buffer {
  const f = Buffer.from(background(w, h));
  if (flash) return f.fill(235);
  for (const d of dots) {
    const s = d.s ?? 4, amp = d.v ?? 255, r = Math.ceil(s * 3.5);
    for (let y = Math.max(0, Math.floor(d.y - r)); y <= Math.min(h - 1, Math.ceil(d.y + r)); y++) {
      for (let x = Math.max(0, Math.floor(d.x - r)); x <= Math.min(w - 1, Math.ceil(d.x + r)); x++) {
        const g = Math.exp(-((x - d.x) ** 2 + (y - d.y) ** 2) / (2 * s * s));
        const i = y * w + x;
        f[i] = Math.min(255, Math.round(f[i] * (1 - g) + amp * g));
      }
    }
  }
  return f;
}
/** Um marcador quadrado no canto de cima à esquerda (para ver a orientação). */
function marker(f: Buffer, w: number, x0: number, y0: number, size: number) {
  for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) f[y * w + x] = 250;
}

async function writeVideo(file: string, w: number, h: number, n: number, fps: number, draw: (k: number) => Buffer, opts: { audio?: string; setpts?: string } = {}) {
  const args = ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${w}x${h}`, '-framerate', String(fps), '-i', 'pipe:0'];
  if (opts.audio) args.push('-f', 'lavfi', '-i', opts.audio);
  args.push('-vf', `${opts.setpts ? `settb=1/90000,setpts='${opts.setpts}',` : ''}format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12');
  if (opts.setpts) args.push('-fps_mode', 'passthrough', '-enc_time_base', '1/90000', '-video_track_timescale', '90000');
  if (opts.audio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push(file);
  const p = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'inherit'] });
  for (let k = 0; k < n; k++) {
    if (!p.stdin.write(draw(k))) await new Promise((r) => p.stdin.once('drain', r));
  }
  p.stdin.end();
  await new Promise<void>((res, rej) => p.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
}

async function photo(file: string, w: number, h: number) {
  const dots: Dot[] = [];
  const nx = 7, ny = Math.round((7 * h) / w);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) dots.push({ x: ((i + 0.5) * w) / nx, y: ((j + 0.5) * h) / ny, s: w / 200 });
  const f = frame(w, h, dots);
  marker(f, w, 20, 20, Math.round(w / 20));
  await sharp(f, { raw: { width: w, height: h, channels: 1 } }).jpeg({ quality: 95 }).toFile(file);
}

async function inputs() {
  const up = (name: string) => join(IN, `${name}.up.mp4`);
  const done = ['photoP.jpg', 'photoL.jpg', 'land.up.mp4', 'vert60.up.mp4', 'vert30.up.mp4', 'rot.up.mp4'].every((f) => existsSync(join(IN, f)));
  if (done) return;
  await photo(join(IN, 'photoP.jpg'), 1440, 1920);
  await photo(join(IN, 'photoL.jpg'), 2000, 1500);
  // 16:9: o ponto anda 4 px por frame no meio (na parte que fica com «cobrir»); flash no frame 30 e apito em 1,0 s.
  await writeVideo(join(IN, 'land.mp4'), 1920, 1080, 150, 30, (k) => {
    const f = frame(1920, 1080, [{ x: 700 + 4 * k, y: 600 }], k === 30);
    return f;
  }, { audio: "aevalsrc='if(between(t,1,1.2),0.8*sin(2*PI*1000*t),0)+0.05*sin(2*PI*300*t)':s=48000:d=5" });
  // VFR a 60 fps: o frame N mostra o instante N/60, mas leva um tempo com ±4 ms de ruído (o relógio do telemóvel).
  await writeVideo(join(IN, 'vert60.mp4'), 1080, 1920, 240, 60, (k) => frame(1080, 1920, [{ x: 200 + 2.5 * k, y: 960 }, { x: 800, y: 300 + 5 * k }]), {
    audio: 'sine=frequency=500:sample_rate=48000:duration=4', setpts: 'max(0,N/60+(random(0)-0.5)*0.008)/TB',
  });
  await writeVideo(join(IN, 'vert30.mp4'), 1080, 1920, 180, 30, (k) => frame(1080, 1920, [{ x: 100 + 5 * k, y: 700 }, { x: 540, y: 400 + 5 * k }]), { audio: 'sine=frequency=700:sample_rate=48000:duration=6' });
  // De pé, gravado deitado: o frame guardado é o vertical rodado 90° para a direita; a displaymatrix (90°, sentido
  // contrário ao dos ponteiros) põe-no de pé.
  await writeVideo(join(IN, 'rot.raw.mp4'), 1920, 1080, 90, 30, (k) => {
    const p = frame(1080, 1920, [{ x: 540, y: 300 + 6 * k }]);
    marker(p, 1080, 20, 20, 80);
    const r = Buffer.alloc(1920 * 1080);
    // rodar 90° para a direita: (x, y) de pé → (H-1-y, x) deitado
    for (let y = 0; y < 1920; y++) for (let x = 0; x < 1080; x++) r[x * 1920 + (1919 - y)] = p[y * 1080 + x];
    return r;
  }, { audio: 'sine=frequency=900:sample_rate=48000:duration=3' });
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-display_rotation', '90', '-i', join(IN, 'rot.raw.mp4'), '-c', 'copy', join(IN, 'rot.mp4')]);
  for (const n of ['land', 'vert60', 'vert30', 'rot']) execFileSync(FFMPEG, UPLOAD_ARGS(join(IN, `${n}.mp4`), up(n)));
}

// ------------------------------------------------------------------ montagem

const FILES: Record<string, string> = {
  '00000000-0000-4000-8000-00000000000a': 'photoP.jpg',
  '00000000-0000-4000-8000-00000000000b': 'photoL.jpg',
  '00000000-0000-4000-8000-00000000000c': 'land.up.mp4',
  '00000000-0000-4000-8000-00000000000d': 'vert60.up.mp4',
  '00000000-0000-4000-8000-00000000000e': 'vert30.up.mp4',
  '00000000-0000-4000-8000-00000000000f': 'rot.up.mp4',
  /** o vídeo deitado com a displaymatrix, sem passar pela conversão do envio (a montagem tem de o pôr de pé sozinha) */
  '00000000-0000-4000-8000-000000000010': 'rot.mp4',
};
const ID = Object.fromEntries(Object.entries(FILES).map(([k, v]) => [v === 'rot.mp4' ? 'rotraw' : v.split('.')[0], k])) as Record<string, string>;

type Clip = ComposeSpec['clips'][number] & { fit?: 'cover' | 'blur' };
const v = (name: string, trimStart: number, trimEnd: number, speed = 1, extra: Partial<Clip> = {}): Clip => ({ mediaId: ID[name], kind: 'video', trimStart, trimEnd, speed, seconds: (trimEnd - trimStart) / speed, beats: 2, ...extra });
const p = (name: string, seconds: number, extra: Partial<Clip> = {}): Clip => ({ mediaId: ID[name], kind: 'photo', trimStart: 0, trimEnd: 0, speed: 1, seconds, beats: 2, ...extra });

function specOf(kind: string): { spec: ComposeSpec; names: string[] } {
  const base = { v: 1 as const, username: 'medida', seal: null, audio: null, rhythm: null, duet: null, originalVolume: 1, musicVolume: 1, filter: null, texts: [], stickers: [], cover: null };
  const names = ['photoP', 'land', 'vert60', 'vert30@2x', 'photoL', 'rot', 'vert30@3x'];
  const fit = kind === 'cover' ? { fit: 'cover' as const } : {};
  const clips: Clip[] = [p('photoP', 3), v('land', 0, 4, 1, fit), v('vert60', 0, 3), v('vert30', 0, 4, 2), p('photoL', 2.5, fit), v('rot', 0, 3), v('vert30', 0, 4.5, 3)];
  if (kind === 'cover') { clips.push(v('rotraw', 0, 3)); names.push('rotraw'); }
  if (kind === 'studio') {
    const tr = [null, { type: 'deslizar-esquerda', dur: 0.5 }, { type: 'fundido', dur: 0.5 }, { type: 'corte', dur: 0.5 }, { type: 'corte', dur: 0.5 }, { type: 'corte', dur: 0.5 }, { type: 'corte', dur: 0.5 }];
    clips.forEach((c, i) => { c.fx = tr[i] ? { transition: tr[i] as never } : {}; });
    clips.push(p('photoP', 3, { fx: { transition: { type: 'corte', dur: 0.5 } as never, focus: { x: 0.3, y: 0.35, from: 1, to: 1.15 } } }));
    names.push('photoP@focus');
    return { spec: { ...base, clips, transition: 'cut', studio: true, overlays: [], pano: { pattern: 'losangos', palette: 'coral', seed: 1 } }, names };
  }
  return { spec: { ...base, clips, transition: 'slide' }, names };
}

async function render(kind: string) {
  const media = { rawBytes: async (id: string) => readFileSync(join(IN, FILES[id])) };
  const config = { MEDIA_DIR: dir, STORAGE_DRIVER: 'local', COMPOSE_THREADS: Number(process.env.COMPOSE_THREADS ?? 0), ROLE: 'web', COMPOSE_CONCURRENCY: 1, COMPOSE_TIMEOUT_S: 900 };
  const Svc = ComposeService as unknown as new (...a: unknown[]) => ComposeService;
  const svc = new Svc(null, config, media, null, null, null, null);
  const { spec, names } = specOf(kind);
  const tmp = await mkdtemp(join(tmpdir(), 'txcompose-medida-'));
  const t0 = Date.now();
  const out = await svc.render(spec, tmp, new AbortController().signal, () => undefined);
  const ms = Date.now() - t0;
  const file = join(dir, `${kind}.mp4`);
  writeFileSync(file, readFileSync(out.file));
  rmSync(tmp, { recursive: true, force: true });
  return { file, ms, timings: out.timings, spec, names };
}

// ------------------------------------------------------------------ medidas

const W = 1080, H = 1920;
async function* grayFrames(file: string): AsyncGenerator<Buffer> {
  const p = spawn(FFMPEG, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const size = W * H;
  let pending: Buffer = Buffer.alloc(0);
  for await (const chunk of p.stdout as AsyncIterable<Buffer>) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= size) {
      yield Buffer.from(pending.subarray(0, size));
      pending = pending.subarray(size);
    }
  }
}

const THR = 175;
function peaks(f: Buffer, max = 8): { x: number; y: number }[] {
  const found: { x: number; y: number; v: number }[] = [];
  for (let y = 40; y < H - 40; y += 2) for (let x = 40; x < W - 40; x += 2) {
    const val = f[y * W + x];
    if (val < THR + 30) continue;
    if (y > 1640 && x > 640) continue; // a assinatura
    if (found.some((p) => Math.abs(p.x - x) < 30 && Math.abs(p.y - y) < 30)) continue;
    found.push({ x, y, v: val });
  }
  // os mais longe do centro (onde o zoom mexe mais), espalhados
  found.sort((a, b) => Math.hypot(b.x - W / 2, b.y - H / 2) - Math.hypot(a.x - W / 2, a.y - H / 2));
  return found.slice(0, max).map((p) => centroid(f, p.x, p.y) ?? p);
}
function centroid(f: Buffer, cx: number, cy: number, r = 16): { x: number; y: number } | null {
  let sx = 0, sy = 0, sw = 0, n = 0;
  for (let y = Math.max(0, Math.round(cy - r)); y <= Math.min(H - 1, Math.round(cy + r)); y++) {
    for (let x = Math.max(0, Math.round(cx - r)); x <= Math.min(W - 1, Math.round(cx + r)); x++) {
      const w = f[y * W + x] - THR;
      if (w <= 0) continue;
      sx += w * x; sy += w * y; sw += w; n++;
    }
  }
  // Um ponto é pequeno: uma mancha clara maior (o marcador do canto, um flash) não serve para medir.
  return sw > 200 && n < 0.85 * (2 * r + 1) ** 2 ? { x: sx / sw, y: sy / sw } : null;
}

interface Track { pts: ({ x: number; y: number; skip?: boolean } | null)[] }
function motionStats(tracks: Track[]) {
  const per = tracks.map((t) => {
    // só o que se mexe (as coisas paradas não dizem nada do tremido)
    // `skip`: o frame do flash (o ponto não se vê): fica fora das contas.
    const pts = t.pts;
    if (pts.filter((q) => q && !q.skip).length < Math.max(6, 0.8 * pts.length) || pts.some((q) => !q)) return null;
    const P = pts as { x: number; y: number; skip?: boolean }[];
    const vel = P.slice(1).map((q, i) => (q.skip || P[i].skip ? null : { x: q.x - P[i].x, y: q.y - P[i].y })).filter((q): q is { x: number; y: number } => !!q);
    const mean = vel.reduce((a, b) => ({ x: a.x + b.x / vel.length, y: a.y + b.y / vel.length }), { x: 0, y: 0 });
    const mag = Math.hypot(mean.x, mean.y) || 1;
    const dir = { x: mean.x / mag, y: mean.y / mag };
    const s = vel.map((q) => q.x * dir.x + q.y * dir.y);
    const acc = s.slice(1).map((q, i) => q - s[i]);
    const jerk = Math.sqrt(acc.reduce((a, b) => a + b * b, 0) / acc.length);
    const med = [...s].sort((a, b) => a - b)[Math.floor(s.length / 2)];
    if (Math.abs(med) < 0.15) return null;
    return { series: s.map((q) => +q.toFixed(2)), speed: +med.toFixed(3), jerk: +jerk.toFixed(3), relJerk: +(jerk / Math.max(0.05, Math.abs(med))).toFixed(3), stalls: s.filter((q) => Math.abs(q) < 0.25 * Math.abs(med)).length, reversals: s.filter((q) => q * med < 0).length, frames: P.length };
  }).filter(Boolean) as { series: number[]; speed: number; jerk: number; relJerk: number; stalls: number; reversals: number; frames: number }[];
  if (!per.length) return null;
  const worst = per.reduce((a, b) => (b.jerk > a.jerk ? b : a));
  return { dots: per.length, series: worst.series, speed: worst.speed, jerk: worst.jerk, jerkMean: +(per.reduce((a, b) => a + b.jerk, 0) / per.length).toFixed(3), relJerk: worst.relJerk, stalls: per.reduce((a, b) => a + b.stalls, 0), reversals: per.reduce((a, b) => a + b.reversals, 0) };
}

/**
 * O deslizar: tira-se ao x medido o deslocamento do desenho (linear no xfade de sempre, easeInOutCubic no estúdio, W·(1−e(p)),
 * p = k/15) e o que sobra é o movimento do próprio clipe (uma reta): o tremido é o RMS do afastamento à reta.
 */
function slideStats(pts: [number, number][]) {
  if (pts.length < 5) return null;
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const fit = (model: (p: number) => number) => {
    const r = pts.map(([k, x]) => [k, x - W * (1 - model(k / 15))]);
    const n = r.length, mk = r.reduce((a, b) => a + b[0], 0) / n, mx = r.reduce((a, b) => a + b[1], 0) / n;
    const b = r.reduce((a, q) => a + (q[0] - mk) * (q[1] - mx), 0) / r.reduce((a, q) => a + (q[0] - mk) ** 2, 0);
    return Math.sqrt(r.reduce((a, q) => a + (q[1] - (mx + b * (q[0] - mk))) ** 2, 0) / n);
  };
  return { frames: pts.length, rmsLinear: +fit((p) => p).toFixed(3), rmsEase: +fit(ease).toFixed(3), series: pts.map((q) => +q[1].toFixed(1)) };
}

function ffprobeJson(args: string[]) {
  return JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', ...args], { maxBuffer: 256 * 1024 * 1024 }).toString());
}

function topAtoms(file: string): string[] {
  const fd = openSync(file, 'r');
  const out: string[] = [];
  const b = Buffer.alloc(16);
  let at = 0;
  try {
    for (let i = 0; i < 20; i++) {
      if (readSync(fd, b, 0, 16, at) < 8) break;
      let size = b.readUInt32BE(0);
      const type = b.toString('latin1', 4, 8);
      if (size === 1) size = Number(b.readBigUInt64BE(8));
      out.push(type);
      if (size < 8) break;
      at += size;
    }
  } finally { closeSync(fd); }
  return out;
}

function audioMono(file: string): Float32Array {
  const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 512 * 1024 * 1024 });
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
}
function goertzel(x: Float32Array, from: number, n: number, f: number, rate: number) {
  const k = (2 * Math.cos((2 * Math.PI * f) / rate));
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const s = x[from + i] + k * s1 - s2; s2 = s1; s1 = s; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / n;
}

async function measure(r: Awaited<ReturnType<typeof render>>, kind: string) {
  const { file, spec, names } = r;
  const slots = frameSlots(spec.clips.map((c) => c.seconds), 60);
  const planFrames = slots.reduce((a, s) => a + s.frames, 0);
  // Por clipe: a zona a seguir (sem a transição de entrada nem o último frame).
  const zones = slots.map((s, i) => ({ name: names[i], a: s.start + (i > 0 ? 16 : 1), b: s.start + s.frames - 2, start: s.start }));
  const tracks = new Map<number, Track[]>();
  /** O ponto do clipe que entra a deslizar (clipe 1), frame a frame: [k, x]. */
  const slide: [number, number][] = [];
  const lumas: number[] = [];
  const diffs: number[] = [];
  let prev: Buffer | null = null;
  let k = 0;
  const grabs = new Set<number>(slots.flatMap((s) => [s.start + 5, s.start + Math.floor(s.frames / 2)]));
  // a meio da transição de deslizar (clipe 1)
  for (let j = slots[1].start; j < slots[1].start + 16; j++) grabs.add(j);
  for await (const f of grayFrames(file)) {
    let sum = 0;
    for (let i = 0; i < f.length; i += 7) sum += f[i];
    lumas.push(sum / (f.length / 7));
    if (prev) {
      let d = 0;
      for (let i = 0; i < f.length; i += 3) if (Math.abs(f[i] - prev[i]) > 12) d++;
      diffs.push(d);
    }
    zones.forEach((z, zi) => {
      if (k === z.a) tracks.set(zi, peaks(f).map((p0) => ({ pts: [p0] })));
      else if (k > z.a && k <= z.b) for (const t of tracks.get(zi) ?? []) { const last = t.pts[t.pts.length - 1]; t.pts.push(!last ? null : lumas[k] > 160 ? { ...last, skip: true } : centroid(f, last.x, last.y)); }
    });
    // A transição de deslizar para o clipe 1: o ponto do clipe que entra, frame a frame.
    const s1 = slots[1].start;
    if (k >= s1 && k < s1 + 15) {
      const last = slide[slide.length - 1], before = slide[slide.length - 2];
      if (!last) {
        const q = peaks(f, 400).find((c) => c.y > 975 && c.y < 1095 && c.x < W - 45);
        if (q) slide.push([k - s1, q.x]);
      } else {
        const guess = last[1] + (before ? last[1] - before[1] : -40);
        const c = centroid(f, guess, 1030, 45);
        if (c && c.x < W - 30) slide.push([k - s1, c.x]);
      }
    }
    if (grabs.has(k)) await sharp(f, { raw: { width: W, height: H, channels: 1 } }).resize(270, 480).png().toFile(join(dir, `${kind}_f${String(k).padStart(4, '0')}.png`));
    prev = f;
    k++;
  }
  // Repetidos: nenhum píxel mudou mais de 12 níveis de um frame para o seguinte (em todos os clipes há sempre algo a mexer).
  const dupes: number[] = [];
  diffs.forEach((d, i) => { if (d === 0) dupes.push(i + 1); });
  const black = lumas.map((l, i) => (l < 12 ? i : -1)).filter((i) => i >= 0);

  // ffprobe
  const st = ffprobeJson(['-show_streams', '-show_format', file]);
  const vs = st.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
  const as = st.streams.find((s: { codec_type: string }) => s.codec_type === 'audio');
  const pk = ffprobeJson(['-select_streams', 'v:0', '-show_entries', 'packet=pts_time,dts_time,size,flags', file]).packets as { pts_time: string; size: string; flags: string }[];
  const pts = pk.map((q) => Number(q.pts_time)).sort((a, b) => a - b);
  const dts = pts.slice(1).map((t, i) => t - pts[i]);
  const irregular = dts.filter((d) => Math.abs(d - 1 / FPS) > 0.0015).length;
  const keys = pk.map((q, i) => (q.flags.includes('K') ? Number(q.pts_time) : -1)).filter((t) => t >= 0).sort((a, b) => a - b);
  const kgap = keys.slice(1).map((t, i) => t - keys[i]);
  const perSec = new Map<number, number>();
  for (const q of pk) { const s = Math.floor(Number(q.pts_time)); perSec.set(s, (perSec.get(s) ?? 0) + Number(q.size)); }
  const peakMbps = Math.max(...perSec.values()) * 8 / 1e6;

  // Sincronia: o flash (frame claro) contra o apito de 1 kHz, no clipe 1 (land).
  const flashK = lumas.findIndex((l) => l > 160);
  const a = audioMono(file);
  const rate = 16000, hop = 80;
  let beepAt = -1;
  for (let i = Math.max(0, Math.round((slots[1].start / FPS) * rate)); i + 320 < a.length; i += hop) {
    if (goertzel(a, i, 320, 1000, rate) > 0.1) { beepAt = i / rate; break; }
  }

  const res = {
    kind, renderMs: r.ms, timings: r.timings,
    plan: { frames: planFrames, seconds: planFrames / FPS },
    file: {
      frames: k, formatDur: Number(st.format.duration), videoDur: Number(vs.duration), audioDur: Number(as?.duration ?? 0), vStart: Number(vs.start_time), aStart: Number(as?.start_time ?? 0),
      fps: vs.r_frame_rate, avgFps: vs.avg_frame_rate, irregularPts: irregular, ptsDeltaMin: Math.min(...dts), ptsDeltaMax: Math.max(...dts),
      profile: vs.profile, level: vs.level, bframes: vs.has_b_frames, refs: vs.refs, pix: vs.pix_fmt, colorspace: vs.color_space ?? null, sar: vs.sample_aspect_ratio,
      keyframes: keys.length, keyGapMax: kgap.length ? Math.max(...kgap) : null, peakMbps: +peakMbps.toFixed(2), avgMbps: +(Number(st.format.bit_rate) / 1e6).toFixed(2),
      atoms: topAtoms(file), audio: as ? `${as.codec_name} ${as.profile} ${as.sample_rate} Hz ${as.channels} ch ${Math.round(Number(as.bit_rate) / 1000)} kb/s` : null,
      rotation: (vs.side_data_list ?? []).find((s: { rotation?: number }) => s.rotation !== undefined)?.rotation ?? 0,
    },
    sync: { flashS: flashK >= 0 ? +(flashK / FPS).toFixed(4) : null, beepS: beepAt >= 0 ? +beepAt.toFixed(4) : null, offsetMs: flashK >= 0 && beepAt >= 0 ? Math.round((beepAt - flashK / FPS) * 1000) : null, expectS: +((slots[1].start / FPS) + 1).toFixed(4) },
    joins: slots.slice(1).map((s) => ({ at: s.start, diffBefore: +(diffs[s.start - 2] ?? 0).toFixed(2), diffAt: +(diffs[s.start - 1] ?? 0).toFixed(2), lumaAt: +(lumas[s.start] ?? 0).toFixed(1) })),
    dupes, black,
    motion: zones.map((z, i) => ({ clip: z.name, frames: `${z.a}-${z.b}`, ...(motionStats(tracks.get(i) ?? []) ?? { dots: 0 }) })),
    slide: slideStats(slide),
  };
  writeFileSync(join(dir, `${kind}.json`), JSON.stringify(res, null, 2));
  return res;
}

(async () => {
  await inputs();
  const kinds = which === 'all' ? ['legacy', 'studio', 'cover'] : which === 'inputs' ? [] : which.split(',');
  for (const kind of kinds) {
    // MEASURE_ONLY=1: mede o vídeo que já lá está (sem montar outra vez).
    const r = process.env.MEASURE_ONLY ? { file: join(dir, `${kind}.mp4`), ms: 0, timings: {} as never, ...specOf(kind) } : await render(kind);
    const m = await measure(r, kind);
    console.log(JSON.stringify({ kind, renderMs: m.renderMs, timings: m.timings, plan: m.plan, frames: m.file.frames, durs: [m.file.formatDur, m.file.videoDur, m.file.audioDur], irregularPts: m.file.irregularPts, sync: m.sync, dupes: m.dupes.join(' '), black: m.black.length, peakMbps: m.file.peakMbps, atoms: m.file.atoms.join(','), profile: `${m.file.profile}@${m.file.level} bf=${m.file.bframes}`, keyGapMax: m.file.keyGapMax }));
    for (const z of m.motion) console.log('  ', JSON.stringify({ ...z, series: undefined }));
    console.log('   slide', JSON.stringify(m.slide && { ...m.slide, series: m.slide.series.join(' ') }));
  }
})().catch((e) => { console.error(e); process.exit(1); });
