import { z } from 'zod';

/**
 * GIFs do GIPHY: a parte pura (sem Nest nem base de dados), partilhada pelo módulo dos GIFs, pelo chat e pelos comentários.
 *
 * Um GIF numa mensagem ou num comentário guarda-se só como { id, w, h, url } (e, opcionais, `still` e `title`):
 *  - `url` e `still` têm de ser https e de um anfitrião de média do GIPHY (media.giphy.com, media0..media9.giphy.com),
 *    com o caminho /media/…/<id>/… e terminados em .gif ou .webp. A query (cid, rid, ct: analítica do GIPHY) sai antes de guardar;
 *  - `id` é o id do GIPHY (letras e números);
 *  - `w` e `h` em píxeis, entre 16 e 2000, com proporção entre 1:5 e 5:1.
 * As imagens são carregadas pelo aparelho diretamente da CDN do GIPHY (não passam pelo nosso servidor).
 */

/** Os anfitriões de média do GIPHY que aceitamos. */
export const GIPHY_MEDIA_HOST = /^media[0-9]?\.giphy\.com$/;
/** O id de um GIF no GIPHY. */
export const GIPHY_ID = /^[A-Za-z0-9]{4,40}$/;
const MEDIA_PATH = /^\/media\/(?:[A-Za-z0-9._=-]{1,200}\/)*([A-Za-z0-9]{4,40})\/[A-Za-z0-9_.-]{1,40}\.(?:gif|webp)$/;

/** O url limpo (sem query nem #) se for um url de média do GIPHY para este id; senão null. */
export function giphyMediaUrl(raw: unknown, id?: string): string | null {
  if (typeof raw !== 'string' || raw.length > 600) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !GIPHY_MEDIA_HOST.test(u.hostname)) return null;
  const m = MEDIA_PATH.exec(u.pathname);
  if (!m) return null;
  // O id tem de aparecer no caminho (o GIPHY põe sempre o id do GIF no url da imagem).
  if (id !== undefined && !u.pathname.split('/').includes(id)) return null;
  return `https://${u.hostname}${u.pathname}`;
}

/** Medidas razoáveis para uma bolha ou um comentário. */
export const sizeOk = (w: number, h: number) => Number.isInteger(w) && Number.isInteger(h) && w >= 16 && h >= 16 && w <= 2000 && h <= 2000 && w / h <= 5 && h / w <= 5;

/** O GIF que a app manda numa mensagem ou num comentário (validado aqui; o url sai limpo). */
export const gifSchema = z
  .object({
    id: z.string().regex(GIPHY_ID, 'GIF inválido'),
    w: z.number().int(),
    h: z.number().int(),
    url: z.string().max(600),
    still: z.string().max(600).optional(),
    title: z.string().max(200).optional(),
  })
  .transform((g, ctx) => {
    const url = giphyMediaUrl(g.url, g.id);
    const still = g.still === undefined ? undefined : giphyMediaUrl(g.still, g.id);
    if (!url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'O GIF tem de vir do GIPHY' });
    if (still === null) ctx.addIssue({ code: 'custom', path: ['still'], message: 'O GIF tem de vir do GIPHY' });
    if (!sizeOk(g.w, g.h)) ctx.addIssue({ code: 'custom', path: ['w'], message: 'Tamanho do GIF inválido' });
    if (!url || still === null || !sizeOk(g.w, g.h)) return z.NEVER;
    const title = (g.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
    return { id: g.id, w: g.w, h: g.h, url, ...(still ? { still } : {}), ...(title ? { title } : {}) };
  });
export type GifInput = z.infer<typeof gifSchema>;

/** O que fica guardado (coluna jsonb `gif`) e o que a app recebe de volta. */
export interface StoredGif { id: string; w: number; h: number; url: string; still?: string; title?: string }

/** Lê o jsonb guardado (defensivo: se alguma coisa não bater certo, não se mostra). */
export function readGif(v: unknown): StoredGif | null {
  if (!v || typeof v !== 'object') return null;
  const g = v as Record<string, unknown>;
  if (typeof g.id !== 'string' || !GIPHY_ID.test(g.id) || typeof g.w !== 'number' || typeof g.h !== 'number' || !sizeOk(g.w, g.h)) return null;
  const url = giphyMediaUrl(g.url, g.id);
  if (!url) return null;
  const still = giphyMediaUrl(g.still, g.id);
  const title = typeof g.title === 'string' ? g.title.slice(0, 100) : '';
  return { id: g.id, w: g.w, h: g.h, url, ...(still ? { still } : {}), ...(title ? { title } : {}) };
}

/* ───────────── respostas do GIPHY ───────────── */

/** Um GIF na lista que a app recebe (só o que precisa). */
export interface GifItem {
  id: string;
  title: string;
  w: number;
  h: number;
  /** Pequeno, para a grelha. */
  preview: string;
  /** O que vai na mensagem. */
  full: string;
  /** Primeira imagem, parada ("Reduzir movimento"). */
  still?: string;
  mp4?: string;
}
export interface GifPage { items: GifItem[]; next: number | null }

type Rendition = { url?: string; width?: string | number; height?: string | number; webp?: string; mp4?: string };
interface GiphyGif { id?: string; title?: string; images?: Record<string, Rendition | undefined> }

/** O maior offset que a pesquisa do GIPHY aceita. */
export const MAX_OFFSET = 4999;

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN);
/** O mp4 só se for https do GIPHY (a app pode usá-lo como vídeo leve). */
function giphyMp4(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && GIPHY_MEDIA_HOST.test(u.hostname) && u.pathname.endsWith('.mp4') ? `https://${u.hostname}${u.pathname}` : null;
  } catch {
    return null;
  }
}

/** A imagem parada de um url fixed_width do GIPHY (…/200w.gif ou .webp → …/200w_s.gif); null se não tiver esse feitio. */
export function stillOf(url: string | null): string | null {
  if (!url || !/\/200w\.(?:gif|webp)$/.test(url)) return null;
  return url.replace(/\/200w\.(?:gif|webp)$/, '/200w_s.gif');
}

/** Uma resposta do GIPHY (search/trending) → a página que a app recebe. O que não for do GIPHY ou não tiver medidas sai. */
export function mapGiphy(body: unknown, offset: number, limit: number): GifPage {
  const b = (body ?? {}) as { data?: unknown; pagination?: { total_count?: number; count?: number; offset?: number } };
  const data = Array.isArray(b.data) ? (b.data as GiphyGif[]) : [];
  const items: GifItem[] = [];
  for (const g of data) {
    const id = typeof g?.id === 'string' && GIPHY_ID.test(g.id) ? g.id : null;
    const im = g?.images ?? {};
    if (!id) continue;
    const fw = im.fixed_width ?? im.downsized ?? im.downsized_medium;
    const small = im.fixed_width_small ?? im.fixed_width_downsampled ?? im.preview_gif ?? fw;
    if (!fw) continue;
    const w = num(fw.width);
    const h = num(fw.height);
    if (!sizeOk(w, h)) continue;
    // WebP animado quando houver (mais leve); senão o GIF.
    const full = giphyMediaUrl(fw.webp, id) ?? giphyMediaUrl(fw.url, id);
    if (!full) continue;
    const preview = giphyMediaUrl(small?.webp, id) ?? giphyMediaUrl(small?.url, id) ?? full;
    // O bundle messaging_non_clips não traz as imagens paradas: deriva-se a do fixed_width (…/200w.gif → …/200w_s.gif, a
    // convenção da CDN do GIPHY, confirmada com pedidos reais).
    const still = giphyMediaUrl(im.fixed_width_still?.url, id) ?? giphyMediaUrl(im.fixed_width_small_still?.url, id) ?? giphyMediaUrl(im.original_still?.url, id) ?? stillOf(giphyMediaUrl(fw.url, id));
    const mp4 = giphyMp4(fw.mp4);
    const title = typeof g.title === 'string' ? g.title.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
    items.push({ id, title, w, h, preview, full, ...(still ? { still } : {}), ...(mp4 ? { mp4 } : {}) });
  }
  const p = b.pagination ?? {};
  const count = typeof p.count === 'number' ? p.count : data.length;
  const total = typeof p.total_count === 'number' ? p.total_count : null;
  const after = offset + count;
  const more = count > 0 && (total === null ? count >= limit : after < total) && after <= MAX_OFFSET;
  return { items, next: more ? after : null };
}
