import { importPKCS8, SignJWT } from 'jose';
import { StoreError } from './apple';

/**
 * Google Play Developer API (androidpublisher v3), com a conta de serviço: JWT RS256 trocado por um token OAuth
 * (scope androidpublisher), sem SDK. Só o que as compras precisam: ler e consumir produtos, ler e confirmar subscrições.
 */

export interface GoogleServiceAccount { client_email: string; private_key: string }

/** Lê a conta de serviço: o JSON, ou o JSON em base64. Sem os campos certos devolve null. */
export function parseServiceAccount(raw: string | undefined): GoogleServiceAccount | null {
  if (!raw) return null;
  const t = raw.trim();
  for (const s of [t, (() => { try { return Buffer.from(t, 'base64').toString('utf8'); } catch { return ''; } })()]) {
    try {
      const j = JSON.parse(s) as Partial<GoogleServiceAccount>;
      if (j.client_email && j.private_key) return { client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, '\n') };
    } catch {
      /* tenta a seguinte */
    }
  }
  return null;
}

/** purchases.products.get */
export interface GoogleProductPurchase {
  orderId?: string;
  purchaseTimeMillis?: string;
  /** 0 comprado, 1 cancelado, 2 pendente. */
  purchaseState?: number;
  /** 0 por consumir, 1 consumido. */
  consumptionState?: number;
  /** 0 compra de teste, 1 promoção, 2 recompensa (ausente: compra normal). */
  purchaseType?: number;
  acknowledgementState?: number;
  obfuscatedExternalAccountId?: string;
  /** A app põe aqui o id da campanha (rascunho do Bombar) que esta compra paga. */
  obfuscatedExternalProfileId?: string;
  productId?: string;
  regionCode?: string;
  quantity?: number;
}

/** purchases.subscriptionsv2.get */
export interface GoogleSubscription {
  startTime?: string;
  regionCode?: string;
  subscriptionState?: string;
  latestOrderId?: string;
  linkedPurchaseToken?: string;
  acknowledgementState?: string;
  testPurchase?: Record<string, unknown>;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string; obfuscatedExternalProfileId?: string };
  lineItems?: { productId: string; expiryTime?: string; autoRenewingPlan?: { autoRenewEnabled?: boolean }; latestSuccessfulOrderId?: string }[];
}

export const GOOGLE_API = 'https://androidpublisher.googleapis.com';
export const GOOGLE_OAUTH = 'https://oauth2.googleapis.com/token';

export class GooglePlayApi {
  private cached: { token: string; exp: number } | null = null;
  private readonly origin: string;
  private readonly oauthUrl: string;

  constructor(private readonly sa: GoogleServiceAccount, readonly packageName: string, o: { origin?: string; oauthUrl?: string } = {}) {
    this.origin = o.origin ?? GOOGLE_API;
    this.oauthUrl = o.oauthUrl ?? GOOGLE_OAUTH;
  }

  private async accessToken(): Promise<string> {
    if (this.cached && this.cached.exp > Date.now() + 60_000) return this.cached.token;
    let assertion: string;
    try {
      const key = await importPKCS8(this.sa.private_key, 'RS256');
      const now = Math.floor(Date.now() / 1000);
      assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/androidpublisher' })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(this.sa.client_email)
        .setAudience(this.oauthUrl)
        .setIssuedAt(now)
        .setExpirationTime(now + 3000)
        .sign(key);
    } catch {
      throw new StoreError('A chave da conta de serviço da Google não é válida');
    }
    let res: Response;
    try {
      res = await fetch(this.oauthUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new StoreError(`OAuth da Google inacessível: ${(e as Error).message}`);
    }
    if (!res.ok) throw new StoreError(`OAuth da Google ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in?: number };
    this.cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  private base() {
    return `${this.origin}/androidpublisher/v3/applications/${encodeURIComponent(this.packageName)}/purchases`;
  }

  /** null: a Google não conhece esta compra (token errado, de outra app, ou inventado). */
  private async call<T>(method: 'GET' | 'POST', url: string): Promise<T | null> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${await this.accessToken()}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: '{}' } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError(`Google Play Developer API inacessível: ${(e as Error).message}`);
    }
    if (res.status === 400 || res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw new StoreError(`Google Play Developer API ${res.status}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  product(productId: string, token: string) {
    return this.call<GoogleProductPurchase>('GET', `${this.base()}/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`);
  }

  async consume(productId: string, token: string) {
    await this.call('POST', `${this.base()}/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:consume`);
  }

  subscription(token: string) {
    return this.call<GoogleSubscription>('GET', `${this.base()}/subscriptionsv2/tokens/${encodeURIComponent(token)}`);
  }

  async acknowledgeSubscription(productId: string, token: string) {
    await this.call('POST', `${this.base()}/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`);
  }
}
