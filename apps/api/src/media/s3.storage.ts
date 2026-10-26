import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfig } from '../config';

/**
 * Armazenamento compatível com S3 (AWS S3, Cloudflare R2, MinIO…). O cliente envia os bytes
 * directamente para o bucket, por um URL pré-assinado e temporário; o servidor só valida e regista.
 */
export class S3Storage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string | null;

  constructor(c: AppConfig) {
    this.bucket = c.S3_BUCKET!;
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
  presignPut(key: string, mime: string, size: number, ttlSeconds: number) {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mime, ContentLength: size }), { expiresIn: ttlSeconds });
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0) };
    } catch {
      return null;
    }
  }

  /** Os primeiros bytes (para confirmar o tipo real do ficheiro). */
  async firstBytes(key: string, n = 12): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${n - 1}` }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async read(key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  /** Leitura pública (CDN/bucket público) se configurada; senão um URL assinado de curta duração. */
  async readUrl(key: string, opts: { publicOk: boolean; ttlSeconds: number }) {
    if (opts.publicOk && this.publicBase) return `${this.publicBase}/${key}`;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: opts.ttlSeconds });
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
