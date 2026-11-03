import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';

/** Onde as faixas de licença aberta estão alojadas (o Openverse junta estes e outros). Só se tocam faixas destes sítios. */
const ALLOWED_HOSTS = [
  'cdn.freesound.org',
  'freesound.org',
  'mp3d.jamendo.com',
  'prod-1.storage.jamendo.com',
  'storage.jamendo.com',
  'upload.wikimedia.org',
  'files.freemusicarchive.org',
  'freemusicarchive.org',
  'ccmixter.org',
  'cdn.pixabay.com',
  'archive.org',
  'ia800000.us.archive.org',
];
const hostOk = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
};

/** Licenças que deixam usar numa app (partilha com crédito). Nada de "não comercial" ou "sem derivados". */
const LICENSES = new Set(['cc0', 'pdm', 'by', 'by-sa']);

export interface Track {
  /** Identificador no Openverse. */
  id: string;
  title: string;
  artist: string;
  url: string;
  /** Página original, para o crédito. */
  landing: string | null;
  license: string;
  licenseUrl: string | null;
  durationMs: number | null;
  cover: string | null;
}

/** A faixa que uma nota leva: validada no servidor (nunca confiamos no que a app manda). */
export const trackSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().max(120).default(''),
  url: z.string().url().max(500).refine(hostOk, 'Faixa de um sítio não permitido'),
  landing: z.string().url().max(500).nullable().default(null),
  license: z.string().max(20).refine((l) => LICENSES.has(l.toLowerCase()), 'Licença não permitida'),
  licenseUrl: z.string().url().max(300).nullable().default(null),
  durationMs: z.number().int().positive().max(3_600_000).nullable().default(null),
  cover: z.string().url().max(500).nullable().default(null),
});

interface OpenverseAudio {
  id: string;
  title?: string;
  creator?: string;
  url?: string;
  foreign_landing_url?: string;
  license?: string;
  license_url?: string;
  duration?: number;
  thumbnail?: string;
}

const API = 'https://api.openverse.org/v1/audio/';

/**
 * Pesquisa de música com licenças abertas no Openverse (índice grátis de áudio Creative Commons). Só devolvemos CC0, domínio público,
 * CC-BY e CC-BY-SA, com o crédito do autor. Guarda-se em memória durante 10 minutos para poupar pedidos (o Openverse limita os anónimos).
 */
@Injectable()
export class MusicService {
  private readonly log = new Logger('Music');
  private readonly cache = new Map<string, { at: number; items: Track[] }>();

  async search(term: string): Promise<Track[]> {
    const q = term.trim().slice(0, 60);
    if (q.length < 2) throw new BadRequestException('Escreve pelo menos 2 letras');
    const key = q.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 600_000) return hit.items;
    let res: Response;
    try {
      const url = `${API}?${new URLSearchParams({ q, license: 'cc0,pdm,by,by-sa', page_size: '15', category: 'music', mature: 'false' })}`;
      res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Txillapp/1.0 (+https://txillapp.com)' }, signal: AbortSignal.timeout(8000) });
    } catch (e) {
      this.log.warn(`Openverse indisponível: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Não consegui falar com o catálogo de música agora. Tenta daqui a pouco');
    }
    if (res.status === 429) throw new ServiceUnavailableException('O catálogo de música está cheio agora. Tenta daqui a um minuto');
    if (!res.ok) throw new ServiceUnavailableException('O catálogo de música não respondeu. Tenta outra vez');
    const data = (await res.json()) as { results?: OpenverseAudio[] };
    const items: Track[] = [];
    for (const r of data.results ?? []) {
      if (!r.url || !r.id || !hostOk(r.url) || !LICENSES.has((r.license ?? '').toLowerCase())) continue;
      items.push({
        id: r.id,
        title: (r.title ?? 'Sem título').slice(0, 120),
        artist: (r.creator ?? '').slice(0, 120),
        url: r.url,
        landing: r.foreign_landing_url ?? null,
        license: (r.license ?? '').toLowerCase(),
        licenseUrl: r.license_url ?? null,
        durationMs: typeof r.duration === 'number' && r.duration > 0 ? Math.round(r.duration) : null,
        cover: r.thumbnail && /^https:\/\//.test(r.thumbnail) ? r.thumbnail : null,
      });
    }
    this.cache.set(key, { at: Date.now(), items });
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value as string);
    return items;
  }
}
