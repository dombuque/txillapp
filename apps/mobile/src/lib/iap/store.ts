import { Platform } from 'react-native';
import type { ProductKind, StoreAdapter, StoreProduct, StorePurchase } from './core';

/**
 * A loja no telemóvel (iOS: StoreKit 2; Android: Google Play Billing), pelo expo-iap. A biblioteca só se carrega quando
 * a ligação abre (`connect`), e quem decide se abre é lib/iap (só nas versões das lojas): o APK beta nunca liga ao Play
 * Billing. Na web, store.web.ts.
 */
type Sdk = typeof import('expo-iap');
type Purchase = import('expo-iap').Purchase;

let sdkPromise: Promise<Sdk> | null = null;
const sdk = () => (sdkPromise ??= import('expo-iap'));
const ANDROID_PACKAGE = 'com.txillapp.app';

/** Android: a oferta (plano base) de cada subscrição, que a compra tem de levar. Vem do fetchProducts. */
const offerTokens = new Map<string, string>();

function toPurchase(p: Purchase): StorePurchase {
  const android = Platform.OS === 'android' ? (p as import('expo-iap').PurchaseAndroid) : null;
  return {
    productId: p.productId,
    token: p.purchaseToken ?? '',
    id: (p as { transactionId?: string | null }).transactionId || p.id,
    state: p.purchaseState === 'purchased' ? 'purchased' : p.purchaseState === 'pending' ? 'pending' : 'unknown',
    profileId: android?.obfuscatedProfileIdAndroid ?? null,
    raw: p,
  };
}

export const nativeStore: StoreAdapter = {
  available: Platform.OS === 'ios' || Platform.OS === 'android',
  async connect() {
    const m = await sdk();
    const ok = await m.initConnection();
    if (!ok) throw Object.assign(new Error('A loja não respondeu'), { code: 'init-connection' });
  },
  async products(ids: string[], kind: ProductKind): Promise<StoreProduct[]> {
    const m = await sdk();
    const list = ((await m.fetchProducts({ skus: ids, type: kind })) ?? []) as (import('expo-iap').Product | import('expo-iap').ProductSubscription)[];
    return list.map((p) => {
      if (Platform.OS === 'android' && 'subscriptionOffers' in p && Array.isArray(p.subscriptionOffers)) {
        // O plano base (sem oferta de lançamento): o preço que se mostra é o que se cobra.
        const base = p.subscriptionOffers.find((o) => !o.id || o.id === o.basePlanIdAndroid) ?? p.subscriptionOffers[0];
        if (base?.offerTokenAndroid) offerTokens.set(p.id, base.offerTokenAndroid);
        return { id: p.id, kind, title: p.title, price: base?.displayPrice || p.displayPrice };
      }
      return { id: p.id, kind, title: p.title, price: p.displayPrice };
    });
  },
  async buy({ productId, kind, accountId, profileId }) {
    const m = await sdk();
    if (kind === 'subs') {
      const offerToken = offerTokens.get(productId);
      await m.requestPurchase({
        type: 'subs',
        request: {
          apple: { sku: productId, appAccountToken: accountId },
          google: { skus: [productId], obfuscatedAccountId: accountId, subscriptionOffers: offerToken ? [{ sku: productId, offerToken }] : undefined },
        },
      });
      return;
    }
    await m.requestPurchase({
      type: 'in-app',
      request: {
        apple: { sku: productId, appAccountToken: accountId, quantity: 1 },
        google: { skus: [productId], obfuscatedAccountId: accountId, obfuscatedProfileId: profileId ?? null },
      },
    });
  },
  listen(cb) {
    let sub: { remove: () => void } | null = null;
    let gone = false;
    void sdk().then((m) => {
      if (!gone) sub = m.purchaseUpdatedListener((p) => cb(toPurchase(p)));
    });
    return () => {
      gone = true;
      sub?.remove();
    };
  },
  listenErrors(cb) {
    let sub: { remove: () => void } | null = null;
    let gone = false;
    void sdk().then((m) => {
      if (!gone) sub = m.purchaseErrorListener((e) => cb(e));
    });
    return () => {
      gone = true;
      sub?.remove();
    };
  },
  async unfinished() {
    const m = await sdk();
    if (Platform.OS === 'ios') return (await m.getPendingTransactionsIOS()).map((p) => toPurchase(p as Purchase));
    // Android: as subscrições por reconhecer e os pacotes do Bombar por consumir (os consumidos já não aparecem).
    const all = await m.getAvailablePurchases();
    return all
      .filter((p) => p.purchaseState === 'purchased' && (p as import('expo-iap').PurchaseAndroid).isAcknowledgedAndroid !== true)
      .map(toPurchase);
  },
  async owned() {
    const m = await sdk();
    await m.restorePurchases().catch(() => undefined);
    return (await m.getAvailablePurchases()).map(toPurchase);
  },
  async finish(p, consumable) {
    const m = await sdk();
    await m.finishTransaction({ purchase: p.raw as Purchase, isConsumable: consumable });
  },
  async manage(productId) {
    const m = await sdk();
    await m.deepLinkToSubscriptions(Platform.OS === 'android' ? { skuAndroid: productId ?? null, packageNameAndroid: ANDROID_PACKAGE } : undefined);
  },
};
