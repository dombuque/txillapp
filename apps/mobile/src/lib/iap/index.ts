import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { iapApi, iapCatalogKey } from '@/lib/api.iap';
import { kvGet, kvSet } from '@/lib/kv';
import { ASK_IAP, IAP_PLATFORM, useIapCatalog } from '@/lib/purchases';
import { createIap, type IapOutcome } from './core';
import { nativeStore } from './store';

/**
 * As compras pela loja desta cópia da app (uma só para toda a app). Fora das lojas (APK beta, web) ou com IAP_READY
 * desligado não há loja: `supported` é false e nada abre a ligação ao StoreKit nem ao Play Billing.
 */
let currentUser: string | null = null;
export const iap = createIap({
  platform: ASK_IAP ? IAP_PLATFORM : null,
  store: nativeStore,
  api: iapApi,
  storage: { get: kvGet, set: kvSet },
  userId: () => currentUser,
});

/**
 * No arranque (com sessão e com as compras pela loja ligadas): abre a ligação à loja e manda ao servidor as compras que
 * ficaram por acabar (também as que falharam a confirmação), e outra vez sempre que a app volta a primeiro plano.
 * Cada compra confirmada atualiza o catálogo, a verificação e o Bombar.
 */
export function useIapRuntime(userId: string | null) {
  const qc = useQueryClient();
  const catalog = useIapCatalog();
  const on = iap.supported && !!userId && !!catalog.data && (catalog.data.enabled || !!catalog.data.verification.active);
  useEffect(() => {
    currentUser = userId;
  }, [userId]);
  useEffect(() => {
    if (!on) return;
    const off = iap.onOutcome((o: IapOutcome) => {
      if (o.status !== 'done') return;
      void qc.invalidateQueries({ queryKey: iapCatalogKey(IAP_PLATFORM) });
      void qc.invalidateQueries({ queryKey: ['verification'] });
      if (o.kind === 'boost') void qc.invalidateQueries({ queryKey: ['venue-boosts'] });
    });
    const again = () => void iap.recover().catch(() => undefined);
    again();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') again();
    });
    return () => {
      off();
      sub.remove();
    };
  }, [on, qc]);
}
