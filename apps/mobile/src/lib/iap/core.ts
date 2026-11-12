/**
 * Compras pela loja (App Store e Google Play): a lógica, sem React Native nem a biblioteca da loja, para se testar com a
 * loja e a API simuladas (tests/iap.test.mjs). Só se vendem duas coisas pela loja: a verificação paga (o selo azul, uma
 * subscrição) e o Bombar (os destaques dos locais, compras que se consomem). Os Txills nunca se vendem nas lojas.
 *
 * As regras que importam:
 *  • a ligação à loja só se abre quando é preciso (`ensure`), e nunca fora das lojas (no APK beta e na web não há loja);
 *  • quem compra vai sempre identificado: o uuid da conta com sessão (iOS: appAccountToken; Android: obfuscatedAccountId);
 *  • `finish` (finishTransaction) só depois de o servidor confirmar. Sem confirmação, a compra fica por acabar e volta a
 *    ir ao servidor no próximo arranque (`recover`): a compra nunca se perde;
 *  • o Bombar cria primeiro a campanha em rascunho, compra o produto do pacote e manda o verify com o `campaignId`.
 */

export type IapPlatform = 'ios' | 'android';
export type IapChannel = 'beta' | 'play' | 'appstore' | 'web';

/** A loja desta cópia da app: só as versões das lojas compram. No APK beta e na web não há loja (null). */
export function iapPlatformFor(channel: IapChannel): IapPlatform | null {
  return channel === 'appstore' ? 'ios' : channel === 'play' ? 'android' : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// O contrato da API (/api/v1/iap)
// ---------------------------------------------------------------------------------------------------------------------

export interface IapCatalog {
  enabled: boolean;
  verification: {
    products: { id: string; period: 'month' | 'year' }[];
    eligible: boolean;
    active: { productId: string; expiresAt: string; autoRenew: boolean } | null;
  };
  boost: { products: { id: string; days: number; radiusKm: number }[] };
}

/** O que o servidor deu (a subscrição ou a campanha). A app só precisa de saber que ficou confirmado. */
export type IapEntitlement = Record<string, unknown> | null;

export interface IapApi {
  catalog(platform: IapPlatform): Promise<IapCatalog>;
  appleVerify(b: { signedTransaction: string; campaignId?: string }): Promise<{ ok: boolean; entitlement?: IapEntitlement }>;
  googleVerify(b: { productId: string; purchaseToken: string; campaignId?: string }): Promise<{ ok: boolean; entitlement?: IapEntitlement }>;
  restore(b: { platform: IapPlatform; signedTransactions?: string[]; purchases?: { productId: string; purchaseToken: string }[] }): Promise<unknown>;
}

// ---------------------------------------------------------------------------------------------------------------------
// A loja (a camada nativa: src/lib/iap/store.ts; na web, store.web.ts)
// ---------------------------------------------------------------------------------------------------------------------

export type ProductKind = 'subs' | 'in-app';

/** Um produto como a loja o mostra: o preço já vem localizado (moeda e formato do país da conta da loja). */
export interface StoreProduct {
  id: string;
  kind: ProductKind;
  title: string;
  /** O preço como a loja o escreve («250,00 MT», «4,99 €»). */
  price: string;
}

/** Uma compra que a loja entregou. `raw` é o objeto da biblioteca, para o `finish`. */
export interface StorePurchase {
  productId: string;
  /** iOS: a transação assinada (JWS). Android: o purchaseToken. */
  token: string;
  /** Identifica a transação (iOS: transactionId; Android: o orderId ou o token). */
  id: string;
  state: 'purchased' | 'pending' | 'unknown';
  /** Android: o obfuscatedProfileId que foi na compra (aqui, o id da campanha do Bombar). */
  profileId?: string | null;
  raw: unknown;
}

export interface StoreAdapter {
  /** Há loja neste aparelho (iOS ou Android nativo). Na web: false. */
  readonly available: boolean;
  connect(): Promise<void>;
  products(ids: string[], kind: ProductKind): Promise<StoreProduct[]>;
  /** Abre a folha de compra da loja. O resultado chega por `listen` (ou pelo erro de `listenErrors`). */
  buy(req: { productId: string; kind: ProductKind; accountId: string; profileId?: string }): Promise<void>;
  /** Cada compra que a loja entrega, também as que ficaram por acabar de outras vezes. */
  listen(cb: (p: StorePurchase) => void): () => void;
  listenErrors(cb: (e: unknown) => void): () => void;
  /** As compras por acabar (iOS: as transações por acabar; Android: as por reconhecer ou por consumir). */
  unfinished(): Promise<StorePurchase[]>;
  /** As compras desta conta da loja (para o Restaurar), depois de sincronizar com a loja. */
  owned(): Promise<StorePurchase[]>;
  finish(p: StorePurchase, consumable: boolean): Promise<void>;
  /** Abre a página das subscrições da loja (Apple: Subscrições; Google Play: Pagamentos e subscrições). */
  manage(productId?: string): Promise<void>;
}

/** Guardar texto neste aparelho (o cofre do telemóvel). Nunca lança erros. */
export interface IapStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------------------------------------------------

/**
 * O que aconteceu, para o ecrã:
 *  • cancelled: a pessoa fechou a folha da loja (nada a mostrar, sem alarme);
 *  • pending: a loja ainda não cobrou (por exemplo «Pedir para comprar» no iPhone, ou um pagamento em dinheiro no Play);
 *  • network: sem rede (a compra fica guardada e vai ao servidor quando houver);
 *  • unavailable: a loja não está disponível neste aparelho;
 *  • failed: outra falha.
 */
export type IapErrorKind = 'cancelled' | 'pending' | 'network' | 'unavailable' | 'failed';

export function classifyIapError(e: unknown): IapErrorKind {
  const code = String((e as { code?: unknown } | null)?.code ?? '').toLowerCase();
  const msg = String((e as { message?: unknown } | null)?.message ?? '');
  if (code === 'user-cancelled' || code === 'e_user_cancelled' || /cancel/i.test(code)) return 'cancelled';
  if (code === 'pending' || code === 'deferred-payment' || code === 'e_deferred_payment') return 'pending';
  if (['network-error', 'service-timeout', 'service-disconnected', 'connection-closed', 'remote-error'].includes(code)) return 'network';
  if (['billing-unavailable', 'iap-not-available', 'feature-not-supported', 'init-connection', 'not-prepared', 'activity-unavailable'].includes(code)) return 'unavailable';
  if (e instanceof TypeError && /internet|network|fetch|load failed|ligação/i.test(msg)) return 'network';
  return 'failed';
}

/** O texto de cada estado (português de Portugal e Moçambique). Cancelado: nada. */
export function iapMessage(kind: IapErrorKind | 'verify-failed' | 'retry'): string | null {
  switch (kind) {
    case 'cancelled': return null;
    case 'pending': return 'A compra está à espera de aprovação (por exemplo, de quem gere a conta da família). Quando for aprovada, ativamos sozinhos.';
    case 'network': return 'Sem ligação à internet. A compra ficou guardada e confirmamos quando voltares a ter rede.';
    case 'retry': return 'Sem ligação à internet. A compra ficou guardada e confirmamos quando voltares a ter rede.';
    case 'unavailable': return 'A loja não está disponível neste aparelho agora. Confirma que tens sessão iniciada na loja e tenta outra vez.';
    case 'verify-failed': return 'Pagaste, mas ainda não conseguimos confirmar a compra. Não voltes a comprar: tentamos outra vez sozinhos da próxima vez que abrires a app.';
    case 'failed': return 'Não deu para concluir a compra. Tenta outra vez.';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// O serviço
// ---------------------------------------------------------------------------------------------------------------------

/** O resultado de uma compra (também das que chegam sozinhas no arranque). */
export type IapOutcome =
  | { status: 'done'; kind: 'verification' | 'boost'; productId: string; campaignId?: string; entitlement: IapEntitlement }
  | { status: 'pending'; productId: string }
  | { status: 'retry'; productId: string }
  | { status: 'verify-failed'; productId: string }
  | { status: 'cancelled'; productId?: string }
  | { status: 'error'; kind: IapErrorKind; productId?: string };

export interface IapDeps {
  platform: IapPlatform | null;
  store: StoreAdapter;
  api: IapApi;
  storage: IapStorage;
  /** O uuid da conta com sessão (null sem sessão). */
  userId: () => string | null;
  /** Quanto tempo esperar pela resposta da loja depois de abrir a folha de compra. */
  buyTimeoutMs?: number;
}

/** As campanhas do Bombar à espera de pagamento: produto → id da campanha (fica no aparelho até o servidor confirmar). */
export const INTENTS_KEY = 'txill.iap.boost-intents';

/** O que vai no verify, conforme a loja. */
export function verifyBody(platform: IapPlatform, p: Pick<StorePurchase, 'productId' | 'token'>, campaignId?: string) {
  const extra = campaignId ? { campaignId } : {};
  return platform === 'ios' ? { signedTransaction: p.token, ...extra } : { productId: p.productId, purchaseToken: p.token, ...extra };
}

/** O que vai no Restaurar, conforme a loja. */
export function restoreBody(platform: IapPlatform, owned: Pick<StorePurchase, 'productId' | 'token'>[]) {
  return platform === 'ios'
    ? { platform, signedTransactions: owned.map((p) => p.token) }
    : { platform, purchases: owned.map((p) => ({ productId: p.productId, purchaseToken: p.token })) };
}

/** Os produtos do Bombar consomem-se (compra-se o mesmo pacote outra vez); a subscrição não. */
const isBoostId = (catalog: IapCatalog | null, productId: string) => !!catalog?.boost.products.some((b) => b.id === productId);

export interface Iap {
  /** Há compras pela loja nesta cópia (versões das lojas, com loja no aparelho). */
  readonly supported: boolean;
  /** Abre a ligação à loja (uma vez) e começa a ouvir as compras. */
  ensure(): Promise<void>;
  catalog(): Promise<IapCatalog>;
  products(ids: string[], kind: ProductKind): Promise<StoreProduct[]>;
  subscribe(productId: string): Promise<IapOutcome>;
  /** Bombar: cria o rascunho (`draft`, com `source: 'iap'`), compra o pacote e confirma com o `campaignId`. */
  buyBoost(productId: string, draft: () => Promise<{ id: string }>): Promise<IapOutcome>;
  /** Restaurar compras: manda ao servidor o que a loja diz que esta conta da loja tem, e reenvia as por acabar. */
  restore(): Promise<{ ok: boolean; kind?: IapErrorKind }>;
  /** Reenvia ao servidor as compras por acabar (no arranque e ao abrir os ecrãs de compra). */
  recover(): Promise<IapOutcome[]>;
  manage(productId?: string): Promise<void>;
  /** Ouve os resultados (também os que chegam sozinhos). */
  onOutcome(cb: (o: IapOutcome) => void): () => void;
  dispose(): void;
}

export function createIap(deps: IapDeps): Iap {
  const { platform, store, api, storage } = deps;
  const supported = !!platform && store.available;
  let connecting: Promise<void> | null = null;
  let unlisten: (() => void)[] = [];
  let catalogCache: IapCatalog | null = null;
  const listeners = new Set<(o: IapOutcome) => void>();
  /** Quem está à espera do resultado de uma compra que abriu (por produto). */
  const waiting = new Map<string, (o: IapOutcome) => void>();
  /** Compras a caminho do servidor (pelo token): a mesma compra nunca vai duas vezes ao mesmo tempo. */
  const inFlight = new Map<string, Promise<IapOutcome>>();

  const emit = (o: IapOutcome) => {
    const pid = 'productId' in o ? o.productId : undefined;
    if (pid && waiting.has(pid)) {
      const w = waiting.get(pid)!;
      waiting.delete(pid);
      w(o);
    }
    for (const l of listeners) l(o);
  };

  async function intents(): Promise<Record<string, string>> {
    try {
      const v = JSON.parse((await storage.get(INTENTS_KEY)) ?? '{}');
      return v && typeof v === 'object' ? (v as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
  async function setIntent(productId: string, campaignId: string | null) {
    const all = await intents();
    if (campaignId) all[productId] = campaignId;
    else delete all[productId];
    await storage.set(INTENTS_KEY, JSON.stringify(all));
  }

  async function loadCatalog(): Promise<IapCatalog> {
    if (!platform) throw new Error('Sem loja nesta versão');
    catalogCache = await api.catalog(platform);
    return catalogCache;
  }

  /** Manda uma compra ao servidor e, se ele confirmar, acaba-a na loja. Sem confirmação, fica por acabar. */
  function deliver(p: StorePurchase): Promise<IapOutcome> {
    const known = inFlight.get(p.token);
    if (known) return known;
    const run = (async (): Promise<IapOutcome> => {
      if (p.state === 'pending') return { status: 'pending', productId: p.productId };
      if (p.state !== 'purchased' || !p.token || !platform) return { status: 'error', kind: 'failed', productId: p.productId };
      if (!catalogCache) await loadCatalog().catch(() => null);
      const boost = isBoostId(catalogCache, p.productId);
      const campaignId = boost ? (p.profileId || (await intents())[p.productId] || undefined) : undefined;
      let r: { ok: boolean; entitlement?: IapEntitlement };
      try {
        r = platform === 'ios'
          ? await api.appleVerify(verifyBody('ios', p, campaignId) as { signedTransaction: string; campaignId?: string })
          : await api.googleVerify(verifyBody('android', p, campaignId) as { productId: string; purchaseToken: string; campaignId?: string });
      } catch (e) {
        return classifyIapError(e) === 'network' ? { status: 'retry', productId: p.productId } : { status: 'verify-failed', productId: p.productId };
      }
      if (!r?.ok) return { status: 'verify-failed', productId: p.productId };
      // Só agora: o servidor já deu a subscrição ou ativou a campanha.
      try {
        await store.finish(p, boost);
      } catch {
        /* fica por acabar: no próximo arranque volta ao servidor, que já a conhece e responde ok outra vez */
      }
      if (boost) await setIntent(p.productId, null);
      return { status: 'done', kind: boost ? 'boost' : 'verification', productId: p.productId, campaignId, entitlement: r.entitlement ?? null };
    })();
    inFlight.set(p.token, run);
    void run.finally(() => inFlight.delete(p.token));
    return run;
  }

  async function ensure(): Promise<void> {
    if (!supported) throw Object.assign(new Error('Sem loja nesta versão'), { code: 'iap-not-available' });
    if (!connecting) {
      connecting = (async () => {
        await store.connect();
        unlisten.push(store.listen((p) => void deliver(p).then(emit)));
        unlisten.push(
          store.listenErrors((e) => {
            const kind = classifyIapError(e);
            const pid = String((e as { productId?: unknown } | null)?.productId ?? '') || [...waiting.keys()][0];
            emit(kind === 'cancelled' ? { status: 'cancelled', productId: pid } : kind === 'pending' && pid ? { status: 'pending', productId: pid } : { status: 'error', kind, productId: pid });
          }),
        );
      })();
      connecting.catch(() => {
        connecting = null;
        for (const u of unlisten) u();
        unlisten = [];
      });
    }
    return connecting;
  }

  /** Abre a folha da loja e espera pelo resultado (a compra, um erro, ou nada: então conta como pendente). */
  async function purchase(productId: string, kind: ProductKind, profileId?: string): Promise<IapOutcome> {
    const accountId = deps.userId();
    if (!accountId) return { status: 'error', kind: 'failed', productId };
    const result = new Promise<IapOutcome>((resolve) => {
      const done = (o: IapOutcome) => {
        clearTimeout(timer);
        resolve(o);
      };
      const timer = setTimeout(() => {
        if (waiting.get(productId) === done) {
          waiting.delete(productId);
          resolve({ status: 'pending', productId });
        }
      }, deps.buyTimeoutMs ?? 5 * 60_000);
      waiting.set(productId, done);
    });
    try {
      await store.buy({ productId, kind, accountId, profileId });
    } catch (e) {
      const k = classifyIapError(e);
      const o: IapOutcome = k === 'cancelled' ? { status: 'cancelled', productId } : k === 'pending' ? { status: 'pending', productId } : { status: 'error', kind: k, productId };
      emit(o);
    }
    return result;
  }

  async function recover(): Promise<IapOutcome[]> {
    await ensure();
    const out: IapOutcome[] = [];
    for (const p of await store.unfinished()) {
      const o = await deliver(p);
      out.push(o);
      emit(o);
    }
    return out;
  }

  return {
    supported,
    ensure,
    catalog: loadCatalog,
    async products(ids, kind) {
      if (!ids.length) return [];
      await ensure();
      return store.products(ids, kind);
    },
    async subscribe(productId) {
      try {
        await ensure();
      } catch (e) {
        return { status: 'error', kind: classifyIapError(e) === 'failed' ? 'unavailable' : classifyIapError(e), productId };
      }
      return purchase(productId, 'subs');
    },
    async buyBoost(productId, draft) {
      // A loja primeiro: sem loja não se cria um rascunho que ninguém vai pagar.
      try {
        await ensure();
      } catch (e) {
        return { status: 'error', kind: classifyIapError(e) === 'failed' ? 'unavailable' : classifyIapError(e), productId };
      }
      let campaignId: string;
      try {
        campaignId = (await draft()).id;
      } catch (e) {
        return { status: 'error', kind: classifyIapError(e) === 'network' ? 'network' : 'failed', productId };
      }
      await setIntent(productId, campaignId);
      return purchase(productId, 'in-app', platform === 'android' ? campaignId : undefined);
    },
    async restore() {
      if (!platform) return { ok: false, kind: 'unavailable' };
      try {
        await ensure();
        const owned = (await store.owned()).filter((p) => p.state === 'purchased' && p.token);
        await api.restore(restoreBody(platform, owned));
        await recover();
        return { ok: true };
      } catch (e) {
        return { ok: false, kind: classifyIapError(e) };
      }
    },
    recover,
    async manage(productId) {
      await store.manage(productId);
    },
    onOutcome(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      for (const u of unlisten) u();
      unlisten = [];
      connecting = null;
      listeners.clear();
      waiting.clear();
    },
  };
}
