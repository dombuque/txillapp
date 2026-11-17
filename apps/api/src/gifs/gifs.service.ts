import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ageOf } from '@txillapp/shared';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { PG_POOL } from '../db/db.module';
import { MAX_OFFSET, mapGiphy, readRating, type GifInput, type GifPage, type GifRatingValue } from './gif';

const API = 'https://api.giphy.com/v1/gifs';
/** GIFs por página (a grelha pede mais ao chegar ao fim). */
export const GIF_LIMIT = 24;
/** Quanto tempo uma resposta fica em memória (por pesquisa + página + classificação). */
const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 500;
/** Pedidos ao GIPHY por minuto, em todo o servidor (o resto responde vazio): protege a quota da chave. */
const UPSTREAM_PER_MINUTE = 120;
const TIMEOUT_MS = 6000;
const ADULT = 18;
/** Confirmar um GIF pelo id: quanto tempo se espera pelo GIPHY (vai antes de gravar a nota, a mensagem ou o comentário). */
const CONFIRM_TIMEOUT_MS = 3000;
/** Quanto tempo fica guardada a classificação que o GIPHY deu a um id (pela confirmação ou numa grelha). */
const RATING_MS = 30 * 60_000;
const RATING_MAX = 5000;

export type GifRating = 'g' | 'pg-13';
type Off = { enabled: false; items: []; next: null };

/**
 * GIFs do GIPHY, sempre pelo nosso servidor: a chave não sai daqui e o GIPHY não fica a saber quem pesquisa (nem o IP,
 * nem a conta, nem um id por pessoa). Ao GIPHY vai só a chave, o termo da pesquisa, a página, a classificação, a língua
 * e o "bundle" — nada do utilizador. Não se manda `random_id`: é opcional na API e serve para o GIPHY personalizar e
 * contar por pessoa, que é justamente o que não queremos.
 *
 * - Sem GIPHY_API_KEY, tudo desligado: `/gifs/config` → { enabled: false } e as listas → { enabled: false, items: [], next: null }.
 * - Classificação: pg-13 para adultos; `g` para menores de 18 e para quem não tem data de nascimento.
 * - Cache em memória de 5 minutos, um teto de pedidos por minuto ao GIPHY e 6 s de tempo-limite. Se o GIPHY falhar,
 *   responde-se uma página vazia (nunca 500).
 * - "GIFs Txillapp": com GIPHY_CHANNEL (ex.: txillapp), a pesquisa `@txillapp` devolve os GIFs desse canal.
 * - Classificação de um GIF gravado (nota, mensagem ou comentário): `confirm` guarda a que o GIPHY dá, nunca a que a app manda.
 */
@Injectable()
export class GifsService {
  private readonly log = new Logger('Gifs');
  private readonly cache = new Map<string, { at: number; page: GifPage }>();
  private window = { start: 0, n: 0 };
  /** A classificação que o GIPHY deu a cada id (null = sem classificação), vinda da confirmação ou das grelhas. */
  private readonly ratings = new Map<string, { at: number; rating: GifRatingValue | null }>();
  /** Os ids que apareceram nas grelhas 'g' (as dos menores), para quando o GIPHY não responde. */
  private readonly gGrid = new Map<string, number>();
  private readonly key: string | null;
  private readonly channel: string | null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.key = config.GIPHY_API_KEY ?? null;
    this.channel = this.key && config.GIPHY_CHANNEL ? config.GIPHY_CHANNEL : null;
  }

  config() {
    return { enabled: !!this.key, channel: this.channel };
  }

  /** Menores de 18 (ou sem data de nascimento) só veem GIFs classificados `g`. */
  async ratingFor(userId: string): Promise<GifRating> {
    const { rows } = await this.pool.query('SELECT birth_date::text AS b FROM identity.users WHERE id = $1', [userId]);
    return rows[0]?.b && ageOf(rows[0].b as string) >= ADULT ? 'pg-13' : 'g';
  }

  async trending(userId: string, offset: number): Promise<GifPage | Off> {
    if (!this.key) return off();
    return this.fetchPage('trending', {}, offset, await this.ratingFor(userId));
  }

  async search(userId: string, q: string, offset: number): Promise<GifPage | Off> {
    if (!this.key) return off();
    const term = q.replace(/\s+/g, ' ').trim().slice(0, 50);
    if (!term) return this.trending(userId, offset);
    return this.fetchPage('search', { q: term }, offset, await this.ratingFor(userId));
  }

  /** Os GIFs do canal do Txillapp no GIPHY (só com GIPHY_CHANNEL). */
  async channelGifs(userId: string, offset: number): Promise<GifPage | Off> {
    if (!this.key) return off();
    if (!this.channel) return { items: [], next: null };
    return this.fetchPage('search', { q: `@${this.channel}` }, offset, await this.ratingFor(userId));
  }

  /**
   * O GIF a gravar (numa nota, numa mensagem ou num comentário) com a classificação que o GIPHY lhe dá, pelo id (GET /v1/gifs/:id), sem
   * olhar para a que a app mandou. Fica 30 minutos em memória por id (também a que vem nas grelhas, que já é do GIPHY).
   * Um GIF que o GIPHY diz que não existe (404): 400. Se o GIPHY falhar, não responder a tempo, estiver desligado (sem
   * chave) ou se o teto de pedidos já foi: para quem publica e é menor (ou não tem data de nascimento), fica 'g' só se o
   * GIF esteve na grelha 'g' (a única que lhe mostramos); para os outros, fica sem classificação, e um GIF sem
   * classificação conta como acima de 'g' para os menores (não lhes chega).
   */
  async confirm(userId: string, gif: GifInput): Promise<GifInput> {
    const { rating: _fromApp, ...rest } = gif;
    void _fromApp;
    const known = await this.ratingOf(gif.id);
    let rating: GifRatingValue | null;
    if (known !== undefined) rating = known;
    else rating = (await this.ratingFor(userId)) === 'g' && this.inGrid(gif.id) ? 'g' : null;
    return { ...rest, ...(rating ? { rating } : {}) };
  }

  /** A classificação do GIPHY para um id: o valor (null = sem classificação), undefined se não se soube. 404: 400. */
  private async ratingOf(id: string): Promise<GifRatingValue | null | undefined> {
    const hit = this.ratings.get(id);
    if (hit && Date.now() - hit.at < RATING_MS) return hit.rating;
    if (!this.key || !this.allowUpstream()) return undefined;
    try {
      const params = new URLSearchParams({ api_key: this.key });
      const res = await fetch(`${API}/${encodeURIComponent(id)}?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS) });
      if (res.status === 404) throw new BadRequestException('Esse GIF já não existe no GIPHY');
      if (!res.ok) {
        this.log.warn(`GIPHY respondeu ${res.status} ao confirmar um GIF`);
        return undefined;
      }
      const body = (await res.json()) as { data?: { id?: unknown; rating?: unknown } | unknown[] };
      const data = body?.data;
      if (!data || Array.isArray(data) || typeof data !== 'object' || (data as { id?: unknown }).id !== id) return undefined;
      const rating = readRating((data as { rating?: unknown }).rating);
      this.remember(id, rating);
      return rating;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.log.warn(`GIPHY indisponível ao confirmar um GIF: ${(e as Error).message}`);
      return undefined;
    }
  }

  private remember(id: string, rating: GifRatingValue | null) {
    if (this.ratings.size >= RATING_MAX) this.ratings.delete(this.ratings.keys().next().value!);
    this.ratings.set(id, { at: Date.now(), rating });
  }

  private inGrid(id: string) {
    const at = this.gGrid.get(id);
    return at !== undefined && Date.now() - at < RATING_MS;
  }

  private async fetchPage(path: 'trending' | 'search', extra: Record<string, string>, rawOffset: number, rating: GifRating): Promise<GifPage> {
    const offset = Math.min(Math.max(Math.floor(Number.isFinite(rawOffset) ? rawOffset : 0), 0), MAX_OFFSET);
    const cacheKey = `${path}|${(extra.q ?? '').toLowerCase()}|${offset}|${rating}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.page;
    if (!this.allowUpstream()) return { items: [], next: null };
    const params = new URLSearchParams({ api_key: this.key!, ...extra, limit: String(GIF_LIMIT), offset: String(offset), rating, lang: 'pt', bundle: 'messaging_non_clips' });
    let page: GifPage;
    try {
      // Sem cabeçalhos do utilizador (nem IP, nem User-Agent dele, nem cookies): o pedido sai do servidor.
      const res = await fetch(`${API}/${path}?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        this.log.warn(`GIPHY respondeu ${res.status} em ${path}`);
        return { items: [], next: null };
      }
      page = mapGiphy(await res.json(), offset, GIF_LIMIT);
    } catch (e) {
      this.log.warn(`GIPHY indisponível: ${(e as Error).message}`);
      return { items: [], next: null };
    }
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cacheKey, { at: Date.now(), page });
    // O que o GIPHY disse de cada GIF da grelha (a classificação) e, nas grelhas 'g', que o GIF lá esteve.
    for (const it of page.items) {
      this.remember(it.id, readRating(it.rating));
      if (rating === 'g') {
        if (this.gGrid.size >= RATING_MAX) this.gGrid.delete(this.gGrid.keys().next().value!);
        this.gGrid.set(it.id, Date.now());
      }
    }
    return page;
  }

  private allowUpstream() {
    const now = Date.now();
    if (now - this.window.start >= 60_000) this.window = { start: now, n: 0 };
    if (this.window.n >= UPSTREAM_PER_MINUTE) return false;
    this.window.n++;
    return true;
  }
}

const off = (): Off => ({ enabled: false, items: [], next: null });
