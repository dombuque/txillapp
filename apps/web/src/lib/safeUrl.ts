/** Endereço escrito por pessoas (site do perfil, do sítio, créditos): só http(s). Outro esquema (javascript:, data:…) dá null e fica texto. */
export const httpHref = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : null;
  } catch {
    return null;
  }
};
