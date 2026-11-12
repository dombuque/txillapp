import { CHANNEL } from './distribution';
import { purchaseRulesFor } from './storeRules';

/** O que se compra nesta cópia da app (ver storeRules.ts): nas versões das lojas, nada por fora da loja. */
export const PURCHASES = purchaseRulesFor(CHANNEL);
