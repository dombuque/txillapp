import { useQuery } from '@tanstack/react-query';
import { extraApi } from './api.extra';
import { CHANNEL } from './distribution';
import { STORE_TOPUP_READY, isStoreChannel, purchaseRulesFor, type PurchaseRules } from './storeRules';

/**
 * O que se compra nesta cópia da app sem perguntar ao servidor (ver storeRules.ts): nas versões das lojas, nada por fora
 * da loja. Serve para o que não pode esperar pela rede; os ecrãs usam usePurchases().
 */
export const PURCHASES = purchaseRulesFor(CHANNEL);

/** Só nas lojas, e só se esta versão já o permitir, vale a pena perguntar ao servidor pelo interruptor da recarga. */
const ASK = isStoreChannel(CHANNEL) && STORE_TOPUP_READY;

/**
 * As regras com o interruptor do servidor (`storeTopup` em GET /payments/config; a mesma cache do ecrã dos pedidos).
 * Enquanto não há resposta, ou se falhar, fica tudo como em PURCHASES (nas lojas: sem recarga).
 */
export function usePurchases(): PurchaseRules & { /** Ainda à espera do servidor (só nas lojas com STORE_TOPUP_READY). */ pending: boolean } {
  const q = useQuery({ queryKey: ['payments-config'], queryFn: extraApi.paymentsConfig, staleTime: 5 * 60_000, enabled: ASK, retry: false });
  return ASK ? { ...purchaseRulesFor(CHANNEL, q.data), pending: q.isLoading } : { ...PURCHASES, pending: false };
}
