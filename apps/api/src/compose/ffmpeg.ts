import { execFile, spawn } from 'child_process';
import { setPriority } from 'os';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

const exec = promisify(execFile);
export const FFMPEG = (ffmpegPath as unknown as string | null) ?? 'ffmpeg';
export const FFPROBE = ffprobe.path;

/** A montagem corre com menos prioridade do que a API (o servidor é partilhado): 10 = «nice 10». */
const NICE = 10;

/** Entradas de terceiros ou de quem envia: só ficheiros locais e só formatos de áudio e vídeo conhecidos. */
export const SAFE_VIDEO = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,matroska,webm'];
export const SAFE_AUDIO = ['-protocol_whitelist', 'file', '-format_whitelist', 'mp3,mov,mp4,m4a,aac,ogg,wav,flac,matroska,webm'];

export class FfmpegError extends Error {
  constructor(message: string, readonly stderr: string) {
    super(message);
  }
}

/**
 * Corre o ffmpeg com `-progress` (o tempo já escrito, em segundos, vai para `onProgress`), com prioridade baixa e parado
 * logo se o `signal` disparar (fim do prazo do trabalho). Guarda só o fim do stderr, para o registo.
 */
export function ffmpeg(args: string[], opts: { cwd: string; signal?: AbortSignal; onProgress?: (seconds: number) => void; stdout?: (chunk: Buffer) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new FfmpegError('aborted', ''));
    const progress = !opts.stdout;
    const child = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...(progress ? ['-progress', 'pipe:1', '-nostats'] : []), ...args], { cwd: opts.cwd, windowsHide: true });
    try {
      if (child.pid) setPriority(child.pid, NICE);
    } catch {
      /* sem permissão para baixar a prioridade: corre na mesma */
    }
    let err = '';
    let buf = '';
    child.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-6000); });
    child.stdout.on('data', (d: Buffer) => {
      if (opts.stdout) return opts.stdout(d);
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line);
        if (m) opts.onProgress?.(Number(m[1]) / 1e6);
      }
    });
    const kill = () => child.kill('SIGKILL');
    opts.signal?.addEventListener('abort', kill, { once: true });
    child.on('error', (e) => { opts.signal?.removeEventListener('abort', kill); reject(new FfmpegError(e.message, err)); });
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', kill);
      if (opts.signal?.aborted) return reject(new FfmpegError('aborted', err));
      if (code === 0) resolve();
      else reject(new FfmpegError(`ffmpeg saiu com ${code}`, err));
    });
  });
}

export interface Probe { seconds: number; width: number; height: number; hasVideo: boolean; hasAudio: boolean }

/** Duração, tamanho e que pistas tem um ficheiro (`safe`: as opções de entrada segura). */
export async function probe(file: string, safe: string[] = []): Promise<Probe> {
  const { stdout } = await exec(FFPROBE, ['-v', 'error', ...safe, '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30_000, windowsHide: true });
  const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number; duration?: string }[] };
  const v = info.streams?.find((s) => s.codec_type === 'video');
  const a = info.streams?.find((s) => s.codec_type === 'audio');
  const seconds = Number(info.format?.duration ?? v?.duration ?? a?.duration ?? 0);
  return { seconds: Number.isFinite(seconds) ? seconds : 0, width: v?.width ?? 0, height: v?.height ?? 0, hasVideo: !!v, hasAudio: !!a };
}

/** As amostras (mono, `rate` Hz, até `seconds` s) de um ficheiro de áudio, para detetar as batidas. */
export async function decodeMono(file: string, seconds: number, rate: number, opts: { cwd: string; signal?: AbortSignal }): Promise<Float32Array> {
  const parts: Buffer[] = [];
  let size = 0;
  const max = Math.ceil(seconds * rate) * 4;
  await ffmpeg([...SAFE_AUDIO, '-i', file, '-t', String(seconds), '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], {
    ...opts,
    stdout: (d) => { if (size < max) { parts.push(d); size += d.length; } },
  });
  const all = Buffer.concat(parts).subarray(0, Math.min(size, max));
  const out = new Float32Array(Math.floor(all.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = all.readFloatLE(i * 4);
  return out;
}
