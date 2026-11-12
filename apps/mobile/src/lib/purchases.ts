import { useQuery } from '@tanstack/react-query';
import { extraApi } from './api.extra';
import { iapApi, iapCatalogKey } from './api.iap';
import { CHANNEL } from './distribution';
import { iapPlatformFor } from './iap/core';
import { STORE_TOPUP_READY, askStoreCatalog, isStoreChannel, purchaseRulesFor, type PurchaseRules } from './storeRules';

/**
 * O que se compra nesta cópia da app sem perguntar ao servidor (ver storeRules.ts): nas versões das lojas, nada por fora
 * da loja. Serve para o que não pode esperar pela rede; os ecrãs usam usePurchases().
 */
export const PURCHASES = purchaseRulesFor(CHANNEL);

/** Só nas lojas, e só se esta versão já o permitir, vale a pena perguntar ao servidor pelo interruptor da recarga. */
const ASK = isStoreChannel(CHANNEL) && STORE_TOPUP_READY;

/** A loja desta cópia (null no APK beta e na web). */
export const IAP_PLATFORM = iapPlatformFor(CHANNEL);

/** Só nas lojas e com IAP_READY se pergunta pelo catálogo da loja (GET /iap/catalog). Desligado, nem se pergunta. */
export const ASK_IAP = askStoreCatalog(CHANNEL) && !!IAP_PLATFORM;

/** O catálogo das compras pela loja (o selo azul e os pacotes do Bombar), só quando pode haver compras pela loja. */
export function useIapCatalog() {
  return useQuery({ queryKey: iapCatalogKey(IAP_PLATFORM), queryFn: () => iapApi.catalog(IAP_PLATFORM!), staleTime: 5 * 60_000, enabled: ASK_IAP, retry: false });
}

/**
 * As regras com os interruptores do servidor (`storeTopup` em GET /payments/config; `enabled` em GET /iap/catalog).
 * Enquanto não há resposta, ou se falhar, fica tudo como em PURCHASES (nas lojas: sem recarga e sem compras pela loja).
 */
export function usePurchases(): PurchaseRules & { /** Ainda à espera do servidor (só nas lojas com os interruptores da versão ligados). */ pending: boolean } {
  const q = useQuery({ queryKey: ['payments-config'], queryFn: extraApi.paymentsConfig, staleTime: 5 * 60_000, enabled: ASK, retry: false });
  const iap = useIapCatalog();
  if (!ASK && !ASK_IAP) return { ...PURCHASES, pending: false };
  return {
    ...purchaseRulesFor(CHANNEL, { storeTopup: ASK ? q.data?.storeTopup : undefined, iap: ASK_IAP ? iap.data?.enabled : undefined }),
    pending: (ASK && q.isLoading) || (ASK_IAP && iap.isLoading),
  };
}
