import {
  BadRequestException, Inject, Injectable, NotFoundException, PayloadTooLargeException,
  UnsupportedMediaTypeException, ForbiddenException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { createWriteStream, mkdirSync } from 'fs';
import { open, rm } from 'fs/promises';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const UPLOAD_TTL_S = 300;

function sniff(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Armazenamento local (MVP/dev). O fluxo é o de um upload pré-assinado: o cliente pede um URL
 * temporário e envia os bytes directamente para esse URL. Trocar por S3/R2 só muda o URL devolvido.
 */
@Injectable()
export class MediaService {
  private readonly dir: string;
  private readonly secret: string;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.dir = resolve(config.MEDIA_DIR);
    this.secret = config.JWT_ACCESS_SECRET;
    mkdirSync(this.dir, { recursive: true });
  }

  async requestUpload(userId: string, mime: string, size: number) {
    if (!ALLOWED.has(mime)) throw new UnsupportedMediaTypeException('Apenas JPEG, PNG ou WebP');
    if (!Number.isInteger(size) || size < 1 || size > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException(`Imagem até ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    }
    const id = uuidv7();
    await this.pool.query(
      'INSERT INTO content.media_assets (id, owner_id, mime, size_bytes, storage_key) VALUES ($1, $2, $3, $4, $5)',
      [id, userId, mime, size, `${id}`],
    );
    const exp = Math.floor(Date.now() / 1000) + UPLOAD_TTL_S;
    return { assetId: id, uploadUrl: `/api/v1/media/${id}/upload?exp=${exp}&sig=${this.sign(id, exp)}` };
  }

  async receive(id: string, exp: number, sig: string, body: Readable) {
    const expected = Buffer.from(this.sign(id, exp));
    const given = Buffer.from(sig ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given) || exp < Date.now() / 1000) {
      throw new ForbiddenException('URL de upload inválido ou expirado');
    }
    const { rows } = await this.pool.query('SELECT mime, size_bytes, status FROM content.media_assets WHERE id = $1', [id]);
    const asset = rows[0];
    if (!asset || asset.status !== 'pending') throw new NotFoundException();

    const path = join(this.dir, id);
    let received = 0;
    const limit = Math.min(Number(asset.size_bytes), MAX_IMAGE_BYTES);
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
      if (sniff(head) !== asset.mime) throw new UnsupportedMediaTypeException('Conteúdo não corresponde ao tipo declarado');
    } catch (e) {
      await rm(path, { force: true });
      throw e;
    }
    await this.pool.query(`UPDATE content.media_assets SET status = 'ready', size_bytes = $2 WHERE id = $1`, [id, received]);
    return { assetId: id };
  }

  async locate(id: string) {
    const { rows } = await this.pool.query(`SELECT mime FROM content.media_assets WHERE id = $1 AND status = 'ready'`, [id]);
    if (!rows[0]) throw new NotFoundException();
    return { path: join(this.dir, id), mime: rows[0].mime as string };
  }

  private sign(id: string, exp: number) {
    return createHmac('sha256', this.secret).update(`${id}.${exp}`).digest('base64url');
  }
}

export function parseIdParam(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new BadRequestException('id inválido');
  return id;
}
