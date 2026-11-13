import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import { z } from 'zod';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { MediaService } from '../media/media.service';
import { S3Storage } from '../media/s3.storage';
import { ANALYZE_DECODE_HZ, ANALYZE_MAX_S, soundAnalysis, type SoundAnalysis } from './analyze';
import { decodeMono, probe, SAFE_VIDEO } from './ffmpeg';

/** Quantos vídeos se ouvem ao mesmo tempo no servidor (cada um é um ffmpeg curto). */
export const ANALYZE_AT_ONCE = 2;
/** Quantos pedidos podem esperar pela vez; a partir daí responde-se 503 (a app monta só com a imagem). */
export const ANALYZE_QUEUE = 12;
/** O prazo de cada análise (ms). */
export const ANALYZE_TIMEOUT_MS = 20_000;
/** Quantas respostas ficam em memória (um ficheiro enviado não muda: a mesma resposta serve sempre). */
export const ANALYZE_CACHE = 400;

const bodySchema = z.object({ mediaId: z.string().uuid('mediaId inválido') });

/**
 * POST /tchekas/compose/analyze: se um vídeo do próprio tem som e a energia dele (docs/estudio-nativo.md, Montagem mágica).
 * Serve vídeos já enviados por quem pede, prontos ou ainda a converter (ouve-se o original: a conversão pode demorar e a
 * Montagem mágica não espera por ela). Respostas em cache por ficheiro, poucos de cada vez e com prazo.
 */
@Injectable()
export class ComposeAnalyzeService {
  private readonly log = new Logger('ComposeAnalyze');
  private readonly dir: string;
  private readonly s3: S3Storage | null;
  private readonly cache = new Map<string, SoundAnalysis>();
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  /** Quantas vezes se ouviu um ficheiro a sério (os testes confirmam a cache). */
  decoded = 0;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
    private readonly media: MediaService,
  ) {
    this.dir = resolve(config.MEDIA_DIR);
    this.s3 = config.STORAGE_DRIVER === 's3' ? new S3Storage(config) : null;
  }

  async analyze(userId: string, raw: unknown): Promise<SoundAnalysis> {
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Pedido inválido');
    const id = parsed.data.mediaId;
    const row = (await this.pool.query(`SELECT mime, status, purpose FROM content.media_assets WHERE id = $1 AND owner_id = $2`, [id, userId])).rows[0];
    if (!row || row.status === 'deleted' || row.status === 'failed' || row.status === 'rejected') throw new NotFoundException('Vídeo não encontrado');
    if (!String(row.mime).startsWith('video/') || row.purpose !== 'public') throw new BadRequestException('Só se ouvem os vídeos dos clipes');
    if (row.status !== 'ready' && row.status !== 'processing') throw new ConflictException('O vídeo ainda não acabou de chegar');
    const hit = this.cache.get(id);
    if (hit) {
      this.cache.delete(id);
      this.cache.set(id, hit);
      return hit;
    }
    if (this.running >= ANALYZE_AT_ONCE && this.waiting.length >= ANALYZE_QUEUE) throw new ServiceUnavailableException('O servidor está ocupado. Tenta daqui a pouco.');
    await this.turn();
    try {
      const out = await this.listen(id);
      this.cache.set(id, out);
      if (this.cache.size > ANALYZE_CACHE) this.cache.delete(this.cache.keys().next().value as string);
      return out;
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }

  private turn(): Promise<void> {
    if (this.running < ANALYZE_AT_ONCE) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((r) => this.waiting.push(() => { this.running++; r(); }));
  }

  /** Os bytes do vídeo: o convertido, se já está pronto; senão o original enviado (no disco ou no bucket privado). */
  private async bytes(id: string): Promise<Buffer> {
    const ready = () => this.media.rawBytes(id, 'public');
    try {
      return this.s3 ? await this.s3.read(`${id}.src`, 'private') : await readFile(join(this.dir, `${id}.src`));
    } catch {
      // O original já saiu (a conversão acabou entretanto): ouve-se o convertido.
      return ready();
    }
  }

  private async listen(id: string): Promise<SoundAnalysis> {
    const tmp = await mkdtemp(join(tmpdir(), 'txanalyze-'));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ANALYZE_TIMEOUT_MS);
    try {
      let data: Buffer;
      try {
        data = await this.bytes(id);
      } catch {
        throw new NotFoundException('Vídeo não encontrado');
      }
      const file = join(tmp, 'in.bin');
      await writeFile(file, data);
      const p = await probe(file, SAFE_VIDEO).catch(() => null);
      if (!p?.hasVideo) throw new BadRequestException('Este vídeo não se consegue ler');
      this.decoded++;
      if (!p.hasAudio) return soundAnalysis(false, null, ANALYZE_DECODE_HZ, p.seconds);
      const seconds = Math.min(ANALYZE_MAX_S, Math.max(0.5, p.seconds + 0.5));
      const mono = await decodeMono(file, seconds, ANALYZE_DECODE_HZ, { cwd: tmp, signal: ac.signal });
      return soundAnalysis(true, mono, ANALYZE_DECODE_HZ, p.seconds);
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) throw e;
      this.log.warn(`não consegui ouvir ${id}: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Não consegui ouvir este vídeo agora. Tenta daqui a pouco.');
    } finally {
      clearTimeout(timer);
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
