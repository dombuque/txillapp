import sharp from 'sharp';
import { ALLOWED_HOSTS } from './curation';

/**
 * As cores da capa de uma faixa, para o fundo em gradiente do destaque no seletor da app («Para ti»). Calculadas com sharp
 * quando a faixa entra no catálogo (ou quando a capa muda) e guardadas em `content.music_catalog.cover_tint`.
 */

/** De onde se vão buscar capas: os anfitriões das faixas e o das capas do Jamendo (usercontent.jamendo.com). */
const COVER_HOSTS = [...ALLOWED_HOSTS, 'jamendo.com'];
/** Capas maiores do que isto não se leem. */
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 8_000;

export const coverHostOk = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && COVER_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
};

type Rgb = [number, number, number];
const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
/** Luminância relativa (WCAG), de 0 (preto) a 1 (branco). */
export function luminance([r, g, b]: Rgb) {
  const c = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
const scale = ([r, g, b]: Rgb, k: number): Rgb => [r * k, g * k, b * k];
/** Escurece a cor até o texto branco por cima se ler bem (luminância até `max`). */
function readable(c: Rgb, max: number): Rgb {
  let out = c;
  for (let i = 0; i < 30 && luminance(out) > max; i++) out = scale(out, 0.88);
  return out;
}
const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * As duas cores do gradiente a partir dos píxeis RGB da capa (pequena): a cor que domina (as vivas pesam mais do que os
 * cinzentos, o branco e o preto) e uma segunda bem diferente, se houver, senão a mesma mais escura. As duas vêm escurecidas
 * o bastante para o título a branco se ler. Devolve null sem píxeis.
 */
export function tintFromPixels(px: Uint8Array, channels = 3): [string, string] | null {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number; w: number }>();
  for (let i = 0; i + 2 < px.length; i += channels) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    const v = max / 255;
    let w = 1 + 4 * sat;
    if (v < 0.1 || (v > 0.92 && sat < 0.12)) w *= 0.15; // quase preto ou quase branco: conta pouco
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const k = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, w: 0 };
    k.r += r;
    k.g += g;
    k.b += b;
    k.n++;
    k.w += w;
    buckets.set(key, k);
  }
  if (!buckets.size) return null;
  const ranked = [...buckets.values()].sort((a, b) => b.w - a.w).map((k) => ({ c: [k.r / k.n, k.g / k.n, k.b / k.n] as Rgb, w: k.w }));
  const main = ranked[0].c;
  const other = ranked.find((x) => dist(x.c, main) > 90 && x.w >= ranked[0].w * 0.15)?.c;
  const c1 = readable(main, 0.22);
  const c2 = other ? readable(scale(other, 0.8), 0.12) : readable(scale(c1, 0.45), 0.08);
  return [hex(c1), hex(c2)];
}

/** Vai buscar a capa (só https, só anfitriões permitidos, também nos redireccionamentos) e calcula as cores. null se falhar. */
export async function coverTint(url: string, fetcher: typeof fetch): Promise<[string, string] | null> {
  let at = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!coverHostOk(at)) return null;
    const res = await fetcher(at, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) return null;
      at = new URL(next, at).toString();
      continue;
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    const { data, info } = await sharp(buf, { limitInputPixels: 40_000_000 }).resize(24, 24, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return tintFromPixels(data, info.channels);
  }
  return null;
}
