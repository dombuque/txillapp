import { createReadStream, existsSync } from 'fs';
import { copyFile, readFile, stat } from 'fs/promises';
import { join, resolve } from 'path';
import type { Readable } from 'stream';
import type { AppConfig } from '../config';
import { S3Storage } from '../media/s3.storage';

/**
 * Os ficheiros que o fim de tcheka gera (o vídeo com a música, a cópia guardada), no armazenamento de sempre: o disco
 * (MEDIA_DIR, como o MediaService) ou o S3, no bucket do `scope`. Os ids são os de content.media_assets.
 */
export class TchekaStorage {
  private readonly dir: string;
  private readonly s3: S3Storage | null;

  constructor(config: AppConfig) {
    this.dir = resolve(config.MEDIA_DIR);
    this.s3 = config.STORAGE_DRIVER === 's3' ? new S3Storage(config) : null;
  }

  /** Guarda um ficheiro local com a chave `key`. Devolve o tamanho. */
  async put(key: string, file: string, mime: string, scope: 'public' | 'private'): Promise<number> {
    const size = (await stat(file)).size;
    if (this.s3) await this.s3.put(key, createReadStream(file), mime, scope, size);
    else await copyFile(file, join(this.dir, key));
    return size;
  }

  /** A capa de um vídeo passa também para outro (o vídeo com a música mostra a mesma capa). */
  async copyPoster(from: string, to: string): Promise<void> {
    if (this.s3) {
      const bytes = await this.s3.read(`${from}.poster.jpg`, 'public').catch(() => null);
      if (bytes) await this.s3.put(`${to}.poster.jpg`, bytes, 'image/jpeg', 'public');
      return;
    }
    const src = join(this.dir, `${from}.poster.jpg`);
    if (existsSync(src)) await copyFile(src, join(this.dir, `${to}.poster.jpg`));
  }

  /** Para servir: no disco um stream (com o tamanho), no S3 os bytes. */
  async open(key: string, scope: 'public' | 'private'): Promise<{ stream: Readable; size: number } | { bytes: Buffer }> {
    if (this.s3) return { bytes: await this.s3.read(key, scope) };
    const path = join(this.dir, key);
    const size = (await stat(path)).size;
    return { stream: createReadStream(path), size };
  }

  async bytes(key: string, scope: 'public' | 'private'): Promise<Buffer> {
    return this.s3 ? this.s3.read(key, scope) : readFile(join(this.dir, key));
  }
}
