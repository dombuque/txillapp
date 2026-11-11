import { z } from 'zod';

/** Uma variável vazia (ex.: `GIPHY_API_KEY=` no .env) conta como não definida. */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET deve ter pelo menos 32 caracteres'),
  PORT: z.coerce.number().default(3000),
  MEDIA_DIR: z.string().default('./uploads'),
  /** ID de cliente OAuth da Google (público). Sem ele, o login com Google fica desligado. */
  GOOGLE_CLIENT_ID: z.string().min(10).optional(),
  /** Identificadores aceites no Iniciar sessão com a Apple (bundle ID da app e/ou ID do serviço web), separados por vírgula. Sem ele fica desligado. */
  APPLE_CLIENT_ID: z.string().min(3).optional(),
  /** Onde ficam as fotos e gravações: 'local' (disco, desenvolvimento) ou 's3' (S3, Cloudflare R2, MinIO…). */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** Bucket PÚBLICO (domínio com leitura aberta, ex.: media.txillapp.com). */
  S3_BUCKET: z.string().optional(),
  /** Bucket PRIVADO (conversas e vídeos por verificar). Obrigatório se existir S3_PUBLIC_URL. */
  S3_PRIVATE_BUCKET: z.string().optional(),
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
  /** SuperTxill (a IA do chat). Sem ANTHROPIC_API_KEY responde só que ainda está a acordar. O modelo e os limites mudam-se aqui, sem mexer no código. */
  ANTHROPIC_API_KEY: z.string().min(20).optional(),
  SUPERTXILL_MODEL: z.string().default('claude-opus-5-5'),
  /** Respostas por pessoa e por dia (UTC). */
  SUPERTXILL_DAILY_LIMIT: z.coerce.number().int().min(1).max(500).default(20),
  /** Respostas por mês, em toda a app: o teto do custo. */
  SUPERTXILL_MONTHLY_CAP: z.coerce.number().int().min(1).max(1_000_000).default(3000),
  /**
   * GIFs do GIPHY (chat e comentários). Sem a chave, os GIFs ficam escondidos na app e /gifs/* responde { enabled: false }.
   * A chave fica só no servidor: a app pesquisa através de /api/v1/gifs (o GIPHY não vê quem pesquisa).
   */
  GIPHY_API_KEY: z.preprocess(blankToUndefined, z.string().trim().min(10).optional()),
  /** O canal do Txillapp no GIPHY (o nome de utilizador, sem o @) para o separador "Txillapp" do painel dos GIFs. Opcional. */
  GIPHY_CHANNEL: z.preprocess((v) => blankToUndefined(typeof v === 'string' ? v.trim().replace(/^@/, '') : v), z.string().regex(/^[A-Za-z0-9_.-]{2,50}$/).optional()),
  /** Chaves VAPID (notificações no telemóvel). Sem elas as notificações push ficam desligadas. Gera com: npx web-push generate-vapid-keys */
  VAPID_PUBLIC_KEY: z.string().min(20).optional(),
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  /** Contacto do remetente das notificações. O iPhone recusa domínios que não existem (como .local). */
  VAPID_SUBJECT: z.string().default('mailto:suporte@txillapp.com'),
  /**
   * E-mail (confirmação de conta e recuperação de senha). Sem SMTP_USER e SMTP_PASS fica tudo desligado.
   * Zoho: smtp.zoho.com, porta 465, utilizador = a caixa e senha = "palavra-passe de aplicação".
   */
  SMTP_HOST: z.string().default('smtp.zoho.com'),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Txillapp <suporte@txillapp.com>'),
  /** Endereço público da app, usado nos links dos e-mails. */
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  /** Onde fica o backoffice (para as ligações de convite da equipa). Sem isto usa o PUBLIC_URL. */
  ADMIN_URL: z.string().url().optional(),
  /** Conta de serviço do Firebase (JSON numa linha) para as notificações da app Android. Sem isto, só há push web. */
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  /**
   * Chamadas (WebRTC). Servidores TURN para quando a ligação direta não passa (redes móveis, firewalls), separados por vírgula,
   * ex.: turn:turn.txillapp.com:3478?transport=udp,turns:turn.txillapp.com:5349. Com TURN_SECRET (o mesmo `static-auth-secret`
   * do coturn) a app recebe credenciais temporárias. Sem os dois, só há STUN.
   */
  TURN_URLS: z.string().optional(),
  TURN_SECRET: z.string().min(8).optional(),
  /** Quantos segundos uma chamada toca antes de ficar perdida. */
  CALL_RING_SECONDS: z.coerce.number().int().min(1).max(300).default(45),
  /** Só para testes: guarda os e-mails em memória em vez de os enviar. */
  MAIL_CAPTURE: z.enum(['true', 'false']).default('false'),
  /**
   * Pagamentos de teste: com 'true' existe um fornecedor "sandbox" que confirma pagamentos sem dinheiro a sério (só desenvolvimento
   * e testes; é recusado em produção). Os fornecedores reais (M-Pesa, e-Mola, cartão) ligam-se com as respetivas chaves.
   */
  PAYMENTS_SANDBOX: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Segredo com que os fornecedores assinam os avisos de pagamento (webhooks). */
  PAYMENTS_WEBHOOK_SECRET: z.string().min(16).optional(),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppConfig = z.infer<typeof schema>;

/** Com STORAGE_DRIVER=s3 as credenciais são obrigatórias (falha ao arrancar, não no primeiro upload). */
function validateStorage(c: AppConfig) {
  if (c.NODE_ENV === 'production' && c.PAYMENTS_SANDBOX) throw new Error('Configuração inválida: PAYMENTS_SANDBOX não pode estar ligado em produção');
  if (!!c.SMTP_USER !== !!c.SMTP_PASS) throw new Error('Configuração inválida: SMTP_USER e SMTP_PASS têm de vir os dois (ou nenhum)');
  if (c.SEARCH_BACKEND === 'elasticsearch' && !c.ELASTICSEARCH_URL) throw new Error('Configuração inválida: SEARCH_BACKEND=elasticsearch precisa de ELASTICSEARCH_URL');
  if (c.STORAGE_DRIVER === 's3') {
    const missing = (['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const).filter((k) => !c[k]);
    if (missing.length) throw new Error(`Configuração inválida: STORAGE_DRIVER=s3 precisa de ${missing.join(', ')}`);
    // Com leitura pública no bucket principal, as conversas NÃO podem ir para lá.
    if (c.S3_PUBLIC_URL && !c.S3_PRIVATE_BUCKET) throw new Error('Configuração inválida: com S3_PUBLIC_URL é obrigatório S3_PRIVATE_BUCKET (um bucket sem leitura pública para as conversas)');
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
