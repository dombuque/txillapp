import { importPKCS8, SignJWT } from 'jose';

/** Envio para a app nativa pelo Firebase Cloud Messaging (API HTTP v1), com a conta de serviço do projeto Firebase. */
interface ServiceAccount { project_id: string; client_email: string; private_key: string }

/** O que se envia a um aparelho. Sem as opções novas, a mensagem fica exatamente como sempre foi. */
export interface FcmPush {
  title: string;
  body: string;
  url: string;
  tag?: string;
  /** Dados extra para a app (só texto). */
  data?: Record<string, string>;
  /** Android: só dados, sem o bloco `notification` (a app desenha a notificação; precisa disto para os botões Atender e Recusar). */
  dataOnly?: boolean;
  /** Canal no Android (por omissão 'txillapp'). */
  channel?: string;
  /** Categoria de ações (Android `categoryId`, iOS `aps.category`), ex.: 'call'. */
  actionCategory?: string;
  /** Validade do aviso, em segundos (por omissão a do FCM). */
  ttlSeconds?: number;
  /** iOS: som e nível de interrupção (ex.: 'ring.wav' e 'time-sensitive'). */
  ios?: { sound?: string; interruptionLevel?: 'passive' | 'active' | 'time-sensitive' | 'critical' };
}

/** Monta a mensagem do FCM (API HTTP v1). Separado do envio para se poder testar sem rede. */
export function buildFcmMessage(token: string, m: FcmPush, platform: 'android' | 'ios' = 'android'): Record<string, unknown> {
  const ttl = m.ttlSeconds ? { ttl: `${m.ttlSeconds}s` } : {};
  // Android só com dados: tudo vai em `data` (o Expo lê `title` e `message`, não `body`).
  if (m.dataOnly && platform === 'android') {
    return {
      token,
      data: {
        ...(m.data ?? {}),
        title: m.title,
        message: m.body,
        channelId: m.channel ?? 'txillapp',
        ...(m.actionCategory ? { categoryId: m.actionCategory } : {}),
        ...(m.tag ? { tag: m.tag } : {}),
        url: m.url,
      },
      android: { priority: 'HIGH', ...ttl },
    };
  }
  const apns =
    m.ttlSeconds || m.ios || m.actionCategory
      ? {
          apns: {
            headers: { 'apns-priority': '10', ...(m.ttlSeconds ? { 'apns-expiration': String(Math.floor(Date.now() / 1000) + m.ttlSeconds) } : {}) },
            payload: {
              aps: {
                ...(m.actionCategory ? { category: m.actionCategory } : {}),
                ...(m.ios?.sound ? { sound: m.ios.sound } : {}),
                ...(m.ios?.interruptionLevel ? { 'interruption-level': m.ios.interruptionLevel } : {}),
              },
            },
          },
        }
      : {};
  return {
    token,
    notification: { title: m.title, body: m.body },
    data: { ...(m.data ?? {}), url: m.url, ...(m.tag ? { tag: m.tag } : {}) },
    android: { priority: 'HIGH', ...ttl, notification: { channel_id: m.channel ?? 'txillapp', ...(m.tag ? { tag: m.tag } : {}) } },
    ...apns,
  };
}

export class FcmSender {
  private readonly acct: ServiceAccount | null;
  private token: { value: string; exp: number } | null = null;

  constructor(json: string | undefined) {
    let a: ServiceAccount | null = null;
    try {
      if (json) a = JSON.parse(json) as ServiceAccount;
    } catch {
      a = null;
    }
    this.acct = a && a.project_id && a.client_email && a.private_key ? a : null;
  }

  get enabled() {
    return !!this.acct;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const a = this.acct!;
    const key = await importPKCS8(a.private_key, 'RS256');
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(a.client_email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(now)
      .setExpirationTime(now + 3000)
      .sign(key);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new Error(`token FCM ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  /** Devolve 'dead' se o código do aparelho já não existe (para o apagar). */
  async send(deviceToken: string, m: FcmPush, platform: 'android' | 'ios' = 'android'): Promise<'ok' | 'dead' | 'error'> {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.acct!.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: buildFcmMessage(deviceToken, m, platform) }),
    });
    if (res.ok) return 'ok';
    if (res.status === 404 || res.status === 400) {
      const t = await res.text();
      if (/UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/.test(t)) return 'dead';
    }
    return 'error';
  }
}
