import { KeyObject, generateKeyPairSync, randomBytes, sign, verify } from 'crypto';
import { AddressInfo } from 'net';
import { IncomingMessage, Server, ServerResponse, createServer } from 'http';

/**
 * Só para os testes: uma «Apple» e uma «Google» falsas.
 * - Certificados X.509 feitos aqui mesmo (DER à mão, com o `crypto` do Node): raiz -> intermédio -> folha, com as
 *   extensões da Apple, para assinar JWS como a App Store.
 * - Um servidor HTTP com a App Store Server API, o OAuth da Google e a Google Play Developer API.
 */

/* ───────────── ASN.1 / DER mínimo ───────────── */

const len = (n: number) => (n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]));
const tlv = (tag: number, ...content: Buffer[]) => { const c = Buffer.concat(content); return Buffer.concat([Buffer.from([tag]), len(c.length), c]); };
const seq = (...c: Buffer[]) => tlv(0x30, ...c);
const set = (...c: Buffer[]) => tlv(0x31, ...c);
const int = (b: Buffer) => tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
const oid = (s: string) => {
  const [a, b, ...rest] = s.split('.').map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const parts: number[] = [];
    let v = n;
    do { parts.unshift(v & 0x7f); v = Math.floor(v / 128); } while (v > 0);
    for (let i = 0; i < parts.length - 1; i++) parts[i] |= 0x80;
    out.push(...parts);
  }
  return tlv(0x06, Buffer.from(out));
};
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
const octet = (b: Buffer) => tlv(0x04, b);
const bits = (b: Buffer) => tlv(0x03, Buffer.from([0]), b);
const explicit = (n: number, c: Buffer) => tlv(0xa0 + n, c);
const utc = (d: Date) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const name = (cn: string) => seq(set(seq(oid('2.5.4.3'), utf8(cn))));
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));

export const APPLE_LEAF_OID = '1.2.840.113635.100.6.11.1';
export const APPLE_INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1';

export interface TestCert { der: Buffer; key: KeyObject; pub: KeyObject; cn: string }

/** Um certificado X.509 v3 (ECDSA P-256 / SHA-256) assinado por `issuer` (ou por si próprio). */
export function makeCert(o: { cn: string; issuer?: TestCert; ca: boolean; ext?: string[]; notBefore?: Date; notAfter?: Date }): TestCert {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const exts = [
    seq(oid('2.5.29.19'), tlv(0x01, Buffer.from([0xff])), octet(o.ca ? seq(tlv(0x01, Buffer.from([0xff]))) : seq())),
    ...(o.ext ?? []).map((x) => seq(oid(x), octet(Buffer.from([0x05, 0x00])))),
  ];
  const tbs = seq(
    explicit(0, int(Buffer.from([2]))),
    int(randomBytes(8)),
    ECDSA_SHA256,
    name(o.issuer?.cn ?? o.cn),
    seq(utc(o.notBefore ?? new Date(Date.now() - 86_400_000)), utc(o.notAfter ?? new Date(Date.now() + 365 * 86_400_000))),
    name(o.cn),
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, seq(...exts)),
  );
  const sig = sign('sha256', tbs, o.issuer?.key ?? privateKey);
  return { der: seq(tbs, ECDSA_SHA256, bits(sig)), key: privateKey, pub: publicKey, cn: o.cn };
}

export const pem = (der: Buffer) => `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;

/** Uma cadeia como a da App Store: raiz -> intermédio (WWDR) -> folha; `sign` faz uma JWS ES256 com o x5c. */
export function appleChain(label = 'Teste') {
  const root = makeCert({ cn: `Raiz ${label}`, ca: true });
  const inter = makeCert({ cn: `Intermedio ${label}`, issuer: root, ca: true, ext: [APPLE_INTERMEDIATE_OID] });
  const leaf = makeCert({ cn: `Folha ${label}`, issuer: inter, ca: false, ext: [APPLE_LEAF_OID] });
  const x5c = [leaf, inter, root].map((c) => c.der.toString('base64'));
  return {
    rootPem: pem(root.der),
    sign(payload: unknown, header: Record<string, unknown> = {}) {
      const h = Buffer.from(JSON.stringify({ alg: 'ES256', x5c, ...header })).toString('base64url');
      const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const s = sign('sha256', Buffer.from(`${h}.${p}`), { key: leaf.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return `${h}.${p}.${s}`;
    },
  };
}

/* ───────────── servidor falso das duas lojas ───────────── */

export interface FakeAppleSub { status: number; signedTransactionInfo: string; signedRenewalInfo?: string; originalTransactionId: string }

export class FakeStores {
  readonly appleKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  readonly googleKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  readonly packageName = 'com.txillapp.teste';
  readonly bundleId = 'com.txillapp.teste';
  /** Apple: transactionId -> JWS da transação; transactionId (qualquer da subscrição) -> estados. */
  appleTx = new Map<string, string>();
  appleSubs = new Map<string, FakeAppleSub[]>();
  /** Google: token -> compra de produto / subscrição. */
  googleProducts = new Map<string, Record<string, unknown>>();
  googleSubs = new Map<string, Record<string, unknown>>();
  consumed: string[] = [];
  acked: string[] = [];
  calls: string[] = [];
  private server?: Server;
  origin = '';

  get appleP8() {
    return this.appleKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }

  get serviceAccountJson() {
    return JSON.stringify({ type: 'service_account', client_email: 'iap@teste.iam.gserviceaccount.com', private_key: this.googleKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  }

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res).catch(() => { res.statusCode = 500; res.end(); }));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', () => r()));
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }

  private json(res: ServerResponse, status: number, body?: unknown) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(body === undefined ? '' : JSON.stringify(body));
  }

  /** Confere um JWT (ES256 da Apple ou RS256 da Google) com a chave pública certa. */
  private jwtOk(token: string, pub: KeyObject, alg: 'ES256' | 'RS256', check: (p: Record<string, unknown>) => boolean) {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return false;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    if (header.alg !== alg) return false;
    const ok = verify('sha256', Buffer.from(`${h}.${p}`), alg === 'ES256' ? { key: pub, dsaEncoding: 'ieee-p1363' } : pub, Buffer.from(s, 'base64url'));
    return ok && check(JSON.parse(Buffer.from(p, 'base64url').toString()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.origin);
    const path = decodeURIComponent(url.pathname);
    this.calls.push(`${req.method} ${path}`);
    const body = await new Promise<string>((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');

    // ---- OAuth da Google ----
    if (path === '/token' && req.method === 'POST') {
      const assertion = new URLSearchParams(body).get('assertion') ?? '';
      const ok = this.jwtOk(assertion, this.googleKey.publicKey, 'RS256', (p) => p.iss === 'iap@teste.iam.gserviceaccount.com' && String(p.scope).includes('androidpublisher'));
      return ok ? this.json(res, 200, { access_token: 'token-google-teste', expires_in: 3600, token_type: 'Bearer' }) : this.json(res, 401, { error: 'invalid_grant' });
    }

    // ---- App Store Server API ----
    if (path.startsWith('/inApps/v1/')) {
      const ok = this.jwtOk(bearer, this.appleKey.publicKey, 'ES256', (p) => p.aud === 'appstoreconnect-v1' && p.bid === this.bundleId && p.iss === 'issuer-teste');
      if (!ok) return this.json(res, 401, { errorCode: 4010000 });
      let m = /^\/inApps\/v1\/transactions\/(.+)$/.exec(path);
      if (m) return this.appleTx.has(m[1]) ? this.json(res, 200, { signedTransactionInfo: this.appleTx.get(m[1]) }) : this.json(res, 404, { errorCode: 4040010 });
      m = /^\/inApps\/v1\/subscriptions\/(.+)$/.exec(path);
      if (m) {
        const last = this.appleSubs.get(m[1]);
        return last ? this.json(res, 200, { environment: 'Sandbox', bundleId: this.bundleId, data: [{ subscriptionGroupIdentifier: '1', lastTransactions: last }] }) : this.json(res, 404, { errorCode: 4040010 });
      }
      return this.json(res, 404, {});
    }

    // ---- Google Play Developer API ----
    const base = `/androidpublisher/v3/applications/${this.packageName}/purchases`;
    if (path.startsWith('/androidpublisher/')) {
      if (bearer !== 'token-google-teste') return this.json(res, 401, {});
      let m = new RegExp(`^${base}/products/([^/]+)/tokens/([^/:]+)(:consume)?$`).exec(path);
      if (m) {
        const p = this.googleProducts.get(m[2]);
        if (!p || p.productId !== m[1]) return this.json(res, 400, { error: { message: 'Invalid Value' } });
        if (m[3]) { p.consumptionState = 1; this.consumed.push(m[2]); return this.json(res, 204); }
        return this.json(res, 200, p);
      }
      m = new RegExp(`^${base}/subscriptionsv2/tokens/([^/]+)$`).exec(path);
      if (m) return this.googleSubs.has(m[1]) ? this.json(res, 200, this.googleSubs.get(m[1])) : this.json(res, 400, { error: { message: 'Invalid Value' } });
      m = new RegExp(`^${base}/subscriptions/([^/]+)/tokens/([^/:]+):acknowledge$`).exec(path);
      if (m) {
        const s = this.googleSubs.get(m[2]);
        if (!s) return this.json(res, 400, {});
        s.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
        this.acked.push(m[2]);
        return this.json(res, 204);
      }
    }
    return this.json(res, 404, {});
  }
}
