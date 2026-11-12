/**
 * O selo de verificado de uma pessoa, com os mesmos nomes dos posts e do perfil: `verified` (u.verified) e `verifiedTier`
 * (u.verified_tier). Três níveis: 'verified' (verificado pelo Txillapp, por mérito ou pedido aceite) e 'official' (conta
 * oficial do Txillapp), os dois a vermelho; e 'paid' (verificação paga), a azul.
 */
export const VERIFIED_TIERS = ['verified', 'official', 'paid'] as const;
export type VerifiedTier = (typeof VERIFIED_TIERS)[number];
export type Badge = { verified: boolean; verifiedTier: VerifiedTier | null };

const isTier = (t: unknown): t is VerifiedTier => typeof t === 'string' && (VERIFIED_TIERS as readonly string[]).includes(t);

/** O nível do selo de uma conta: null se não é verificada; sem nível (ou um desconhecido), o 'verified' de sempre. */
export const tierOf = (verified: unknown, tier: unknown): VerifiedTier | null => (verified === true ? (isTier(tier) ? tier : 'verified') : null);

export const badge = (verified: unknown, tier: unknown): Badge => ({
  verified: verified === true,
  verifiedTier: (tier as Badge['verifiedTier'] | undefined) ?? null,
});

/** Colunas para um SELECT: `badgeCols('u')` → `u.verified, u.verified_tier`; com prefixo, `u.verified AS x_verified, u.verified_tier AS x_verified_tier`. */
export const badgeCols = (alias: string, prefix = '') =>
  prefix ? `${alias}.verified AS ${prefix}_verified, ${alias}.verified_tier AS ${prefix}_verified_tier` : `${alias}.verified, ${alias}.verified_tier`;

/** Para json_build_object: `'verified', u.verified, 'verifiedTier', u.verified_tier`. */
export const badgeJson = (alias: string) => `'verified', ${alias}.verified, 'verifiedTier', ${alias}.verified_tier`;
