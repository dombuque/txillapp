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
  /** O classificador da imagem inteira (dá a pontuação de 0 a 1). Sozinho nunca recusa. */
  NSFW_MODEL: z.string().default('AdamCodd/vit-base-nsfw-detector'),
  /** Onde ficam os modelos descarregados (o classificador e o detetor). Não vão dentro da imagem Docker. */
  MODEL_CACHE_DIR: z.string().default('./.models'),
  /**
   * O detetor de partes do corpo expostas: NudeNet v3.4 (AGPL-3.0, pesos oficiais sem alterações, descarregados na
   * 1.ª vez para MODEL_CACHE_DIR/nudenet). '640m' (100 MB, ~0,2 a 0,5 s por foto, mais certeiro), '320n' (12 MB, ~20 ms)
   * ou 'off' (sem detetor: nenhuma foto é recusada).
   */
  NUDE_DETECTOR: z.enum(['640m', '320n', 'off']).default('640m'),
  /** O detetor só corre quando o classificador dá pelo menos isto (abaixo, a foto passa logo e poupa-se o CPU). */
  NSFW_DETECT_THRESHOLD: z.coerce.number().min(0).max(1).default(0.3),
  /**
   * Recusar automaticamente? Só com prova: o detetor encontrou genitais, ânus ou mamilos femininos expostos com
   * confiança ≥ NUDE_REJECT_CONFIDENCE. O classificador sozinho nunca recusa (olha para a imagem inteira e erra em
   * selfies, roupa justa e peles escuras). Desligado ('false'), essas fotos passam e vão para a fila da moderação.
   */
  NSFW_AUTO_REJECT: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /**
   * Confiança do detetor para recusar (genitais, ânus, mamilos femininos expostos). Nas 245 fotos vestidas do teste de
   * justiça (todos os tons de pele, praia, ginásio, capulanas), a parte «proibida» mais forte que o detetor viu foi 0.53
   * (o peito de um homem): 0.6 deixa margem, e abaixo disto a foto ainda vai para a moderação.
   */
  NUDE_REJECT_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  /** Confiança do detetor para mandar para a moderação (essas partes com menos confiança, ou nádegas expostas). */
  NUDE_REVIEW_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.4),
  /** Para recusar, o classificador também tem de dar pelo menos isto (dupla prova; 0: basta o detetor). */
  NUDE_REJECT_MIN_NSFW: z.coerce.number().min(0).max(1).default(0.5),
  /**
   * O classificador sozinho, sem o detetor confirmar, manda a foto para a moderação a partir daqui (passa na mesma).
   * Muito alto de propósito: no teste de justiça, 12 % das fotos vestidas (praia, ginásio) passavam de 0.85; de 0.98, 4 %.
   */
  NSFW_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.98),
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
  /**
   * Fontes do catálogo de música (docs/musica.md). Sem elas, o catálogo usa só o ccMixter e o Internet Archive. As APIs da
   * Jamendo e do Freesound só são grátis para uso não comercial: ligar só depois do acordo comercial com cada uma.
   */
  JAMENDO_CLIENT_ID: z.preprocess(blankToUndefined, z.string().trim().min(4).optional()),
  FREESOUND_TOKEN: z.preprocess(blankToUndefined, z.string().trim().min(10).optional()),
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
   * Notificações da app no iPhone (APNs, direto à Apple). A chave .p8 de "Apple Push Notifications service": o conteúdo
   * (PEM, com `\n` numa linha, ou o ficheiro todo em base64) em APNS_KEY_P8, ou o caminho do ficheiro em APNS_KEY_PATH.
   * Sem chave, APNS_KEY_ID e APNS_TEAM_ID, o envio para o iPhone fica desligado (ver docs/lojas/apns.md).
   */
  APNS_KEY_P8: z.preprocess(blankToUndefined, z.string().optional()),
  APNS_KEY_PATH: z.preprocess(blankToUndefined, z.string().optional()),
  APNS_KEY_ID: z.preprocess(blankToUndefined, z.string().trim().optional()),
  APNS_TEAM_ID: z.preprocess(blankToUndefined, z.string().trim().optional()),
  APNS_BUNDLE_ID: z.preprocess(blankToUndefined, z.string().trim().default('com.txillapp.app')),
  /** true: api.push.apple.com (TestFlight e App Store); false: api.sandbox.push.apple.com (builds de desenvolvimento). */
  APNS_PRODUCTION: z.preprocess(blankToUndefined, z.enum(['true', 'false']).default('true').transform((v) => v === 'true')),
  /** Só para testes: outro servidor APNs (ex.: http://127.0.0.1:1234, HTTP/2 sem TLS). */
  APNS_ORIGIN: z.preprocess(blankToUndefined, z.string().url().optional()),
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
  /**
   * Recarregar Txills também nas versões das lojas (Google Play e App Store). Desligado por omissão: só se liga quando a
   * carteira cumprir as regras das lojas (ver docs/lojas/pagamentos-e-ugc.md). A app lê-o em GET /payments/config
   * (`storeTopup`), por isso liga e desliga sem versão nova.
   */
  PAYMENTS_STORE_TOPUP: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Segredo com que os fornecedores assinam os avisos de pagamento (webhooks). */
  PAYMENTS_WEBHOOK_SECRET: z.string().min(16).optional(),
  /**
   * Compras pela loja (só a verificação paga e o Bombar; ver docs/lojas/iap.md). Sem a configuração de uma loja, o
   * GET /iap/catalog dessa plataforma diz `enabled: false` e as rotas dela respondem 503.
   * Apple: a chave .p8 «In-App Purchase» do App Store Connect (PEM com `\n` numa linha, ou o ficheiro em base64).
   */
  /**
   * O interruptor geral das compras pela loja. Por omissão DESLIGADO, mesmo com credenciais: o catálogo diz
   * `enabled: false`, verify e restore respondem 503 e os avisos das lojas (notificações da Apple, RTDN da Google) só
   * ficam registados, sem aplicar direitos. Liga-se com IAP_ENABLED=true quando a app estiver na conta de programador própria.
   */
  IAP_ENABLED: z.preprocess(blankToUndefined, z.enum(['true', 'false']).default('false').transform((v) => v === 'true')),
  IAP_APPLE_ISSUER_ID: z.preprocess(blankToUndefined, z.string().trim().optional()),
  IAP_APPLE_KEY_ID: z.preprocess(blankToUndefined, z.string().trim().optional()),
  IAP_APPLE_KEY_P8: z.preprocess(blankToUndefined, z.string().optional()),
  IAP_APPLE_BUNDLE_ID: z.preprocess(blankToUndefined, z.string().trim().optional()),
  /** O ambiente das compras: 'Production' (App Store e TestFlight) ou 'Sandbox' (só testes). */
  IAP_APPLE_ENV: z.preprocess(blankToUndefined, z.enum(['Production', 'Sandbox']).default('Production')),
  /**
   * Em 'Production', aceitar também compras de sandbox (a App Review e o TestFlight compram em sandbox). Ficam marcadas
   * como Sandbox e fora das receitas no backoffice.
   */
  IAP_APPLE_ACCEPT_SANDBOX: z.preprocess(blankToUndefined, z.enum(['true', 'false']).default('true').transform((v) => v === 'true')),
  /** Só para testes: outro servidor para a App Store Server API, e outra raiz de confiança (PEM ou base64) em vez da Apple Root CA - G3. */
  IAP_APPLE_API_ORIGIN: z.preprocess(blankToUndefined, z.string().url().optional()),
  IAP_APPLE_ROOT_CA: z.preprocess(blankToUndefined, z.string().optional()),
  /** Google Play: a conta de serviço (o JSON, ou o JSON em base64) com acesso à Google Play Developer API. */
  IAP_GOOGLE_SERVICE_ACCOUNT_JSON: z.preprocess(blankToUndefined, z.string().optional()),
  /** O nome do pacote da app Android (ex.: com.txillapp.app). */
  IAP_GOOGLE_PACKAGE: z.preprocess(blankToUndefined, z.string().trim().optional()),
  /** O segredo no URL do push do Pub/Sub: POST /api/v1/iap/google/rtdn?token=… Sem ele, a rota responde 503. */
  IAP_GOOGLE_RTDN_TOKEN: z.preprocess(blankToUndefined, z.string().min(24, 'IAP_GOOGLE_RTDN_TOKEN deve ter pelo menos 24 caracteres').optional()),
  /** Só para testes: outro servidor para a Google Play Developer API e para o OAuth. */
  IAP_GOOGLE_API_ORIGIN: z.preprocess(blankToUndefined, z.string().url().optional()),
  IAP_GOOGLE_OAUTH_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  /** Os ids dos produtos nas lojas (iguais na App Store e no Google Play). */
  IAP_PRODUCT_VERIFY_MONTHLY: z.preprocess(blankToUndefined, z.string().trim().default('txillapp.verificado.mensal')),
  IAP_PRODUCT_VERIFY_YEARLY: z.preprocess(blankToUndefined, z.string().trim().default('txillapp.verificado.anual')),
  IAP_PRODUCT_BOOST_1D: z.preprocess(blankToUndefined, z.string().trim().default('txillapp.bombar.1d')),
  IAP_PRODUCT_BOOST_3D: z.preprocess(blankToUndefined, z.string().trim().default('txillapp.bombar.3d')),
  IAP_PRODUCT_BOOST_7D: z.preprocess(blankToUndefined, z.string().trim().default('txillapp.bombar.7d')),
  /** O raio fixo (km) de cada pacote do Bombar comprado na loja, como `1d:3,3d:3,7d:3` (o preço base dos pacotes cobre 3 km). */
  IAP_BOOST_RADIUS_KM: z.preprocess(blankToUndefined, z.string().regex(/^\s*\d+d\s*:\s*\d+\s*(,\s*\d+d\s*:\s*\d+\s*)*$/).default('1d:3,3d:3,7d:3')),
  /**
   * Preços de referência (em centavos de IAP_CURRENCY) para os totais do backoffice quando a loja não diz o valor
   * (a Google não diz; a Apple diz, e é esse que conta). Formato: `id_do_produto=centavos,…`.
   */
  IAP_PRICES: z.preprocess(blankToUndefined, z.string().default('txillapp.verificado.mensal=29900,txillapp.verificado.anual=299000,txillapp.bombar.1d=15000,txillapp.bombar.3d=40000,txillapp.bombar.7d=80000')),
  IAP_CURRENCY: z.preprocess(blankToUndefined, z.string().trim().regex(/^[A-Z]{3}$/).default('MZN')),
  /**
   * Música licenciada (comercial, de editoras ou de um agregador; ver docs/musica-licenciada.md). Por omissão DESLIGADA:
   * GET /music/licensed/status diz `enabled: false`, as outras rotas respondem 404 e faixas licenciadas já guardadas
   * aparecem sem música. Liga-se só com contrato assinado: MUSIC_LICENSED_ENABLED=true e um adaptador real.
   */
  MUSIC_LICENSED_ENABLED: z.preprocess(blankToUndefined, z.enum(['true', 'false']).default('false').transform((v) => v === 'true')),
  /** O adaptador do fornecedor: 'none' (nenhum ainda) ou 'fake' (catálogo simulado, só testes e desenvolvimento). */
  MUSIC_LICENSED_DRIVER: z.preprocess(blankToUndefined, z.enum(['none', 'fake']).default('none')),
  /** Credenciais do fornecedor real (ficam só no servidor; o adaptador real lê-as). */
  MUSIC_LICENSED_API_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  MUSIC_LICENSED_API_KEY: z.preprocess(blankToUndefined, z.string().min(8).optional()),
  /** Os países (ISO 3166, separados por vírgula) que o contrato cobre. Quem está fora não vê a música licenciada. */
  MUSIC_LICENSED_TERRITORIES: z.preprocess(blankToUndefined, z.string().regex(/^\s*[A-Za-z]{2}\s*(,\s*[A-Za-z]{2}\s*)*$/).default('MZ')),
  /** A duração máxima do excerto (segundos). Os contratos de vídeo curto ficam pelos 60 s. */
  MUSIC_LICENSED_CLIP_SECONDS: z.preprocess(blankToUndefined, z.coerce.number().int().min(5).max(60).default(60)),
  /** Montagem das tchekas no servidor (docs/montagem.md): quantas ao mesmo tempo (1 ou 2), o prazo de cada uma e os fios do ffmpeg (0 = todos). */
  COMPOSE_CONCURRENCY: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(2).default(1)),
  COMPOSE_TIMEOUT_S: z.preprocess(blankToUndefined, z.coerce.number().int().min(30).max(1800).default(480)),
  COMPOSE_THREADS: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(16).default(0)),
  /**
   * Prova de humano invisível (Cloudflare Turnstile) no registo, no «Esqueci-me da senha» e no login depois de algumas
   * falhas (ver src/security). Sem a chave secreta fica DESLIGADA. A chave do site (pública) vai na app como
   * EXPO_PUBLIC_TURNSTILE_SITEKEY. Chaves de teste oficiais da Cloudflare: 1x0000000000000000000000000000000AA (passa
   * sempre), 2x0000000000000000000000000000000AA (falha sempre).
   */
  TURNSTILE_SECRET: z.preprocess(blankToUndefined, z.string().trim().min(20).optional()),
  /**
   * A chave do site (pública), para o GET /auth/config a dar à app quando ela não a traz da compilação
   * (EXPO_PUBLIC_TURNSTILE_SITEKEY): assim o site e as APKs já instaladas ligam a prova sem compilar outra vez.
   */
  TURNSTILE_SITEKEY: z.preprocess(blankToUndefined, z.string().trim().regex(/^[A-Za-z0-9_-]{10,100}$/).optional()),
  /** Só para testes: outro endereço de verificação. */
  TURNSTILE_VERIFY_URL: z.preprocess(blankToUndefined, z.string().url().default('https://challenges.cloudflare.com/turnstile/v0/siteverify')),
  /**
   * Na app nativa: 'optional' (por omissão; as versões antigas, sem a prova, entram na mesma com limites mais apertados e
   * mais pontos de risco) ou 'required' (quando todas as versões em uso já a mandam). No browser é sempre obrigatória.
   */
  TURNSTILE_NATIVE: z.preprocess(blankToUndefined, z.enum(['optional', 'required']).default('optional')),
  /** Hashes de senha (argon2) ao mesmo tempo e à espera; os seguintes recebem 503 sem gastar CPU. */
  ARGON2_CONCURRENCY: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(16).default(2)),
  ARGON2_QUEUE: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(1000).default(40)),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppConfig = z.infer<typeof schema>;

/** Com STORAGE_DRIVER=s3 as credenciais são obrigatórias (falha ao arrancar, não no primeiro upload). */
function validateStorage(c: AppConfig) {
  if (c.NODE_ENV === 'production' && c.PAYMENTS_SANDBOX) throw new Error('Configuração inválida: PAYMENTS_SANDBOX não pode estar ligado em produção');
  if (!!c.SMTP_USER !== !!c.SMTP_PASS) throw new Error('Configuração inválida: SMTP_USER e SMTP_PASS têm de vir os dois (ou nenhum)');
  // A raiz de confiança e os servidores falsos das lojas são só para testes: em produção, nunca.
  if (c.NODE_ENV === 'production') {
    const testOnly = (['IAP_APPLE_ROOT_CA', 'IAP_APPLE_API_ORIGIN', 'IAP_GOOGLE_API_ORIGIN', 'IAP_GOOGLE_OAUTH_URL'] as const).filter((k) => c[k]);
    if (testOnly.length) throw new Error(`Configuração inválida: ${testOnly.join(', ')} só existe para testes (não pode estar definido em produção)`);
    if (c.MUSIC_LICENSED_DRIVER === 'fake') throw new Error('Configuração inválida: MUSIC_LICENSED_DRIVER=fake só existe para testes (não pode estar definido em produção)');
  }
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
