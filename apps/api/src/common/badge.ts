/**
 * O selo de verificado de uma pessoa, com os mesmos nomes dos posts e do perfil:
 * `verified` (u.verified) e `verifiedTier` (u.verified_tier: 'verified' azul, 'official' coral).
 */
export type Badge = { verified: boolean; verifiedTier: 'verified' | 'official' | null };

export const badge = (verified: unknown, tier: unknown): Badge => ({
  verified: verified === true,
  verifiedTier: (tier as Badge['verifiedTier'] | undefined) ?? null,
});

/** Colunas para um SELECT: `badgeCols('u')` → `u.verified, u.verified_tier`; com prefixo, `u.verified AS x_verified, u.verified_tier AS x_verified_tier`. */
export const badgeCols = (alias: string, prefix = '') =>
  prefix ? `${alias}.verified AS ${prefix}_verified, ${alias}.verified_tier AS ${prefix}_verified_tier` : `${alias}.verified, ${alias}.verified_tier`;

/** Para json_build_object: `'verified', u.verified, 'verifiedTier', u.verified_tier`. */
export const badgeJson = (alias: string) => `'verified', ${alias}.verified, 'verifiedTier', ${alias}.verified_tier`;
