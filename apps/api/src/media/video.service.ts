import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createReadStream, mkdirSync } from 'fs';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { execFile } from 'child_process';
import { readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import { promisify } from 'util';
import { newInstanceId, runsBackground } from '../common/role';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { ImageModerationService } from '../moderation/image-moderation.service';
import { RealtimeBus } from '../realtime/realtime-bus';
import { Scheduler } from '../realtime/scheduler';
import { S3Storage } from './s3.storage';

const run = promisify(execFile);
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;
const FFMPEG = (ffmpegPath as unknown as string | null) ?? 'ffmpeg';
/** O toque ao worker quando entra um vídeo (RealtimeBus); a volta de 2 s; o sinal de vida; «caído» ao fim de 2 min. */
export const VIDEO_KICK = 'video.kick';
const POLL_MS = 2_000;
const HEARTBEAT_MS = 15_000;
const STALE_S = 120;
/** Tentativas por vídeo (um processo que cai a meio de um vídeo que o faz cair não fica a tentar para sempre). */
const MAX_ATTEMPTS = 2;
const FAILED = 'Não consegui processar este vídeo. Tenta outro formato (MP4).';

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

/**
 * Onde se tira a capa (segundos): no instante escolhido no estúdio de tchekas (`posterMs`), dentro do vídeo; sem escolha,
 * aos 0,5 s (ou a meio, nos vídeos mais curtos), como sempre.
 */
export function posterSeek(seconds: number, posterMs?: number | null): number {
  const len = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  if (typeof posterMs === 'number' && Number.isFinite(posterMs) && posterMs >= 0) return Math.round(Math.min(posterMs / 1000, Math.max(0, len - 0.1)) * 1000) / 1000;
  return Math.min(0.5, len / 2);
}

export type VideoSniff = 'video/mp4' | 'video/webm' | null;
/** MP4/MOV ("ftyp" nos bytes 4 a 8) e WebM (cabeçalho EBML). O conteúdo real é que conta, não o Content-Type. */
export function sniffVideo(head: Buffer): VideoSniff {
  if (head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video/webm';
  return null;
}

/**
 * Converte os vídeos enviados: máximo 60 s, lado menor até 1080 px (CRF 23), H.264/AAC em MP4 com "faststart" (começa a tocar sem esperar
 * pelo ficheiro todo), gera a imagem de capa e analisa 3 imagens do vídeo com o mesmo detetor das fotos.
 * VIDEO_CONCURRENCY conversões de cada vez (1 por omissão: é pesada); as outras esperam na fila.
 *
 * A fila é a tabela content.video_jobs (docs/escala.md): quem envia (uma instância web) guarda o pedido e dá um toque ao
 * worker; o worker (ROLE=worker, ou o próprio processo sem ROLE) apanha o mais antigo com `FOR UPDATE SKIP LOCKED`, renova
 * o sinal de vida enquanto converte e apaga a linha no fim (o resultado fica em content.media_assets, como sempre). Um
 * vídeo «a converter» de um processo que caiu volta para a fila (até 2 tentativas) ou falha com «Tenta outro formato».
 */
@Injectable()
export class VideoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Video');
  private readonly dir: string;
  private readonly s3: S3Storage | null;
  private readonly concurrency: number;
  /** Este processo converte? (ROLE=worker, ou sem ROLE). */
  readonly runsQueue: boolean;
  readonly workerId = newInstanceId();
  private running = 0;
  private pumping = false;
  private pumpAgain = false;
  private stopped = false;
  private offKick?: () => void;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
    private readonly imageModeration: ImageModerationService,
    private readonly scheduler: Scheduler,
    private readonly bus: RealtimeBus,
  ) {
    this.dir = resolve(config.MEDIA_DIR);
    mkdirSync(this.dir, { recursive: true }); // pasta temporária (com a nuvem, só aqui se converte)
    this.s3 = config.STORAGE_DRIVER === 's3' ? new S3Storage(config) : null;
    this.concurrency = config.VIDEO_CONCURRENCY;
    this.runsQueue = runsBackground(config);
  }

  async onModuleInit() {
    if (!this.runsQueue) return;
    this.offKick = this.bus.onSignal(VIDEO_KICK, () => void this.pump());
    // Os que estavam a converter neste contentor antes de reiniciar (ou num processo caído) voltam para a fila.
    await this.requeueStale(true).catch((e) => this.log.error(`não consegui retomar os vídeos: ${(e as Error).message}`));
    void this.pump();
    this.scheduler.every('video.poll', POLL_MS, () => this.pump());
    this.scheduler.every('video.stale', 60_000, () => this.requeueStale(false));
  }

  onModuleDestroy() {
    this.stopped = true;
    this.offKick?.();
  }

  /**
   * Põe o vídeo na fila de conversão (o estado do ficheiro já é 'processing'). `scope`: com o armazenamento na nuvem, onde
   * fica o vídeo pronto ('public' nas publicações, 'private' nas conversas); sem nuvem, null. `posterMs`: o instante da capa
   * escolhido no estúdio de tchekas (sem ele, a capa é aos 0,5 s).
   */
  async enqueue(id: string, owner: string, scope: 'public' | 'private' | null, posterMs?: number) {
    await this.pool.query(
      `INSERT INTO content.video_jobs (media_id, owner_id, scope, poster_ms) VALUES ($1, $2, $3, $4) ON CONFLICT (media_id) DO NOTHING`,
      [id, owner, this.s3 ? scope ?? 'public' : null, posterMs ?? null],
    );
    this.bus.signal(VIDEO_KICK);
  }

  /** Apanha o vídeo mais antigo da fila para este processo (atómico: dois workers nunca apanham o mesmo). */
  async claim(): Promise<{ media_id: string; owner_id: string; scope: 'public' | 'private' | null; poster_ms: number | null } | null> {
    const { rows } = await this.pool.query(
      `UPDATE content.video_jobs j SET status = 'working', attempts = attempts + 1, worker_id = $1, heartbeat_at = now()
        WHERE j.media_id = (SELECT media_id FROM content.video_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
          AND j.status = 'queued'
        RETURNING j.media_id, j.owner_id, j.scope, j.poster_ms`,
      [this.workerId],
    );
    return rows[0] ?? null;
  }

  /** Converte vídeos da fila até VIDEO_CONCURRENCY ao mesmo tempo. */
  async pump(): Promise<void> {
    if (!this.runsQueue || this.stopped) return;
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        while (!this.stopped && this.running < this.concurrency) {
          const job = await this.claim().catch((e) => {
            if (!this.stopped) this.log.warn(`não consegui ler a fila: ${(e as Error).message}`);
            return null;
          });
          if (!job) break;
          this.running += 1;
          void this.runJob(job).finally(() => {
            this.running -= 1;
            void this.pump();
          });
        }
      } while (this.pumpAgain && !this.stopped);
    } finally {
      this.pumping = false;
    }
  }

  private async runJob(job: { media_id: string; owner_id: string; scope: 'public' | 'private' | null; poster_ms: number | null }) {
    const id = job.media_id;
    const beat = setInterval(() => void this.pool.query(`UPDATE content.video_jobs SET heartbeat_at = now() WHERE media_id = $1 AND worker_id = $2`, [id, this.workerId]).catch(() => undefined), HEARTBEAT_MS);
    beat.unref();
    try {
      await this.process(id, job.owner_id, job.scope && this.s3 ? this.cloudHooks(this.s3, id, job.scope) : undefined, job.poster_ms ?? undefined);
    } finally {
      clearInterval(beat);
      // A meio de um fim do processo, a linha fica: o próximo worker volta a pegar no vídeo.
      if (!this.stopped) await this.pool.query('DELETE FROM content.video_jobs WHERE media_id = $1 AND worker_id = $2', [id, this.workerId]).catch(() => undefined);
    }
  }

  /** Vídeo na nuvem: o original no bucket privado; o convertido e a capa vão para o bucket do `scope`. */
  private cloudHooks(s3: S3Storage, id: string, scope: 'public' | 'private'): VideoStorageHooks {
    const src = `${id}.src`;
    return {
      fetchSource: async (dest) => writeFile(dest, await s3.read(src, 'private')),
      publish: async (video, poster) => {
        await s3.put(id, createReadStream(video), 'video/mp4', scope, (await stat(video)).size);
        await s3.put(`${id}.poster.jpg`, await readFile(poster), 'image/jpeg', scope);
        await s3.remove(src, 'private'); // o original não publicado deixa de existir
      },
      cleanup: async () => void (await Promise.allSettled([s3.remove(src, 'private'), s3.remove(id, scope), s3.remove(`${id}.poster.jpg`, scope)])),
    };
  }

  /**
   * Vídeos «a converter» sem sinal de vida há mais de STALE_S (o processo caiu), ou deste processo depois de reiniciar
   * (`mine`): voltam para a fila; à terceira vez, falham (o vídeo passa a 'deleted' com a frase de sempre).
   */
  private async requeueStale(mine: boolean) {
    const stale = `status = 'working' AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => $1) OR ($2 AND worker_id = $3))`;
    const dead = await this.pool.query(`DELETE FROM content.video_jobs WHERE ${stale} AND attempts >= ${MAX_ATTEMPTS} RETURNING media_id`, [STALE_S, mine, this.workerId]);
    for (const r of dead.rows) {
      await this.pool.query(`UPDATE content.media_assets SET status = 'deleted', processing_error = $2 WHERE id = $1 AND status = 'processing'`, [r.media_id, FAILED]);
      await this.pool.query('UPDATE content.media_assets SET purged_at = now() WHERE id = $1', [r.media_id]);
    }
    const back = await this.pool.query(`UPDATE content.video_jobs SET status = 'queued', worker_id = NULL WHERE ${stale}`, [STALE_S, mine, this.workerId]);
    if (back.rowCount) void this.pump();
  }

  /** Ficheiros do vídeo no disco: original enviado, versão final e capa. */
  paths(id: string) {
    return { src: join(this.dir, `${id}.src`), out: join(this.dir, id), poster: join(this.dir, `${id}.poster.jpg`) };
  }

  /**
   * Entrada segura para o ffmpeg/ffprobe: lê só ficheiros locais (um "vídeo" que seja uma lista HLS não consegue fazer o
   * ffmpeg ir buscar outros ficheiros do servidor nem endereços da rede) e só nos formatos aceites (MP4/MOV e WebM/Matroska).
   */
  static readonly SAFE_INPUT = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,matroska,webm'];


  private async probe(file: string) {
    const { stdout } = await run(ffprobe.path, ['-v', 'error', ...VideoService.SAFE_INPUT, '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30_000 });
    const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number; duration?: string }[] };
    const v = info.streams?.find((s) => s.codec_type === 'video');
    const seconds = Number(info.format?.duration ?? v?.duration ?? 0);
    if (!v || !v.width || !v.height || !Number.isFinite(seconds) || seconds <= 0) throw new VideoRejected('Este ficheiro não parece ser um vídeo válido.');
    return { seconds, width: v.width, height: v.height };
  }

  private async process(id: string, owner: string, hooks?: VideoStorageHooks, posterMs?: number) {
    const f = this.paths(id);
    try {
      if (hooks) await hooks.fetchSource(f.src);
      const meta = await this.probe(f.src);
      if (meta.seconds > MAX_VIDEO_SECONDS + 0.5) throw new VideoRejected(`O vídeo tem de ter até ${MAX_VIDEO_SECONDS} segundos.`);

      const tmp = `${f.out}.tmp.mp4`;
      await run(
        FFMPEG,
        [
          '-y', ...VideoService.SAFE_INPUT, '-i', f.src, '-t', String(MAX_VIDEO_SECONDS),
          // Lado menor até 1080 (vertical 1080×1920, horizontal 1920×1080), nunca amplia; 30 fps no máximo.
          '-vf', "scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)':flags=lanczos,fps=30,format=yuv420p",
          '-c:v', 'libx264', '-preset', 'faster', '-crf', '23', '-maxrate', '6M', '-bufsize', '12M', '-profile:v', 'high', '-level', '4.1',
          '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', '-map_metadata', '-1', // sem metadados (GPS, etc.)
          tmp,
        ],
        { timeout: 5 * 60_000, maxBuffer: 10 * 1024 * 1024 },
      );
      await rename(tmp, f.out);
      const final = await this.probe(f.out);

      // Capa (no instante escolhido, se houver) e 3 imagens para a verificação (10%, 50% e 90%).
      await run(FFMPEG, ['-y', ...VideoService.SAFE_INPUT, '-ss', String(posterSeek(final.seconds, posterMs)), '-i', f.out, '-frames:v', '1', '-q:v', '4', f.poster], { timeout: 60_000 });
      const verdict = await this.screenFrames(f.out, final.seconds, id, owner);
      if (verdict === 'reject') throw new VideoRejected('Este vídeo parece mostrar nudez e não pode ser publicado.');

      const size = (await stat(f.out)).size;
      if (hooks) await hooks.publish(f.out, f.poster);
      await this.pool.query(
        `UPDATE content.media_assets SET status = 'ready', mime = 'video/mp4', size_bytes = $2, duration_ms = $3, width = $4, height = $5 WHERE id = $1`,
        [id, size, Math.round(final.seconds * 1000), final.width, final.height],
      );
      await rm(f.src, { force: true });
      if (hooks) await Promise.all([rm(f.out, { force: true }), rm(f.poster, { force: true })]); // já está na nuvem
    } catch (e) {
      const message = e instanceof VideoRejected ? e.message : FAILED;
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
    let why: string | null = null;
    for (const at of [0.1, 0.5, 0.9]) {
      const frame = join(this.dir, `${id}.frame.jpg`);
      await run(FFMPEG, ['-y', ...VideoService.SAFE_INPUT, '-ss', String(seconds * at), '-i', video, '-frames:v', '1', '-q:v', '4', frame], { timeout: 60_000 });
      const { verdict, score, reason } = await this.imageModeration.check(await readFile(frame), 'image/jpeg');
      await rm(frame, { force: true });
      if (score !== null && (top === null || score > top)) top = score;
      if (verdict === 'reject') {
        worst = 'reject';
        why = reason;
      } else if (verdict === 'review' && worst === 'ok') {
        worst = 'review';
        why = reason;
      }
      if (worst === 'reject') break;
    }
    await this.pool.query('UPDATE content.media_assets SET nsfw_score = $2 WHERE id = $1', [id, top]);
    if (worst === 'review') {
      await this.pool.query(
        `INSERT INTO social.reports (id, reporter_id, target_type, target_id, target_user_id, reason, note)
         VALUES ($1, NULL, 'media', $2, $3, 'nudity', $4) ON CONFLICT DO NOTHING`,
        [uuidv7(), id, owner, `Verificação automática (vídeo): ${why ?? `classificador ${Math.round((top ?? 0) * 100)}%`}`],
      );
    }
    return worst;
  }
}
