import { Logger, OnModuleInit } from '@nestjs/common';
import {
  BadRequestException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, PayloadTooLargeException,
  UnsupportedMediaTypeException, ForbiddenException, UnprocessableEntityException, ConflictException, GoneException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { open, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import { ModuleRef } from '@nestjs/core';
import { HELD_PUBLICATIONS } from './held-token';
import type { HeldPublicationsService } from './held-publications.service';
import sharp from 'sharp';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { ImageModerationService } from '../moderation/image-moderation.service';
import { MAX_VIDEO_BYTES, VideoService, sniffVideo } from './video.service';
import { S3Storage, type Scope } from './s3.storage';
import { stripJpegLossless } from './jpegClean';

/** Onde está o ficheiro: no disco deste servidor, ou num URL (S3/CDN) para onde se redirecciona. */
export type Served = { path: string; mime: string } | { url: string };

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** O que a pessoa lê quando uma foto é recusada (a app junta o botão «Pedir revisão»). */
export const REJECTED_PHOTO = 'Esta foto parece mostrar nudez e não pode ser publicada. Se achas que nos enganámos, toca em "Pedir revisão".';
/** Uma foto recusada fica guardada este tempo (para o pedido de revisão), ou até a moderação decidir o pedido. */
export const REJECTED_KEEP_DAYS = 7;
/** Pedidos de revisão por pessoa e por dia. */
export const APPEALS_PER_DAY = 10;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Tira os metadados de uma foto (GPS, aparelho, data) antes de ficar guardada: nada do EXIF chega a quem a vê.
 * JPEG direito (como os da TxillCam e do editor, que saem de um canvas): tiram-se os segmentos de metadados sem voltar a
 * comprimir (jpegClean.ts). JPEG rodado no EXIF (fotos da galeria) ou fora do comum: aplica a rotação e regrava.
 * PNG e WebP (também animados) regravam-se sem metadados. Se falhar, devolve null.
 */
export async function stripImageMeta(bytes: Buffer, mime: string, opts: { fast?: boolean } = {}): Promise<Buffer | null> {
  try {
    if (mime === 'image/jpeg') {
      const kept = await jpegWithoutMeta(bytes);
      if (kept) return kept;
    }
    // Fotos do chat (o Zás): o mesmo JPEG sem metadados, mas sem o mozjpeg, que numa foto de 1080×1440 leva ~0,4 a 1,3 s
    // (o libjpeg normal faz o mesmo em ~50 ms; o ficheiro fica uns 10 % maior, e quem vê recebe a largura leve em WebP).
    if (mime === 'image/jpeg') return await sharp(bytes).rotate().jpeg(opts.fast ? { quality: 90 } : { quality: 92, mozjpeg: true }).toBuffer();
    if (mime === 'image/png') return await sharp(bytes).png({ compressionLevel: 9 }).toBuffer();
    if (mime === 'image/webp') return await sharp(bytes, { animated: true }).webp({ quality: 92 }).toBuffer();
  } catch {
    /* fica o original */
  }
  return null;
}
/**
 * O mesmo JPEG sem os segmentos de metadados (jpegClean.stripJpegLossless), se der: tem de ler-se, estar direito (sem
 * Orientation, ou 1: rodar obriga a recomprimir), ser RGB ou cinzento, e o resultado ter o mesmo tamanho e nenhum
 * EXIF/XMP/IPTC. Senão null, e faz-se o reencode.
 */
async function jpegWithoutMeta(bytes: Buffer): Promise<Buffer | null> {
  const meta = await sharp(bytes).metadata();
  if (meta.format !== 'jpeg' || (meta.orientation ?? 1) !== 1 || (meta.space !== 'srgb' && meta.space !== 'b-w')) return null;
  const out = stripJpegLossless(bytes);
  if (!out) return null;
  const check = await sharp(out).metadata();
  if (check.width !== meta.width || check.height !== meta.height || check.exif || check.xmp || check.iptc) return null;
  return out;
}
/** Áudio só para o chat (mensagens de voz): webm/ogg (Chrome, Firefox) e mp4 (Safari). */
const AUDIO = new Set(['audio/webm', 'audio/ogg', 'audio/mp4']);
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
/** Músicas do programa de artistas ('music'): MP3, M4A e AAC, até 20 MB (o servidor confirma a duração e corta o trecho). */
export const MUSIC_AUDIO = new Set(['audio/mpeg', 'audio/mp4', 'audio/aac']);
export const MAX_MUSIC_BYTES = 20 * 1024 * 1024;
/** Os nomes que os browsers e os telemóveis dão aos mesmos formatos. */
export const normalizeMusicMime = (mime: string) => (mime === 'audio/mp3' ? 'audio/mpeg' : mime === 'audio/x-m4a' || mime === 'audio/m4a' ? 'audio/mp4' : mime === 'audio/x-aac' ? 'audio/aac' : mime);
/** Vídeos curtos (MP4/MOV/WebM). Convertidos no servidor para MP4 H.264. */
const VIDEO = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const UPLOAD_TTL_S = 300;
/** A cópia privada de um vídeo de que se tirou o áudio de um som retirado pela equipa (para o repor). */
const SOUND_COPY = '.sound';
/** Larguras servidas (px). O pedido sobe para a mais próxima: poucas variantes, muito cache. */
export const WIDTHS = [160, 256, 480, 720, 1080, 1600] as const;
/** Larguras leves das fotos do chat (o visor do Zás pede uma delas com ?w=): poucas, para haver sempre cache. */
export const CHAT_WIDTHS = [480, 720, 1080] as const;
/** A largura do chat que serve um pedido (sobe para a mais próxima; acima de 1080 fica a de 1080). */
export const chatWidth = (w: number) => CHAT_WIDTHS.find((x) => x >= w) ?? CHAT_WIDTHS[CHAT_WIDTHS.length - 1];

function sniff(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'audio/webm';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  // MP3 com etiquetas ID3 ou a começar logo num quadro; AAC solto (ADTS: camada 00).
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return 'audio/aac';
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && ((buf[1] >> 1) & 3) !== 0) return 'audio/mpeg';
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
  private readonly log = new Logger('Media');
  /** Em que bucket vive cada tipo de ficheiro: conversas ficam no privado. */
  private scopeOf = (purpose: string): Scope => (purpose === 'chat' || purpose === 'music' ? 'private' : 'public');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
    private readonly imageModeration: ImageModerationService,
    private readonly video: VideoService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.dir = resolve(config.MEDIA_DIR);
    this.secret = config.JWT_ACCESS_SECRET;
    this.s3 = config.STORAGE_DRIVER === 's3' ? new S3Storage(config) : null;
    if (!this.s3) mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Analisa a imagem antes de ficar disponível. Devolve `true` se a foto deve ser recusada (nudez com prova: ver
   * image-moderation.service.ts); quem chama guarda-a como 'rejected' (keepRejected) e responde com rejectedError().
   * Na zona duvidosa passa, mas fica na fila da moderação. Uma foto que a moderação já aprovou num pedido de revisão
   * (a mesma, byte a byte, do mesmo dono) já não é recusada.
   */
  private async screen(id: string, owner: string, mime: string, bytes: () => Promise<Buffer>): Promise<boolean> {
    if (!mime.startsWith('image/') || !this.imageModeration.enabled) return false;
    const data = await bytes();
    const { verdict, score, reason } = await this.imageModeration.check(data, mime);
    await this.pool.query('UPDATE content.media_assets SET nsfw_score = $2 WHERE id = $1', [id, score]);
    if (verdict === 'reject') {
      const sha = createHash('sha256').update(data).digest();
      const approved = await this.pool.query('SELECT 1 FROM content.appeal_approved_photos WHERE owner_id = $1 AND sha256 = $2', [owner, sha]);
      if (!approved.rowCount) {
        await this.pool.query('UPDATE content.media_assets SET processing_error = $2, content_sha256 = $3 WHERE id = $1', [id, reason, sha]);
        return true;
      }
      return false;
    }
    if (verdict === 'review') {
      await this.pool.query(
        `INSERT INTO social.reports (id, reporter_id, target_type, target_id, target_user_id, reason, note)
         VALUES ($1, NULL, 'media', $2, $3, 'nudity', $4) ON CONFLICT DO NOTHING`,
        [uuidv7(), id, owner, `Verificação automática: ${reason ?? `classificador ${Math.round(score! * 100)}%`}`],
      );
    }
    return false;
  }

  /** As publicações guardadas (HeldPublicationsService), sem o importar (evita um ciclo entre módulos). */
  private held(): HeldPublicationsService | null {
    try {
      return this.moduleRef.get<HeldPublicationsService>(HELD_PUBLICATIONS, { strict: false });
    } catch {
      return null;
    }
  }

  /** A foto recusada fica guardada (ninguém a vê nem a pode usar) até 7 dias, ou até a moderação decidir o pedido de revisão. */
  private async keepRejected(id: string, size: number) {
    await this.pool.query(`UPDATE content.media_assets SET status = 'rejected', rejected_at = now(), size_bytes = $2 WHERE id = $1`, [id, size]);
  }

  /**
   * Na nuvem, guarda a foto recusada (já sem metadados) só no bucket privado e tira-a do público. Devolve false se não a
   * conseguiu guardar no privado. Se só a remoção do público falhar, tenta de novo; a foto fica guardada na mesma (o
   * endereço público só o dono o conhece e a API nunca o serve: não está 'ready'), e sai na limpeza (purgeFiles).
   */
  private async stashRejected(id: string, bytes: Buffer, mime: string, scope: Scope, size: number, cleaned: boolean): Promise<boolean> {
    const s3 = this.s3!;
    try {
      if (scope === 'public') await s3.put(id, bytes, mime, 'private', size);
      else if (cleaned) await s3.put(id, bytes, mime, scope, size);
    } catch (e) {
      if (scope === 'private') return true; // o original já está no privado (com metadados, mas ninguém o vê)
      this.log.error(`foto recusada ${id}: não consegui guardá-la no bucket privado: ${(e as Error).message}`);
      return false;
    }
    if (scope === 'public') {
      for (let i = 0; i < 3; i++) {
        try {
          await s3.remove(id, 'public');
          break;
        } catch (e) {
          if (i === 2) this.log.error(`foto recusada ${id}: não consegui tirá-la do bucket público: ${(e as Error).message}`);
        }
      }
    }
    return true;
  }

  /** O erro de uma foto recusada: a app mostra «Pedir revisão» (code + assetId). */
  private rejectedError(id: string) {
    return new UnprocessableEntityException({ statusCode: 422, error: 'Unprocessable Entity', message: REJECTED_PHOTO, code: 'nudity_rejected', assetId: id });
  }

  /**
   * «Pedir revisão» de uma foto recusada: só o dono, uma vez por foto, dentro de REJECTED_KEEP_DAYS dias, e no máximo
   * APPEALS_PER_DAY por dia. A foto vai para a fila da moderação (com o motivo da recusa) e fica guardada até à decisão.
   */
  async appeal(userId: string, id: string) {
    const { rows } = await this.pool.query(
      `SELECT status, processing_error, appealed_at, rejected_at < now() - make_interval(days => $3) AS expired
         FROM content.media_assets WHERE id = $1 AND owner_id = $2`,
      [id, userId, REJECTED_KEEP_DAYS],
    );
    const a = rows[0];
    if (!a || a.status !== 'rejected') throw new NotFoundException('Esta foto já não está à espera de revisão');
    if (a.appealed_at) throw new ConflictException('Já pediste a revisão desta foto. A moderação vai vê-la.');
    if (a.expired) throw new GoneException('Já passaram os 7 dias para pedir a revisão desta foto.');
    const today = (await this.pool.query(`SELECT count(*)::int AS n FROM content.media_assets WHERE owner_id = $1 AND appealed_at > now() - interval '1 day'`, [userId])).rows[0].n as number;
    if (today >= APPEALS_PER_DAY) throw new HttpException('Já pediste muitas revisões hoje. Tenta amanhã.', HttpStatus.TOO_MANY_REQUESTS);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const upd = await client.query(`UPDATE content.media_assets SET appealed_at = now() WHERE id = $1 AND status = 'rejected' AND appealed_at IS NULL`, [id]);
      if (!upd.rowCount) throw new ConflictException('Já pediste a revisão desta foto. A moderação vai vê-la.');
      await client.query(
        `INSERT INTO social.reports (id, reporter_id, target_type, target_id, target_user_id, reason, note)
         VALUES ($1, NULL, 'media', $2, $3, 'nudity', $4) ON CONFLICT DO NOTHING`,
        [uuidv7(), id, userId, `Pedido de revisão do dono (foto recusada; aprovar = dispensar) · ${a.processing_error ?? 'verificação automática'}`],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    return { status: 'rejected', appeal: 'pending' as const };
  }

  /**
   * A moderação aprovou uma foto recusada (já está 'ready' na base de dados): na nuvem, uma foto pública volta do bucket
   * privado para o público, com as larguras leves. No disco não há nada a fazer.
   */
  async releaseApproved(id: string) {
    // rejected_at fica até a foto estar de volta ao sítio: se falhar, a limpeza periódica (sweepDeleted) tenta de novo.
    const done = () => this.pool.query(`UPDATE content.media_assets SET rejected_at = NULL WHERE id = $1 AND status = 'ready'`, [id]);
    const { rows } = await this.pool.query(`SELECT purpose, mime FROM content.media_assets WHERE id = $1 AND status = 'ready'`, [id]);
    if (!this.s3 || rows[0]?.purpose !== 'public') {
      if (rows[0]) await done();
      return;
    }
    let last: unknown = null;
    for (let i = 0; i < 3; i++) {
      try {
        const bytes = await this.s3.read(id, 'private');
        await this.s3.put(id, bytes, rows[0].mime as string, 'public', bytes.length);
        await this.publishVariants(id, bytes);
        await this.s3.remove(id, 'private').catch(() => undefined); // fica no privado: sai na limpeza (purgeFiles)
        await done();
        return;
      } catch (e) {
        last = e;
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    throw last;
  }

  /** Apaga do armazenamento os ficheiros de contas eliminadas. Corre ao arrancar e de tempos a tempos. */
  /** Bytes de um ficheiro de conversa (privado), para o servidor tratar (por exemplo, miniaturas). */
  async chatBytes(id: string): Promise<Buffer> {
    const kept = this.fresh.get(id);
    if (kept) return kept;
    if (this.s3) return this.s3.read(id, 'private');
    return readFile(join(this.dir, id));
  }

  /**
   * Fotos do chat acabadas de chegar, em memória (poucas e pequenas): a miniatura e as larguras leves do Zás, feitas logo a
   * seguir, não voltam a descarregar o original do armazenamento.
   */
  private readonly fresh = new Map<string, Buffer>();
  private keepFresh(id: string, bytes: Buffer) {
    if (bytes.length > 3 * 1024 * 1024) return;
    this.fresh.delete(id);
    this.fresh.set(id, bytes);
    while (this.fresh.size > 24) this.fresh.delete(this.fresh.keys().next().value as string);
  }

  /** Larguras leves do chat que já se sabe existirem na nuvem (poupa a pergunta ao armazenamento). */
  private readonly chatVariantsMade = new Set<string>();

  /**
   * Garante a largura leve (WebP) de uma foto do chat: no disco, ao lado do original; na nuvem, no bucket privado.
   * Devolve false se não deu (a foto que o sharp não consegue reduzir serve-se original).
   */
  private async ensureChatVariant(id: string, w: number): Promise<boolean> {
    const key = `${id}.${w}.webp`;
    if (!this.s3) return (await this.variant({ path: join(this.dir, id), mime: 'image/jpeg' }, id, w)).mime === 'image/webp';
    if (this.chatVariantsMade.has(key)) return true;
    let job = this.making.get(key);
    if (!job) {
      const s3 = this.s3;
      job = (async () => {
        if (!(await s3.head(key, 'private'))) {
          const out = await sharp(await this.chatBytes(id)).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
          await s3.put(key, out, 'image/webp', 'private');
        }
        if (this.chatVariantsMade.size > 20_000) this.chatVariantsMade.clear();
        this.chatVariantsMade.add(key);
      })().finally(() => this.making.delete(key));
      this.making.set(key, job);
    }
    try {
      await job;
      return true;
    } catch {
      return false;
    }
  }

  /** Prepara já as larguras leves de uma foto do chat (o Zás, ao ser criado): quem o abrir recebe-as logo. Em segundo plano. */
  async prepareChatVariants(id: string, widths: readonly number[] = [720, 1080]) {
    for (const w of widths) await this.ensureChatVariant(id, chatWidth(w));
  }

  /** Dá um prazo ao ficheiro (depois dele é apagado). Usado nas mensagens de "ver uma vez". */
  async expireIn(id: string, minutes: number) {
    await this.pool.query(`UPDATE content.media_assets SET expires_at = now() + ($2::int * interval '1 minute') WHERE id = $1 AND status <> 'deleted'`, [id, minutes]);
  }

  async sweepDeleted(limit = 200) {
    // O prazo passou: o ficheiro passa a "apagado" e é removido logo a seguir.
    await this.pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE expires_at IS NOT NULL AND expires_at < now() AND status <> 'deleted'`);
    // Fotos recusadas: ao fim de REJECTED_KEEP_DAYS dias apagam-se, menos as que têm um pedido de revisão por decidir.
    await this.pool.query(
      `UPDATE content.media_assets a SET status = 'deleted'
        WHERE a.status = 'rejected' AND a.rejected_at < now() - make_interval(days => $1)
          AND NOT EXISTS (SELECT 1 FROM social.reports r WHERE r.target_type = 'media' AND r.target_id = a.id AND r.status = 'open')`,
      [REJECTED_KEEP_DAYS],
    );
    // Publicações guardadas há mais de 7 dias à espera da revisão: descartam-se (os outros ficheiros deixam de estar em uso).
    await this.held()?.expire();
    // Fotos aprovadas num pedido de revisão que ainda não voltaram ao bucket público (a cópia falhou): tenta de novo.
    const stuck = await this.pool.query(`SELECT id FROM content.media_assets WHERE status = 'ready' AND rejected_at IS NOT NULL AND appeal_decided_at IS NOT NULL LIMIT 20`);
    for (const r of stuck.rows) await this.releaseApproved(r.id as string).catch((e) => this.log.warn(`foto aprovada ${r.id} ainda não voltou ao bucket público: ${(e as Error).message}`));
    const { rows } = await this.pool.query(`SELECT id, purpose FROM content.media_assets WHERE status = 'deleted' AND purged_at IS NULL LIMIT $1`, [limit]);
    for (const r of rows) {
      await this.purgeFiles(r.id as string, r.purpose as string);
      await this.pool.query('UPDATE content.media_assets SET purged_at = now() WHERE id = $1', [r.id]);
    }
    return rows.length;
  }

  /** Tira do armazenamento tudo o que possa existir de um ficheiro (o original, o original por converter, as larguras, a capa e a cópia do som). */
  async purgeFiles(id: string, purpose: string) {
    if (this.s3) {
      const scope = this.scopeOf(purpose);
      // Em ambos os buckets (variantes, capa, original por converter).
      // Uma foto pública recusada (ou à espera de revisão) está no bucket privado.
      const jobs = [this.s3.remove(id, scope), ...(scope === 'public' ? [this.s3.remove(id, 'private')] : []), this.s3.remove(`${id}.src`, 'private'), this.s3.remove(`${id}${SOUND_COPY}`, 'private'), this.s3.remove(`${id}.poster.jpg`, 'public'), this.s3.remove(`${id}.poster.jpg`, 'private'), ...WIDTHS.map((w) => this.s3!.remove(`${id}.${w}.webp`, 'public'))];
      // As larguras leves das fotos do chat (as do Zás) ficam no privado, ao lado do original.
      if (scope === 'private') jobs.push(...CHAT_WIDTHS.map((w) => this.s3!.remove(`${id}.${w}.webp`, 'private')));
      await Promise.allSettled(jobs);
      this.fresh.delete(id);
      return;
    }
    await rm(join(this.dir, id), { force: true });
    await rm(join(this.dir, `${id}.src`), { force: true });
    await rm(join(this.dir, `${id}${SOUND_COPY}`), { force: true });
    await rm(join(this.dir, `${id}.poster.jpg`), { force: true });
    for (const w of WIDTHS) await rm(join(this.dir, `${id}.${w}.webp`), { force: true });
    this.fresh.delete(id);
  }

  /**
   * Trocar os bytes de um vídeo publicado (sons retirados: o mesmo vídeo sem a pista de áudio). A capa fica. Com `keepCopy`
   * guarda antes, de forma privada, o vídeo como estava (para o repor); a cópia sai com o ficheiro (sweepDeleted).
   */
  async replaceVideo(id: string, bytes: Buffer, keepCopy: Buffer | null = null) {
    if (keepCopy) {
      if (this.s3) await this.s3.put(`${id}${SOUND_COPY}`, keepCopy, 'video/mp4', 'private', keepCopy.length);
      else await writeFile(join(this.dir, `${id}${SOUND_COPY}`), keepCopy);
    }
    if (this.s3) await this.s3.put(id, bytes, 'video/mp4', 'public', bytes.length);
    else {
      await writeFile(join(this.dir, `${id}.tmp`), bytes);
      await rename(join(this.dir, `${id}.tmp`), join(this.dir, id));
    }
    await this.pool.query('UPDATE content.media_assets SET size_bytes = $2 WHERE id = $1', [id, bytes.length]);
  }

  /** Repor o vídeo guardado por `replaceVideo(…, keepCopy)`. false se não houver cópia. */
  async restoreVideoCopy(id: string): Promise<boolean> {
    let bytes: Buffer;
    try {
      bytes = this.s3 ? await this.s3.read(`${id}${SOUND_COPY}`, 'private') : await readFile(join(this.dir, `${id}${SOUND_COPY}`));
    } catch {
      return false;
    }
    await this.replaceVideo(id, bytes);
    if (this.s3) await this.s3.remove(`${id}${SOUND_COPY}`, 'private');
    else await rm(join(this.dir, `${id}${SOUND_COPY}`), { force: true });
    return true;
  }

  onModuleInit() {
    const run = () => this.sweepDeleted().catch(() => undefined);
    void run();
    setInterval(run, 10 * 60_000).unref();
  }

  async requestUpload(userId: string, mime: string, size: number, purpose: 'public' | 'chat' | 'music' = 'public', signed = false) {
    if (purpose === 'music') return this.requestMusicUpload(userId, normalizeMusicMime(mime), size);
    const audio = AUDIO.has(mime);
    const video = VIDEO.has(mime);
    if (!ALLOWED.has(mime) && !(audio && purpose === 'chat') && !video) throw new UnsupportedMediaTypeException('Apenas JPEG, PNG ou WebP (e vídeos MP4)');
    const max = audio ? MAX_AUDIO_BYTES : video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (!Number.isInteger(size) || size < 1 || size > max) {
      throw new PayloadTooLargeException(`Ficheiro até ${max / 1024 / 1024} MB`);
    }
    // Converter vídeo é pesado: no máximo 10 por hora e por pessoa (evita encher a fila de conversão).
    if (video) {
      const n = (await this.pool.query(`SELECT count(*)::int AS n FROM content.media_assets WHERE owner_id = $1 AND mime LIKE 'video/%' AND created_at > now() - interval '1 hour'`, [userId])).rows[0].n as number;
      if (n >= 10) throw new HttpException('Já enviaste muitos vídeos. Tenta daqui a um bocado.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const id = uuidv7();
    await this.pool.query(
      'INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, purpose, signed) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, userId, mime, size, `${id}`, purpose, signed],
    );
    // Na nuvem: conversas no bucket privado; vídeos entram como "original" no privado até serem verificados e convertidos.
    if (this.s3) return { assetId: id, uploadUrl: await this.s3.presignPut(video ? `${id}.src` : id, mime, size, UPLOAD_TTL_S, video || purpose === 'chat' ? 'private' : 'public') };
    const exp = Math.floor(Date.now() / 1000) + UPLOAD_TTL_S;
    return { assetId: id, uploadUrl: `/api/v1/media/${id}/upload?exp=${exp}&sig=${this.sign(id, exp)}` };
  }

  /**
   * Música do programa de artistas: só contas com o pedido de artista aprovado, só MP3/M4A/AAC até 20 MB, no máximo 20 por dia.
   * Fica no armazenamento privado: o original nunca é servido, só o trecho cortado no servidor (ver ArtistsService).
   */
  private async requestMusicUpload(userId: string, mime: string, size: number) {
    if (!MUSIC_AUDIO.has(mime)) throw new UnsupportedMediaTypeException('Envia a música em MP3, M4A ou AAC');
    if (!Number.isInteger(size) || size < 1 || size > MAX_MUSIC_BYTES) throw new PayloadTooLargeException(`Música até ${MAX_MUSIC_BYTES / 1024 / 1024} MB`);
    const ok = await this.pool.query(`SELECT 1 FROM content.artist_profiles WHERE user_id = $1 AND status = 'approved'`, [userId]);
    if (!ok.rowCount) throw new ForbiddenException('Só artistas aprovados podem carregar músicas');
    const n = (await this.pool.query(`SELECT count(*)::int AS n FROM content.media_assets WHERE owner_id = $1 AND purpose = 'music' AND created_at > now() - interval '1 day'`, [userId])).rows[0].n as number;
    if (n >= 20) throw new HttpException('Já carregaste muitas músicas hoje. Tenta amanhã.', HttpStatus.TOO_MANY_REQUESTS);
    const id = uuidv7();
    await this.pool.query(`INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, purpose) VALUES ($1, $2, $3, $4, $5, 'music')`, [id, userId, mime, size, id]);
    if (this.s3) return { assetId: id, uploadUrl: await this.s3.presignPut(id, mime, size, UPLOAD_TTL_S, 'private') };
    const exp = Math.floor(Date.now() / 1000) + UPLOAD_TTL_S;
    return { assetId: id, uploadUrl: `/api/v1/media/${id}/upload?exp=${exp}&sig=${this.sign(id, exp)}` };
  }

  /** Guarda um ficheiro gerado no servidor (o trecho de uma música), já pronto. */
  async storeDerived(ownerId: string, bytes: Buffer, mime: string, purpose: 'music', durationMs: number | null = null): Promise<string> {
    const id = uuidv7();
    if (this.s3) await this.s3.put(id, bytes, mime, this.scopeOf(purpose), bytes.length);
    else await writeFile(join(this.dir, id), bytes);
    await this.pool.query(
      `INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key, purpose, status, duration_ms) VALUES ($1, $2, $3, $4, $5, $6, 'ready', $7)`,
      [id, ownerId, mime, bytes.length, id, purpose, durationMs],
    );
    return id;
  }

  /**
   * URL assinado de uma música (o trecho). `review`: para a equipa ouvir uma faixa ainda por aprovar (ou o original).
   * Como no chat, a validade acaba no fim da próxima hora cheia (o URL não muda dentro dela).
   */
  musicUrl(id: string, review = false) {
    const exp = (Math.floor(Date.now() / 3_600_000) + 2) * 3600;
    return `/api/v1/music/local/audio/${id}?exp=${exp}${review ? '&r=1' : ''}&sig=${this.sign(`${review ? 'music-review' : 'music'}:${id}`, exp)}`;
  }

  /**
   * URL assinado do áudio de um som original (tirado de uma tcheka; ver docs/sons.md). Como na música, vale até ao fim da
   * próxima hora cheia. Quem pode ouvir (som não tirado pela equipa, conta ativa) decide o SoundsService.
   */
  soundUrl(id: string) {
    const exp = (Math.floor(Date.now() / 3_600_000) + 2) * 3600;
    return `/api/v1/sounds/audio/${id}?exp=${exp}&sig=${this.sign(`sound:${id}`, exp)}`;
  }

  /** Confere a assinatura do áudio de um som original e devolve onde está o ficheiro (privado, guardado como 'music'). */
  locateSound(id: string, exp: number, sig: string): Promise<Served> {
    return this.locateSigned(`sound:${id}`, id, exp, sig);
  }

  /** Confere a assinatura e devolve onde está o ficheiro. Quem pode ouvir (faixa aprovada, sem denúncia…) decide o ArtistsService. */
  locateMusic(id: string, exp: number, sig: string, review: boolean): Promise<Served> {
    return this.locateSigned(`${review ? 'music-review' : 'music'}:${id}`, id, exp, sig);
  }

  private async locateSigned(signed: string, id: string, exp: number, sig: string): Promise<Served> {
    const expected = Buffer.from(this.sign(signed, exp));
    const given = Buffer.from(sig ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given) || exp < Date.now() / 1000) throw new ForbiddenException('URL expirado');
    const { rows } = await this.pool.query(`SELECT mime FROM content.media_assets WHERE id = $1 AND status = 'ready' AND purpose = 'music'`, [id]);
    if (!rows[0]) throw new NotFoundException();
    if (this.s3) return { url: await this.s3.readUrl(id, { scope: 'private', ttlSeconds: 300 }) };
    return { path: join(this.dir, id), mime: rows[0].mime as string };
  }

  /**
   * O cliente avisa que o upload acabou. No disco local o ficheiro já foi validado no próprio envio;
   * no S3 confirma-se aqui o tamanho e o tipo real (primeiros bytes) antes de o ficheiro passar a 'ready'.
   */
  async complete(userId: string, id: string, posterMs?: number): Promise<{ status: string; error?: string }> {
    const { rows } = await this.pool.query('SELECT mime, size_bytes, status, processing_error, purpose FROM content.media_assets WHERE id = $1 AND owner_id = $2', [id, userId]);
    const a = rows[0];
    if (!a) throw new NotFoundException();
    if (a.status === 'deleted') return { status: 'deleted', error: a.processing_error ?? undefined };
    if (a.status === 'rejected') throw this.rejectedError(id);
    if (VIDEO.has(a.mime) && a.status === 'uploaded') {
      // O vídeo foi recebido: converte-se em segundo plano; a app pergunta pelo estado.
      await this.pool.query(`UPDATE content.media_assets SET status = 'processing' WHERE id = $1 AND status = 'uploaded'`, [id]);
      void this.video.enqueue(id, userId, undefined, posterMs);
      return { status: 'processing' };
    }
    if (a.status === 'ready' || a.status === 'processing') return { status: a.status };
    if (!this.s3) throw new NotFoundException(VIDEO.has(a.mime) ? 'O vídeo ainda não foi enviado' : 'O ficheiro ainda não foi enviado');
    const scope = this.scopeOf(a.purpose);
    if (VIDEO.has(a.mime)) return this.completeCloudVideo(userId, id, a.purpose === 'chat' ? 'private' : 'public', posterMs);
    const head = await this.s3.head(id, scope);
    if (!head) throw new NotFoundException('O ficheiro ainda não foi enviado');
    const limit = a.purpose === 'music' ? MAX_MUSIC_BYTES : AUDIO.has(a.mime) ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
    if (head.size < 1 || head.size > limit) {
      await this.s3.remove(id, scope);
      throw new PayloadTooLargeException('Ficheiro demasiado grande');
    }
    let bytes: Buffer | null = null;
    const read = async () => (bytes ??= await this.s3!.read(id, scope));
    // Fotos (até 8 MB): lê-se o ficheiro todo de uma vez e confere-se o tipo nele (menos uma ida ao armazenamento).
    if (sniff(a.mime.startsWith('image/') ? (await read()).subarray(0, 12) : await this.s3.firstBytes(id, scope)) !== a.mime) {
      await this.s3.remove(id, scope);
      throw new UnsupportedMediaTypeException('Conteúdo não corresponde ao tipo declarado');
    }
    const rejected = await this.screen(id, userId, a.mime, read);
    let size = head.size;
    if (a.mime.startsWith('image/')) {
      const clean = await stripImageMeta(await read(), a.mime, { fast: a.purpose === 'chat' });
      if (clean) {
        bytes = clean;
        size = clean.length;
      }
      // Recusada: guarda-se sem metadados no bucket privado (nunca no público, onde o endereço se abre sem sessão).
      if (rejected) {
        // A pessoa recebe sempre a mensagem da recusa (nunca um 500), mesmo que o armazenamento falhe aqui.
        if (await this.stashRejected(id, await read(), a.mime, scope, size, !!clean)) {
          await this.keepRejected(id, size);
          throw this.rejectedError(id);
        }
        // Não deu para a guardar no privado: apaga-se já (dos dois buckets) e não há pedido de revisão.
        await this.pool.query(`UPDATE content.media_assets SET status = 'deleted' WHERE id = $1`, [id]);
        void this.sweepDeleted();
        throw new UnprocessableEntityException('Esta foto parece mostrar nudez e não pode ser publicada.');
      }
      if (clean) await this.s3.put(id, clean, a.mime, scope, clean.length);
    }
    // Fotos públicas: gera já as versões leves (o telemóvel descarrega dezenas de KB, não vários MB).
    if (a.mime.startsWith('image/') && a.purpose === 'public') await this.publishVariants(id, await read());
    // Fotos do chat (o Zás): ficam uns instantes em memória para a miniatura e as larguras leves.
    if (a.mime.startsWith('image/') && a.purpose === 'chat') this.keepFresh(id, await read());
    await this.pool.query(`UPDATE content.media_assets SET status = 'ready', size_bytes = $2 WHERE id = $1`, [id, size]);
    return { status: 'ready' };
  }

  /** Gera e envia as larguras (WebP) de uma foto para o bucket público. */
  private async publishVariants(id: string, bytes: Buffer) {
    for (const w of WIDTHS) {
      try {
        const out = await sharp(bytes).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        await this.s3!.put(`${id}.${w}.webp`, out, 'image/webp', 'public');
      } catch {
        return; // imagem que o sharp não consegue reduzir: fica só o original
      }
    }
  }

  /** Vídeo na nuvem: valida o original (bucket privado), converte aqui e publica o resultado no bucket público. */
  /** `scope`: onde fica o vídeo pronto (público nas publicações; privado nas conversas). */
  private async completeCloudVideo(userId: string, id: string, scope: 'public' | 'private' = 'public', posterMs?: number): Promise<{ status: string }> {
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
        await s3.put(id, createReadStream(video), 'video/mp4', scope, (await stat(video)).size);
        await s3.put(`${id}.poster.jpg`, await readFile(poster), 'image/jpeg', scope);
        await s3.remove(src, 'private'); // o original não publicado deixa de existir
      },
      cleanup: async () => void (await Promise.allSettled([s3.remove(src, 'private'), s3.remove(id, scope), s3.remove(`${id}.poster.jpg`, scope)])),
    }, posterMs);
    return { status: 'processing' };
  }

  /** Os bytes de um ficheiro (para o assinar antes de o entregar). */
  async rawBytes(id: string, scope: 'public' | 'private' = 'public'): Promise<Buffer> {
    return this.s3 ? this.s3.read(id, scope) : readFile(join(this.dir, id));
  }

  /** Estado de um ficheiro (para a app esperar pela conversão do vídeo). */
  /**
   * Estado do ficheiro. Numa foto recusada, `appeal` diz se ainda se pode pedir revisão ('available'), se está à espera
   * da moderação ('pending') ou se o prazo passou ('expired'). Aprovada no pedido de revisão, a foto fica 'ready'.
   */
  async status(userId: string, id: string) {
    const { rows } = await this.pool.query(
      `SELECT status, processing_error, duration_ms, appealed_at, appeal_decided_at, rejected_at < now() - make_interval(days => $3) AS expired
         FROM content.media_assets WHERE id = $1 AND owner_id = $2`,
      [id, userId, REJECTED_KEEP_DAYS],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException();
    // A publicação guardada com o pedido de revisão (se houver): 'held' (à espera), 'published' (com o id), 'failed' (com o motivo)…
    const held = r.appealed_at ? await this.held()?.stateOf(id) : null;
    const h = held ? { held: { status: held.status, kind: held.kind, ...(held.resultId ? { id: held.resultId } : {}), ...(held.error ? { error: held.error } : {}) } } : {};
    if (r.status === 'rejected') return { status: 'rejected', error: REJECTED_PHOTO, appeal: r.appealed_at ? 'pending' : r.expired ? 'expired' : 'available', ...h };
    if (r.status === 'deleted' && r.appeal_decided_at) return { status: 'deleted', error: 'A moderação reviu esta foto e manteve a recusa.', ...h };
    if (held) return { status: r.status as string, ...h };
    return { status: r.status as string, error: (r.processing_error as string | null) ?? undefined, durationMs: (r.duration_ms as number | null) ?? undefined };
  }

  async receive(id: string, exp: number, sig: string, body: Readable) {
    if (this.s3) throw new NotFoundException();
    const expected = Buffer.from(this.sign(id, exp));
    const given = Buffer.from(sig ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given) || exp < Date.now() / 1000) {
      throw new ForbiddenException('URL de upload inválido ou expirado');
    }
    const { rows } = await this.pool.query('SELECT mime, size_bytes, status, owner_id, purpose FROM content.media_assets WHERE id = $1', [id]);
    const asset = rows[0];
    if (!asset || asset.status !== 'pending') throw new NotFoundException();

    const isVideo = VIDEO.has(asset.mime);
    // Vídeos ficam primeiro como original (.src) e só passam a 'ready' depois de convertidos.
    const path = isVideo ? this.video.paths(id).src : join(this.dir, id);
    let received = 0;
    let rejected = false;
    const limit = Math.min(Number(asset.size_bytes), isVideo ? MAX_VIDEO_BYTES : asset.purpose === 'music' ? MAX_MUSIC_BYTES : AUDIO.has(asset.mime) ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES);
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
        rejected = await this.screen(id, asset.owner_id, asset.mime, () => readFile(path));
        if (asset.mime.startsWith('image/')) {
          const clean = await stripImageMeta(await readFile(path), asset.mime, { fast: asset.purpose === 'chat' });
          if (clean) {
            await writeFile(path, clean);
            received = clean.length;
            if (asset.purpose === 'chat' && !rejected) this.keepFresh(id, clean);
          }
        }
      }
    } catch (e) {
      await rm(path, { force: true });
      throw e;
    }
    if (isVideo) {
      await this.pool.query(`UPDATE content.media_assets SET status = 'uploaded', size_bytes = $2 WHERE id = $1`, [id, received]);
      return { assetId: id };
    }
    // Recusada: o ficheiro (já sem metadados) fica no disco, mas só a moderação o vê (reviewImage), e só se houver pedido de revisão.
    if (rejected) {
      await this.keepRejected(id, received);
      throw this.rejectedError(id);
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
          await sharp(original.path).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toFile(tmp);
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

  /**
   * `width` (opcional, ?w= no URL): uma foto pede a largura leve (WebP 480/720/1080), como no visor do Zás. A assinatura
   * continua a ser a do ficheiro: a largura é só outra forma de o servir.
   */
  async locateChat(id: string, exp: number, sig: string, width?: number): Promise<Served> {
    const expected = Buffer.from(this.sign(`chat:${id}`, exp));
    const given = Buffer.from(sig ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given) || exp < Date.now() / 1000) throw new ForbiddenException('URL expirado');
    // A mensagem temporária deste ficheiro já expirou: deixa de se servir logo (a limpeza do chat apaga-o pouco depois).
    const { rows } = await this.pool.query(
      `SELECT a.mime FROM content.media_assets a WHERE a.id = $1 AND a.status = 'ready' AND a.purpose = 'chat'
          AND NOT EXISTS (SELECT 1 FROM social.messages m WHERE m.expires_at IS NOT NULL AND m.expires_at <= now() AND m.media_id = a.id)`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException();
    const w = width && Number.isFinite(width) && width > 0 && (rows[0].mime as string).startsWith('image/') ? chatWidth(width) : null;
    if (this.s3) {
      const key = w && (await this.ensureChatVariant(id, w)) ? `${id}.${w}.webp` : id;
      return { url: await this.s3.readUrl(key, { scope: 'private', ttlSeconds: 300 }) };
    }
    const original = { path: join(this.dir, id), mime: rows[0].mime as string };
    return w ? this.variant(original, id, w) : original;
  }

  /**
   * Foto assinalada para a equipa decidir (inclui fotos privadas de conversas). Só se vê enquanto houver uma queixa por decidir
   * sobre ela, e cada visualização fica no registo de auditoria. Também a foto de um Zás denunciado (0125), enquanto a
   * denúncia estiver por decidir.
   */
  async reviewImage(id: string, actorUserId: string): Promise<{ bytes: Buffer; mime: string }> {
    const { rows } = await this.pool.query(
      `SELECT a.mime, a.purpose, a.status FROM content.media_assets a
        WHERE a.id = $1 AND a.status IN ('ready', 'rejected') AND a.mime LIKE 'image/%'
          AND (EXISTS (SELECT 1 FROM social.reports r WHERE r.target_type = 'media' AND r.target_id = a.id AND r.status = 'open')
               OR EXISTS (SELECT 1 FROM social.instants i JOIN social.reports r ON r.target_type = 'instant' AND r.target_id = i.id AND r.status = 'open'
                           WHERE i.media_id = a.id))`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException();
    // Uma foto recusada (à espera da revisão) está sempre no bucket privado.
    const bytes = this.s3 ? await this.s3.read(id, rows[0].status === 'rejected' ? 'private' : this.scopeOf(rows[0].purpose as string)) : await readFile(join(this.dir, id));
    await this.pool.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actorUserId, 'moderation.view_media', `media:${id}`, { purpose: rows[0].purpose }]);
    return { bytes, mime: rows[0].mime as string };
  }

  /** Ficheiro da foto de perfil de uma pessoa, se tiver. */
  async avatarOf(username: string, width = 256): Promise<Served | null> {
    const { rows } = await this.pool.query(
      `SELECT m.id, m.mime FROM identity.users u JOIN content.media_assets m ON m.id = u.avatar_media_id
        WHERE u.username = $1 AND u.status = 'active' AND m.status = 'ready'`,
      [username],
    );
    if (!rows[0]) return null;
    const w = WIDTHS.find((x) => x >= width) ?? 256;
    if (this.s3) return { url: await this.s3.readUrl(`${rows[0].id}.${w}.webp`, { ttlSeconds: 3600 }) };
    // O avatar nunca precisa do original: serve-se uma versão reduzida (256 nas bolinhas, até 1080 ao abrir a foto).
    return this.variant({ path: join(this.dir, rows[0].id as string), mime: rows[0].mime as string }, rows[0].id as string, w);
  }

  private sign(id: string, exp: number) {
    return createHmac('sha256', this.secret).update(`${id}.${exp}`).digest('base64url');
  }
}

export function parseIdParam(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new BadRequestException('id inválido');
  return id;
}
