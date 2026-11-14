import { execFile } from 'child_process';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import sharp from 'sharp';
import { FFPROBE, SAFE_VIDEO, ffmpeg, ffmpegSink } from '../compose/ffmpeg';
import { AUDIO_FADE_S, END_CARD_FPS, END_CARD_S, VIDEO_FADE_S, endCardFrames, endCardSting, type EndCardOpts } from './end-card';
import { signatureSvg, type SealTier } from './signature';

const exec = promisify(execFile);
/** Lado maior da cópia guardada (um vídeo maior desce para aqui; as tchekas são 1080×1920). */
const MAX_SIDE = 1920;

export interface VideoInfo { width: number; height: number; seconds: number; hasAudio: boolean }

/** O tamanho como se vê (já rodado), a duração do vídeo e se tem som. */
export async function videoInfo(file: string): Promise<VideoInfo> {
  const { stdout } = await exec(FFPROBE, ['-v', 'error', ...SAFE_VIDEO, '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30_000, windowsHide: true });
  const j = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type: string; width?: number; height?: number; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
  };
  const v = j.streams?.find((s) => s.codec_type === 'video');
  if (!v?.width || !v.height) throw new Error('sem vídeo');
  const rot = Math.abs(Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0)) % 180;
  const [w, h] = rot === 90 ? [v.height, v.width] : [v.width, v.height];
  const seconds = Number(v.duration ?? j.format?.duration ?? 0);
  return { width: w, height: h, seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0, hasAudio: !!j.streams?.some((s) => s.codec_type === 'audio') };
}

/** O quadro da cópia: o do vídeo (com lados pares), reduzido se passar de MAX_SIDE. */
export function outSize(w: number, h: number): { W: number; H: number } {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { W: even(w), H: even(h) };
}

export interface SignedCopyOpts extends EndCardOpts {
  /** O vídeo já traz a assinatura do canto (câmara da app, montagem): não se põe outra. */
  alreadySigned: boolean;
  /** O som do vídeo não vai (um som que foi tirado). */
  mute?: boolean;
  /** O @ da assinatura do canto (null: só o logótipo, nas publicações de um local). */
  cornerUser: string | null;
  cornerSeal: SealTier | null;
}

/**
 * O grafo do ffmpeg da cópia guardada (entradas: 0 o vídeo, 1 o cartão já codificado, 2 o som do cartão e, sem assinatura
 * no vídeo, 3 o PNG da assinatura do canto). O vídeo escurece até ao preto nos últimos VIDEO_FADE_S e o som dele desce em
 * AUDIO_FADE_S; a seguir vem o cartão, com o sopro e o «ding».
 */
export function signedCopyGraph(o: { W: number; H: number; seconds: number; hasAudio: boolean; sign: boolean; mute: boolean }): string {
  const D = o.seconds;
  const total = D + END_CARD_S;
  const n = (x: number) => x.toFixed(3);
  const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const g: string[] = [];
  g.push(`[0:v]fps=${END_CARD_FPS},scale=${o.W}:${o.H},setsar=1,format=yuv420p[vs]`);
  if (o.sign) g.push(`[vs][3:v]overlay=0:0:format=auto,format=yuv420p[vw]`);
  g.push(`[${o.sign ? 'vw' : 'vs'}]trim=duration=${n(D)},fade=t=out:st=${n(Math.max(0, D - VIDEO_FADE_S))}:d=${n(Math.min(VIDEO_FADE_S, D))}[v0]`);
  g.push(`[1:v]scale=${o.W}:${o.H},setsar=1,format=yuv420p[v1]`);
  g.push(`[v0][v1]concat=n=2:v=1:a=0[vout]`);
  g.push(`[2:a]${fmt},adelay=delays=${Math.round(D * 1000)}:all=1,apad,atrim=end=${n(total)}[as]`);
  if (o.hasAudio && !o.mute) {
    g.push(`[0:a]${fmt},apad,atrim=end=${n(D)},afade=t=out:st=${n(Math.max(0, D - AUDIO_FADE_S))}:d=${n(Math.min(AUDIO_FADE_S, D))},apad,atrim=end=${n(total)}[a0]`);
    g.push(`[a0][as]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.97:level=0[aout]`);
  } else {
    g.push(`[as]anull[aout]`);
  }
  return g.join(';');
}

/**
 * A cópia de uma tcheka para guardar ou partilhar: o vídeo com a assinatura do canto (se ainda não a tiver) e, no fim, o
 * cartão do Txillapp (END_CARD_S). Sai um MP4 H.264 + AAC, 30 fps, com o índice no início e sem metadados (nada de GPS).
 * `tmp`: um diretório de trabalho; `out`: o ficheiro final. Devolve a duração final (segundos).
 */
export async function renderSignedCopy(src: string, out: string, tmp: string, o: SignedCopyOpts, signal?: AbortSignal): Promise<{ seconds: number; width: number; height: number }> {
  const info = await videoInfo(src);
  if (!(info.seconds > 0.2)) throw new Error('vídeo sem duração');
  const { W, H } = outSize(info.width, info.height);
  // 1) O cartão: os frames do canvas para um bocado H.264 sem perdas visíveis (rápido: são 78 frames).
  const card = join(tmp, 'card.mp4');
  const sink = ffmpegSink(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-framerate', String(END_CARD_FPS), '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p', '-an', '-y', card], { cwd: tmp, signal });
  for (const frame of endCardFrames(W, H, o)) await sink.write(frame);
  await sink.end();
  // 2) O som do cartão e, se for preciso, a assinatura do canto.
  const sting = join(tmp, 'sting.wav');
  await writeFile(sting, endCardSting());
  const sign = !o.alreadySigned;
  const png = join(tmp, 'sign.png');
  if (sign) await sharp(Buffer.from(signatureSvg(W, H, o.cornerUser, '', true, o.cornerSeal))).png().toFile(png);
  // 3) Tudo junto.
  const graph = signedCopyGraph({ W, H, seconds: info.seconds, hasAudio: info.hasAudio, sign, mute: !!o.mute });
  await ffmpeg([
    '-y', ...SAFE_VIDEO, '-i', src,
    '-protocol_whitelist', 'file', '-i', card,
    '-protocol_whitelist', 'file', '-i', sting,
    ...(sign ? ['-i', png] : []),
    '-filter_complex', graph,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-maxrate', '6M', '-bufsize', '12M', '-pix_fmt', 'yuv420p', '-r', String(END_CARD_FPS), '-g', String(END_CARD_FPS * 2),
    '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000',
    '-movflags', '+faststart', '-map_metadata', '-1', out,
  ], { cwd: tmp, signal });
  return { seconds: info.seconds + END_CARD_S, width: W, height: H };
}
