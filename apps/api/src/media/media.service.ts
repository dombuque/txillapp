import { OnModuleInit } from '@nestjs/common';
import {
  BadRequestException, Inject, Injectable, NotFoundException, PayloadTooLargeException,
  UnsupportedMediaTypeException, ForbiddenException, UnprocessableEntityException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { open, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import sharp from 'sharp';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { ImageModerationService } from '../moderation/image-moderation.service';
import { MAX_VIDEO_BYTES, VideoService, sniffVideo } from './video.service';
import { S3Storage, type Scope } from './s3.storage';

/** Onde está o ficheiro: no disco deste servidor, ou num URL (S3/CDN) para onde se redirecciona. */
export type Served = { path: string; mime: string } | { url: string };

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Áudio só para o chat (mensagens de voz): webm/ogg (Chrome, Firefox) e mp4 (Safari). */
const AUDIO = new Set(['audio/webm', 'audio/ogg', 'audio/mp4']);
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
/** Vídeos curtos (MP4/MOV/WebM). Convertidos no servidor para MP4 H.264. */
const VIDEO = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const UPLOAD_TTL_S = 300;
/** Larguras servidas (px). O pedido sobe para a mais próxima: poucas variantes, muito cache. */
export const WIDTHS = [160, 256, 480, 720, 1080, 1600] as const;

function sniff(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'audio/webm';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  return null;
}

/**
 * Armazenamento local (MVP/dev). O fluxo é o de um upload pré-assinado: o cliente pede um URL
 * temporário e envia os bytes directamente para esse URL. Trocar por S3/R2 só muda o URL devolvido.
 */
@Injectable()
export class MediaService implements OnModuleInit {
  private readonly dir: string;
  private readonly secret: string;
  private readonly s3: S3Storage | null;
  private readonly making = new Map<string, Promise<void>>();
  /** Em que bucket vive cada tipo de ficheiro: conversas ficam no privado. */
  private scopeOf = (purpose: string): Scope => (purpose === 'chat' ? 'private' : 'public');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
    private readonly imageModeration: ImageModerationService,
    private readonly video: VideoService,
  ) {
    this.dir = resolve(config.MEDIA_DIR);
    this.secret = config.JWT_ACCESS_SECRET;
    this.s3 = config.STORAGE_DRIVER === 's3' ? new S3Storage(config) : null;
    if (!this.s3) mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Analisa a imagem antes de ficar disponível. Recusa nudez/conteúdo sexual (a foto é apagada e o envio falha);
   * se estiver na zona duvidosa, passa mas fica na fila da moderação.
   */
  private async screen(id: string, owner: string, mime: string, bytes: () => Promise<Buffer>) {
    if (!mime.startsWith('image/') || !this.imageModeration.enabled) return;
    const { verdict, score } = await this.imageModeration.check(await bytes(), mime);
    await this.pool.query('UPDATE content.media_assets SET nsfw_score = $2 WHERE id = $1', [id, score]);
    if (verdict === 'reject') {
      await this.pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = $1`, [id]);
      void this.sweepDeleted();
      throw new UnprocessableEntityException('Esta foto parece ter nudez ou conteúdo sexual e não pode ser publicada 🚫');
    }
    if (verdict === 'review') {
      await this.pool.query(
        `INSERT INTO social.reports (id, reporter_id, target_type, target_id, target_user_id, reason, note)
         VALUES ($1, NULL, 'media', $2, $3, 'nudity', $4) ON CONFLICT DO NOTHING`,
        [uuidv7(), id, owner, `Verificação automática: ${(score! * 100).toFixed(0)}% de probabilidade`],
      );
    }
  }

  /** Apaga do armazenamento os ficheiros de contas eliminadas. Corre ao arrancar e de tempos a tempos. */
  async sweepDeleted(limit = 200) {
    const { rows } = await this.pool.query(`SELECT id, purpose FROM content.media_assets WHERE status = 'deleted' AND purged_at IS NULL LIMIT $1`, [limit]);
    for (const r of rows) {
      if (this.s3) {
        const id = r.id as string;
        const scope = this.scopeOf(r.purpose as string);
        // Tudo o que possa existir deste ficheiro, em ambos os buckets (variantes, capa, original por converter).
        const jobs = [this.s3.remove(id, scope), this.s3.remove(`${id}.src`, 'private'), this.s3.remove(`${id}.poster.jpg`, 'public'), ...WIDTHS.map((w) => this.s3!.remove(`${id}.${w}.webp`, 'public'))];
        await Promise.allSettled(jobs);
      }
      else {
        await rm(join(this.dir, r.id as string), { force: true });
        await rm(join(this.dir, `${r.id}.src`), { force: true });
        await rm(join(this.dir, `${r.id}.poster.jpg`), { force: true });
        for (const w of WIDTHS) await rm(join(this.dir, `${r.id}.${w}.webp`), { force: true });
      }
      await this.pool.query('UPDATE content.media_assets SET purged_at = now() WHERE id = $1', [r.id]);
    }
    return rows.length;
  }

  onModuleInit() {
    const run = () => this.sweepDeleted().catch(() => undefined);
    void run();
    setInterval(run, 10 * 60_000).unref();
  }

  async requestUpload(userId: string, mime: string, size: number, purpose: 'public' | 'chat' = 'public') {
    const audio = AUDIO.has(mime);
    const video = VIDEO.has(mime);
    if (video && purpose !== 'public') throw new UnsupportedMediaTypeException('Vídeos só se publicam em publicações e stories');
    if (!ALLOWED.has(mime) && !(audio && purpose === 'chat') && !video) throw new UnsupportedMediaTypeException('Apenas JPEG, PNG ou WebP (e vídeos MP4)');
    const max = audio ? MAX_AUDIO_BYTES : video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (!Number.isInteger(size) || size < 1 || size > max) {
      throw new PayloadTooLargeException(`Ficheiro até ${max / 1024 / 1024} MB`);
    }
    const id = uuidv7();
    await this.pool.query(
      'INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, purpose) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, userId, mime, size, `${id}`, purpose],
    );
    // Na nuvem: conversas no bucket privado; vídeos entram como "original" no privado até serem verificados e convertidos.
    if (this.s3) return { assetId: id, uploadUrl: await this.s3.presignPut(video ? `${id}.src` : id, mime, size, UPLOAD_TTL_S, video || purpose === 'chat' ? 'private' : 'public') };
    const exp = Math.floor(Date.now() / 1000) + UPLOAD_TTL_S;
    return { assetId: id, uploadUrl: `/api/v1/media/${id}/upload?exp=${exp}&sig=${this.sign(id, exp)}` };
  }

  /**
   * O cliente avisa que o upload acabou. No disco local o ficheiro já foi validado no próprio envio;
   * no S3 confirma-se aqui o tamanho e o tipo real (primeiros bytes) antes de o ficheiro passar a 'ready'.
   */
  async complete(userId: string, id: string): Promise<{ status: string; error?: string }> {
    const { rows } = await this.pool.query('SELECT mime, size_bytes, status, processing_error, purpose FROM content.media_assets WHERE id = $1 AND owner_id = $2', [id, userId]);
    const a = rows[0];
    if (!a) throw new NotFoundException();
    if (a.status === 'deleted') return { status: 'deleted', error: a.processing_error ?? undefined };
    if (VIDEO.has(a.mime) && a.status === 'uploaded') {
      // O vídeo foi recebido: converte-se em segundo plano; a app pergunta pelo estado.
      await this.pool.query(`UPDATE content.media_assets SET status = 'processing' WHERE id = $1 AND status = 'uploaded'`, [id]);
      void this.video.enqueue(id, userId);
      return { status: 'processing' };
    }
    if (a.status === 'ready' || a.status === 'processing') return { status: a.status };
    if (!this.s3) throw new NotFoundException(VIDEO.has(a.mime) ? 'O vídeo ainda não foi enviado' : 'O ficheiro ainda não foi enviado');
    const scope = this.scopeOf(a.purpose);
    if (VIDEO.has(a.mime)) return this.completeCloudVideo(userId, id);
    const head = await this.s3.head(id, scope);
    if (!head) throw new NotFoundException('O ficheiro ainda não foi enviado');
    const limit = AUDIO.has(a.mime) ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
    if (head.size < 1 || head.size > limit) {
      await this.s3.remove(id, scope);
      throw new PayloadTooLargeException('Ficheiro demasiado grande');
    }
    if (sniff(await this.s3.firstBytes(id, scope)) !== a.mime) {
      await this.s3.remove(id, scope);
      throw new UnsupportedMediaTypeException('Conteúdo não corresponde ao tipo declarado');
    }
    let bytes: Buffer | null = null;
    const read = async () => (bytes ??= await this.s3!.read(id, scope));
    await this.screen(id, userId, a.mime, read);
    // Fotos públicas: gera já as versões leves (o telemóvel descarrega dezenas de KB, não vários MB).
    if (a.mime.startsWith('image/') && a.purpose === 'public') await this.publishVariants(id, await read());
    await this.pool.query(`UPDATE content.media_assets SET status = 'ready', size_bytes = $2 WHERE id = $1`, [id, head.size]);
    return { status: 'ready' };
  }

  /** Gera e envia as larguras (WebP) de uma foto para o bucket público. */
  private async publishVariants(id: string, bytes: Buffer) {
    for (const w of WIDTHS) {
      try {
        const out = await sharp(bytes).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
        await this.s3!.put(`${id}.${w}.webp`, out, 'image/webp', 'public');
      } catch {
        return; // imagem que o sharp não consegue reduzir: fica só o original
      }
    }
  }

  /** Vídeo na nuvem: valida o original (bucket privado), converte aqui e publica o resultado no bucket público. */
  private async completeCloudVideo(userId: string, id: string): Promise<{ status: string }> {
    const s3 = this.s3!;
    const src = `${id}.src`;
    const head = await s3.head(src, 'private');
    if (!head) throw new NotFoundException('O vídeo ainda não foi enviado');
    if (head.size < 1 || head.size > MAX_VIDEO_BYTES) {
      await s3.remove(src, 'private');
      throw new PayloadTooLargeException('Vídeo demasiado grande');
    }
    if (!sniffVideo(await s3.firstBytes(src, 'private'))) {
      await s3.remove(src, 'private');
      throw new UnsupportedMediaTypeException('Conteúdo não corresponde a um vídeo');
    }
    await this.pool.query(`UPDATE content.media_assets SET status = 'processing' WHERE id = $1 AND status = 'pending'`, [id]);
    void this.video.enqueue(id, userId, {
      fetchSource: async (dest) => writeFile(dest, await s3.read(src, 'private')),
      publish: async (video, poster) => {
        await s3.put(id, createReadStream(video), 'video/mp4', 'public', (await stat(video)).size);
        await s3.put(`${id}.poster.jpg`, await readFile(poster), 'image/jpeg', 'public');
        await s3.remove(src, 'private'); // o original não publicado deixa de existir
      },
      cleanup: async () => void (await Promise.allSettled([s3.remove(src, 'private'), s3.remove(id, 'public'), s3.remove(`${id}.poster.jpg`, 'public')])),
    });
    return { status: 'processing' };
  }

  /** Estado de um ficheiro (para a app esperar pela conversão do vídeo). */
  async status(userId: string, id: string) {
    const { rows } = await this.pool.query('SELECT status, processing_error, duration_ms FROM content.media_assets WHERE id = $1 AND owner_id = $2', [id, userId]);
    if (!rows[0]) throw new NotFoundException();
    return { status: rows[0].status as string, error: (rows[0].processing_error as string | null) ?? undefined, durationMs: (rows[0].duration_ms as number | null) ?? undefined };
  }

  async receive(id: string, exp: number, sig: string, body: Readable) {
    if (this.s3) throw new NotFoundException();
    const expected = Buffer.from(this.sign(id, exp));
    const given = Buffer.from(sig ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given) || exp < Date.now() / 1000) {
      throw new ForbiddenException('URL de upload inválido ou expirado');
    }
    const { rows } = await this.pool.query('SELECT mime, size_bytes, status, owner_id FROM content.media_assets WHERE id = $1', [id]);
    const asset = rows[0];
    if (!asset || asset.status !== 'pending') throw new NotFoundException();

    const isVideo = VIDEO.has(asset.mime);
    // Vídeos ficam primeiro como original (.src) e só passam a 'ready' depois de convertidos.
    const path = isVideo ? this.video.paths(id).src : join(this.dir, id);
    let received = 0;
    const limit = Math.min(Number(asset.size_bytes), isVideo ? MAX_VIDEO_BYTES : AUDIO.has(asset.mime) ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES);
    const guard = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length;
        if (received > limit) return cb(new PayloadTooLargeException('Excede o tamanho declarado'));
        cb(null, chunk);
      },
    });
    try {
      await pipeline(body, guard, createWriteStream(path, { flags: 'wx' }));
      const fh = await open(path, 'r');
      const head = Buffer.alloc(12);
      await fh.read(head, 0, 12, 0);
      await fh.close();
      // Valida o conteúdo real, não só o Content-Type declarado.
      if (isVideo) {
        if (!sniffVideo(head)) throw new UnsupportedMediaTypeException('Conteúdo não corresponde a um vídeo');
      } else {
        if (sniff(head) !== asset.mime) throw new UnsupportedMediaTypeException('Conteúdo não corresponde ao tipo declarado');
        await this.screen(id, asset.owner_id, asset.mime, () => readFile(path));
      }
    } catch (e) {
      await rm(path, { force: true });
      throw e;
    }
    if (isVideo) {
      await this.pool.query(`UPDATE content.media_assets SET status = 'uploaded', size_bytes = $2 WHERE id = $1`, [id, received]);
      return { assetId: id };
    }
    await this.pool.query(`UPDATE content.media_assets SET status = 'ready', size_bytes = $2 WHERE id = $1`, [id, received]);
    return { assetId: id };
  }

  async locate(id: string, width?: number): Promise<Served> {
    // Os ficheiros do chat nunca saem por aqui: só pelo URL assinado da conversa.
    const { rows } = await this.pool.query(`SELECT mime FROM content.media_assets WHERE id = $1 AND status = 'ready' AND purpose = 'public'`, [id]);
    if (!rows[0]) throw new NotFoundException();
    if (this.s3) {
      // Nuvem: a versão leve (WebP) se pedida; senão o original.
      const w = width && rows[0].mime.startsWith('image/') ? (WIDTHS.find((x) => x >= width) ?? WIDTHS[WIDTHS.length - 1]) : null;
      return { url: await this.s3.readUrl(w ? `${id}.${w}.webp` : id, { ttlSeconds: 3600 }) };
    }
    const original = { path: join(this.dir, id), mime: rows[0].mime as string };
    return width ? this.variant(original, id, width) : original;
  }

  /**
   * Versão mais leve da foto (WebP, na largura pedida, já na orientação certa e sem metadados como a localização GPS).
   * Gera-se uma vez e fica em cache: o telemóvel descarrega 50 a 150 KB em vez de vários MB.
   */
  private async variant(original: { path: string; mime: string }, id: string, width: number) {
    if (!original.mime.startsWith('image/')) return original;
    const w = WIDTHS.find((x) => x >= width) ?? WIDTHS[WIDTHS.length - 1];
    const out = join(this.dir, `${id}.${w}.webp`);
    if (!existsSync(out)) {
      let job = this.making.get(out);
      if (!job) {
        job = (async () => {
          const tmp = `${out}.${process.pid}.tmp`;
          await sharp(original.path).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toFile(tmp);
          await rename(tmp, out);
        })().finally(() => this.making.delete(out));
        this.making.set(out, job);
      }
      try {
        await job;
      } catch {
        return original; // imagem que o sharp não consegue reduzir: serve-se a original
      }
    }
    return { path: out, mime: 'image/webp' };
  }

  /** Imagem de capa de um vídeo. */
  async locatePoster(id: string): Promise<Served> {
    const { rows } = await this.pool.query(`SELECT 1 FROM content.media_assets WHERE id = $1 AND status = 'ready' AND purpose = 'public' AND mime LIKE 'video/%'`, [id]);
    if (!rows[0]) throw new NotFoundException();
    if (this.s3) return { url: await this.s3.readUrl(`${id}.poster.jpg`, { ttlSeconds: 3600 }) };
    return { path: this.video.paths(id).poster, mime: 'image/jpeg' };
  }

  /**
   * URL assinado e temporário para um ficheiro do chat. A validade acaba no fim da próxima hora cheia:
   * dentro dela o URL é sempre o mesmo (o browser não volta a descarregar a cada actualização da conversa).
   */
  chatUrl(id: string) {
    const exp = (Math.floor(Date.now() / 3_600_000) + 2) * 3600;
    return `/api/v1/chat/media/${id}?exp=${exp}&sig=${this.sign(`chat:${id}`, exp)}`;
  }

  async locateChat(id: string, exp: number, sig: string): Promise<Served> {
    const expected = Buffer.from(this.sign(`chat:${id}`, exp));
    const given = Buffer.from(sig ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given) || exp < Date.now() / 1000) throw new ForbiddenException('URL expirado');
    const { rows } = await this.pool.query(`SELECT mime FROM content.media_assets WHERE id = $1 AND status = 'ready' AND purpose = 'chat'`, [id]);
    if (!rows[0]) throw new NotFoundException();
    if (this.s3) return { url: await this.s3.readUrl(id, { scope: 'private', ttlSeconds: 300 }) };
    return { path: join(this.dir, id), mime: rows[0].mime as string };
  }

  /** Ficheiro da foto de perfil de uma pessoa, se tiver. */
  async avatarOf(username: string): Promise<Served | null> {
    const { rows } = await this.pool.query(
      `SELECT m.id, m.mime FROM identity.users u JOIN content.media_assets m ON m.id = u.avatar_media_id
        WHERE u.username = $1 AND u.status = 'active' AND m.status = 'ready'`,
      [username],
    );
    if (!rows[0]) return null;
    if (this.s3) return { url: await this.s3.readUrl(`${rows[0].id}.256.webp`, { ttlSeconds: 3600 }) };
    // O avatar nunca precisa do original: serve-se sempre a versão pequena.
    return this.variant({ path: join(this.dir, rows[0].id as string), mime: rows[0].mime as string }, rows[0].id as string, 256);
  }

  private sign(id: string, exp: number) {
    return createHmac('sha256', this.secret).update(`${id}.${exp}`).digest('base64url');
  }
}

export function parseIdParam(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new BadRequestException('id inválido');
  return id;
}
