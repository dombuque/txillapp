import { z } from 'zod';

/**
 * GIFs do GIPHY: a parte pura (sem Nest nem base de dados), partilhada pelo módulo dos GIFs, pelo chat e pelos comentários.
 *
 * Um GIF numa mensagem ou num comentário guarda-se só como { id, w, h, url } (e, opcionais, `still`, `title` e `rating`):
 *  - `url` e `still` têm de ser https e de um anfitrião de média do GIPHY (media.giphy.com, media0..media9.giphy.com),
 *    com o caminho /media/…/<id>/… e terminados em .gif ou .webp. A query (cid, rid, ct: analítica do GIPHY) sai antes de guardar;
 *  - `id` é o id do GIPHY (letras e números);
 *  - `w` e `h` em píxeis, entre 16 e 2000, com proporção entre 1:5 e 5:1;
 *  - `rating` é a classificação do GIPHY ('y', 'g', 'pg', 'pg-13', 'r'), que a grelha traz em cada GIF. Nas notas, nas mensagens e nos comentários, quem
 *    é menor de 18 (ou não tem data de nascimento) não recebe um GIF acima de 'g' nem um sem classificação (gifForMinor);
 *    nas mensagens e nos comentários vem `gif: null` e `gifHidden: true`. Ao gravar, a classificação é a do GIPHY (GifsService.confirm).
 * As imagens são carregadas pelo aparelho diretamente da CDN do GIPHY (não passam pelo nosso servidor).
 *
 * Há também uma fonte própria, `source: 'txillapp'`: o logótipo animado do Txillapp (scripts/marca/anim-logo.mjs), servido
 * pelo nosso site em https://txillapp.com/marca/. Lista fechada de ids (TXILLAPP_GIFS) e, para cada um, só os urls desses
 * ficheiros; as medidas são as do ficheiro e a classificação é sempre 'g' (para todas as idades). O GIPHY não é chamado.
 * Qualquer outro id ou url com esta fonte: 400. Sem `source` (os GIFs de sempre), é do GIPHY.
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

/* ───────────── a fonte própria: o GIF «Txillapp» ───────────── */

/** De onde vêm os GIFs do Txillapp (o nosso site; os ficheiros estão em apps/mobile/public/marca e apps/web/public/marca). */
export const TXILLAPP_GIF_ORIGIN = 'https://txillapp.com';
/** As medidas dos ficheiros (scripts/marca/anim-logo.mjs, 480 px de largura). */
export const TXILLAPP_GIF_SIZE = { w: 480, h: 211 } as const;
/**
 * Os GIFs do Txillapp, por id: o ficheiro animado (sem extensão: há .webp e .gif) e a imagem parada.
 *  - logo: letras pretas, fundo transparente (fundos claros); a app mostra a versão branca num fundo escuro;
 *  - logo-branco: letras brancas, fundo transparente (fundos escuros, fotos e vídeos);
 *  - logo-fundo: letras pretas sobre fundo branco.
 */
export const TXILLAPP_GIFS: Readonly<Record<string, { file: string; still: string }>> = {
  logo: { file: 'txillapp-animado', still: 'txillapp-final.png' },
  'logo-branco': { file: 'txillapp-animado-branco', still: 'txillapp-final-branco.png' },
  'logo-fundo': { file: 'txillapp-animado-fundo', still: 'txillapp-final-fundo.png' },
};
export const TXILLAPP_GIF_TITLE = 'Txillapp';
export type GifSource = 'txillapp';
const isTxillappId = (id: unknown): id is string => typeof id === 'string' && Object.prototype.hasOwnProperty.call(TXILLAPP_GIFS, id);

/** O url de um GIF do Txillapp se for exatamente um dos ficheiros deste id (.webp ou .gif); senão null. */
export function txillappMediaUrl(raw: unknown, id: string): string | null {
  if (!isTxillappId(id) || typeof raw !== 'string') return null;
  const base = `${TXILLAPP_GIF_ORIGIN}/marca/${TXILLAPP_GIFS[id].file}`;
  return raw === `${base}.webp` || raw === `${base}.gif` ? raw : null;
}
/** A imagem parada de um GIF do Txillapp se for exatamente a deste id; senão null. */
export function txillappStillUrl(raw: unknown, id: string): string | null {
  if (!isTxillappId(id)) return null;
  const still = `${TXILLAPP_GIF_ORIGIN}/marca/${TXILLAPP_GIFS[id].still}`;
  return raw === still ? still : null;
}

/** As classificações do GIPHY, da mais leve para a mais forte. */
export const GIF_RATINGS = ['y', 'g', 'pg', 'pg-13', 'r'] as const;
export type GifRatingValue = (typeof GIF_RATINGS)[number];
/** Lê uma classificação (em minúsculas, sem espaços); desconhecida = null. */
export function readRating(v: unknown): GifRatingValue | null {
  const r = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (GIF_RATINGS as readonly string[]).includes(r) ? (r as GifRatingValue) : null;
}
/** Um GIF que um menor de 18 pode ver: só 'y' ou 'g' (sem classificação, não). */
export const gifForMinor = (rating: unknown) => { const r = readRating(rating); return r === 'y' || r === 'g'; };

/** Medidas razoáveis para uma bolha ou um comentário. */
export const sizeOk = (w: number, h: number) => Number.isInteger(w) && Number.isInteger(h) && w >= 16 && h >= 16 && w <= 2000 && h <= 2000 && w / h <= 5 && h / w <= 5;

/** O GIF que a app manda numa mensagem ou num comentário (validado aqui; o url sai limpo). */
export const gifSchema = z
  .object({
    id: z.string().max(40),
    /** 'txillapp': o GIF do Txillapp (lista fechada); sem isto, do GIPHY. */
    source: z.enum(['txillapp'], { message: 'GIF inválido' }).optional(),
    w: z.number().int(),
    h: z.number().int(),
    url: z.string().max(600),
    still: z.string().max(600).optional(),
    title: z.string().max(200).optional(),
    /** A classificação do GIPHY (a grelha manda-a); desconhecida fica de fora. */
    rating: z.string().max(10).optional(),
  })
  .transform((g, ctx): StoredGif => {
    if (g.source === 'txillapp') {
      // O GIF do Txillapp: só os ids e os ficheiros da lista; medidas, título e classificação são os nossos.
      if (!isTxillappId(g.id)) {
        ctx.addIssue({ code: 'custom', path: ['id'], message: 'GIF inválido' });
        return z.NEVER;
      }
      const url = txillappMediaUrl(g.url, g.id);
      const still = g.still === undefined ? undefined : txillappStillUrl(g.still, g.id);
      if (!url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'Esse GIF não é do Txillapp' });
      if (still === null) ctx.addIssue({ code: 'custom', path: ['still'], message: 'Esse GIF não é do Txillapp' });
      if (!url || still === null) return z.NEVER;
      return { id: g.id, ...TXILLAPP_GIF_SIZE, url, ...(still ? { still } : {}), title: TXILLAPP_GIF_TITLE, rating: 'g', source: 'txillapp' };
    }
    if (!GIPHY_ID.test(g.id)) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'GIF inválido' });
      return z.NEVER;
    }
    const url = giphyMediaUrl(g.url, g.id);
    const still = g.still === undefined ? undefined : giphyMediaUrl(g.still, g.id);
    if (!url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'O GIF tem de vir do GIPHY' });
    if (still === null) ctx.addIssue({ code: 'custom', path: ['still'], message: 'O GIF tem de vir do GIPHY' });
    if (!sizeOk(g.w, g.h)) ctx.addIssue({ code: 'custom', path: ['w'], message: 'Tamanho do GIF inválido' });
    if (!url || still === null || !sizeOk(g.w, g.h)) return z.NEVER;
    const title = (g.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const rating = readRating(g.rating);
    return { id: g.id, w: g.w, h: g.h, url, ...(still ? { still } : {}), ...(title ? { title } : {}), ...(rating ? { rating } : {}) };
  });
export type GifInput = z.infer<typeof gifSchema>;

/** O que fica guardado (coluna jsonb `gif`) e o que a app recebe de volta. */
export interface StoredGif { id: string; w: number; h: number; url: string; still?: string; title?: string; rating?: GifRatingValue; /** 'txillapp': o GIF do Txillapp; sem isto, do GIPHY. */ source?: GifSource }

/** Lê o jsonb guardado (defensivo: se alguma coisa não bater certo, não se mostra). */
export function readGif(v: unknown): StoredGif | null {
  if (!v || typeof v !== 'object') return null;
  const g = v as Record<string, unknown>;
  if (g.source === 'txillapp') {
    // O do Txillapp: só da lista e dos nossos ficheiros (medidas e classificação fixas).
    if (!isTxillappId(g.id)) return null;
    const url = txillappMediaUrl(g.url, g.id);
    if (!url) return null;
    const still = txillappStillUrl(g.still, g.id);
    return { id: g.id, ...TXILLAPP_GIF_SIZE, url, ...(still ? { still } : {}), title: TXILLAPP_GIF_TITLE, rating: 'g', source: 'txillapp' };
  }
  if (g.source !== undefined) return null;
  if (typeof g.id !== 'string' || !GIPHY_ID.test(g.id) || typeof g.w !== 'number' || typeof g.h !== 'number' || !sizeOk(g.w, g.h)) return null;
  const url = giphyMediaUrl(g.url, g.id);
  if (!url) return null;
  const still = giphyMediaUrl(g.still, g.id);
  const title = typeof g.title === 'string' ? g.title.slice(0, 100) : '';
  const rating = readRating(g.rating);
  return { id: g.id, w: g.w, h: g.h, url, ...(still ? { still } : {}), ...(title ? { title } : {}), ...(rating ? { rating } : {}) };
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
  /** A classificação do GIPHY ('g', 'pg', 'pg-13'…), para a nota a guardar. */
  rating?: string;
}
export interface GifPage { items: GifItem[]; next: number | null }

type Rendition = { url?: string; width?: string | number; height?: string | number; webp?: string; mp4?: string };
interface GiphyGif { id?: string; title?: string; rating?: string; images?: Record<string, Rendition | undefined> }

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
    const rating = readRating(g.rating);
    items.push({ id, title, w, h, preview, full, ...(still ? { still } : {}), ...(mp4 ? { mp4 } : {}), ...(rating ? { rating } : {}) });
  }
  const p = b.pagination ?? {};
  const count = typeof p.count === 'number' ? p.count : data.length;
  const total = typeof p.total_count === 'number' ? p.total_count : null;
  const after = offset + count;
  const more = count > 0 && (total === null ? count >= limit : after < total) && after <= MAX_OFFSET;
  return { items, next: more ? after : null };
}
