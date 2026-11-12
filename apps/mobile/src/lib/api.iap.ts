/** Compras pela loja (App Store e Google Play): o contrato da API em /iap. Ver lib/iap/core.ts. */
import { post, raw } from '@/lib/api';
import type { IapApi, IapCatalog, IapPlatform } from '@/lib/iap/core';

export const iapApi: IapApi = {
  catalog: (platform: IapPlatform): Promise<IapCatalog> => raw(`/iap/catalog?platform=${platform}`),
  appleVerify: (b) => raw('/iap/apple/verify', post(b)),
  googleVerify: (b) => raw('/iap/google/verify', post(b)),
  restore: (b) => raw('/iap/restore', post(b)),
};

/** A mesma cache em todos os ecrãs (Definições, selo azul, Bombar). */
export const iapCatalogKey = (platform: IapPlatform | null) => ['iap-catalog', platform] as const;
