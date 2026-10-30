import { Inject, Injectable, Logger } from '@nestjs/common';
import { mkdirSync } from 'fs';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { execFile } from 'child_process';
import { readFile, rename, rm, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import { promisify } from 'util';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { ImageModerationService } from '../moderation/image-moderation.service';

const run = promisify(execFile);
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;
const FFMPEG = (ffmpegPath as unknown as string | null) ?? 'ffmpeg';

/** Erro com mensagem para a pessoa (em português) em vez de detalhes técnicos. */
class VideoRejected extends Error {}

/** Quando os ficheiros vivem na nuvem: como buscar o original e onde publicar o resultado. */
export interface VideoStorageHooks {
  /** Copia o original enviado para `dest` (disco local, temporário). */
  fetchSource(dest: string): Promise<void>;
  /** Publica o vídeo convertido e a capa; depois disto o servidor apaga os ficheiros temporários. */
  publish(video: string, poster: string): Promise<void>;
  /** Apaga o que tiver ficado na nuvem se a conversão falhar ou for recusada. */
  cleanup(): Promise<void>;
}

export type VideoSniff = 'video/mp4' | 'video/webm' | null;
/** MP4/MOV ("ftyp" nos bytes 4 a 8) e WebM (cabeçalho EBML). O conteúdo real é que conta, não o Content-Type. */
export function sniffVideo(head: Buffer): VideoSniff {
  if (head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video/webm';
  return null;
}

/**
 * Converte os vídeos enviados: máximo 60 s, 720p, H.264/AAC em MP4 com "faststart" (começa a tocar sem esperar
 * pelo ficheiro todo), gera a imagem de capa e analisa 3 imagens do vídeo com o mesmo detetor das fotos.
 * Uma conversão de cada vez (é pesada); as outras esperam na fila.
 */
@Injectable()
export class VideoService {
  private readonly log = new Logger('Video');
  private readonly dir: string;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
    private readonly imageModeration: ImageModerationService,
  ) {
    this.dir = resolve(config.MEDIA_DIR);
    mkdirSync(this.dir, { recursive: true }); // pasta temporária (com a nuvem, só aqui se converte)
  }

  /** Ficheiros do vídeo no disco: original enviado, versão final e capa. */
  paths(id: string) {
    return { src: join(this.dir, `${id}.src`), out: join(this.dir, id), poster: join(this.dir, `${id}.poster.jpg`) };
  }

  enqueue(id: string, owner: string, hooks?: VideoStorageHooks) {
    this.chain = this.chain.then(() => this.process(id, owner, hooks)).catch(() => undefined);
    return this.chain;
  }

  private async probe(file: string) {
    const { stdout } = await run(ffprobe.path, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30_000 });
    const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number; duration?: string }[] };
    const v = info.streams?.find((s) => s.codec_type === 'video');
    const seconds = Number(info.format?.duration ?? v?.duration ?? 0);
    if (!v || !v.width || !v.height || !Number.isFinite(seconds) || seconds <= 0) throw new VideoRejected('Este ficheiro não parece ser um vídeo válido.');
    return { seconds, width: v.width, height: v.height };
  }

  private async process(id: string, owner: string, hooks?: VideoStorageHooks) {
    const f = this.paths(id);
    try {
      if (hooks) await hooks.fetchSource(f.src);
      const meta = await this.probe(f.src);
      if (meta.seconds > MAX_VIDEO_SECONDS + 0.5) throw new VideoRejected(`O vídeo tem de ter até ${MAX_VIDEO_SECONDS} segundos.`);

      const tmp = `${f.out}.tmp.mp4`;
      await run(
        FFMPEG,
        [
          '-y', '-i', f.src, '-t', String(MAX_VIDEO_SECONDS),
          '-vf', "scale='min(720,iw)':'-2':flags=lanczos,format=yuv420p",
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-profile:v', 'main',
          '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', '-map_metadata', '-1', // sem metadados (GPS, etc.)
          tmp,
        ],
        { timeout: 5 * 60_000, maxBuffer: 10 * 1024 * 1024 },
      );
      await rename(tmp, f.out);
      const final = await this.probe(f.out);

      // Capa e 3 imagens para a verificação (10%, 50% e 90%).
      await run(FFMPEG, ['-y', '-ss', String(Math.min(0.5, final.seconds / 2)), '-i', f.out, '-frames:v', '1', '-q:v', '4', f.poster], { timeout: 60_000 });
      const verdict = await this.screenFrames(f.out, final.seconds, id, owner);
      if (verdict === 'reject') throw new VideoRejected('Este vídeo parece ter nudez ou conteúdo sexual e não pode ser publicado 🚫');

      const size = (await stat(f.out)).size;
      if (hooks) await hooks.publish(f.out, f.poster);
      await this.pool.query(
        `UPDATE content.media_assets SET status = 'ready', mime = 'video/mp4', size_bytes = $2, duration_ms = $3, width = $4, height = $5 WHERE id = $1`,
        [id, size, Math.round(final.seconds * 1000), final.width, final.height],
      );
      await rm(f.src, { force: true });
      if (hooks) await Promise.all([rm(f.out, { force: true }), rm(f.poster, { force: true })]); // já está na nuvem
    } catch (e) {
      const message = e instanceof VideoRejected ? e.message : 'Não consegui processar este vídeo. Tenta outro formato (MP4).';
      if (!(e instanceof VideoRejected)) this.log.error(`falha a processar vídeo ${id}: ${(e as Error).message}`);
      await this.pool.query(`UPDATE content.media_assets SET status = 'deleted', processing_error = $2 WHERE id = $1`, [id, message]);
      await Promise.all([rm(f.src, { force: true }), rm(f.out, { force: true }), rm(f.poster, { force: true }), rm(`${f.out}.tmp.mp4`, { force: true })]);
      if (hooks) await hooks.cleanup().catch(() => undefined);
      await this.pool.query('UPDATE content.media_assets SET purged_at = now() WHERE id = $1', [id]);
    }
  }

  /** Pior veredicto entre 3 imagens do vídeo. Falha do detetor = recusa (falha fechada), como nas fotos. */
  private async screenFrames(video: string, seconds: number, id: string, owner: string): Promise<'ok' | 'review' | 'reject'> {
    if (!this.imageModeration.enabled) return 'ok';
    let worst: 'ok' | 'review' | 'reject' = 'ok';
    let top: number | null = null;
    for (const at of [0.1, 0.5, 0.9]) {
      const frame = join(this.dir, `${id}.frame.jpg`);
      await run(FFMPEG, ['-y', '-ss', String(seconds * at), '-i', video, '-frames:v', '1', '-q:v', '4', frame], { timeout: 60_000 });
      const { verdict, score } = await this.imageModeration.check(await readFile(frame), 'image/jpeg');
      await rm(frame, { force: true });
      if (score !== null && (top === null || score > top)) top = score;
      if (verdict === 'reject') worst = 'reject';
      else if (verdict === 'review' && worst === 'ok') worst = 'review';
      if (worst === 'reject') break;
    }
    await this.pool.query('UPDATE content.media_assets SET nsfw_score = $2 WHERE id = $1', [id, top]);
    if (worst === 'review') {
      await this.pool.query(
        `INSERT INTO social.reports (id, reporter_id, target_type, target_id, target_user_id, reason, note)
         VALUES ($1, NULL, 'media', $2, $3, 'nudity', $4) ON CONFLICT DO NOTHING`,
        [uuidv7(), id, owner, `Verificação automática (vídeo): ${((top ?? 0) * 100).toFixed(0)}% de probabilidade`],
      );
    }
    return worst;
  }
}
