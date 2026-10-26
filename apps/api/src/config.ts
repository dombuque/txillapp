import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET deve ter pelo menos 32 caracteres'),
  PORT: z.coerce.number().default(3000),
  MEDIA_DIR: z.string().default('./uploads'),
  /** ID de cliente OAuth da Google (público). Sem ele, o login com Google fica desligado. */
  GOOGLE_CLIENT_ID: z.string().min(10).optional(),
  /** Onde ficam as fotos e gravações: 'local' (disco, desenvolvimento) ou 's3' (S3, Cloudflare R2, MinIO…). */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Endereço público de leitura (CDN ou bucket público) para fotos de posts, stories e perfis. Sem ele usam-se URLs assinados. */
  S3_PUBLIC_URL: z.string().url().optional(),
  /**
   * Verificação automática de fotos (nudez / conteúdo sexual). 'local' corre um modelo no próprio servidor
   * (nada sai daqui); 'off' desliga (só desenvolvimento). Ver a secção "Fotos" do README.
   */
  IMAGE_MODERATION: z.enum(['off', 'local']).default('off'),
  NSFW_MODEL: z.string().default('AdamCodd/vit-base-nsfw-detector'),
  MODEL_CACHE_DIR: z.string().default('./.models'),
  /** A partir daqui a foto é recusada. */
  NSFW_REJECT_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  /** A partir daqui a foto passa mas fica na fila da moderação. */
  NSFW_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  /**
   * Pesquisa: 'postgres' (texto completo + nomes aproximados, por omissão) ou 'elasticsearch' (índice próprio, mais
   * relevância e tolerância a erros). O Elasticsearch só ordena; a privacidade continua a ser decidida pelo PostgreSQL.
   */
  SEARCH_BACKEND: z.enum(['postgres', 'elasticsearch']).default('postgres'),
  ELASTICSEARCH_URL: z.string().url().optional(),
  ELASTICSEARCH_API_KEY: z.string().optional(),
  ELASTICSEARCH_INDEX_PREFIX: z.string().regex(/^[a-z0-9_-]{1,40}$/).default('txillapp'),
  /** Se definido, /api/v1/metrics (Prometheus) fica disponível com este token. */
  METRICS_TOKEN: z.string().min(16).optional(),
  /** Chaves VAPID (notificações no telemóvel). Sem elas as notificações push ficam desligadas. Gera com: npx web-push generate-vapid-keys */
  VAPID_PUBLIC_KEY: z.string().min(20).optional(),
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@txillapp.local'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppConfig = z.infer<typeof schema>;

/** Com STORAGE_DRIVER=s3 as credenciais são obrigatórias (falha ao arrancar, não no primeiro upload). */
function validateStorage(c: AppConfig) {
  if (c.SEARCH_BACKEND === 'elasticsearch' && !c.ELASTICSEARCH_URL) throw new Error('Configuração inválida: SEARCH_BACKEND=elasticsearch precisa de ELASTICSEARCH_URL');
  if (c.STORAGE_DRIVER === 's3') {
    const missing = (['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const).filter((k) => !c[k]);
    if (missing.length) throw new Error(`Configuração inválida: STORAGE_DRIVER=s3 precisa de ${missing.join(', ')}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida: ${msg}`);
  }
  validateStorage(parsed.data);
  return parsed.data;
}

export const CONFIG = Symbol('CONFIG');
