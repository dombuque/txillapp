import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfig } from '../config';

/**
 * Onde fica cada ficheiro:
 *  • 'public'  → bucket com leitura pública (CDN, ex.: media.txillapp.com): fotos, capas e vídeos já aprovados;
 *  • 'private' → bucket SEM leitura pública: conversas (fotos e voz) e vídeos acabados de enviar, antes da verificação.
 * Nunca se mistura: tudo o que está no bucket público é legível por quem souber o endereço.
 */
export type Scope = 'public' | 'private';

/**
 * Armazenamento compatível com S3 (AWS S3, Cloudflare R2, MinIO…). O cliente envia os bytes
 * directamente para o bucket, por um URL pré-assinado e temporário; o servidor só valida e regista.
 */
export class S3Storage {
  private readonly client: S3Client;
  private readonly buckets: Record<Scope, string>;
  private readonly publicBase: string | null;

  constructor(c: AppConfig) {
    this.buckets = { public: c.S3_BUCKET!, private: c.S3_PRIVATE_BUCKET ?? c.S3_BUCKET! };
    this.publicBase = c.S3_PUBLIC_URL ? c.S3_PUBLIC_URL.replace(/\/$/, '') : null;
    this.client = new S3Client({
      region: c.S3_REGION,
      endpoint: c.S3_ENDPOINT,
      forcePathStyle: c.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: c.S3_ACCESS_KEY_ID!, secretAccessKey: c.S3_SECRET_ACCESS_KEY! },
      // Chaves de validação extra só quando o serviço as exige (R2/MinIO não precisam).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /** URL de upload: o tipo e o tamanho ficam assinados, por isso não dá para enviar outra coisa. */
  presignPut(key: string, mime: string, size: number, ttlSeconds: number, scope: Scope = 'public') {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.buckets[scope], Key: key, ContentType: mime, ContentLength: size }), { expiresIn: ttlSeconds });
  }

  async head(key: string, scope: Scope = 'public'): Promise<{ size: number } | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.buckets[scope], Key: key }));
      return { size: Number(r.ContentLength ?? 0) };
    } catch {
      return null;
    }
  }

  /** Os primeiros bytes (para confirmar o tipo real do ficheiro). */
  async firstBytes(key: string, scope: Scope = 'public', n = 12): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.buckets[scope], Key: key, Range: `bytes=0-${n - 1}` }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async read(key: string, scope: Scope = 'public'): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.buckets[scope], Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  /** Envia um ficheiro que o servidor gerou (variantes de foto, vídeo convertido, capa). */
  async put(key: string, body: Buffer | Uint8Array | import('stream').Readable, mime: string, scope: Scope = 'public', size?: number) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.buckets[scope], Key: key, Body: body, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable', ...(size ? { ContentLength: size } : {}) }),
    );
  }

  /** Leitura pública (CDN) só para o bucket público; senão um URL assinado de curta duração. */
  async readUrl(key: string, opts: { scope?: Scope; ttlSeconds: number }) {
    const scope = opts.scope ?? 'public';
    if (scope === 'public' && this.publicBase) return `${this.publicBase}/${key}`;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.buckets[scope], Key: key }), { expiresIn: opts.ttlSeconds });
  }

  async remove(key: string, scope: Scope = 'public') {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.buckets[scope], Key: key }));
  }
}
