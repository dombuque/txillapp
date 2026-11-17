// GIFs do GIPHY na app: a lógica pura (sem React Native), testada em tests/gifs.test.mjs.
// As listas vêm do nosso servidor (/api/v1/gifs/*: a chave do GIPHY fica lá e o GIPHY não vê quem pesquisa); as imagens
// carregam-se diretamente da CDN do GIPHY (media*.giphy.com).
// E o GIF «Txillapp» (source 'txillapp'): o logótipo animado, servido pelo nosso site (https://txillapp.com/marca/, gerado por
// scripts/marca/anim-logo.mjs). Lista fechada de ids, como na API (apps/api/src/gifs/gif.ts TXILLAPP_GIFS); classificação 'g'.

/** Um GIF na grelha (o que o servidor manda). `rating`: a classificação do GIPHY ('g', 'pg', 'pg-13', 'r'), se vier. */
export interface GifItem { id: string; title: string; w: number; h: number; preview: string; full: string; still?: string; mp4?: string; rating?: string; /** 'txillapp': o GIF do Txillapp. */ source?: GifSource }
export interface GifPage { items: GifItem[]; next: number | null; enabled?: false }
/**
 * O GIF de uma mensagem ou de um comentário (o que fica guardado). `rating` vai com ele: nas notas, o servidor não mostra
 * um GIF acima de 'g' (ou sem classificação) a quem tem menos de 18 anos ou não indicou a data de nascimento.
 */
export interface ChatGif { id: string; w: number; h: number; url: string; still?: string; title?: string; rating?: string; /** 'txillapp': o GIF do Txillapp; sem isto, do GIPHY. */ source?: GifSource }

/**
 * O cartão no lugar de um GIF que não se mostra: o servidor não manda o GIF (`gifHidden`) a quem é menor de 18 anos ou
 * não tem data de nascimento quando a classificação do GIPHY é acima de «g» ou desconhecida (as mensagens antigas).
 */
export const GIF_HIDDEN_TEXT = 'GIF escondido';

/** O texto de uma mensagem GIF na lista de conversas: «GIF» ou, se o servidor o escondeu, «GIF escondido». */
export function gifPreviewText(m: { gifHidden?: boolean }): string {
  return m.gifHidden ? GIF_HIDDEN_TEXT : 'GIF';
}

/** Os anfitriões de média do GIPHY (o servidor recusa os outros). */
const HOST = /^media[0-9]?\.giphy\.com$/;
const ID = /^[A-Za-z0-9]{4,40}$/;

export type GifSource = 'txillapp';

/* ───────────── o GIF «Txillapp» ───────────── */

/** De onde vêm os ficheiros (o nosso site, com cache; apps/mobile/public/marca). */
export const TXILLAPP_GIF_ORIGIN = 'https://txillapp.com';
/** O nome do GIF da marca (no painel, na reação e para o leitor de ecrã). */
export const TXILLAPP_GIF_TITLE = 'Txillapp';
const TX_SIZE = { w: 480, h: 211 };
/** Os ficheiros de cada id: o animado (sem extensão: .webp e .gif) e a imagem parada. */
const TX_FILES: Record<string, { file: string; still: string }> = {
  logo: { file: 'txillapp-animado', still: 'txillapp-final.png' },
  'logo-branco': { file: 'txillapp-animado-branco', still: 'txillapp-final-branco.png' },
  'logo-fundo': { file: 'txillapp-animado-fundo', still: 'txillapp-final-fundo.png' },
};
const txUrl = (name: string) => `${TXILLAPP_GIF_ORIGIN}/marca/${name}`;
const isTxId = (id: unknown): id is string => typeof id === 'string' && Object.prototype.hasOwnProperty.call(TX_FILES, id);

/** O GIF do Txillapp (letras pretas, fundo transparente; num fundo escuro a app mostra o branco), como item da grelha. */
export const TXILLAPP_GIF: GifItem = {
  id: 'logo', title: TXILLAPP_GIF_TITLE, ...TX_SIZE, preview: txUrl('txillapp-animado.webp'), full: txUrl('txillapp-animado.webp'),
  still: txUrl('txillapp-final.png'), rating: 'g', source: 'txillapp',
};

/** O url do logótipo animado com letras brancas (os autocolantes por cima de fotos e vídeos) e a imagem parada. */
export const TXILLAPP_GIF_WHITE = { url: txUrl('txillapp-animado-branco.webp'), still: txUrl('txillapp-final-branco.png') };

/** É o GIF do Txillapp (fonte própria, id e ficheiros da lista)? */
export function isTxillappGif(g: unknown): g is ChatGif {
  if (!g || typeof g !== 'object') return false;
  const x = g as ChatGif;
  if (x.source !== 'txillapp' || !isTxId(x.id)) return false;
  const base = txUrl(TX_FILES[x.id].file);
  return x.url === `${base}.webp` || x.url === `${base}.gif`;
}

/**
 * O que se mostra de um GIF: o url e a imagem parada. Para o do Txillapp, a variante pelo fundo: num fundo escuro (`onDark`:
 * Txillada, vídeo, estúdio) as letras brancas; senão as pretas (a versão com fundo branco fica como está). Os do GIPHY: iguais.
 */
export function gifShown(g: ChatGif, onDark = false): { url: string; still?: string } {
  if (!isTxillappGif(g) || g.id === 'logo-fundo') return { url: g.url, ...(g.still ? { still: g.still } : {}) };
  const f = TX_FILES[onDark ? 'logo-branco' : 'logo'];
  const ext = g.url.endsWith('.gif') ? '.gif' : '.webp';
  return { url: txUrl(f.file + ext), still: txUrl(f.still) };
}

/** O GIF do Txillapp é largo (o logótipo inteiro): mostra-se inteiro (contain), nunca cortado (os dois «ll» não se cortam). */
export const gifFit = (g: { source?: GifSource }): 'contain' | 'cover' => (g.source === 'txillapp' ? 'contain' : 'cover');

/** O url é https de media*.giphy.com, com o id do GIF no caminho e uma imagem .gif/.webp. */
export function isGiphyUrl(url: unknown, id?: string): boolean {
  if (typeof url !== 'string' || url.length > 600) return false;
  const m = /^https:\/\/([^/?#]+)(\/[^?#]*)/.exec(url);
  if (!m || !HOST.test(m[1])) return false;
  const path = m[2];
  if (!path.startsWith('/media/') || !/\.(gif|webp)$/.test(path)) return false;
  return id === undefined || path.split('/').includes(id);
}

/** Um GIF bem formado (para mostrar uma bolha ou um comentário; o servidor já validou, isto é só defensivo). */
export function validGif(g: unknown): g is ChatGif {
  if (!g || typeof g !== 'object') return false;
  const x = g as ChatGif;
  if (x.source !== undefined) return isTxillappGif(x);
  return typeof x.id === 'string' && ID.test(x.id) && x.w > 0 && x.h > 0 && isGiphyUrl(x.url, x.id);
}

/** A mensagem a enviar quando se toca num GIF da grelha (vai o "full": WebP animado quando houver). */
export function gifMessage(item: GifItem): { kind: 'gif'; gif: ChatGif } {
  return { kind: 'gif', gif: gifPayload(item) };
}

/** O GIF de um comentário ou de uma mensagem, a partir de um item da grelha. */
export function gifPayload(item: GifItem): ChatGif {
  const title = item.title.trim().slice(0, 100);
  const rating = typeof item.rating === 'string' ? item.rating.trim().toLowerCase().slice(0, 10) : '';
  return { id: item.id, w: item.w, h: item.h, url: item.full, ...(item.still ? { still: item.still } : {}), ...(title ? { title } : {}), ...(rating ? { rating } : {}), ...(item.source === 'txillapp' ? { source: 'txillapp' as const } : {}) };
}

/** Quantas colunas tem a grelha para esta largura (2 no telemóvel, 3 a partir de ~420 px, 4 num ecrã largo). */
export function columnsFor(width: number): number {
  if (width >= 640) return 4;
  if (width >= 420) return 3;
  return 2;
}

/**
 * Grelha em colunas (como no GIPHY): cada GIF vai para a coluna mais baixa, com a altura pela sua proporção.
 * Devolve as colunas com os itens e a altura de cada um (já com o espaço entre eles).
 */
export function gifColumns(items: GifItem[], cols: number, colWidth: number, gap = 4): { items: { item: GifItem; height: number }[]; height: number }[] {
  const n = Math.max(1, Math.floor(cols));
  const out = Array.from({ length: n }, () => ({ items: [] as { item: GifItem; height: number }[], height: 0 }));
  for (const item of items) {
    const ratio = item.w > 0 && item.h > 0 ? item.h / item.w : 1;
    // Não deixar um GIF muito comprido ou muito achatado estragar a grelha.
    const height = Math.round(colWidth * Math.min(Math.max(ratio, 0.4), 2.5));
    let best = 0;
    for (let i = 1; i < n; i++) if (out[i].height < out[best].height) best = i;
    out[best].items.push({ item, height });
    out[best].height += height + gap;
  }
  return out;
}

/** O tamanho da bolha de um GIF: a proporção dele, dentro de maxW × maxH (nunca mais pequeno do que `min` de largura). */
export function gifSize(w: number, h: number, maxW = 240, maxH = 280, min = 120): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: maxW, height: Math.round(maxW * 0.75) };
  const scale = Math.min(maxW / w, maxH / h);
  let width = w * scale;
  let height = h * scale;
  if (width < min) {
    // Muito alto e estreito: fica com a largura mínima e corta-se em altura (contentFit cover).
    width = min;
    height = Math.min(maxH, (h / w) * min);
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/** Junta a página seguinte à lista (sem repetir GIFs: o GIPHY às vezes repete entre páginas). */
export function mergeGifs(prev: GifItem[], next: GifItem[]): GifItem[] {
  const seen = new Set(prev.map((g) => g.id));
  const out = [...prev];
  for (const g of next) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    out.push(g);
  }
  return out;
}

/** O que o leitor de ecrã diz de um GIF. */
export function gifLabel(title?: string | null): string {
  const t = (title ?? '').trim();
  return t ? `GIF: ${t}` : 'GIF';
}

/** O texto da pesquisa normalizado (o que vai ao servidor e é a chave da lista): sem espaços a mais, até 50. */
export function gifQuery(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 50);
}

/** Debounce da pesquisa (ms). */
export const GIF_DEBOUNCE_MS = 350;
