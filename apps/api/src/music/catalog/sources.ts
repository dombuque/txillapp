import { licenseFrom, type Candidate } from './curation';
import type { MusicStyleId } from './track';

/**
 * As fontes externas do catálogo. Cada uma sabe pesquisar por estilo (pelas etiquetas da própria fonte) e devolve candidatos
 * com os sinais de qualidade que a fonte dá; a curadoria (curation.ts) decide o que entra. Só são chamadas pela tarefa
 * periódica (MusicCatalogService.refresh), nunca a cada pedido da app.
 */
export interface ExternalSource {
  id: Candidate['source'];
  /** Para o backoffice: o que a fonte dá e porque está ligada ou desligada. */
  note: string;
  search(style: MusicStyleId): Promise<Candidate[]>;
  /** Só as fontes de efeitos sonoros (secção «Sons»). */
  sounds?(): Promise<Candidate[]>;
}

/** As etiquetas de cada estilo, como as fontes as escrevem (minúsculas; a forma com espaços serve ao Archive). */
export const STYLE_TAGS: Record<MusicStyleId, string[]> = {
  afrobeats: ['afrobeats', 'afrobeat', 'afropop', 'african', 'afro'],
  amapiano: ['amapiano', 'afro house', 'afrohouse'],
  pandza: ['pandza', 'kuduro'],
  marrabenta: ['marrabenta', 'mozambique', 'mocambique'],
  kizomba: ['kizomba', 'zouk', 'semba', 'kompa'],
  hiphop: ['hip hop', 'hiphop', 'rap', 'trap'],
  rnb: ['rnb', 'r&b', 'soul', 'neo soul'],
  gospel: ['gospel', 'worship', 'christian'],
  chill: ['lofi', 'lo-fi', 'chillhop', 'chill', 'chillout'],
  festa: ['dance', 'party', 'house', 'edm', 'dancehall'],
  romantico: ['romantic', 'love song', 'love', 'ballad'],
  praia: ['summer', 'beach', 'tropical', 'reggae'],
};

/** Palavras que, na pesquisa, levam a um estilo (inclui as pastilhas das versões antigas da app: afro, dance, hip hop…). */
export const STYLE_ALIASES: Record<MusicStyleId, string[]> = {
  afrobeats: ['afrobeats', 'afrobeat', 'afro', 'africa'],
  amapiano: ['amapiano', 'piano piano'],
  pandza: ['pandza', 'kuduro'],
  marrabenta: ['marrabenta'],
  kizomba: ['kizomba', 'zouk', 'semba'],
  hiphop: ['hip hop', 'hip-hop', 'hiphop', 'rap', 'trap'],
  rnb: ['r&b', 'rnb', 'soul'],
  gospel: ['gospel', 'louvor', 'igreja', 'worship'],
  chill: ['chill', 'lofi', 'lo-fi', 'relax', 'calma', 'acoustic', 'jazz', 'piano'],
  festa: ['festa', 'dance', 'party', 'house', 'pop'],
  romantico: ['romantico', 'romântico', 'amor', 'love'],
  praia: ['praia', 'verao', 'verão', 'summer', 'beach', 'reggae'],
};

/** Pesquisas da secção «Sons» (efeitos que a malta põe nos mimos). */
export const SOUND_QUERIES = ['applause', 'laugh', 'crowd cheer', 'drum roll', 'whoosh', 'air horn', 'camera shutter', 'notification', 'heartbeat', 'ocean waves', 'rain', 'kiss'];

const UA = 'Txillapp/1.0 (+https://txillapp.com)';

export type Fetcher = typeof fetch;

async function getJson<T>(f: Fetcher, url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await f(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} respondeu ${res.status}`);
  return (await res.json()) as T;
}

/** "2:45", "1:02:03" ou "165.3" → segundos. */
export function parseDuration(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) > 0 ? Number(s) : null;
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

const splitTags = (s: unknown) => (typeof s === 'string' ? s.split(',').map((t) => t.trim().toLowerCase().replace(/_/g, ' ')).filter(Boolean) : []);

/** Corre tarefas com no máximo `n` ao mesmo tempo (para não martelar as fontes). */
export async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- ccMixter

interface CcmUpload {
  upload_id: number;
  upload_name?: string;
  user_name?: string;
  user_real_name?: string;
  license_url?: string;
  license_name?: string;
  file_page_url?: string;
  upload_num_scores?: number;
  upload_extra?: { usertags?: string; nsfw?: boolean; num_reviews?: number };
  files?: { download_url?: string; file_format_info?: { 'media-type'?: string; 'default-ext'?: string; ps?: string } }[];
}

/** ccMixter: remisturas e originais de artistas, CC BY e CC0. Sem chave. Sinais: recomendações e críticas. */
export function ccmixter(f: Fetcher): ExternalSource {
  const query = async (style: MusicStyleId, lic: 'by' | 'pd') => {
    const tags = STYLE_TAGS[style].map((t) => t.replace(/ /g, '_').replace(/&/g, '_')).join(',');
    const url = `https://ccmixter.org/api/query?${new URLSearchParams({ f: 'json', tags, type: 'any', lic, sort: 'rank', limit: '40' })}`;
    return getJson<CcmUpload[]>(f, url);
  };
  return {
    id: 'ccmixter',
    note: 'Sem chave. Entra com pelo menos 5 recomendações; só CC BY e CC0.',
    async search(style) {
      const lists = await Promise.all([query(style, 'by'), query(style, 'pd')]);
      const out: Candidate[] = [];
      for (const u of lists.flat()) {
        if (!u || typeof u.upload_id !== 'number') continue;
        const file = (u.files ?? []).find((x) => x.file_format_info?.['media-type'] === 'audio' && /^mp3$/i.test(x.file_format_info?.['default-ext'] ?? '') && x.download_url);
        out.push({
          source: 'ccmixter',
          sourceId: String(u.upload_id),
          title: u.upload_name ?? '',
          artist: u.user_real_name || u.user_name || '',
          duration: parseDuration(file?.file_format_info?.ps),
          previewUrl: file?.download_url?.replace(/^http:\/\//, 'https://') ?? null,
          cover: null,
          license: u.license_url ?? u.license_name ?? null,
          landing: u.file_page_url ?? null,
          tags: splitTags(u.upload_extra?.usertags),
          nsfw: !!u.upload_extra?.nsfw,
          signals: { recommendations: Number(u.upload_num_scores ?? 0), reviews: Number(u.upload_extra?.num_reviews ?? 0) },
        });
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------- Internet Archive (netlabels)

interface IaDoc { identifier: string; title?: string | string[]; creator?: string | string[]; downloads?: number; avg_rating?: number | string; num_reviews?: number; licenseurl?: string }
interface IaFile { name: string; format?: string; source?: string; title?: string; artist?: string; creator?: string; length?: string }

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/**
 * Internet Archive, só a coleção netlabels (editoras que publicam em Creative Commons). Sem chave. Sinais: downloads e
 * avaliações. A licença vem do item (licenseurl) e é verificada aqui: no resto do Archive há muitas licenças erradas.
 */
export function archive(f: Fetcher, perStyle = 6): ExternalSource {
  return {
    id: 'archive',
    note: 'Sem chave. Só a coleção netlabels; entra com pelo menos 300 downloads; só CC BY, CC0 e domínio público.',
    async search(style) {
      const subjects = STYLE_TAGS[style].map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
      const params = new URLSearchParams({ q: `collection:netlabels AND mediatype:audio AND subject:(${subjects})`, rows: '100', output: 'json' });
      for (const fl of ['identifier', 'title', 'creator', 'downloads', 'avg_rating', 'num_reviews', 'licenseurl']) params.append('fl[]', fl);
      params.append('sort[]', 'downloads desc');
      const data = await getJson<{ response?: { docs?: IaDoc[] } }>(f, `https://archive.org/advancedsearch.php?${params}`);
      const docs = (data.response?.docs ?? []).filter((d) => d.identifier && licenseFrom(d.licenseurl)).slice(0, perStyle);
      const per = await pool(docs, 3, async (d) => {
        try {
          const meta = await getJson<{ result?: IaFile[] }>(f, `https://archive.org/metadata/${encodeURIComponent(d.identifier)}/files`);
          const mp3s = (meta.result ?? []).filter((x) => /\.mp3$/i.test(x.name) && /mp3/i.test(x.format ?? '') && !/_(64|32)kb\.mp3$/i.test(x.name));
          return mp3s.slice(0, 3).map((x): Candidate => ({
            source: 'archive',
            sourceId: `${d.identifier}/${x.name}`,
            title: x.title || first(d.title) || x.name.replace(/\.mp3$/i, ''),
            artist: x.artist || x.creator || first(d.creator),
            duration: parseDuration(x.length),
            previewUrl: `https://archive.org/download/${encodeURIComponent(d.identifier)}/${x.name.split('/').map(encodeURIComponent).join('/')}`,
            cover: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
            license: d.licenseurl ?? null,
            landing: `https://archive.org/details/${encodeURIComponent(d.identifier)}`,
            tags: [],
            signals: { downloads: Number(d.downloads ?? 0), rating: Number(d.avg_rating ?? 0), ratings: Number(d.num_reviews ?? 0) },
          }));
        } catch {
          return [];
        }
      });
      return per.flat();
    },
  };
}

// ---------------------------------------------------------------- Jamendo

interface JamTrack {
  id: string;
  name?: string;
  artist_name?: string;
  duration?: number;
  audio?: string;
  image?: string;
  album_image?: string;
  shareurl?: string;
  license_ccurl?: string;
  musicinfo?: { tags?: { genres?: string[]; vartags?: string[] } };
  stats?: { rate_downloads_total?: number; rate_listened_total?: number; favorited?: number; likes?: number; avgnote?: number; notes?: number };
}

/**
 * Jamendo: a maior fonte de música independente com Creative Commons. Precisa de JAMENDO_CLIENT_ID e, para uma app comercial,
 * de licença da Jamendo (a API só é grátis para uso não comercial). Sinais: popularidade, audições, downloads, favoritas.
 */
export function jamendo(f: Fetcher, clientId: string): ExternalSource {
  return {
    id: 'jamendo',
    note: 'Ligada com JAMENDO_CLIENT_ID. A API só é grátis para uso não comercial: precisa de licença da Jamendo. Entra com pelo menos 1000 audições; só CC BY.',
    async search(style) {
      const params = new URLSearchParams({
        client_id: clientId,
        format: 'json',
        limit: '50',
        fuzzytags: STYLE_TAGS[style].map((t) => t.replace(/[ &-]/g, '')).join(' '), // a Jamendo separa por + (espaço codificado)
        order: 'popularity_total',
        include: 'musicinfo stats licenses',
        audioformat: 'mp32',
        durationbetween: '45_420',
        imagesize: '300',
      });
      const data = await getJson<{ headers?: { status?: string; error_message?: string }; results?: JamTrack[] }>(f, `https://api.jamendo.com/v3.0/tracks/?${params}`);
      if (data.headers?.status && data.headers.status !== 'success') throw new Error(`Jamendo: ${data.headers.error_message ?? data.headers.status}`);
      return (data.results ?? []).map((t): Candidate => ({
        source: 'jamendo',
        sourceId: String(t.id),
        title: t.name ?? '',
        artist: t.artist_name ?? '',
        duration: typeof t.duration === 'number' ? t.duration : null,
        previewUrl: t.audio ?? null,
        cover: t.image || t.album_image || null,
        license: t.license_ccurl ?? null,
        landing: t.shareurl ?? null,
        tags: [...(t.musicinfo?.tags?.genres ?? []), ...(t.musicinfo?.tags?.vartags ?? [])].map((x) => x.toLowerCase()),
        signals: {
          listens: Number(t.stats?.rate_listened_total ?? 0),
          downloads: Number(t.stats?.rate_downloads_total ?? 0),
          favorited: Number(t.stats?.favorited ?? 0),
          likes: Number(t.stats?.likes ?? 0),
          rating: Number(t.stats?.avgnote ?? 0),
          ratings: Number(t.stats?.notes ?? 0),
        },
      }));
    },
  };
}

// ---------------------------------------------------------------- Freesound (só «Sons»)

interface FsSound { id: number; name?: string; username?: string; duration?: number; license?: string; url?: string; tags?: string[]; previews?: Record<string, string>; images?: Record<string, string>; num_downloads?: number; avg_rating?: number; num_ratings?: number }

/**
 * Freesound: efeitos e sons soltos, para a secção «Sons». Precisa de FREESOUND_TOKEN e, para uma app comercial, de acordo com
 * o Freesound (a API só é grátis para uso não comercial). Sinais: downloads e avaliações.
 */
export function freesound(f: Fetcher, token: string): ExternalSource {
  return {
    id: 'freesound',
    note: 'Ligada com FREESOUND_TOKEN, só para «Sons». A API só é grátis para uso não comercial: precisa de acordo com o Freesound. Entra com 500 downloads e nota ≥ 3,5; só CC0 e CC BY.',
    async search() {
      return [];
    },
    async sounds() {
      const lists = await pool(SOUND_QUERIES, 3, async (q) => {
        const params = new URLSearchParams({
          query: q,
          filter: 'duration:[1 TO 30] license:("Creative Commons 0" OR "Attribution")',
          sort: 'downloads_desc',
          fields: 'id,name,username,duration,license,url,tags,previews,images,num_downloads,avg_rating,num_ratings',
          page_size: '15',
        });
        const data = await getJson<{ results?: FsSound[] }>(f, `https://freesound.org/apiv2/search/text/?${params}`, { Authorization: `Token ${token}` });
        return (data.results ?? []).map((s): Candidate => ({
          source: 'freesound',
          sourceId: String(s.id),
          title: (s.name ?? '').replace(/\.(wav|mp3|aiff?|flac|ogg)$/i, ''),
          artist: s.username ?? '',
          duration: typeof s.duration === 'number' ? s.duration : null,
          previewUrl: s.previews?.['preview-hq-mp3'] ?? null,
          cover: s.images?.waveform_m ?? null,
          license: s.license ?? null,
          landing: s.url ?? null,
          tags: (s.tags ?? []).map((x) => x.toLowerCase()),
          sound: true,
          signals: { downloads: Number(s.num_downloads ?? 0), rating: Number(s.avg_rating ?? 0), ratings: Number(s.num_ratings ?? 0) },
        }));
      });
      return lists.flat();
    },
  };
}
