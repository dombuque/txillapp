import { post, raw, type Badged, type Post } from '@/lib/api';
import type { Track } from '@/lib/api.music';
import type { SoundKind, SoundUnavailable } from '@/lib/sounds';

/**
 * Os sons das tchekas (docs/sons.md): a entidade «som», a página (/som/[id]), «Sons em alta», usar um som, a denúncia e a
 * definição «Deixar usar o meu som». O id: um uuid (som original), `cat:<faixa>` ou `local:<uuid>`.
 */

export interface SoundAuthor extends Badged { username: string; displayName: string }

/** GET /sounds/:id. */
export interface Sound {
  id: string;
  kind: SoundKind;
  /** «Som original · @ana», ou o título da faixa. */
  title: string;
  author?: SoundAuthor;
  /** Catálogo e artistas: o nome do artista (o crédito). */
  artist?: string;
  cover: string | null;
  durationMs: number | null;
  previewUrl: string | null;
  /** Tchekas que usam o som (só números). */
  uses: number;
  createdAt: string | null;
  /** Catálogo e artistas: a faixa como o seletor a mostra (a interface de docs/musica.md). */
  music?: Track;
  /** Posso usá-lo numa tcheka nova. */
  canUse: boolean;
  unavailable?: SoundUnavailable;
  /** É o som de uma tcheka minha. */
  mine: boolean;
  /** Som original: a tcheka de onde saiu. */
  sourcePost?: { id: string; code: string } | null;
}

/** Cada som de «Sons em alta» (GET /sounds/trending). */
export interface TrendingSound extends Omit<Sound, 'music' | 'canUse' | 'unavailable' | 'mine' | 'sourcePost'> {
  /** Tchekas com este som nos últimos 7 dias. */
  uses7d: number;
}

/** O som que cada tcheka traz (`post.sound`). */
export interface PostSound { id: string; title: string; kind: SoundKind; author?: SoundAuthor; artist?: string }

export interface SoundSettings { reuse: boolean; effective: boolean; private: boolean; minor: boolean }

export type SoundSort = 'top' | 'recent';

const path = (id: string) => `/sounds/${encodeURIComponent(id)}`;

export const soundsApi = {
  get: (id: string): Promise<Sound> => raw(path(id)),
  /** As tchekas que usam o som: `top` (mais vistas, depois as recentes; a original à frente) ou `recent`. */
  tchekas: (id: string, sort: SoundSort = 'top', cursor?: string): Promise<{ items: Post[]; nextCursor: string | null }> =>
    raw(`${path(id)}/tchekas?sort=${sort}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  trending: (limit = 20): Promise<TrendingSound[]> => raw(`/sounds/trending?limit=${limit}`),
  /** «Este som tem música protegida» (ou outro motivo). Fica escondido para novos usos enquanto a equipa analisa. */
  report: (id: string, reason: 'copyright' | 'other', note?: string): Promise<void> => raw(`${path(id)}/report`, post({ reason, ...(note ? { note } : {}) })),
  settings: (): Promise<SoundSettings> => raw('/sounds/me/settings'),
  setSettings: (reuse: boolean): Promise<SoundSettings> => raw('/sounds/me/settings', { method: 'PUT', body: JSON.stringify({ reuse }) }),
};
