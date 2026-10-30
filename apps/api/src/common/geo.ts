import type { Request } from 'express';

/**
 * País de onde vem o pedido. O nginx preenche X-Client-Country a partir do cabeçalho do Cloudflare (CF-IPCountry) e apaga
 * qualquer valor que o cliente tenha enviado; a API só é alcançável através dele. "XX" (desconhecido) e "T1" (Tor) não contam.
 */
export function countryOf(req: Pick<Request, 'headers'>): string | null {
  const raw = req.headers['x-client-country'];
  const c = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : null;
}
