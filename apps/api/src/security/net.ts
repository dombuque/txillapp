import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * O IP de quem faz o pedido, já sem o prefixo IPv4-mapeado («::ffff:1.2.3.4» → «1.2.3.4»).
 *
 * `req.ip` vem do Express com `trust proxy = 1`: confia só no último salto (o nginx), que escreve `X-Forwarded-For` com o
 * `$remote_addr` dele. O nginx, por sua vez, só troca o `$remote_addr` pelo `CF-Connecting-IP` quando o pedido vem de um IP
 * da Cloudflare (`set_real_ip_from` + `real_ip_header`). Um `CF-Connecting-IP` ou `X-Forwarded-For` inventado por quem liga
 * diretamente não passa.
 */
export function clientIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : null;
}

/**
 * Endereços que não contam para os limites por IP: a própria máquina e as redes privadas (o worker, os testes, os scripts de
 * manutenção dentro da rede do Docker). Em produção os pedidos de fora chegam sempre com o IP público verdadeiro.
 */
export function isInternalIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80:');
}

/** Os 8 grupos de um IPv6, por extenso. */
function expandV6(ip: string): string[] {
  const [head, tail] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const fill = tail !== undefined ? Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((g) => g.padStart(4, '0'));
}

/**
 * O «IP» e a «rede» para contar: no IPv4, o endereço e o /24; no IPv6, o /64 (um aparelho ou uma casa costuma ter um /64
 * inteiro) e o /48.
 */
export function ipParts(ip: string): { ip: string; net: string } {
  if (isIP(ip) === 4) return { ip, net: ip.split('.').slice(0, 3).join('.') + '.0/24' };
  const g = expandV6(ip);
  return { ip: g.slice(0, 4).join(':') + '::/64', net: g.slice(0, 3).join(':') + '::/48' };
}

/** Impressão cifrada (HMAC-SHA256, 32 caracteres) de um valor: serve para contar e comparar, não deixa voltar ao original. */
export const fingerprint = (salt: string, kind: string, value: string) => createHmac('sha256', salt).update(`${kind}|${value}`).digest('hex').slice(0, 32);

/** As impressões do IP e da rede de um pedido, ou null quando o IP é interno ou não se sabe. */
export function netPrints(salt: string, rawIp: string | undefined | null): { ip: string; net: string } | null {
  const ip = clientIp(rawIp);
  if (!ip || isInternalIp(ip)) return null;
  const p = ipParts(ip);
  return { ip: fingerprint(salt, 'ip', p.ip), net: fingerprint(salt, 'net', p.net) };
}

/**
 * O email «canónico»: minúsculas, sem o «+qualquercoisa» e, no Gmail, sem pontos (a Google entrega tudo na mesma caixa).
 * Serve para ver contas com o mesmo email disfarçado; nunca se guarda (só a impressão).
 */
export function canonicalEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  let local = email.slice(0, at).split('+')[0];
  let domain = email.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}
