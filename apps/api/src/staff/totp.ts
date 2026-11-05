import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Dois passos (TOTP, RFC 6238): SHA-1, 6 dígitos, 30 s, como as apps autenticadoras (Google Authenticator, Authy…). */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newSecret(): string {
  const buf = randomBytes(20);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function unbase32(s: string): Buffer {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) throw new Error('segredo inválido');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', unbase32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

/** Aceita o código do momento e o anterior/seguinte (relógios um pouco desencontrados). */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  let ok = false;
  for (const w of [-1, 0, 1]) {
    const expected = Buffer.from(totp(secret, now + w * 30_000));
    if (timingSafeEqual(expected, Buffer.from(c))) ok = true;
  }
  return ok;
}

export const otpauthUrl = (secret: string, email: string) =>
  `otpauth://totp/${encodeURIComponent('Txillapp Backoffice')}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent('Txillapp Backoffice')}&algorithm=SHA1&digits=6&period=30`;

/** Cifra o segredo guardado na base de dados (AES-256-GCM, chave derivada do segredo da app). */
const key = (appSecret: string) => createHash('sha256').update(`staff-totp:${appSecret}`).digest();
export function seal(secret: string, appSecret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(appSecret), iv);
  const enc = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
export function unseal(sealed: string, appSecret: string): string {
  const [iv, tag, enc] = sealed.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key(appSecret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
