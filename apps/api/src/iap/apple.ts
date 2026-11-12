import { KeyObject, X509Certificate, sign, verify } from 'crypto';
import { parseApnsKey } from '../push/apns';

/**
 * Apple: verificar as JWS da App Store (transações, renovações e avisos V2) e falar com a App Store Server API.
 * Só com o `crypto` do Node: a cadeia do x5c é verificada certificado a certificado até à Apple Root CA - G3.
 */

/** Apple Root CA - G3 (https://www.apple.com/certificateauthority/AppleRootCA-G3.cer). SHA-256 63:34:3A:BF:…:3E:91:79. */
export const APPLE_ROOT_CA_G3 = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

/** As extensões que a Apple põe nos certificados que assinam a App Store (como pede a documentação). */
const LEAF_OID = Buffer.from('060a2a864886f76364060b01', 'hex'); // 1.2.840.113635.100.6.11.1 (Mac App Store Receipt Signing)
const INTERMEDIATE_OID = Buffer.from('060a2a864886f76364060201', 'hex'); // 1.2.840.113635.100.6.2.1 (WWDR intermediate)

export class JwsError extends Error {}

/** Lê a raiz de confiança: PEM, ou o PEM/DER em base64. */
export function parseRootCa(raw: string): X509Certificate {
  const text = raw.trim().replace(/\\n/g, '\n');
  if (text.includes('-----BEGIN')) return new X509Certificate(text);
  const buf = Buffer.from(text.replace(/\s+/g, ''), 'base64');
  const s = buf.toString('utf8');
  return new X509Certificate(s.includes('-----BEGIN') ? s : buf);
}

const b64json = (s: string) => {
  try {
    return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new JwsError('JWS mal formada');
  }
};

/**
 * Verifica uma JWS da App Store e devolve o conteúdo. Recusa se:
 * - o algoritmo não for ES256 ou o cabeçalho não trouxer a cadeia x5c;
 * - um certificado da cadeia não tiver sido emitido e assinado pelo seguinte, estiver fora da validade, ou um
 *   intermédio não for uma CA;
 * - a cadeia não acabar numa raiz de confiança (a Apple Root CA - G3, ou a dos testes);
 * - o certificado da folha ou o intermédio não tiverem as extensões da Apple;
 * - a assinatura não bater com a chave da folha.
 */
export function verifyAppleJws<T = Record<string, unknown>>(jws: string, roots: X509Certificate[], now: Date = new Date()): T {
  if (typeof jws !== 'string' || jws.length > 64_000) throw new JwsError('JWS inválida');
  const parts = jws.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new JwsError('JWS mal formada');
  const header = b64json(parts[0]);
  if (header.alg !== 'ES256') throw new JwsError('Algoritmo da JWS não suportado');
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length < 2 || x5c.length > 5 || x5c.some((c) => typeof c !== 'string')) throw new JwsError('A JWS não traz a cadeia de certificados');
  let chain: X509Certificate[];
  try {
    chain = (x5c as string[]).map((c) => new X509Certificate(Buffer.from(c, 'base64')));
  } catch {
    throw new JwsError('Certificado inválido na JWS');
  }
  const t = now.getTime();
  const inDate = (c: X509Certificate) => new Date(c.validFrom).getTime() <= t && t <= new Date(c.validTo).getTime();
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i];
    if (!inDate(c)) throw new JwsError('Certificado da JWS fora da validade');
    if (i > 0 && !c.ca) throw new JwsError('Certificado intermédio não é uma CA');
    if (i < chain.length - 1 && !(c.checkIssued(chain[i + 1]) && c.verify(chain[i + 1].publicKey))) throw new JwsError('A cadeia de certificados não confere');
  }
  // O fim da cadeia: ou é uma das raízes de confiança, ou foi emitido e assinado por uma delas.
  const last = chain[chain.length - 1];
  const trusted = roots.some((r) => r.fingerprint256 === last.fingerprint256 && r.raw.equals(last.raw))
    || roots.some((r) => inDate(r) && last.checkIssued(r) && last.verify(r.publicKey));
  if (!trusted) throw new JwsError('A JWS não foi assinada pela Apple');
  if (!chain[0].raw.includes(LEAF_OID)) throw new JwsError('O certificado da JWS não é o da App Store');
  if (!chain[1].raw.includes(INTERMEDIATE_OID)) throw new JwsError('O intermédio da JWS não é o da Apple');
  const ok = verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: chain[0].publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new JwsError('Assinatura da JWS inválida');
  return b64json(parts[1]) as T;
}

/** O que interessa de uma transação (JWSTransactionDecodedPayload). As datas vêm em milissegundos. */
export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  type?: string;
  purchaseDate?: number;
  originalPurchaseDate?: number;
  expiresDate?: number;
  quantity?: number;
  appAccountToken?: string;
  inAppOwnershipType?: string;
  signedDate?: number;
  revocationDate?: number;
  revocationReason?: number;
  environment: 'Sandbox' | 'Production' | 'Xcode' | 'LocalTesting';
  transactionReason?: 'PURCHASE' | 'RENEWAL';
  storefront?: string;
  /** Preço em milésimos da moeda (ex.: 299000 = 299,00). */
  price?: number;
  currency?: string;
  webOrderLineItemId?: string;
}

/** O que interessa da renovação (JWSRenewalInfoDecodedPayload). */
export interface AppleRenewal {
  originalTransactionId?: string;
  productId?: string;
  autoRenewProductId?: string;
  autoRenewStatus?: 0 | 1;
  expirationIntent?: number;
  gracePeriodExpiresDate?: number;
  isInBillingRetryPeriod?: boolean;
  environment?: string;
}

/** Aviso V2 (responseBodyV2DecodedPayload). */
export interface AppleNotification {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  version?: string;
  signedDate?: number;
  data?: { bundleId?: string; environment?: string; signedTransactionInfo?: string; signedRenewalInfo?: string; status?: number; appAppleId?: number };
}

export const APPLE_API_PRODUCTION = 'https://api.storekit.itunes.apple.com';
export const APPLE_API_SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com';

export class StoreError extends Error {}

/** App Store Server API, com a chave .p8 «In-App Purchase» (JWT ES256: kid, iss = Issuer ID, aud = appstoreconnect-v1, bid). */
export class AppleStoreApi {
  private readonly key: KeyObject;
  private cached: { token: string; exp: number } | null = null;

  constructor(private readonly o: { issuerId: string; keyId: string; keyP8: string; bundleId: string; origin?: string }) {
    try {
      this.key = parseApnsKey(o.keyP8);
    } catch {
      throw new Error('a chave IAP_APPLE_KEY_P8 não é uma chave .p8 válida (EC P-256)');
    }
  }

  token(nowSec = Math.floor(Date.now() / 1000)): string {
    if (this.cached && this.cached.exp > nowSec + 60) return this.cached.token;
    const b64 = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
    const exp = nowSec + 30 * 60;
    const input = `${b64({ alg: 'ES256', kid: this.o.keyId, typ: 'JWT' })}.${b64({ iss: this.o.issuerId, iat: nowSec, exp, aud: 'appstoreconnect-v1', bid: this.o.bundleId })}`;
    const sig = sign('sha256', Buffer.from(input), { key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    this.cached = { token: `${input}.${sig}`, exp };
    return this.cached.token;
  }

  private async get(path: string, env: string): Promise<Record<string, unknown> | null> {
    const origin = this.o.origin ?? (env === 'Sandbox' ? APPLE_API_SANDBOX : APPLE_API_PRODUCTION);
    let res: Response;
    try {
      res = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${this.token()}` }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new StoreError(`App Store Server API inacessível: ${(e as Error).message}`);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new StoreError(`App Store Server API ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  /** Get Transaction Info: a transação como a Apple a tem agora (com o reembolso, se houver). */
  async transaction(transactionId: string, env: string): Promise<string | null> {
    const r = await this.get(`/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, env);
    return (r?.signedTransactionInfo as string | undefined) ?? null;
  }

  /** Get All Subscription Statuses: o estado da subscrição (1 ativa, 2 expirou, 3 a tentar cobrar, 4 período de graça, 5 revogada). */
  async subscription(transactionId: string, env: string): Promise<{ status: number; signedTransactionInfo: string; signedRenewalInfo?: string; originalTransactionId: string }[] | null> {
    const r = await this.get(`/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`, env);
    if (!r) return null;
    const groups = (r.data as { lastTransactions?: { status: number; signedTransactionInfo: string; signedRenewalInfo?: string; originalTransactionId: string }[] }[] | undefined) ?? [];
    return groups.flatMap((g) => g.lastTransactions ?? []);
  }
}
