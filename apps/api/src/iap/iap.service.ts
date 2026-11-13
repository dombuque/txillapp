import {
  BadGatewayException, BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, OnModuleInit,
  ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException,
} from '@nestjs/common';
import { X509Certificate, timingSafeEqual } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { BoostsService } from '../boosts/boosts.service';
import { Scheduler } from '../realtime/scheduler';
import { uuidv7 } from '../common/uuid7';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import {
  APPLE_ROOT_CA_G3, AppleNotification, AppleRenewal, AppleStoreApi, AppleTransaction, JwsError, StoreError, parseRootCa, verifyAppleJws,
} from './apple';
import { GooglePlayApi, GoogleSubscription, parseServiceAccount } from './google';
import { IapProducts, ProductInfo, iapProducts, productInfo } from './iap-config';
import { syncPaidVerification } from './paid-verification';

export type Store = 'apple' | 'google';
export type PurchaseStatus = 'active' | 'expired' | 'refunded' | 'revoked' | 'consumed';
type Env = 'Production' | 'Sandbox';
type Row = Record<string, any>;

/** Uma compra como a loja a vê agora, já no formato comum às duas lojas. */
interface StorePurchase {
  store: Store;
  product: ProductInfo;
  transactionId: string | null;
  originalTransactionId: string | null;
  purchaseToken: string | null;
  orderId: string | null;
  environment: Env;
  status: Exclude<PurchaseStatus, 'consumed'>;
  expiresAt: Date | null;
  autoRenew: boolean | null;
  /** A conta que a loja diz (iOS appAccountToken, Android obfuscatedExternalAccountId). */
  owner: string | null;
  raw: Record<string, unknown>;
  /** A transação que esta leitura trouxe (compra ou renovação), para contar uma só vez. */
  tx: { type: 'purchase' | 'renewal'; ref: string; amountMinor: number | null; currency: string | null } | null;
  /** Google: o token antigo que esta subscrição substitui (mudança de plano). */
  replacesToken?: string | null;
  /** Google: a campanha que a app pôs na compra (obfuscatedExternalProfileId), para confirmar que é a do rascunho. */
  campaignHint?: string | null;
}

interface RecordOpts { actor: string | null; via: 'verify' | 'restore' | 'notification' | 'sweep'; campaignId?: string; notification?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ms = (v: unknown) => (v === undefined || v === null || v === '' ? null : new Date(Number(v)));

/**
 * Compras pela loja (App Store e Google Play): só a verificação paga (subscrição) e o Bombar (consumíveis).
 *
 * Regras:
 * - Nunca se confia na app: a JWS da Apple é verificada pela cadeia até à Apple Root CA - G3 e depois lida outra vez na
 *   App Store Server API; o token da Google é lido na Google Play Developer API.
 * - Cada transação é creditada uma só vez (índices únicos por loja e transactionId / original / purchaseToken / orderId).
 * - O comprador tem de ser quem tem a sessão: iOS `appAccountToken` = uuid da conta; Android `obfuscatedExternalAccountId` = uuid.
 * - Tudo fica em audit.audit_log.
 * - IAP_ENABLED=false (por omissão): catálogo desligado, verify/restore com 503, avisos das lojas só registados.
 */
@Injectable()
export class IapService implements OnModuleInit {
  private readonly log = new Logger('IAP');
  readonly products: IapProducts;
  private readonly apple: { api: AppleStoreApi; roots: X509Certificate[]; bundleId: string } | null = null;
  private readonly google: { api: GooglePlayApi; packageName: string } | null = null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly boosts: BoostsService,
    private readonly scheduler: Scheduler,
  ) {
    this.products = iapProducts(cfg);
    if (cfg.IAP_APPLE_ISSUER_ID && cfg.IAP_APPLE_KEY_ID && cfg.IAP_APPLE_KEY_P8 && cfg.IAP_APPLE_BUNDLE_ID) {
      try {
        const api = new AppleStoreApi({ issuerId: cfg.IAP_APPLE_ISSUER_ID, keyId: cfg.IAP_APPLE_KEY_ID, keyP8: cfg.IAP_APPLE_KEY_P8, bundleId: cfg.IAP_APPLE_BUNDLE_ID, origin: cfg.IAP_APPLE_API_ORIGIN });
        const roots = [parseRootCa(cfg.IAP_APPLE_ROOT_CA ?? APPLE_ROOT_CA_G3)];
        this.apple = { api, roots, bundleId: cfg.IAP_APPLE_BUNDLE_ID };
      } catch (e) {
        this.log.warn(`compras na App Store desligadas: ${(e as Error).message}`);
      }
    }
    const sa = parseServiceAccount(cfg.IAP_GOOGLE_SERVICE_ACCOUNT_JSON);
    if (cfg.IAP_GOOGLE_SERVICE_ACCOUNT_JSON && !sa) this.log.warn('compras no Google Play desligadas: IAP_GOOGLE_SERVICE_ACCOUNT_JSON não é uma conta de serviço válida');
    if (sa && cfg.IAP_GOOGLE_PACKAGE) {
      this.google = { api: new GooglePlayApi(sa, cfg.IAP_GOOGLE_PACKAGE, { origin: cfg.IAP_GOOGLE_API_ORIGIN, oauthUrl: cfg.IAP_GOOGLE_OAUTH_URL }), packageName: cfg.IAP_GOOGLE_PACKAGE };
    }
  }

  onModuleInit() {
    if (!this.cfg.IAP_ENABLED) return;
    // De meia em meia hora: as subscrições que já passaram da data são confirmadas na loja (renovou? expirou?).
    this.scheduler.every('iap.sweep', 30 * 60_000, () => this.sweep());
  }

  /** A loja desta plataforma está ligada (interruptor geral E credenciais)? */
  enabled(store: Store) {
    return this.cfg.IAP_ENABLED && (store === 'apple' ? !!this.apple : !!this.google);
  }

  private requireApple() {
    if (!this.enabled('apple')) throw new ServiceUnavailableException('As compras na App Store não estão disponíveis');
    return this.apple!;
  }

  private requireGoogle() {
    if (!this.enabled('google')) throw new ServiceUnavailableException('As compras no Google Play não estão disponíveis');
    return this.google!;
  }

  private product(id: string) {
    const p = productInfo(this.products, id);
    if (!p) throw new BadRequestException('Produto desconhecido');
    return p;
  }

  private refPrice(productId: string) {
    return this.products.prices.get(productId) ?? null;
  }

  private audit(c: Pool | PoolClient, actor: string | null, action: string, target: string, metadata: Record<string, unknown>) {
    return c.query('INSERT INTO audit.audit_log (id, actor_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)', [uuidv7(), actor, action, target, metadata]);
  }

  private storeCall<T>(p: Promise<T>): Promise<T> {
    return p.catch((e) => {
      if (e instanceof StoreError) throw new BadGatewayException('A loja não respondeu. Tenta outra vez daqui a pouco.');
      throw e;
    });
  }

  /* ───────────── catálogo ───────────── */

  async catalog(userId: string, platform: 'ios' | 'android') {
    const store: Store = platform === 'ios' ? 'apple' : 'google';
    const [pv, active] = await Promise.all([
      this.pool.query('SELECT eligible_at FROM payments.paid_verification WHERE user_id = $1', [userId]),
      this.pool.query(
        `SELECT product_id, expires_at, auto_renew FROM payments.iap_purchases
          WHERE user_id = $1 AND kind = 'subscription' AND status = 'active' AND expires_at > now() ORDER BY expires_at DESC LIMIT 1`,
        [userId],
      ),
    ]);
    const a = active.rows[0];
    return {
      enabled: this.enabled(store),
      verification: {
        products: this.products.verification.map((p) => ({ id: p.id, period: p.period })),
        eligible: !!pv.rows[0]?.eligible_at,
        active: a ? { productId: a.product_id as string, expiresAt: new Date(a.expires_at as string).toISOString(), autoRenew: !!a.auto_renew } : null,
      },
      boost: { products: this.products.boost.map((p) => ({ id: p.id, days: p.days, radiusKm: p.radiusKm })) },
    };
  }

  /* ───────────── Apple ───────────── */

  private appleEnvOk(env: string | undefined): env is Env {
    if (this.cfg.IAP_APPLE_ENV === 'Sandbox') return env === 'Sandbox';
    return env === 'Production' || (env === 'Sandbox' && this.cfg.IAP_APPLE_ACCEPT_SANDBOX);
  }

  private jws<T>(token: string): T {
    try {
      return verifyAppleJws<T>(token, this.apple!.roots);
    } catch (e) {
      if (e instanceof JwsError) throw new BadRequestException(`Compra inválida: ${e.message}`);
      throw e;
    }
  }

  private appleTx(token: string): AppleTransaction {
    const t = this.jws<AppleTransaction>(token);
    if (!t || typeof t.transactionId !== 'string' || typeof t.productId !== 'string') throw new BadRequestException('Compra inválida');
    if (t.bundleId !== this.apple!.bundleId) throw new BadRequestException('Esta compra não é desta app');
    if (!this.appleEnvOk(t.environment)) throw new BadRequestException(`Compras do ambiente ${String(t.environment)} não são aceites aqui`);
    return t;
  }

  private appleSp(t: AppleTransaction, product: ProductInfo, status: StorePurchase['status'], expiresAt: Date | null, autoRenew: boolean | null): StorePurchase {
    return {
      store: 'apple', product,
      transactionId: t.transactionId, originalTransactionId: t.originalTransactionId ?? t.transactionId, purchaseToken: null, orderId: null,
      environment: t.environment === 'Sandbox' ? 'Sandbox' : 'Production',
      status, expiresAt, autoRenew,
      owner: typeof t.appAccountToken === 'string' ? t.appAccountToken.toLowerCase() : null,
      raw: {
        transactionId: t.transactionId, originalTransactionId: t.originalTransactionId, productId: t.productId, type: t.type, transactionReason: t.transactionReason,
        purchaseDate: t.purchaseDate, expiresDate: t.expiresDate, revocationDate: t.revocationDate, revocationReason: t.revocationReason,
        inAppOwnershipType: t.inAppOwnershipType, storefront: t.storefront, price: t.price, currency: t.currency, environment: t.environment,
      },
      tx: {
        type: t.transactionReason === 'RENEWAL' ? 'renewal' : 'purchase', ref: t.transactionId,
        amountMinor: typeof t.price === 'number' ? Math.round(t.price / 10) : this.refPrice(t.productId),
        currency: t.currency ?? this.products.currency,
      },
    };
  }

  /** O estado de uma subscrição a partir da transação e da renovação (como vêm nos avisos e no estado da subscrição). */
  private appleSubStatus(t: AppleTransaction, renewal: AppleRenewal | null, storeStatus?: number): { status: StorePurchase['status']; expiresAt: Date | null } {
    const grace = ms(renewal?.gracePeriodExpiresDate);
    const exp = ms(t.expiresDate);
    if (t.revocationDate) return { status: t.inAppOwnershipType === 'FAMILY_SHARED' ? 'revoked' : 'refunded', expiresAt: exp };
    if (storeStatus === 5) return { status: 'revoked', expiresAt: exp };
    if (storeStatus === 4 && grace) return { status: 'active', expiresAt: grace };
    if (storeStatus === 2 || storeStatus === 3) return { status: 'expired', expiresAt: exp };
    const until = grace && exp && grace > exp ? grace : exp;
    return { status: until && until.getTime() > Date.now() ? 'active' : 'expired', expiresAt: until };
  }

  /** Lê a compra na App Store Server API (a JWS da app só diz qual é; o estado vem sempre da Apple). */
  private async appleFromStore(t0: AppleTransaction): Promise<StorePurchase> {
    const a = this.apple!;
    const product = this.product(t0.productId);
    if (product.kind === 'subscription') {
      const list = await this.storeCall(a.api.subscription(t0.originalTransactionId ?? t0.transactionId, t0.environment));
      const item = list?.find((x) => x.originalTransactionId === (t0.originalTransactionId ?? t0.transactionId)) ?? list?.[0];
      if (!item) throw new BadRequestException('A Apple não conhece esta compra');
      const t = this.appleTx(item.signedTransactionInfo);
      const renewal = item.signedRenewalInfo ? this.jws<AppleRenewal>(item.signedRenewalInfo) : null;
      const p = productInfo(this.products, t.productId);
      if (p?.kind !== 'subscription') throw new BadRequestException('Produto desconhecido');
      const s = this.appleSubStatus(t, renewal, item.status);
      return this.appleSp(t, p, s.status, s.expiresAt, renewal ? renewal.autoRenewStatus === 1 : null);
    }
    const signed = await this.storeCall(a.api.transaction(t0.transactionId, t0.environment));
    if (!signed) throw new BadRequestException('A Apple não conhece esta compra');
    const t = this.appleTx(signed);
    if (t.transactionId !== t0.transactionId || t.productId !== t0.productId) throw new BadRequestException('Compra inválida');
    return this.appleSp(t, product, t.revocationDate ? 'refunded' : 'active', null, null);
  }

  private mine(sp: StorePurchase, userId: string) {
    if (!sp.owner) throw new ForbiddenException(sp.store === 'apple' ? 'A compra não traz a conta (appAccountToken)' : 'A compra não traz a conta (obfuscatedExternalAccountId)');
    if (sp.owner !== userId.toLowerCase()) throw new ForbiddenException('Esta compra foi feita com outra conta');
  }

  async appleVerify(userId: string, signedTransaction: string, campaignId?: string, via: 'verify' | 'restore' = 'verify') {
    this.requireApple();
    const t0 = this.appleTx(signedTransaction);
    const sp = await this.appleFromStore(t0);
    try {
      this.mine(sp, userId);
    } catch (e) {
      await this.audit(this.pool, userId, 'iap.wrong_user', `iap:apple:${sp.transactionId}`, { productId: sp.product.id, via });
      throw e;
    }
    return this.finish(userId, sp, { actor: userId, via, campaignId });
  }

  /** App Store Server Notifications V2. Sem sessão: a assinatura da Apple é a prova. */
  async appleNotification(signedPayload: string) {
    if (!this.apple) throw new ServiceUnavailableException('As compras na App Store não estão configuradas');
    const n = this.jws<AppleNotification>(signedPayload);
    if (!n?.notificationUUID || !n.notificationType) throw new BadRequestException('Aviso inválido');
    if (n.data?.bundleId && n.data.bundleId !== this.apple.bundleId) throw new BadRequestException('Este aviso não é desta app');
    if (n.data?.environment && !this.appleEnvOk(n.data.environment)) return { ok: true, ignored: 'environment' };
    const type = `${n.notificationType}${n.subtype ? `.${n.subtype}` : ''}`;
    if (await this.seen('apple', n.notificationUUID)) return { ok: true, duplicate: true };
    let t: AppleTransaction | null = null;
    let renewal: AppleRenewal | null = null;
    if (n.data?.signedTransactionInfo) t = this.appleTx(n.data.signedTransactionInfo);
    if (n.data?.signedRenewalInfo) renewal = this.jws<AppleRenewal>(n.data.signedRenewalInfo);
    const product = t ? productInfo(this.products, t.productId) : null;
    const note = { type, transactionId: t?.transactionId ?? null, originalTransactionId: t?.originalTransactionId ?? null, productId: t?.productId ?? null, environment: n.data?.environment ?? null };

    // Desligado, só de registo, e os avisos sem transação (TEST, CONSUMPTION_REQUEST, …) também.
    const informative = ['CONSUMPTION_REQUEST', 'TEST', 'PRICE_INCREASE', 'RENEWAL_EXTENSION', 'EXTERNAL_PURCHASE_TOKEN', 'REFUND_DECLINED', 'METADATA_UPDATE', 'MIGRATION'].includes(n.notificationType);
    if (!this.cfg.IAP_ENABLED || !t || !product || informative) {
      await this.mark('apple', n.notificationUUID, `notification:${type}`, null, { ...note, applied: false, enabled: this.cfg.IAP_ENABLED });
      await this.audit(this.pool, null, 'iap.notification', `iap:apple:${t?.transactionId ?? n.notificationUUID}`, { ...note, applied: false });
      return { ok: true, applied: false };
    }

    let sp: StorePurchase;
    if (product.kind === 'subscription') {
      let s = this.appleSubStatus(t, renewal);
      if (n.notificationType === 'EXPIRED' || n.notificationType === 'GRACE_PERIOD_EXPIRED') s = { status: 'expired', expiresAt: s.expiresAt };
      if (n.notificationType === 'DID_FAIL_TO_RENEW' && n.subtype !== 'GRACE_PERIOD') s = { status: 'expired', expiresAt: ms(t.expiresDate) };
      if (n.notificationType === 'REFUND') s = { status: 'refunded', expiresAt: s.expiresAt };
      if (n.notificationType === 'REVOKE') s = { status: 'revoked', expiresAt: s.expiresAt };
      sp = this.appleSp(t, product, s.status, s.expiresAt, renewal ? renewal.autoRenewStatus === 1 : null);
    } else {
      const status = n.notificationType === 'REFUND' ? 'refunded' : n.notificationType === 'REVOKE' ? 'revoked' : t.revocationDate ? 'refunded' : 'active';
      sp = this.appleSp(t, product, status, null, null);
    }
    const userId = await this.ownerOf(sp);
    if (!userId) {
      await this.mark('apple', n.notificationUUID, `notification:${type}`, null, { ...note, applied: false, reason: 'unknown_user' });
      return { ok: true, applied: false };
    }
    const r = await this.record(userId, sp, { actor: null, via: 'notification', notification: n.notificationUUID });
    await this.mark('apple', n.notificationUUID, `notification:${type}`, r.id, { ...note, applied: true, status: r.status });
    return { ok: true, applied: true };
  }

  /* ───────────── Google ───────────── */

  private googleSubSp(token: string, s: GoogleSubscription, product: ProductInfo & { kind: 'subscription' }): StorePurchase {
    const li = s.lineItems?.find((l) => l.productId === product.id) ?? s.lineItems?.[0];
    const expiresAt = li?.expiryTime ? new Date(li.expiryTime) : null;
    const state = s.subscriptionState ?? '';
    const live = expiresAt !== null && expiresAt.getTime() > Date.now();
    const status: StorePurchase['status'] =
      state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' ? (live ? 'active' : 'expired')
        : state === 'SUBSCRIPTION_STATE_CANCELED' ? (live ? 'active' : 'expired')
          : 'expired';
    const orderId = s.latestOrderId ?? li?.latestSuccessfulOrderId ?? null;
    return {
      store: 'google', product,
      transactionId: null, originalTransactionId: null, purchaseToken: token, orderId,
      environment: s.testPurchase ? 'Sandbox' : 'Production',
      status, expiresAt, autoRenew: li?.autoRenewingPlan?.autoRenewEnabled ?? false,
      owner: s.externalAccountIdentifiers?.obfuscatedExternalAccountId?.toLowerCase() ?? null,
      raw: { productId: li?.productId, subscriptionState: state, latestOrderId: orderId, startTime: s.startTime, expiryTime: li?.expiryTime, autoRenewEnabled: li?.autoRenewingPlan?.autoRenewEnabled, regionCode: s.regionCode, test: !!s.testPurchase },
      tx: orderId ? { type: /\.\.\d+$/.test(orderId) ? 'renewal' : 'purchase', ref: orderId, amountMinor: this.refPrice(product.id), currency: this.products.currency } : null,
      replacesToken: s.linkedPurchaseToken ?? null,
    };
  }

  /** Lê a compra na Google Play Developer API. Devolve também o que falta fazer na loja (confirmar ou consumir). */
  private async googleFromStore(productId: string, token: string): Promise<{ sp: StorePurchase; pending: 'ack' | 'consume' | null }> {
    const g = this.google!;
    const product = this.product(productId);
    if (product.kind === 'subscription') {
      const s = await this.storeCall(g.api.subscription(token));
      if (!s) throw new BadRequestException('A Google não conhece esta compra');
      if (s.subscriptionState === 'SUBSCRIPTION_STATE_PENDING') throw new ConflictException('O pagamento ainda está pendente na Google');
      const li = s.lineItems?.find((l) => l.productId === product.id);
      if (!li) throw new BadRequestException('Esta compra não é deste produto');
      return { sp: this.googleSubSp(token, s, product), pending: s.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING' ? 'ack' : null };
    }
    const p = await this.storeCall(g.api.product(productId, token));
    if (!p) throw new BadRequestException('A Google não conhece esta compra');
    if (p.purchaseState === 2) throw new ConflictException('O pagamento ainda está pendente na Google');
    const sp: StorePurchase = {
      store: 'google', product,
      transactionId: null, originalTransactionId: null, purchaseToken: token, orderId: p.orderId ?? null,
      environment: p.purchaseType === 0 ? 'Sandbox' : 'Production',
      status: p.purchaseState === 1 ? 'refunded' : 'active', expiresAt: null, autoRenew: null,
      owner: p.obfuscatedExternalAccountId?.toLowerCase() ?? null,
      raw: { productId, orderId: p.orderId, purchaseTimeMillis: p.purchaseTimeMillis, purchaseState: p.purchaseState, consumptionState: p.consumptionState, purchaseType: p.purchaseType, regionCode: p.regionCode },
      tx: { type: 'purchase', ref: p.orderId ?? `token:${token.slice(0, 80)}`, amountMinor: this.refPrice(productId), currency: this.products.currency },
      campaignHint: p.obfuscatedExternalProfileId && UUID.test(p.obfuscatedExternalProfileId) ? p.obfuscatedExternalProfileId.toLowerCase() : null,
    };
    return { sp, pending: p.purchaseState === 0 && p.consumptionState === 0 ? 'consume' : null };
  }

  async googleVerify(userId: string, productId: string, purchaseToken: string, campaignId?: string, via: 'verify' | 'restore' = 'verify') {
    const g = this.requireGoogle();
    const { sp, pending } = await this.googleFromStore(productId, purchaseToken);
    try {
      this.mine(sp, userId);
    } catch (e) {
      await this.audit(this.pool, userId, 'iap.wrong_user', `iap:google:${sp.orderId ?? 'sem-order'}`, { productId, via });
      throw e;
    }
    // A campanha vem no corpo e/ou na compra (obfuscatedProfileIdAndroid). Se vierem as duas, têm de ser a mesma, a não
    // ser que o rascunho da compra já tenha expirado (e a pessoa tenha feito outro).
    let campaign = campaignId?.toLowerCase();
    let mismatch = false;
    if (sp.product.kind === 'consumable' && sp.campaignHint) {
      if (!campaign) campaign = sp.campaignHint;
      else if (campaign !== sp.campaignHint && (await this.boosts.campaignExists(sp.campaignHint))) {
        campaign = undefined; // a compra fica guardada sem campanha
        mismatch = true;
      }
    }
    let result: Awaited<ReturnType<IapService['finish']>> | undefined;
    let err: unknown;
    try {
      result = await this.finish(userId, sp, { actor: userId, via, campaignId: campaign });
      if (mismatch) err = new UnprocessableEntityException('Esta compra foi feita para outra campanha');
    } catch (e) {
      err = e;
    }
    // Já ficou registada (ou não é desta conta): confirma ou consome na Google, para a compra não ser devolvida sozinha
    // passados 3 dias e para o mesmo pacote se poder comprar outra vez. Se falhar, repete-se no próximo verify.
    const recorded = !err || (err instanceof HttpException && err.getStatus() !== 403 && err.getStatus() !== 400);
    if (pending && recorded && sp.status === 'active') {
      try {
        if (pending === 'consume') await g.api.consume(productId, purchaseToken);
        else await g.api.acknowledgeSubscription(productId, purchaseToken);
      } catch (e) {
        this.log.warn(`não foi possível ${pending === 'consume' ? 'consumir' : 'confirmar'} a compra na Google: ${(e as Error).message}`);
      }
    }
    if (err) throw err;
    return result!;
  }

  /**
   * Avisos do Google Play (RTDN) pelo push do Pub/Sub: POST /iap/google/rtdn?token=IAP_GOOGLE_RTDN_TOKEN.
   * subscriptionNotification -> lê-se o estado na Google e aplica-se; voidedPurchaseNotification -> reembolso.
   */
  async googleRtdn(token: string | undefined, body: { message?: { data?: string; messageId?: string; message_id?: string } }) {
    const secret = this.cfg.IAP_GOOGLE_RTDN_TOKEN;
    if (!secret || !this.google) throw new ServiceUnavailableException('Os avisos do Google Play não estão configurados');
    const a = Buffer.from(String(token ?? ''));
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    const messageId = body?.message?.messageId ?? body?.message?.message_id;
    let n: Record<string, any>;
    try {
      n = JSON.parse(Buffer.from(String(body?.message?.data ?? ''), 'base64').toString('utf8'));
    } catch {
      throw new BadRequestException('Aviso inválido');
    }
    if (!n || typeof n !== 'object') throw new BadRequestException('Aviso inválido');
    if (n.packageName && n.packageName !== this.google.packageName) return { ok: true, ignored: 'package' };
    const notifId = messageId ? String(messageId) : null;
    if (notifId && (await this.seen('google', notifId))) return { ok: true, duplicate: true };
    const sub = n.subscriptionNotification as { notificationType?: number; purchaseToken?: string; subscriptionId?: string } | undefined;
    const voided = n.voidedPurchaseNotification as { purchaseToken?: string; orderId?: string; productType?: number; refundType?: number } | undefined;
    const kind = sub ? `subscription.${sub.notificationType}` : voided ? 'voided' : n.oneTimeProductNotification ? `one_time.${n.oneTimeProductNotification.notificationType}` : n.testNotification ? 'test' : 'other';
    const note = { type: kind, productId: sub?.subscriptionId ?? n.oneTimeProductNotification?.sku ?? null, orderId: voided?.orderId ?? null };
    const done = async (purchaseId: string | null, applied: boolean, extra: Record<string, unknown> = {}) => {
      if (notifId) await this.mark('google', notifId, `notification:${kind}`, purchaseId, { ...note, applied, enabled: this.cfg.IAP_ENABLED, ...extra });
      return { ok: true, applied };
    };
    if (!this.cfg.IAP_ENABLED || (!sub && !voided)) {
      await this.audit(this.pool, null, 'iap.notification', `iap:google:${notifId ?? 'sem-id'}`, { ...note, applied: false });
      return done(null, false);
    }

    if (voided?.purchaseToken) {
      const row = (await this.pool.query(`SELECT * FROM payments.iap_purchases WHERE store = 'google' AND (purchase_token = $1 OR ($2::text IS NOT NULL AND order_id = $2))`, [voided.purchaseToken, voided.orderId ?? null])).rows[0];
      if (!row) return done(null, false, { reason: 'unknown_purchase' });
      const sp = this.rowSp(row, 'refunded');
      const r = await this.record(row.user_id as string, sp, { actor: null, via: 'notification', notification: notifId ?? undefined });
      return done(r.id, true);
    }

    const productId = sub?.subscriptionId;
    const ptoken = sub?.purchaseToken;
    if (!productId || !ptoken || productInfo(this.products, productId)?.kind !== 'subscription') return done(null, false, { reason: 'unknown_product' });
    const s = await this.storeCall(this.google.api.subscription(ptoken));
    if (!s) return done(null, false, { reason: 'unknown_purchase' });
    const sp = this.googleSubSp(ptoken, s, productInfo(this.products, productId) as ProductInfo & { kind: 'subscription' });
    if (sub?.notificationType === 12) sp.status = 'revoked'; // SUBSCRIPTION_REVOKED
    const userId = await this.ownerOf(sp);
    if (!userId) return done(null, false, { reason: 'unknown_user' });
    const r = await this.record(userId, sp, { actor: null, via: 'notification', notification: notifId ?? undefined });
    if (s.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING' && sp.status === 'active') await this.google.api.acknowledgeSubscription(productId, ptoken).catch(() => undefined);
    return done(r.id, true);
  }

  /* ───────────── restaurar ───────────── */

  /** «Restaurar compras»: volta a ler cada compra na loja e a aplicar os direitos (sem ligar campanhas novas). */
  async restore(userId: string, b: { platform: 'ios' | 'android'; signedTransactions?: string[]; purchases?: { productId: string; purchaseToken: string }[] }) {
    if (b.platform === 'ios') this.requireApple();
    else this.requireGoogle();
    const entitlements: unknown[] = [];
    let failed = 0;
    const jobs: (() => Promise<{ entitlement: unknown }>)[] = b.platform === 'ios'
      ? (b.signedTransactions ?? []).map((s) => () => this.appleVerify(userId, s, undefined, 'restore'))
      : (b.purchases ?? []).map((p) => () => this.googleVerify(userId, p.productId, p.purchaseToken, undefined, 'restore'));
    for (const job of jobs) {
      try {
        entitlements.push((await job()).entitlement);
      } catch (e) {
        if (e instanceof HttpException && e.getStatus() === 503) throw e;
        failed++;
      }
    }
    await this.audit(this.pool, userId, 'iap.restore', `user:${userId}`, { platform: b.platform, restored: entitlements.length, failed });
    return { ok: true as const, restored: entitlements.length, failed, entitlements };
  }

  /* ───────────── registar e aplicar ───────────── */

  /** Uma compra já guardada, com outro estado (para os reembolsos que chegam sem a compra toda). */
  private rowSp(row: Row, status: StorePurchase['status']): StorePurchase {
    return {
      store: row.store, product: this.product(row.product_id as string),
      transactionId: row.transaction_id, originalTransactionId: row.original_transaction_id, purchaseToken: row.purchase_token, orderId: row.order_id,
      environment: row.environment, status, expiresAt: row.expires_at ? new Date(row.expires_at as string) : null, autoRenew: row.auto_renew,
      owner: null, raw: row.raw ?? {}, tx: null,
    };
  }

  private where(sp: StorePurchase): [string, unknown[]] {
    if (sp.store === 'google') return [`store = 'google' AND purchase_token = $1`, [sp.purchaseToken]];
    if (sp.product.kind === 'subscription') return [`store = 'apple' AND kind = 'subscription' AND original_transaction_id = $1`, [sp.originalTransactionId]];
    return [`store = 'apple' AND transaction_id = $1`, [sp.transactionId]];
  }

  /** Quem é o dono de uma compra que chega por aviso: a que já está guardada, ou a conta que a loja diz (se existir). */
  private async ownerOf(sp: StorePurchase): Promise<string | null> {
    const [w, p] = this.where(sp);
    const row = (await this.pool.query(`SELECT user_id FROM payments.iap_purchases WHERE ${w}`, p)).rows[0];
    if (row) return row.user_id as string;
    if (!sp.owner || !UUID.test(sp.owner)) return null;
    const u = (await this.pool.query(`SELECT id FROM identity.users WHERE id = $1 AND status <> 'deleted'`, [sp.owner])).rows[0];
    return (u?.id as string | undefined) ?? null;
  }

  private async seen(store: Store, notificationId: string) {
    return !!(await this.pool.query('SELECT 1 FROM payments.iap_events WHERE store = $1 AND notification_id = $2', [store, notificationId])).rowCount;
  }

  private async mark(store: Store, notificationId: string, type: string, purchaseId: string | null, data: Record<string, unknown>) {
    await this.pool.query(
      `INSERT INTO payments.iap_events (id, purchase_id, store, type, notification_id, product_id, environment, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (store, notification_id) WHERE notification_id IS NOT NULL DO NOTHING`,
      [uuidv7(), purchaseId, store, type.slice(0, 60), notificationId, (data.productId as string | null) ?? null, (data.environment as string | null) ?? null, data],
    );
  }

  /** Regista a compra e, se houver campanha, liga-a. Devolve a resposta das rotas de verify. */
  private async finish(userId: string, sp: StorePurchase, opts: RecordOpts) {
    const enforceEligible = sp.product.kind === 'subscription' && sp.status === 'active';
    let row = await this.record(userId, sp, opts);
    if (sp.product.kind === 'consumable' && opts.campaignId) row = await this.link(userId, row, opts.campaignId);
    if (enforceEligible) {
      const pv = (await this.pool.query('SELECT eligible_at FROM payments.paid_verification WHERE user_id = $1', [userId])).rows[0];
      if (!pv?.eligible_at) {
        throw new ForbiddenException('A tua identidade ainda não foi aprovada para a verificação paga. A compra ficou guardada e o selo é aplicado quando for aprovada.');
      }
    }
    return { ok: true as const, entitlement: await this.entitlement(row) };
  }

  /**
   * Guarda (ou atualiza) a compra numa transação: idempotente pela chave da loja; uma compra de outra conta é recusada.
   * Conta a transação uma só vez (iap_events), suspende a campanha num reembolso e acerta o selo da verificação paga.
   */
  private async record(userId: string, sp: StorePurchase, opts: RecordOpts): Promise<Row> {
    const [w, p] = this.where(sp);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      let old = (await c.query(`SELECT * FROM payments.iap_purchases WHERE ${w} FOR UPDATE`, p)).rows[0] as Row | undefined;
      if (!old) {
        const ins = await c.query(
          `INSERT INTO payments.iap_purchases (id, user_id, store, product_id, kind, transaction_id, original_transaction_id, purchase_token, order_id, environment, status, expires_at, auto_renew, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT DO NOTHING RETURNING *`,
          [uuidv7(), userId, sp.store, sp.product.id, sp.product.kind, sp.transactionId, sp.originalTransactionId, sp.purchaseToken, sp.orderId, sp.environment, sp.status, sp.expiresAt, sp.autoRenew, sp.raw],
        );
        if (ins.rows[0]) {
          const r = ins.rows[0] as Row;
          await this.audit(c, opts.actor, 'iap.purchase_recorded', `iap:${r.id}`, { store: sp.store, productId: sp.product.id, kind: sp.product.kind, status: sp.status, environment: sp.environment, via: opts.via, userId });
          await this.afterChange(c, userId, sp, r, null, opts);
          await c.query('COMMIT');
          return r;
        }
        // Outro pedido guardou-a ao mesmo tempo (ou a order_id já existe noutra linha).
        old = (await c.query(`SELECT * FROM payments.iap_purchases WHERE ${w} FOR UPDATE`, p)).rows[0] as Row | undefined;
        if (!old && sp.orderId) old = (await c.query(`SELECT * FROM payments.iap_purchases WHERE store = $1 AND order_id = $2 FOR UPDATE`, [sp.store, sp.orderId])).rows[0] as Row | undefined;
        if (!old) throw new ConflictException('Compra em processamento; tenta outra vez');
      }
      if (old.user_id !== userId) throw new ForbiddenException('Esta compra pertence a outra conta');
      // Consumível: reembolsado ou revogado é final; consumido (com campanha) continua consumido.
      let status: PurchaseStatus = sp.status;
      if (sp.product.kind === 'consumable') {
        if (old.status === 'refunded' || old.status === 'revoked') status = old.status;
        else if (sp.status === 'active' && (old.status === 'consumed' || old.campaign_id)) status = 'consumed';
      }
      const r = (await c.query(
        `UPDATE payments.iap_purchases SET status = $2, product_id = $3, transaction_id = coalesce($4, transaction_id), order_id = coalesce($5, order_id),
                expires_at = coalesce($6, expires_at), auto_renew = coalesce($7, auto_renew), raw = $8, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [old.id, status, sp.product.id, sp.transactionId, sp.orderId, sp.expiresAt, sp.autoRenew, Object.keys(sp.raw).length ? sp.raw : old.raw],
      )).rows[0] as Row;
      if (old.status !== status) await this.audit(c, opts.actor, 'iap.status_changed', `iap:${r.id}`, { from: old.status, to: status, via: opts.via, productId: sp.product.id, userId });
      await this.afterChange(c, userId, { ...sp, status: status === 'consumed' ? 'active' : status }, r, old, opts);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Esta compra já foi registada');
      throw e;
    } finally {
      c.release();
    }
  }

  private async afterChange(c: PoolClient, userId: string, sp: StorePurchase, r: Row, old: Row | null, opts: RecordOpts) {
    // A transação (compra ou renovação) conta uma só vez.
    if (sp.tx) {
      const ev = await c.query(
        `INSERT INTO payments.iap_events (id, purchase_id, store, type, transaction_ref, product_id, environment, amount_minor, currency, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (store, type, transaction_ref) WHERE transaction_ref IS NOT NULL DO NOTHING`,
        [uuidv7(), r.id, sp.store, sp.tx.type, sp.tx.ref, sp.product.id, sp.environment, sp.tx.amountMinor, sp.tx.currency, { via: opts.via }],
      );
      if (ev.rowCount) await this.audit(c, opts.actor, sp.tx.type === 'renewal' ? 'iap.renewal' : 'iap.purchase', `iap:${r.id}`, { store: sp.store, productId: sp.product.id, transaction: sp.tx.ref, environment: sp.environment, userId });
    }
    // Reembolso ou revogação: conta uma vez, e a campanha paga com esta compra é suspensa.
    const ended = sp.status === 'refunded' || sp.status === 'revoked';
    if (ended && old?.status !== sp.status) {
      const ref = String(r.transaction_id ?? r.order_id ?? r.purchase_token).slice(0, 200);
      const paid = (await c.query(`SELECT amount_minor, currency FROM payments.iap_events WHERE purchase_id = $1 AND type IN ('purchase', 'renewal') ORDER BY created_at DESC LIMIT 1`, [r.id])).rows[0];
      await c.query(
        `INSERT INTO payments.iap_events (id, purchase_id, store, type, transaction_ref, product_id, environment, amount_minor, currency, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (store, type, transaction_ref) WHERE transaction_ref IS NOT NULL DO NOTHING`,
        [uuidv7(), r.id, sp.store, sp.status === 'refunded' ? 'refund' : 'revoke', ref, sp.product.id, sp.environment, paid?.amount_minor ?? null, paid?.currency ?? null, { via: opts.via }],
      );
      await this.audit(c, opts.actor, sp.status === 'refunded' ? 'iap.refunded' : 'iap.revoked', `iap:${r.id}`, { store: sp.store, productId: sp.product.id, campaignId: r.campaign_id ?? null, userId });
      if (r.campaign_id) await this.boosts.suspendIap(c, r.campaign_id as string, sp.status === 'refunded' ? 'refunded' : 'revoked');
    }
    // Mudança de plano na Google: a subscrição antiga deixa de contar.
    if (sp.replacesToken) {
      await c.query(`UPDATE payments.iap_purchases SET status = 'expired', updated_at = now() WHERE store = 'google' AND purchase_token = $1 AND user_id = $2 AND status = 'active'`, [sp.replacesToken, userId]);
    }
    if (sp.product.kind === 'subscription') await syncPaidVerification(c, userId);
  }

  /** Liga a compra de um Bombar à campanha em rascunho e ativa-a (uma compra paga uma só campanha). */
  private async link(userId: string, row: Row, campaignId: string): Promise<Row> {
    if (row.campaign_id) {
      if (row.campaign_id === campaignId) return row;
      throw new ConflictException('Esta compra já pagou outra campanha');
    }
    if (row.status !== 'active') throw new ConflictException(row.status === 'refunded' ? 'Esta compra foi reembolsada' : 'Esta compra já não está disponível');
    const product = this.product(row.product_id as string);
    if (product.kind !== 'consumable') throw new BadRequestException('Este produto não é um Bombar');
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const cur = (await c.query('SELECT * FROM payments.iap_purchases WHERE id = $1 FOR UPDATE', [row.id])).rows[0] as Row;
      if (cur.campaign_id) {
        await c.query('ROLLBACK');
        if (cur.campaign_id === campaignId) return cur;
        throw new ConflictException('Esta compra já pagou outra campanha');
      }
      await this.boosts.activateIap(c, campaignId, userId, product.package, { id: row.id as string, store: row.store as string, productId: product.id });
      const r = (await c.query(`UPDATE payments.iap_purchases SET campaign_id = $2, status = 'consumed', updated_at = now() WHERE id = $1 RETURNING *`, [row.id, campaignId])).rows[0] as Row;
      await this.audit(c, userId, 'iap.boost_linked', `iap:${row.id}`, { campaignId, productId: product.id, package: product.package });
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Esta campanha já foi paga com outra compra');
      throw e;
    } finally {
      c.release();
    }
  }

  private async entitlement(r: Row) {
    if (r.kind === 'subscription') {
      const u = (await this.pool.query('SELECT verified, verified_tier FROM identity.users WHERE id = $1', [r.user_id])).rows[0];
      const expiresAt = r.expires_at ? new Date(r.expires_at as string) : null;
      return {
        kind: 'verification' as const,
        productId: r.product_id as string,
        status: r.status as PurchaseStatus,
        active: r.status === 'active' && !!expiresAt && expiresAt.getTime() > Date.now(),
        expiresAt: expiresAt?.toISOString() ?? null,
        autoRenew: !!r.auto_renew,
        verified: !!u?.verified,
        tier: (u?.verified ? (u.verified_tier ?? 'verified') : null) as 'verified' | 'official' | 'paid' | null,
      };
    }
    return {
      kind: 'boost' as const,
      productId: r.product_id as string,
      status: r.status as PurchaseStatus,
      campaignId: (r.campaign_id as string | null) ?? null,
      campaignState: r.campaign_id ? await this.boosts.campaignState(r.campaign_id as string).catch(() => null) : null,
    };
  }

  /* ───────────── varredura ───────────── */

  /**
   * As subscrições ativas que já passaram da data: confirma-se na loja (renovou? expirou?). Se a loja não responder e a
   * data já passou há mais de 3 dias, dá-se por expirada. Devolve quantas mudaram.
   */
  async sweep(limit = 100): Promise<number> {
    if (!this.cfg.IAP_ENABLED) return 0;
    await this.boosts.expireIapDrafts().catch(() => 0);
    const { rows } = await this.pool.query(
      `SELECT * FROM payments.iap_purchases WHERE kind = 'subscription' AND status = 'active' AND expires_at <= now() ORDER BY expires_at LIMIT $1`,
      [limit],
    );
    let changed = 0;
    for (const row of rows) {
      try {
        let sp: StorePurchase | null = null;
        if (row.store === 'apple' && this.apple) {
          sp = await this.appleFromStore({ transactionId: row.transaction_id, originalTransactionId: row.original_transaction_id, productId: row.product_id, bundleId: this.apple.bundleId, environment: row.environment } as AppleTransaction);
        } else if (row.store === 'google' && this.google) {
          sp = (await this.googleFromStore(row.product_id as string, row.purchase_token as string)).sp;
        }
        if (!sp) throw new StoreError('loja não configurada');
        const r = await this.record(row.user_id as string, sp, { actor: null, via: 'sweep' });
        if (r.status !== row.status) changed++;
      } catch (e) {
        if (new Date(row.expires_at as string).getTime() < Date.now() - 3 * 86_400_000) {
          await this.record(row.user_id as string, this.rowSp(row, 'expired'), { actor: null, via: 'sweep' });
          changed++;
        } else this.log.warn(`varredura: não foi possível confirmar a compra ${row.id as string}: ${(e as Error).message}`);
      }
    }
    return changed;
  }

  /* ───────────── backoffice ───────────── */

  /** Finanças → Compras pela loja: lista com filtros, contagens por estado e totais por produto e por mês. */
  async adminList(f: { store?: string; status?: string; kind?: string; product?: string; env?: string; user?: string; from?: string; to?: string; cursor?: string; limit?: number }) {
    const w: string[] = [];
    const args: unknown[] = [];
    const p = (v: unknown) => { args.push(v); return `$${args.length}`; };
    if (f.store === 'apple' || f.store === 'google') w.push(`ip.store = ${p(f.store)}`);
    if (f.status && ['active', 'expired', 'refunded', 'revoked', 'consumed'].includes(f.status)) w.push(`ip.status = ${p(f.status)}`);
    if (f.kind === 'subscription' || f.kind === 'consumable') w.push(`ip.kind = ${p(f.kind)}`);
    if (f.product) w.push(`ip.product_id = ${p(f.product.slice(0, 150))}`);
    if (f.env === 'Production' || f.env === 'Sandbox') w.push(`ip.environment = ${p(f.env)}`);
    if (f.user) w.push(`(u.username ILIKE ${p(f.user.replace(/^@/, '').replace(/[\\%_]/g, (x) => `\\${x}`).slice(0, 40) + '%')} ESCAPE '\\' OR u.id::text = ${p(f.user)})`);
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    if (f.from && DAY.test(f.from)) w.push(`ip.created_at >= ${p(f.from)}::date`);
    if (f.to && DAY.test(f.to)) w.push(`ip.created_at < ${p(f.to)}::date + 1`);
    const filters = [...w];
    if (f.cursor && UUID.test(f.cursor)) w.push(`ip.id < ${p(f.cursor)}`);
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
    const base = `FROM payments.iap_purchases ip JOIN identity.users u ON u.id = ip.user_id`;
    const items = (await this.pool.query(
      `SELECT ip.*, u.username, u.status AS user_status, v.slug AS venue_slug, v.name AS venue_name, bc.status AS campaign_status,
              (SELECT sum(e.amount_minor) FROM payments.iap_events e WHERE e.purchase_id = ip.id AND e.type IN ('purchase', 'renewal'))::bigint AS paid_minor,
              (SELECT count(*) FROM payments.iap_events e WHERE e.purchase_id = ip.id AND e.type = 'renewal')::int AS renewals
         ${base} LEFT JOIN content.boost_campaigns bc ON bc.id = ip.campaign_id LEFT JOIN content.venues v ON v.id = bc.venue_id
        ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY ip.id DESC LIMIT ${limit + 1}`,
      args,
    )).rows;
    const fargs = args.slice(0, args.length - (f.cursor && UUID.test(f.cursor) ? 1 : 0));
    const fw = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const counts = (await this.pool.query(`SELECT ip.status, count(*)::int AS n ${base} ${fw} GROUP BY ip.status`, fargs)).rows;
    // Totais pelos acontecimentos (cada compra, renovação e reembolso conta no mês em que aconteceu).
    const evw = filters.length ? `AND ${filters.join(' AND ')}` : '';
    const totals = (await this.pool.query(
      `SELECT to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, e.product_id, ip.store, e.environment,
              count(*) FILTER (WHERE e.type = 'purchase')::int AS purchases, count(*) FILTER (WHERE e.type = 'renewal')::int AS renewals,
              count(*) FILTER (WHERE e.type IN ('refund', 'revoke'))::int AS refunds,
              coalesce(sum(e.amount_minor) FILTER (WHERE e.type IN ('purchase', 'renewal')), 0)::bigint AS gross,
              coalesce(sum(e.amount_minor) FILTER (WHERE e.type IN ('refund', 'revoke')), 0)::bigint AS refunded
         FROM payments.iap_events e JOIN payments.iap_purchases ip ON ip.id = e.purchase_id JOIN identity.users u ON u.id = ip.user_id
        WHERE e.type IN ('purchase', 'renewal', 'refund', 'revoke') AND e.created_at > now() - interval '24 months' ${evw}
        GROUP BY 1, 2, 3, 4 ORDER BY 1 DESC, 2`,
      fargs,
    )).rows;
    const live = totals.filter((t) => t.environment !== 'Sandbox');
    const sum = (rows: Row[], key: (t: Row) => string, label: (t: Row) => Record<string, unknown>) => {
      const m = new Map<string, Record<string, any>>();
      for (const t of rows) {
        const k = key(t);
        const x = m.get(k) ?? { ...label(t), purchases: 0, renewals: 0, refunds: 0, grossMinor: 0, refundedMinor: 0, netMinor: 0 };
        x.purchases += t.purchases; x.renewals += t.renewals; x.refunds += t.refunds;
        x.grossMinor += Number(t.gross); x.refundedMinor += Number(t.refunded); x.netMinor = x.grossMinor - x.refundedMinor;
        m.set(k, x);
      }
      return [...m.values()];
    };
    const page = items.slice(0, limit);
    return {
      config: { enabled: this.cfg.IAP_ENABLED, apple: !!this.apple, google: !!this.google, currency: this.products.currency, products: [...this.products.verification.map((x) => ({ id: x.id, kind: 'subscription' })), ...this.products.boost.map((x) => ({ id: x.id, kind: 'consumable' }))] },
      counts: Object.fromEntries(['active', 'expired', 'refunded', 'revoked', 'consumed'].map((s) => [s, counts.find((c) => c.status === s)?.n ?? 0])) as Record<PurchaseStatus, number>,
      /** Só compras reais (Production); as de teste (Sandbox) ficam em `sandbox`. */
      totals: {
        byProduct: sum(live, (t) => `${t.product_id}|${t.store}`, (t) => ({ productId: t.product_id, store: t.store })),
        byMonth: sum(live, (t) => t.month, (t) => ({ month: t.month })),
        sandbox: sum(totals.filter((t) => t.environment === 'Sandbox'), () => 'all', () => ({})).at(0) ?? null,
      },
      items: page.map((r) => ({
        id: r.id as string,
        store: r.store as Store,
        productId: r.product_id as string,
        kind: r.kind as 'subscription' | 'consumable',
        status: r.status as PurchaseStatus,
        environment: r.environment as Env,
        user: { id: r.user_id as string, username: r.user_status === 'deleted' ? null : (r.username as string) },
        transactionId: (r.transaction_id as string | null) ?? null,
        orderId: (r.order_id as string | null) ?? null,
        expiresAt: r.expires_at ? new Date(r.expires_at as string).toISOString() : null,
        autoRenew: r.auto_renew as boolean | null,
        renewals: r.renewals as number,
        paidMinor: r.paid_minor === null ? null : Number(r.paid_minor),
        campaign: r.campaign_id ? { id: r.campaign_id as string, status: r.campaign_status as string, venue: r.venue_slug ? { slug: r.venue_slug as string, name: r.venue_name as string } : null } : null,
        createdAt: new Date(r.created_at as string).toISOString(),
        updatedAt: new Date(r.updated_at as string).toISOString(),
      })),
      nextCursor: items.length > limit ? (page[page.length - 1].id as string) : null,
    };
  }
}
